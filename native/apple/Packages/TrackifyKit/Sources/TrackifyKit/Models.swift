import Foundation

// MARK: - Core data (WEB_AUDIT §2.0)

public struct TaskGroupRef: Codable, Hashable, Sendable {
    public var id: String
    public var name: String
    public var color: String?

    public init(id: String, name: String, color: String? = nil) {
        self.id = id; self.name = name; self.color = color
    }

    /// `resolveGroupAccent`: saved colour when valid, otherwise the stable hash preset.
    public var accentHex: String { Accent.resolveGroupAccent(id: id, color: color) }
}

public struct TimeEvent: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var from: Date
    public var to: Date
    public var name: String
    public var taskId: String
    public var paymentRecordId: String?
    public var paidAmount: Double?

    public init(id: String, from: Date, to: Date, name: String = "Time entry", taskId: String,
                paymentRecordId: String? = nil, paidAmount: Double? = nil) {
        self.id = id; self.from = from; self.to = to; self.name = name; self.taskId = taskId
        self.paymentRecordId = paymentRecordId; self.paidAmount = paidAmount
    }

    public var durationMs: Int64 { max(0, to.ms - from.ms) }
    public var fromMs: Int64 { from.ms }
    public var toMs: Int64 { to.ms }
}

public struct TrackifyTask: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var hidden: Bool
    public var createdAt: Date?
    public var updatedAt: Date?
    public var userId: String?
    public var taskGroupId: String?
    public var events: [TimeEvent]
    public var taskGroup: TaskGroupRef?

    public init(id: String, name: String, hidden: Bool = false, createdAt: Date? = nil, updatedAt: Date? = nil,
                userId: String? = nil, taskGroupId: String? = nil, events: [TimeEvent] = [], taskGroup: TaskGroupRef? = nil) {
        self.id = id; self.name = name; self.hidden = hidden; self.createdAt = createdAt; self.updatedAt = updatedAt
        self.userId = userId; self.taskGroupId = taskGroupId; self.events = events; self.taskGroup = taskGroup
    }

    enum CodingKeys: String, CodingKey { case id, name, hidden, createdAt, updatedAt, userId, taskGroupId, events, taskGroup }

    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decode(String.self, forKey: .name)
        hidden = try c.decodeIfPresent(Bool.self, forKey: .hidden) ?? false
        createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt)
        updatedAt = try c.decodeIfPresent(Date.self, forKey: .updatedAt)
        userId = try c.decodeIfPresent(String.self, forKey: .userId)
        taskGroupId = try c.decodeIfPresent(String.self, forKey: .taskGroupId)
        events = try c.decodeIfPresent([TimeEvent].self, forKey: .events) ?? []
        taskGroup = try c.decodeIfPresent(TaskGroupRef.self, forKey: .taskGroup)
    }

    /// Group accent if grouped, otherwise the stable task accent (billing, widgets, menu bar dot).
    public var accentHex: String { taskGroup?.accentHex ?? Accent.taskAccentHex(id) }
    public var totalMs: Int64 { events.reduce(0) { $0 + $1.durationMs } }
    public var latestEventFrom: Date? { events.map(\.from).max() }
}

public struct TaskGroup: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var color: String?
    public var userId: String?
    public var createdAt: Date?
    public var updatedAt: Date?
    public var taskIds: [String]

    public init(id: String, name: String, color: String? = nil, taskIds: [String] = []) {
        self.id = id; self.name = name; self.color = color; self.taskIds = taskIds
    }

    public var accentHex: String { Accent.resolveGroupAccent(id: id, color: color) }
}

// MARK: - Timer

public struct ServerTimerState: Codable, Equatable, Sendable {
    public var running: Bool
    public var taskId: String?
    public var startTime: Int64?

    public init(running: Bool, taskId: String? = nil, startTime: Int64? = nil) {
        self.running = running; self.taskId = taskId; self.startTime = startTime
    }

    enum CodingKeys: String, CodingKey { case running, taskId, startTime }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        running = try c.decodeIfPresent(Bool.self, forKey: .running) ?? false
        taskId = try c.decodeIfPresent(String.self, forKey: .taskId)
        startTime = try c.decodeFlexibleMs(forKey: .startTime)
    }
}

public struct OverlapInfo: Codable, Equatable, Sendable {
    public var taskName: String?
    public var name: String?
    public var from: String?
    public var to: String?
}

// MARK: - Stats / profile

public struct StatsResponse: Codable, Equatable, Sendable {
    public struct TaskStat: Codable, Equatable, Sendable {
        public var taskId: String
        public var taskName: String
        public var totalTime: Int64
        public var todayTime: Int64
    }
    public var tasks: [TaskStat]
    public var grandTotal: Int64
    public var todayTotal: Int64

    public init(tasks: [TaskStat] = [], grandTotal: Int64 = 0, todayTotal: Int64 = 0) {
        self.tasks = tasks; self.grandTotal = grandTotal; self.todayTotal = todayTotal
    }
}

public struct Profile: Codable, Equatable, Sendable {
    public var id: String?
    public var email: String
    public var displayName: String
    public init(id: String? = nil, email: String, displayName: String) {
        self.id = id; self.email = email; self.displayName = displayName
    }
    enum CodingKeys: String, CodingKey { case id, email, displayName }
    public init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id)
        email = try c.decodeIfPresent(String.self, forKey: .email) ?? ""
        displayName = try c.decodeIfPresent(String.self, forKey: .displayName) ?? ""
    }
}

public struct AuthTokenResponse: Codable, Sendable {
    public struct User: Codable, Sendable { public var id: String; public var email: String }
    public var token: String
    public var expiresAt: Date?
    public var user: User
}

// MARK: - Presence / leaderboard / race (§2.6)

public enum LeaderboardRange: String, Codable, CaseIterable, Sendable {
    case day, week, month
    public var label: String {
        switch self { case .day: "Daily"; case .week: "Weekly"; case .month: "Monthly" }
    }
}

public struct PresenceEntry: Codable, Hashable, Sendable {
    public var userId: String
    public var name: String
    public var taskName: String
    public var startTime: Int64
    public var todayMs: Int64
}

public struct LeaderboardEntry: Codable, Hashable, Sendable {
    public var userId: String
    public var name: String
    public var todayMs: Int64
    public var startTime: Int64?
    public var taskName: String?
}

public struct PresenceResponse: Codable, Equatable, Sendable {
    public var tracking: [PresenceEntry]
    public var leaderboard: [LeaderboardEntry]
    public var day: String?
    public var range: LeaderboardRange?
    public var isToday: Bool?
    public var isCurrent: Bool?

    public init(tracking: [PresenceEntry] = [], leaderboard: [LeaderboardEntry] = [], day: String? = nil,
                range: LeaderboardRange? = nil, isToday: Bool? = nil, isCurrent: Bool? = nil) {
        self.tracking = tracking; self.leaderboard = leaderboard; self.day = day; self.range = range
        self.isToday = isToday; self.isCurrent = isCurrent
    }
}

public struct RaceResponse: Codable, Equatable, Sendable {
    public struct User: Codable, Hashable, Sendable { public var id: String; public var name: String; public var color: String? }
    public struct Event: Codable, Hashable, Sendable { public var userId: String; public var from: Int64; public var to: Int64 }
    public var from: String
    public var to: String
    public var rangeStart: Int64
    public var rangeEnd: Int64
    public var users: [User]
    public var events: [Event]
}

// MARK: - Billing (§2.8)

public struct BillingTaskRow: Codable, Hashable, Identifiable, Sendable {
    public struct TaskInfo: Codable, Hashable, Sendable {
        public var id: String
        public var name: String
        public var hidden: Bool?
        public var taskGroup: TaskGroupRef?
    }
    public var id: String
    public var taskId: String
    public var hourlyRate: Double
    public var currency: String
    public var roundingMins: Int?
    public var task: TaskInfo?
}

public struct BillingSessionRow: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var from: Date
    public var to: Date
    public var name: String?
    public var taskId: String
    public var taskName: String
    public var taskGroup: TaskGroupRef?
    public var hourlyRate: Double
    public var currency: String
    public var rawDurationMinutes: Int?
    public var durationMinutes: Int
    public var earnings: Double
    public var isPaid: Bool
    public var paymentRecordId: String?
    public var paymentPaidAt: Date?
    public var groupDay: String
    public var groupWeek: String
    public var groupMonth: String

    public var accentHex: String { taskGroup?.accentHex ?? Accent.taskAccentHex(taskId) }
}

public struct BillingSessionsResponse: Codable, Sendable {
    public var sessions: [BillingSessionRow]
}

public struct BillingCurrencySummary: Codable, Equatable, Sendable {
    public var unpaidTotal: Double
    public var thisWeekTotal: Double
    public var thisMonthTotal: Double
    public var allTimeTotal: Double
    public var allTimePaidTotal: Double
}

public struct BillingSummary: Codable, Equatable, Sendable {
    public var byCurrency: [String: BillingCurrencySummary]
    public init(byCurrency: [String: BillingCurrencySummary] = [:]) { self.byCurrency = byCurrency }
}

public struct PaymentRecord: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var paidAt: Date
    public var note: String?
    public var totalAmount: Double
    public var totalMinutes: Int
    public var currency: String
    public var createdAt: Date?
    public var sessions: [BillingSessionRow]?
    public var eventCount: Int?
}

// MARK: - AI subscriptions (§2.9)

public struct AIPreset: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var providerKey: String?
    public var isBuiltIn: Bool?
    public var sortOrder: Int?
}

public struct AIPeriodMetrics: Codable, Hashable, Sendable {
    public var tasksWithTrackedTime: Int
    public var trackedHours: Double
    public var eventsInWindow: Int
    public var durationDays: Int
    public var isActive: Bool
}

public struct AIPeriod: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var presetId: String?
    public var name: String
    public var price: Double
    public var currency: String
    public var startsAt: Date
    public var endsAt: Date?
    public var depletedAt: Date?
    public var billingKind: String
    public var billingCadence: String?
    public var billingEmail: String?
    public var billingProviderUrl: String?
    public var note: String?
    public var priceApproxCzk: Double?
    public var metrics: AIPeriodMetrics?
    public var paidEarningsByCurrency: [String: Double]?

    public var isRecurring: Bool { billingKind == "recurring_monthly" }
}

public struct AIPeriodsResponse: Codable, Sendable { public var periods: [AIPeriod] }
public struct AIPeriodResponse: Codable, Sendable { public var period: AIPeriod }

public struct AIAnalytics: Codable, Equatable, Sendable {
    public struct Summary: Codable, Equatable, Sendable {
        public var lifetimeSpendInView: Double
        public var currentMonthOverlapSpendInView: Double
        public var activeSubscriptions: Int
        public var periodCount: Int
    }
    public struct MonthPoint: Codable, Hashable, Sendable { public var month: String; public var totalInView: Double }
    public struct Ranked: Codable, Hashable, Sendable { public var id: String; public var name: String; public var trackedHours: Double }
    public struct Rankings: Codable, Equatable, Sendable { public var mostTrackedHours: [Ranked] }
    public var viewCurrency: String
    public var fxMissingCurrencies: [String]
    public var summary: Summary
    public var cumulativeByMonth: [MonthPoint]
    public var spendByMonth: [MonthPoint]
    public var rankings: Rankings
    public var periods: [AIPeriod]?
}

// MARK: - Chat (§2.10)

public struct Conversation: Codable, Hashable, Identifiable, Sendable {
    public var id: String
    public var title: String?
    public var updatedAt: Date?
    public var createdAt: Date?

    /// Tab title (chat-tab-bar `truncateTitle`): first 3 words + "..." (or "New chat").
    public var tabTitle: String {
        guard let t = title, !t.isEmpty else { return "New chat" }
        let words = t.components(separatedBy: " ")
        if words.count > 3 { return words.prefix(3).joined(separator: " ") + "..." }
        return t
    }
}

// MARK: - Helpers

public extension Date {
    var ms: Int64 { Int64((timeIntervalSince1970 * 1000).rounded()) }
    init(ms: Int64) { self.init(timeIntervalSince1970: TimeInterval(ms) / 1000) }
}

extension KeyedDecodingContainer {
    /// Timer endpoints send epoch ms numbers; be lenient with ISO strings too.
    func decodeFlexibleMs(forKey key: Key) throws -> Int64? {
        if let v = try? decodeIfPresent(Int64.self, forKey: key) { return v }
        if let d = try? decodeIfPresent(Double.self, forKey: key) { return Int64(d) }
        if let s = try? decodeIfPresent(String.self, forKey: key), let date = ISODate.parse(s) { return date.ms }
        return nil
    }
}
