#!/bin/bash
# 示例脚本: 系统监控
# 演示基本的 Shell 脚本结构

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 系统监控启动"

# 配置区域 - 请根据需要修改
TARGET_URL="http://localhost:8080"
CHECK_INTERVAL=60

echo "监控目标: $TARGET_URL"
echo "检查间隔: ${CHECK_INTERVAL}秒"

while true; do
    TIMESTAMP=$(date "+%Y-%m-%d %H:%M:%S")

    # 检查服务
    if curl -s -f --connect-timeout 5 "$TARGET_URL" > /dev/null 2>&1; then
        echo "[$TIMESTAMP] 服务正常运行"
    else
        echo "[$TIMESTAMP] 警告: 服务不可访问"
    fi

    sleep "$CHECK_INTERVAL"
done
