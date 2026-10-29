#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "==> 项目目录 ${ROOT}"

if [ ! -d .git ]; then
  echo "当前目录不是 git 仓库,无法自动更新"
  exit 1
fi

if [ -n "$(git status --porcelain)" ]; then
  echo "工作区有未提交的本地改动,先处理再更新:"
  git status --short
  exit 1
fi

echo "==> 拉取最新代码"
git pull --ff-only

echo "==> 同步依赖"
pnpm install

echo "==> 构建前端"
pnpm build

echo "==> 字体自检"
pnpm check:font || echo "字体自检未通过:PDF 导出可能失败,按上面列出的候选位置补字体后再重启"

PORT_VALUE="${PORT:-}"
if [ -z "${PORT_VALUE}" ] && [ -f .env ]; then
  PORT_VALUE=$(grep -E '^PORT=' .env | tail -1 | cut -d= -f2 | tr -d '[:space:]')
fi
PORT_VALUE="${PORT_VALUE:-8787}"

echo "==> 重启服务"
if command -v pm2 > /dev/null 2>&1 && pm2 describe srdi > /dev/null 2>&1; then
  pm2 restart srdi
else
  echo "命令行没有 pm2 进程 srdi,代码与依赖已更新,但进程未重启。"
  echo "请到宝塔「网站 → Node 项目」点【重启】,再访问页面确认版本。"
  exit 0
fi

echo "==> 健康检查 http://127.0.0.1:${PORT_VALUE}/api/health"
attempt=1
while [ "${attempt}" -le 5 ]; do
  if curl -sf "http://127.0.0.1:${PORT_VALUE}/api/health" > /dev/null; then
    echo ""
    echo "==> 部署完成,健康检查通过"
    if [ "$(id -u)" = "0" ]; then
      echo "提示:本次以 root 执行,若 Node 项目以 www 运行,建议 chown -R www:www ${ROOT}"
    fi
    exit 0
  fi
  sleep 2
  attempt=$((attempt + 1))
done

echo ""
echo "==> 健康检查未通过,进程可能没起来。看日志:pm2 logs srdi --lines 100"
exit 1
