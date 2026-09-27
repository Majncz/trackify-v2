import SwiftUI
import Observation
import TrackifyKit

// MARK: - Billing screen state (WEB_AUDIT §1.7, billing-page.tsx)

enum BillingRoute: String, CaseIterable, Hashable, Identifiable {
    case sessions, payments, rates, ai

    var id: String { rawValue }

    var label: String {
        switch self {
        case .sessions: "Sessions"
        case .payments: "Payments"
        case .rates: "Rates"
        case .ai: "AI Subscriptions"
        }
    }

    var icon: String {
        switch self {
        case .sessions: "list.bullet.rectangle"
        case .payments: "banknote"
        case .rates: "tag"
        case .ai: "sparkles"
        }
    }

    /// Test hook / deep link: `-TrackifyBillingTab sessions|history|payments|rates|ai`.
    static var launchRoute: BillingRoute? {
        guard let raw = UserDefaults.standard.string(forKey: "TrackifyBillingTab") else { return nil }
        if raw == "history" { return .payments }
        return BillingRoute(rawValue: raw)
    }
}

/// Everything that decides which sessions the ledger requests.
struct BillingSessionsKey: Hashable {
    var period: BillingMath.Period
    var from: Date?
    var to: Date?
    var group: String
    var task: String
    var status: BillingMath.Status
}

@Observable
@MainActor
final class BillingStore {
    // Summary
    var summary: BillingSummary?
    var summaryFailed = false

    // Enrolled tasks (GET /api/billing/tasks)
    var billingTasks: [BillingTaskRow]?
    var billingTasksError: String?

    // Sessions
    var sessions: [BillingSessionRow] = []
    var sessionsLoading = true
    var sessionsError: String?

    // Payments
    var payments: [PaymentRecord]?
    var paymentsFailed = false
    var reopening: String?
    var reopenError: String?

    // Filters (defaults = web)
    var period: BillingMath.Period = .thisMonth
    var customFrom = Date()
    var customTo = Date()
    var groupFilter = "all"      // "all" | "ungrouped" | group id
    var taskFilter = "all"       // "all" | task id
    var status: BillingMath.Status = .unpaid
    var groupBy: BillingMath.GroupBy = .day

    // Ledger UI
    var selected: Set<String> = []

    private var sessionsToken = 0
    private var lastTick: Int?
    private var lastSessionsKey: BillingSessionsKey?
    private var requestedKey: BillingSessionsKey?

    // MARK: Derived

    var bounds: (from: Date?, to: Date?) {
        BillingMath.bounds(period, customFrom: customFrom, customTo: customTo)
    }

    var sessionsKey: BillingSessionsKey {
        let b = bounds
        return BillingSessionsKey(period: period, from: b.from, to: b.to, group: groupFilter, task: taskFilter, status: status)
    }

    /// Heatmap grid end: the filter's end day (nil → today for All time).
    var calendarEnd: Date? {
        if period == .allTime { return nil }
        guard let to = bounds.to else { return nil }
        return DayCalc.current.endOfDay(to)
    }

    var hasEnrolled: Bool { !(billingTasks ?? []).isEmpty }

    var taskGroups: [TaskGroupRef] {
        var byId: [String: TaskGroupRef] = [:]
        for b in billingTasks ?? [] {
            if let g = b.task?.taskGroup { byId[g.id] = g }
        }
        return byId.values.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    var hasUngrouped: Bool { (billingTasks ?? []).contains { $0.task?.taskGroup == nil } }

    var groupOptions: [(String, String)] {
        var out: [(String, String)] = [("all", "All groups")]
        if hasUngrouped { out.append(("ungrouped", "Ungrouped")) }
        out.append(contentsOf: taskGroups.map { ($0.id, $0.name) })
        return out
    }

    private var enrolledForGroup: [(String, String)] {
        let rows = (billingTasks ?? []).filter { b in
            switch groupFilter {
            case "all": return true
            case "ungrouped": return b.task?.taskGroup == nil
            default: return b.task?.taskGroup?.id == groupFilter
            }
        }
        return rows.map { ($0.taskId, $0.task?.name ?? "Task") }
    }

    var taskOptions: [(String, String)] { [("all", "All enrolled")] + enrolledForGroup }

    var unpaidInList: [BillingSessionRow] { sessions.filter { !$0.isPaid } }

    var selectedSessions: [BillingSessionRow] { sessions.filter { selected.contains($0.id) && !$0.isPaid } }

    var allUnpaidSelected: Bool {
        let u = unpaidInList
        return !u.isEmpty && u.allSatisfy { selected.contains($0.id) }
    }

    // MARK: Mutations

    /// Changing the group resets the task to "all" (web).
    func setGroupFilter(_ g: String) {
        groupFilter = g
        taskFilter = "all"
    }

    func toggle(_ id: String) {
        if selected.contains(id) { selected.remove(id) } else { selected.insert(id) }
    }

    func setSelected(_ ids: [String], _ on: Bool) {
        for id in ids {
            if on { selected.insert(id) } else { selected.remove(id) }
        }
    }

    func toggleAllUnpaid() {
        let ids = unpaidInList.map(\.id)
        guard !ids.isEmpty else { return }
        if allUnpaidSelected {
            for id in ids { selected.remove(id) }
        } else {
            selected = Set(ids)
        }
    }

    /// Heatmap click: Period = Custom that day, Status = All.
    func filterToDay(_ day: Date) {
        let calc = DayCalc.current
        guard calc.startOfDay(day) <= calc.startOfDay(Date()) else { return }
        customFrom = day
        customTo = day
        period = .custom
        status = .all
    }

    // MARK: Loading

    /// Appearing or a data tick (socket / refresh) reloads everything.
    func load(tick: Int, api: APIClient) async {
        guard lastTick != tick || lastSessionsKey == nil else { return }
        await loadAll(api, skeleton: lastSessionsKey == nil)
        if !Task.isCancelled { lastTick = tick }
    }

    /// A filter change reloads only the ledger.
    func filtersChanged(_ api: APIClient) async {
        guard let requested = requestedKey, requested != sessionsKey else { return }
        await loadSessions(api, skeleton: true)
    }

    func loadAll(_ api: APIClient, skeleton: Bool = false) async {
        async let a: Void = loadSummary(api)
        async let b: Void = loadBillingTasks(api)
        async let c: Void = loadSessions(api, skeleton: skeleton)
        async let d: Void = loadPayments(api)
        _ = await (a, b, c, d)
    }

    func loadSummary(_ api: APIClient) async {
        do {
            summary = try await api.billingSummary()
            summaryFailed = false
        } catch {
            if Task.isCancelled { return }
            if summary == nil { summaryFailed = true }
        }
    }

    func loadBillingTasks(_ api: APIClient) async {
        do {
            billingTasks = try await api.billingTasks()
            billingTasksError = nil
            if taskFilter != "all" && !enrolledForGroup.contains(where: { $0.0 == taskFilter }) {
                taskFilter = "all"
            }
        } catch {
            if Task.isCancelled { return }
            if billingTasks == nil { billingTasksError = (error as? APIError)?.message ?? "Failed to load billing tasks" }
        }
    }

    func loadSessions(_ api: APIClient, skeleton: Bool) async {
        sessionsToken += 1
        let token = sessionsToken
        let key = sessionsKey
        requestedKey = key
        if skeleton {
            sessionsLoading = true
            sessionsError = nil
        }
        do {
            let rows = try await api.billingSessions(
                from: key.from, to: key.to, status: key.status,
                taskGroupId: key.group == "all" ? nil : key.group,
                taskId: key.task == "all" ? nil : key.task)
            guard token == sessionsToken else { return }
            sessions = rows
            selected.formIntersection(Set(rows.filter { !$0.isPaid }.map(\.id)))
            sessionsError = nil
            sessionsLoading = false
            lastSessionsKey = key
        } catch {
            guard token == sessionsToken, !Task.isCancelled else { return }
            sessionsError = (error as? APIError)?.message ?? "Failed to load sessions"
            sessionsLoading = false
        }
    }

    func loadPayments(_ api: APIClient) async {
        do {
            payments = try await api.payments()
            paymentsFailed = false
        } catch {
            if Task.isCancelled { return }
            if payments == nil { paymentsFailed = true }
        }
    }

    /// After mark-as-paid / reopen: clear selection and reload sessions, summary, history.
    func afterPaymentChange(_ api: APIClient) async {
        selected = []
        async let a: Void = loadSessions(api, skeleton: false)
        async let b: Void = loadSummary(api)
        async let c: Void = loadPayments(api)
        _ = await (a, b, c)
    }

    /// After enrol / rate / currency / remove on the Rates tab.
    func afterRatesChange(_ api: APIClient) async {
        async let a: Void = loadBillingTasks(api)
        async let b: Void = loadSummary(api)
        async let c: Void = loadSessions(api, skeleton: false)
        _ = await (a, b, c)
    }

    func reopen(_ id: String, api: APIClient) async {
        reopening = id
        reopenError = nil
        do {
            try await api.reopenPayment(id: id)
            reopening = nil
            await afterPaymentChange(api)
        } catch {
            reopening = nil
            reopenError = (error as? APIError)?.message ?? "Failed to reopen"
        }
    }
}

// MARK: - Labels

extension BillingMath.GroupBy {
    /// Readable ledger section title for a UTC group key ("2026-09-26", "2026-W39", "2026-09").
    func title(_ key: String) -> String {
        let bits = key.split(separator: "-")
        var c = DateComponents()
        c.timeZone = TimeZone(identifier: "UTC")
        switch self {
        case .day:
            guard bits.count == 3, let y = Int(bits[0]), let m = Int(bits[1]), let d = Int(bits[2]) else { return key }
            c.year = y; c.month = m; c.day = d
            guard let date = Calendar(identifier: .gregorian).date(from: c) else { return key }
            let f = DateFormatter()
            f.timeZone = TimeZone(identifier: "UTC")
            let thisYear = Calendar.current.component(.year, from: Date()) == y
            f.setLocalizedDateFormatFromTemplate(thisYear ? "EEEEMMMMd" : "EEEEMMMMdyyyy")
            return f.string(from: date)
        case .week:
            guard bits.count == 2, bits[1].hasPrefix("W"), let w = Int(bits[1].dropFirst()) else { return key }
            return "Week \(w), \(bits[0])"
        case .month:
            guard bits.count == 2, let y = Int(bits[0]), let m = Int(bits[1]) else { return key }
            c.year = y; c.month = m; c.day = 1
            guard let date = Calendar(identifier: .gregorian).date(from: c) else { return key }
            let f = DateFormatter()
            f.timeZone = TimeZone(identifier: "UTC")
            f.setLocalizedDateFormatFromTemplate("MMMMyyyy")
            return f.string(from: date)
        }
    }
}

extension BillingSessionRow {
    /// "Sep 26 · 09:00–10:30" (or across days: "Sep 26 09:00 → Sep 27 01:00").
    var timeRangeShort: String {
        let calc = DayCalc.current
        if calc.dayKey(from) == calc.dayKey(to) {
            return "\(calc.format(from, "MMM d")) · \(calc.format(from, "HH:mm"))–\(calc.format(to, "HH:mm"))"
        }
        return "\(calc.format(from, "MMM d HH:mm")) → \(calc.format(to, "MMM d HH:mm"))"
    }

    var clockRange: String {
        let calc = DayCalc.current
        return "\(calc.format(from, "HH:mm"))–\(calc.format(to, "HH:mm"))"
    }
}

extension BillingMath.SelectionSummary {
    /// "3 · 4h 20m · 1 200 Kč"
    var line: String {
        var parts = ["\(count)", Fmt.durationMinutes(Double(minutes))]
        parts += byCurrency.map { Money.format($0.1, $0.0) }
        return parts.joined(separator: " · ")
    }
}
