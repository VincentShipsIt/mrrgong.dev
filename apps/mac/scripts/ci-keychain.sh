#!/usr/bin/env bash
# Temporary keychain for Developer ID signing in CI.
#
#   ci-keychain.sh create <keychain-path>   prints the signing identity (SHA-1) on stdout
#   ci-keychain.sh delete <keychain-path>
#
# create reads MACOS_CERT_P12_BASE64 and MACOS_CERT_PASSWORD from the
# environment. Secrets are never printed; the keychain password is random and
# only lives in this process.
set -euo pipefail

cmd="${1:-}"
keychain="${2:-}"
if [ -z "$keychain" ] || { [ "$cmd" != create ] && [ "$cmd" != delete ]; }; then
  echo "Usage: $0 create|delete <keychain-path>" >&2
  exit 64
fi

if [ "$cmd" = delete ]; then
  security delete-keychain "$keychain" 2>/dev/null || true
  rm -f "$keychain"
  exit 0
fi

: "${MACOS_CERT_P12_BASE64:?MACOS_CERT_P12_BASE64 is not set}"
: "${MACOS_CERT_PASSWORD:?MACOS_CERT_PASSWORD is not set}"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
printf '%s' "$MACOS_CERT_P12_BASE64" | base64 --decode > "$work/cert.p12"
keychain_password="$(openssl rand -hex 24)"

security create-keychain -p "$keychain_password" "$keychain" >&2
# No auto-lock while the job runs (6 hours max).
security set-keychain-settings -lut 21600 "$keychain" >&2
security unlock-keychain -p "$keychain_password" "$keychain" >&2
security import "$work/cert.p12" -k "$keychain" -P "$MACOS_CERT_PASSWORD" \
  -T /usr/bin/codesign -T /usr/bin/security >&2
security set-key-partition-list -S apple-tool:,apple:,codesign: -s \
  -k "$keychain_password" "$keychain" >/dev/null 2>&1
# Make codesign find the keychain (keep the existing search list).
# shellcheck disable=SC2046
security list-keychains -d user -s "$keychain" $(security list-keychains -d user | tr -d '"') >&2

identity="$(security find-identity -v -p codesigning "$keychain" \
  | sed -n 's/^ *[0-9]*) \([0-9A-F]\{40\}\) "Developer ID Application:.*/\1/p' | head -n 1)"
if [ -z "$identity" ]; then
  echo "No 'Developer ID Application' identity found in the imported certificate." >&2
  exit 1
fi
printf '%s\n' "$identity"
