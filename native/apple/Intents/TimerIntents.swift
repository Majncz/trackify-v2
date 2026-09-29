import AppIntents
import Foundation
import TrackifyKit
#if canImport(WidgetKit)
import WidgetKit
#endif

/// Runs timer actions for App Intents, widgets, controls and the Live Activity.
/// In the app process it uses the app's engine; in extensions it builds a short-lived one over the shared store.
enum IntentRuntime {
    nonisolated(unsafe) static var hostEngine: TimerEngine?
    nonisolated(unsafe) static var hostAPI: APIClient?

    struct NotSignedIn: Error, CustomLocalizedStringResourceConvertible {
        var localizedStringResource: LocalizedStringResource { "Sign in to Trackify first." }
    }

    static func engine() async throws -> (TimerEngine, Bool) {
        if let e = hostEngine { return (e, true) }
        guard let s = CredentialStore.shared.load(), let url = URL(string: s.server) else { throw NotSignedIn() }
        let api = APIClient(baseURL: url, token: s.token)
        let e = TimerEngine(transport: api, store: DefaultsTimerStore(defaults: AppGroup.defaults))
        await e.setAutoSync(false)
        await e.bind(userId: s.userId)
        return (e, false)
    }

    static func start(taskId: String) async throws {
        let (e, host) = try await engine()
        await e.start(taskId: taskId)
        await finish(e, host: host)
    }

    static func stop() async throws {
        let (e, host) = try await engine()
        await e.stop()
        await finish(e, host: host)
    }

    static func toggle(taskId: String) async throws {
        let (e, _) = try await engine()
        if await e.state.running?.taskId == taskId { try await stop() } else { try await start(taskId: taskId) }
    }

    static func running() async -> RunningTimer? {
        if let e = hostEngine { return await e.state.running }
        return DefaultsTimerStore(defaults: AppGroup.defaults).load()?.running
    }

    private static func finish(_ e: TimerEngine, host: Bool) async {
        let st = await e.state
        // Update the widget snapshot immediately so widgets flip before the network answers.
        let snap = SnapshotStore.shared.load().applying(running: st.running)
        SnapshotStore.shared.save(snap)
        // Our own row in "Team today" follows right away too; the running task sorts first, so show page 1.
        let team = TeamSnapshotStore.shared.load()
        let moved = team.applying(running: snap.running, userId: snap.userId)
        if moved != team { TeamSnapshotStore.shared.save(moved) }
        WidgetPageStore.shared.reset()
        reloadWidgets()
        if !host {
            postChanged()
            await e.drain(maxAttempts: 3)
            let after = await e.state
            SnapshotStore.shared.save(SnapshotStore.shared.load().applying(running: after.running))
            reloadWidgets()
            postChanged()
        }
    }

    static func reloadWidgets() {
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadAllTimelines()
        if #available(iOS 18.0, macOS 15.0, *) {
            #if os(iOS)
            ControlCenter.shared.reloadAllControls()
            #endif
        }
        #endif
    }

    static func postChanged() {
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        CFNotificationCenterPostNotification(center, CFNotificationName(AppGroup.timerChangedNotification as CFString), nil, nil, true)
    }
}

// MARK: - Task entity

struct TaskEntity: AppEntity, Identifiable {
    static var typeDisplayRepresentation: TypeDisplayRepresentation { "Task" }
    static var defaultQuery = TaskEntityQuery()

    var id: String
    var name: String

    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

struct TaskEntityQuery: EntityStringQuery {
    func entities(for identifiers: [String]) async throws -> [TaskEntity] {
        let all = try await allTasks()
        return identifiers.compactMap { id in all.first { $0.id == id } }
    }

    func entities(matching string: String) async throws -> [TaskEntity] {
        try await allTasks().filter { $0.name.localizedCaseInsensitiveContains(string) }
    }

    func suggestedEntities() async throws -> [TaskEntity] { try await allTasks() }

    private func allTasks() async throws -> [TaskEntity] {
        let snap = SnapshotStore.shared.load()
        if let s = CredentialStore.shared.load(), let url = URL(string: s.server) {
            let api = APIClient(baseURL: url, token: s.token)
            if let tasks = try? await api.tasks() {
                return Analytics.sortTasks(tasks, runningTaskId: snap.running?.taskId).map { TaskEntity(id: $0.id, name: $0.name) }
            }
        }
        return snap.tasks.map { TaskEntity(id: $0.id, name: $0.name) }
    }
}

// MARK: - Intents

struct StartTaskIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Task"
    static var description = IntentDescription("Starts tracking a Trackify task. If another task is running, its time is saved first.")

    @Parameter(title: "Task") var task: TaskEntity

    init() {}
    init(task: TaskEntity) { self.task = task }

    static var parameterSummary: some ParameterSummary { Summary("Start \(\.$task)") }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        try await IntentRuntime.start(taskId: task.id)
        return .result(dialog: "Started \(task.name).")
    }
}

#if os(iOS)
struct StopTimerIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Stop Timer"
    static var description = IntentDescription("Stops the running Trackify timer and saves the time.")
    init() {}
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let was = await IntentRuntime.running()
        try await IntentRuntime.stop()
        if was == nil { return .result(dialog: "No timer is running.") }
        return .result(dialog: "Stopped.")
    }
}
#else
struct StopTimerIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop Timer"
    static var description = IntentDescription("Stops the running Trackify timer and saves the time.")
    init() {}
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let was = await IntentRuntime.running()
        try await IntentRuntime.stop()
        if was == nil { return .result(dialog: "No timer is running.") }
        return .result(dialog: "Stopped.")
    }
}
#endif

struct CurrentTimerIntent: AppIntent {
    static var title: LocalizedStringResource = "Current Timer"
    static var description = IntentDescription("Tells you what you're tracking and for how long.")
    init() {}
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let snap = SnapshotStore.shared.load()
        guard let r = await IntentRuntime.running() else {
            return .result(value: "", dialog: "No timer is running.")
        }
        let name = snap.tasks.first { $0.id == r.taskId }?.name ?? snap.running?.taskName ?? "a task"
        let elapsed = Fmt.durationWords(max(0, Date().ms - r.startTime))
        return .result(value: name, dialog: "You're tracking \(name) — \(elapsed) so far.")
    }
}

/// Widget buttons: start/switch to a task by id.
struct WidgetStartIntent: AppIntent {
    static var title: LocalizedStringResource = "Start Trackify Task"
    static var isDiscoverable = false
    @Parameter(title: "Task ID") var taskId: String
    init() {}
    init(taskId: String) { self.taskId = taskId }
    func perform() async throws -> some IntentResult {
        try await IntentRuntime.toggle(taskId: taskId)
        return .result()
    }
}

/// Widget Stop button.
struct WidgetStopIntent: AppIntent {
    static var title: LocalizedStringResource = "Stop Trackify Timer"
    static var isDiscoverable = false
    init() {}
    func perform() async throws -> some IntentResult {
        try await IntentRuntime.stop()
        return .result()
    }
}

/// Large widget ‹ ›: flip the task list page (the page slides in from that side).
struct WidgetPageIntent: AppIntent {
    static var title: LocalizedStringResource = "Page Trackify Tasks"
    static var isDiscoverable = false
    @Parameter(title: "Direction") var delta: Int
    init() {}
    init(delta: Int) { self.delta = delta }
    func perform() async throws -> some IntentResult {
        WidgetPageStore.shared.move(delta)
        #if canImport(WidgetKit)
        WidgetCenter.shared.reloadTimelines(ofKind: "TrackifyTimer")
        #endif
        return .result()
    }
}

/// Control Center toggle: on = start the last task, off = stop.
struct ToggleTimerIntent: SetValueIntent {
    static var title: LocalizedStringResource = "Toggle Trackify Timer"
    static var isDiscoverable = false
    @Parameter(title: "Running") var value: Bool
    init() {}
    func perform() async throws -> some IntentResult {
        if value {
            let snap = SnapshotStore.shared.load()
            if let t = snap.lastTask { try await IntentRuntime.start(taskId: t.id) }
        } else {
            try await IntentRuntime.stop()
        }
        return .result()
    }
}
