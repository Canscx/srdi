#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PARENT="$(dirname "${ROOT}")"
NAME="$(basename "${ROOT}")"
BACKUP_DIR="${BACKUP_DIR:-/www/backup/srdi}"
TARGET="${1:-}"

if [ "${TARGET}" = "--list" ]; then
  echo "备份目录:${BACKUP_DIR}"
  ls -1th "${BACKUP_DIR}"/srdi-code-*.tar.gz 2>/dev/null || echo "还没有备份"
  exit 0
fi

if [ -z "${TARGET}" ]; then
  TARGET="$(ls -1t "${BACKUP_DIR}"/srdi-code-*.tar.gz 2>/dev/null | head -1 || true)"
  if [ -z "${TARGET}" ]; then
    echo "没有找到备份,先跑一次 bash deploy/backup.sh"
    exit 1
  fi
  echo "未指定备份文件,使用最新一份:$(basename "${TARGET}")"
fi

if [ ! -f "${TARGET}" ]; then
  echo "找不到备份文件 ${TARGET}"
  exit 1
fi
tar -tzf "${TARGET}" > /dev/null

if ! command -v rsync > /dev/null 2>&1; then
  echo "需要 rsync 才能安全覆盖代码,请先安装:yum install -y rsync 或 apt install -y rsync"
  exit 1
fi

echo "==> 回滚前先把当前代码也备份一份"
SAFETY="$(bash "${ROOT}/deploy/backup.sh")"
echo "    ${SAFETY}"

TMP="$(mktemp -d)"
trap 'rm -rf "${TMP}"' EXIT
tar -xzf "${TARGET}" -C "${TMP}"

if [ ! -d "${TMP}/${NAME}" ]; then
  echo "备份包结构不符合预期(应包含 ${NAME}/ 目录)"
  exit 1
fi

echo "==> 覆盖代码,保留 node_modules / data / release / .env / fonts / .workbuddy"
rsync -a --delete \
  --exclude node_modules \
  --exclude data \
  --exclude release \
  --exclude .git \
  --exclude .env \
  --exclude fonts \
  --exclude .workbuddy \
  --exclude .tmp \
  --exclude '*.log' \
  --exclude '*.part' \
  "${TMP}/${NAME}/" "${ROOT}/"

cd "${ROOT}"

echo "==> 同步依赖"
pnpm install

echo "==> 构建前端"
pnpm build

PORT_VALUE="${PORT:-}"
if [ -z "${PORT_VALUE}" ] && [ -f .env ]; then
  PORT_VALUE=$(grep -E '^PORT=' .env | tail -1 | cut -d= -f2 | tr -d '[:space:]')
fi
PORT_VALUE="${PORT_VALUE:-8787}"

echo "==> 重启服务"
if command -v pm2 > /dev/null 2>&1 && pm2 describe srdi > /dev/null 2>&1; then
  pm2 restart srdi
else
  echo "命令行没有 pm2 进程 srdi,代码已回滚,请到宝塔「网站 → Node 项目」点【重启】"
  echo ""
  echo "回到线上最新版本:git reset --hard origin/main && bash deploy/update.sh"
  exit 0
fi

echo "==> 健康检查 http://127.0.0.1:${PORT_VALUE}/api/health"
attempt=1
while [ "${attempt}" -le 5 ]; do
  if curl -sf "http://127.0.0.1:${PORT_VALUE}/api/health" > /dev/null; then
    echo ""
    echo "==> 回滚完成,健康检查通过"
    echo "当前代码是快照内容,不在任何 git 提交上。"
    echo "回到线上最新版本:git reset --hard origin/main && bash deploy/update.sh"
    exit 0
  fi
  sleep 2
  attempt=$((attempt + 1))
done

echo ""
echo "==> 健康检查未通过,看日志:pm2 logs srdi --lines 100"
echo "如果需要再退一步:bash deploy/rollback.sh ${SAFETY}"
exit 1
