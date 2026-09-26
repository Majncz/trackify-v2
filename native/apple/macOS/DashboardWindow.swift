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
        // Back to a pure menu-bar app.
        DispatchQueue.main.async { NSApp.setActivationPolicy(.accessory) }
    }
}

/// Sidebar: Home · Stats · Visualizations · Billing · AI Chat · Settings.
struct DashboardView: View {
    @Environment(AppModel.self) private var model
    @State private var nav = NavigationState.shared

    private let items: [(AppScreen, String, String)] = [
        (.home, "Home", "house"),
        (.stats, "Stats", "chart.bar"),
        (.visualizations, "Visualizations", "film"),
        (.billing, "Billing", "dollarsign.circle"),
        (.chat, "AI Chat", "message"),
        (.settings, "Settings", "gearshape"),
    ]

    var body: some View {
        NavigationSplitView {
            List(selection: Binding(get: { nav.screen == .team ? .visualizations : nav.screen }, set: { if let s = $0 { nav.screen = s } })) {
                ForEach(items, id: \.0) { item in
                    Label(item.1, systemImage: item.2).tag(item.0)
                }
            }
            .navigationSplitViewColumnWidth(min: 180, ideal: 200)
            .safeAreaInset(edge: .top) {
                HStack(spacing: 6) {
                    Wordmark(size: 18)
                    ConnectionDot(look: model.connectionLook)
                    Spacer()
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
            }
        } detail: {
            switch nav.screen {
            case .home, .team:
                NavigationStack(path: $nav.homePath) { HomeView().trackifyRoutes() }
            case .stats:
                NavigationStack { StatsView().trackifyRoutes() }
            case .visualizations:
                NavigationStack { VisualizationsView() }
            case .billing:
                NavigationStack { BillingView().trackifyRoutes() }
            case .chat:
                ChatView()
            case .settings:
                NavigationStack { SettingsView() }
            }
        }
        .background(Theme.background)
    }
}
