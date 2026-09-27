import Foundation
import TrackifyKit

/// `trackify://task/<id>`, `trackify://home`, `trackify://stop` (widgets & Live Activity taps).
enum DeepLink {
    static let scheme = "trackify"

    @MainActor
    static func handle(_ url: URL, model: AppModel) {
        guard url.scheme == scheme else { return }
        switch url.host {
        case "task":
            let id = url.pathComponents.dropFirst().first ?? ""
            if !id.isEmpty { NavigationState.shared.open(.task(id)) }
        case "stop":
            model.stop()
        default:
            NavigationState.shared.select(.home)
        }
    }
}

/// Cross-platform navigation requests (deep links, menu bar → dashboard).
@Observable
@MainActor
final class NavigationState {
    static let shared = NavigationState()
    var screen: AppScreen = AppScreen.launchScreen ?? .home
    var homePath: [Route] = []
    /// Bumped on every request so a tab UI can react even when `screen` didn't change.
    var requests = 0

    func select(_ s: AppScreen) { screen = s; requests += 1 }
    func open(_ r: Route) {
        screen = .home
        homePath = [r]
        requests += 1
    }
}
