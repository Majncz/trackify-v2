import Foundation
import Observation
import AppKit
import TrackifyKit

/// What the menu-bar panel draws, derived from `AppModel` only when its data changes (never in a view body):
/// the sorted task rows with today's time, today's total, the heat-map days and today's team. A minute tick runs
/// only while the panel is open, so a closed panel costs nothing.
@Observable
@MainActor
final class PanelModel {
    struct Row: Identifiable, Equatable {
        let id: String
        let name: String
        let accentHex: String
        /// Completed time today (the running stretch is added by the running row).
        let todayMs: Int64
    }

    private(set) var rows: [Row] = []
    /// Completed time today across visible tasks.
    private(set) var todayCompletedMs: Int64 = 0
    /// Heat-map data in the widget's snapshot shape (tasks omitted).
    private(set) var heat: WidgetSnapshot?
    private(set) var team: TeamSnapshot = .empty
    /// Advances on the next whole minute (of the running timer, or the clock) while the panel is open.
    private(set) var now = Date()
    private(set) var visible = false
    /// ⌘ held while the panel is key: the ⌘1…9 hints get stronger.
    var commandHeld = false
    /// Launch-at-login state (an XPC round trip to read, so it's read off the main thread when the panel opens).
    private(set) var launchAtLogin = false

    @ObservationIgnored let model: AppModel
    @ObservationIgnored private var recomputeQueued = false
    @ObservationIgnored private var heatTask: Task<Void, Never>?
    @ObservationIgnored private var heatSource: (count: Int, events: Int, totalMs: Int64, day: String)?
    @ObservationIgnored private var ticker: Timer?
    @ObservationIgnored private var dayKey = ""
    @ObservationIgnored private var flagsMonitor: Any?

    init(model: AppModel) {
        self.model = model
        recompute()
        observe()
        let nc = NotificationCenter.default
        nc.addObserver(forName: .trackifyPanelOpened, object: nil, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.setVisible(true) }
        }
        nc.addObserver(forName: .trackifyPanelClosed, object: nil, queue: .main) { [weak self] _ in
            // After the fade-out, so the clock doesn't jump while it's still visible.
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                MainActor.assumeIsolated { self?.setVisible(false) }
            }
        }
    }

    // MARK: Derived data

    private func observe() {
        withObservationTracking {
            _ = model.tasks
            _ = model.running
            _ = model.presenceToday
            _ = model.phase
        } onChange: { [weak self] in
            // Fires before the change lands; coalesce a burst (refresh results arrive one by one) into one pass.
            Task { @MainActor [weak self] in
                guard let self else { return }
                self.queueRecompute()
                self.observe()
            }
        }
    }

    private func queueRecompute() {
        guard !recomputeQueued else { return }
        recomputeQueued = true
        DispatchQueue.main.async { [weak self] in
            self?.recomputeQueued = false
            self?.recompute()
        }
    }

    func recompute() {
        let t = Date()
        let calc = DayCalc.current
        let tasks = model.tasks
        let running = model.running
        let newRows = Analytics.sortTasks(tasks, runningTaskId: running?.taskId).map {
            Row(id: $0.id, name: $0.name, accentHex: $0.accentHex, todayMs: Analytics.todayMs($0, now: t, calc: calc))
        }
        if newRows != rows { rows = newRows }
        let today = Analytics.todayMs(tasks.filter { !$0.hidden }, now: t, calc: calc)
        if today != todayCompletedMs { todayCompletedMs = today }
        dayKey = calc.dayKey(t)
        updateHeat(tasks: tasks, running: running, now: t)
        updateTeam(running: running, now: t)
    }

    /// Minutes per day for the heat map, off the main thread, only when the events changed (or the day did).
    private func updateHeat(tasks: [TrackifyTask], running: RunningTimer?, now: Date) {
        // Cheap fingerprint of the events: count + summed duration (an edit changes one of them).
        let source = (count: tasks.count, events: tasks.reduce(0) { $0 + $1.events.count },
                      totalMs: tasks.reduce(Int64(0)) { $0 + $1.totalMs }, day: dayKey)
        let today = todayCompletedMs
        let runningSnap = running.map { snapshotRunning($0) }
        if let s = heatSource, s == source, var h = heat {
            if h.running != runningSnap || h.todayTotalMs != today {
                h.running = runningSnap
                h.todayTotalMs = today
                heat = h
            }
            return
        }
        heatSource = source
        heatTask?.cancel()
        heatTask = Task.detached(priority: .userInitiated) { [weak self] in
            let days = WidgetHeat.minutesPerDay(tasks: tasks, end: now)
            let key = DayCalc.current.dayKey(now)
            await MainActor.run {
                guard let self, !Task.isCancelled else { return }
                self.heat = WidgetSnapshot(signedIn: true, serverUrl: "", userId: nil, updatedAt: now.ms,
                                           running: self.model.running.map { self.snapshotRunning($0) },
                                           todayTotalMs: self.todayCompletedMs, todayKey: key, tasks: [],
                                           heatDays: days, heatEndKey: key)
            }
        }
    }

    private func updateTeam(running: RunningTimer?, now: Date) {
        guard let p = model.presenceToday, let me = model.session?.userId else {
            if team != .empty { team = .empty }
            return
        }
        // Our own row follows the local timer right away (the next presence fetch confirms it).
        let t = TeamSnapshot.from(p, day: DayCalc.current.dayKey(now), myId: me, now: now)
            .applying(running: running.map { snapshotRunning($0) }, userId: me, now: now)
        var a = t, b = team
        a.fetchedAt = 0; b.fetchedAt = 0
        if a != b { team = t }
    }

    private func snapshotRunning(_ r: RunningTimer) -> WidgetSnapshot.Running {
        let t = model.task(r.taskId)
        return .init(taskId: r.taskId, taskName: t?.name ?? "…", accentHex: t?.accentHex ?? Accent.taskAccentHex(r.taskId),
                     startTime: r.startTime, pending: r.pending)
    }

    /// Running task's name from the last widget snapshot, for the moment before the task list has loaded.
    @ObservationIgnored private(set) lazy var cachedRunningName: String? = SnapshotStore.shared.load().running?.taskName

    /// Today including the running stretch.
    func todayTotal(at date: Date) -> Int64 {
        var total = todayCompletedMs
        if let r = model.running {
            let calc = DayCalc.current
            total += liveRangeMs(startTime: r.startTime, now: date.ms, rangeStart: calc.startOfDay(date), rangeEnd: calc.endOfDay(date))
        }
        return total
    }

    // MARK: Launch at login

    func setLaunchAtLogin(_ on: Bool) {
        launchAtLogin = on
        Task.detached(priority: .userInitiated) { LaunchAtLogin.set(on) }
    }

    private func readLaunchAtLogin() {
        Task.detached(priority: .utility) { [weak self] in
            let on = LaunchAtLogin.isEnabled
            await MainActor.run { if self?.launchAtLogin != on { self?.launchAtLogin = on } }
        }
    }

    // MARK: Visibility + minute tick

    func setVisible(_ v: Bool) {
        guard v != visible else { return }
        visible = v
        if v {
            tick()
            readLaunchAtLogin()
            flagsMonitor = NSEvent.addLocalMonitorForEvents(matching: .flagsChanged) { [weak self] e in
                let held = e.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command
                if self?.commandHeld != held { self?.commandHeld = held }
                return e
            }
        } else {
            ticker?.invalidate()
            ticker = nil
            if let m = flagsMonitor { NSEvent.removeMonitor(m); flagsMonitor = nil }
            if commandHeld { commandHeld = false }
        }
    }

    private func tick() {
        let t = Date()
        now = t
        if DayCalc.current.dayKey(t) != dayKey { recompute() }
        ticker?.invalidate()
        guard visible else { return }
        // Next whole minute of the running timer (its minutes are what the panel shows), else of the clock.
        let anchor = model.running?.startTime ?? 0
        let elapsed = max(0, t.ms - anchor)
        let wait = Double(60_000 - elapsed % 60_000) / 1000 + 0.05
        let timer = Timer(timeInterval: wait, repeats: false) { [weak self] _ in
            Task { @MainActor in self?.tick() }
        }
        timer.tolerance = 0.3
        RunLoop.main.add(timer, forMode: .common)
        ticker = timer
    }
}
