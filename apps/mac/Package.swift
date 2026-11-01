// swift-tools-version:6.0
import PackageDescription

let package = Package(
    name: "MRRGong",
    platforms: [.macOS(.v14)],
    products: [
        .executable(name: "MRRGong", targets: ["MRRGong"]),
        .library(name: "MRRGongCore", targets: ["MRRGongCore"]),
    ],
    targets: [
        // Everything testable and UI-free: models, SSE, formatting, history, gong synthesis, app state.
        .target(name: "MRRGongCore", swiftSettings: [.swiftLanguageMode(.v5)]),
        // AppKit/SwiftUI shell: status item, popover, widget, settings.
        .executableTarget(name: "MRRGong", dependencies: ["MRRGongCore"], swiftSettings: [.swiftLanguageMode(.v5)]),
        .testTarget(name: "MRRGongCoreTests", dependencies: ["MRRGongCore"], swiftSettings: [.swiftLanguageMode(.v5)]),
    ]
)
