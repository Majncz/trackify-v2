import Foundation

/// Leaderboard period logic (hooks/use-presence.ts + daily-leaderboard.tsx).
public enum Leaderboard {
    public static func noun(_ r: LeaderboardRange) -> String {
        switch r { case .day: "day"; case .week: "week"; case .month: "month" }
    }

    public static func isCurrent(_ range: LeaderboardRange, day: String, today: String, calc: DayCalc = .current) -> Bool {
        guard let sel = calc.date(fromKey: day), let now = calc.date(fromKey: today) else { return day == today }
        switch range {
        case .week: return calc.dayKey(calc.startOfWeek(sel)) == calc.dayKey(calc.startOfWeek(now))
        case .month: return calc.format(sel, "yyyy-MM") == calc.format(now, "yyyy-MM")
        case .day: return day == today
        }
    }

    public static func bounds(_ range: LeaderboardRange, day: String, calc: DayCalc = .current) -> (start: Date, end: Date) {
        let sel = calc.date(fromKey: day) ?? calc.startOfDay(Date())
        switch range {
        case .week: return (calc.startOfWeek(sel), calc.endOfWeek(sel))
        case .month: return (calc.startOfMonth(sel), calc.endOfMonth(sel))
        case .day: return (calc.startOfDay(sel), calc.endOfDay(sel))
        }
    }

    public static func step(_ range: LeaderboardRange, day: String, direction: Int, calc: DayCalc = .current) -> String {
        let sel = calc.date(fromKey: day) ?? Date()
        switch range {
        case .week: return calc.dayKey(calc.addDays(sel, 7 * direction))
        case .month: return calc.dayKey(calc.addMonths(sel, direction))
        case .day: return calc.dayKey(calc.addDays(sel, direction))
        }
    }

    /// Clamp a picked key so it never exceeds today.
    public static func pick(_ next: String, today: String) -> String { next > today ? today : next }

    public static func title(_ range: LeaderboardRange, isCurrent: Bool) -> String {
        guard isCurrent else { return "Leaderboard" }
        switch range {
        case .week: return "This week’s leaderboard"
        case .month: return "This month’s leaderboard"
        case .day: return "Today’s leaderboard"
        }
    }

    public static func subtitle(_ range: LeaderboardRange, isCurrent: Bool, anyoneLive: Bool) -> String {
        if isCurrent {
            if anyoneLive { return "Live times, updating as people track" }
            return range == .day ? "Who’s grinding the most today" : "Who’s grinding the most this \(noun(range))"
        }
        return "How the grind looked that \(noun(range))"
    }

    public static func yourLabel(_ range: LeaderboardRange, isCurrent: Bool) -> String {
        switch range {
        case .week: return isCurrent ? "Your week" : "You that week"
        case .month: return isCurrent ? "Your month" : "You that month"
        case .day: return isCurrent ? "Your today" : "You that day"
        }
    }

    public static func periodLabel(_ range: LeaderboardRange, day: String, isCurrent: Bool, calc: DayCalc = .current) -> String {
        let sel = calc.date(fromKey: day) ?? Date()
        switch range {
        case .week:
            if isCurrent { return "This week" }
            let b = bounds(.week, day: day, calc: calc)
            if calc.calendar.component(.month, from: b.start) == calc.calendar.component(.month, from: b.end) {
                return "\(calc.format(b.start, "d"))–\(calc.format(b.end, "d MMM"))"
            }
            return "\(calc.format(b.start, "d MMM")) – \(calc.format(b.end, "d MMM"))"
        case .month: return isCurrent ? "This month" : calc.format(sel, "MMM yyyy")
        case .day: return isCurrent ? "Today" : calc.format(sel, "EEE d MMM")
        }
    }

    public struct Row: Identifiable, Hashable, Sendable {
        public var entry: LeaderboardEntry
        public var rank: Int
        public var isLive: Bool
        public var liveMs: Int64
        public var sessionMs: Int64
        public var totalMs: Int64
        public var isYou: Bool
        public var id: String { entry.userId }
    }

    public static func rows(_ entries: [LeaderboardEntry], range: LeaderboardRange, day: String, isCurrent: Bool,
                            me: String?, now: Int64, calc: DayCalc = .current) -> [Row] {
        let b = bounds(range, day: day, calc: calc)
        let filtered = entries.filter { $0.todayMs > 0 || (isCurrent && $0.startTime != nil) }
        return filtered.enumerated().map { i, e in
            let live = isCurrent && e.startTime != nil
            let liveMs = live ? liveRangeMs(startTime: e.startTime!, now: now, rangeStart: b.start, rangeEnd: b.end) : 0
            let sessionMs = live ? max(0, now - e.startTime!) : 0
            return Row(entry: e, rank: i + 1, isLive: live, liveMs: liveMs, sessionMs: sessionMs, totalMs: e.todayMs + liveMs, isYou: e.userId == me)
        }
    }
}

/// Visualizations race (lib/bar-race.ts).
public enum Race {
    public struct Row: Identifiable, Hashable, Sendable {
        public var id: String
        public var name: String
        public var color: String
        public var ms: Int64
    }

    public static func mergeIntervals(_ events: [RaceResponse.Event]) -> [String: [RaceResponse.Event]] {
        var byUser: [String: [RaceResponse.Event]] = [:]
        for e in events { byUser[e.userId, default: []].append(e) }
        var out: [String: [RaceResponse.Event]] = [:]
        for (uid, list) in byUser {
            let sorted = list.sorted { $0.from < $1.from || ($0.from == $1.from && $0.to < $1.to) }
            var merged: [RaceResponse.Event] = []
            var cur = sorted[0]
            for e in sorted.dropFirst() {
                if e.from <= cur.to { cur.to = max(cur.to, e.to) } else { merged.append(cur); cur = e }
            }
            merged.append(cur)
            out[uid] = merged
        }
        return out
    }

    public static func totalsAt(_ byUser: [String: [RaceResponse.Event]], users: [RaceResponse.User], rangeStart: Int64, at: Int64) -> [Row] {
        users.map { u in
            let ms = (byUser[u.id] ?? []).reduce(Int64(0)) { $0 + liveOverlapMs(startTime: $1.from, now: $1.to, rangeStart: rangeStart, rangeEnd: at) }
            return Row(id: u.id, name: u.name, color: u.color ?? Accent.colorForId(u.id), ms: ms)
        }.sorted { $0.ms != $1.ms ? $0.ms > $1.ms : $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    public enum Preset: String, CaseIterable, Sendable {
        case pastWeek, thisWeek, thisMonth, lastMonth, custom
        public var label: String {
            switch self {
            case .pastWeek: "Past week"; case .thisWeek: "This week"; case .thisMonth: "This month"
            case .lastMonth: "Last month"; case .custom: "Custom"
            }
        }
    }

    /// (from, to) day keys for a preset.
    public static func keys(_ p: Preset, customFrom: Date? = nil, customTo: Date? = nil, now: Date = Date(), calc: DayCalc = .current) -> (String, String) {
        let today = calc.startOfDay(now)
        switch p {
        case .pastWeek: return (calc.dayKey(calc.addDays(today, -6)), calc.dayKey(today))
        case .thisWeek: return (calc.dayKey(calc.startOfWeek(today)), calc.dayKey(today))
        case .thisMonth: return (calc.dayKey(calc.startOfMonth(today)), calc.dayKey(today))
        case .lastMonth:
            let s = calc.startOfMonth(calc.addMonths(today, -1))
            return (calc.dayKey(s), calc.dayKey(calc.endOfMonth(s)))
        case .custom:
            return (calc.dayKey(customFrom ?? calc.addDays(today, -6)), calc.dayKey(customTo ?? today))
        }
    }

    public static let speeds: [(label: String, ms: Int64)] = [("30 s", 30_000), ("1 min", 60_000), ("2 min", 120_000)]
}
