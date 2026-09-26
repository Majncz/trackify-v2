import Foundation
import SwiftUI
import Observation
import TrackifyKit
#if canImport(WidgetKit)
import WidgetKit
#endif

/// Single source of truth for the apps: session, timer engine, socket, and the data the web computes from.
@Observable
@MainActor
final class AppModel {
    static let shared = AppModel()

    enum Phase: Equatable { case launching, signedOut, signedIn }

    // MARK: Session
    private(set) var phase: Phase = .launching
    private(set) var session: StoredSession?
    var lastEmail: String = AppGroup.defaults.string(forKey: SharedKeys.lastEmail) ?? ""
    var serverString: String = AppGroup.defaults.string(forKey: SharedKeys.lastServer) ?? APIClient.liveServer.absoluteString
    /// Shown on the login screen after a 401 ("Your session expired").
    var signedOutReason: String?

    let api: APIClient
    let engine: TimerEngine
    @ObservationIgnored let socket = SocketIOClient()

    // MARK: Timer
    private(set) var running: RunningTimer?
    private(set) var hasPendingOps = false
    private(set) var stopQueued = false
    /// Transient banner ("Couldn't save: …").
    var saveError: String?

    // MARK: Data
    private(set) var tasks: [TrackifyTask] = []
    private(set) var tasksLoaded = false
    private(set) var tasksError: String?
    private(set) var hiddenTasks: [TrackifyTask] = []
    private(set) var hiddenLoaded = false
    private(set) var groups: [TaskGroup] = []
    private(set) var groupsLoaded = false
    private(set) var stats: StatsResponse?
    private(set) var profile: Profile?
    /// Today's presence (Live-now strip in the menu bar, leaderboard fallback).
    private(set) var presenceToday: PresenceResponse?
    /// Bumped on socket `presence:changed` so leaderboard views refetch (debounced 1 s).
    private(set) var presenceTick = 0
    /// Bumped after every data refresh so screens with their own fetches (billing, AI) can refresh too.
    private(set) var dataTick = 0

    // Feature availability (live-server compatibility).
    var canChangePassword = true
    var canDeleteAccount = true

    // MARK: Connection
    private(set) var socketStatus: SocketStatus = .disconnected
    private(set) var connectionLook: ConnectionLook = .reconnecting
    @ObservationIgnored private var redTask: Task<Void, Never>?

    @ObservationIgnored private var refreshTask: Task<Void, Never>?
    @ObservationIgnored private var presenceTask: Task<Void, Never>?
    @ObservationIgnored private var widgetReloadTask: Task<Void, Never>?
    @ObservationIgnored var timerObservers: [(RunningTimer?) -> Void] = []
    @ObservationIgnored private var socketDisconnectedForBackground = false
    @ObservationIgnored private var lastSnapshot: WidgetSnapshot?
    @ObservationIgnored private var isFirstSnapshotWrite = true
    @ObservationIgnored private var tasksETag: String?

    var calc: DayCalc { DayCalc.current }

    init() {
        let server = URL(string: AppGroup.defaults.string(forKey: SharedKeys.lastServer) ?? "") ?? APIClient.liveServer
        api = APIClient(baseURL: server)
        engine = TimerEngine(transport: api, store: DefaultsTimerStore(defaults: AppGroup.defaults))
        IntentRuntime.hostEngine = engine
        IntentRuntime.hostAPI = api
    }

    // MARK: - Lifecycle

    func bootstrap() async {
        applyLaunchArguments()
        socket.onStatus = { [weak self] s in Task { @MainActor in self?.socketStatusChanged(s) } }
        socket.onEvent = { [weak self] name, args in Task { @MainActor in self?.socketEvent(name, args) } }
        await engine.setListener { [weak self] ev in Task { @MainActor in self?.engineEvent(ev) } }

        if let auto = UserDefaults.standard.string(forKey: "TrackifyAutoLogin"), isTestHookEnabled {
            let parts = auto.split(separator: ":", maxSplits: 1).map(String.init)
            if parts.count == 2, CredentialStore.shared.load()?.email != parts[0] || UserDefaults.standard.bool(forKey: "TrackifyFreshLogin") {
                CredentialStore.shared.clear()
                try? await signIn(email: parts[0], password: parts[1], server: serverString)
                if phase == .signedIn { return }
            }
        }

        if let s = CredentialStore.shared.load() {
            await begin(s)
        } else {
            phase = .signedOut
            writeSnapshot()
        }
    }

    var isTestHookEnabled: Bool {
        #if DEBUG
        return true
        #else
        return ProcessInfo.processInfo.environment["TRACKIFY_UI_TEST"] == "1"
        #endif
    }

    private func applyLaunchArguments() {
        guard isTestHookEnabled else { return }
        if UserDefaults.standard.bool(forKey: "TrackifyResetSession") { CredentialStore.shared.clear() }
        if let s = UserDefaults.standard.string(forKey: "TrackifyServer"), let u = APIClient.normalizeServer(s) {
            serverString = u.absoluteString
        }
    }

    private func begin(_ s: StoredSession) async {
        session = s
        lastEmail = s.email
        serverString = s.server
        api.baseURL = URL(string: s.server) ?? APIClient.liveServer
        api.token = s.token
        api.timezone = TimeZone.current.identifier
        await engine.bind(userId: s.userId)
        let st = await engine.state
        applyEngineState(st)
        if let cached = DataCache.load(userId: s.userId), !tasksLoaded {
            // Instant launch: show the last known data, refresh in the background.
            tasks = cached.tasks
            tasksLoaded = true
            profile = cached.profile
            groups = cached.groups
            groupsLoaded = !cached.groups.isEmpty
            stats = cached.stats
            tasksETag = cached.tasksETag
        }
        phase = .signedIn
        socket.connect(baseURL: api.baseURL, token: s.token)
        writeSnapshot()
        await engine.kick()
        await refreshAll()
        await engine.refreshTruth()
    }

    /// App went to the background (iOS): drop the socket; the timer engine keeps its queue on disk.
    func background() {
        guard phase == .signedIn else { return }
        socket.disconnect()
        socketDisconnectedForBackground = true
    }

    /// App came to foreground / network came back.
    func foreground() {
        guard phase == .signedIn else { return }
        if socketDisconnectedForBackground, let s = session {
            socketDisconnectedForBackground = false
            socket.connect(baseURL: api.baseURL, token: s.token)
        } else {
            socket.nudge()
        }
        Task {
            await engine.reloadFromStore()
            await engine.kick()
            await engine.refreshTruth()
            scheduleRefresh(immediate: true)
        }
    }

    // MARK: - Auth

    func signIn(email: String, password: String, server: String) async throws {
        guard let url = APIClient.normalizeServer(server) else { throw APIError(kind: .client, status: 0, message: "Enter a valid server address") }
        api.baseURL = url
        api.token = nil
        let deviceName: String
        #if os(macOS)
        deviceName = "Trackify for Mac"
        #else
        deviceName = "Trackify for iOS"
        #endif
        let auth = try await api.login(email: email.trimmingCharacters(in: .whitespaces), password: password, deviceName: deviceName)
        let s = StoredSession(server: url.absoluteString, token: auth.token, userId: auth.user.id, email: auth.user.email)
        CredentialStore.shared.save(s)
        AppGroup.defaults.set(url.absoluteString, forKey: SharedKeys.lastServer)
        AppGroup.defaults.set(auth.user.email, forKey: SharedKeys.lastEmail)
        signedOutReason = nil
        await begin(s)
    }

    func register(email: String, password: String, server: String) async throws {
        guard let url = APIClient.normalizeServer(server) else { throw APIError(kind: .client, status: 0, message: "Enter a valid server address") }
        api.baseURL = url
        try await api.register(email: email.trimmingCharacters(in: .whitespaces), password: password)
    }

    func forgotPassword(email: String, server: String) async throws {
        guard let url = APIClient.normalizeServer(server) else { throw APIError(kind: .client, status: 0, message: "Enter a valid server address") }
        api.baseURL = url
        try await api.forgotPassword(email: email.trimmingCharacters(in: .whitespaces))
    }

    func signOut(reason: String? = nil) async {
        if reason == nil, api.token != nil { try? await api.logout() }
        socket.disconnect()
        await engine.reset()
        CredentialStore.shared.clear()
        DataCache.clear()
        ChatSession.shared.reset()
        session = nil
        api.token = nil
        running = nil
        hasPendingOps = false
        stopQueued = false
        tasks = []; hiddenTasks = []; groups = []; stats = nil; profile = nil; presenceToday = nil
        tasksLoaded = false; hiddenLoaded = false; groupsLoaded = false
        tasksETag = nil
        signedOutReason = reason
        phase = .signedOut
        notifyTimerObservers()
        writeSnapshot()
    }

    private func handleUnauthorized() {
        guard phase == .signedIn else { return }
        Task { await signOut(reason: "Your session expired. Please sign in again.") }
    }

    // MARK: - Engine bridge

    private func engineEvent(_ ev: TimerEngineEvent) {
        switch ev {
        case .stateChanged(let s): applyEngineState(s)
        case .error(let m): saveError = m
        case .opSucceeded: scheduleRefresh()
        case .unauthorized: handleUnauthorized()
        }
    }

    private func applyEngineState(_ s: TimerEngineState) {
        let changed = s.running != running
        running = s.running
        hasPendingOps = !s.queue.isEmpty
        stopQueued = s.queue.contains { if case .stop = $0 { return true }; return false }
        if changed { notifyTimerObservers() }
        writeSnapshot()
    }

    private func notifyTimerObservers() {
        for o in timerObservers { o(running) }
    }

    // MARK: - Timer actions (optimistic)

    func start(_ taskId: String) {
        saveError = nil
        Haptics.tap()
        Task { await engine.start(taskId: taskId) }
    }

    func stop() {
        saveError = nil
        Haptics.tap()
        Task { await engine.stop() }
    }

    func toggle(_ taskId: String) {
        if running?.taskId == taskId { stop() } else { start(taskId) }
    }

    func stop(at end: Int64, startOverride: Int64?) {
        Task { await engine.stop(at: end, startOverride: startOverride) }
    }

    func adjustStart(_ newStart: Int64) async throws {
        try await engine.adjustStart(newStart)
    }

    var runningTask: TrackifyTask? {
        guard let id = running?.taskId else { return nil }
        return tasks.first { $0.id == id }
    }

    // MARK: - Refresh

    func refreshAll() async {
        guard phase == .signedIn else { return }
        async let t: Void = refreshTasks()
        async let s: Void = refreshStats()
        async let p: Void = refreshProfile()
        async let g: Void = refreshGroups()
        async let pr: Void = refreshPresenceToday()
        _ = await (t, s, p, g, pr)
        dataTick += 1
        if let uid = session?.userId, tasksLoaded {
            DataCache.save(CachedData(tasks: tasks, profile: profile, groups: groups, stats: stats, savedAt: Date(), tasksETag: tasksETag), userId: uid)
        }
    }

    /// Debounced (≥ 400 ms) refresh of tasks + stats + presence after timer ops / socket events.
    func scheduleRefresh(immediate: Bool = false) {
        refreshTask?.cancel()
        refreshTask = Task {
            if !immediate { try? await Task.sleep(nanoseconds: 400_000_000) }
            guard !Task.isCancelled else { return }
            await refreshAll()
        }
    }

    func refreshTasks() async {
        do {
            let r = try await api.tasksConditional(etag: tasksLoaded ? tasksETag : nil)
            tasksETag = r.etag
            guard let t = r.tasks else {   // 304 Not Modified — cached list is current
                tasksLoaded = true
                tasksError = nil
                return
            }
            tasks = t
            tasksLoaded = true
            tasksError = nil
            writeSnapshot()
            if running != nil { notifyTimerObservers() }   // names may have changed (menu bar, Live Activity)
        } catch let e as APIError {
            if e.kind == .unauthorized { handleUnauthorized() }
            if !tasksLoaded { tasksError = e.message }
        } catch {}
    }

    func refreshHidden() async {
        if let h = try? await api.tasks(hidden: true) {
            hiddenTasks = h.sorted { ($0.updatedAt ?? .distantPast) > ($1.updatedAt ?? .distantPast) }
            hiddenLoaded = true
        }
    }

    func refreshStats() async {
        api.timezone = TimeZone.current.identifier
        if let s = try? await api.stats() { stats = s }
    }

    func refreshProfile() async {
        if let p = try? await api.profile() { profile = p }
    }

    func refreshGroups() async {
        if let g = try? await api.groups() { groups = g; groupsLoaded = true }
    }

    func refreshPresenceToday() async {
        if let p = try? await api.presence(day: calc.dayKey(Date()), range: .day) { presenceToday = p }
    }

    // MARK: - Socket

    private func socketStatusChanged(_ s: SocketStatus) {
        socketStatus = s
        redTask?.cancel()
        switch s {
        case .connected:
            connectionLook = .connected
            socket.emit("timer:request-state")
            Task { await engine.kick(); await engine.refreshTruth() }
            scheduleRefresh()
        case .connecting, .disconnected:
            if connectionLook == .connected || connectionLook == .reconnecting { connectionLook = .reconnecting }
            redTask = Task {
                try? await Task.sleep(nanoseconds: 8_000_000_000)   // RED_GRACE_MS
                guard !Task.isCancelled else { return }
                self.connectionLook = .disconnected
            }
        }
    }

    private func socketEvent(_ name: String, _ args: [JSONValue]) {
        let p = args.first
        func ms(_ v: JSONValue?) -> Int64? { v?.doubleValue.map { Int64($0) } }
        switch name {
        case "auth:error":
            if phase == .signedIn { Task { await self.verifyToken() } }
        case "timer:started":
            if let t = p?["taskId"]?.stringValue, let s = ms(p?["startTime"]) {
                Task { await engine.handleSocket(.started(taskId: t, startTime: s)) }
            }
        case "timer:state":
            if let t = p?["taskId"]?.stringValue, let s = ms(p?["startTime"]) {
                Task { await engine.handleSocket(.state(taskId: t, startTime: s)) }
            }
        case "timer:start-updated":
            if let t = p?["taskId"]?.stringValue, let s = ms(p?["startTime"]) {
                Task { await engine.handleSocket(.startUpdated(taskId: t, startTime: s)) }
            }
        case "timer:stopped":
            if let t = p?["taskId"]?.stringValue { Task { await engine.handleSocket(.stopped(taskId: t)) } }
            scheduleRefresh()
        case "task:created", "task:updated", "task:deleted", "event:created":
            scheduleRefresh()
        case "presence:changed":
            presenceTask?.cancel()
            presenceTask = Task {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                guard !Task.isCancelled else { return }
                self.presenceTick += 1
                await self.refreshPresenceToday()
            }
        default: break
        }
    }

    private func verifyToken() async {
        do { _ = try await api.profile() }
        catch let e as APIError where e.kind == .unauthorized { handleUnauthorized() }
        catch {}
    }

    /// Relay REST task writes so other clients (web) update live (WEB_AUDIT G6).
    private func relay(_ event: String, task: TrackifyTask) {
        if let data = try? TrackifyJSON.encoder().encode(task), let v = try? JSONDecoder().decode(JSONValue.self, from: data) {
            socket.emit(event, v)
        }
    }

    // MARK: - Tasks

    @discardableResult
    func createTask(name: String) async throws -> TrackifyTask {
        let t = try await api.createTask(name: name.trimmingCharacters(in: .whitespacesAndNewlines))
        tasks.append(t)
        tasks.sort { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
        relay("task:created", task: t)
        writeSnapshot()
        return t
    }

    func createAndStart(name: String) async throws {
        let t = try await createTask(name: name)
        start(t.id)
    }

    func rename(_ taskId: String, to name: String) async throws {
        let t = try await api.updateTask(id: taskId, name: name.trimmingCharacters(in: .whitespacesAndNewlines))
        if let i = tasks.firstIndex(where: { $0.id == taskId }) {
            tasks[i].name = t.name
            relay("task:updated", task: tasks[i])
        }
        writeSnapshot()
    }

    func hide(_ taskId: String) async throws {
        try await api.hideTask(id: taskId)
        tasks.removeAll { $0.id == taskId }
        socket.emit("task:hidden", .string(taskId))
        socket.emit("task:deleted", .string(taskId))
        if running?.taskId == taskId { Task { await engine.refreshTruth() } }
        writeSnapshot()
        scheduleRefresh()
    }

    func restore(_ taskId: String) async throws {
        let t = try await api.updateTask(id: taskId, hidden: false)
        hiddenTasks.removeAll { $0.id == taskId }
        relay("task:updated", task: t)
        await refreshTasks()
    }

    // MARK: - Events

    func logPast(taskId: String, from: Int64, to: Int64) async throws {
        _ = try await api.createEvent(taskId: taskId, from: Date(ms: snapMinute(from)), to: Date(ms: snapMinute(to)), name: "Time entry", manual: true)
        socket.emit("event:created", .object(["taskId": .string(taskId)]))
        await refreshTasks()
        scheduleRefresh()
    }

    func updateEvent(_ id: String, from: Date, to: Date) async throws {
        try await api.updateEvent(id: id, from: from, to: to)
        await refreshTasks()
        scheduleRefresh()
    }

    func deleteEvent(_ id: String) async throws {
        try await api.deleteEvent(id: id)
        await refreshTasks()
        scheduleRefresh()
    }

    // MARK: - Groups

    func saveGroup(id: String?, name: String, taskIds: [String], color: String?) async throws {
        if let id { _ = try await api.updateGroup(id: id, name: name, taskIds: taskIds, color: color) }
        else { _ = try await api.createGroup(name: name, taskIds: taskIds, color: color) }
        await refreshGroups()
        await refreshTasks()
    }

    func deleteGroup(_ id: String) async throws {
        try await api.deleteGroup(id: id)
        groups.removeAll { $0.id == id }
        await refreshTasks()
    }

    // MARK: - Profile

    func updateDisplayName(_ name: String) async throws {
        profile = try await api.updateDisplayName(name.trimmingCharacters(in: .whitespaces))
        presenceTick += 1
    }

    func changePassword(current: String, new: String) async throws {
        do { try await api.changePassword(current: current, new: new) }
        catch let e as APIError where e.status == 404 && !e.bodyIsJSON { canChangePassword = false; throw e }
    }

    func deleteAccount(password: String) async throws {
        do { try await api.deleteAccount(password: password) }
        catch let e as APIError where e.status == 404 && !e.bodyIsJSON { canDeleteAccount = false; throw e }
        await signOut(reason: "Your account was deleted.")
    }

    // MARK: - Widget snapshot

    func writeSnapshot() {
        let snap: WidgetSnapshot
        if let session {
            snap = WidgetSnapshot.build(tasks: tasks, running: running, session: session)
        } else {
            snap = .signedOut
        }
        var comparable = snap
        comparable.updatedAt = 0
        if let last = lastSnapshot, last == comparable, !isFirstSnapshotWrite { return }
        isFirstSnapshotWrite = false
        lastSnapshot = comparable
        SnapshotStore.shared.save(snap)
        widgetReloadTask?.cancel()
        widgetReloadTask = Task {
            try? await Task.sleep(nanoseconds: 300_000_000)
            guard !Task.isCancelled else { return }
            #if canImport(WidgetKit)
            WidgetCenter.shared.reloadAllTimelines()
            #endif
        }
    }

    // MARK: - Convenience

    var displayName: String {
        PersonName.name(displayName: profile?.displayName, email: profile?.email ?? session?.email ?? "")
    }

    var sortedTasks: [TrackifyTask] { Analytics.sortTasks(tasks, runningTaskId: running?.taskId) }

    func task(_ id: String) -> TrackifyTask? { tasks.first { $0.id == id } }

    func todayMs(now: Date = Date()) -> Int64 {
        var total = Analytics.todayMs(tasks, now: now, calc: calc)
        if let r = running { total += liveRangeMs(startTime: r.startTime, now: now.ms, rangeStart: calc.startOfDay(now), rangeEnd: calc.endOfDay(now)) }
        return total
    }

    func liveTasks(now: Date = Date()) -> [TrackifyTask] {
        Analytics.withLive(tasks, running: running.map { ($0.taskId, $0.startTime) }, now: now.ms)
    }
}

enum Haptics {
    static func tap() {
        #if os(iOS)
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        #endif
    }
    static func success() {
        #if os(iOS)
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        #endif
    }
}
