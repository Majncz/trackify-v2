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
                .task {
                    await model.bootstrap()
                    #if DEBUG
                    await LiveWidgetRender.runIfRequested()
                    #endif
                }
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

#if DEBUG
/// Test hook `-TrackifyRenderLiveWidgets <dir>`: after sign-in, draws the widgets from the snapshot the app just wrote
/// for them (real tasks, heat map and team from the server) — the data path WidgetKit reads, rendered off-screen.
@MainActor
enum LiveWidgetRender {
    static func runIfRequested() async {
        guard let dir = UserDefaults.standard.string(forKey: "TrackifyRenderLiveWidgets") else { return }
        try? await Task.sleep(nanoseconds: 6_000_000_000)
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let now = Date()
        let data = TimerWidgetData(snapshot: SnapshotStore.shared.load(), team: TeamSnapshotStore.shared.load())
        let z = WidgetGallery.sizes(.iphone)
        let cases: [WidgetGallery.Case] = [
            .init(name: "live-large", size: z.large, view: AnyView(WidgetLarge(data: data, now: now))),
            .init(name: "live-medium", size: z.medium, view: AnyView(WidgetMedium(s: data.snapshot, now: now))),
            .init(name: "live-small", size: z.small, view: AnyView(WidgetSmall(s: data.snapshot, now: now))),
            .init(name: "live-team-medium", size: z.medium, view: AnyView(TeamWidgetContent(team: data.team, signedIn: data.snapshot.signedIn, now: now, familyOverride: .systemMedium))),
        ]
        for c in cases {
            for look in ["light", "dark"] {
                let r = ImageRenderer(content: WidgetGallery.tile(c, look: look, desktop: false))
                r.scale = 3
                if let png = r.uiImage?.pngData() {
                    try? png.write(to: URL(fileURLWithPath: dir).appendingPathComponent("widget-iphone-\(c.name)-\(look).png"))
                }
            }
        }
    }
}
#endif
