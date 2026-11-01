import AppKit
import MRRGongCore
import SwiftUI

/// Borderless, always-on-every-Space panel that sits on the desktop (or floats above windows).
@MainActor
final class WidgetController {
    private enum Key {
        static let visible = "widgetVisible"
        static let floating = "widgetFloating"
    }

    private let model: AppModel
    private let defaults: UserDefaults
    private var panel: NSPanel?

    init(model: AppModel, defaults: UserDefaults = .standard) {
        self.model = model
        self.defaults = defaults
    }

    var isVisible: Bool { panel?.isVisible ?? false }
    var isFloating: Bool { defaults.bool(forKey: Key.floating) }

    func restore() {
        if defaults.bool(forKey: Key.visible) { show() }
    }

    func toggle() { isVisible ? hide() : show() }

    func show() {
        let panel = self.panel ?? makePanel()
        self.panel = panel
        applyLevel(to: panel)
        panel.orderFrontRegardless()
        defaults.set(true, forKey: Key.visible)
    }

    func hide() {
        panel?.orderOut(nil)
        defaults.set(false, forKey: Key.visible)
    }

    func setFloating(_ floating: Bool) {
        defaults.set(floating, forKey: Key.floating)
        if floating, !isVisible { show() } else if let panel { applyLevel(to: panel) }
    }

    private func applyLevel(to panel: NSPanel) {
        if isFloating {
            panel.level = .floating
        } else {
            panel.level = NSWindow.Level(rawValue: Int(CGWindowLevelForKey(.desktopIconWindow)) + 1)
        }
        panel.isFloatingPanel = isFloating
    }

    private func makePanel() -> NSPanel {
        let panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: Theme.width + 40, height: 300),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = true
        panel.isMovableByWindowBackground = true
        panel.hidesOnDeactivate = false
        panel.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
        panel.isReleasedWhenClosed = false

        let host = NSHostingController(rootView: WidgetView(model: model, onHide: { [weak self] in self?.hide() }))
        host.sizingOptions = [.preferredContentSize]
        panel.contentViewController = host

        if !panel.setFrameUsingName("MRRGongWidget"), let screen = NSScreen.main {
            let f = screen.visibleFrame
            panel.setFrameOrigin(NSPoint(x: f.maxX - panel.frame.width - 16, y: f.maxY - panel.frame.height - 16))
        }
        panel.setFrameAutosaveName("MRRGongWidget")
        return panel
    }
}
