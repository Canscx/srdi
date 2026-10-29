#!/usr/bin/env bash
set -e

cd /www/wwwroot/srdi

echo "==> 拉取最新代码"
git pull --ff-only

echo "==> 同步依赖"
pnpm install

echo "==> 构建前端"
pnpm build

echo "==> 重启服务"
pm2 restart srdi

sleep 3

if curl -sf http://127.0.0.1:8787/api/health > /dev/null; then
  echo ""
  echo "==> 部署完成,健康检查通过"
else
  echo ""
  echo "==> 健康检查未通过,执行 pm2 logs srdi 查看原因"
  exit 1
fi

pm2 status srdi
