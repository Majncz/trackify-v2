import SwiftUI
import Observation
import TrackifyKit

// MARK: - Billing screen state (WEB_AUDIT §1.7, billing-page.tsx)

enum BillingTab: String, CaseIterable, Hashable {
    case sessions, history, rates, ai

    var label: String {
        switch self {
        case .sessions: "Sessions"
        case .history: "History"
        case .rates: "Rates"
        case .ai: "AI billing"
        }
    }

    var index: Int { Self.allCases.firstIndex(of: self) ?? 0 }
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

/// `.task(id:)` key: data tick (socket/refresh) + the sessions filter.
struct BillingLoadKey: Hashable {
    var tick: Int
    var sessions: BillingSessionsKey
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
    var collapsed: Set<String> = []

    private var sessionsToken = 0
    private var lastTick: Int?
    private var lastSessionsKey: BillingSessionsKey?

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

    func toggleCollapsed(_ key: String) {
        if collapsed.contains(key) { collapsed.remove(key) } else { collapsed.insert(key) }
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

    /// Called from `.task(id: BillingLoadKey)`: a filter change reloads only the ledger (with skeleton);
    /// appearing or a data tick refreshes everything.
    func load(tick: Int, api: APIClient) async {
        let key = sessionsKey
        if lastTick == tick, let last = lastSessionsKey, last != key {
            await loadSessions(api, skeleton: true)
        } else {
            await loadAll(api, skeleton: lastSessionsKey != key)
        }
        if !Task.isCancelled { lastTick = tick }
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
