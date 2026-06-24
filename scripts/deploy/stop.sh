#!/usr/bin/env bash
# 停止并移除 nova 容器(依赖服务 PG/Redis/MinIO 不受影响)。
# 用法: ./scripts/deploy/stop.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

echo "→ 停止 $SERVICE ..."
dc down
echo "✓ 已停止。"
