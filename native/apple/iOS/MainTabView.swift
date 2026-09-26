import SwiftUI
import TrackifyKit

/// iPhone (compact width): tabs. iPad (regular width): sidebar split view like the Mac dashboard.
struct AdaptiveRootView: View {
    @Environment(\.horizontalSizeClass) private var sizeClass
    var body: some View {
        if sizeClass == .regular {
            DashboardView()
        } else {
            MainTabView()
        }
    }
}

/// iOS tabs: Home · Stats · Team · Billing · Chat. Settings from the Home toolbar.
struct MainTabView: View {
    @Environment(AppModel.self) private var model
    @State private var nav = NavigationState.shared
    @State private var showSettings = false

    var body: some View {
        TabView(selection: tabBinding) {
            NavigationStack(path: $nav.homePath) {
                HomeView()
                    .toolbar { brandToolbar(showSettingsButton: true) }
                    .trackifyRoutes()
            }
            .tabItem { Label("Home", systemImage: "house") }
            .tag(AppScreen.home)

            NavigationStack {
                StatsView()
                    .toolbar { brandToolbar(showSettingsButton: false) }
                    .trackifyRoutes()
            }
            .tabItem { Label("Stats", systemImage: "chart.bar") }
            .tag(AppScreen.stats)

            NavigationStack {
                TeamView()
                    .toolbar { brandToolbar(showSettingsButton: false) }
                    .trackifyRoutes()
            }
            .tabItem { Label("Team", systemImage: "person.3") }
            .tag(AppScreen.team)

            NavigationStack {
                BillingView()
                    .toolbar { brandToolbar(showSettingsButton: false) }
                    .trackifyRoutes()
            }
            .tabItem { Label("Billing", systemImage: "dollarsign.circle") }
            .tag(AppScreen.billing)

            NavigationStack {
                ChatView()
                    .toolbar { brandToolbar(showSettingsButton: false) }
            }
            .tabItem { Label("Chat", systemImage: "message") }
            .tag(AppScreen.chat)
        }
        .sheet(isPresented: $showSettings) {
            NavigationStack {
                SettingsView()
                    .toolbar {
                        ToolbarItem(placement: .confirmationAction) {
                            Button("Done") { showSettings = false }.fontWeight(.semibold)
                        }
                    }
            }
        }
        .onAppear {
            if AppScreen.launchScreen == .settings { showSettings = true }
        }
    }

    private var tabBinding: Binding<AppScreen> {
        Binding(get: {
            switch nav.screen {
            case .settings: return .home
            case .visualizations: return .team
            default: return nav.screen
            }
        }, set: { nav.screen = $0 })
    }

    @ToolbarContentBuilder
    private func brandToolbar(showSettingsButton: Bool) -> some ToolbarContent {
        ToolbarItem(placement: .topBarLeading) {
            HStack(spacing: 6) {
                Wordmark(size: 18)
                ConnectionDot(look: model.connectionLook)
            }
            .fixedSize()
            .padding(.horizontal, 6)
            .accessibilityElement(children: .combine)
        }
        if showSettingsButton {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showSettings = true } label: { Image(systemName: "person.crop.circle") }
                    .accessibilityLabel("Settings")
                    .accessibilityIdentifier("openSettings")
            }
        }
    }
}
