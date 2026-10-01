import Foundation

public let MINUTE_MS: Int64 = 60_000
public let HOUR_MS: Int64 = 3_600_000
public let DAY_MS: Int64 = 86_400_000
/// Minimum saved stretch (`MIN_EVENT_MS`).
public let MIN_EVENT_MS: Int64 = 60_000
/// Start/adjust/log-past lookback.
public let MAX_LOOKBACK_MS: Int64 = 40 * HOUR_MS

/// Local calendar helpers. Weeks start on Monday everywhere (`weekStartsOn: 1`).
public struct DayCalc: Sendable {
    public var calendar: Calendar

    public init(timeZone: TimeZone = .current) {
        var c = Calendar(identifier: .gregorian)
        c.timeZone = timeZone
        c.firstWeekday = 2
        c.minimumDaysInFirstWeek = 4
        c.locale = Locale(identifier: "en_US_POSIX")
        calendar = c
    }

    public static var current: DayCalc { DayCalc() }

    public func startOfDay(_ d: Date) -> Date { calendar.startOfDay(for: d) }
    /// date-fns `endOfDay` (23:59:59.999).
    public func endOfDay(_ d: Date) -> Date { Date(ms: addDays(startOfDay(d), 1).ms - 1) }
    public func addDays(_ d: Date, _ n: Int) -> Date { calendar.date(byAdding: .day, value: n, to: d) ?? d }
    public func addMonths(_ d: Date, _ n: Int) -> Date { calendar.date(byAdding: .month, value: n, to: d) ?? d }
    public func addHours(_ d: Date, _ n: Int) -> Date { calendar.date(byAdding: .hour, value: n, to: d) ?? d }

    public func startOfWeek(_ d: Date) -> Date {
        let sod = startOfDay(d)
        let wd = calendar.component(.weekday, from: sod) // 1 = Sun
        let back = (wd + 5) % 7 // Mon→0 … Sun→6
        return addDays(sod, -back)
    }
    public func endOfWeek(_ d: Date) -> Date { endOfDay(addDays(startOfWeek(d), 6)) }
    public func startOfMonth(_ d: Date) -> Date {
        calendar.date(from: calendar.dateComponents([.year, .month], from: d)) ?? startOfDay(d)
    }
    public func endOfMonth(_ d: Date) -> Date { Date(ms: addMonths(startOfMonth(d), 1).ms - 1) }
    public func startOfYear(_ d: Date) -> Date {
        calendar.date(from: calendar.dateComponents([.year], from: d)) ?? startOfDay(d)
    }
    public func endOfYear(_ d: Date) -> Date {
        Date(ms: (calendar.date(byAdding: .year, value: 1, to: startOfYear(d)) ?? d).ms - 1)
    }
    public func startOfQuarter(_ d: Date) -> Date {
        let m = calendar.component(.month, from: d)
        let qm = ((m - 1) / 3) * 3 + 1
        var c = calendar.dateComponents([.year], from: d); c.month = qm; c.day = 1
        return calendar.date(from: c) ?? startOfMonth(d)
    }
    public func endOfQuarter(_ d: Date) -> Date { Date(ms: addMonths(startOfQuarter(d), 3).ms - 1) }

    public func isSameDay(_ a: Date, _ b: Date) -> Bool { calendar.isDate(a, inSameDayAs: b) }
    public func daysBetween(_ a: Date, _ b: Date) -> Int {
        calendar.dateComponents([.day], from: startOfDay(a), to: startOfDay(b)).day ?? 0
    }

    /// `yyyy-MM-dd` in this calendar's zone.
    public func dayKey(_ d: Date) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: d)
        return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
    }

    public func date(fromKey key: String) -> Date? {
        let p = key.split(separator: "-").compactMap { Int($0) }
        guard p.count == 3 else { return nil }
        var c = DateComponents(); c.year = p[0]; c.month = p[1]; c.day = p[2]
        return calendar.date(from: c)
    }

    public func dateAt(_ base: Date, hour: Int, minute: Int, dayOffset: Int = 0) -> Date {
        var c = calendar.dateComponents([.year, .month, .day], from: addDays(base, dayOffset))
        c.hour = hour; c.minute = minute; c.second = 0
        return calendar.date(from: c) ?? base
    }

    public func hour(_ d: Date) -> Int { calendar.component(.hour, from: d) }
    public func minute(_ d: Date) -> Int { calendar.component(.minute, from: d) }
    /// 0 = Monday … 6 = Sunday
    public func weekdayIndex(_ d: Date) -> Int { (calendar.component(.weekday, from: d) + 5) % 7 }

    /// Every day from `start` to `end` inclusive (start-of-day dates).
    public func days(from start: Date, through end: Date) -> [Date] {
        var out: [Date] = []
        var d = startOfDay(start)
        let last = startOfDay(end)
        while d <= last { out.append(d); d = addDays(d, 1) }
        return out
    }

    // MARK: formatting with fixed English patterns (web uses date-fns `format`)

    public func format(_ d: Date, _ pattern: String) -> String {
        FormatterCache.shared.formatter(pattern, calendar: calendar).string(from: d)
    }
}

final class FormatterCache: @unchecked Sendable {
    static let shared = FormatterCache()
    private var cache: [String: DateFormatter] = [:]
    private let lock = NSLock()

    func formatter(_ pattern: String, calendar: Calendar) -> DateFormatter {
        let key = pattern + "|" + calendar.timeZone.identifier
        lock.lock(); defer { lock.unlock() }
        if let f = cache[key] { return f }
        let f = DateFormatter()
        f.calendar = calendar
        f.timeZone = calendar.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = pattern
        cache[key] = f
        return f
    }
}

/// Overlap of `[from,to)` with `[start,end)` in ms (`getOverlapDuration`).
@inline(__always)
public func overlapMs(_ from: Int64, _ to: Int64, _ start: Int64, _ end: Int64) -> Int64 {
    if to <= start || from >= end { return 0 }
    return max(0, min(to, end) - max(from, start))
}

/// `liveOverlapMs`.
public func liveOverlapMs(startTime: Int64, now: Int64, rangeStart: Int64, rangeEnd: Int64) -> Int64 {
    if now <= rangeStart || startTime >= rangeEnd { return 0 }
    return max(0, min(now, rangeEnd) - max(startTime, rangeStart))
}

/// `liveRangeMs` (range end inclusive, like date-fns endOfDay + 1).
public func liveRangeMs(startTime: Int64, now: Int64, rangeStart: Date, rangeEnd: Date) -> Int64 {
    liveOverlapMs(startTime: startTime, now: now, rangeStart: rangeStart.ms, rangeEnd: rangeEnd.ms + 1)
}

public func snapMinute(_ ms: Int64) -> Int64 {
    Int64(Fmt.jsRound(Double(ms) / Double(MINUTE_MS))) * MINUTE_MS
}

public func clampMs(_ n: Int64, _ lo: Int64, _ hi: Int64) -> Int64 { min(hi, max(lo, n)) }
