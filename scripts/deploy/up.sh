#!/usr/bin/env bash
# 应用配置变更并启动/重建容器(改了 .env.production 或 compose 后用这个)。
# 不重新构建镜像;compose 检测到配置变化会自动重建容器。
# 用法: ./scripts/deploy/up.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

echo "→ 应用配置并启动 $SERVICE(不重新构建镜像)..."
dc up -d
sleep 2
dc ps
echo "→ 当前并发配置:"
docker exec "$CONTAINER" printenv NOVA_TASK_CONCURRENCY 2>/dev/null | sed 's/^/   NOVA_TASK_CONCURRENCY=/' || true
