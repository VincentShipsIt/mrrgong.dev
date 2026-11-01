import AppKit
import MRRGongCore
import SwiftUI

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let settings = AppSettings()
    private var model: AppModel!
    private var widget: WidgetController!
    private var statusItem: StatusItemController!
    private var settingsWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory) // no Dock icon, even when run outside the .app bundle
        installMainMenu()
        model = AppModel(settings: settings, fetcher: MRRClient(), streamer: SSEClient(), player: GongPlayer())
        widget = WidgetController(model: model)
        statusItem = StatusItemController(model: model, widget: widget, openSettings: { [weak self] in self?.showSettings() })
        model.start()
        widget.restore()
    }

    func applicationWillTerminate(_ notification: Notification) {
        model?.stop()
    }

    /// Accessory apps have no menu bar, but text fields still need an Edit menu for ⌘C / ⌘V.
    private func installMainMenu() {
        let main = NSMenu()
        let appItem = NSMenuItem()
        main.addItem(appItem)
        let appMenu = NSMenu()
        appMenu.addItem(withTitle: "Quit MRR Gong", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appItem.submenu = appMenu

        let editItem = NSMenuItem()
        main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        edit.addItem(withTitle: "Cut", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        edit.addItem(withTitle: "Copy", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        edit.addItem(withTitle: "Paste", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        edit.addItem(withTitle: "Select All", action: #selector(NSText.selectAll(_:)), keyEquivalent: "a")
        editItem.submenu = edit
        NSApp.mainMenu = main
    }

    private func showSettings() {
        if let window = settingsWindow {
            window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
            return
        }
        let close: () -> Void = { [weak self] in self?.settingsWindow?.close() }
        let view = SettingsView(settings: settings, onSave: { [weak self] in self?.model.restart() }, onClose: close)
        let host = NSHostingController(rootView: view)
        let window = NSWindow(contentViewController: host)
        window.title = "MRR Gong Settings"
        window.styleMask = [.titled, .closable]
        window.isReleasedWhenClosed = false
        window.center()
        NotificationCenter.default.addObserver(forName: NSWindow.willCloseNotification, object: window, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.settingsWindow = nil }
        }
        settingsWindow = window
        window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }
}
