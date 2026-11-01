#!/usr/bin/env bash
# Validates a release tag and prints the bare version on success.
#
#   validate-release-tag.sh vMAJOR.MINOR.PATCH [--app dist/MRRGong.app]
#
# The tag must be canonical stable SemVer and equal the version in package.json
# (the single source of truth, see read-version.sh). With --app, the built
# bundle's Info.plist CFBundleShortVersionString and CFBundleVersion must match
# too, so a tag can never ship an app that reports a different version.
set -euo pipefail

usage() { echo "Usage: $0 vMAJOR.MINOR.PATCH [--app path/to/MRRGong.app]" >&2; exit 64; }

[ "$#" -eq 1 ] || { [ "$#" -eq 3 ] && [ "$2" = "--app" ]; } || usage
tag="$1"
app="${3:-}"

# Only canonical, stable SemVer tags. This also keeps every value later used in
# a filename, URL or output free of shell metacharacters.
if [[ ! "$tag" =~ ^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$ ]]; then
  echo "Release tag must match canonical vMAJOR.MINOR.PATCH syntax." >&2
  exit 64
fi
version="${tag#v}"

source_version="$("$(dirname "$0")/read-version.sh")"
if [ "$source_version" != "$version" ]; then
  echo "Tag $tag does not match package.json version $source_version. Bump package.json first." >&2
  exit 1
fi

if [ -n "$app" ]; then
  plist="$app/Contents/Info.plist"
  [ -f "$plist" ] || { echo "Info.plist not found: $plist" >&2; exit 1; }
  for key in CFBundleShortVersionString CFBundleVersion; do
    actual="$(plutil -extract "$key" raw -o - "$plist")"
    if [ "$actual" != "$version" ]; then
      echo "$key is $actual in $plist, expected $version." >&2
      exit 1
    fi
  done
fi

printf '%s\n' "$version"
