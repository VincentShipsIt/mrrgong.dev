#!/usr/bin/env bash
# Builds dist/MRRGong.app (release, ad-hoc signed, menu bar only).
set -euo pipefail

cd "$(dirname "$0")/.."
# SwiftUI/AppKit need the full Xcode toolchain, not the Command Line Tools.
XCODE="/Applications/Xcode.app/Contents/Developer"
case "${DEVELOPER_DIR:-}" in
  ""|*CommandLineTools*) [ -d "$XCODE" ] && export DEVELOPER_DIR="$XCODE" ;;
esac

APP="dist/MRRGong.app"
VERSION="${VERSION:-0.1.0}"

swift build -c release
BIN="$(swift build -c release --show-bin-path)/MRRGong"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/MRRGong"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key><string>en</string>
  <key>CFBundleExecutable</key><string>MRRGong</string>
  <key>CFBundleIdentifier</key><string>dev.mrrgong.app</string>
  <key>CFBundleName</key><string>MRR Gong</string>
  <key>CFBundleDisplayName</key><string>MRR Gong</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSUIElement</key><true/>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSAppTransportSecurity</key>
  <dict><key>NSAllowsLocalNetworking</key><true/></dict>
</dict>
</plist>
PLIST

codesign --force --sign - "$APP"
echo "Built $APP"
