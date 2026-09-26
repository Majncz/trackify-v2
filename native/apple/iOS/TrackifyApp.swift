import SwiftUI
import TrackifyKit

@main
struct TrackifyApp: App {
    @State private var model = AppModel.shared
    @Environment(\.scenePhase) private var scenePhase

    init() {
        DarwinObserver.shared.start()
        LiveActivityController.shared.attach(to: AppModel.shared)
    }

    var body: some Scene {
        WindowGroup {
            RootView { AdaptiveRootView() }
                .environment(model)
                .task { await model.bootstrap() }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { model.foreground() }
                    if phase == .background { model.background() }
                }
                .onOpenURL { url in DeepLink.handle(url, model: model) }
        }
    }
}

/// Listens for "timer changed" pings from widgets/intents running in other processes.
final class DarwinObserver: @unchecked Sendable {
    static let shared = DarwinObserver()
    func start() {
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        CFNotificationCenterAddObserver(center, nil, { _, _, _, _, _ in
            Task { @MainActor in
                await AppModel.shared.engine.reloadFromStore()
                AppModel.shared.scheduleRefresh()
            }
        }, AppGroup.timerChangedNotification as CFString, nil, .deliverImmediately)
    }
}
