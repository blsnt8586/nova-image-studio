#!/usr/bin/env bash
# nova 运行状态体检:容器状态 + 关键环境变量 + 健康探测。
# 用法: ./scripts/deploy/status.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

echo "=== 容器状态 ==="
dc ps

echo ""
echo "=== 资源占用(瞬时)==="
docker stats --no-stream nova-image 2>/dev/null || echo "容器未运行"

echo ""
echo "=== 生效的关键配置 ==="
for k in NOVA_HOST_PORT NOVA_TASK_CONCURRENCY NOVA_MAX_QUEUE_SIZE; do
  v="$(docker exec nova-image printenv "$k" 2>/dev/null || echo '(未运行)')"
  echo "  $k = $v"
done

echo ""
echo "=== 首页健康探测(容器内 3000)==="
code="$(docker exec nova-image node -e \
  "fetch('http://localhost:3000/').then(r=>{console.log(r.status);process.exit(0)}).catch(e=>{console.log('FAIL '+e.message);process.exit(1)})" \
  2>/dev/null || echo 'FAIL')"
echo "  HTTP $code"
