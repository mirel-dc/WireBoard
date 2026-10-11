#!/bin/sh
set -eu
wireboard_root=$(CDPATH= cd -P "$(dirname "$0")" && pwd)
wireboard_bin="$wireboard_root/wireboard"
if [ ! -x "$wireboard_bin" ]; then
  wireboard_bin="$wireboard_root/target/release/wireboard"
fi
if [ ! -x "$wireboard_bin" ]; then
  printf '%s\n' 'Wireboard binary is missing. Build with npm run release.' >&2
  exit 1
fi
exec "$wireboard_bin" serve --open "$@"
