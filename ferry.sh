#!/bin/sh
set -e
DIR=$(CDPATH= cd -- "$(dirname "$0")" && pwd)
BIN="$DIR/bin/ferry"
MAIN="$DIR/main.ts"
if [ -x "$BIN" ]; then
  exec "$BIN" "$@"
fi
if command -v deno >/dev/null 2>&1 && [ -f "$MAIN" ]; then
  exec deno run --allow-read --allow-write "$MAIN" "$@"
fi
echo "No compiled binary at $BIN and Deno is not on PATH." >&2
echo "On a connected machine: deno task compile" >&2
exit 1
