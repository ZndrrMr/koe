#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$repo_root/inspo/koe-image-family/sources"
output_dir="$repo_root/assets/illustrations/koe"
task_tmp="$(mktemp -d)"

trap 'rm -rf "$task_tmp"' EXIT

mkdir -p "$output_dir"

make_masked_source() {
  local source_path="$1"
  local width="$2"
  local height="$3"
  local stem="$4"

  magick "$source_path" \
    -gravity center \
    -resize "${width}x${height}^" \
    -extent "${width}x${height}" \
    -colorspace sRGB \
    -strip \
    "$task_tmp/$stem-base.png"

  # The generated sources are cobalt ink on cream. Blue-minus-red cleanly
  # separates their antialiased ink from the warm neutral paper while retaining
  # the deliberately irregular hatch as alpha coverage.
  magick "$task_tmp/$stem-base.png" \
    -fx 'max(0,min(1,3.5*(b-r)))' \
    "$task_tmp/$stem-mask.png"

  magick -size "${width}x${height}" 'xc:#2F5F8F' \
    "$task_tmp/$stem-mask.png" \
    -alpha off \
    -compose CopyOpacity \
    -composite \
    "$task_tmp/$stem-ink.png"
}

place_and_export() {
  local stem="$1"
  local canvas_width="$2"
  local canvas_height="$3"
  local fit_box="$4"
  local gravity="$5"
  local geometry="$6"

  magick "$task_tmp/$stem-ink.png" \
    -trim \
    +repage \
    -resize "$fit_box" \
    "$task_tmp/$stem-subject.png"

  magick -size "${canvas_width}x${canvas_height}" xc:none \
    "$task_tmp/$stem-subject.png" \
    -gravity "$gravity" \
    -geometry "$geometry" \
    -compose Over \
    -composite \
    -colorspace sRGB \
    -strip \
    "$task_tmp/$stem-light.png"

  magick "$task_tmp/$stem-light.png" \
    -channel RGB \
    -fill '#A9C6D5' \
    -colorize 100 \
    -channel RGBA \
    "$task_tmp/$stem-dark.png"

  cwebp -quiet -lossless -z 9 -alpha_filter best \
    "$task_tmp/$stem-light.png" \
    -o "$output_dir/$stem-light.webp"
  cwebp -quiet -lossless -z 9 -alpha_filter best \
    "$task_tmp/$stem-dark.png" \
    -o "$output_dir/$stem-dark.webp"
}

make_masked_source \
  "$source_dir/microphone-education-generated.png" \
  1200 960 microphone-education
place_and_export microphone-education 1200 960 '744x451>' North '+0+173'

make_masked_source \
  "$source_dir/home-start-generated.png" \
  1200 960 home-start
place_and_export home-start 1200 960 '744x451>' North '+0+173'

make_masked_source \
  "$source_dir/recovery-generated-v2.png" \
  600 600 recovery
place_and_export recovery 600 600 '372x372>' Center '+0+0'

make_masked_source \
  "$source_dir/coda-generated.png" \
  1200 960 coda
place_and_export coda 1200 960 '744x614>' Center '+0+0'

echo "Exported Koe production illustration family to $output_dir"
