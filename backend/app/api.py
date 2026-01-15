from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from . import models, scheduler, database
import os
import shutil
import asyncio
import logging
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

logger = logging.getLogger(__name__)
router = APIRouter()

def get_db():
    db = database.SessionLocal()
    try:
        yield db
    finally:
        db.close()

class ScriptCreate(BaseModel):
    name: str
    path: str
    cron: Optional[str] = None
    enabled: bool = True
    run_on_startup: bool = False
    description: Optional[str] = None
    arguments: Optional[str] = None

class ScriptResponse(ScriptCreate):
    id: int
    last_status: Optional[str] = None
    last_run: Optional[datetime] = None
    last_output: Optional[str] = None

    class Config:
        from_attributes = True

@router.get("/scripts", response_model=List[ScriptResponse])
async def get_scripts(db: Session = Depends(get_db)):
    return db.query(models.Script).all()

@router.post("/scripts", response_model=ScriptResponse)
async def create_script(script: ScriptCreate, db: Session = Depends(get_db)):
    db_script = models.Script(**script.dict())
    db.add(db_script)
    db.commit()
    db.refresh(db_script)
    
    # 获取 TG 配置
    bot_token = db.query(models.Setting).filter(models.Setting.key == "tg_bot_token").first()
    chat_id = db.query(models.Setting).filter(models.Setting.key == "tg_chat_id").first()
    token_val = bot_token.value if bot_token else None
    chat_val = chat_id.value if chat_id else None
    
    # 如果启用了 cron，更新调度器
    if db_script.enabled and db_script.cron:
        scheduler.update_scheduler(
            db_script.id, 
            db_script.cron, 
            db_script.path, 
            db_script.name,
            token_val,
            chat_val,
            db_script.arguments
        )
    
    return db_script

@router.delete("/scripts/{script_id}")
async def delete_script(script_id: int, db: Session = Depends(get_db)):
    db_script = db.query(models.Script).filter(models.Script.id == script_id).first()
    if not db_script:
        raise HTTPException(status_code=404, detail="Script not found")

    # 从调度器移除
    scheduler.update_scheduler(db_script.id, None, None, None)

    # 删除对应的脚本文件
    if os.path.exists(db_script.path):
        try:
            os.remove(db_script.path)
            logger.info(f"Deleted script file: {db_script.path}")
        except Exception as e:
            logger.error(f"Failed to delete script file {db_script.path}: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to delete script file: {str(e)}")

    # 删除对应的日志文件
    log_file = f"/data/logs/{script_id}.log"
    if os.path.exists(log_file):
        try:
            os.remove(log_file)
            logger.info(f"Deleted log file: {log_file}")
        except Exception as e:
            logger.error(f"Failed to delete log file {log_file}: {e}")

    db.delete(db_script)
    db.commit()
    return {"message": "Script deleted"}

@router.put("/scripts/{script_id}", response_model=ScriptResponse)
async def update_script(script_id: int, script_update: ScriptCreate, db: Session = Depends(get_db)):
    db_script = db.query(models.Script).filter(models.Script.id == script_id).first()
    if not db_script:
        raise HTTPException(status_code=404, detail="Script not found")
    
    # 更新字段
    for key, value in script_update.dict().items():
        setattr(db_script, key, value)
    
    db.commit()
    db.refresh(db_script)

    # 获取 TG 配置
    bot_token = db.query(models.Setting).filter(models.Setting.key == "tg_bot_token").first()
    chat_id = db.query(models.Setting).filter(models.Setting.key == "tg_chat_id").first()
    token_val = bot_token.value if bot_token else None
    chat_val = chat_id.value if chat_id else None

    # 更新调度器
    # 先尝试移除旧任务
    scheduler.update_scheduler(db_script.id, None, None, None) 
    
    if db_script.enabled and db_script.cron:
        scheduler.update_scheduler(
            db_script.id, 
            db_script.cron, 
            db_script.path, 
            db_script.name,
            token_val,
            chat_val,
            db_script.arguments
        )
        
    return db_script

@router.post("/upload")
async def upload_script(file: UploadFile = File(...)):
    root = os.getenv("SCRIPT_ROOT", "/scripts")
    # 确保目录存在
    os.makedirs(root, exist_ok=True)
    file_path = os.path.join(root, file.filename)
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    return {"filename": file.filename, "path": file_path}

@router.post("/scripts/{script_id}/run", response_model=ScriptResponse)
async def run_script_manually(script_id: int, db: Session = Depends(get_db)):
    logger.info(f"API Call: run_script_manually(id={script_id})")
    script = db.query(models.Script).filter(models.Script.id == script_id).first()
    if not script:
        logger.error(f"Script {script_id} not found")
        raise HTTPException(status_code=404, detail="Script not found")

    # 获取 TG 配置
    bot_token = db.query(models.Setting).filter(models.Setting.key == "tg_bot_token").first()
    chat_id = db.query(models.Setting).filter(models.Setting.key == "tg_chat_id").first()
    token_val = bot_token.value if bot_token else None
    chat_val = chat_id.value if chat_id else None

    is_daemon = (script.cron == "@daemon")

    # 异步运行脚本
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

    # 立即更新脚本状态为 'running'
    script.last_status = 'running'
    db.commit()
    db.refresh(script)

    return script

@router.post("/scripts/{script_id}/stop", response_model=ScriptResponse)
async def stop_script_manually(script_id: int, db: Session = Depends(get_db)):
    logger.info(f"API Call: stop_script_manually(id={script_id})")

    # 尝试停止进程
    success = await scheduler.stop_script(script_id)
    logger.info(f"stop_script returned: {success}")

    # 无论成功与否，都更新数据库状态
    script = db.query(models.Script).filter(models.Script.id == script_id).first()
    if script:
        script.last_status = 'stopped'
        db.commit()
        db.refresh(script)
        logger.info(f"Updated script {script_id} status to 'stopped' in database")
        return script
    else:
        raise HTTPException(status_code=404, detail="Script not found")

@router.websocket("/logs/{script_id}/stream")
async def websocket_log_stream(websocket: WebSocket, script_id: int):
    await websocket.accept()
    log_file_path = f"/data/logs/{script_id}.log"
    
    try:
        # 等待文件创建 (如果刚启动)
        retries = 0
        while not os.path.exists(log_file_path):
            await asyncio.sleep(0.5)
            retries += 1
            if retries > 10: # 5秒没文件，可能没启动成功
                await websocket.send_text("Waiting for log file creation...\n")
                
        # 类似 tail -f
        with open(log_file_path, "r") as f:
            # 先读取现有内容
            content = f.read()
            if content:
                await websocket.send_text(content)
            
            # 持续读取新增内容
            while True:
                line = f.read()
                if line:
                    await websocket.send_text(line)
                else:
                    await asyncio.sleep(0.5) # 避免 CPU 空转
    except WebSocketDisconnect:
        print(f"Client disconnected from log stream {script_id}")
    except Exception as e:
        print(f"WebSocket error: {e}")
        try:
            await websocket.close()
        except:
            pass

@router.get("/scripts/{script_id}/content")
async def get_script_content(script_id: int, db: Session = Depends(get_db)):
    script = db.query(models.Script).filter(models.Script.id == script_id).first()
    if not script or not os.path.exists(script.path):
        raise HTTPException(status_code=404, detail="Script file not found")
    with open(script.path, "r") as f:
        content = f.read()
    return {"content": content}

@router.put("/scripts/{script_id}/content")
async def update_script_content(script_id: int, content: dict, db: Session = Depends(get_db)):
    script = db.query(models.Script).filter(models.Script.id == script_id).first()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")
    with open(script.path, "w") as f:
        f.write(content.get("content", ""))
    return {"message": "Content updated"}

class TGConfig(BaseModel):
    token: str
    chat_id: str

class SettingItem(BaseModel):
    key: str
    value: str

@router.get("/settings")
async def get_all_settings(db: Session = Depends(get_db)):
    settings = db.query(models.Setting).all()
    return {s.key: s.value for s in settings}

@router.post("/settings")
async def save_setting(item: SettingItem, db: Session = Depends(get_db)):
    logger.info(f"API Call: save_setting(key={item.key})")
    setting = db.query(models.Setting).filter(models.Setting.key == item.key).first()
    if setting:
        setting.value = item.value
    else:
        setting = models.Setting(key=item.key, value=item.value)
        db.add(setting)
    
    db.commit()
    return {"message": "Setting saved"}

@router.post("/settings/apply")
async def apply_settings():
    """统一应用配置并重启 Bot"""
    logger.info("API Call: apply_settings()")
    from . import telegram_bot
    await telegram_bot.start_bot()
    return {"message": "Settings applied and bot restarted"}

@router.post("/test-tg")
async def test_tg_connection(config: TGConfig):
    try:
        await scheduler.notify_telegram("🎉 ScriptsManager: 连通性测试成功！", config.token, config.chat_id)
        return {"status": "success", "message": "Test message sent"}
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=400, detail=str(e))

def sync_scripts_from_disk(db: Session):
    root = os.getenv("SCRIPT_ROOT", "/scripts")
    if not os.path.exists(root):
        return

    # 获取现有数据库中的所有路径
    existing_paths = {s.path for s in db.query(models.Script).all()}
    
    # 遍历目录
    for filename in os.listdir(root):
        if filename.endswith(('.py', '.sh')):
            full_path = os.path.join(root, filename)
            
            # 如果是新文件
            if full_path not in existing_paths:
                print(f"Discovered new script: {filename}")
                new_script = models.Script(
                    name=filename,
                    path=full_path,
                    type='python' if filename.endswith('.py') else 'shell',
                    cron=None,
                    enabled=False,
                    run_on_startup=False
                )
                db.add(new_script)
    db.commit()

@router.post("/scan")
async def scan_scripts(db: Session = Depends(get_db)):
    sync_scripts_from_disk(db)
    return {"message": "Scan complete", "scripts": db.query(models.Script).all()}


# ==================== 备份相关API ====================

from . import backup as backup_module
from fastapi.responses import FileResponse

class BackupRequest(BaseModel):
    script_ids: Optional[List[int]] = None  # None表示备份全部
    backup_type: Optional[str] = 'local' # 'local' or 'clouddrive'

class BackupConfigRequest(BaseModel):
    # Local Backup Config
    local_backup_enabled: Optional[bool] = False
    local_backup_cron: Optional[str] = None
    
    # CloudDrive2 Config
    cd2_backup_enabled: Optional[bool] = False
    cd2_backup_cron: Optional[str] = None
    cd2_webdav_url: Optional[str] = None
    cd2_username: Optional[str] = None
    cd2_password: Optional[str] = None
    cd2_backup_path: Optional[str] = '/ScriptBackups'

class TestCloudDriveRequest(BaseModel):
    webdav_url: str
    username: str
    password: str

@router.post("/backup/manual")
async def manual_backup(request: BackupRequest, db: Session = Depends(get_db)):
    """手动备份脚本"""
    try:
        backup_type = request.backup_type or 'local'
        
        cd2_config = None
        if backup_type == 'clouddrive':
            # 读取CloudDrive2配置
            cd2_url = db.query(models.Setting).filter(models.Setting.key == "cd2_webdav_url").first()
            cd2_username = db.query(models.Setting).filter(models.Setting.key == "cd2_username").first()
            cd2_password = db.query(models.Setting).filter(models.Setting.key == "cd2_password").first()
            cd2_path = db.query(models.Setting).filter(models.Setting.key == "cd2_backup_path").first()

            if not cd2_url or not cd2_username or not cd2_password:
                raise HTTPException(status_code=400, detail="CloudDrive2配置不完整，请先在设置中配置")

            cd2_config = {
                'webdav_url': cd2_url.value,
                'username': cd2_username.value,
                'password': cd2_password.value,
                'backup_path': cd2_path.value if cd2_path else '/ScriptBackups'
            }

        # 执行备份
        result = backup_module.backup_and_upload(
            script_ids=request.script_ids,
            backup_type=backup_type,
            cd2_config=cd2_config
        )

        if not result['success']:
            raise HTTPException(status_code=500, detail=result['error'])

        return {
            "message": "备份成功",
            "filename": result['filename'],
            "local_path": result['local_path'],
            "remote_path": result['remote_path']
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Manual backup failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/backup/script/{script_id}")
async def backup_single_script(script_id: int, db: Session = Depends(get_db)):
    """备份单个脚本 (默认为本地备份)"""
    # 检查脚本是否存在
    script = db.query(models.Script).filter(models.Script.id == script_id).first()
    if not script:
        raise HTTPException(status_code=404, detail="Script not found")

    try:
        # 强制使用本地备份
        backup_type = 'local'
        cd2_config = None

        # 执行备份（只备份单个脚本）
        result = backup_module.backup_and_upload(
            script_ids=[script_id],
            backup_type=backup_type,
            cd2_config=cd2_config
        )

        if not result['success']:
            raise HTTPException(status_code=500, detail=result['error'])

        return {
            "message": f"脚本 '{script.name}' 备份成功",
            "filename": result['filename'],
            "local_path": result['local_path'],
            "remote_path": result['remote_path']
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Single script backup failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/backup/config")
async def get_backup_config(db: Session = Depends(get_db)):
    """获取备份配置"""
    config = {}

    keys = [
        'local_backup_enabled', 'local_backup_cron',
        'cd2_backup_enabled', 'cd2_backup_cron',
        'cd2_webdav_url', 'cd2_username', 'cd2_password', 'cd2_backup_path'
    ]

    for key in keys:
        setting = db.query(models.Setting).filter(models.Setting.key == key).first()
        config[key] = setting.value if setting else None

    return config


@router.post("/backup/config")
async def save_backup_config(config: BackupConfigRequest, db: Session = Depends(get_db)):
    """保存备份配置"""
    try:
        def save_key(key, value):
            setting = db.query(models.Setting).filter(models.Setting.key == key).first()
            if setting:
                setting.value = str(value) if value is not None else ""
            else:
                db.add(models.Setting(key=key, value=str(value) if value is not None else ""))

        # 保存所有配置
        save_key('local_backup_enabled', str(config.local_backup_enabled).lower())
        save_key('local_backup_cron', config.local_backup_cron)
        save_key('cd2_backup_enabled', str(config.cd2_backup_enabled).lower())
        save_key('cd2_backup_cron', config.cd2_backup_cron)
        save_key('cd2_webdav_url', config.cd2_webdav_url)
        save_key('cd2_username', config.cd2_username)
        save_key('cd2_password', config.cd2_password)
        save_key('cd2_backup_path', config.cd2_backup_path)

        db.commit()
        return {"message": "备份配置已保存"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Save backup config failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/backup/test-clouddrive")
async def test_clouddrive(request: TestCloudDriveRequest):
    """测试CloudDrive2连接"""
    try:
        success, message = backup_module.test_clouddrive_connection(
            webdav_url=request.webdav_url,
            username=request.username,
            password=request.password
        )

        if success:
            return {"status": "success", "message": message}
        else:
            raise HTTPException(status_code=400, detail=message)

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Test CloudDrive connection failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/backup/apply-schedule")
async def apply_backup_schedule(db: Session = Depends(get_db)):
    """应用定时备份设置（无需重启）"""
    try:
        from .main import update_scheduled_backup
        update_scheduled_backup(db)
        return {"message": "定时备份设置已应用"}
    except Exception as e:
        logger.error(f"Apply backup schedule failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/backup/history")
async def get_backup_history():
    """获取备份历史"""
    try:
        history = backup_module.get_backup_history(limit=20)
        return {"backups": history}
    except Exception as e:
        logger.error(f"Get backup history failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/backup/download/{filename}")
async def download_backup(filename: str):
    """下载备份文件"""
    try:
        filepath = os.path.join(backup_module.BACKUP_DIR, filename)

        if not os.path.exists(filepath):
            raise HTTPException(status_code=404, detail="备份文件不存在")

        # 安全检查：确保文件在备份目录内
        if not os.path.abspath(filepath).startswith(os.path.abspath(backup_module.BACKUP_DIR)):
            raise HTTPException(status_code=403, detail="无效的文件路径")

        return FileResponse(
            path=filepath,
            filename=filename,
            media_type='application/zip'
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Download backup failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/backup/{filename}")
async def delete_backup(filename: str):
    """删除单个备份文件"""
    try:
        filepath = os.path.join(backup_module.BACKUP_DIR, filename)

        if not os.path.exists(filepath):
            raise HTTPException(status_code=404, detail="备份文件不存在")

        # 安全检查：确保文件在备份目录内
        if not os.path.abspath(filepath).startswith(os.path.abspath(backup_module.BACKUP_DIR)):
            raise HTTPException(status_code=403, detail="无效的文件路径")

        # 删除文件
        os.remove(filepath)
        logger.info(f"Deleted backup file: {filename}")
        return {"message": f"备份文件 '{filename}' 已删除"}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete backup failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/backup")
async def delete_all_backups():
    """删除所有本地备份文件"""
    try:
        if not os.path.exists(backup_module.BACKUP_DIR):
            return {"message": "没有备份文件", "deleted_count": 0}

        # 获取所有 zip 文件
        files = [f for f in os.listdir(backup_module.BACKUP_DIR) if f.endswith('.zip')]
        deleted_count = 0

        for filename in files:
            filepath = os.path.join(backup_module.BACKUP_DIR, filename)
            try:
                os.remove(filepath)
                deleted_count += 1
                logger.info(f"Deleted backup file: {filename}")
            except Exception as e:
                logger.error(f"Failed to delete {filename}: {e}")

        return {"message": f"已删除 {deleted_count} 个备份文件", "deleted_count": deleted_count}

    except Exception as e:
        logger.error(f"Delete all backups failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/backup/upload-restore")
async def upload_and_restore_backup(file: UploadFile = File(...)):
    """上传备份文件并恢复"""
    try:
        # 验证文件类型
        if not file.filename.endswith('.zip'):
            raise HTTPException(status_code=400, detail="只支持ZIP文件")

        # 保存上传的文件到临时位置
        temp_path = os.path.join(backup_module.BACKUP_DIR, f"restore_{file.filename}")

        with open(temp_path, "wb") as f:
            content = await file.read()
            f.write(content)

        # 恢复备份
        result = backup_module.restore_from_backup(temp_path)

        # 删除临时文件
        if os.path.exists(temp_path):
            os.remove(temp_path)

        if not result['success']:
            raise HTTPException(status_code=500, detail=result.get('error', '恢复失败'))

        return {
            "message": result.get('message', '恢复成功'),
            "restored_count": result['restored_count'],
            "skipped_count": result['skipped_count'],
            "details": result['details']
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Upload and restore backup failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))