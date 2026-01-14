from sqlalchemy import Column, Integer, String, Boolean, DateTime
from datetime import datetime
from .database import Base

class Script(Base):
    __tablename__ = "scripts"

    id = Column(Integer, primary_key=True, index=True)
    name = Column(String, unique=True, index=True)
    path = Column(String)  # 脚本文件的路径
    arguments = Column(String, nullable=True) # 附加参数
    type = Column(String)  # 'python' 或 'shell'
    cron = Column(String, nullable=True)  # Cron 表达式
    enabled = Column(Boolean, default=True)  # 是否启用定时任务
    run_on_startup = Column(Boolean, default=False)  # 是否开机自启
    description = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    last_run = Column(DateTime, nullable=True)
    last_status = Column(String, nullable=True)  # 'success', 'failed', 'running'
    last_output = Column(String, nullable=True)  # 存储脚本运行的输出日志

class Setting(Base):
    __tablename__ = "settings"
    key = Column(String, primary_key=True)
    value = Column(String)