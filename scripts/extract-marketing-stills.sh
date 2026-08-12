#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
video_path="${1:-$repo_root/marketing/generated/koe-app-preview.mp4}"
output_dir="$repo_root/marketing/generated"

command -v ffmpeg >/dev/null || {
  echo "ffmpeg is required to extract Koe's App Store stills." >&2
  exit 1
}
command -v magick >/dev/null || {
  echo "ImageMagick is required to compose Koe's contact sheet." >&2
  exit 1
}
test -f "$video_path" || {
  echo "Capture video not found: $video_path" >&2
  exit 1
}

mkdir -p "$output_dir"

extract_frame() {
  local timestamp="$1"
  local filename="$2"
  ffmpeg -loglevel error -y -ss "$timestamp" -i "$video_path" \
    -frames:v 1 "$output_dir/$filename"
}

# Center each still inside its canonical beat in the 13-second silent preview.
extract_frame 0.4 app-store-01-speak.png
extract_frame 2.6 app-store-02-hear.png
extract_frame 5.4 app-store-03-tune.png
extract_frame 8.7 app-store-04-retry.png
extract_frame 11.1 app-store-05-keep.png

magick \
  "$output_dir/app-store-01-speak.png" -resize 241x524 \
  "$output_dir/app-store-02-hear.png" -resize 241x524 \
  "$output_dir/app-store-03-tune.png" -resize 241x524 \
  "$output_dir/app-store-04-retry.png" -resize 241x524 \
  "$output_dir/app-store-05-keep.png" -resize 241x524 \
  +append "$output_dir/app-store-story-contact-sheet.png"

echo "Extracted five App Store stills and the story contact sheet."
