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
        model.timerObservers.append { [weak self] _ in Task { @MainActor in self?.updateLabel() } }
        NotificationCenter.default.addObserver(forName: UserDefaults.didChangeNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.updateLabel() }
        }
    }

    /// Re-arm a one-shot timer for the next visible change: next second with seconds on,
    /// otherwise the next whole elapsed minute (keeps idle CPU near zero).
    private func scheduleNextTick() {
        ticker?.invalidate()
        guard let r = model.running else { return }
        let showSeconds = AppGroup.defaults.bool(forKey: SharedKeys.menuBarShowSeconds)
        let elapsed = max(0, Date().ms - r.startTime)
        let unit: Int64 = showSeconds ? 1000 : 60_000
        let wait = Double(unit - elapsed % unit) / 1000 + 0.02
        let t = Timer(timeInterval: wait, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.updateLabel() }
        }
        t.tolerance = showSeconds ? 0.05 : 0.5
        RunLoop.main.add(t, forMode: .common)
        ticker = t
    }

    // MARK: Label

    func updateLabel() {
        defer { scheduleNextTick() }
        guard let b = item.button else { return }
        if let r = model.running {
            let showSeconds = AppGroup.defaults.bool(forKey: SharedKeys.menuBarShowSeconds)
            let elapsed = max(0, Date().ms - r.startTime)
            let label = Self.label(elapsed: elapsed, showSeconds: showSeconds, pending: r.pending)
            if label.string != lastTitle || b.image !== Self.glyph {
                b.image = Self.glyph
                b.attributedTitle = label
                lastTitle = label.string
            }
            let name = model.task(r.taskId)?.name ?? SnapshotStore.shared.load().running?.taskName ?? ""
            b.setAccessibilityValue("Tracking \(name), \(Fmt.durationWords(elapsed))")
        } else {
            if lastTitle != "" || b.image !== Self.glyph {
                b.image = Self.glyph
                b.attributedTitle = NSAttributedString(string: "")
                lastTitle = ""
            }
            b.setAccessibilityValue("Idle")
        }
    }

    /// Running label: a small green (amber while syncing) dot + elapsed `h:mm` (or `h:mm:ss`). The task name only
    /// appears in the panel, so the item stays a compact bubble.
    static func label(elapsed: Int64, showSeconds: Bool, pending: Bool) -> NSAttributedString {
        let secs = Int(elapsed / 1000)
        let time = showSeconds ? String(format: "%d:%02d:%02d", secs / 3600, secs / 60 % 60, secs % 60) : Fmt.hoursMinutes(elapsed)
        let s = NSMutableAttributedString()
        s.append(NSAttributedString(string: " ●", attributes: [
            .font: NSFont.systemFont(ofSize: 8),
            .foregroundColor: pending ? NSColor(rgb: 0xF59E0B) : NSColor(rgb: 0x22C55E),
            .baselineOffset: 2,
        ]))
        s.append(NSAttributedString(string: " " + time, attributes: [
            .font: NSFont.monospacedDigitSystemFont(ofSize: NSFont.systemFontSize, weight: .regular),
        ]))
        return s
    }

    /// Template "T" glyph: a rounded square with the T cut out (reads at 16–18 pt, follows the menu bar tint).
    static let glyph: NSImage = {
        let img = NSImage(size: NSSize(width: 16, height: 16), flipped: false) { _ in
            guard let ctx = NSGraphicsContext.current?.cgContext else { return false }
            NSColor.black.setFill()
            NSBezierPath(roundedRect: NSRect(x: 1, y: 1, width: 14, height: 14), xRadius: 4, yRadius: 4).fill()
            ctx.setBlendMode(.clear)
            NSBezierPath(roundedRect: NSRect(x: 4, y: 9.6, width: 8, height: 2.2), xRadius: 0.6, yRadius: 0.6).fill()
            NSBezierPath(roundedRect: NSRect(x: 6.9, y: 3.6, width: 2.2, height: 7), xRadius: 0.6, yRadius: 0.6).fill()
            return true
        }
        img.isTemplate = true
        img.accessibilityDescription = "Trackify"
        return img
    }()

    #if DEBUG
    /// Test hook `-TrackifyRenderMenuBar <dir>`: the status item (running / running with seconds / idle) on a
    /// light and a dark menu-bar strip, drawn off-screen by AppKit.
    static func renderPreviews(to dir: String) {
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let cases: [(String, NSAttributedString?)] = [
            ("running", label(elapsed: 30 * 60_000, showSeconds: false, pending: false)),
            ("running-long", label(elapsed: (2 * 60 + 47) * 60_000, showSeconds: false, pending: false)),
            ("running-seconds", label(elapsed: 30 * 60_000 + 12_000, showSeconds: true, pending: false)),
            ("syncing", label(elapsed: 5 * 60_000, showSeconds: false, pending: true)),
            ("idle", nil),
        ]
        for dark in [false, true] {
            for (name, title) in cases {
                let bar = NSView(frame: NSRect(x: 0, y: 0, width: 220, height: 24))
                bar.appearance = NSAppearance(named: dark ? .darkAqua : .aqua)
                bar.wantsLayer = true
                bar.layer?.backgroundColor = (dark ? NSColor(white: 0.16, alpha: 1) : NSColor(white: 0.93, alpha: 1)).cgColor
                let b = NSButton(frame: .zero)
                b.isBordered = false
                b.image = glyph
                b.imagePosition = .imageLeading
                b.attributedTitle = title ?? NSAttributedString(string: "")
                if title == nil { b.imagePosition = .imageOnly }
                b.contentTintColor = dark ? .white : .black
                b.sizeToFit()
                b.frame.origin = NSPoint(x: 220 - b.frame.width - 16, y: (24 - b.frame.height) / 2)
                bar.addSubview(b)
                guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: 440, pixelsHigh: 48, bitsPerSample: 8,
                                                 samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                                 bytesPerRow: 0, bitsPerPixel: 0) else { continue }
                rep.size = bar.bounds.size
                bar.cacheDisplay(in: bar.bounds, to: rep)
                try? rep.representation(using: .png, properties: [:])?
                    .write(to: URL(fileURLWithPath: dir).appendingPathComponent("mac-menubar-\(name)-\(dark ? "dark" : "light").png"))
            }
        }
    }
    #endif

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
        NotificationCenter.default.post(name: .trackifyPanelClosed, object: nil)
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
        let p = Self.makePanelWindow(
            model: model,
            close: { [weak self] in self?.closePanel() },
            openDashboard: { [weak self] screen in self?.closePanel(); self?.openDashboard(screen) })
        p.onEscape = { [weak self] in self?.closePanel() }
        return p
    }

    /// The panel window with its SwiftUI content (also used by the panel test hooks).
    static func makePanelWindow(model: AppModel, close: @escaping () -> Void, openDashboard: @escaping (AppScreen?) -> Void) -> MenuPanelWindow {
        let root = MenuPanelView(close: close, openDashboard: openDashboard).environment(model)
        let host = NSHostingController(rootView: root)
        return MenuPanelWindow(contentViewController: host)
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
        let root = MenuPanelView(close: {}, openDashboard: { [weak self] s in self?.openDashboard(s) }, alwaysVisible: true).environment(model)
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
    static let trackifyPanelClosed = Notification.Name("trackify.panelClosed")
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

    /// Test hooks: draw as the key window without taking focus, anywhere (off-screen).
    var benchForceKey = false
    override var isKeyWindow: Bool { benchForceKey || super.isKeyWindow }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        benchForceKey ? frameRect : super.constrainFrameRect(frameRect, to: screen)
    }

    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    override func cancelOperation(_ sender: Any?) { onEscape?() }
}
