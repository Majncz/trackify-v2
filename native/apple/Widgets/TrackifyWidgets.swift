import WidgetKit
import SwiftUI
import AppIntents
import TrackifyKit


// MARK: - Timeline

struct TimerEntry: TimelineEntry {
    let date: Date
    let snapshot: WidgetSnapshot
}

struct TimerProvider: TimelineProvider {
    func placeholder(in context: Context) -> TimerEntry { TimerEntry(date: Date(), snapshot: .preview) }

    func getSnapshot(in context: Context, completion: @escaping (TimerEntry) -> Void) {
        completion(TimerEntry(date: Date(), snapshot: context.isPreview ? .preview : Self.current()))
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<TimerEntry>) -> Void) {
        let now = Date()
        let entry = TimerEntry(date: now, snapshot: Self.current())
        // Clocks tick on their own (Text timers); refresh for the today total and at midnight.
        let midnight = DayCalc.current.addDays(DayCalc.current.startOfDay(now), 1)
        let next = min(now.addingTimeInterval(15 * 60), midnight)
        completion(Timeline(entries: [entry], policy: .after(next)))
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
}

extension WidgetSnapshot {
    static let preview = WidgetSnapshot(
        signedIn: true, serverUrl: "", userId: "u", updatedAt: 0,
        running: .init(taskId: "1", taskName: "Learning Swift", accentHex: Accent.taskAccentHex("1"), startTime: Date().ms - 47 * 60_000),
        todayTotalMs: 3 * HOUR_MS + 12 * MINUTE_MS, todayKey: DayCalc.current.dayKey(Date()),
        tasks: [
            .init(id: "1", name: "Learning Swift", accentHex: Accent.taskAccentHex("1"), todayMs: 47 * MINUTE_MS, totalMs: 56 * HOUR_MS),
            .init(id: "2", name: "Code review", accentHex: Accent.taskAccentHex("2"), todayMs: 70 * MINUTE_MS, totalMs: 54 * HOUR_MS),
            .init(id: "3", name: "Bombay kitchen hub", accentHex: Accent.taskAccentHex("3"), todayMs: 45 * MINUTE_MS, totalMs: 40 * HOUR_MS),
            .init(id: "4", name: "Emails & admin", accentHex: Accent.taskAccentHex("4"), todayMs: 30 * MINUTE_MS, totalMs: 28 * HOUR_MS),
            .init(id: "5", name: "Research: pricing", accentHex: Accent.taskAccentHex("5"), todayMs: 0, totalMs: 32 * HOUR_MS),
            .init(id: "6", name: "Standup", accentHex: Accent.taskAccentHex("6"), todayMs: 15 * MINUTE_MS, totalMs: 21 * HOUR_MS),
            .init(id: "7", name: "Design system", accentHex: Accent.taskAccentHex("7"), todayMs: 0, totalMs: 12 * HOUR_MS),
            .init(id: "8", name: "Hiring", accentHex: Accent.taskAccentHex("8"), todayMs: 0, totalMs: 6 * HOUR_MS),
        ])
}

// MARK: - Widget

struct TimerWidget: Widget {
    let kind = "TrackifyTimer"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: TimerProvider()) { entry in
            #if os(macOS)
            TimerWidgetView(entry: entry)
                .containerBackground(.background, for: .widget)
                .forcedColorScheme(AppearanceChoice.widgets.colorScheme)
            #else
            TimerWidgetView(entry: entry)
                .containerBackground(for: .widget) { Theme.card }
                .forcedColorScheme(AppearanceChoice.widgets.colorScheme)
            #endif
        }
        .configurationDisplayName("Trackify")
        .description("See what's running and start or stop tasks with one tap.")
        .supportedFamilies(families)
    }

    private var families: [WidgetFamily] {
        #if os(iOS)
        [.systemSmall, .systemMedium, .systemLarge, .accessoryCircular, .accessoryRectangular, .accessoryInline]
        #else
        [.systemSmall, .systemMedium, .systemLarge]
        #endif
    }
}

struct TimerWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: TimerEntry

    var body: some View {
        let s = entry.snapshot
        #if os(macOS)
        if !s.signedIn { MacSignedOutWidget() } else { MacWidgetFamilyView(s: s, now: entry.date) }
        #else
        if !s.signedIn {
            SignedOutWidget(compact: family != .systemLarge)
        } else {
            switch family {
            case .systemSmall: SmallWidget(s: s, now: entry.date)
            case .systemMedium: MediumWidget(s: s, now: entry.date)
            case .systemLarge: LargeWidget(s: s, now: entry.date)
            #if os(iOS)
            case .accessoryCircular: CircularAccessory(s: s)
            case .accessoryRectangular: RectangularAccessory(s: s)
            case .accessoryInline: InlineAccessory(s: s)
            #endif
            default: SmallWidget(s: s, now: entry.date)
            }
        }
        #endif
    }
}

// MARK: - Pieces

struct SignedOutWidget: View {
    var compact: Bool
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Wordmark(size: 15)
            Spacer()
            Text("Sign in to start tracking").font(.system(size: 13, weight: .medium)).foregroundStyle(Theme.mutedForeground)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .widgetURL(URL(string: "trackify://home"))
    }
}

/// Elapsed clock that ticks on its own.
struct LiveClock: View {
    let start: Int64
    var size: CGFloat = 28
    var body: some View {
        Text(timerInterval: Date(ms: start)...Date.distantFuture, countsDown: false)
            .font(.system(size: size, weight: .bold, design: .monospaced))
            .monospacedDigit()
            .foregroundStyle(Theme.foreground)
            .lineLimit(1)
            .minimumScaleFactor(0.6)
    }
}

struct StartRow: View {
    let task: WidgetSnapshot.TaskItem
    let running: Bool
    var body: some View {
        Button(intent: WidgetStartIntent(taskId: task.id)) {
            HStack(spacing: 8) {
                AccentDot(hex: task.accentHex, size: 7)
                Text(task.name).font(.system(size: 13, weight: running ? .semibold : .regular)).lineLimit(1)
                    .foregroundStyle(Theme.foreground)
                Spacer(minLength: 4)
                Image(systemName: running ? "stop.fill" : "play.fill")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(running ? Theme.destructive : Theme.foreground)
                    .frame(width: 20, height: 20)
                    .background(Theme.muted, in: Circle())
            }
            .padding(.horizontal, 8)
            .frame(maxHeight: .infinity)
            .background(running ? Theme.emerald.opacity(0.12) : Theme.muted.opacity(0.45), in: RoundedRectangle(cornerRadius: 8))
        }
        .buttonStyle(.plain)
    }
}

struct SmallWidget: View {
    let s: WidgetSnapshot
    let now: Date
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 4) {
                Wordmark(size: 13)
                Spacer()
                if let r = s.running { AccentDot(hex: r.accentHex, size: 7) }
            }
            if let r = s.running {
                Text(r.taskName).font(.system(size: 14, weight: .semibold)).lineLimit(2).foregroundStyle(Theme.foreground)
                Spacer(minLength: 0)
                LiveClock(start: r.startTime, size: 24)
                Button(intent: WidgetStopIntent()) {
                    Label("Stop", systemImage: "square.fill").font(.system(size: 13, weight: .semibold))
                        .frame(maxWidth: .infinity, minHeight: 30)
                        .foregroundStyle(Theme.onDestructive)
                        .background(Theme.destructive, in: RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            } else if let last = s.lastTask {
                Text("Not tracking").font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                Text(last.name).font(.system(size: 14, weight: .semibold)).lineLimit(2).foregroundStyle(Theme.foreground)
                Spacer(minLength: 0)
                Text("Today \(Fmt.durationWords(s.todayTotal(now: now)))").font(.system(size: 11)).monospacedDigit().foregroundStyle(Theme.mutedForeground)
                Button(intent: WidgetStartIntent(taskId: last.id)) {
                    Label("Start", systemImage: "play.fill").font(.system(size: 13, weight: .semibold))
                        .frame(maxWidth: .infinity, minHeight: 30)
                        .foregroundStyle(Theme.onPrimary)
                        .background(Theme.primary, in: RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            } else {
                Spacer()
                Text("No tasks yet").font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
            }
        }
        .widgetURL(URL(string: s.running.map { "trackify://task/\($0.taskId)" } ?? "trackify://home"))
    }
}

struct RunningPanel: View {
    let s: WidgetSnapshot
    let now: Date
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Wordmark(size: 13)
            if let r = s.running {
                HStack(spacing: 5) {
                    AccentDot(hex: r.accentHex, size: 7)
                    Text(r.taskName).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                }
                .padding(.top, 6)
                LiveClock(start: r.startTime, size: 22)
                Text("since \(DayCalc.current.format(Date(ms: r.startTime), "HH:mm")) · today \(Fmt.durationWords(s.todayTotal(now: now)))")
                    .font(.system(size: 11)).monospacedDigit().foregroundStyle(Theme.mutedForeground).lineLimit(1)
                Spacer(minLength: 4)
                Button(intent: WidgetStopIntent()) {
                    Label("Stop", systemImage: "square.fill").font(.system(size: 12, weight: .semibold))
                        .frame(maxWidth: .infinity, minHeight: 26)
                        .foregroundStyle(Theme.onDestructive)
                        .background(Theme.destructive, in: RoundedRectangle(cornerRadius: 7))
                }
                .buttonStyle(.plain)
            } else {
                Spacer(minLength: 4)
                Text("Not tracking").font(.system(size: 13, weight: .semibold))
                Text("Today \(Fmt.durationWords(s.todayTotal(now: now)))").font(.system(size: 12)).monospacedDigit().foregroundStyle(Theme.mutedForeground)
                Spacer(minLength: 4)
            }
        }
        .frame(maxHeight: .infinity, alignment: .topLeading)
    }
}

struct MediumWidget: View {
    let s: WidgetSnapshot
    let now: Date
    var body: some View {
        HStack(spacing: 12) {
            RunningPanel(s: s, now: now).frame(maxWidth: .infinity, alignment: .leading)
            VStack(spacing: 5) {
                ForEach(Array(s.tasks.filter { $0.id != s.running?.taskId }.prefix(4))) { t in
                    StartRow(task: t, running: false)
                }
            }
            .frame(maxWidth: .infinity)
        }
    }
}

struct LargeWidget: View {
    let s: WidgetSnapshot
    let now: Date
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Wordmark(size: 15)
                Spacer()
                Text("Today \(Fmt.durationWords(s.todayTotal(now: now)))").font(.system(size: 12, weight: .medium)).monospacedDigit()
                    .foregroundStyle(Theme.mutedForeground)
            }
            if let r = s.running {
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(spacing: 5) {
                            AccentDot(hex: r.accentHex, size: 7)
                            Text(r.taskName).font(.system(size: 14, weight: .semibold)).lineLimit(1)
                        }
                        LiveClock(start: r.startTime, size: 26)
                    }
                    Spacer()
                    Button(intent: WidgetStopIntent()) {
                        Label("Stop", systemImage: "square.fill").font(.system(size: 13, weight: .semibold))
                            .padding(.horizontal, 14).frame(minHeight: 32)
                            .foregroundStyle(Theme.onDestructive)
                            .background(Theme.destructive, in: RoundedRectangle(cornerRadius: 8))
                    }
                    .buttonStyle(.plain)
                }
                .padding(10)
                .background(Theme.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
            }
            VStack(spacing: 5) {
                ForEach(Array(s.tasks.prefix(8))) { t in
                    StartRow(task: t, running: t.id == s.running?.taskId)
                }
            }
            .frame(maxHeight: .infinity)
        }
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
