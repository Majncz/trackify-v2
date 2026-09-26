import Foundation

/// Typed REST endpoints (WEB_AUDIT §2).
public extension APIClient {
    // MARK: Auth
    func login(email: String, password: String, deviceName: String) async throws -> AuthTokenResponse {
        let data = try await send(makeRequest("POST", "/api/auth/token",
                                              body: try JSONSerialization.data(withJSONObject: ["email": email, "password": password, "deviceName": deviceName]),
                                              auth: false))
        return try decode(AuthTokenResponse.self, data)
    }

    func logout() async throws { try await send(makeRequest("DELETE", "/api/auth/token")) }

    func register(email: String, password: String) async throws {
        try await send(makeRequest("POST", "/api/auth/register",
                                   body: try JSONSerialization.data(withJSONObject: ["email": email, "password": password]), auth: false))
    }

    func forgotPassword(email: String) async throws {
        try await send(makeRequest("POST", "/api/auth/forgot-password",
                                   body: try JSONSerialization.data(withJSONObject: ["email": email]), auth: false))
    }

    // MARK: Tasks
    func tasks(hidden: Bool = false) async throws -> [TrackifyTask] {
        try await get("/api/tasks", query: hidden ? ["hidden": "true"] : [:])
    }

    func createTask(name: String) async throws -> TrackifyTask {
        try await json("POST", "/api/tasks", ["name": name], as: TrackifyTask.self)
    }

    func updateTask(id: String, name: String? = nil, hidden: Bool? = nil) async throws -> TrackifyTask {
        var body: [String: Any?] = [:]
        if let name { body["name"] = name }
        if let hidden { body["hidden"] = hidden }
        return try await json("PUT", "/api/tasks/\(id)", body, as: TrackifyTask.self)
    }

    func hideTask(id: String) async throws { _ = try await json("DELETE", "/api/tasks/\(id)") }

    // MARK: Events
    func createEvent(taskId: String, from: Date, to: Date, name: String = "Time entry", manual: Bool) async throws -> Bool {
        var body: [String: Any?] = ["taskId": taskId, "from": from, "to": to, "name": name]
        if manual { body["source"] = "manual" }
        let data = try await json("POST", "/api/events", body)
        let v = try? JSONDecoder().decode(JSONValue.self, from: data)
        return v?["skipped"]?.boolValue != true
    }

    func events(taskId: String?) async throws -> [TimeEvent] {
        try await get("/api/events", query: ["taskId": taskId])
    }

    func updateEvent(id: String, from: Date?, to: Date?, name: String? = nil) async throws {
        var body: [String: Any?] = [:]
        if let from { body["from"] = from }
        if let to { body["to"] = to }
        if let name { body["name"] = name }
        _ = try await json("PUT", "/api/events/\(id)", body)
    }

    func deleteEvent(id: String) async throws { _ = try await json("DELETE", "/api/events/\(id)") }

    // MARK: Timer
    func timer() async throws -> ServerTimerState { try await get("/api/timer") }

    func timerSwitch(taskId: String, at: Int64) async throws -> ServerTimerState {
        try await json("POST", "/api/timer/switch", ["taskId": taskId, "at": ISODate.string(ms: at)], as: ServerTimerState.self)
    }

    func timerStop(taskId: String?, endTime: Int64?, startTime: Int64?) async throws {
        var body: [String: Any?] = [:]
        if let taskId { body["taskId"] = taskId }
        if let endTime { body["endTime"] = ISODate.string(ms: endTime) }
        if let startTime { body["startTime"] = ISODate.string(ms: startTime) }
        _ = try await json("POST", "/api/timer/stop", body)
    }

    func timerAdjust(taskId: String, newStart: Int64) async throws -> ServerTimerState {
        try await json("PATCH", "/api/timer", ["taskId": taskId, "newStartTime": ISODate.string(ms: newStart)], as: ServerTimerState.self)
    }

    /// Legacy (pre-native-endpoint) primitives.
    func legacyTimerStart(taskId: String, startTime: Int64) async throws -> ServerTimerState {
        try await json("POST", "/api/timer", ["taskId": taskId, "startTime": ISODate.string(ms: startTime)], as: ServerTimerState.self)
    }

    func legacyTimerDelete(taskId: String?) async throws {
        _ = try await send(makeRequest("DELETE", "/api/timer", query: ["taskId": taskId]))
    }

    // MARK: Stats / profile
    func stats() async throws -> StatsResponse { try await get("/api/stats", query: ["timezone": timezone]) }
    func profile() async throws -> Profile { try await get("/api/profile") }
    func updateDisplayName(_ name: String) async throws -> Profile {
        try await json("PATCH", "/api/profile", ["displayName": name], as: Profile.self)
    }
    func changePassword(current: String, new: String) async throws {
        _ = try await json("POST", "/api/profile/password", ["currentPassword": current, "newPassword": new])
    }
    func deleteAccount(password: String) async throws {
        _ = try await json("DELETE", "/api/profile", ["password": password])
    }

    // MARK: Presence / race
    func presence(day: String, range: LeaderboardRange) async throws -> PresenceResponse {
        try await get("/api/presence", query: ["timezone": timezone, "day": day, "range": range.rawValue])
    }

    func race(from: String, to: String) async throws -> RaceResponse {
        try await get("/api/visualizations/race", query: ["timezone": timezone, "from": from, "to": to])
    }

    // MARK: Groups
    func groups() async throws -> [TaskGroup] { try await get("/api/groups") }
    func createGroup(name: String, taskIds: [String], color: String?) async throws -> TaskGroup {
        try await json("POST", "/api/groups", ["name": name, "taskIds": taskIds, "color": color], as: TaskGroup.self)
    }
    func updateGroup(id: String, name: String, taskIds: [String], color: String?) async throws -> TaskGroup {
        try await json("PUT", "/api/groups/\(id)", ["name": name, "taskIds": taskIds, "color": color], as: TaskGroup.self)
    }
    func deleteGroup(id: String) async throws { _ = try await json("DELETE", "/api/groups/\(id)") }

    // MARK: Billing
    func billingTasks() async throws -> [BillingTaskRow] { try await get("/api/billing/tasks") }
    func enrollBilling(taskId: String, hourlyRate: Double, currency: String) async throws -> BillingTaskRow {
        try await json("POST", "/api/billing/tasks", ["taskId": taskId, "hourlyRate": hourlyRate, "currency": currency, "roundingMins": 0], as: BillingTaskRow.self)
    }
    func updateBilling(id: String, hourlyRate: Double? = nil, currency: String? = nil) async throws -> BillingTaskRow {
        var body: [String: Any?] = [:]
        if let hourlyRate { body["hourlyRate"] = hourlyRate }
        if let currency { body["currency"] = currency }
        return try await json("PATCH", "/api/billing/tasks/\(id)", body, as: BillingTaskRow.self)
    }
    func removeBilling(id: String) async throws { _ = try await json("DELETE", "/api/billing/tasks/\(id)") }

    func billingSessions(from: Date?, to: Date?, status: BillingMath.Status, taskGroupId: String?, taskId: String?) async throws -> [BillingSessionRow] {
        let r: BillingSessionsResponse = try await get("/api/billing/sessions", query: [
            "from": from.map(ISODate.string), "to": to.map(ISODate.string), "status": status.rawValue,
            "taskGroupId": taskGroupId, "taskId": taskId,
        ])
        return r.sessions
    }
    func billingSummary() async throws -> BillingSummary { try await get("/api/billing/summary") }
    func payments() async throws -> [PaymentRecord] { try await get("/api/billing/payments") }
    func markPaid(eventIds: [String], paidAt: Date, note: String?, lineAmounts: [String: Double]) async throws {
        var body: [String: Any?] = ["eventIds": eventIds, "paidAt": paidAt, "lineAmounts": lineAmounts]
        if let note, !note.isEmpty { body["note"] = note }
        _ = try await json("POST", "/api/billing/payments", body)
    }
    func reopenPayment(id: String) async throws { _ = try await json("DELETE", "/api/billing/payments/\(id)") }

    // MARK: AI subscriptions
    func aiPresets() async throws -> [AIPreset] { try await get("/api/ai-subscriptions/presets") }
    func aiPeriods() async throws -> [AIPeriod] { (try await get("/api/ai-subscriptions/periods", as: AIPeriodsResponse.self)).periods }
    func aiAnalytics(viewCurrency: String) async throws -> AIAnalytics {
        try await get("/api/ai-subscriptions/analytics", query: ["viewCurrency": viewCurrency])
    }
    func createAIPeriod(_ body: [String: Any?]) async throws -> AIPeriod {
        (try await json("POST", "/api/ai-subscriptions/periods", body, as: AIPeriodResponse.self)).period
    }
    func updateAIPeriod(id: String, _ body: [String: Any?]) async throws -> AIPeriod {
        (try await json("PATCH", "/api/ai-subscriptions/periods/\(id)", body, as: AIPeriodResponse.self)).period
    }
    func deleteAIPeriod(id: String) async throws { _ = try await json("DELETE", "/api/ai-subscriptions/periods/\(id)") }

    // MARK: Conversations / chat
    func conversations() async throws -> [Conversation] { try await get("/api/conversations") }
    func createConversation() async throws -> Conversation { try await json("POST", "/api/conversations", nil, as: Conversation.self) }
    func deleteConversation(id: String) async throws { _ = try await json("DELETE", "/api/conversations/\(id)") }
    func messages(conversationId: String) async throws -> [StoredChatMessage] { try await get("/api/conversations/\(conversationId)/messages") }
    func executeTool(name: String, args: JSONValue) async throws -> JSONValue {
        let body = try JSONEncoder().encode(ExecuteToolBody(toolName: name, args: args, timezone: timezone))
        let data = try await send(makeRequest("POST", "/api/chat/execute-tool", body: body))
        return (try? JSONDecoder().decode(JSONValue.self, from: data)) ?? .null
    }
}

struct ExecuteToolBody: Encodable { let toolName: String; let args: JSONValue; let timezone: String }
