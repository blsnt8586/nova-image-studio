#!/usr/bin/env bash
# Nova 部署脚本共享配置。被同目录其它脚本 source。
# 切到仓库根目录执行,保证 compose / env 路径稳定。
set -euo pipefail

# 定位仓库根(本文件在 scripts/deploy/ 下,上两级即根)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

COMPOSE_FILE="docker-compose.prod.yml"
ENV_FILE=".env.production"
SERVICE="nova"
CONTAINER="nova-image"

# 统一的 compose 调用:固定 -f 和 --env-file,省得每次手敲
dc() {
  docker compose -f "$COMPOSE_FILE" --env-file "$ENV_FILE" "$@"
}

# 前置检查:缺 env 文件直接报错退出,避免用默认值误启动
require_env() {
  if [[ ! -f "$ENV_FILE" ]]; then
    echo "✗ 缺少 $ENV_FILE。请先 cp .env.production.example .env.production 并填好真实值。" >&2
    exit 1
  fi
}
