#!/usr/bin/env bash
# Fills the Homebrew cask template.
#
#   render-cask.sh <version> <sha256> <output.rb>
set -euo pipefail

[ "$#" -eq 3 ] || { echo "Usage: $0 <version> <sha256> <output.rb>" >&2; exit 64; }
version="$1"; sha256="$2"; out="$3"

[[ "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]] \
  || { echo "version must be MAJOR.MINOR.PATCH, got '$version'" >&2; exit 64; }
[[ "$sha256" =~ ^[0-9a-f]{64}$ ]] \
  || { echo "sha256 must be 64 lowercase hex characters" >&2; exit 64; }

template="$(dirname "$0")/../packaging/mrr-gong.rb"
sed -e "s/__VERSION__/$version/" -e "s/__SHA256__/$sha256/" "$template" > "$out"

if grep -q '__[A-Z0-9_]*__' "$out"; then
  echo "Unfilled placeholder left in $out" >&2
  exit 1
fi
