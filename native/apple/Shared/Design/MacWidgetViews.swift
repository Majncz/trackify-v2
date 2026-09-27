#if os(macOS)
import SwiftUI
import WidgetKit
import AppIntents
import TrackifyKit

// macOS desktop / Notification Center widgets, drawn like Apple's own (Clock, Calendar, Reminders):
// system background, SF type, the task colour only as a small dot, no wordmark. The clock is the
// accentable element so it takes the tint in accented / vibrant desktop rendering.
// Compiled into the widget extension and the app (the app renders them for review screenshots).

struct MacWidgetFamilyView: View {
    @Environment(\.widgetFamily) private var family
    let s: WidgetSnapshot
    let now: Date

    var body: some View {
        switch family {
        case .systemMedium: MacMediumWidget(s: s, now: now)
        case .systemLarge: MacLargeWidget(s: s, now: now)
        default: MacSmallWidget(s: s, now: now)
        }
    }
}

// MARK: - Pieces

private struct MacTaskDot: View {
    let hex: String
    var size: CGFloat = 8
    var body: some View { Circle().fill(Color(hex: hex)).frame(width: size, height: size) }
}

/// "Learning Swift" + "Since 20:07".
private struct MacRunningTitle: View {
    let r: WidgetSnapshot.Running
    var lines = 2
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                MacTaskDot(hex: r.accentHex).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                Text(r.taskName).font(.system(size: 13, weight: .semibold)).lineLimit(lines)
            }
            Text("Since \(DayCalc.current.format(Date(ms: r.startTime), "HH:mm"))")
                .font(.system(size: 11)).foregroundStyle(.secondary)
        }
    }
}

private struct MacClock: View {
    let start: Int64
    var size: CGFloat
    var body: some View {
        Text(timerInterval: Date(ms: start)...Date.distantFuture, countsDown: false)
            .font(.system(size: size, weight: .medium, design: .rounded))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.6)
            .widgetAccentable()
    }
}

private struct MacStopButton: View {
    var full = true
    var body: some View {
        Button(intent: WidgetStopIntent()) {
            Label("Stop", systemImage: "stop.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.red)
                .padding(.horizontal, 14)
                .frame(maxWidth: full ? .infinity : nil, minHeight: 26)
                .background(Color.red.opacity(0.14), in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

/// "Today" / "3h 12m".
private struct MacTodayTotal: View {
    let s: WidgetSnapshot
    let now: Date
    var big = true
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(s.running == nil ? "Not tracking" : "Today").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
            Text(Fmt.durationWords(s.todayTotal(now: now)))
                .font(.system(size: big ? 24 : 15, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .widgetAccentable()
        }
    }
}

/// One quick-start row: ▶ · dot · name (· today). Tapping starts (or stops, when it's the running one).
private struct MacStartRow: View {
    let t: WidgetSnapshot.TaskItem
    var running = false
    var showToday = false
    var body: some View {
        if running {
            Button(intent: WidgetStopIntent()) { label }.buttonStyle(.plain)
        } else {
            Button(intent: WidgetStartIntent(taskId: t.id)) { label }.buttonStyle(.plain)
        }
    }

    private var label: some View {
            HStack(spacing: 7) {
                MacTaskDot(hex: t.accentHex, size: 7)
                Text(t.name)
                    .font(.system(size: 12, weight: running ? .semibold : .regular))
                    .lineLimit(1)
                Spacer(minLength: 4)
                if showToday && t.todayMs > 0 {
                    Text(Fmt.durationWords(t.todayMs)).font(.system(size: 11)).monospacedDigit().foregroundStyle(.secondary)
                }
                Image(systemName: running ? "stop.circle.fill" : "play.circle")
                    .font(.system(size: 15))
                    .foregroundStyle(running ? AnyShapeStyle(Color.red) : AnyShapeStyle(.secondary))
            }
            .frame(maxHeight: .infinity)
            .contentShape(Rectangle())
    }
}

// MARK: - Small

struct MacSmallWidget: View {
    let s: WidgetSnapshot
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let r = s.running {
                MacRunningTitle(r: r)
                Spacer(minLength: 4)
                MacClock(start: r.startTime, size: 28)
                MacStopButton().padding(.top, 6)
            } else if s.tasks.isEmpty {
                MacTodayTotal(s: s, now: now)
                Spacer()
                Text("Create a task in Trackify to start.").font(.system(size: 11)).foregroundStyle(.secondary)
            } else {
                MacTodayTotal(s: s, now: now)
                Spacer(minLength: 6)
                VStack(spacing: 0) {
                    ForEach(Array(s.tasks.prefix(3))) { t in MacStartRow(t: t) }
                }
                .frame(maxHeight: 72)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(URL(string: s.running.map { "trackify://task/\($0.taskId)" } ?? "trackify://home"))
    }
}

// MARK: - Medium

struct MacMediumWidget: View {
    let s: WidgetSnapshot
    let now: Date

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 0) {
                if let r = s.running {
                    MacRunningTitle(r: r, lines: 1)
                    Spacer(minLength: 4)
                    MacClock(start: r.startTime, size: 28)
                    MacStopButton().padding(.top, 6)
                } else {
                    MacTodayTotal(s: s, now: now)
                    Spacer()
                    if let last = s.lastTask {
                        Text("Last: \(last.name)").font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            VStack(alignment: .leading, spacing: 0) {
                Text(s.running == nil ? "Start" : "Switch to").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
                    .padding(.bottom, 2)
                ForEach(Array(s.tasks.filter { $0.id != s.running?.taskId }.prefix(4))) { t in MacStartRow(t: t) }
                if s.tasks.isEmpty { Spacer() }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .widgetURL(URL(string: "trackify://home"))
    }
}

// MARK: - Large

struct MacLargeWidget: View {
    let s: WidgetSnapshot
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let r = s.running {
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 4) {
                        MacRunningTitle(r: r, lines: 1)
                        MacClock(start: r.startTime, size: 30)
                    }
                    Spacer(minLength: 8)
                    MacStopButton(full: false)
                }
            } else {
                MacTodayTotal(s: s, now: now)
            }
            Divider().padding(.vertical, 10)
            HStack {
                Text("Tasks").font(.system(size: 11, weight: .medium)).foregroundStyle(.secondary)
                Spacer()
                if s.running != nil {
                    Text("Today \(Fmt.durationWords(s.todayTotal(now: now)))").font(.system(size: 11)).monospacedDigit().foregroundStyle(.secondary)
                }
            }
            .padding(.bottom, 2)
            VStack(spacing: 0) {
                ForEach(Array(s.tasks.prefix(8))) { t in MacStartRow(t: t, running: t.id == s.running?.taskId, showToday: true) }
            }
            .frame(maxHeight: .infinity, alignment: .top)
        }
        .widgetURL(URL(string: "trackify://home"))
    }
}

struct MacSignedOutWidget: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: "timer").font(.system(size: 20, weight: .medium)).widgetAccentable()
            Spacer()
            Text("Trackify").font(.system(size: 13, weight: .semibold))
            Text("Sign in to start tracking.").font(.system(size: 11)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(URL(string: "trackify://home"))
    }
}
#endif
