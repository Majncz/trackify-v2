import SwiftUI
import AppKit
import TrackifyKit
import ServiceManagement

@main
struct TrackifyMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate

    var body: some Scene {
        // Everything is driven by the delegate (status item, panel, dashboard window).
        Settings { EmptyView() }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    let model = AppModel.shared
    var statusItem: StatusItemController?
    var dashboard: DashboardWindowController!
    var hotKey: GlobalHotKey?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        #if DEBUG
        if let dir = UserDefaults.standard.string(forKey: "TrackifyRenderWidgets") {
            WidgetPreviewRenderer.renderAll(to: dir)
            exit(0)
        }
        if let dir = UserDefaults.standard.string(forKey: "TrackifyRenderMenuBar") {
            StatusItemController.renderPreviews(to: dir)
            exit(0)
        }
        #endif
        AppearanceChoice.applyToMacApp()
        if model.isTestHookEnabled, let a = UserDefaults.standard.string(forKey: "TrackifyAppearance") {
            NSApp.appearance = NSAppearance(named: a == "dark" ? .darkAqua : .aqua)
        }
        dashboard = DashboardWindowController(model: model)
        // Test hook for local runs next to an installed Trackify: no second menu-bar item, no global hot key.
        let headless = model.isTestHookEnabled && UserDefaults.standard.bool(forKey: "TrackifyNoStatusItem")
        if !headless {
            statusItem = StatusItemController(model: model, openDashboard: { [weak self] screen in self?.dashboard.show(screen) })
            hotKey = GlobalHotKey(keyCode: 0x11 /* kVK_ANSI_T */, modifiers: [.control, .option]) { [weak self] in
                self?.statusItem?.togglePanel()
            }
        }
        Reminder.attach(to: model)
        DarwinObserverMac.start()

        Task {
            await model.bootstrap()
            let d = UserDefaults.standard
            if model.isTestHookEnabled {
                if d.bool(forKey: "TrackifyShowPanelWindow") { statusItem?.showPanelAsWindow() }
                if d.bool(forKey: "TrackifyOpenDashboard") { dashboard.show(AppScreen.launchScreen ?? .home) }
                if d.bool(forKey: "TrackifyOpenPanel") { statusItem?.showPanel() }
            }
            if model.phase == .signedOut && !d.bool(forKey: "TrackifyShowPanelWindow") && !d.bool(forKey: "TrackifyNoWindows") {
                // First launch: show the sign-in window rather than an empty menu.
                dashboard.show(.home)
            }
        }
        NotificationCenter.default.addObserver(forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in AppModel.shared.foreground() }
        }
        NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.didWakeNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in AppModel.shared.foreground() }
        }
    }

    func applicationShouldHandleReopen(_ sender: NSApplication, hasVisibleWindows flag: Bool) -> Bool {
        dashboard.show(nil)
        return true
    }

    func application(_ application: NSApplication, open urls: [URL]) {
        for u in urls { DeepLink.handle(u, model: model); dashboard.show(nil) }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

enum DarwinObserverMac {
    static func start() {
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        CFNotificationCenterAddObserver(center, nil, { _, _, _, _, _ in
            Task { @MainActor in
                await AppModel.shared.engine.reloadFromStore()
                AppModel.shared.scheduleRefresh()
            }
        }, AppGroup.timerChangedNotification as CFString, nil, .deliverImmediately)
    }
}

/// Launch at login via SMAppService.
enum LaunchAtLogin {
    static var isEnabled: Bool { SMAppService.mainApp.status == .enabled }
    static func set(_ on: Bool) {
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
        } catch {
            NSLog("Launch at login failed: \(error.localizedDescription)")
        }
    }
}

#if DEBUG
/// Test hook `-TrackifyRenderWidgets <dir>`: draws the desktop widgets (light, dark, desktop-tinted look) to PNGs.
@MainActor
enum WidgetPreviewRenderer {
    static func renderAll(to dir: String) {
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let now = Date()
        let running = sample(running: true)
        let idle = sample(running: false)
        let small = CGSize(width: 170, height: 170), medium = CGSize(width: 364, height: 170), large = CGSize(width: 364, height: 382)
        for look in ["light", "dark", "tinted"] {
            write(tile(MacSmallWidget(s: running, now: now), small, look), "small-running", look, dir)
            write(tile(MacSmallWidget(s: idle, now: now), small, look), "small-idle", look, dir)
            write(tile(MacMediumWidget(s: running, now: now), medium, look), "medium-running", look, dir)
            write(tile(MacMediumWidget(s: idle, now: now), medium, look), "medium-idle", look, dir)
            write(tile(MacLargeWidget(s: running, now: now), large, look), "large-running", look, dir)
            write(tile(MacSignedOutWidget(), small, look), "small-signedout", look, dir)
        }
    }

    /// A desktop-like tile: system widget background, or (tinted) the monochrome desktop rendering.
    static func tile<V: View>(_ content: V, _ size: CGSize, _ look: String) -> some View {
        let dark = look != "light"
        let shape = RoundedRectangle(cornerRadius: 22, style: .continuous)
        return ZStack {
            if look == "tinted" {
                content.padding(16).grayscale(1).brightness(0.35).foregroundStyle(.white)
            } else {
                content.padding(16)
            }
        }
        .frame(width: size.width, height: size.height)
        .background {
            shape.fill(look == "tinted" ? Color.white.opacity(0.16) : Color(nsColor: dark ? NSColor(white: 0.12, alpha: 1) : .white))
                .shadow(color: .black.opacity(0.18), radius: 8, y: 3)
        }
                .padding(28)
        .background(LinearGradient(colors: look == "tinted" ? [Color(rgb: 0x3b5b7a), Color(rgb: 0x1e2f45)]
                                    : dark ? [Color(rgb: 0x273548), Color(rgb: 0x111827)] : [Color(rgb: 0xc7d8ea), Color(rgb: 0xe9dfd3)],
                                    startPoint: .topLeading, endPoint: .bottomTrailing))
        .environment(\.colorScheme, dark ? .dark : .light)
    }

    static func write<V: View>(_ view: V, _ name: String, _ look: String, _ dir: String) {
        let r = ImageRenderer(content: view)
        r.scale = 2
        guard let cg = r.cgImage else { return }
        let data = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])
        try? data?.write(to: URL(fileURLWithPath: dir).appendingPathComponent("mac-widget-\(name)-\(look).png"))
    }

    static func sample(running: Bool) -> WidgetSnapshot {
        let names = ["Learning Swift", "Code review", "Bombay kitchen hub", "Emails & admin", "Research: pricing", "Standup", "Design system", "Hiring"]
        let today: [Int64] = [47, 70, 45, 30, 0, 15, 0, 0]
        let tasks = names.enumerated().map { i, n in
            WidgetSnapshot.TaskItem(id: "\(i + 1)", name: n, accentHex: Accent.taskAccentHex("\(i + 1)"),
                                    todayMs: today[i] * MINUTE_MS, totalMs: Int64(50 - i * 5) * HOUR_MS)
        }
        return WidgetSnapshot(
            signedIn: true, serverUrl: "", userId: "u", updatedAt: 0,
            running: running ? .init(taskId: "1", taskName: "Learning Swift", accentHex: Accent.taskAccentHex("1"), startTime: Date().ms - 47 * 60_000) : nil,
            todayTotalMs: 3 * HOUR_MS + 12 * MINUTE_MS, todayKey: DayCalc.current.dayKey(Date()), tasks: tasks)
    }
}
#endif
