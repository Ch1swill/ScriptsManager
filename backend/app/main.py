from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from .database import engine, SessionLocal, Base
from . import models, api, scheduler
import os
import logging

logger = logging.getLogger(__name__)

# 创建数据库表
Base.metadata.create_all(bind=engine)

app = FastAPI(title="ScriptsManager API")

from .api import sync_scripts_from_disk
from . import telegram_bot
from . import backup as backup_module


async def run_scheduled_local_backup():
    """模块级别的本地备份定时任务函数"""
    logger.info("Scheduled Local Backup: Task started")
    try:
        result = backup_module.backup_and_upload(script_ids=None, backup_type='local', cd2_config=None)
        if result['success']:
            logger.info(f"Scheduled Local Backup completed: {result['filename']}")
        else:
            logger.error(f"Scheduled Local Backup failed: {result.get('error')}")
    except Exception as e:
        logger.exception(f"Scheduled Local Backup error: {e}")


async def run_scheduled_cd2_backup():
    """模块级别的 CD2 备份定时任务函数 - 从数据库读取最新配置"""
    logger.info("Scheduled CD2 Backup: Task started")
    try:
        db = SessionLocal()
        try:
            cd2_url = db.query(models.Setting).filter(models.Setting.key == "cd2_webdav_url").first()
            cd2_username = db.query(models.Setting).filter(models.Setting.key == "cd2_username").first()
            cd2_password = db.query(models.Setting).filter(models.Setting.key == "cd2_password").first()
            cd2_path = db.query(models.Setting).filter(models.Setting.key == "cd2_backup_path").first()

            if not cd2_url or not cd2_username or not cd2_password:
                logger.warning("Scheduled CD2 Backup skipped: config incomplete")
                return

            cd2_config = {
                'webdav_url': cd2_url.value,
                'username': cd2_username.value,
                'password': cd2_password.value,
                'backup_path': cd2_path.value if cd2_path else '/ScriptBackups'
            }
        finally:
            db.close()

        result = backup_module.backup_and_upload(
            script_ids=None,
            backup_type='clouddrive',
            cd2_config=cd2_config
        )
        if result['success']:
            logger.info(f"Scheduled CD2 Backup completed: {result.get('remote_path')}")
        else:
            logger.error(f"Scheduled CD2 Backup failed: {result.get('error')}")
    except Exception as e:
        logger.exception(f"Scheduled CD2 Backup error: {e}")


def update_scheduled_backup(db=None):
    """更新定时备份任务（可在运行时调用）"""
    from apscheduler.triggers.cron import CronTrigger

    close_db = False
    if db is None:
        db = SessionLocal()
        close_db = True

    try:
        # 清除旧的定时任务
        for job_id in ['scheduled_backup_job', 'scheduled_local_backup', 'scheduled_cd2_backup']:
            if scheduler.scheduler.get_job(job_id):
                scheduler.scheduler.remove_job(job_id)

        # === 1. 配置本地备份定时任务 ===
        local_enabled = db.query(models.Setting).filter(models.Setting.key == "local_backup_enabled").first()
        local_cron = db.query(models.Setting).filter(models.Setting.key == "local_backup_cron").first()

        if local_enabled and local_enabled.value == "true" and local_cron and local_cron.value:
            scheduler.scheduler.add_job(
                run_scheduled_local_backup,
                CronTrigger.from_crontab(local_cron.value),
                id='scheduled_local_backup'
            )
            logger.info(f"Registered Scheduled Local Backup: {local_cron.value}")
        else:
            logger.info(f"Local Backup not scheduled: enabled={local_enabled.value if local_enabled else None}, cron={local_cron.value if local_cron else None}")

        # === 2. 配置CloudDrive2备份定时任务 ===
        cd2_enabled = db.query(models.Setting).filter(models.Setting.key == "cd2_backup_enabled").first()
        cd2_cron = db.query(models.Setting).filter(models.Setting.key == "cd2_backup_cron").first()

        if cd2_enabled and cd2_enabled.value == "true" and cd2_cron and cd2_cron.value:
            # 检查配置是否完整
            cd2_url = db.query(models.Setting).filter(models.Setting.key == "cd2_webdav_url").first()
            cd2_username = db.query(models.Setting).filter(models.Setting.key == "cd2_username").first()
            cd2_password = db.query(models.Setting).filter(models.Setting.key == "cd2_password").first()

            if cd2_url and cd2_username and cd2_password:
                scheduler.scheduler.add_job(
                    run_scheduled_cd2_backup,
                    CronTrigger.from_crontab(cd2_cron.value),
                    id='scheduled_cd2_backup'
                )
                logger.info(f"Registered Scheduled CD2 Backup: {cd2_cron.value}")
            else:
                logger.warning("Scheduled CD2 Backup enabled but config missing")
        else:
            logger.info(f"CD2 Backup not scheduled: enabled={cd2_enabled.value if cd2_enabled else None}, cron={cd2_cron.value if cd2_cron else None}")

    except Exception as e:
        logger.exception(f"Failed to update scheduled backup: {e}")
    finally:
        if close_db:
            db.close()

# 启动定时器
@app.on_event("startup")
async def startup_event():
    # 简单的数据库迁移
    from sqlalchemy import text
    try:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE scripts ADD COLUMN last_output TEXT"))
            conn.commit()
    except Exception:
        pass

    scheduler.scheduler.start()
    
    # 启动 Telegram Bot
    await telegram_bot.start_bot()
    
    # 注册健康检查任务 (每5分钟)
    # 先检查是否开启
    db = SessionLocal()
    hc_setting = db.query(models.Setting).filter(models.Setting.key == "enable_health_check").first()
    if hc_setting and hc_setting.value == "true":
        scheduler.scheduler.add_job(scheduler.health_check, 'interval', minutes=5, id='health_check_job')

    # 注册定时备份任务
    from . import backup as backup_module
    update_scheduled_backup(db)  # 使用共享函数

    db.close()
    
    # 同步所有启用的脚本到调度器
    db = SessionLocal()
    try:
        # 0. 重置所有处于 'running' 状态的脚本为 'idle' (因为容器重启了)
        running_scripts = db.query(models.Script).filter(models.Script.last_status == 'running').all()
        for script in running_scripts:
            script.last_status = 'idle'
            print(f"Reset script '{script.name}' status from 'running' to 'idle' (container restart)")
        db.commit()

        # 1. 先同步磁盘文件
        sync_scripts_from_disk(db)
        
        # 2. 获取所有脚本配置调度
        scripts = db.query(models.Script).all()
        print(f"Startup: Loaded {len(scripts)} scripts from database.")
        
        # 获取 TG 配置
        bot_token = db.query(models.Setting).filter(models.Setting.key == "tg_bot_token").first()
        chat_id = db.query(models.Setting).filter(models.Setting.key == "tg_chat_id").first()
        
        token_val = bot_token.value if bot_token else None
        chat_val = chat_id.value if chat_id else None

        for script in scripts:
            print(f" - Script: {script.name}, Enabled: {script.enabled}, AutoStart: {script.run_on_startup}, Cron: {script.cron}")
            
            # 只有启用的脚本才注册 Cron 任务
            if script.enabled and script.cron and script.cron != "@daemon":
                scheduler.update_scheduler(
                    script.id, 
                    script.cron, 
                    script.path, 
                    script.name,
                    token_val,
                    chat_val,
                    script.arguments
                )
            
            # 处理开机自启 (即使 enabled=False，只要 run_on_startup=True 也可以启动，或者逻辑上强制 enabled)
            # 这里我们约定：如果要开机自启，必须 enabled=True 或者是常驻脚本
            # 但用户反馈希望重启能记忆。如果他在前端只勾了 run_on_startup，那不管 enabled 怎么样都该跑。
            if script.run_on_startup:
                is_daemon = (script.cron == "@daemon")
                import asyncio
                asyncio.create_task(scheduler.run_script(
                    script.id, 
                    script.path, 
                    script.name,
                    token_val,
                    chat_val,
                    script.arguments,
                    is_daemon=is_daemon
                ))
    finally:
        db.close()

# 允许跨域（虽然合并后不再必须，但保留以防万一）
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册 API 路由
app.include_router(api.router, prefix="/api")

# 查找前端构建目录 (兼容 Docker 和本地开发)
frontend_dist = None
possible_paths = [
    "frontend/dist",           # Docker 容器环境 (WORKDIR /app)
    "../frontend/dist",        # 本地开发环境 (WORKDIR backend)
]

for p in possible_paths:
    if os.path.isdir(p) and os.path.exists(os.path.join(p, "index.html")):
        frontend_dist = os.path.abspath(p)
        break

# 静态文件托管
if frontend_dist:
    assets_path = os.path.join(frontend_dist, "assets")
    if os.path.exists(assets_path):
        app.mount("/assets", StaticFiles(directory=assets_path), name="assets")

# 处理所有其他路由 -> 返回 index.html (SPA 支持)
@app.get("/{full_path:path}")
async def serve_spa(full_path: str):
    # 如果请求的是 API 但没匹配到，返回 404 而不是 index.html
    if full_path.startswith("api/"):
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail="API endpoint not found")
        
    if frontend_dist:
        # 尝试提供静态文件 (如 icon.png, favicon.ico 等)
        try:
            # 安全地拼接路径，防止目录遍历
            safe_path = os.path.normpath(os.path.join(frontend_dist, full_path.lstrip("/")))
            # 确保路径仍在 frontend_dist 内且文件存在
            if safe_path.startswith(frontend_dist) and os.path.isfile(safe_path):
                return FileResponse(safe_path)
        except Exception:
            pass
            
        return FileResponse(os.path.join(frontend_dist, "index.html"))
    return {"message": "Frontend build not found. Please check Docker build process."}
