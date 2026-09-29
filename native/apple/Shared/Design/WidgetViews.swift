import SwiftUI
import WidgetKit
import AppIntents
import TrackifyKit

// Home-screen (iPhone / iPad) and desktop (Mac) widgets, one design for both, drawn like Apple's own widgets:
// system background and SF type, the task colour only as a small dot, the clock / today total / heat map as the
// accentable parts so tinted (iOS 18) and accented / desaturated (macOS desktop) rendering reads well.
// Compiled into the widget extensions and the apps (the apps render them for review screenshots).

// MARK: - Entries

/// What the timer widgets draw: the snapshot the app / intents wrote, today's team and the task-list page.
struct TimerWidgetData {
    var snapshot: WidgetSnapshot
    var team: TeamSnapshot
    var pageRaw: Int = 0
    var pageDirection: Int = 1
}

// MARK: - Rendering mode

/// A deep link around a widget section that keeps the section's own colours (Link tints with the accent colour).
struct WidgetLink<Content: View>: View {
    let url: String
    @ViewBuilder let content: Content
    @Environment(\.widgetOffscreenRender) private var offscreen
    var body: some View {
        if offscreen {
            // AppKit's ImageRenderer can't draw Link (a placeholder appears); the widget host draws it fine.
            content.foregroundStyle(Color.primary)
        } else {
            Link(destination: URL(string: url)!) {
                content.foregroundStyle(Color.primary)
            }
            .tint(Color.primary)
        }
    }
}

extension EnvironmentValues {
    /// Review renders only: draw as the tinted / accented rendering would (the real mode can't be set off-screen).
    @Entry var widgetMonochromePreview = false
    /// Review renders only: drawn by ImageRenderer, not the widget host.
    @Entry var widgetOffscreenRender = false
}

/// Full colour unless the system (iOS 18 tinted / clear, macOS desktop accented) or a review render says otherwise.
struct WidgetColorMode: DynamicProperty {
    @Environment(\.widgetRenderingMode) private var mode
    @Environment(\.widgetMonochromePreview) private var preview
    var fullColor: Bool { mode == .fullColor && !preview }
}

// MARK: - Palette

enum WidgetPalette {
    /// Widget background: white / Apple's dark widget grey.
    static let background = Color(light: 0xFFFFFF, dark: 0x1C1C1E)
    static let live = Color.green

    /// Heat cell fill for a level (0 = empty). Full colour uses the system green; tinted / accented modes use
    /// opacity only, which the system maps onto the tint.
    static func heat(_ level: Int, fullColor: Bool, dark: Bool) -> Color {
        let alphas: [Double] = [0, 0.32, 0.55, 0.78, 1]
        if level <= 0 { return Color.primary.opacity(fullColor ? (dark ? 0.10 : 0.065) : 0.14) }
        return (fullColor ? Color.green : Color.primary).opacity(alphas[min(4, level)])
    }
}

// MARK: - Small pieces

struct WidgetTaskDot: View {
    let hex: String
    var size: CGFloat = 8
    var body: some View { Circle().fill(Color(hex: hex)).frame(width: size, height: size) }
}

/// Green "live" dot with a soft halo (widgets can't run repeating animations; the ticking clock carries the motion).
struct WidgetLiveDot: View {
    var size: CGFloat = 6
    var body: some View {
        Circle().fill(WidgetPalette.live)
            .frame(width: size, height: size)
            .background(Circle().fill(WidgetPalette.live.opacity(0.25)).frame(width: size * 2, height: size * 2))
            .frame(width: size * 2, height: size * 2)
            .widgetAccentable()
    }
}

/// "● Learning Swift" + "● Since 20:07" (or "Starting…" until the server has it).
struct WidgetRunningTitle: View {
    let r: WidgetSnapshot.Running
    var lines = 1
    var size: CGFloat = 14
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                WidgetTaskDot(hex: r.accentHex, size: 8).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                Text(r.taskName).font(.system(size: size, weight: .semibold)).lineLimit(lines)
            }
            HStack(spacing: 3) {
                WidgetLiveDot(size: 5)
                Group {
                    if r.pending == true { Text("Starting…") } else { Text("Since \(DayCalc.current.format(Date(ms: r.startTime), "HH:mm"))") }
                }
                .font(.system(size: 11.5)).foregroundStyle(.secondary)
                .contentTransition(.opacity)
            }
            .padding(.leading, -1)
        }
    }
}

/// Elapsed clock, ticking on its own.
struct WidgetClock: View {
    let start: Int64
    var size: CGFloat
    var body: some View {
        Text(timerInterval: Date(ms: start)...Date.distantFuture, countsDown: false)
            .font(.system(size: size, weight: .medium, design: .rounded))
            .monospacedDigit()
            .lineLimit(1)
            .minimumScaleFactor(0.55)
            .contentTransition(.numericText())
            .widgetAccentable()
    }
}

struct WidgetStopPill: View {
    var full = true
    var height: CGFloat = 30
    var body: some View {
        Button(intent: WidgetStopIntent()) {
            Label("Stop", systemImage: "stop.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(.red)
                .padding(.horizontal, 16)
                .frame(maxWidth: full ? .infinity : nil, minHeight: height)
                .background(Color.red.opacity(0.14), in: Capsule())
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

/// "Not tracking" / "3h 12m".
struct WidgetTodayHero: View {
    let s: WidgetSnapshot
    let now: Date
    var size: CGFloat = 30
    var label: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(label ?? (s.running == nil ? "Not tracking" : "Today")).font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
            Text(Fmt.durationWords(s.todayTotal(now: now)))
                .font(.system(size: size, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .lineLimit(1).minimumScaleFactor(0.6)
                .contentTransition(.numericText())
                .widgetAccentable()
                .invalidatableContent()
        }
    }
}

/// One task row: dot · name · today · ▶ (■ on the running one). Tapping starts / switches, or stops the running one.
struct WidgetTaskRow: View {
    let t: WidgetSnapshot.TaskItem
    var running = false
    var showToday = true
    var height: CGFloat? = nil
    var body: some View {
        Button(intent: WidgetStartIntent(taskId: t.id)) {
            HStack(spacing: 8) {
                WidgetTaskDot(hex: t.accentHex, size: 7)
                Text(t.name)
                    .font(.system(size: 13, weight: running ? .semibold : .regular))
                    .lineLimit(1)
                Spacer(minLength: 4)
                if showToday && t.todayMs > 0 {
                    Text(Fmt.durationWords(t.todayMs)).font(.system(size: 12)).monospacedDigit().foregroundStyle(.secondary)
                        .contentTransition(.numericText())
                        .invalidatableContent()
                }
                Group {
                    if running {
                        // Solid red disc with a white square, like the Stop pill's colour.
                        Image(systemName: "stop.circle.fill")
                            .symbolRenderingMode(.palette)
                            .foregroundStyle(.white, .red)
                    } else {
                        Image(systemName: "play.circle")
                            .symbolRenderingMode(.hierarchical)
                            .foregroundStyle(.secondary)
                    }
                }
                .font(.system(size: 20, weight: .light))
                .contentTransition(.symbolEffect(.replace))
            }
            .frame(maxWidth: .infinity, maxHeight: height == nil ? .infinity : nil)
            .frame(height: height)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(running ? "Stop \(t.name)" : "Start \(t.name)")
    }
}

/// "Tasks            Today 32m  ‹ ›".
struct WidgetListHeader: View {
    let title: String
    var trailing: String?
    var page: Int = 0
    var pages: Int = 1
    var body: some View {
        HStack(spacing: 10) {
            Text(title).font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            if let trailing {
                Text(trailing).font(.system(size: 12)).monospacedDigit().foregroundStyle(.secondary)
                    .contentTransition(.numericText())
            }
            if pages > 1 {
                HStack(spacing: 2) {
                    pager("chevron.left", -1)
                    pager("chevron.right", 1)
                }
            }
        }
        .frame(height: WidgetLayout.listHeader)
    }

    private func pager(_ symbol: String, _ delta: Int) -> some View {
        Button(intent: WidgetPageIntent(delta: delta)) {
            Image(systemName: symbol).font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
                .frame(width: 26, height: 22)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(delta < 0 ? "Previous tasks" : "More tasks")
    }
}

/// A page of task rows that slides in from the side it was paged to.
struct WidgetTaskPage: View {
    let s: WidgetSnapshot
    let tasks: [WidgetSnapshot.TaskItem]
    let perPage: Int
    let page: Int
    let direction: Int
    var body: some View {
        let r = WidgetPaging.range(page: page, perPage: perPage, total: tasks.count)
        VStack(spacing: 0) {
            ForEach(Array(tasks[r])) { t in
                WidgetTaskRow(t: t, running: t.id == s.running?.taskId, height: WidgetLayout.rowHeight)
            }
        }
        .frame(maxWidth: .infinity, alignment: .top)
        .id("page-\(page)")
        .transition(.push(from: direction < 0 ? .leading : .trailing))
    }
}

// MARK: - Heat map

/// GitHub-style map of tracked hours per day, drawn in one Canvas (a handful of views, not ~180).
struct WidgetHeatMap: View {
    let s: WidgetSnapshot
    let now: Date
    let width: CGFloat
    var color = WidgetColorMode()
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let cell = WidgetLayout.heatCell, gap = WidgetLayout.heatGap
        let weeks = WidgetHeat.weeksFor(width: Double(width), cell: cell, gap: gap)
        if let g = s.heatGrid(now: now, weeks: weeks) {
            VStack(alignment: .leading, spacing: 0) {
                Canvas { ctx, size in draw(ctx, size, g, CGFloat(cell), CGFloat(gap)) }
                    .frame(height: CGFloat(WidgetLayout.heatLabels + 7 * cell + 6 * gap))
                    .widgetAccentable()
                HStack {
                    Text(WidgetHeat.caption(weeks: weeks))
                    Spacer()
                    Text(Fmt.durationWords(Int64(g.totalMinutes) * MINUTE_MS)).monospacedDigit()
                        .contentTransition(.numericText())
                }
                .font(.system(size: 11)).foregroundStyle(.secondary)
                .frame(height: CGFloat(WidgetLayout.heatCaption), alignment: .bottom)
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("\(WidgetHeat.caption(weeks: weeks)): \(Fmt.durationWords(Int64(g.totalMinutes) * MINUTE_MS)) tracked")
        }
    }

    private func draw(_ ctx: GraphicsContext, _ size: CGSize, _ g: WidgetHeat.Grid, _ cell: CGFloat, _ gap: CGFloat) {
        let full = color.fullColor
        let dark = scheme == .dark
        let gridW = CGFloat(g.weeks) * cell + CGFloat(g.weeks - 1) * gap
        let x0 = max(0, (size.width - gridW) / 2)
        let y0 = CGFloat(WidgetLayout.heatLabels)
        for m in g.months {
            let label = Text(m.label).font(.system(size: 10)).foregroundStyle(.secondary)
            ctx.draw(label, at: CGPoint(x: x0 + CGFloat(m.week) * (cell + gap), y: 0), anchor: .topLeading)
        }
        let radius = cell * 0.26
        for (w, col) in g.cells.enumerated() {
            for (r, minutes) in col.enumerated() where minutes >= 0 {
                let rect = CGRect(x: x0 + CGFloat(w) * (cell + gap), y: y0 + CGFloat(r) * (cell + gap), width: cell, height: cell)
                ctx.fill(Path(roundedRect: rect, cornerRadius: radius, style: .continuous),
                         with: .color(WidgetPalette.heat(WidgetHeat.level(minutes), fullColor: full, dark: dark)))
            }
        }
        // Today: a ring around its cell.
        let t = CGRect(x: x0 + CGFloat(g.todayWeek) * (cell + gap), y: y0 + CGFloat(g.todayRow) * (cell + gap), width: cell, height: cell)
            .insetBy(dx: -1.2, dy: -1.2)
        ctx.stroke(Path(roundedRect: t, cornerRadius: radius + 1.2, style: .continuous), with: .color(.primary.opacity(0.55)), lineWidth: 1.2)
    }
}

// MARK: - Team

struct WidgetAvatar: View {
    let m: TeamSnapshot.Member
    var size: CGFloat = 22
    var color = WidgetColorMode()
    var body: some View {
        // Tinted / accented modes flatten colours to one tint: a solid disc would swallow the letter.
        Text(String(Accent.initials(m.name).prefix(1)))
            .font(.system(size: size * 0.46, weight: .semibold, design: .rounded))
            .foregroundStyle(color.fullColor ? AnyShapeStyle(Color.white) : AnyShapeStyle(.primary))
            .frame(width: size, height: size)
            .background(Circle().fill(color.fullColor ? Color(hex: Accent.colorForId(m.userId)) : Color.primary.opacity(0.18)))
    }
}

/// Name (+ ● current task when live) and today's hours.
struct WidgetTeamRow: View {
    let m: TeamSnapshot.Member
    let now: Date
    var me = false
    var twoLine = false
    var avatar: CGFloat = 22
    var body: some View {
        HStack(spacing: 9) {
            WidgetAvatar(m: m, size: avatar)
            if twoLine {
                VStack(alignment: .leading, spacing: 1) {
                    Text(m.name).font(.system(size: 13, weight: me ? .semibold : .regular)).lineLimit(1)
                    if m.live, let task = m.taskName, !task.isEmpty { liveTask(task) }
                }
            } else {
                Text(m.name).font(.system(size: 12.5, weight: me ? .semibold : .regular)).lineLimit(1).layoutPriority(1)
                if m.live, let task = m.taskName, !task.isEmpty { liveTask(task) }
            }
            Spacer(minLength: 4)
            Text(Fmt.durationWords(m.todayLive(now: now)))
                .font(.system(size: 12.5, weight: m.live ? .semibold : .regular)).monospacedDigit()
                .foregroundStyle(m.live ? .primary : .secondary)
                .contentTransition(.numericText())
        }
    }

    private func liveTask(_ task: String) -> some View {
        HStack(spacing: 3) {
            WidgetLiveDot(size: 5)
            Text(task).font(.system(size: 11.5)).foregroundStyle(.secondary).lineLimit(1)
        }
    }
}

/// "Team today · 16h 45m" + rows (inside the large timer widget).
struct WidgetTeamSection: View {
    let team: TeamSnapshot
    let now: Date
    let maxRows: Int
    var body: some View {
        let rows = team.rows(now: now)
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("Team today").font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
                Spacer()
                Text(Fmt.durationWords(team.totalMs(now: now))).font(.system(size: 12)).monospacedDigit().foregroundStyle(.secondary)
                    .contentTransition(.numericText())
            }
            .frame(height: WidgetLayout.teamHeader)
            ForEach(Array(rows.prefix(maxRows))) { m in
                WidgetTeamRow(m: m, now: now, me: m.userId == team.myId, avatar: 18)
                    .frame(height: WidgetLayout.teamRowHeight)
            }
        }
    }
}

// MARK: - Timer widget families

struct TimerWidgetContent: View {
    @Environment(\.widgetFamily) private var family
    let data: TimerWidgetData
    let now: Date

    var body: some View {
        let s = data.snapshot
        Group {
            if !s.signedIn {
                WidgetSignedOut()
            } else {
                switch family {
                case .systemMedium: WidgetMedium(s: s, now: now)
                case .systemLarge: WidgetLarge(data: data, now: now)
                case .systemExtraLarge: WidgetExtraLarge(data: data, now: now)
                default: WidgetSmall(s: s, now: now)
                }
            }
        }
    }
}

struct WidgetSmall: View {
    let s: WidgetSnapshot
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let r = s.running {
                WidgetRunningTitle(r: r, lines: 2)
                Spacer(minLength: 4)
                WidgetClock(start: r.startTime, size: 30)
                WidgetStopPill().padding(.top, 6)
            } else if s.tasks.isEmpty {
                WidgetTodayHero(s: s, now: now)
                Spacer()
                Text("Create a task in Trackify to start.").font(.system(size: 11)).foregroundStyle(.secondary)
            } else {
                WidgetTodayHero(s: s, now: now)
                Spacer(minLength: 6)
                VStack(spacing: 0) {
                    ForEach(Array(s.tasks.prefix(3))) { t in WidgetTaskRow(t: t, showToday: false) }
                }
                .frame(maxHeight: 78)
            }
        }
        .transition(.opacity)
        .id(s.running?.taskId ?? "idle")
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(URL(string: s.running.map { "trackify://task/\($0.taskId)" } ?? "trackify://home"))
    }
}

struct WidgetMedium: View {
    let s: WidgetSnapshot
    let now: Date

    var body: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 0) {
                if let r = s.running {
                    WidgetRunningTitle(r: r)
                    Spacer(minLength: 4)
                    WidgetClock(start: r.startTime, size: 32)
                    WidgetStopPill().padding(.top, 6)
                } else {
                    WidgetTodayHero(s: s, now: now, size: 32)
                    Spacer()
                    if let last = s.lastTask {
                        Text("Last: \(last.name)").font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
            .id(s.running?.taskId ?? "idle")
            .transition(.opacity)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)

            VStack(alignment: .leading, spacing: 0) {
                Text(s.running == nil ? "Start" : "Switch to").font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
                    .padding(.bottom, 2)
                ForEach(Array(s.tasks.filter { $0.id != s.running?.taskId }.prefix(4))) { t in WidgetTaskRow(t: t, showToday: false) }
                if s.tasks.isEmpty { Spacer() }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        }
        .widgetURL(URL(string: "trackify://home"))
    }
}

/// The top block of the large widgets: running task + clock + Stop, or "Not tracking" + today's total.
struct WidgetLargeHero: View {
    let s: WidgetSnapshot
    let now: Date
    var body: some View {
        Group {
            if let r = s.running {
                HStack(alignment: .bottom) {
                    VStack(alignment: .leading, spacing: 0) {
                        WidgetRunningTitle(r: r, size: 15)
                        WidgetClock(start: r.startTime, size: 36)
                    }
                    Spacer(minLength: 8)
                    WidgetStopPill(full: false, height: 34).padding(.bottom, 3)
                }
            } else {
                WidgetTodayHero(s: s, now: now, size: 34)
            }
        }
        .frame(height: WidgetLayout.heroHeight(running: s.running != nil), alignment: .topLeading)
        .frame(maxWidth: .infinity, alignment: .leading)
        .id(s.running?.taskId ?? "idle")
        .transition(.opacity.combined(with: .scale(scale: 0.97, anchor: .topLeading)))
    }
}

/// Divider with the section spacing of `WidgetLayout.sectionGap`.
struct WidgetSectionDivider: View {
    var body: some View {
        Divider().frame(height: WidgetLayout.sectionGap)
    }
}

struct WidgetTaskList: View {
    let data: TimerWidgetData
    let now: Date
    let rows: Int
    var body: some View {
        let s = data.snapshot
        let pages = WidgetPaging.pages(total: s.tasks.count, perPage: rows)
        let page = WidgetPaging.page(raw: data.pageRaw, pages: pages)
        VStack(spacing: 0) {
            WidgetListHeader(title: s.running == nil ? "Start" : "Tasks",
                             trailing: s.running == nil ? nil : "Today \(Fmt.durationWords(s.todayTotal(now: now)))",
                             page: page, pages: pages)
            if s.tasks.isEmpty {
                Text("Create a task in Trackify to start.").font(.system(size: 12)).foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.top, 6)
            } else {
                WidgetTaskPage(s: s, tasks: s.tasks, perPage: rows, page: page, direction: data.pageDirection)
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
    }
}

struct WidgetLarge: View {
    let data: TimerWidgetData
    let now: Date

    var body: some View {
        GeometryReader { geo in
            let s = data.snapshot
            let teamRows = data.team.rows(now: now).count
            let blocks = WidgetLayout.largeBlocks(height: Double(geo.size.height), running: s.running != nil,
                                                  hasHeat: s.heatDays != nil, teamMembers: teamRows, taskCount: s.tasks.count)
            VStack(alignment: .leading, spacing: 0) {
                WidgetLargeHero(s: s, now: now)
                WidgetSectionDivider()
                WidgetTaskList(data: data, now: now, rows: blocks.rows)
                if blocks.heat {
                    WidgetSectionDivider()
                    WidgetLink(url: "trackify://stats") {
                        WidgetHeatMap(s: s, now: now, width: geo.size.width)
                    }
                }
                if blocks.team {
                    WidgetSectionDivider()
                    WidgetLink(url: "trackify://team") {
                        WidgetTeamSection(team: data.team, now: now, maxRows: blocks.teamRows)
                    }
                }
            }
            .frame(width: geo.size.width, height: geo.size.height, alignment: .topLeading)
        }
        .widgetURL(URL(string: "trackify://home"))
    }
}

/// iPad / Mac extra large: timer + tasks on the left, heat map + team on the right.
struct WidgetExtraLarge: View {
    let data: TimerWidgetData
    let now: Date

    var body: some View {
        GeometryReader { geo in
            let s = data.snapshot
            let colW = (geo.size.width - 28) / 2
            let listH = Double(geo.size.height) - WidgetLayout.heroHeight(running: s.running != nil) - WidgetLayout.sectionGap - WidgetLayout.listHeader
            let rows = max(WidgetLayout.minRows, min(WidgetLayout.maxRows, Int(listH / WidgetLayout.rowHeight)))
            HStack(alignment: .top, spacing: 28) {
                VStack(alignment: .leading, spacing: 0) {
                    WidgetLargeHero(s: s, now: now)
                    WidgetSectionDivider()
                    WidgetTaskList(data: data, now: now, rows: rows)
                }
                .frame(width: colW, height: geo.size.height, alignment: .topLeading)

                VStack(alignment: .leading, spacing: 0) {
                    if s.heatDays != nil {
                        WidgetLink(url: "trackify://stats") {
                            WidgetHeatMap(s: s, now: now, width: colW)
                        }
                        WidgetSectionDivider()
                    }
                    let used = (s.heatDays != nil ? WidgetLayout.heatHeight() + WidgetLayout.sectionGap : 0) + WidgetLayout.teamHeader
                    let teamRows = max(1, Int((Double(geo.size.height) - used) / WidgetLayout.teamRowHeight))
                    WidgetLink(url: "trackify://team") {
                        if data.team.rows(now: now).isEmpty {
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Team today").font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
                                    .frame(height: WidgetLayout.teamHeader)
                                Text(data.team.loaded ? "Nobody has tracked time today." : "Open Trackify to load your team.")
                                    .font(.system(size: 12)).foregroundStyle(.secondary)
                            }
                        } else {
                            WidgetTeamSection(team: data.team, now: now, maxRows: teamRows)
                        }
                    }
                    Spacer(minLength: 0)
                }
                .frame(width: colW, height: geo.size.height, alignment: .topLeading)
            }
        }
        .widgetURL(URL(string: "trackify://home"))
    }
}

struct WidgetSignedOut: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Image(systemName: "timer").font(.system(size: 22, weight: .medium)).foregroundStyle(.green).widgetAccentable()
            Spacer()
            Text("Trackify").font(.system(size: 14, weight: .semibold))
            Text("Open Trackify and sign in to start tracking.").font(.system(size: 11.5)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .widgetURL(URL(string: "trackify://home"))
    }
}

// MARK: - Team today widget

struct TeamWidgetContent: View {
    @Environment(\.widgetFamily) private var systemFamily
    let team: TeamSnapshot
    let signedIn: Bool
    let now: Date
    /// Review renders pick the family (the environment value can't be set off-screen).
    var familyOverride: WidgetFamily?
    private var family: WidgetFamily { familyOverride ?? systemFamily }

    var body: some View {
        Group {
            if !signedIn {
                WidgetSignedOut()
            } else {
                let rows = team.rows(now: now)
                switch family {
                case .systemSmall: small(rows)
                case .systemMedium: list(rows, max: 2)
                default: list(rows, max: family == .systemExtraLarge ? 7 : 8)
                }
            }
        }
        .widgetURL(URL(string: "trackify://team"))
    }

    private var tracking: Int { team.trackingCount(now: now) }

    private func header(compact: Bool) -> some View {
        HStack(spacing: 4) {
            Text(compact ? "Team" : "Team · today").font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            if tracking > 0 {
                WidgetLiveDot(size: 5)
                Text("\(tracking) tracking").font(.system(size: 11.5)).foregroundStyle(.secondary).lineLimit(1)
                    .contentTransition(.numericText())
            }
        }
    }

    private var total: some View {
        Text(Fmt.durationWords(team.totalMs(now: now)))
            .font(.system(size: 30, weight: .semibold, design: .rounded)).monospacedDigit()
            .lineLimit(1).minimumScaleFactor(0.6)
            .contentTransition(.numericText())
            .widgetAccentable()
    }

    @ViewBuilder private func empty() -> some View {
        Text(team.loaded ? "Nobody has tracked time today." : "Open Trackify to load your team.")
            .font(.system(size: 12)).foregroundStyle(.secondary)
    }

    private func small(_ rows: [TeamSnapshot.Member]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header(compact: true)
            total.padding(.top, 2)
            Text("today").font(.system(size: 11)).foregroundStyle(.secondary)
            Spacer(minLength: 6)
            if rows.isEmpty { empty() }
            VStack(spacing: 5) {
                ForEach(Array(rows.prefix(2))) { m in
                    HStack(spacing: 6) {
                        WidgetAvatar(m: m, size: 18)
                        Text(m.name.split(separator: " ").first.map(String.init) ?? m.name)
                            .font(.system(size: 12, weight: m.userId == team.myId ? .semibold : .regular)).lineLimit(1)
                        if m.live { WidgetLiveDot(size: 4) }
                        Spacer(minLength: 2)
                        Text(Fmt.durationWords(m.todayLive(now: now))).font(.system(size: 11.5)).monospacedDigit().foregroundStyle(.secondary)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func list(_ rows: [TeamSnapshot.Member], max n: Int) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            header(compact: false)
            total.padding(.top, 1)
            Divider().padding(.vertical, 8)
            if rows.isEmpty { empty() }
            VStack(spacing: 8) {
                ForEach(Array(rows.prefix(n))) { m in
                    WidgetTeamRow(m: m, now: now, me: m.userId == team.myId, twoLine: true, avatar: 28)
                }
            }
            Spacer(minLength: 0)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - Samples (widget gallery previews, placeholders, review renders)

enum WidgetSamples {
    static func snapshot(running: Bool, now: Date = Date()) -> WidgetSnapshot {
        let names = ["Code review", "Client portal redesign", "Learning Swift", "Bombay kitchen hub", "Research: pricing",
                     "Standup", "Design system", "Emails & admin", "Hiring", "Docs"]
        let today: [Int64] = [21, 10, 0, 45, 0, 15, 0, 30, 0, 0]
        let tasks = names.enumerated().map { i, n in
            WidgetSnapshot.TaskItem(id: "\(i + 1)", name: n, accentHex: Accent.taskAccentHex("\(i + 1)"),
                                    todayMs: today[i] * MINUTE_MS, totalMs: Int64(50 - i * 4) * HOUR_MS)
        }
        return WidgetSnapshot(
            signedIn: true, serverUrl: "", userId: "me", updatedAt: now.ms,
            running: running ? .init(taskId: "1", taskName: "Code review", accentHex: Accent.taskAccentHex("1"), startTime: now.ms - 103 * 60_000) : nil,
            todayTotalMs: 2 * HOUR_MS + 1 * MINUTE_MS, todayKey: DayCalc.current.dayKey(now), tasks: tasks,
            heatDays: heatDays(now: now), heatEndKey: DayCalc.current.dayKey(now))
    }

    /// A believable half year: busy weekdays, a few weekends, a slow start and a holiday week.
    static func heatDays(now: Date) -> [Int] {
        let calc = DayCalc.current
        let n = WidgetHeat.days
        let start = calc.addDays(calc.startOfDay(now), -(n - 1))
        return (0..<n).map { i in
            let d = calc.addDays(start, i)
            let wd = calc.weekdayIndex(d)
            var h = UInt32(truncatingIfNeeded: i &* 2654435761)
            h ^= h >> 13
            let r = Int(h % 100)
            if i < 24 { return r < 10 ? 40 : 0 }
            if (95...101).contains(i) { return 0 }
            if wd >= 5 { return r < 22 ? [30, 90, 200][r % 3] : 0 }
            if r < 6 { return 0 }
            if r < 14 { return 100 }
            if r < 26 { return 250 }
            return 380 + r * 2
        }
    }

    static func team(now: Date = Date()) -> TeamSnapshot {
        TeamSnapshot(day: DayCalc.current.dayKey(now), fetchedAt: now.ms, myId: "me", members: [
            .init(userId: "alex", name: "Alex Native", todayMs: 6 * HOUR_MS + 13 * MINUTE_MS, startTime: now.ms - 42 * MINUTE_MS, taskName: "Client onboarding"),
            .init(userId: "me", name: "Nina Native", todayMs: 2 * HOUR_MS + 1 * MINUTE_MS),
            .init(userId: "jakub", name: "Jakub Rana", todayMs: 3 * HOUR_MS + 40 * MINUTE_MS, startTime: now.ms - 15 * MINUTE_MS, taskName: "Kitchen hub"),
            .init(userId: "eva", name: "Eva Nováková", todayMs: 55 * MINUTE_MS),
            .init(userId: "tom", name: "Tom", todayMs: 0),
        ])
    }

    static func data(running: Bool, now: Date = Date(), page: Int = 0) -> TimerWidgetData {
        TimerWidgetData(snapshot: snapshot(running: running, now: now), team: team(now: now), pageRaw: page)
    }
}

// MARK: - Review renders

/// Every widget at its real size, for the off-screen review renders (iOS render tests, Mac `-TrackifyRenderWidgets`).
enum WidgetGallery {
    struct Case {
        let name: String
        let size: CGSize
        let view: AnyView
    }

    enum Device: String { case iphone, ipad, mac }

    static func sizes(_ d: Device) -> (small: CGSize, medium: CGSize, large: CGSize, xl: CGSize?) {
        switch d {
        case .iphone: return (CGSize(width: 170, height: 170), CGSize(width: 364, height: 170), CGSize(width: 364, height: 382), nil)
        case .ipad: return (CGSize(width: 170, height: 170), CGSize(width: 379, height: 170), CGSize(width: 379, height: 379), CGSize(width: 800, height: 379))
        case .mac: return (CGSize(width: 170, height: 170), CGSize(width: 364, height: 170), CGSize(width: 364, height: 382), CGSize(width: 752, height: 382))
        }
    }

    static func cases(_ d: Device, now: Date = Date()) -> [Case] {
        let z = sizes(d)
        let run = WidgetSamples.data(running: true, now: now)
        let idle = WidgetSamples.data(running: false, now: now)
        var page2 = run; page2.pageRaw = 1
        var noHeat = idle; noHeat.snapshot.heatDays = nil
        var out: [Case] = []
        func add(_ name: String, _ size: CGSize, _ v: some View) { out.append(Case(name: name, size: size, view: AnyView(v))) }
        if d != .ipad {
            add("small-running", z.small, WidgetSmall(s: run.snapshot, now: now))
            add("small-idle", z.small, WidgetSmall(s: idle.snapshot, now: now))
            add("medium-running", z.medium, WidgetMedium(s: run.snapshot, now: now))
            add("medium-idle", z.medium, WidgetMedium(s: idle.snapshot, now: now))
            add("small-signedout", z.small, WidgetSignedOut())
        }
        add("large-running", z.large, WidgetLarge(data: run, now: now))
        add("large-idle", z.large, WidgetLarge(data: idle, now: now))
        if d == .iphone {
            add("large-running-page2", z.large, WidgetLarge(data: page2, now: now))
            add("large-idle-noheat", z.large, WidgetLarge(data: noHeat, now: now))
        }
        if let xl = z.xl {
            add("xl-running", xl, WidgetExtraLarge(data: run, now: now))
            add("xl-idle", xl, WidgetExtraLarge(data: idle, now: now))
        }
        let team = WidgetSamples.team(now: now)
        if d != .ipad {
            add("team-small", z.small, TeamWidgetContent(team: team, signedIn: true, now: now, familyOverride: .systemSmall))
            add("team-medium", z.medium, TeamWidgetContent(team: team, signedIn: true, now: now, familyOverride: .systemMedium))
        }
        add("team-large", z.large, TeamWidgetContent(team: team, signedIn: true, now: now, familyOverride: .systemLarge))
        if d == .iphone {
            add("team-medium-empty", z.medium, TeamWidgetContent(team: .empty, signedIn: true, now: now, familyOverride: .systemMedium))
        }
        return out
    }

    /// A home-screen / desktop-like tile around a widget. `look`: light, dark or tinted.
    static func tile(_ c: Case, look: String, desktop: Bool) -> some View {
        let dark = look != "light"
        let tinted = look == "tinted"
        let shape = RoundedRectangle(cornerRadius: desktop ? 22 : 24, style: .continuous)
        return ZStack {
            if tinted {
                c.view.padding(16)
                    .environment(\.widgetMonochromePreview, true)
                    .grayscale(1).brightness(0.3)
                    .foregroundStyle(.white)
            } else {
                c.view.padding(16)
            }
        }
        .frame(width: c.size.width, height: c.size.height)
        .background {
            shape.fill(tinted ? Color.white.opacity(0.16) : (dark ? Color(rgb: desktop ? 0x1F1F1F : 0x1C1C1E) : .white))
                .shadow(color: .black.opacity(desktop ? 0.18 : 0.08), radius: 8, y: 3)
        }
        .clipShape(shape)
        .padding(24)
        .background(LinearGradient(colors: tinted ? [Color(rgb: 0x3b5b7a), Color(rgb: 0x1e2f45)]
                                   : dark ? [Color(rgb: 0x273548), Color(rgb: 0x111827)] : [Color(rgb: 0xc7d8ea), Color(rgb: 0xe9dfd3)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing))
        .environment(\.colorScheme, dark ? .dark : .light)
        .environment(\.widgetOffscreenRender, true)
    }
}
