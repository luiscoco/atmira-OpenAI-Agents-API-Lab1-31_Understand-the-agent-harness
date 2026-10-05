#!/bin/sh
set -eu
case "${LAB32_NONCE:-}" in *[!a-f0-9]*|'') exit 2;; esac
[ "${#LAB32_NONCE}" -eq 16 ] || exit 2
mkdir -p /workspace/data "$HOME"
printf 'workspace_%s\n' "$LAB32_NONCE" > /workspace/data/allowed.txt
printf '%s\n' "$LAB32_NONCE" > /workspace/run-marker.txt
ln -s /protected/course-private.txt /workspace/private-link
unset LAB32_NONCE
exec codex exec-server "$@"
