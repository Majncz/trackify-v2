import Foundation

// Pure logic behind the home-screen / desktop widgets: work heat map, which blocks of the large widget fit,
// task-list paging and the "Team today" rows. Kept here (not in the widget extension) so it's unit-tested.

// MARK: - Heat map

/// GitHub-style map of tracked minutes per local day: weeks as columns (Monday first), days as rows.
public enum WidgetHeat {
    /// Days of history the app keeps in the snapshot (26 weeks + the current partial week).
    public static let days = 26 * 7 + 6

    /// Minutes tracked per local day for the `count` days up to `end` (inclusive), oldest first.
    public static func minutesPerDay(tasks: [TrackifyTask], end: Date, count: Int = days, calc: DayCalc = .current) -> [Int] {
        let endDay = calc.startOfDay(end)
        let start = calc.addDays(endDay, -(count - 1))
        let startMs = start.ms
        var ms = [Int64](repeating: 0, count: count)
        for t in tasks {
            for e in t.events where e.toMs > startMs && e.toMs > e.fromMs {
                var from = max(e.fromMs, startMs)
                while from < e.toMs {
                    let d = calc.startOfDay(Date(ms: from))
                    let idx = calc.daysBetween(start, d)
                    guard idx >= 0 && idx < count else { break }
                    let to = min(e.toMs, calc.addDays(d, 1).ms)
                    ms[idx] += to - from
                    from = to
                }
            }
        }
        return ms.map { Int($0 / MINUTE_MS) }
    }

    /// 0 = nothing, 1…4 by hours tracked that day (<1h, <3h, <6h, 6h+).
    public static func level(_ minutes: Int) -> Int {
        switch minutes {
        case ...0: return 0
        case ..<60: return 1
        case ..<180: return 2
        case ..<360: return 3
        default: return 4
        }
    }

    /// Weeks (columns) that fit `width` points with cells of about `cell` and `gap` spacing; 8…26.
    public static func weeksFor(width: Double, cell: Double = 11, gap: Double = 2.5) -> Int {
        min(26, max(8, Int((width + gap) / (cell + gap))))
    }

    public struct Grid: Equatable, Sendable {
        /// cells[week][row Mon…Sun] = minutes, -1 = after today (not drawn).
        public var cells: [[Int]]
        public var todayWeek: Int
        public var todayRow: Int
        /// Month names over the first column of each month, spaced so they never collide.
        public var months: [Month]
        public var totalMinutes: Int
        public var weeks: Int { cells.count }

        public struct Month: Equatable, Sendable {
            public var week: Int
            public var label: String
        }
    }

    /// Builds the grid ending in the week of `today`. `days` end on the day `endKey` (a snapshot written earlier may
    /// end before today); today's cell uses `todayMinutes` (completed + the running stretch) when given.
    public static func grid(days: [Int], endKey: String?, today: Date, weeks: Int, todayMinutes: Int? = nil,
                            calc: DayCalc = .current) -> Grid {
        let todayStart = calc.startOfDay(today)
        let dataEnd = endKey.flatMap { calc.date(fromKey: $0) }.map { calc.startOfDay($0) } ?? todayStart
        let dataStart = calc.addDays(dataEnd, -(days.count - 1))
        let firstMonday = calc.addDays(calc.startOfWeek(todayStart), -7 * (weeks - 1))
        var cells: [[Int]] = []
        var total = 0
        for w in 0..<weeks {
            var col = [Int](repeating: 0, count: 7)
            for r in 0..<7 {
                let d = calc.addDays(firstMonday, w * 7 + r)
                if d > todayStart { col[r] = -1; continue }
                var m: Int
                if calc.isSameDay(d, todayStart), let todayMinutes {
                    m = todayMinutes
                } else {
                    let i = calc.daysBetween(dataStart, d)
                    m = (i >= 0 && i < days.count) ? days[i] : 0
                }
                m = max(0, m)
                col[r] = m
                total += m
            }
            cells.append(col)
        }
        let todayRow = calc.weekdayIndex(todayStart)
        return Grid(cells: cells, todayWeek: weeks - 1, todayRow: todayRow,
                    months: monthLabels(firstMonday: firstMonday, weeks: weeks, calc: calc), totalMinutes: total)
    }

    /// A label where the month (of the column's Thursday) changes; at least 3 columns apart and not in the last column.
    static func monthLabels(firstMonday: Date, weeks: Int, calc: DayCalc) -> [Grid.Month] {
        var out: [Grid.Month] = []
        var last = -1
        for w in 0..<weeks {
            let thu = calc.addDays(firstMonday, w * 7 + 3)
            let m = calc.calendar.component(.month, from: thu)
            if m != last {
                last = m
                if w > weeks - 2 { continue }
                if let prev = out.last, w - prev.week < 3 {
                    // The first (partial) month yields to a full one.
                    if out.count == 1 { out.removeLast() } else { continue }
                }
                out.append(.init(week: w, label: calc.format(thu, "MMM")))
            }
        }
        return out
    }

    /// "Last 25 weeks".
    public static func caption(weeks: Int) -> String { "Last \(weeks) weeks" }
}

// MARK: - Large widget layout

/// Which optional blocks of the large widget fit. The task list keeps at least three rows; the team goes first,
/// then the heat map. Heights are points at the default text size.
public enum WidgetLayout {
    public static let rowHeight: Double = 28
    public static let minRows = 3
    public static let maxRows = 8
    public static let sectionGap: Double = 17     // divider + spacing
    public static let listHeader: Double = 22
    public static func heroHeight(running: Bool) -> Double { running ? 70 : 56 }
    public static let heatCell: Double = 11
    public static let heatGap: Double = 2.5
    public static let heatLabels: Double = 13
    public static let heatCaption: Double = 17
    public static func heatHeight(cell: Double = heatCell, gap: Double = heatGap) -> Double { heatLabels + 7 * cell + 6 * gap + heatCaption }
    public static let teamHeader: Double = 22
    public static let teamRowHeight: Double = 26

    public struct Blocks: Equatable, Sendable {
        public var heat: Bool
        public var teamRows: Int
        public var rows: Int
        public var team: Bool { teamRows > 0 }
        public init(heat: Bool, teamRows: Int, rows: Int) { self.heat = heat; self.teamRows = teamRows; self.rows = rows }
    }

    /// `height` = content height inside the widget margins. `teamMembers` = rows the team block could show (0 = none).
    public static func largeBlocks(height: Double, running: Bool, hasHeat: Bool, teamMembers: Int, taskCount: Int) -> Blocks {
        let fixed = heroHeight(running: running) + sectionGap + listHeader
        let minList = Double(minRows) * rowHeight
        var left = height - fixed - minList
        let heatH = sectionGap + heatHeight()
        let heat = hasHeat && left >= heatH
        if heat { left -= heatH }
        var teamRows = 0
        if teamMembers > 0 {
            let spare = left - sectionGap - teamHeader
            if spare >= teamRowHeight {
                teamRows = min(teamMembers, 4, Int(spare / teamRowHeight))
                left -= sectionGap + teamHeader + Double(teamRows) * teamRowHeight
            }
        }
        let extra = max(0, Int(left / rowHeight))
        let rows = min(maxRows, minRows + extra)
        return Blocks(heat: heat, teamRows: teamRows, rows: max(minRows, min(rows, max(minRows, taskCount))))
    }
}

// MARK: - Paging

/// The large widget pages its task list with ‹ › (a widget can't scroll).
public enum WidgetPaging {
    public static func pages(total: Int, perPage: Int) -> Int {
        guard total > 0, perPage > 0 else { return 1 }
        return (total + perPage - 1) / perPage
    }

    /// Raw page counter wrapped into 0..<pages (past the last page comes the first again).
    public static func page(raw: Int, pages: Int) -> Int {
        let p = max(1, pages)
        return ((raw % p) + p) % p
    }

    public static func range(page: Int, perPage: Int, total: Int) -> Range<Int> {
        let lo = min(total, page * perPage)
        return lo..<min(total, lo + perPage)
    }
}

/// Page counter + last direction, shared by the widget buttons (intents) and the widget views.
public final class WidgetPageStore: @unchecked Sendable {
    public static let shared = WidgetPageStore()
    let defaults: UserDefaults
    let key = "trackify.widget.page"
    let dirKey = "trackify.widget.pageDir"
    public init(defaults: UserDefaults = AppGroup.defaults) { self.defaults = defaults }

    public var raw: Int { defaults.integer(forKey: key) }
    /// +1 after ›, -1 after ‹ (the page slides in from that side).
    public var direction: Int { defaults.integer(forKey: dirKey) == -1 ? -1 : 1 }

    public func move(_ delta: Int) {
        defaults.set(raw + delta, forKey: key)
        defaults.set(delta < 0 ? -1 : 1, forKey: dirKey)
    }

    public func reset() { if raw != 0 { defaults.set(0, forKey: key) } }
}

// MARK: - Team today

/// Today's team, as the Team tab's daily leaderboard reports it (GET /api/presence?range=day).
public struct TeamSnapshot: Codable, Equatable, Sendable {
    public struct Member: Codable, Equatable, Hashable, Sendable, Identifiable {
        public var userId: String
        public var name: String
        /// Completed time today; the running part is added at render time.
        public var todayMs: Int64
        public var startTime: Int64?
        public var taskName: String?
        public var id: String { userId }
        public var live: Bool { startTime != nil }

        public init(userId: String, name: String, todayMs: Int64, startTime: Int64? = nil, taskName: String? = nil) {
            self.userId = userId; self.name = name; self.todayMs = todayMs; self.startTime = startTime; self.taskName = taskName
        }

        public func todayLive(now: Date, calc: DayCalc = .current) -> Int64 {
            guard let s = startTime else { return todayMs }
            return todayMs + liveRangeMs(startTime: s, now: now.ms, rangeStart: calc.startOfDay(now), rangeEnd: calc.endOfDay(now))
        }
    }

    public var day: String
    public var fetchedAt: Int64
    public var myId: String?
    public var members: [Member]

    public init(day: String = "", fetchedAt: Int64 = 0, myId: String? = nil, members: [Member] = []) {
        self.day = day; self.fetchedAt = fetchedAt; self.myId = myId; self.members = members
    }

    public static let empty = TeamSnapshot()
    public var loaded: Bool { fetchedAt > 0 }

    public static func from(_ p: PresenceResponse, day: String, myId: String?, now: Date = Date()) -> TeamSnapshot {
        TeamSnapshot(day: day, fetchedAt: now.ms, myId: myId,
                     members: p.leaderboard.map { Member(userId: $0.userId, name: $0.name, todayMs: $0.todayMs, startTime: $0.startTime, taskName: $0.taskName) })
    }

    /// Members who tracked today (or are tracking now), most hours first; a snapshot from another day reads as empty.
    public func rows(now: Date = Date(), calc: DayCalc = .current) -> [Member] {
        guard day == calc.dayKey(now) else { return [] }
        return members.filter { $0.todayMs > 0 || $0.live }
            .sorted { a, b in
                let x = a.todayLive(now: now, calc: calc), y = b.todayLive(now: now, calc: calc)
                return x != y ? x > y : a.name.localizedCaseInsensitiveCompare(b.name) == .orderedAscending
            }
    }

    public func totalMs(now: Date = Date(), calc: DayCalc = .current) -> Int64 {
        rows(now: now, calc: calc).reduce(0) { $0 + $1.todayLive(now: now, calc: calc) }
    }

    public func trackingCount(now: Date = Date(), calc: DayCalc = .current) -> Int {
        rows(now: now, calc: calc).filter(\.live).count
    }

    /// A widget / app timer tap shown on this user's own row right away (the next fetch confirms it): what ran so
    /// far becomes completed time, the new run starts at its start time.
    public func applying(running r: WidgetSnapshot.Running?, userId: String?, now: Date = Date(), calc: DayCalc = .current) -> TeamSnapshot {
        guard loaded, day == calc.dayKey(now), let me = myId ?? userId,
              let i = members.firstIndex(where: { $0.userId == me }) else { return self }
        let m = members[i]
        if m.startTime == r?.startTime && (r == nil || m.taskName == r?.taskName) { return self }
        let until = min(now.ms, r?.startTime ?? now.ms)
        let done = m.todayMs + (m.startTime.map { liveRangeMs(startTime: $0, now: until, rangeStart: calc.startOfDay(now), rangeEnd: calc.endOfDay(now)) } ?? 0)
        var copy = self
        copy.members[i] = Member(userId: m.userId, name: m.name, todayMs: done, startTime: r?.startTime, taskName: r?.taskName)
        return copy
    }
}

public final class TeamSnapshotStore: @unchecked Sendable {
    public static let shared = TeamSnapshotStore()
    let defaults: UserDefaults
    let key = "trackify.widget-team.v1"
    public init(defaults: UserDefaults = AppGroup.defaults) { self.defaults = defaults }

    public func load() -> TeamSnapshot {
        guard let d = defaults.data(forKey: key), let s = try? JSONDecoder().decode(TeamSnapshot.self, from: d) else { return .empty }
        return s
    }

    public func save(_ s: TeamSnapshot) {
        if let d = try? JSONEncoder().encode(s) { defaults.set(d, forKey: key) }
    }

    public func clear() { defaults.removeObject(forKey: key) }
}
