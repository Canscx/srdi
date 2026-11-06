#!/usr/bin/env bash
set -e

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "==> 项目目录 ${ROOT}"

if [ ! -d .git ]; then
  echo "当前目录不是 git 仓库,无法自动更新"
  exit 1
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "有已跟踪文件被本地改过,先处理再更新:"
  git status --short --untracked-files=no
  exit 1
fi

echo "==> 备份当前代码"
SHA_BEFORE="$(git rev-parse --short HEAD)"
BACKUP_FILE="$(bash "${ROOT}/deploy/backup.sh")"
echo "    快照 ${BACKUP_FILE}"
echo "    提交 ${SHA_BEFORE}"

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

running_commit() {
  local body
  body="$(curl -sf "http://127.0.0.1:${PORT_VALUE}/api/health" 2>/dev/null || true)"
  printf '%s' "${body}" | sed -n 's/.*"commit":"\([0-9a-f][0-9a-f]*\)".*/\1/p' | head -1
}

hint_rollback() {
  echo ""
  echo "本次更新前的快照:${BACKUP_FILE}"
  echo "回滚方式一(推荐):bash deploy/rollback.sh"
  echo "回滚方式二:git reset --hard ${SHA_BEFORE} && pnpm install && pnpm build,再重启进程"
}

echo "==> 重启服务"
if command -v pm2 > /dev/null 2>&1 && pm2 describe srdi > /dev/null 2>&1; then
  pm2 restart srdi
else
  echo "命令行没有 pm2 进程 srdi,代码与依赖已更新,但进程未重启。"
  echo "请到宝塔「网站 → Node 项目」点【重启】,再访问页面确认版本。"
  HEAD_SHA="$(git rev-parse --short HEAD)"
  RUNNING="$(running_commit)"
  if [ -n "${RUNNING}" ] && [ "${RUNNING}" != "${HEAD_SHA}" ]; then
    echo ""
    echo "!! 进程仍在跑 ${RUNNING},磁盘上已是 ${HEAD_SHA}"
    echo "!! 重启之前,本次新增的接口会返回「接口不存在」"
  fi
  hint_rollback
  exit 0
fi

echo "==> 健康检查 http://127.0.0.1:${PORT_VALUE}/api/health"
HEAD_SHA="$(git rev-parse --short HEAD)"
attempt=1
while [ "${attempt}" -le 5 ]; do
  if curl -sf "http://127.0.0.1:${PORT_VALUE}/api/health" > /dev/null; then
    RUNNING="$(running_commit)"
    if [ -n "${RUNNING}" ] && [ "${RUNNING}" != "${HEAD_SHA}" ]; then
      echo ""
      echo "==> 检查未通过:进程跑的还是 ${RUNNING},磁盘上已是 ${HEAD_SHA}"
      echo "    重启没生效,或重启的不是这个项目。新接口会返回「接口不存在」。"
      hint_rollback
      exit 1
    fi
    echo ""
    echo "==> 部署完成,健康检查通过${RUNNING:+,进程提交 ${RUNNING}}"
    if [ "$(id -u)" = "0" ]; then
      echo "提示:本次以 root 执行,若 Node 项目以 www 运行,建议 chown -R www:www ${ROOT}"
    fi
    hint_rollback
    exit 0
  fi
  sleep 2
  attempt=$((attempt + 1))
done

echo ""
echo "==> 健康检查未通过,进程可能没起来。看日志:pm2 logs srdi --lines 100"
hint_rollback
exit 1
