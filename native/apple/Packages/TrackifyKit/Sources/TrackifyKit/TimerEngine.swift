import Foundation

// MARK: - State (NATIVE_SPEC §3)

public struct RunningTimer: Codable, Equatable, Hashable, Sendable {
    public var taskId: String
    public var startTime: Int64
    public var pending: Bool
    public init(taskId: String, startTime: Int64, pending: Bool) {
        self.taskId = taskId; self.startTime = startTime; self.pending = pending
    }
}

public enum TimerOp: Codable, Equatable, Sendable {
    case switchTo(id: String, taskId: String, at: Int64)
    case stop(id: String, taskId: String, at: Int64, startOverride: Int64?)
    case adjustStart(id: String, taskId: String, newStart: Int64)

    public var id: String {
        switch self {
        case .switchTo(let id, _, _), .stop(let id, _, _, _), .adjustStart(let id, _, _): return id
        }
    }

    public var taskId: String {
        switch self {
        case .switchTo(_, let t, _), .stop(_, let t, _, _), .adjustStart(_, let t, _): return t
        }
    }

    static func newId() -> String { "op-\(UUID().uuidString.prefix(8))" }
}

public struct TimerEngineState: Codable, Equatable, Sendable {
    public var running: RunningTimer?
    public var queue: [TimerOp]
    public var userId: String?
    public var updatedAt: Int64
    /// Set once the server answered 404 "route missing" for the native timer endpoints (live server compatibility).
    public var legacyServer: Bool

    public init(running: RunningTimer? = nil, queue: [TimerOp] = [], userId: String? = nil, updatedAt: Int64 = 0, legacyServer: Bool = false) {
        self.running = running; self.queue = queue; self.userId = userId; self.updatedAt = updatedAt; self.legacyServer = legacyServer
    }

    public var hasPendingWork: Bool { !queue.isEmpty }
}

public enum TimerEngineEvent: Sendable {
    case stateChanged(TimerEngineState)
    /// Transient banner text ("Couldn't save: …").
    case error(String)
    /// An op reached the server — refresh tasks/stats/presence.
    case opSucceeded(TimerOp)
    case unauthorized
}

// MARK: - Dependencies

public protocol TimerTransport: Sendable {
    func timerSwitch(taskId: String, at: Int64) async throws -> ServerTimerState
    func timerStop(taskId: String?, endTime: Int64?, startTime: Int64?) async throws
    func timerAdjust(taskId: String, newStart: Int64) async throws -> ServerTimerState
    func timer() async throws -> ServerTimerState
    // Legacy flow (WEB_AUDIT §4.5)
    func createEvent(taskId: String, from: Date, to: Date, name: String, manual: Bool) async throws -> Bool
    func events(taskId: String?) async throws -> [TimeEvent]
    func legacyTimerStart(taskId: String, startTime: Int64) async throws -> ServerTimerState
    func legacyTimerDelete(taskId: String?) async throws
}

extension APIClient: TimerTransport {}

public protocol TimerStateStore: Sendable {
    func load() -> TimerEngineState?
    func save(_ state: TimerEngineState)
}

public final class InMemoryTimerStore: TimerStateStore, @unchecked Sendable {
    private var value: TimerEngineState?
    private let lock = NSLock()
    public init(_ v: TimerEngineState? = nil) { value = v }
    public func load() -> TimerEngineState? { lock.lock(); defer { lock.unlock() }; return value }
    public func save(_ state: TimerEngineState) { lock.lock(); value = state; lock.unlock() }
}

/// UserDefaults-backed store (App Group suite so widgets/intents share the queue).
public final class DefaultsTimerStore: TimerStateStore, @unchecked Sendable {
    let defaults: UserDefaults
    let key: String
    public init(defaults: UserDefaults, key: String = "trackify.timer-engine.v1") { self.defaults = defaults; self.key = key }
    public func load() -> TimerEngineState? {
        guard let d = defaults.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(TimerEngineState.self, from: d)
    }
    public func save(_ state: TimerEngineState) {
        if let d = try? JSONEncoder().encode(state) { defaults.set(d, forKey: key) }
    }
}

// MARK: - Engine

/// Optimistic, durable, single-flight timer engine. UI never waits for the network.
public actor TimerEngine {
    public private(set) var state: TimerEngineState
    private let transport: TimerTransport
    private let store: TimerStateStore
    private let clock: @Sendable () -> Int64
    private let sleeper: @Sendable (UInt64) async throws -> Void
    private var listener: (@Sendable (TimerEngineEvent) -> Void)?
    private var syncTask: Task<Void, Never>?
    private var wake: CheckedContinuation<Void, Never>?
    private var backoffAttempt = 0
    /// Loop keeps retrying forever in the app; extensions drain with a bounded number of attempts.
    private var retryForever = true
    /// Extensions turn this off and call `drain()` instead of running a background loop.
    private var autoSync = true

    public static let backoffBase = 0.6
    public static let backoffFactor = 1.6
    public static let backoffMax = 8.0

    public init(transport: TimerTransport, store: TimerStateStore,
                clock: @escaping @Sendable () -> Int64 = { Date().ms },
                sleeper: @escaping @Sendable (UInt64) async throws -> Void = { try await Task.sleep(nanoseconds: $0) }) {
        self.transport = transport
        self.store = store
        self.clock = clock
        self.sleeper = sleeper
        self.state = store.load() ?? TimerEngineState()
    }

    public func setListener(_ f: (@Sendable (TimerEngineEvent) -> Void)?) { listener = f }

    public func setAutoSync(_ on: Bool) { autoSync = on }

    public var isSyncing: Bool { syncTask != nil }

    // MARK: Session

    /// Scope state to a user; wipes it if a different user signs in.
    public func bind(userId: String?) {
        if state.userId != userId {
            state = TimerEngineState(userId: userId, updatedAt: clock(), legacyServer: false)
            persist()
        }
    }

    public func reset() {
        syncTask?.cancel()
        syncTask = nil
        state = TimerEngineState(updatedAt: clock())
        persist()
    }

    /// Re-read the shared store (a widget/intent may have changed it).
    public func reloadFromStore() {
        guard let s = store.load(), s.updatedAt > state.updatedAt else { return }
        state = s
        notify(.stateChanged(state))
        if !state.queue.isEmpty { kick() }
    }

    // MARK: User actions (optimistic)

    public func start(taskId: String) {
        if let r = state.running, r.taskId == taskId { return }
        let now = clock()
        state.running = RunningTimer(taskId: taskId, startTime: now, pending: true)
        state.queue.append(.switchTo(id: TimerOp.newId(), taskId: taskId, at: now))
        commit()
        kick()
    }

    public func stop() {
        guard let r = state.running else { return }
        state.queue.append(.stop(id: TimerOp.newId(), taskId: r.taskId, at: clock(), startOverride: nil))
        state.running = nil
        commit()
        kick()
    }

    /// Stop in the past ("Fix this session" with an end), optionally with a moved start.
    public func stop(at end: Int64, startOverride: Int64?) {
        guard let r = state.running else { return }
        let stopAt = min(end, clock())
        let start = startOverride ?? r.startTime
        guard stopAt > start else { return }
        state.queue.append(.stop(id: TimerOp.newId(), taskId: r.taskId, at: stopAt,
                                 startOverride: startOverride == r.startTime ? nil : startOverride))
        state.running = nil
        commit()
        kick()
    }

    /// Adjust the running start. Throws the server's message on 4xx (dialog shows it inline and the start reverts).
    public func adjustStart(_ newStart: Int64) async throws {
        guard var r = state.running else { return }
        let original = r.startTime
        r.startTime = newStart
        r.pending = true
        state.running = r
        if !state.queue.isEmpty {
            state.queue.append(.adjustStart(id: TimerOp.newId(), taskId: r.taskId, newStart: newStart))
            commit()
            kick()
            return
        }
        commit()
        do {
            let s = try await transport.timerAdjust(taskId: r.taskId, newStart: newStart)
            if state.queue.isEmpty { adopt(s) }
            notify(.opSucceeded(.adjustStart(id: "direct", taskId: r.taskId, newStart: newStart)))
        } catch let e as APIError {
            switch e.kind {
            case .network, .retryable:
                state.queue.append(.adjustStart(id: TimerOp.newId(), taskId: r.taskId, newStart: newStart))
                commit()
                kick()
            case .unauthorized:
                notify(.unauthorized)
                throw e
            case .client, .decoding:
                if var cur = state.running, cur.taskId == r.taskId {
                    cur.startTime = original
                    cur.pending = false
                    state.running = cur
                    commit()
                }
                throw e
            }
        }
    }

    // MARK: Truth

    /// Adopt `GET /api/timer` when nothing is pending.
    public func refreshTruth() async {
        guard state.queue.isEmpty, syncTask == nil else { return }
        do {
            let s = try await transport.timer()
            guard state.queue.isEmpty, syncTask == nil else { return }
            adopt(s)
        } catch let e as APIError where e.kind == .unauthorized {
            notify(.unauthorized)
        } catch {}
    }

    public enum SocketTimerEvent: Sendable {
        case started(taskId: String, startTime: Int64)
        case stopped(taskId: String)
        case startUpdated(taskId: String, startTime: Int64)
        case state(taskId: String, startTime: Int64)
    }

    /// Socket events are ignored while local ops are pending.
    public func handleSocket(_ ev: SocketTimerEvent) {
        guard state.queue.isEmpty, syncTask == nil else { return }
        switch ev {
        case .started(let t, let s), .state(let t, let s):
            adopt(ServerTimerState(running: true, taskId: t, startTime: s))
        case .stopped(let t):
            if state.running?.taskId == t { state.running = nil; commit() }
        case .startUpdated(let t, let s):
            if var r = state.running, r.taskId == t { r.startTime = s; r.pending = false; state.running = r; commit() }
        }
    }

    func adopt(_ s: ServerTimerState) {
        let next: RunningTimer?
        if s.running, let t = s.taskId, let st = s.startTime { next = RunningTimer(taskId: t, startTime: st, pending: false) }
        else { next = nil }
        if next != state.running { state.running = next; commit() }
    }

    // MARK: Sync loop

    /// Start (or wake) the sync loop.
    public func kick() {
        backoffAttempt = 0
        if let w = wake { wake = nil; w.resume() }
        guard autoSync, syncTask == nil, !state.queue.isEmpty else { return }
        retryForever = true
        syncTask = Task { await self.runLoop() }
    }

    /// For extensions: try to flush the queue within a few attempts, then return.
    public func drain(maxAttempts: Int = 3) async {
        if let t = syncTask { await t.value; return }
        retryForever = false
        var attempts = 0
        while !state.queue.isEmpty && attempts < maxAttempts {
            let ok = await step()
            if !ok { attempts += 1; try? await sleeper(UInt64(0.4 * 1e9)) }
        }
    }

    public func waitUntilIdle() async {
        if let t = syncTask { await t.value }
    }

    private func runLoop() async {
        while !Task.isCancelled, !state.queue.isEmpty {
            let ok = await step()
            if ok { backoffAttempt = 0; continue }
            if !retryForever { break }
            if state.queue.isEmpty { break }
            let delay = min(Self.backoffMax, Self.backoffBase * pow(Self.backoffFactor, Double(backoffAttempt)))
            backoffAttempt += 1
            await sleepOrWake(delay)
        }
        syncTask = nil
        if state.queue.isEmpty {
            await refreshTruth()
            if var r = state.running, r.pending, state.queue.isEmpty { r.pending = false; state.running = r; commit() }
        }
    }

    private func sleepOrWake(_ seconds: Double) async {
        let sleeper = self.sleeper
        await withCheckedContinuation { (c: CheckedContinuation<Void, Never>) in
            wake = c
            Task {
                try? await sleeper(UInt64(seconds * 1e9))
                await self.wakeUp()
            }
        }
    }

    private func wakeUp() {
        if let w = wake { wake = nil; w.resume() }
    }

    /// Performs the head op. Returns true if the queue advanced (success or dropped), false to retry later.
    private func step() async -> Bool {
        guard let op = state.queue.first else { return true }
        do {
            let result = try await perform(op)
            dropHead(op)
            if state.queue.isEmpty, let result { adopt(result) }
            if state.queue.isEmpty, var r = state.running, r.pending, result == nil { r.pending = false; state.running = r; commit() }
            notify(.opSucceeded(op))
            return true
        } catch let e as APIError {
            switch e.kind {
            case .unauthorized:
                notify(.unauthorized)
                return false
            case .network, .retryable, .decoding:
                return false
            case .client:
                dropHead(op)
                notify(.error("Couldn't save: \(e.message)"))
                // Revert optimism for a failed start of the current task.
                if case .switchTo(_, let t, _) = op, state.running?.taskId == t, state.queue.isEmpty { state.running = nil; commit() }
                if state.queue.isEmpty {
                    if let s = try? await transport.timer(), state.queue.isEmpty { adopt(s) }
                }
                notify(.opSucceeded(op))
                return true
            }
        } catch {
            return false
        }
    }

    private func dropHead(_ op: TimerOp) {
        if let i = state.queue.firstIndex(where: { $0.id == op.id }) { state.queue.remove(at: i) }
        commit()
    }

    /// Returns the server timer state when the endpoint reports one.
    private func perform(_ op: TimerOp) async throws -> ServerTimerState? {
        switch op {
        case .switchTo(_, let taskId, let at):
            if state.legacyServer { return try await legacySwitch(taskId: taskId, at: at) }
            do { return try await transport.timerSwitch(taskId: taskId, at: at) }
            catch let e as APIError where Self.isMissingTimerRoute(e) {
                state.legacyServer = true; commit()
                return try await legacySwitch(taskId: taskId, at: at)
            }
        case .stop(_, let taskId, let at, let startOverride):
            if state.legacyServer { try await legacyStop(taskId: taskId, end: at, startOverride: startOverride); return ServerTimerState(running: false) }
            do {
                try await transport.timerStop(taskId: taskId, endTime: at, startTime: startOverride)
                return nil
            } catch let e as APIError where Self.isMissingTimerRoute(e) {
                state.legacyServer = true; commit()
                try await legacyStop(taskId: taskId, end: at, startOverride: startOverride)
                return nil
            }
        case .adjustStart(_, let taskId, let newStart):
            return try await transport.timerAdjust(taskId: taskId, newStart: newStart)
        }
    }

    /// 404 from a server without the native endpoints: non-JSON body, or JSON without our shapes.
    /// `{"error":"Task not found"}` is a real 404 (hidden/deleted task).
    public static func isMissingTimerRoute(_ e: APIError) -> Bool {
        guard e.status == 404 else { return false }
        guard e.bodyIsJSON, let msg = e.json?["error"]?.stringValue else { return true }
        return msg != "Task not found"
    }

    // MARK: Legacy flow (WEB_AUDIT §4.5)

    private func legacySave(taskId: String, from: Int64, to: Int64) async throws {
        guard to - from >= MIN_EVENT_MS else { return }
        do {
            _ = try await transport.createEvent(taskId: taskId, from: Date(ms: from), to: Date(ms: to), name: "Time entry", manual: false)
        } catch let e as APIError where e.status == 409 {
            // Possibly already saved by an earlier attempt: look for a match within ±2 s.
            let evs = try await transport.events(taskId: taskId)
            if evs.contains(where: { abs($0.fromMs - from) <= 2000 && abs($0.toMs - to) <= 2000 }) { return }
            throw e
        }
    }

    private func legacySwitch(taskId: String, at: Int64) async throws -> ServerTimerState {
        let cur = try await transport.timer()
        if cur.running, cur.taskId == taskId { return cur }
        if cur.running, let a = cur.taskId, let a0 = cur.startTime {
            if at > a0 { try await legacySave(taskId: a, from: a0, to: at) }
            try? await transport.legacyTimerDelete(taskId: a)
        }
        return try await transport.legacyTimerStart(taskId: taskId, startTime: at)
    }

    private func legacyStop(taskId: String, end: Int64, startOverride: Int64?) async throws {
        let cur = try await transport.timer()
        guard cur.running, cur.taskId == taskId, let serverStart = cur.startTime else { return }
        let start = startOverride ?? serverStart
        if end > start { try await legacySave(taskId: taskId, from: start, to: end) }
        do { try await transport.legacyTimerDelete(taskId: taskId) }
        catch let e as APIError where e.kind == .client {}
    }

    // MARK: Plumbing

    private func commit() {
        state.updatedAt = max(clock(), state.updatedAt + 1)
        persist()
        notify(.stateChanged(state))
    }

    private func persist() { store.save(state) }

    private func notify(_ e: TimerEngineEvent) { listener?(e) }
}
