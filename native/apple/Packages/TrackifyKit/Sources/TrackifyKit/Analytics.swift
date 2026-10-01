import Foundation

/// Client-side computations the web does from `GET /api/tasks` (Home, Stats, Time Spent).
public enum Analytics {

    // MARK: Home task list

    /// Web sort: running first, tasks without events next, then most recent event `from` desc.
    public static func sortTasks(_ tasks: [TrackifyTask], runningTaskId: String?) -> [TrackifyTask] {
        let latest = Dictionary(uniqueKeysWithValues: tasks.map { ($0.id, $0.events.map(\.fromMs).max() ?? Int64.min) })
        return tasks.filter { !$0.hidden }.enumerated().sorted { lhs, rhs in
            let a = lhs.element, b = rhs.element
            let ar = a.id == runningTaskId, br = b.id == runningTaskId
            if ar != br { return ar }
            let ae = !a.events.isEmpty, be = !b.events.isEmpty
            if ae != be { return !ae }
            if ae && be {
                let la = latest[a.id]!, lb = latest[b.id]!
                if la != lb { return la > lb }
            }
            return lhs.offset < rhs.offset // stable (API order = name asc)
        }.map(\.element)
    }

    /// Adds the running stretch as a synthetic event (`tasksWithLiveTimer`).
    public static func withLive(_ tasks: [TrackifyTask], running: (taskId: String, startTime: Int64)?, now: Int64) -> [TrackifyTask] {
        guard let running else { return tasks }
        return tasks.map { t in
            guard t.id == running.taskId else { return t }
            var copy = t
            copy.events.append(TimeEvent(id: "live-timer", from: Date(ms: running.startTime), to: Date(ms: max(now, running.startTime)), taskId: t.id))
            return copy
        }
    }

    public static func taskMs(_ task: TrackifyTask, from: Date?, to: Date?) -> Int64 {
        guard let from, let to else { return task.totalMs }
        let a = from.ms, b = to.ms + 1
        return task.events.reduce(0) { $0 + overlapMs($1.fromMs, $1.toMs, a, b) }
    }

    /// Completed events today (local) — used by the widget snapshot and menu bar header.
    public static func todayMs(_ tasks: [TrackifyTask], now: Date = Date(), calc: DayCalc = .current) -> Int64 {
        let s = calc.startOfDay(now).ms, e = calc.endOfDay(now).ms + 1
        return tasks.reduce(0) { acc, t in acc + t.events.reduce(0) { $0 + overlapMs($1.fromMs, $1.toMs, s, e) } }
    }

    public static func todayMs(_ task: TrackifyTask, now: Date = Date(), calc: DayCalc = .current) -> Int64 {
        let s = calc.startOfDay(now).ms, e = calc.endOfDay(now).ms + 1
        return task.events.reduce(0) { $0 + overlapMs($1.fromMs, $1.toMs, s, e) }
    }

    // MARK: Stats page

    public enum StatsRange: String, CaseIterable, Sendable {
        case today, week, month, alltime, custom
        public var label: String {
            switch self { case .today: "Today"; case .week: "Week"; case .month: "Month"; case .alltime: "All Time"; case .custom: "Custom" }
        }
    }

    public struct Range: Equatable, Sendable {
        public var from: Date?
        public var to: Date?
        public var label: String
    }

    public static func range(_ type: StatsRange, customFrom: Date?, customTo: Date?, now: Date = Date(), calc: DayCalc = .current) -> Range {
        switch type {
        case .today: return Range(from: calc.startOfDay(now), to: calc.endOfDay(now), label: calc.format(now, "MMM d, yyyy"))
        case .week:
            let s = calc.startOfWeek(now), e = calc.endOfWeek(now)
            return Range(from: s, to: e, label: "\(calc.format(s, "MMM d")) – \(calc.format(e, "MMM d, yyyy"))")
        case .month:
            return Range(from: calc.startOfMonth(now), to: calc.endOfMonth(now), label: calc.format(now, "MMMM yyyy"))
        case .alltime: return Range(from: nil, to: nil, label: "All time")
        case .custom:
            let s = calc.startOfDay(customFrom ?? now), e = calc.endOfDay(customTo ?? now)
            return Range(from: s, to: e, label: "\(calc.format(s, "MMM d")) – \(calc.format(e, "MMM d, yyyy"))")
        }
    }

    public struct TaskTotal: Identifiable, Hashable, Sendable {
        public var task: TrackifyTask
        public var ms: Int64
        public var id: String { task.id }
    }

    public struct StatsSummary: Sendable {
        public var totals: [TaskTotal]
        public var totalMs: Int64
        public var dailyAverageMs: Int64
        public var topTasks: [TaskTotal]
    }

    public static func statsSummary(tasks: [TrackifyTask], range: Range, calc: DayCalc = .current) -> StatsSummary {
        let totals = tasks.map { TaskTotal(task: $0, ms: taskMs($0, from: range.from, to: range.to)) }
        let total = totals.reduce(0) { $0 + $1.ms }
        var avg: Int64 = 0
        if total > 0 {
            var days = Set<String>()
            for t in totals {
                for e in t.task.events {
                    let inRange: Bool
                    if let f = range.from, let to = range.to { inRange = overlapMs(e.fromMs, e.toMs, f.ms, to.ms + 1) > 0 }
                    else { inRange = e.durationMs > 0 }
                    if inRange { days.insert(calc.dayKey(e.from)) }
                }
            }
            avg = days.isEmpty ? total : Int64(Fmt.jsRound(Double(total) / Double(days.count)))
        }
        let top = totals.filter { $0.ms > 0 }.sorted { $0.ms > $1.ms }.prefix(5)
        return StatsSummary(totals: totals, totalMs: total, dailyAverageMs: avg, topTasks: Array(top))
    }

    public struct BreakdownRow: Identifiable, Sendable {
        public var id: String { key }
        public var key: String
        public var date: Date
        public var label: String
        public var detail: String
        public var numeric: String
        /// ms per top-task id, plus "__other".
        public var slices: [String: Int64]
        public var totalMs: Int64
    }

    public static let otherKey = "__other"

    /// "Daily breakdown": per day if ≤ 42 days, else per Monday-week.
    public static func breakdown(tasks: [TrackifyTask], range: Range, topIds: [String], now: Date = Date(), calc: DayCalc = .current) -> [BreakdownRow] {
        let chartFrom: Date, chartTo: Date
        if let f = range.from, let t = range.to { chartFrom = f; chartTo = t }
        else {
            let earliest = tasks.flatMap { $0.events.map(\.from) }.min()
            chartFrom = calc.startOfDay(earliest ?? Date(ms: now.ms - 29 * DAY_MS))
            chartTo = calc.endOfDay(now)
        }
        let days = calc.days(from: chartFrom, through: chartTo)
        let topSet = Set(topIds)

        func slices(for day: Date) -> [String: Int64] {
            let s = calc.startOfDay(day).ms, e = calc.endOfDay(day).ms + 1
            var out: [String: Int64] = [:]
            for task in tasks {
                var ms: Int64 = 0
                for ev in task.events { ms += overlapMs(ev.fromMs, ev.toMs, s, e) }
                if ms <= 0 { continue }
                let k = topSet.contains(task.id) ? task.id : otherKey
                out[k, default: 0] += ms
            }
            return out
        }

        if days.count <= 42 {
            return days.map { d in
                let sl = slices(for: d)
                return BreakdownRow(key: calc.dayKey(d), date: d, label: calc.format(d, "MMM d"), detail: calc.format(d, "EEEE, MMM d, yyyy"),
                                    numeric: calc.format(d, "d.M.yyyy"), slices: sl, totalMs: sl.values.reduce(0, +))
            }
        }
        var order: [String] = []
        var buckets: [String: BreakdownRow] = [:]
        for d in days {
            let ws = calc.startOfWeek(d)
            let key = calc.dayKey(ws)
            if buckets[key] == nil {
                order.append(key)
                buckets[key] = BreakdownRow(key: key, date: ws, label: calc.format(ws, "MMM d"), detail: "Week of \(calc.format(ws, "MMMM d, yyyy"))",
                                            numeric: calc.format(ws, "d.M.yyyy"), slices: [:], totalMs: 0)
            }
            for (k, v) in slices(for: d) { buckets[key]!.slices[k, default: 0] += v; buckets[key]!.totalMs += v }
        }
        return order.compactMap { buckets[$0] }
    }

    public struct GroupTotals: Identifiable, Sendable {
        public var group: TaskGroup
        public var ms: Int64
        public var members: [TaskTotal]
        public var orphanIds: [String]
        public var id: String { group.id }
    }

    /// Saved groups card — ALL-TIME totals regardless of the selected range.
    public static func groupTotals(groups: [TaskGroup], tasks: [TrackifyTask]) -> [GroupTotals] {
        let map = Dictionary(tasks.map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        return groups.map { g in
            var orphans: [String] = []
            var members: [TaskTotal] = []
            for id in g.taskIds {
                guard let t = map[id] else { orphans.append(id); continue }
                members.append(TaskTotal(task: t, ms: t.totalMs))
            }
            members.sort { $0.ms > $1.ms }
            return GroupTotals(group: g, ms: members.reduce(0) { $0 + $1.ms }, members: members, orphanIds: orphans)
        }
    }

    public static func groupCopyText(_ g: GroupTotals) -> String {
        var lines = ["\(g.group.name) — \(Fmt.fmtMs(g.ms))"]
        lines += g.members.map { "  · \($0.task.name): \(Fmt.fmtMs($0.ms))" }
        if !g.orphanIds.isEmpty { lines.append("  · \(g.orphanIds.count) removed task(s) (no longer in app)") }
        return lines.joined(separator: "\n")
    }

    // MARK: Home "Time Spent" colours

    /// Weekly colour mapping: top 5 by time in the 10-day window ending today; live task (if not top) keeps its yearly colour.
    public static func weeklyTaskColors(tasks: [TrackifyTask], liveTaskId: String?, now: Date = Date(), calc: DayCalc = .current) -> (colors: [String: String], hasOther: Bool, order: [String]) {
        let rangeEnd = calc.endOfDay(now)
        let rangeStart = calc.startOfDay(calc.addDays(rangeEnd, -9))
        let totals = tasks.map { t in (t, t.events.reduce(Int64(0)) { $0 + overlapMs($1.fromMs, $1.toMs, rangeStart.ms, rangeEnd.ms) }) }
            .filter { $0.1 > 0 }.sorted { $0.1 > $1.1 }
        let top = totals.prefix(5)
        var colors: [String: String] = [:]
        var order: [String] = []
        for (i, (t, _)) in top.enumerated() { colors[t.name] = Accent.taskChartPalette[i % 6]; order.append(t.name) }
        let hasOther = totals.count > 5
        if let liveTaskId, let live = tasks.first(where: { $0.id == liveTaskId }), colors[live.name] == nil {
            let yearly = yearlyTaskColors(tasks: tasks)
            colors[live.name] = yearly[live.name] ?? Accent.taskChartPalette[0]
            order.append(live.name)
        }
        return (colors, hasOther, order)
    }

    /// Yearly colour mapping: visible tasks in API order (name asc), index i → palette[i % 6].
    public static func yearlyTaskColors(tasks: [TrackifyTask]) -> [String: String] {
        var m: [String: String] = [:]
        for (i, t) in tasks.enumerated() { m[t.name] = Accent.taskChartPalette[i % 6] }
        return m
    }
}

// MARK: - Weekly heat grid (day × hour)

public struct HeatDayEvent: Hashable, Sendable {
    public var taskName: String
    public var from: Int64
    public var to: Int64
}

public struct HeatHourCell: Hashable, Sendable {
    public var totalMinutes: Double = 0
    public var taskMinutes: [String: Double] = [:]

    /// The task with the most minutes (ties: first max in insertion order ≈ JS stable sort).
    public var dominantTask: String? {
        guard totalMinutes > 0 else { return nil }
        return taskMinutes.max { a, b in a.value < b.value || (a.value == b.value && a.key > b.key) }?.key
    }
}

public struct HeatSegment: Hashable, Sendable {
    public var startFlat: Int
    public var endFlat: Int
    public var taskName: String
    public var bridgedEmptySlots: Int
}

public struct WeeklyHeatGrid: Sendable {
    public var days: [Date]
    public var grid: [[HeatHourCell]]
    public var maxMinutes: Double
    public var hasData: Bool
    public var eventsByDay: [String: [HeatDayEvent]]

    public static let daysToLoad = 1000

    public static func build(tasks: [TrackifyTask], now: Date = Date(), days count: Int = daysToLoad, calc: DayCalc = .current) -> WeeklyHeatGrid {
        let rangeEnd = calc.endOfDay(now)
        let rangeStart = calc.startOfDay(calc.addDays(now, -(count - 1)))
        let days = calc.days(from: rangeStart, through: rangeEnd)
        var index: [String: [HeatDayEvent]] = [:]
        for t in tasks {
            for e in t.events {
                var cur = calc.startOfDay(e.from)
                let end = e.to
                while cur <= end {
                    index[calc.dayKey(cur), default: []].append(HeatDayEvent(taskName: t.name, from: e.fromMs, to: e.toMs))
                    cur = calc.addDays(cur, 1)
                }
            }
        }
        var grid: [[HeatHourCell]] = []
        grid.reserveCapacity(days.count)
        var maxMin = 0.0
        var hasData = false
        for day in days {
            let evs = index[calc.dayKey(day)] ?? []
            var row = [HeatHourCell](repeating: HeatHourCell(), count: 24)
            if !evs.isEmpty {
                for h in 0..<24 {
                    let hs = calc.addHours(day, h).ms
                    let he = calc.addHours(day, h + 1).ms
                    var cell = HeatHourCell()
                    for ev in evs {
                        let o = overlapMs(ev.from, ev.to, hs, he)
                        if o > 0 {
                            let m = Double(o) / 60000
                            cell.totalMinutes += m
                            cell.taskMinutes[ev.taskName, default: 0] += m
                        }
                    }
                    if cell.totalMinutes > 0 { hasData = true; maxMin = max(maxMin, cell.totalMinutes) }
                    row[h] = cell
                }
            }
            grid.append(row)
        }
        return WeeklyHeatGrid(days: days, grid: grid, maxMinutes: maxMin > 0 ? maxMin : 1, hasData: hasData, eventsByDay: index)
    }

    /// Square size selection: squares-per-hour 1…6 closest to 12 px (min 10, gap 2).
    public static func metrics(availableWidth: Double) -> (squaresPerHour: Int, cellSize: Double) {
        let gap = 2.0
        if availableWidth <= 0 { return (1, 12) }
        var best = (1, 10.0)
        var bestDist = Double.infinity
        for sph in 1...6 {
            let n = Double(24 * sph)
            let size = ((availableWidth - (n - 1) * gap) / n).rounded(.down)
            if size < 10 { continue }
            let d = abs(size - 12)
            if d < bestDist { best = (sph, size); bestDist = d }
        }
        if bestDist == .infinity { return (1, max(8, ((availableWidth - 23 * gap) / 24).rounded(.down))) }
        return best
    }

    public static func opacity(_ value: Double, max: Double) -> Double {
        if value <= 0 { return 0.7 }
        return 0.2 + pow(value / max, 0.4) * 0.8
    }

    public static func segments(hourCells: [HeatHourCell], squaresPerHour sph: Int) -> [HeatSegment] {
        let maxBridge = Swift.max(sph, 2)
        let n = 24 * sph
        func dom(_ flat: Int) -> String? { hourCells[flat / sph].dominantTask }
        var out: [HeatSegment] = []
        var i = 0
        while i < n {
            guard let task = dom(i) else { i += 1; continue }
            var j = i + 1
            var bridged = 0
            while j < n {
                let tj = dom(j)
                if tj == task { j += 1; continue }
                if tj != nil { break }
                let gapStart = j
                var k = j
                while k < n && dom(k) == nil { k += 1 }
                let gapLen = k - gapStart
                if gapLen > maxBridge { break }
                if k >= n { break }
                if dom(k) != task { break }
                bridged += gapLen
                j = k + 1
            }
            out.append(HeatSegment(startFlat: i, endFlat: j - 1, taskName: task, bridgedEmptySlots: bridged))
            i = j
        }
        return out
    }

    public static func slotRange(day: Date, flat: Int, squaresPerHour sph: Int, calc: DayCalc = .current) -> (start: Int64, end: Int64) {
        let hour = flat / sph, sq = flat % sph
        let base = calc.addHours(calc.startOfDay(day), hour).ms
        let slice = 60.0 / Double(sph)
        return (base + Int64(Double(sq) * slice * 60000), base + Int64(Double(sq + 1) * slice * 60000))
    }

    /// Precise task window inside a segment (or nil → grid bounds).
    public static func preciseWindow(events: [HeatDayEvent], start: Int64, end: Int64, task: String) -> (Int64, Int64)? {
        let rel = events.filter { $0.taskName == task && $0.to > start && $0.from < end }
        guard !rel.isEmpty else { return nil }
        let s = max(start, rel.map(\.from).min()!)
        let e = min(end, rel.map(\.to).max()!)
        return e > s ? (s, e) : nil
    }

    public static func minutes(events: [HeatDayEvent], task: String, start: Int64, end: Int64) -> Double {
        events.filter { $0.taskName == task }.reduce(0) { $0 + Double(overlapMs($1.from, $1.to, start, end)) / 60000 }
    }

    public static func tooltipPlainText(day: Date, task: String, minutes: Double, timeLine: String, bridged: Int, squaresPerHour: Int, calc: DayCalc = .current) -> String {
        let norm = timeLine.replacingOccurrences(of: "\u{2013}", with: "-").replacingOccurrences(of: "\u{2014}", with: "-").replacingOccurrences(of: "\u{2192}", with: "->")
        var lines = ["Trackify - time segment", "", "Date: \(calc.format(day, "EEEE, MMMM d, yyyy"))", calc.format(day, "d.M.yyyy"), "",
                     "Task: \(task)", "Time logged: \(Fmt.heatMinutes(minutes))", "", norm]
        if bridged > 0 {
            lines += ["", "Streak gap (no logged time): \(Fmt.heatMinutes(Double(bridged) * (60.0 / Double(squaresPerHour))))"]
        }
        return lines.joined(separator: "\n")
    }
}

// MARK: - Yearly contribution calendar

public struct YearlyCalendarData: Sendable {
    /// weeks[w][d] — Monday-first days.
    public var weeks: [[Date]]
    /// grid[row=weekday][col=week] minutes.
    public var grid: [[Double]]
    public var maxMinutes: Double
    public var startDate: Date
    public var endDate: Date
    public var dayTaskMinutes: [String: [String: Double]]
    public var billingDayEarnings: [String: Double]? = nil
    public var billingDayCurrency: [String: String]? = nil
    public var working: [Double]

    public struct DayEvent: Sendable { public var taskName: String; public var from: Int64; public var to: Int64
        public init(taskName: String, from: Int64, to: Int64) { self.taskName = taskName; self.from = from; self.to = to } }

    public static func build(eventsByDate: [String: [DayEvent]], calendarEndDay: Date? = nil, now: Date = Date(), calc: DayCalc = .current) -> YearlyCalendarData? {
        var minT = Int64.max
        var any = false
        for list in eventsByDate.values { for e in list { any = true; minT = min(minT, e.from, e.to) } }
        guard any else { return nil }
        let rangeEnd = calc.endOfDay(calendarEndDay ?? now)
        let start = calc.startOfWeek(calc.startOfDay(Date(ms: minT)))
        let end = calc.endOfWeek(rangeEnd)
        return fill(start: start, end: end, eventsByDate: eventsByDate, calc: calc)
    }

    public static func empty(through end: Date = Date(), calc: DayCalc = .current) -> YearlyCalendarData {
        let e = calc.endOfDay(end)
        let start = calc.startOfWeek(calc.startOfYear(e))
        return fill(start: start, end: calc.endOfWeek(e), eventsByDate: [:], calc: calc)
    }

    static func fill(start: Date, end: Date, eventsByDate: [String: [DayEvent]], calc: DayCalc) -> YearlyCalendarData {
        var weeks: [[Date]] = []
        var cur = start
        while cur <= end {
            weeks.append((0..<7).map { calc.addDays(cur, $0) })
            cur = calc.addDays(cur, 7)
        }
        var grid = [[Double]](repeating: [Double](repeating: 0, count: weeks.count), count: 7)
        var dtm: [String: [String: Double]] = [:]
        var maxM = 0.0
        for (w, week) in weeks.enumerated() {
            for (d, day) in week.enumerated() {
                let key = calc.dayKey(day)
                let ds = calc.startOfDay(day).ms, de = calc.endOfDay(day).ms
                var total = 0.0
                var byTask: [String: Double] = [:]
                for ev in eventsByDate[key] ?? [] {
                    let m = Double(overlapMs(ev.from, ev.to, ds, de)) / 60000
                    total += m
                    byTask[ev.taskName, default: 0] += m
                }
                grid[d][w] = total
                dtm[key] = byTask
                maxM = max(maxM, total)
            }
        }
        return YearlyCalendarData(weeks: weeks, grid: grid, maxMinutes: maxM > 0 ? maxM : 1, startDate: start, endDate: end,
                                  dayTaskMinutes: dtm, working: HeatScale.workingDayMinutes(grid))
    }

    /// From tasks (Home "Yearly").
    public static func fromTasks(_ tasks: [TrackifyTask], now: Date = Date(), calc: DayCalc = .current) -> YearlyCalendarData {
        var byDate: [String: [DayEvent]] = [:]
        for t in tasks {
            for e in t.events {
                var cur = calc.startOfDay(e.from)
                while cur <= e.to {
                    byDate[calc.dayKey(cur), default: []].append(DayEvent(taskName: t.name, from: e.fromMs, to: e.toMs))
                    cur = calc.addDays(cur, 1)
                }
            }
        }
        return build(eventsByDate: byDate, now: now, calc: calc) ?? empty(through: now, calc: calc)
    }

    /// Billing activity calendar: each day = (overlap/sessionLength) × billed minutes.
    public static func fromBilling(_ sessions: [BillingSessionRow], calendarEndDay: Date?, now: Date = Date(), calc: DayCalc = .current) -> YearlyCalendarData {
        var byDate: [String: [DayEvent]] = [:]
        var earn: [String: Double] = [:]
        var cur: [String: String] = [:]
        for s in sessions {
            let from = s.from.ms, to = s.to.ms
            let total = max(1, to - from)
            var d = calc.startOfDay(s.from)
            let last = calc.startOfDay(s.to)
            while d <= last {
                let ds = calc.startOfDay(d).ms, de = calc.endOfDay(d).ms
                let o = overlapMs(from, to, ds, de)
                if o > 0 {
                    let key = calc.dayKey(d)
                    let billable = Double(o) / Double(total) * Double(s.durationMinutes) * 60000
                    let clip = min(Double(de), Double(ds) + billable)
                    if Double(ds) < clip { byDate[key, default: []].append(DayEvent(taskName: s.taskName, from: ds, to: Int64(clip))) }
                    earn[key, default: 0] += Double(o) / Double(total) * s.earnings
                    cur[key] = s.currency
                }
                d = calc.addDays(d, 1)
            }
        }
        var base = build(eventsByDate: byDate, calendarEndDay: calendarEndDay, now: now, calc: calc) ?? empty(through: calendarEndDay ?? now, calc: calc)
        base.billingDayEarnings = earn
        base.billingDayCurrency = cur
        return base
    }

    /// Month label above the first week column whose Monday's month differs from the previous column.
    public func monthLabels(calc: DayCalc = .current) -> [(index: Int, label: String)] {
        var out: [(Int, String)] = []
        var prev = -1
        for (i, w) in weeks.enumerated() {
            let m = calc.calendar.component(.month, from: w[0])
            if m != prev { out.append((i, calc.format(w[0], "MMM"))); prev = m }
        }
        return out
    }
}
