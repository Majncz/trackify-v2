import Foundation
#if canImport(Security)
import Security
#endif

/// App Group shared between the apps, widgets and intents.
public enum AppGroup {
    public static let id = "group.co.bitterlemon.trackify"

    public static let defaults: UserDefaults = {
        UserDefaults(suiteName: id) ?? .standard
    }()

    /// Darwin notification posted by extensions after they change the shared timer state.
    public static let timerChangedNotification = "co.bitterlemon.trackify.timer-changed"
}

// MARK: - Session (server + credentials)

public struct StoredSession: Codable, Equatable, Sendable {
    public var server: String
    public var token: String
    public var userId: String
    public var email: String
    public init(server: String, token: String, userId: String, email: String) {
        self.server = server; self.token = token; self.userId = userId; self.email = email
    }
}

/// Keychain (app-group access group) with a graceful fallback to App Group defaults for unsigned builds
/// (errSecMissingEntitlement), so CI and simulator builds without a team still work.
public final class CredentialStore: @unchecked Sendable {
    public static let shared = CredentialStore()

    let service = "co.bitterlemon.trackify.session"
    let account = "default"
    let fallbackKey = "trackify.session.fallback"
    let defaults: UserDefaults
    let accessGroup: String?

    public init(defaults: UserDefaults = AppGroup.defaults, accessGroup: String? = AppGroup.id) {
        self.defaults = defaults
        self.accessGroup = accessGroup
    }

    public func load() -> StoredSession? {
        if let d = keychainRead(), let s = try? JSONDecoder().decode(StoredSession.self, from: d) { return s }
        if let d = defaults.data(forKey: fallbackKey), let s = try? JSONDecoder().decode(StoredSession.self, from: d) { return s }
        return nil
    }

    public func save(_ s: StoredSession) {
        guard let d = try? JSONEncoder().encode(s) else { return }
        // Only a write into the shared access group is readable by the extensions; otherwise mirror to defaults.
        if keychainWrite(d) {
            defaults.removeObject(forKey: fallbackKey)
        } else {
            defaults.set(d, forKey: fallbackKey)
        }
    }

    public func clear() {
        keychainDelete()
        defaults.removeObject(forKey: fallbackKey)
    }

    #if canImport(Security)
    private func baseQuery(group: String?) -> [String: Any] {
        var q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: account]
        if let group { q[kSecAttrAccessGroup as String] = group }
        #if os(macOS)
        q[kSecUseDataProtectionKeychain as String] = true
        #endif
        return q
    }

    private func keychainRead() -> Data? {
        for group in [accessGroup, nil] {
            var q = baseQuery(group: group)
            q[kSecReturnData as String] = true
            q[kSecMatchLimit as String] = kSecMatchLimitOne
            var out: CFTypeRef?
            if SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data { return d }
        }
        return nil
    }

    private func keychainWrite(_ d: Data) -> Bool {
        for group in [accessGroup, nil] {
            let q = baseQuery(group: group)
            SecItemDelete(q as CFDictionary)
            var add = q
            add[kSecValueData as String] = d
            add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
            let status = SecItemAdd(add as CFDictionary, nil)
            if status == errSecSuccess { return group != nil || accessGroup == nil }
            // errSecMissingEntitlement (-34018) and friends → try next / fall back to defaults.
        }
        return false
    }

    private func keychainDelete() {
        for group in [accessGroup, nil] { SecItemDelete(baseQuery(group: group) as CFDictionary) }
    }
    #else
    private func keychainRead() -> Data? { nil }
    private func keychainWrite(_ d: Data) -> Bool { false }
    private func keychainDelete() {}
    #endif
}

// MARK: - Widget snapshot (NATIVE_SPEC §6)

public struct WidgetSnapshot: Codable, Equatable, Sendable {
    public struct Running: Codable, Equatable, Sendable {
        public var taskId: String
        public var taskName: String
        public var accentHex: String
        public var startTime: Int64
        public var pending: Bool?
        public init(taskId: String, taskName: String, accentHex: String, startTime: Int64, pending: Bool? = nil) {
            self.taskId = taskId; self.taskName = taskName; self.accentHex = accentHex; self.startTime = startTime; self.pending = pending
        }
    }
    public struct TaskItem: Codable, Equatable, Hashable, Sendable, Identifiable {
        public var id: String
        public var name: String
        public var accentHex: String
        public var todayMs: Int64
        public var totalMs: Int64
        public init(id: String, name: String, accentHex: String, todayMs: Int64, totalMs: Int64) {
            self.id = id; self.name = name; self.accentHex = accentHex; self.todayMs = todayMs; self.totalMs = totalMs
        }
    }

    public var signedIn: Bool
    public var serverUrl: String
    public var userId: String?
    public var updatedAt: Int64
    public var running: Running?
    /// Completed events today (local) — add the live part at render time.
    public var todayTotalMs: Int64
    /// Day the `todayTotalMs` belongs to (`yyyy-MM-dd`), so a stale snapshot after midnight shows 0.
    public var todayKey: String?
    public var tasks: [TaskItem]

    public init(signedIn: Bool, serverUrl: String, userId: String?, updatedAt: Int64, running: Running?, todayTotalMs: Int64, todayKey: String? = nil, tasks: [TaskItem]) {
        self.signedIn = signedIn; self.serverUrl = serverUrl; self.userId = userId; self.updatedAt = updatedAt
        self.running = running; self.todayTotalMs = todayTotalMs; self.todayKey = todayKey; self.tasks = tasks
    }

    public static let signedOut = WidgetSnapshot(signedIn: false, serverUrl: APIClient.liveServer.absoluteString, userId: nil, updatedAt: 0,
                                                 running: nil, todayTotalMs: 0, tasks: [])

    public func todayTotal(now: Date = Date(), calc: DayCalc = .current) -> Int64 {
        var base = todayTotalMs
        if let k = todayKey, k != calc.dayKey(now) { base = 0 }
        guard let r = running else { return base }
        let s = calc.startOfDay(now)
        return base + liveRangeMs(startTime: r.startTime, now: now.ms, rangeStart: s, rangeEnd: calc.endOfDay(now))
    }

    /// Last-used task when idle (Home order puts the most recent first).
    public var lastTask: TaskItem? { tasks.first }

    /// Re-apply the engine's running state (widgets/intents act before the app refreshes).
    public func applying(running r: RunningTimer?) -> WidgetSnapshot {
        var copy = self
        if let r {
            let t = tasks.first { $0.id == r.taskId }
            copy.running = Running(taskId: r.taskId, taskName: t?.name ?? running?.taskName ?? "Task",
                                   accentHex: t?.accentHex ?? running?.accentHex ?? Accent.taskAccentHex(r.taskId),
                                   startTime: r.startTime, pending: r.pending)
        } else {
            copy.running = nil
        }
        return copy
    }

    public static func build(tasks: [TrackifyTask], running: RunningTimer?, session: StoredSession?, now: Date = Date(), calc: DayCalc = .current) -> WidgetSnapshot {
        let sorted = Analytics.sortTasks(tasks, runningTaskId: running?.taskId)
        let items = sorted.prefix(8).map {
            TaskItem(id: $0.id, name: $0.name, accentHex: $0.accentHex, todayMs: Analytics.todayMs($0, now: now, calc: calc), totalMs: $0.totalMs)
        }
        var snap = WidgetSnapshot(signedIn: session != nil, serverUrl: session?.server ?? APIClient.liveServer.absoluteString,
                                  userId: session?.userId, updatedAt: now.ms, running: nil,
                                  todayTotalMs: Analytics.todayMs(tasks.filter { !$0.hidden }, now: now, calc: calc),
                                  todayKey: calc.dayKey(now), tasks: Array(items))
        if let running, let t = tasks.first(where: { $0.id == running.taskId }) {
            snap.running = Running(taskId: t.id, taskName: t.name, accentHex: t.accentHex, startTime: running.startTime, pending: running.pending)
        } else if let running {
            snap = snap.applying(running: running)
        }
        return snap
    }
}

public final class SnapshotStore: @unchecked Sendable {
    public static let shared = SnapshotStore()
    let defaults: UserDefaults
    let key = "trackify.widget-snapshot.v1"
    public init(defaults: UserDefaults = AppGroup.defaults) { self.defaults = defaults }

    public func load() -> WidgetSnapshot {
        guard let d = defaults.data(forKey: key), let s = try? JSONDecoder().decode(WidgetSnapshot.self, from: d) else { return .signedOut }
        return s
    }

    public func save(_ s: WidgetSnapshot) {
        if let d = try? JSONEncoder().encode(s) { defaults.set(d, forKey: key) }
    }
}

// MARK: - Settings shared by app + extensions

public enum SharedKeys {
    public static let lastServer = "trackify.lastServer"
    public static let lastEmail = "trackify.lastEmail"
    public static let menuBarShowSeconds = "trackify.menubar.showSeconds"
    public static let menuBarHideName = "trackify.menubar.hideName"
    public static let reminderHours = "trackify.reminder.hours"   // 0 = off
}
