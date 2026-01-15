import os
import zipfile
import datetime
import logging
import json
from typing import Optional, List
from webdav3.client import Client
from .database import SessionLocal
from . import models

logger = logging.getLogger(__name__)

# 备份目录
BACKUP_DIR = "/data/backups"
os.makedirs(BACKUP_DIR, exist_ok=True)


def create_backup_filename(prefix: str = "scripts_backup") -> str:
    """生成备份文件名"""
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    return f"{prefix}_{timestamp}.zip"


def backup_scripts_to_zip(script_ids: Optional[List[int]] = None) -> tuple[str, str]:
    """
    将脚本打包为ZIP文件

    Args:
        script_ids: 要备份的脚本ID列表，None表示备份全部

    Returns:
        (zip_file_path, zip_filename) 元组
    """
    db = SessionLocal()
    try:
        # 查询要备份的脚本
        if script_ids:
            scripts = db.query(models.Script).filter(models.Script.id.in_(script_ids)).all()
            prefix = f"script_{script_ids[0]}" if len(script_ids) == 1 else "scripts_partial"
        else:
            scripts = db.query(models.Script).all()
            prefix = "scripts_backup"

        if not scripts:
            raise ValueError("没有找到要备份的脚本")

        # 生成备份文件名
        zip_filename = create_backup_filename(prefix)
        zip_path = os.path.join(BACKUP_DIR, zip_filename)

        # 创建ZIP文件
        with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
            # 备份每个脚本
            for script in scripts:
                # 1. 添加脚本文件
                if os.path.exists(script.path):
                    # 使用脚本名作为ZIP内部路径
                    arcname = os.path.basename(script.path)
                    zipf.write(script.path, arcname)
                    logger.info(f"Added script file: {arcname}")
                else:
                    logger.warning(f"Script file not found: {script.path}")

                # 2. 添加脚本元数据JSON
                metadata = {
                    "id": script.id,
                    "name": script.name,
                    "path": script.path,
                    "cron": script.cron,
                    "enabled": script.enabled,
                    "run_on_startup": script.run_on_startup,
                    "arguments": script.arguments,
                    "created_at": script.created_at.isoformat() if script.created_at else None,
                    "last_run": script.last_run.isoformat() if script.last_run else None,
                    "last_status": script.last_status
                }

                metadata_filename = f"{os.path.splitext(os.path.basename(script.path))[0]}_metadata.json"
                zipf.writestr(metadata_filename, json.dumps(metadata, ensure_ascii=False, indent=2))
                logger.info(f"Added metadata: {metadata_filename}")

        logger.info(f"Backup created successfully: {zip_path}")
        return zip_path, zip_filename

    finally:
        db.close()


def upload_to_clouddrive(
    local_file: str,
    remote_path: str,
    webdav_url: str,
    username: str,
    password: str
) -> bool:
    """
    使用WebDAV上传文件到CloudDrive2（直接使用HTTP请求，避免webdav3库的HEAD请求问题）

    Args:
        local_file: 本地文件路径
        remote_path: 远程文件路径（相对于WebDAV根目录）
        webdav_url: WebDAV服务地址
        username: CloudDrive2 用户名
        password: CloudDrive2 密码

    Returns:
        是否上传成功
    """
    import requests
    from requests.auth import HTTPBasicAuth

    try:
        # 清理参数
        webdav_url = webdav_url.strip().rstrip('/')
        username = username.strip()
        password = password.strip()
        auth = HTTPBasicAuth(username, password)

        # 确保远程目录存在（使用 MKCOL 请求创建目录）
        remote_dir = os.path.dirname(remote_path)
        if remote_dir and remote_dir != '/':
            parts = remote_dir.strip('/').split('/')
            current_path = ''
            for part in parts:
                current_path += '/' + part
                dir_url = f"{webdav_url}{current_path}/"
                try:
                    # MKCOL 创建目录，如果已存在会返回 405 或其他错误，忽略即可
                    resp = requests.request('MKCOL', dir_url, auth=auth, timeout=30)
                    if resp.status_code in [201, 301, 302]:
                        logger.info(f"Created directory: {current_path}")
                    # 405/409 表示目录已存在，忽略
                except Exception as e:
                    logger.debug(f"MKCOL {current_path} error (may already exist): {e}")

        # 上传文件（使用 PUT 请求）
        file_url = f"{webdav_url}{remote_path}"
        logger.info(f"Uploading {local_file} to {file_url}")

        with open(local_file, 'rb') as f:
            resp = requests.put(file_url, data=f, auth=auth, timeout=300)

        if resp.status_code in [200, 201, 204]:
            logger.info(f"Upload successful: {remote_path} (status: {resp.status_code})")
            return True
        else:
            logger.error(f"Upload failed: {remote_path} (status: {resp.status_code}, response: {resp.text[:200]})")
            return False

    except Exception as e:
        logger.error(f"Failed to upload to CloudDrive2: {type(e).__name__}: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_clouddrive_connection(webdav_url: str, username: str, password: str) -> tuple[bool, str]:
    """
    测试CloudDrive2连接

    Returns:
        (是否成功, 错误信息)
    """
    try:
        options = {
            'webdav_hostname': webdav_url.strip(),
            'webdav_login': username.strip(),
            'webdav_password': password.strip(),
            'webdav_timeout': 10
        }

        client = Client(options)

        # 测试连接：列出根目录
        client.list()

        return True, "连接成功"

    except Exception as e:
        error_msg = f"连接失败: {type(e).__name__}: {str(e)}"
        logger.error(error_msg)
        return False, error_msg


def backup_and_upload(
    script_ids: Optional[List[int]] = None,
    backup_type: str = 'local',
    cd2_config: Optional[dict] = None
) -> dict:
    """
    备份脚本并根据配置上传到CloudDrive2

    Args:
        script_ids: 要备份的脚本ID列表
        backup_type: 'local' 或 'clouddrive'
        cd2_config: CloudDrive2配置 {'webdav_url', 'username', 'password', 'backup_path'}

    Returns:
        备份结果字典
    """
    result = {
        'success': False,
        'local_path': None,
        'remote_path': None,
        'filename': None,
        'error': None
    }

    try:
        # 1. 创建本地备份
        local_path, filename = backup_scripts_to_zip(script_ids)
        result['local_path'] = local_path
        result['filename'] = filename

        # 2. 如果配置了CloudDrive，上传备份
        if backup_type == 'clouddrive' and cd2_config:
            webdav_url = cd2_config.get('webdav_url')
            username = cd2_config.get('username')
            password = cd2_config.get('password')
            backup_path = cd2_config.get('backup_path', '/ScriptBackups')

            if not webdav_url or not username or not password:
                raise ValueError("CloudDrive2配置不完整")

            # 构建远程路径
            remote_path = f"{backup_path.rstrip('/')}/{filename}"
            result['remote_path'] = remote_path

            # 上传文件
            upload_success = upload_to_clouddrive(
                local_file=local_path,
                remote_path=remote_path,
                webdav_url=webdav_url,
                username=username,
                password=password
            )

            if not upload_success:
                raise Exception("上传到CloudDrive2失败")

            # 上传成功后删除本地备份文件
            if os.path.exists(local_path):
                os.remove(local_path)
                logger.info(f"Deleted local backup after CloudDrive upload: {local_path}")
                result['local_path'] = None  # 清除本地路径

        result['success'] = True
        return result

    except Exception as e:
        result['error'] = str(e)
        logger.error(f"Backup failed: {e}")
        return result


def get_backup_history(limit: int = 20) -> List[dict]:
    """
    获取本地备份历史

    Returns:
        备份文件列表
    """
    try:
        backups = []

        if not os.path.exists(BACKUP_DIR):
            return backups

        # 列出所有ZIP文件
        files = [f for f in os.listdir(BACKUP_DIR) if f.endswith('.zip')]
        files.sort(reverse=True)  # 按文件名降序排序（时间戳在文件名中）

        for filename in files[:limit]:
            filepath = os.path.join(BACKUP_DIR, filename)
            stat = os.stat(filepath)

            backups.append({
                'filename': filename,
                'size': stat.st_size,
                'created_at': datetime.datetime.fromtimestamp(stat.st_mtime).isoformat(),
                'path': filepath
            })

        return backups

    except Exception as e:
        logger.error(f"Failed to get backup history: {e}")
        return []


def restore_from_backup(zip_file_path: str) -> dict:
    """
    从备份ZIP恢复脚本

    Args:
        zip_file_path: ZIP文件路径

    Returns:
        恢复结果
    """
    result = {
        'success': False,
        'restored_count': 0,
        'skipped_count': 0,
        'error': None,
        'details': []
    }

    db = SessionLocal()
    try:
        # 验证ZIP文件
        if not os.path.exists(zip_file_path):
            raise FileNotFoundError("备份文件不存在")

        if not zipfile.is_zipfile(zip_file_path):
            raise ValueError("无效的ZIP文件")

        # 创建临时解压目录
        temp_dir = os.path.join(BACKUP_DIR, f"restore_temp_{int(datetime.datetime.now().timestamp())}")
        os.makedirs(temp_dir, exist_ok=True)

        try:
            # 解压ZIP文件
            with zipfile.ZipFile(zip_file_path, 'r') as zipf:
                zipf.extractall(temp_dir)

            # 查找所有元数据JSON文件
            metadata_files = [f for f in os.listdir(temp_dir) if f.endswith('_metadata.json')]

            if not metadata_files:
                raise ValueError("备份中没有找到元数据文件")

            # 恢复每个脚本
            for metadata_file in metadata_files:
                metadata_path = os.path.join(temp_dir, metadata_file)

                try:
                    # 读取元数据
                    with open(metadata_path, 'r', encoding='utf-8') as f:
                        metadata = json.load(f)

                    script_filename = os.path.basename(metadata['path'])
                    script_source = os.path.join(temp_dir, script_filename)

                    # 检查脚本文件是否存在
                    if not os.path.exists(script_source):
                        result['details'].append(f"跳过 {metadata['name']}: 脚本文件缺失")
                        result['skipped_count'] += 1
                        continue

                    # 目标路径
                    script_root = os.getenv("SCRIPT_ROOT", "/scripts")
                    target_path = os.path.join(script_root, script_filename)

                    # 检查数据库中是否已存在同名脚本
                    existing_script = db.query(models.Script).filter(
                        models.Script.path == target_path
                    ).first()

                    # 复制脚本文件
                    import shutil
                    shutil.copy2(script_source, target_path)
                    logger.info(f"Restored script file: {target_path}")

                    if existing_script:
                        # 更新现有脚本配置
                        existing_script.name = metadata['name']
                        existing_script.cron = metadata.get('cron')
                        existing_script.enabled = metadata.get('enabled', False)
                        existing_script.run_on_startup = metadata.get('run_on_startup', False)
                        existing_script.arguments = metadata.get('arguments', '')
                        result['details'].append(f"更新脚本: {metadata['name']}")
                    else:
                        # 创建新脚本记录
                        new_script = models.Script(
                            name=metadata['name'],
                            path=target_path,
                            cron=metadata.get('cron'),
                            enabled=metadata.get('enabled', False),
                            run_on_startup=metadata.get('run_on_startup', False),
                            arguments=metadata.get('arguments', ''),
                            last_status=None,
                            last_run=None
                        )
                        db.add(new_script)
                        result['details'].append(f"新增脚本: {metadata['name']}")

                    result['restored_count'] += 1

                except Exception as e:
                    logger.error(f"Failed to restore script from {metadata_file}: {e}")
                    result['details'].append(f"恢复失败 {metadata_file}: {str(e)}")
                    result['skipped_count'] += 1

            # 提交数据库更改
            db.commit()

            result['success'] = True
            result['message'] = f"成功恢复 {result['restored_count']} 个脚本，跳过 {result['skipped_count']} 个"

        finally:
            # 清理临时目录
            if os.path.exists(temp_dir):
                import shutil
                shutil.rmtree(temp_dir)

        return result

    except Exception as e:
        result['error'] = str(e)
        logger.error(f"Restore from backup failed: {e}")
        import traceback
        traceback.print_exc()
        return result

    finally:
        db.close()
