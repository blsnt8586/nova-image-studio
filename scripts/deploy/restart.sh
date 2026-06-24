#!/usr/bin/env bash
# 重启 nova 容器(不重新构建,不改配置)。
# 用法: ./scripts/deploy/restart.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

echo "→ 重启 $SERVICE ..."
dc restart
sleep 2
dc ps
