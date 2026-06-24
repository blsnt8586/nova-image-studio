#!/usr/bin/env bash
# 构建镜像并(重新)启动 nova。代码有改动时用这个。
# 用法: ./scripts/deploy/build.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"
require_env

echo "→ 构建镜像并启动 $SERVICE ..."
dc up -d --build

echo "→ 等待容器就绪 ..."
sleep 3
dc ps
echo "✓ 完成。日志: ./scripts/deploy/logs.sh"
