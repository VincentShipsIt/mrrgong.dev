import AppKit
import Combine
import MRRGongCore
import SwiftUI

@MainActor
final class StatusItemController: NSObject {
    private let model: AppModel
    private let widget: WidgetController
    private let openSettings: () -> Void
    private let statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private let popover = NSPopover()
    private var cancellables = Set<AnyCancellable>()
    private var flashTask: Task<Void, Never>?
    private var highlighted = false

    init(model: AppModel, widget: WidgetController, openSettings: @escaping () -> Void) {
        self.model = model
        self.widget = widget
        self.openSettings = openSettings
        super.init()

        popover.behavior = .transient
        popover.animates = true
        popover.appearance = NSAppearance(named: .darkAqua)
        let host = NSHostingController(rootView: PopoverView(model: model))
        host.sizingOptions = [.preferredContentSize]
        popover.contentViewController = host

        if let button = statusItem.button {
            button.target = self
            button.action = #selector(clicked(_:))
            button.sendAction(on: [.leftMouseUp, .rightMouseUp])
            button.imagePosition = .imageLeading
            button.imageHugsTitle = true
        }
        render()

        // objectWillChange fires before the value changes; hop to the next runloop turn.
        model.objectWillChange
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.render() }
            .store(in: &cancellables)
        model.$flashCount
            .dropFirst()
            .receive(on: DispatchQueue.main)
            .sink { [weak self] _ in self?.flash() }
            .store(in: &cancellables)
    }

    // MARK: Rendering

    private func render() {
        guard let button = statusItem.button else { return }
        let symbol = model.status == .live ? "bell.fill" : "bell.slash.fill"
        let image = NSImage(systemSymbolName: symbol, accessibilityDescription: "MRR gong")
        image?.isTemplate = true
        button.image = image
        applyTitle(highlighted: highlighted)
    }

    private func applyTitle(highlighted: Bool) {
        guard let button = statusItem.button else { return }
        let color: NSColor = highlighted ? NSColor(Theme.gold) : .labelColor
        button.attributedTitle = NSAttributedString(
            string: " " + model.menuBarTitle,
            attributes: [
                .font: NSFont.monospacedDigitSystemFont(ofSize: 13, weight: .medium),
                .foregroundColor: color,
            ]
        )
        button.contentTintColor = highlighted ? NSColor(Theme.gold) : nil
    }

    /// Three quick gold blinks on every strike.
    private func flash() {
        flashTask?.cancel()
        flashTask = Task { @MainActor [weak self] in
            for _ in 0..<3 {
                self?.highlighted = true
                self?.applyTitle(highlighted: true)
                try? await Task.sleep(nanoseconds: 220_000_000)
                self?.highlighted = false
                self?.applyTitle(highlighted: false)
                if Task.isCancelled { return }
                try? await Task.sleep(nanoseconds: 160_000_000)
            }
        }
    }

    // MARK: Clicks

    @objc private func clicked(_ sender: NSStatusBarButton) {
        if NSApp.currentEvent?.type == .rightMouseUp {
            popover.performClose(nil)
            showMenu()
        } else {
            togglePopover(sender)
        }
    }

    private func togglePopover(_ button: NSStatusBarButton) {
        if popover.isShown {
            popover.performClose(nil)
        } else {
            popover.show(relativeTo: button.bounds, of: button, preferredEdge: .minY)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    private func showMenu() {
        let menu = NSMenu()
        menu.addItem(item("Strike test gong", #selector(strikeTest)))
        menu.addItem(.separator())
        menu.addItem(item("Show as desktop widget", #selector(toggleWidget), checked: widget.isVisible))
        menu.addItem(item("Float on top", #selector(toggleFloat), checked: widget.isFloating))
        menu.addItem(item("Open gong wall", #selector(openGongWall)))
        menu.addItem(.separator())
        menu.addItem(item("Mute sound", #selector(toggleMute), checked: model.isMuted))
        menu.addItem(item("Settings…", #selector(settings), key: ","))
        menu.addItem(.separator())
        menu.addItem(item("Quit MRR Gong", #selector(quit), key: "q"))
        // Attaching the menu only for this click keeps left-click free for the popover.
        statusItem.menu = menu
        statusItem.button?.performClick(nil)
        statusItem.menu = nil
    }

    private func item(_ title: String, _ action: Selector, key: String = "", checked: Bool = false) -> NSMenuItem {
        let i = NSMenuItem(title: title, action: action, keyEquivalent: key)
        i.target = self
        i.state = checked ? .on : .off
        return i
    }

    @objc private func strikeTest() { model.strikeTest() }
    @objc private func toggleWidget() { widget.toggle() }
    @objc private func toggleFloat() { widget.setFloating(!widget.isFloating) }
    @objc private func toggleMute() { model.toggleMute() }
    @objc private func settings() { openSettings() }
    @objc private func quit() { NSApp.terminate(nil) }

    @objc private func openGongWall() {
        guard let url = try? model.config.url(path: "gong") else { return NSSound.beep() }
        NSWorkspace.shared.open(url)
    }
}
