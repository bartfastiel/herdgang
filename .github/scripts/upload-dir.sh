#!/usr/bin/env bash
# Uploads a directory via tar over SSH and swaps it in atomically on the server.
#   upload-dir.sh <local dir> <user@host> <remote dir>
set -euo pipefail
local_dir="$1" target="$2" remote_dir="$3"
tar -C "$local_dir" -czf - . | ssh "$target" "set -e
  rm -rf '$remote_dir.new' '$remote_dir.old'
  mkdir -p '$remote_dir.new'
  tar -C '$remote_dir.new' -xzf -
  [ ! -e '$remote_dir' ] || mv '$remote_dir' '$remote_dir.old'
  mv '$remote_dir.new' '$remote_dir'
  rm -rf '$remote_dir.old'"
