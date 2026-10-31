#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output_dir=$(CDPATH= cd -- "$project_dir/.." && pwd)/outputs
archive="$output_dir/chatgpt-image-cleaner.zip"

mkdir -p "$output_dir"
rm -f "$archive"
cd "$project_dir/.."
zip -qr "$archive" chatgpt-image-cleaner \
  -x "chatgpt-image-cleaner/node_modules/*" \
     "chatgpt-image-cleaner/tests/*" \
     "chatgpt-image-cleaner/package-lock.json" \
     "chatgpt-image-cleaner/scripts/*"
printf '%s\n' "$archive"
