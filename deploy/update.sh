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
if command -v pm2 > /dev/null 2>&1; then
  pm2 restart srdi
else
  echo "命令行没有 pm2,请在宝塔面板的 Node 项目里点击【重启】"
fi

sleep 3

if curl -sf http://127.0.0.1:8787/api/health > /dev/null; then
  echo ""
  echo "==> 部署完成,健康检查通过"
else
  echo ""
  echo "==> 健康检查未通过:若刚在面板点了重启,等几秒重试 curl http://127.0.0.1:8787/api/health"
fi
