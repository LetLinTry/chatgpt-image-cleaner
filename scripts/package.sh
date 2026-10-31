#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output_dir=$(CDPATH= cd -- "$project_dir/.." && pwd)/outputs
archive="$output_dir/chatgpt-image-cleaner.zip"

mkdir -p "$output_dir"
rm -f "$archive"
cd "$project_dir/.."
# 排除开发用文件，只把扩展运行所需内容打进 zip。
# .git 必须排除：否则从仓库克隆后打出来的 zip 会把整个提交历史带进去。
zip -qr "$archive" chatgpt-image-cleaner \
  -x "chatgpt-image-cleaner/.git/*" \
     "chatgpt-image-cleaner/.gitignore" \
     "chatgpt-image-cleaner/node_modules/*" \
     "chatgpt-image-cleaner/tests/*" \
     "chatgpt-image-cleaner/test/*" \
     "chatgpt-image-cleaner/package-lock.json" \
     "chatgpt-image-cleaner/package.json" \
     "chatgpt-image-cleaner/scripts/*" \
     "chatgpt-image-cleaner/LICENSE" \
     "chatgpt-image-cleaner/README.md" \
     "chatgpt-image-cleaner/docs/*" \
     "chatgpt-image-cleaner/*.zip"
printf '%s\n' "$archive"
