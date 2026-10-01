import WidgetKit
import SwiftUI
import AppIntents
import TrackifyKit


// MARK: - Timeline

struct TimerEntry: TimelineEntry {
    let date: Date
    let data: TimerWidgetData
    var snapshot: WidgetSnapshot { data.snapshot }
}

struct TimerProvider: TimelineProvider {
    func placeholder(in context: Context) -> TimerEntry { TimerEntry(date: Date(), data: WidgetSamples.data(running: true)) }

    func getSnapshot(in context: Context, completion: @escaping (TimerEntry) -> Void) {
        if context.isPreview {
            completion(TimerEntry(date: Date(), data: WidgetSamples.data(running: true)))
            return
        }
        completion(TimerEntry(date: Date(), data: Self.currentData()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TimerEntry>) -> Void) {
        Task {
            // Team + heat stay fresh without opening the app: fetch when the stored data is old.
            await WidgetRefresher.refreshIfStale(team: context.family == .systemLarge || context.family == .systemExtraLarge)
            let now = Date()
            completion(Timeline(entries: [TimerEntry(date: now, data: Self.currentData())], policy: .after(WidgetRefresher.nextRefresh(now))))
        }
    }

    /// Snapshot + the freshest engine state (intents may have acted since the app wrote it).
    static func current() -> WidgetSnapshot {
        let snap = SnapshotStore.shared.load()
        guard snap.signedIn, let engine = DefaultsTimerStore(defaults: AppGroup.defaults).load() else { return snap }
        if engine.updatedAt >= snap.updatedAt || engine.running?.taskId != snap.running?.taskId {
            return snap.applying(running: engine.running)
        }
        return snap
    }

    static func currentData() -> TimerWidgetData {
        let pages = WidgetPageStore.shared
        return TimerWidgetData(snapshot: current(), team: TeamSnapshotStore.shared.load(), pageRaw: pages.raw, pageDirection: pages.direction)
    }
}

/// Network refresh from the widget extension (WidgetKit allows it while building a timeline), with the session the
/// app shares through the App Group keychain. Builds without the App Group have no session here and skip it.
enum WidgetRefresher {
    static let teamMaxAge: Int64 = 10 * MINUTE_MS
    static let tasksMaxAge: Int64 = 30 * MINUTE_MS

    static func nextRefresh(_ now: Date) -> Date {
        // Clocks tick on their own (Text timers); refresh for today's totals, the team and at midnight.
        let midnight = DayCalc.current.addDays(DayCalc.current.startOfDay(now), 1)
        return min(now.addingTimeInterval(15 * 60), midnight)
    }

    static func refreshIfStale(team wantTeam: Bool) async {
        guard let session = CredentialStore.shared.load(), let url = URL(string: session.server) else { return }
        let calc = DayCalc.current
        let now = Date()
        let today = calc.dayKey(now)
        let api = APIClient(baseURL: url, token: session.token)
        api.timezone = TimeZone.current.identifier

        let snap = SnapshotStore.shared.load()
        let snapStale = snap.signedIn && (now.ms - snap.updatedAt > tasksMaxAge || snap.heatEndKey != today || snap.heatDays == nil)
        let team = TeamSnapshotStore.shared.load()
        let teamStale = wantTeam && (team.day != today || now.ms - team.fetchedAt > teamMaxAge)
        guard snapStale || teamStale else { return }

        await withTimeout(seconds: 12) {
            await withTaskGroup(of: Void.self) { g in
                if snapStale {
                    g.addTask {
                        guard let tasks = try? await api.tasks() else { return }
                        let latest = SnapshotStore.shared.load()
                        let engine = DefaultsTimerStore(defaults: AppGroup.defaults).load()?.running
                        let running = engine ?? latest.running.map { RunningTimer(taskId: $0.taskId, startTime: $0.startTime, pending: $0.pending ?? false) }
                        SnapshotStore.shared.save(WidgetSnapshot.build(tasks: tasks, running: running, session: session, now: Date(), calc: calc))
                    }
                }
                if teamStale {
                    g.addTask {
                        guard let p = try? await api.presence(day: today, range: .day) else { return }
                        var fresh = TeamSnapshot.from(p, day: today, myId: session.userId)
                        // A tap the server hasn't confirmed yet stays on our own row.
                        if let r = TimerProvider.current().running, r.pending == true {
                            fresh = fresh.applying(running: r, userId: session.userId)
                        }
                        TeamSnapshotStore.shared.save(fresh)
                    }
                }
            }
        }
    }

    private static func withTimeout(seconds: Double, _ work: @escaping @Sendable () async -> Void) async {
        await withTaskGroup(of: Void.self) { g in
            g.addTask { await work() }
            g.addTask { try? await Task.sleep(nanoseconds: UInt64(seconds * 1_000_000_000)) }
            await g.next()
            g.cancelAll()
        }
    }
}

// MARK: - Timer widget

struct TimerWidget: Widget {
    let kind = "TrackifyTimer"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TimerProvider()) { entry in
            TimerWidgetView(entry: entry)
                .trackifyWidgetBackground()
        }
        .configurationDisplayName("Timer and tasks")
        .description("See what's running, start or switch tasks with one tap. Large: your work heat map and team today.")
        .supportedFamilies(families)
    }

    private var families: [WidgetFamily] {
        #if os(iOS)
        [.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline]
        #else
        [.systemSmall, .systemMedium, .systemLarge, .systemExtraLarge]
        #endif
    }
}

extension View {
    /// Apple's widget background (white / dark grey) and the widget appearance chosen in Settings.
    func trackifyWidgetBackground() -> some View {
        #if os(macOS)
        self.containerBackground(.background, for: .widget)
            .forcedColorScheme(AppearanceChoice.widgets.colorScheme)
        #else
        self.containerBackground(for: .widget) { WidgetPalette.background }
            .forcedColorScheme(AppearanceChoice.widgets.colorScheme)
        #endif
    }
}

struct TimerWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TimerEntry

    var body: some View {
        let s = entry.snapshot
        switch family {
        #if os(iOS)
        case .accessoryCircular: CircularAccessory(s: s)
        case .accessoryRectangular: RectangularAccessory(s: s)
        case .accessoryInline: InlineAccessory(s: s)
        #endif
        default: TimerWidgetContent(data: entry.data, now: entry.date)
        }
    }
}

// MARK: - Team today widget

struct TeamEntry: TimelineEntry {
    let date: Date
    let team: TeamSnapshot
    let signedIn: Bool
}

struct TeamProvider: TimelineProvider {
    func placeholder(in context: Context) -> TeamEntry { TeamEntry(date: Date(), team: WidgetSamples.team(), signedIn: true) }

    func getSnapshot(in context: Context, completion: @escaping (TeamEntry) -> Void) {
        if context.isPreview { completion(placeholder(in: context)); return }
        completion(Self.current())
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TeamEntry>) -> Void) {
        Task {
            await WidgetRefresher.refreshIfStale(team: true)
            let e = Self.current()
            completion(Timeline(entries: [e], policy: .after(WidgetRefresher.nextRefresh(e.date))))
        }
    }

    static func current() -> TeamEntry {
        let snap = SnapshotStore.shared.load()
        return TeamEntry(date: Date(), team: TeamSnapshotStore.shared.load(), signedIn: snap.signedIn)
    }
}

struct TeamWidget: Widget {
    let kind = "TrackifyTeam"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TeamProvider()) { entry in
            TeamWidgetContent(team: entry.team, signedIn: entry.signedIn, now: entry.date)
                .trackifyWidgetBackground()
        }
        .configurationDisplayName("Team today")
        .description("Who's tracking and your team's hours today.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

#if os(iOS)
struct CircularAccessory: View {
    let s: WidgetSnapshot
    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            if let r = s.running {
                VStack(spacing: 0) {
                    Image(systemName: "timer").font(.system(size: 11, weight: .semibold))
                    Text(timerInterval: Date(ms: r.startTime)...Date.distantFuture, countsDown: false)
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .multilineTextAlignment(.center)
                        .minimumScaleFactor(0.5)
                        .padding(.horizontal, 4)
                }
            } else {
                Text("T").font(.system(size: 20, weight: .heavy))
            }
        }
        .widgetURL(URL(string: "trackify://home"))
    }
}

struct RectangularAccessory: View {
    let s: WidgetSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            if let r = s.running {
                Text(r.taskName).font(.system(size: 14, weight: .semibold)).lineLimit(1).widgetAccentable()
                Text(timerInterval: Date(ms: r.startTime)...Date.distantFuture, countsDown: false)
                    .font(.system(size: 20, weight: .bold, design: .monospaced))
                    .lineLimit(1)
            } else {
                Text("Trackify").font(.system(size: 14, weight: .semibold)).widgetAccentable()
                Text("Not tracking").font(.system(size: 13))
                Text("Today \(Fmt.durationWords(s.todayTotal()))").font(.system(size: 12)).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .widgetURL(URL(string: "trackify://home"))
    }
}

struct InlineAccessory: View {
    let s: WidgetSnapshot
    var body: some View {
        if let r = s.running {
            Text("\(Image(systemName: "timer")) \(r.taskName) \(Text(timerInterval: Date(ms: r.startTime)...Date.distantFuture, countsDown: false))")
        } else {
            Text("\(Image(systemName: "timer")) Today \(Fmt.durationWords(s.todayTotal()))")
        }
    }
}
#endif
