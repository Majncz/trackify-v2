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
                PanelBench.runIfRequested(model: model)
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
        for c in WidgetGallery.cases(.mac) {
            for look in ["light", "dark", "tinted"] {
                write(WidgetGallery.tile(c, look: look, desktop: true), "mac-widget-\(c.name)-\(look).png", dir)
            }
        }
    }

    static func write<V: View>(_ view: V, _ file: String, _ dir: String) {
        let r = ImageRenderer(content: view)
        r.scale = 2
        guard let cg = r.cgImage else { return }
        let data = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])
        try? data?.write(to: URL(fileURLWithPath: dir).appendingPathComponent(file))
    }
}
#endif
