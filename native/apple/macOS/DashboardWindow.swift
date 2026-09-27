import SwiftUI
import AppKit
import TrackifyKit

/// The "Trackify" window: a native sidebar (Timer · Stats · Team · Billing · AI Chat · Settings).
/// While it's open the app shows a Dock icon (`.regular`).
@MainActor
final class DashboardWindowController: NSObject, NSWindowDelegate {
    let model: AppModel
    private var window: NSWindow?

    init(model: AppModel) { self.model = model }

    func show(_ screen: AppScreen?) {
        if let screen { NavigationState.shared.select(screen) }
        if window == nil {
            let root = RootView { DashboardView() }.environment(model).frame(minWidth: 760, minHeight: 500)
            let host = NSHostingController(rootView: root)
            // Let SwiftUI own the window's toolbar and title (NavigationSplitView toolbar items, navigationTitle).
            host.sceneBridgingOptions = [.toolbars, .title]
            let w = DashboardNSWindow(contentViewController: host)
            w.styleMask = [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView]
            w.toolbarStyle = .unified
            w.setContentSize(NSSize(width: 1100, height: 720))
            w.setFrameAutosaveName("TrackifyDashboard")
            if model.isTestHookEnabled, let size = UserDefaults.standard.string(forKey: "TrackifyWindowSize") {
                let p = size.split(separator: "x").compactMap { Double($0) }
                if p.count == 2 { w.setContentSize(NSSize(width: p[0], height: p[1])) }
            }
            w.isReleasedWhenClosed = false
            w.delegate = self
            w.center()
            window = w
            trackTitle()
            #if DEBUG
            if DebugSnapshot.requested {
                // Screenshot runs on a machine someone is using: far off-screen, without activating.
                w.forceKey = true
                w.setFrameOrigin(NSPoint(x: -20000, y: -20000))
                w.orderFront(nil)
                DebugSnapshot.scheduleIfRequested(w)
                return
            }
            #endif
        }
        NSApp.setActivationPolicy(.regular)
        window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    /// The window title follows the sidebar section (or the open task). SwiftUI's title bridging only
    /// forwards subtitles reliably from an NSHostingController, so the title is set here.
    private func trackTitle() {
        guard let window else { return }
        let title = withObservationTracking {
            currentTitle()
        } onChange: { [weak self] in
            DispatchQueue.main.async { self?.trackTitle() }
        }
        window.title = title
    }

    private func currentTitle() -> String {
        let nav = NavigationState.shared
        let section = MacSection(nav.screen)
        if section == .timer, case .task(let id)? = nav.homePath.last {
            return model.task(id)?.name ?? "Task"
        }
        return section.title
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

final class DashboardNSWindow: NSWindow {
    /// Debug screenshots only: render as the active window without taking focus.
    var forceKey = false
    override var isKeyWindow: Bool { forceKey || super.isKeyWindow }
    override var isMainWindow: Bool { forceKey || super.isMainWindow }
    override func constrainFrameRect(_ frameRect: NSRect, to screen: NSScreen?) -> NSRect {
        forceKey ? frameRect : super.constrainFrameRect(frameRect, to: screen)
    }
}

#if DEBUG
/// Test hook: `-TrackifySnapshot /path.png [-TrackifySnapshotDelay 8] [-TrackifySnapshotQuit YES]`
/// writes the dashboard window (an app may always image its own windows) and optionally quits.
@MainActor
enum DebugSnapshot {
    static var requested: Bool { UserDefaults.standard.string(forKey: "TrackifySnapshot") != nil }

    static func scheduleIfRequested(_ window: NSWindow) {
        let d = UserDefaults.standard
        guard let path = d.string(forKey: "TrackifySnapshot") else { return }
        let delay = d.double(forKey: "TrackifySnapshotDelay")
        DispatchQueue.main.asyncAfter(deadline: .now() + (delay > 0 ? delay : 8)) {
            capture(window, to: path)
            if d.bool(forKey: "TrackifySnapshotQuit") { NSApp.terminate(nil) }
        }
    }

    static func capture(_ window: NSWindow, to path: String) {
        // CGWindowListCreateImage is obsoleted in newer SDKs; look it up at runtime.
        typealias Fn = @convention(c) (CGRect, UInt32, UInt32, UInt32) -> Unmanaged<CGImage>?
        var image: CGImage?
        if let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImage") {
            let f = unsafeBitCast(sym, to: Fn.self)
            // optionIncludingWindow, boundsIgnoreFraming | bestResolution
            image = f(.null, 1 << 3, UInt32(window.windowNumber), (1 << 0) | (1 << 3))?.takeRetainedValue()
        }
        if image == nil, let view = window.contentView?.superview,
           let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) {
            view.cacheDisplay(in: view.bounds, to: rep)
            image = rep.cgImage
        }
        guard let image else { NSLog("snapshot failed"); return }
        let rep = NSBitmapImageRep(cgImage: image)
        try? rep.representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))
    }
}
#endif
