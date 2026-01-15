# =====================
# Stage 1: Build Frontend
# =====================
FROM node:20-slim AS frontend-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
# 安装依赖
RUN npm install

# 复制源代码并构建
COPY frontend/ .
RUN npm run build

# =====================
# Stage 2: Run Backend
# =====================
FROM python:3.11-slim

WORKDIR /app

# 安装系统依赖 (curl 用于健康检查, coreutils 包含 stdbuf 用于 shell 脚本实时日志)
RUN apt-get update && apt-get install -y curl coreutils && rm -rf /var/lib/apt/lists/*

# 复制后端依赖并安装
COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制后端代码
COPY backend/ .

# 从 Stage 1 复制构建好的前端静态文件
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# 设置环境变量
ENV SCRIPT_ROOT=/scripts
ENV DATABASE_URL=sqlite:////data/manager.db

# 暴露端口 4396
EXPOSE 4396

# 启动命令
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "4396"]
