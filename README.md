# ScriptsManager

一个基于 Web 的脚本管理和调度系统，专注于 Docker 集成。提供 React 前端界面和 FastAPI 后端，支持脚本执行、定时调度和 Telegram 通知。

## 功能特性

- **脚本管理**: 创建、编辑、删除脚本，支持 Python 和 Shell
- **定时调度**: 基于 Cron 表达式的任务调度
- **实时日志**: WebSocket 实时日志流
- **Telegram 集成**: 脚本执行通知、远程控制
- **备份恢复**: 本地备份 + CloudDrive2 WebDAV 远程备份
- **健康检查**: 自动监控常驻脚本状态
- **主题切换**: 支持深色/浅色主题

## 快速开始

### 使用 Docker Compose (推荐)

1. 克隆仓库:
```bash
git clone https://github.com/Ch1swill/ScriptsManager.git
cd ScriptsManager
```

2. 创建脚本目录:
```bash
mkdir -p scripts
mkdir -p backend/data
```

3. 启动服务:
```bash
docker-compose up -d
```

4. 访问 Web 界面: http://localhost:4396

### 使用 Docker Hub 镜像

```bash
docker run -d \
  --name scripts-manager \
  -p 4396:4396 \
  -v $(pwd)/scripts:/scripts \
  -v $(pwd)/data:/app/data \
  -e TZ=Asia/Shanghai \
  ch1swill/scripts-manager:latest
```

## 配置说明

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SCRIPT_ROOT` | `/scripts` | 脚本存储目录 |
| `DATABASE_URL` | `sqlite:///app/data/manager.db` | 数据库路径 |
| `TZ` | `UTC` | 时区设置 |

### 卷挂载

| 容器路径 | 说明 |
|----------|------|
| `/scripts` | 脚本文件目录 |
| `/app/data` | 数据库和日志 |
| `/mnt` | (可选) NAS/外部存储挂载点 |

## 技术栈

### 后端
- FastAPI - Web 框架
- SQLAlchemy - ORM
- APScheduler - 任务调度
- httpx - HTTP 客户端
- WebSocket - 实时通信

### 前端
- React 19 - UI 框架
- TypeScript - 类型安全
- Vite - 构建工具
- Tailwind CSS - 样式框架
- Monaco Editor - 代码编辑器

## API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/scripts` | 获取所有脚本 |
| POST | `/api/scripts` | 创建脚本 |
| PUT | `/api/scripts/{id}` | 更新脚本 |
| DELETE | `/api/scripts/{id}` | 删除脚本 |
| POST | `/api/scripts/{id}/run` | 运行脚本 |
| POST | `/api/scripts/{id}/stop` | 停止脚本 |
| WebSocket | `/api/logs/{id}/stream` | 实时日志流 |

## 开发

### 前端开发

```bash
cd frontend
npm install
npm run dev
```

### 后端开发

```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
```

### 构建 Docker 镜像

```bash
docker build -t scripts-manager .
```

## 截图

![Dashboard](docs/screenshot.png)

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！
