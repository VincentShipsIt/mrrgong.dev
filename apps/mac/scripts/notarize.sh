#!/usr/bin/env bash
# Notarizes a signed app and staples the ticket.
#
#   notarize.sh dist/MRRGong.app
#
# Needs APPLE_ID, APPLE_TEAM_ID and APPLE_APP_PASSWORD (an app-specific
# password) in the environment. Nothing is echoed.
set -euo pipefail

app="${1:-}"
[ -d "$app" ] || { echo "Usage: $0 path/to/MRRGong.app" >&2; exit 64; }
: "${APPLE_ID:?APPLE_ID is not set}"
: "${APPLE_TEAM_ID:?APPLE_TEAM_ID is not set}"
: "${APPLE_APP_PASSWORD:?APPLE_APP_PASSWORD is not set}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

ditto -c -k --keepParent "$app" "$work/notarize.zip"

# notarytool exits 0 for a rejected submission, so read the status explicitly.
xcrun notarytool submit "$work/notarize.zip" \
  --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD" \
  --wait --output-format json > "$work/result.json"
status="$(plutil -extract status raw -o - "$work/result.json")"
id="$(plutil -extract id raw -o - "$work/result.json")"

if [ "$status" != "Accepted" ]; then
  echo "Notarization finished with status '$status' (submission $id). Log:" >&2
  xcrun notarytool log "$id" \
    --apple-id "$APPLE_ID" --team-id "$APPLE_TEAM_ID" --password "$APPLE_APP_PASSWORD" >&2 || true
  exit 1
fi

xcrun stapler staple "$app"
xcrun stapler validate "$app"
echo "Notarized and stapled $app (submission $id)"
