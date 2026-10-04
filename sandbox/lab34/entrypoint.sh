#!/bin/sh
set -eu
case "${LAB32_NONCE:-}" in *[!a-f0-9]*|'') exit 2;; esac
[ "${#LAB32_NONCE}" -eq 16 ] || exit 2
mkdir -p /workspace/data "$HOME"
# Vary the data per run so a remembered sample total cannot pass.
units=$(( $(printf '%d' "0x$(printf '%s' "$LAB32_NONCE" | cut -c1-2)") % 9 + 1 ))
printf 'product,units,price_cents\nbook,%s,1200\npen,8,200\n' "$units" > /workspace/data/sales.csv
printf '%s\n' "$LAB32_NONCE" > /workspace/run-marker.txt
unset LAB32_NONCE
exec codex exec-server "$@"
