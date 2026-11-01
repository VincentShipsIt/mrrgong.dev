# Template: scripts/render-cask.sh fills __VERSION__ and __SHA256__ on release.
# The release workflow uploads the filled copy as a release asset and, when a
# HOMEBREW_TAP_TOKEN secret exists, proposes it to VincentShipsIt/homebrew-tap.
cask "mrr-gong" do
  version "__VERSION__"
  sha256 "__SHA256__"

  url "https://github.com/VincentShipsIt/mrrgong.dev/releases/download/v#{version}/MRRGong-v#{version}.zip"
  name "MRR Gong"
  desc "Menu bar app that strikes a gong whenever Stripe lands a sale"
  homepage "https://mrrgong.dev/"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :sonoma"

  app "MRRGong.app"

  zap trash: [
    "~/Library/Application Support/mrrgong",
    "~/Library/Preferences/dev.mrrgong.app.plist",
  ]
end
