#!/usr/bin/env bash
# 跟踪 nova 日志。用法: ./scripts/deploy/logs.sh [行数,默认100]
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

TAIL="${1:-100}"
dc logs -f --tail "$TAIL"
