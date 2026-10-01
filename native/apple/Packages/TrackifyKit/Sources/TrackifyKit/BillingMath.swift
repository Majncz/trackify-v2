import Foundation

/// Billing helpers (lib/billing.ts, billing-page filters, ai-subscription-cadence.ts).
public enum BillingMath {
    public static func durationMinutes(from: Date, to: Date) -> Int { Int(max(0, to.ms - from.ms) / 60000) }

    public static func earnings(minutes: Int, rate: Double) -> Double { Money.round2(Double(minutes) / 60 * rate) }

    /// Sum of floor-minutes per event ("Tracked time" on the billing panel).
    public static func trackedMinutes(_ events: [TimeEvent]) -> Int {
        events.reduce(0) { $0 + durationMinutes(from: $1.from, to: $1.to) }
    }

    /// "Est. at current rate": sum of per-event earnings (paid events use their recorded amount).
    public static func estimate(_ events: [TimeEvent], rate: Double) -> Double {
        Money.round2(events.reduce(0) { acc, e in
            if e.paymentRecordId != nil, let p = e.paidAmount { return acc + Money.round2(p) }
            return acc + earnings(minutes: durationMinutes(from: e.from, to: e.to), rate: rate)
        })
    }

    public enum Period: String, CaseIterable, Sendable {
        case thisWeek, thisMonth, lastMonth, allTime, custom
        public var label: String {
            switch self {
            case .thisWeek: "This week"; case .thisMonth: "This month"; case .lastMonth: "Last month"
            case .allTime: "All time"; case .custom: "Custom…"
            }
        }
    }

    public enum Status: String, CaseIterable, Sendable {
        case unpaid, all, paid
        public var label: String { switch self { case .unpaid: "Unpaid"; case .all: "All"; case .paid: "Paid" } }
    }

    public enum GroupBy: String, CaseIterable, Sendable {
        case day, week, month
        public var label: String { switch self { case .day: "Day"; case .week: "Week"; case .month: "Month" } }
    }

    /// ISO `from`/`to` bounds for the sessions request.
    public static func bounds(_ p: Period, customFrom: Date?, customTo: Date?, now: Date = Date(), calc: DayCalc = .current) -> (from: Date?, to: Date?) {
        switch p {
        case .thisWeek: return (calc.startOfWeek(now), calc.endOfWeek(now))
        case .thisMonth: return (calc.startOfMonth(now), calc.endOfMonth(now))
        case .lastMonth:
            let s = calc.startOfMonth(calc.addMonths(now, -1))
            return (s, calc.endOfMonth(s))
        case .allTime: return (nil, nil)
        case .custom:
            return (calc.startOfDay(customFrom ?? now), calc.endOfDay(customTo ?? customFrom ?? now))
        }
    }

    public struct Section: Identifiable, Sendable {
        public var key: String
        public var rows: [BillingSessionRow]
        public var id: String { key }
        public var totalMinutes: Int { rows.reduce(0) { $0 + $1.durationMinutes } }
        public var unpaidByCurrency: [(String, Double)] {
            var d: [String: Double] = [:]
            for r in rows where !r.isPaid { d[r.currency, default: 0] += r.earnings }
            return d.keys.sorted().map { ($0, Money.round2(d[$0]!)) }
        }
    }

    /// Group sessions by UTC keys in server order (from desc).
    public static func sections(_ rows: [BillingSessionRow], by g: GroupBy) -> [Section] {
        var order: [String] = []
        var map: [String: [BillingSessionRow]] = [:]
        for r in rows {
            let k: String
            switch g { case .day: k = r.groupDay; case .week: k = r.groupWeek; case .month: k = r.groupMonth }
            if map[k] == nil { order.append(k) }
            map[k, default: []].append(r)
        }
        return order.map { Section(key: $0, rows: map[$0]!) }
    }

    public struct SelectionSummary: Sendable {
        public var count: Int
        public var minutes: Int
        public var byCurrency: [(String, Double)]
        public var multipleCurrencies: Bool { byCurrency.count > 1 }
    }

    public static func summary(_ rows: [BillingSessionRow]) -> SelectionSummary {
        var d: [String: Double] = [:]
        for r in rows { d[r.currency, default: 0] += r.earnings }
        return SelectionSummary(count: rows.count, minutes: rows.reduce(0) { $0 + $1.durationMinutes },
                                byCurrency: d.keys.sorted().map { ($0, Money.round2(d[$0]!)) })
    }

    /// "MMM d, yyyy · HH:mm–HH:mm" (same day) else "MMM d, yyyy HH:mm → MMM d, yyyy HH:mm".
    public static func sessionRange(from: Date, to: Date, calc: DayCalc = .current) -> String {
        if calc.isSameDay(from, to) {
            return "\(calc.format(from, "MMM d, yyyy")) · \(calc.format(from, "HH:mm"))–\(calc.format(to, "HH:mm"))"
        }
        return "\(calc.format(from, "MMM d, yyyy HH:mm")) → \(calc.format(to, "MMM d, yyyy HH:mm"))"
    }
}

public enum AICadence: String, CaseIterable, Sendable {
    case monthly, weekly, quarterly, yearly
    public var label: String {
        switch self { case .monthly: "Monthly"; case .weekly: "Weekly"; case .quarterly: "Quarterly"; case .yearly: "Yearly" }
    }
    public static func normalize(_ raw: String?) -> AICadence { raw.flatMap(AICadence.init(rawValue:)) ?? .monthly }

    /// Last calendar day of the coverage bucket containing `start`.
    public func coverageEnd(start: Date, calc: DayCalc = .current) -> Date {
        let s = calc.startOfDay(start)
        switch self {
        case .weekly: return calc.endOfWeek(s)
        case .monthly: return calc.endOfMonth(s)
        case .quarterly: return calc.endOfQuarter(s)
        case .yearly: return calc.endOfYear(s)
        }
    }
}

public enum AIPeriodState: Sendable {
    case running, depleted, ended
    public var label: String { switch self { case .running: "Running"; case .depleted: "Depleted"; case .ended: "Ended" } }

    public static func of(_ p: AIPeriod, now: Date = Date()) -> AIPeriodState {
        if let d = p.depletedAt, d <= now { return .depleted }
        if p.metrics?.isActive ?? ((p.endsAt == nil || p.endsAt! > now) && (p.depletedAt == nil || p.depletedAt! > now)) { return .running }
        return .ended
    }

    /// `min(now, endsAt, depletedAt)`.
    public static func windowCloses(_ p: AIPeriod, now: Date = Date()) -> Date {
        var d = now
        if let e = p.endsAt, e < d { d = e }
        if let x = p.depletedAt, x < d { d = x }
        return d
    }
}
