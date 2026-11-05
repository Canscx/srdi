#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
PARENT="$(dirname "${ROOT}")"
NAME="$(basename "${ROOT}")"
BACKUP_DIR="${BACKUP_DIR:-/www/backup/srdi}"
KEEP="${KEEP:-10}"

STAMP="$(date +%Y%m%d-%H%M%S)"
SHA="nogit"
if [ -d .git ] && command -v git > /dev/null 2>&1; then
  SHA="$(git rev-parse --short HEAD 2>/dev/null || echo nogit)"
fi

mkdir -p "${BACKUP_DIR}"
FILE="${BACKUP_DIR}/srdi-code-${STAMP}-${SHA}.tar.gz"

echo "备份代码到 ${FILE}" >&2
tar -czf "${FILE}" \
  --exclude='*/node_modules' \
  --exclude='*/data' \
  --exclude='*/release' \
  --exclude='*/dist' \
  --exclude='*/.git' \
  --exclude='*/.tmp' \
  --exclude='*/.workbuddy' \
  --exclude='*/fonts' \
  --exclude='*/.env' \
  --exclude='*.log' \
  -C "${PARENT}" "${NAME}"

if [ ! -s "${FILE}" ]; then
  echo "备份失败,${FILE} 没有生成,已中止" >&2
  exit 1
fi

ls -1t "${BACKUP_DIR}"/srdi-code-*.tar.gz 2>/dev/null | tail -n +$((KEEP + 1)) | while read -r old; do
  rm -f "${old}"
  echo "清理旧备份 $(basename "${old}")" >&2
done

echo "${FILE}"
