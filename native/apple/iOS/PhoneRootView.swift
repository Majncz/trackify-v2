import SwiftUI
import TrackifyKit

// MARK: - Destinations (PHONE_REDESIGN.md)

/// Bottom tabs on iPhone; the same destinations sit in the iPad sidebar.
enum PhoneTab: Hashable { case timer, stats, team, more }

/// Rows of the More tab (and the lower part of the iPad sidebar).
enum MoreItem: String, Hashable, CaseIterable, Identifiable {
    case billing, chat, settings, hidden, widgets, about
    var id: String { rawValue }
    var title: String {
        switch self {
        case .billing: "Billing"
        case .chat: "AI chat"
        case .settings: "Settings"
        case .hidden: "Hidden tasks"
        case .widgets: "Widgets"
        case .about: "About"
        }
    }
    var icon: String {
        switch self {
        case .billing: "dollarsign.circle"
        case .chat: "bubble.left.and.text.bubble.right"
        case .settings: "gearshape"
        case .hidden: "eye.slash"
        case .widgets: "square.grid.2x2"
        case .about: "info.circle"
        }
    }

    @MainActor @ViewBuilder var screen: some View {
        switch self {
        case .billing: BillingView()
        case .chat: ChatView().navigationTitle("AI chat").navigationBarTitleDisplayMode(.inline)
        case .settings: PhoneSettingsView()
        case .hidden: HiddenTasksView()
        case .widgets: WidgetsInfoView()
        case .about: AboutView()
        }
    }
}

/// Pushed screens that aren't task details.
enum TeamRoute: Hashable { case race }
struct GroupRoute: Hashable { let id: String }

extension View {
    /// Every destination any tab can push (task detail, groups, race, More rows).
    func phoneRoutes() -> some View {
        self
            .trackifyRoutes()
            .navigationDestination(for: MoreItem.self) { $0.screen }
            .navigationDestination(for: TeamRoute.self) { _ in VisualizationsView() }
            .navigationDestination(for: GroupRoute.self) { r in GroupDetailView(groupId: r.id) }
    }
}

// MARK: - Root

/// iPhone (compact width): tabs. iPad (regular width): sidebar with the same destinations.
struct AdaptiveRootView: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    var body: some View {
        Group {
            if sizeClass == .regular { PadRootView() } else { PhoneTabView() }
        }
        .environment(\.cardChrome, .plain)
    }
}

/// Launch hook (`-TrackifyScreen`) → where to start.
private func initialDestination() -> (PhoneTab, MoreItem?, Bool) {
    switch AppScreen.launchScreen {
    case .stats: return (.stats, nil, false)
    case .team: return (.team, nil, false)
    case .visualizations: return (.team, nil, true)
    case .billing: return (.more, .billing, false)
    case .chat: return (.more, .chat, false)
    case .settings: return (.more, .settings, false)
    default: return (.timer, nil, false)
    }
}

/// Timer · Stats · Team · More. Each tab owns its navigation stack; tapping the active tab pops it to its root.
/// Tab switches are instant (no custom transitions).
struct PhoneTabView: View {
    @State private var nav = NavigationState.shared
    @State private var tab: PhoneTab
    @State private var statsPath = NavigationPath()
    @State private var teamPath = NavigationPath()
    @State private var morePath = NavigationPath()

    init() {
        let (t, more, race) = initialDestination()
        _tab = State(initialValue: t)
        var m = NavigationPath()
        if let more { m.append(more) }
        _morePath = State(initialValue: m)
        var tp = NavigationPath()
        if race { tp.append(TeamRoute.race) }
        _teamPath = State(initialValue: tp)
    }

    var body: some View {
        TabView(selection: selection) {
            NavigationStack(path: $nav.homePath) {
                TimerScreen().phoneRoutes()
            }
            .tabItem { Label("Timer", systemImage: "timer") }
            .tag(PhoneTab.timer)

            NavigationStack(path: $statsPath) {
                PhoneStatsView().phoneRoutes()
            }
            .tabItem { Label("Stats", systemImage: "chart.bar") }
            .tag(PhoneTab.stats)

            NavigationStack(path: $teamPath) {
                TeamView().phoneRoutes()
            }
            .tabItem { Label("Team", systemImage: "person.2") }
            .tag(PhoneTab.team)

            NavigationStack(path: $morePath) {
                MoreView().phoneRoutes()
            }
            .tabItem { Label("More", systemImage: "ellipsis") }
            .tag(PhoneTab.more)
        }
        .onChange(of: nav.requests) { _, _ in
            // Deep links (widgets, Live Activity, notifications) land on the Timer tab.
            switch nav.screen {
            case .stats: tab = .stats
            case .team, .visualizations: tab = .team
            case .billing, .chat, .settings: tab = .more
            case .home: tab = .timer
            }
        }
    }

    /// Re-selecting the current tab pops its stack (standard iOS behaviour).
    private var selection: Binding<PhoneTab> {
        Binding(get: { tab }, set: { new in
            if new == tab { popToRoot(new) }
            tab = new
        })
    }

    private func popToRoot(_ t: PhoneTab) {
        switch t {
        case .timer: nav.homePath = []
        case .stats: statsPath = NavigationPath()
        case .team: teamPath = NavigationPath()
        case .more: morePath = NavigationPath()
        }
    }
}

// MARK: - iPad

/// Sidebar: Timer · Stats · Team, then the More rows. Each destination has its own stack.
struct PadRootView: View {
    @Environment(AppModel.self) private var model
    @State private var nav = NavigationState.shared
    @State private var selection: PadItem? = .timer
    @State private var path = NavigationPath()

    enum PadItem: Hashable { case timer, stats, team, more(MoreItem) }

    init() {
        let (t, more, _) = initialDestination()
        switch t {
        case .timer: _selection = State(initialValue: .timer)
        case .stats: _selection = State(initialValue: .stats)
        case .team: _selection = State(initialValue: .team)
        case .more: _selection = State(initialValue: .more(more ?? .settings))
        }
    }

    var body: some View {
        NavigationSplitView {
            List(selection: $selection) {
                Section {
                    row(.timer, "Timer", "timer")
                    row(.stats, "Stats", "chart.bar")
                    row(.team, "Team", "person.2")
                }
                Section("More") {
                    ForEach(MoreItem.allCases) { m in row(.more(m), m.title, m.icon) }
                }
            }
            .navigationTitle("Trackify")
            .navigationSplitViewColumnWidth(min: 200, ideal: 240)
        } detail: {
            switch selection ?? .timer {
            case .timer:
                NavigationStack(path: $nav.homePath) { TimerScreen().phoneRoutes() }
            case .stats:
                NavigationStack(path: $path) { PhoneStatsView().phoneRoutes() }.id("stats")
            case .team:
                NavigationStack(path: $path) { TeamView().phoneRoutes() }.id("team")
            case .more(let m):
                NavigationStack(path: $path) { m.screen.phoneRoutes() }.id(m.rawValue)
            }
        }
        .onChange(of: selection) { _, _ in path = NavigationPath() }
        .onChange(of: nav.requests) { _, _ in
            switch nav.screen {
            case .stats: selection = .stats
            case .team, .visualizations: selection = .team
            case .billing: selection = .more(.billing)
            case .chat: selection = .more(.chat)
            case .settings: selection = .more(.settings)
            case .home: selection = .timer
            }
        }
    }

    private func row(_ item: PadItem, _ title: String, _ icon: String) -> some View {
        Label(title, systemImage: icon)
            .tag(item)
            .accessibilityIdentifier("nav-\(title)")
    }
}
