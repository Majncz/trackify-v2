import SwiftUI
import AppKit
import TrackifyKit

/// "Dashboard" window with every web feature. While open the app shows a Dock icon (`.regular`).
@MainActor
final class DashboardWindowController: NSObject, NSWindowDelegate {
    let model: AppModel
    private var window: NSWindow?

    init(model: AppModel) { self.model = model }

    func show(_ screen: AppScreen?) {
        if let screen { NavigationState.shared.select(screen) }
        if window == nil {
            let root = RootView { DashboardView() }.environment(model).frame(minWidth: 820, minHeight: 560)
            let host = NSHostingController(rootView: root)
            let w = NSWindow(contentViewController: host)
            w.title = "Trackify"
            w.styleMask = [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]
            w.titlebarAppearsTransparent = false
            w.setContentSize(NSSize(width: 1100, height: 760))
            w.setFrameAutosaveName("TrackifyDashboard")
            if model.isTestHookEnabled, let size = UserDefaults.standard.string(forKey: "TrackifyWindowSize") {
                let p = size.split(separator: "x").compactMap { Double($0) }
                if p.count == 2 { w.setContentSize(NSSize(width: p[0], height: p[1])) }
            }
            w.isReleasedWhenClosed = false
            w.delegate = self
            w.center()
            window = w
        }
        NSApp.setActivationPolicy(.regular)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    func windowWillClose(_ notification: Notification) {
        // Back to a pure menu-bar app; drop the SwiftUI hierarchy so nothing ticks while closed.
        DispatchQueue.main.async {
            self.window?.contentViewController = nil
            self.window = nil
            NSApp.setActivationPolicy(.accessory)
        }
    }
}

