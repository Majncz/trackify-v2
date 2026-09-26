import SwiftUI
import TrackifyKit

/// Top-level switch between launch, sign-in and the signed-in app.
struct RootView<SignedIn: View>: View {
    @Environment(AppModel.self) private var model
    @ViewBuilder var signedIn: () -> SignedIn

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            switch model.phase {
            case .launching:
                VStack(spacing: 12) {
                    AppGlyph(size: 64)
                    Wordmark(size: 22)
                }
                .transition(.opacity)
            case .signedOut:
                AuthFlowView().transition(.opacity)
            case .signedIn:
                signedIn().transition(.opacity)
            }
        }
        .animation(.easeOut(duration: 0.2), value: model.phase)
        .tint(Theme.foreground)
    }
}

/// Screens reachable from the test hook `-TrackifyScreen`.
enum AppScreen: String, CaseIterable, Hashable {
    case home, stats, team, billing, chat, settings, visualizations
    static var launchScreen: AppScreen? {
        UserDefaults.standard.string(forKey: "TrackifyScreen").flatMap(AppScreen.init(rawValue:))
    }
}

/// Destination for `Route` values (task detail) on every platform.
struct RouteDestinations: ViewModifier {
    func body(content: Content) -> some View {
        content.navigationDestination(for: Route.self) { r in
            switch r {
            case .task(let id): TaskDetailView(taskId: id)
            }
        }
    }
}

extension View {
    func trackifyRoutes() -> some View { modifier(RouteDestinations()) }
}
