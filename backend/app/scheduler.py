from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger
import asyncio
import os
import datetime
import httpx
import logging
import shlex
from .database import SessionLocal
from . import models

scheduler = AsyncIOScheduler()
logger = logging.getLogger(__name__)

# 全局字典存储运行中的进程: script_id -> subprocess.Process
RUNNING_TASKS = {}

async def notify_telegram(message: str, bot_token: str, chat_id: str):
    if not bot_token or not chat_id:
        return
    
    # 获取代理配置
    db = SessionLocal()
    proxy_setting = db.query(models.Setting).filter(models.Setting.key == "tg_proxy").first()
    proxy = proxy_setting.value if proxy_setting and proxy_setting.value else None
    db.close()

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    
    # httpx proxy 参数
    proxies = proxy if proxy else None
    
    logger.info(f"Sending TG message via proxy: {proxies}")
    async with httpx.AsyncClient(proxy=proxies) as client:
        try:
            await client.post(url, json={"chat_id": chat_id, "text": message})
        except Exception as e:
            logger.error(f"Failed to send TG notification: {e}")

async def stop_script(script_id: int):
    """停止正在运行的脚本"""
    import signal

    if script_id not in RUNNING_TASKS:
        logger.warning(f"Script {script_id} not found in RUNNING_TASKS")
        return False

    try:
        process = RUNNING_TASKS[script_id]

        # 检查进程是否仍在运行
        if process.returncode is not None:
            logger.info(f"Script {script_id} already finished with code {process.returncode}")
            return True

        # 获取进程组ID (等于进程PID，因为我们使用了 start_new_session=True)
        pgid = process.pid

        # 发送 SIGTERM 到整个进程组，一次性终止所有子进程
        logger.info(f"Sending SIGTERM to process group {pgid} for script {script_id}")
        try:
            os.killpg(pgid, signal.SIGTERM)
        except ProcessLookupError:
            logger.info(f"Process group {pgid} already terminated")
            return True

        # 等待进程结束，最多3秒
        try:
            await asyncio.wait_for(process.wait(), timeout=3.0)
            logger.info(f"Script {script_id} terminated gracefully")
            return True
        except asyncio.TimeoutError:
            # 强制杀死整个进程组
            logger.warning(f"Script {script_id} did not terminate, sending SIGKILL to process group")
            try:
                os.killpg(pgid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            try:
                await asyncio.wait_for(process.wait(), timeout=2.0)
            except Exception as kill_err:
                logger.error(f"Error force killing script {script_id}: {kill_err}")
            return True
    except Exception as e:
        logger.error(f"Error stopping script {script_id}: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False

async def run_script(script_id: int, script_path: str, script_name: str, bot_token: str = None, chat_id: str = None, arguments: str = None, is_daemon: bool = False):
    # 准备日志文件 - 尽早创建，确保能记录所有错误
    log_dir = "/data/logs"
    os.makedirs(log_dir, exist_ok=True)
    log_file_path = os.path.join(log_dir, f"{script_id}.log")
    start_time = datetime.datetime.now()

    # 立即创建/更新日志文件，记录启动信息
    with open(log_file_path, "a") as log_file:
        log_file.write(f"\n\n{'='*20} Starting at {start_time} {'='*20}\n")
        log_file.flush()

    # 如果已经在运行，先不重复启动（或者是重启？这里策略是单实例运行）
    if script_id in RUNNING_TASKS:
        if RUNNING_TASKS[script_id].returncode is None:
            logger.warning(f"Script {script_name} is already running.")
            with open(log_file_path, "a") as log_file:
                log_file.write(f"Error: Script is already running, skipped.\n")
            return

    logger.info(f"Starting script: {script_name} (Daemon: {is_daemon})")

    db = SessionLocal()
    script = db.query(models.Script).filter(models.Script.id == script_id).first()
    if script:
        script.last_status = "running"
        script.last_run = start_time
        db.commit()

    try:
        # 检查脚本文件是否存在
        if not os.path.exists(script_path):
            raise FileNotFoundError(f"Script file not found: {script_path}")

        # 构建命令
        cmd_args = []
        if script_path.endswith('.py'):
            program = "python3"
            # 强制 Python 刷新缓冲区，保证实时日志
            cmd_args.append("-u")
            cmd_args.append(script_path)
        else:
            # 使用 stdbuf 强制行缓冲，保证 shell 脚本实时输出日志
            program = "stdbuf"
            cmd_args.extend(["-oL", "-eL", "bash", script_path])

        if arguments:
            args_list = shlex.split(arguments)
            cmd_args.extend(args_list)

        logger.info(f"Executing command: {program} {' '.join(cmd_args)}")

        # 记录执行命令到日志
        with open(log_file_path, "a") as log_file:
            log_file.write(f"Command: {program} {' '.join(cmd_args)}\n")
            log_file.flush()
            
        # 启动进程，重定向 stdout 和 stderr 到 PIPE
        # 使用 start_new_session=True 创建新的进程组，便于一次性终止所有子进程
        process = await asyncio.create_subprocess_exec(
            program, *cmd_args,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,  # 合并 stderr 到 stdout
            start_new_session=True  # 创建新会话/进程组
        )
        
        RUNNING_TASKS[script_id] = process

        # 检查日志文件大小，如果超过 2MB 则截断（保留最后一部分或清空，简单起见清空旧的）
        if os.path.exists(log_file_path) and os.path.getsize(log_file_path) > 2 * 1024 * 1024:
            with open(log_file_path, "w") as f:
                f.write(f"=== Log rotated at {start_time} ===\n")

        # 实时读取日志并写入文件 (使用追加模式)
        with open(log_file_path, "a", buffering=1) as log_file: # Line buffering
            log_file.write(f"Process started (PID: {process.pid})\n")
            
            while True:
                line = await process.stdout.readline()
                if not line:
                    break
                decoded_line = line.decode('utf-8', errors='replace')
                log_file.write(decoded_line)
                # 可以在这里做 WebSocket 广播，但更简单的是前端通过 WS 读取文件
        
        await process.wait()
        
        # 进程结束
        return_code = process.returncode
        status = "success" if return_code == 0 else "failed"
        if return_code == -15: # SIGTERM
            status = "stopped"

        # 再次写入结束标记
        with open(log_file_path, "a") as log_file:
            log_file.write(f"\n=== Finished at {datetime.datetime.now()} with status: {status} ===\n")

        # 更新数据库
        # 需要重新创建 session，因为之前的 session 可能太久了
        db.close()
        db = SessionLocal()
        script = db.query(models.Script).filter(models.Script.id == script_id).first()
        if script:
            script.last_status = status
            # 读取最后的日志存入 last_output (为了历史查看)
            try:
                with open(log_file_path, "r") as f:
                    # 只存最后 5000 字符到数据库
                    f.seek(0, 2)
                    size = f.tell()
                    f.seek(max(size - 5000, 0))
                    script.last_output = f.read()
            except:
                pass
            db.commit()
            
        logger.info(f"Script {script_name} finished with status: {status}")

        if bot_token and chat_id and not is_daemon:
            # 检查是否仅失败时通知
            notify_on_failure_only_setting = db.query(models.Setting).filter(
                models.Setting.key == "tg_notify_on_failure_only"
            ).first()
            notify_on_failure_only = notify_on_failure_only_setting and notify_on_failure_only_setting.value == 'true'

            # 如果开启了仅失败通知，且状态是成功，则跳过通知
            if notify_on_failure_only and status == "success":
                logger.info(f"Skipping success notification for {script_name} (notify_on_failure_only enabled)")
            else:
                msg = f"🚀 脚本: {script_name}\n状态: {status}\n耗时: {datetime.datetime.now() - start_time}"
                await notify_telegram(msg, bot_token, chat_id)
            
    except Exception as e:
        import traceback
        error_details = traceback.format_exc()
        logger.error(f"Error running script {script_name}: {e}\n{error_details}")
        # 写入错误日志
        with open(log_file_path, "a") as log_file:
            log_file.write(f"\n=== Internal Error ===\n")
            log_file.write(f"Error: {e}\n")
            log_file.write(f"Details:\n{error_details}\n")
            log_file.flush()

        # 更新数据库状态
        try:
            db.rollback()  # 回滚可能的未提交事务
            script = db.query(models.Script).filter(models.Script.id == script_id).first()
            if script:
                script.last_status = "failed"
                db.commit()
        except Exception as db_err:
            logger.error(f"Failed to update script status: {db_err}")
    finally:
        if script_id in RUNNING_TASKS:
            del RUNNING_TASKS[script_id]
        db.close()

def update_scheduler(script_id, cron_expr, script_path, script_name, bot_token=None, chat_id=None, arguments=None):
    job_id = f"script_{script_id}"
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
    
    # 如果是 @daemon，不添加到定时器，只用于标记
    if cron_expr == "@daemon":
        return

    if cron_expr:
        try:
            scheduler.add_job(
                run_script,
                CronTrigger.from_crontab(cron_expr),
                id=job_id,
                args=[script_id, script_path, script_name, bot_token, chat_id, arguments, False]
            )
        except Exception as e:
            logger.error(f"Failed to add cron job for {script_name}: {e}")

async def health_check():
    issues = []
    db = SessionLocal()
    
    # 获取 TG 配置用于通知
    proxy_setting = db.query(models.Setting).filter(models.Setting.key == "tg_proxy").first()
    token_setting = db.query(models.Setting).filter(models.Setting.key == "tg_bot_token").first()
    chat_setting = db.query(models.Setting).filter(models.Setting.key == "tg_chat_id").first()
    
    token = token_setting.value if token_setting else None
    chat_id = chat_setting.value if chat_setting else None
    
    # 1. 检查常驻脚本
    # 查找数据库中认为是 'running' 且是 daemon 的脚本
    running_daemons = db.query(models.Script).filter(
        models.Script.last_status == 'running', 
        models.Script.cron == '@daemon'
    ).all()
    
    for script in running_daemons:
        # 检查 RUNNING_TASKS 中是否存在且存活
        proc = RUNNING_TASKS.get(script.id)
        is_alive = False
        if proc and proc.returncode is None:
            is_alive = True
            
        if not is_alive:
            script.last_status = 'failed'
            issues.append(f"🔴 守护脚本 [{script.name}] 意外停止")
            logger.warning(f"Health Check: Daemon script {script.name} found dead. Updating status to failed.")
            
    db.commit()
    db.close()
    
    if issues and token and chat_id:
        msg = "🏥 *健康检查警报*\n\n" + "\n".join(issues)
        await notify_telegram(msg, token, chat_id)
    
    return issues