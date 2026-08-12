#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
command -v magick >/dev/null || {
  echo "ImageMagick is required to render Koe's icon." >&2
  exit 1
}

magick \
  -background '#172220' \
  "$repo_root/assets/koe-icon.svg" \
  -alpha off \
  -resize 1024x1024 \
  -depth 8 \
  "$repo_root/assets/icon.png"

echo "Rendered assets/icon.png at 1024×1024, sRGB, without alpha."
