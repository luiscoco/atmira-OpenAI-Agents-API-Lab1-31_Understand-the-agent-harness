#!/bin/sh
set -eu
case "${LAB32_NONCE:-}" in *[!a-f0-9]*|'') exit 2;; esac
[ "${#LAB32_NONCE}" -eq 16 ] || exit 2
mkdir -p "$HOME"
printf '{"marker":"%s","item":"course-notebook","quantity":7}\n' "$LAB32_NONCE" > /workspace/inventory.json
unset LAB32_NONCE
node /opt/lab36/mcp.mjs &
private_pid=$!
trap 'kill "$private_pid" 2>/dev/null || true' EXIT INT TERM
node -e 'for(let n=0;n<100;n++){try{let r=await fetch("http://127.0.0.1:8765/mcp");if(r.status===405)process.exit(0)}catch{}await new Promise(r=>setTimeout(r,50))}process.exit(1)' --input-type=module
codex exec-server "$@"
