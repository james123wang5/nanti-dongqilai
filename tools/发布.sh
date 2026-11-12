#!/bin/bash
# 把「难题」同步到公开仓库的本地副本，再提交、推送到 GitHub。
# 用法：bash 难题/tools/发布.sh "这次更新的说明"
# 只同步代码、题库、提示词、测试脚本和说明；实测记录、评审记录、测试跑出来的结果不进公开仓库。
set -euo pipefail
src="$(cd "$(dirname "$0")/.." && pwd)"
dst="${NANTI_PUBLIC_DIR:-$src/../../nanti-dongqilai}"
msg="${1:-同步更新}"
[ -d "$dst/.git" ] || { echo "找不到公开仓库副本：$dst"; exit 1; }
rsync -a --delete \
  --exclude '.git/' --exclude 'node_modules/' --exclude 'dist/' --exclude '.DS_Store' --exclude '._*' \
  --exclude '/实测/' --exclude '/评审/' --exclude '/难题/' --exclude '/给Fable的评审任务.md' --exclude '/续做说明.md' --exclude '/上线和测试说明.md' \
  --exclude '/tests/*结果/' --exclude '/tests/*日志/' --exclude '/tests/质检/结果/' \
  "$src/" "$dst/"
cp "$src/tools/公开仓库.gitignore" "$dst/.gitignore"
cd "$dst"
git add -A
if git diff --cached --quiet; then echo "没有变化，不用提交"; exit 0; fi
git commit -q -m "$msg"
git push -q -u origin main
echo "已推送：$(git remote get-url origin)"
