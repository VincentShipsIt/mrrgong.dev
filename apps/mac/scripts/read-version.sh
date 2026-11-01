#!/usr/bin/env bash
# Prints the app version. Single source of truth: the root package.json "version".
# PACKAGE_JSON overrides the file location (used by tests).
set -euo pipefail

pkg="${PACKAGE_JSON:-$(cd "$(dirname "$0")/../../.." && pwd)/package.json}"
[ -f "$pkg" ] || { echo "package.json not found: $pkg" >&2; exit 1; }

if command -v plutil >/dev/null 2>&1; then
  version="$(plutil -extract version raw -o - "$pkg")"
else
  version="$(sed -n 's/^[[:space:]]*"version":[[:space:]]*"\([^"]*\)".*/\1/p' "$pkg" | head -n 1)"
fi

if [[ ! "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo "package.json version is not canonical MAJOR.MINOR.PATCH: '$version'" >&2
  exit 1
fi
printf '%s\n' "$version"
