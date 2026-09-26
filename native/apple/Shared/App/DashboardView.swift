import SwiftUI
import TrackifyKit

/// Sidebar: Home · Stats · Visualizations · Billing · AI Chat · Settings.
struct DashboardView: View {
    @Environment(AppModel.self) private var model
    @State private var nav = NavigationState.shared

    #if os(macOS)
    private let items: [(AppScreen, String, String)] = [
        (.home, "Home", "house"),
        (.stats, "Stats", "chart.bar"),
        (.visualizations, "Visualizations", "film"),
        (.billing, "Billing", "dollarsign.circle"),
        (.chat, "AI Chat", "message"),
        (.settings, "Settings", "gearshape"),
    ]
    #else
    private let items: [(AppScreen, String, String)] = [
        (.home, "Home", "house"),
        (.stats, "Stats", "chart.bar"),
        (.team, "Team", "person.3"),
        (.billing, "Billing", "dollarsign.circle"),
        (.chat, "Chat", "message"),
        (.settings, "Settings", "gearshape"),
    ]
    #endif

    private var selection: Binding<AppScreen?> {
        Binding(get: {
            #if os(macOS)
            return nav.screen == .team ? .visualizations : nav.screen
            #else
            return nav.screen == .visualizations ? .team : nav.screen
            #endif
        }, set: { if let s = $0 { nav.screen = s } })
    }

    var body: some View {
        NavigationSplitView {
            List(selection: selection) {
                ForEach(items, id: \.0) { item in
                    Label(item.1, systemImage: item.2).tag(item.0)
                        .accessibilityIdentifier("nav-\(item.1)")
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
            case .home:
                NavigationStack(path: $nav.homePath) { HomeView().trackifyRoutes() }
            case .team:
                NavigationStack { TeamView().trackifyRoutes() }
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
