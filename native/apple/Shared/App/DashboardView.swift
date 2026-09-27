#if os(macOS)
import SwiftUI
import TrackifyKit

/// Mac dashboard window: a source-list sidebar and one destination at a time (PHONE_REDESIGN.md, adapted to the Mac).
/// Switching destinations is instant; only the task detail pushes (with the toolbar's Back button).
enum MacSection: String, Hashable, CaseIterable, Identifiable {
    case timer, stats, team, billing, chat, settings
    var id: String { rawValue }

    var title: String {
        switch self {
        case .timer: "Timer"
        case .stats: "Stats"
        case .team: "Team"
        case .billing: "Billing"
        case .chat: "AI Chat"
        case .settings: "Settings"
        }
    }

    var icon: String {
        switch self {
        case .timer: "timer"
        case .stats: "chart.bar"
        case .team: "person.2"
        case .billing: "dollarsign.circle"
        case .chat: "bubble.left.and.text.bubble.right"
        case .settings: "gearshape"
        }
    }

    init(_ screen: AppScreen) {
        switch screen {
        case .home: self = .timer
        case .stats: self = .stats
        case .team, .visualizations: self = .team
        case .billing: self = .billing
        case .chat: self = .chat
        case .settings: self = .settings
        }
    }
}

struct DashboardView: View {
    @Environment(AppModel.self) private var model
    @State private var nav = NavigationState.shared
    @State private var section: MacSection? = MacSection(NavigationState.shared.screen)

    var body: some View {
        NavigationSplitView {
            List(selection: $section) {
                Section {
                    row(.timer)
                    row(.stats)
                    row(.team)
                }
                Section {
                    row(.billing)
                    row(.chat)
                }
                Section {
                    row(.settings)
                }
            }
            .navigationSplitViewColumnWidth(min: 170, ideal: 190, max: 260)
        } detail: {
            detail(section ?? .timer)
        }
        .environment(\.cardChrome, .plain)
        .onChange(of: nav.requests) { _, _ in section = MacSection(nav.screen) }
        .onChange(of: section) { _, s in
            // Picking Timer from the sidebar always shows the list, not a task left open earlier.
            if s == .timer, nav.screen != .home { nav.homePath = [] }
            if let s { nav.screen = s.screen }
        }
    }

    private func row(_ s: MacSection) -> some View {
        Label(s.title, systemImage: s.icon)
            .tag(s)
            .accessibilityIdentifier("nav-\(s.title)")
    }

    @ViewBuilder private func detail(_ s: MacSection) -> some View {
        switch s {
        case .timer:
            NavigationStack(path: $nav.homePath) { HomeView().trackifyRoutes() }
        case .stats:
            NavigationStack { MacStatsView().trackifyRoutes() }.id("stats")
        case .team:
            NavigationStack { MacTeamView() }.id("team")
        case .billing:
            NavigationStack { BillingView().trackifyRoutes() }.id("billing")
        case .chat:
            NavigationStack {
                ChatView()
            }
            .id("chat")
        case .settings:
            NavigationStack { SettingsView() }.id("settings")
        }
    }
}

extension MacSection {
    var screen: AppScreen {
        switch self {
        case .timer: .home
        case .stats: .stats
        case .team: .team
        case .billing: .billing
        case .chat: .chat
        case .settings: .settings
        }
    }
}
#endif
