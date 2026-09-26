import AppKit
import SwiftUI
import TrackifyKit

/// Menu-bar item (running task + elapsed) and the drop-down panel.
@MainActor
final class StatusItemController: NSObject, NSWindowDelegate {
    let model: AppModel
    let openDashboard: (AppScreen?) -> Void
    private let item = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
    private var panel: MenuPanelWindow?
    private var testWindow: NSWindow?
    private var ticker: Timer?
    private var outsideMonitor: Any?
    private var lastTitle = ""

    init(model: AppModel, openDashboard: @escaping (AppScreen?) -> Void) {
        self.model = model
        self.openDashboard = openDashboard
        super.init()
        if let b = item.button {
            b.target = self
            b.action = #selector(clicked)
            b.sendAction(on: [.leftMouseUp, .rightMouseUp])
            b.imagePosition = .imageLeading
            b.setAccessibilityLabel("Trackify")
        }
        updateLabel()
        ticker = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.updateLabel() }
        }
        model.timerObservers.append { [weak self] _ in Task { @MainActor in self?.updateLabel() } }
    }

    // MARK: Label

    func updateLabel() {
        guard let b = item.button else { return }
        let d = AppGroup.defaults
        if let r = model.running {
            let showSeconds = d.bool(forKey: SharedKeys.menuBarShowSeconds)
            let hideName = d.bool(forKey: SharedKeys.menuBarHideName)
            let elapsed = max(0, Date().ms - r.startTime)
            let time = showSeconds ? Fmt.duration(elapsed) : Fmt.hoursMinutes(elapsed)
            var name = model.task(r.taskId)?.name ?? SnapshotStore.shared.load().running?.taskName ?? ""
            if name.count > 18 { name = String(name.prefix(17)) + "…" }
            let title = hideName || name.isEmpty ? " \(time)" : " \(name)  \(time)"
            if title != lastTitle || b.image?.isTemplate != false {
                b.image = Self.dot(color: r.pending ? NSColor(rgb: 0xF59E0B) : NSColor(rgb: 0x22C55E))
                let font = NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .regular)
                b.attributedTitle = NSAttributedString(string: title, attributes: [.font: font])
                lastTitle = title
            }
            b.setAccessibilityValue("Tracking \(name), \(Fmt.durationWords(elapsed))")
        } else {
            if lastTitle != "" || b.image?.isTemplate != true {
                b.image = Self.idleGlyph
                b.attributedTitle = NSAttributedString(string: "")
                lastTitle = ""
            }
            b.setAccessibilityValue("Idle")
        }
    }

    static func dot(color: NSColor) -> NSImage {
        let img = NSImage(size: NSSize(width: 10, height: 16), flipped: false) { rect in
            color.setFill()
            NSBezierPath(ovalIn: NSRect(x: 1, y: 4, width: 8, height: 8)).fill()
            return true
        }
        img.isTemplate = false
        return img
    }

    /// Template glyph: rounded square outline with a "T" and the dot.
    static let idleGlyph: NSImage = {
        let img = NSImage(size: NSSize(width: 18, height: 16), flipped: false) { _ in
            NSColor.black.setStroke()
            NSColor.black.setFill()
            let box = NSBezierPath(roundedRect: NSRect(x: 1.5, y: 1.5, width: 14, height: 13), xRadius: 3.5, yRadius: 3.5)
            box.lineWidth = 1.4
            box.stroke()
            let t = NSBezierPath()
            t.lineWidth = 1.8
            t.move(to: NSPoint(x: 5, y: 11)); t.line(to: NSPoint(x: 11, y: 11))
            t.move(to: NSPoint(x: 8, y: 11)); t.line(to: NSPoint(x: 8, y: 4.5))
            t.stroke()
            NSBezierPath(ovalIn: NSRect(x: 11, y: 3.5, width: 3, height: 3)).fill()
            return true
        }
        img.isTemplate = true
        return img
    }()

    // MARK: Panel

    @objc private func clicked() {
        if NSApp.currentEvent?.type == .rightMouseUp {
            showContextMenu()
        } else {
            togglePanel()
        }
    }

    private func showContextMenu() {
        let menu = NSMenu()
        menu.addItem(withTitle: "Open Dashboard", action: #selector(menuOpenDashboard), keyEquivalent: "d").target = self
        if model.running != nil {
            menu.addItem(withTitle: "Stop Timer", action: #selector(menuStop), keyEquivalent: ".").target = self
        }
        menu.addItem(.separator())
        menu.addItem(withTitle: "Quit Trackify", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        item.menu = menu
        item.button?.performClick(nil)
        item.menu = nil
    }

    @objc private func menuOpenDashboard() { openDashboard(nil) }
    @objc private func menuStop() { model.stop() }

    func togglePanel() {
        if let p = panel, p.isVisible { closePanel() } else { showPanel() }
    }

    func showPanel() {
        let p = panel ?? makePanel()
        panel = p
        positionPanel(p)
        p.alphaValue = 0
        p.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        NSAnimationContext.runAnimationGroup { ctx in
            ctx.duration = 0.12
            p.animator().alphaValue = 1
        }
        item.button?.highlight(true)
        outsideMonitor = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in
            Task { @MainActor in
                guard let self, let p = self.panel, p.attachedSheet == nil, p.childWindows?.isEmpty ?? true else { return }
                self.closePanel()
            }
        }
        NotificationCenter.default.post(name: .trackifyPanelOpened, object: nil)
    }

    func closePanel() {
        guard let p = panel else { return }
        if let m = outsideMonitor { NSEvent.removeMonitor(m); outsideMonitor = nil }
        item.button?.highlight(false)
        NSAnimationContext.runAnimationGroup({ ctx in
            ctx.duration = 0.1
            p.animator().alphaValue = 0
        }, completionHandler: {
            Task { @MainActor in p.orderOut(nil) }
        })
    }

    private func makePanel() -> MenuPanelWindow {
        let root = MenuPanelView(
            close: { [weak self] in self?.closePanel() },
            openDashboard: { [weak self] screen in self?.closePanel(); self?.openDashboard(screen) })
            .environment(model)
        let host = NSHostingController(rootView: root)
        let p = MenuPanelWindow(contentViewController: host)
        p.onEscape = { [weak self] in self?.closePanel() }
        return p
    }

    private func positionPanel(_ p: NSWindow) {
        guard let button = item.button, let bw = button.window else { return }
        let r = bw.convertToScreen(button.convert(button.bounds, to: nil))
        let size = p.frame.size
        let screen = bw.screen ?? NSScreen.main
        var x = r.midX - size.width / 2
        if let vf = screen?.visibleFrame { x = min(max(vf.minX + 8, x), vf.maxX - size.width - 8) }
        p.setFrameTopLeftPoint(NSPoint(x: x, y: r.minY - 6))
    }

    /// DEBUG/screenshot: the panel content in a normal titled window.
    func showPanelAsWindow() {
        let root = MenuPanelView(close: {}, openDashboard: { [weak self] s in self?.openDashboard(s) }).environment(model)
        let host = NSHostingController(rootView: root)
        let w = NSWindow(contentViewController: host)
        w.title = "Trackify Panel"
        w.styleMask = [.titled, .closable]
        w.setContentSize(NSSize(width: 360, height: 560))
        w.center()
        w.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        testWindow = w
    }
}

extension Notification.Name {
    static let trackifyPanelOpened = Notification.Name("trackify.panelOpened")
}

/// Borderless floating panel that can take keyboard focus (search field).
final class MenuPanelWindow: NSPanel {
    var onEscape: (() -> Void)?

    init(contentViewController: NSViewController) {
        super.init(contentRect: NSRect(x: 0, y: 0, width: 360, height: 560),
                   styleMask: [.borderless, .nonactivatingPanel, .fullSizeContentView], backing: .buffered, defer: false)
        self.contentViewController = contentViewController
        isFloatingPanel = true
        level = .popUpMenu
        hidesOnDeactivate = false
        isOpaque = false
        backgroundColor = .clear
        hasShadow = true
        isMovable = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        if let v = contentViewController.view as NSView? {
            v.wantsLayer = true
            v.layer?.cornerRadius = 12
            v.layer?.masksToBounds = true
        }
        setContentSize(NSSize(width: 360, height: 560))
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func cancelOperation(_ sender: Any?) { onEscape?() }
}
