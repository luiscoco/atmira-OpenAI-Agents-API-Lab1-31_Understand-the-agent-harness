#!/bin/sh
set -eu
case "${LAB32_NONCE:-}" in *[!a-f0-9]*|'') exit 2;; esac
[ "${#LAB32_NONCE}" -eq 16 ] || exit 2
mkdir -p /workspace/data "$HOME"
printf 'Lab 32 disposable workspace\n' > /workspace/.course-marker
printf 'List regular files, including hidden files. Read the run marker.\n' > /workspace/brief.txt
printf 'product,units\nbook,3\npen,8\n' > /workspace/data/sales.csv
printf '%s\n' "$LAB32_NONCE" > "/workspace/run-$LAB32_NONCE.txt"
unset LAB32_NONCE
exec codex exec-server "$@"
