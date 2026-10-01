import SwiftUI
import TrackifyKit

/// Timer tab (PHONE_REDESIGN.md): today's total, the running timer when there is one,
/// "Start a task…" and a plain list of tasks. Tap a row to start / switch.
struct TimerScreen: View {
    @Environment(AppModel.self) private var model
    @State private var nav = NavigationState.shared
    @State private var query = ""
    @State private var fixing: RunningTimer?
    @State private var loggingPast: TrackifyTask?
    @State private var showNewTask = false
    @State private var createError: String?
    @State private var creating = false
    @FocusState private var searchFocused: Bool

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    private var filtered: [TrackifyTask] {
        let all = model.sortedTasks
        guard !trimmed.isEmpty else { return all }
        return all.filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
    }

    var body: some View {
        List {
            if let err = model.saveError {
                errorBanner(err)
            }
            if let r = model.running, trimmed.isEmpty {
                Section { RunningSection(running: r, onFix: { fixing = r }, onOpen: { open(r.taskId) }) }
            }
            Section {
                searchField
                taskRows
            }
        }
        .listStyle(.plain)
        .scrollDismissesKeyboard(.immediately)
        .accessibilityIdentifier("timerScreen")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .principal) { TodayHeader() }
            ToolbarItem(placement: .topBarTrailing) {
                Button { showNewTask = true } label: { Image(systemName: "plus") }
                    .accessibilityLabel("New task")
                    .accessibilityIdentifier("newTask")
            }
        }
        .refreshable { await model.refreshAll() }
        .sheet(isPresented: $showNewTask) { NewTaskSheet().trackifySheet() }
        .sheet(item: $fixing) { r in FixSessionSheet(running: r).trackifySheet() }
        .sheet(item: $loggingPast) { t in LogPastSheet(task: t).trackifySheet() }
    }

    private func open(_ taskId: String) { nav.homePath.append(Route.task(taskId)) }

    // MARK: Error banner

    private func errorBanner(_ err: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "exclamationmark.circle.fill").foregroundStyle(Theme.destructive)
            Text("Couldn’t save: \(err)").font(.subheadline).foregroundStyle(Theme.destructive).lineLimit(2)
            Spacer(minLength: 0)
            Button { model.saveError = nil } label: { Image(systemName: "xmark").font(.footnote.weight(.semibold)) }
                .buttonStyle(.borderless)
                .foregroundStyle(Theme.destructive)
                .accessibilityLabel("Dismiss")
        }
        .listRowBackground(Theme.destructive.opacity(0.08))
        .listRowSeparator(.hidden)
    }

    // MARK: Search / create

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.mutedForeground)
            TextField("Start a task…", text: $query)
                .focused($searchFocused)
                .submitLabel(.go)
                .autocorrectionDisabled()
                .onSubmit(submit)
                .accessibilityIdentifier("taskSearch")
            if !query.isEmpty {
                Button { query = ""; createError = nil } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.mutedForeground)
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Clear")
            }
        }
        .padding(.horizontal, 10)
        .frame(minHeight: 40)
        .background(Theme.muted, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .listRowSeparator(.hidden)
        .listRowInsets(EdgeInsets(top: 6, leading: 16, bottom: 6, trailing: 16))
    }

    /// Go: start the top match, or create the typed task and start it.
    private func submit() {
        if let first = filtered.first {
            model.start(first.id)
            query = ""
            searchFocused = false
        } else if !trimmed.isEmpty {
            createAndStart(trimmed)
        }
    }

    private func createAndStart(_ name: String) {
        guard !creating else { return }
        creating = true
        createError = nil
        Task {
            do {
                try await model.createAndStart(name: name)
                query = ""
                searchFocused = false
            } catch let e as APIError { createError = e.message } catch {}
            creating = false
        }
    }

    // MARK: Rows

    @ViewBuilder private var taskRows: some View {
        let rows = filtered
        if !model.tasksLoaded {
            if let e = model.tasksError {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Couldn't load tasks").font(.headline)
                    Text(e).font(.subheadline).foregroundStyle(Theme.mutedForeground)
                    Button("Retry") { Task { await model.refreshTasks() } }
                }
                .padding(.vertical, 8)
            } else {
                ForEach(0..<6, id: \.self) { _ in
                    Skeleton(height: 18).padding(.vertical, 14)
                }
            }
        } else {
            let exact = rows.contains { $0.name.compare(trimmed, options: .caseInsensitive) == .orderedSame }
            ForEach(rows) { t in
                TaskRow(task: t, onLogPast: { loggingPast = t }, onDetails: { open(t.id) })
            }
            if !trimmed.isEmpty && !exact {
                Button { createAndStart(trimmed) } label: {
                    Label {
                        Text("Create “\(trimmed)” and start").lineLimit(2)
                    } icon: {
                        Image(systemName: creating ? "hourglass" : "plus.circle.fill")
                    }
                    .font(.body.weight(.medium))
                    .frame(maxWidth: .infinity, minHeight: 44, alignment: .leading)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("createAndStart")
                if let createError {
                    Text(createError).font(.footnote).foregroundStyle(Theme.destructive)
                }
            } else if rows.isEmpty {
                Text("No tasks yet. Type a name above to create one.")
                    .font(.subheadline).foregroundStyle(Theme.mutedForeground)
                    .padding(.vertical, 12)
                    .listRowSeparator(.hidden)
            }
        }
    }
}

// MARK: - Header

/// "Today 5h 12m ●" — live, in the navigation bar.
private struct TodayHeader: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { ctx in
            HStack(spacing: 6) {
                Text("Today").foregroundStyle(Theme.mutedForeground)
                Text(Fmt.durationWords(model.todayMs(now: ctx.date))).fontWeight(.semibold).tabular()
                ConnectionDot(look: model.connectionLook)
            }
            .font(.headline)
            .fixedSize()
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("todayTotal")
    }
}

// MARK: - Running

/// Only while a timer runs: task, big clock (tap → Fix session), Stop.
private struct RunningSection: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var typeSize
    let running: RunningTimer
    var onFix: () -> Void
    var onOpen: () -> Void

    var body: some View {
        let task = model.task(running.taskId)
        VStack(alignment: .leading, spacing: 6) {
            Button(action: onOpen) {
                HStack(spacing: 8) {
                    AccentDot(hex: task?.accentHex ?? Accent.taskAccentHex(running.taskId), size: 10)
                    Text(task?.name ?? "…").font(.headline).lineLimit(2).foregroundStyle(Theme.foreground)
                    if let g = task?.taskGroup { GroupPill(name: g.name, hex: g.accentHex) }
                    Spacer(minLength: 0)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Show details")
            .accessibilityIdentifier("runningTask")

            let clockButton = Button(action: onFix) {
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    Text(Fmt.duration(ctx.date.ms - running.startTime))
                        .font(.clock).tabular()
                        .lineLimit(1).minimumScaleFactor(0.5)
                        .foregroundStyle(Theme.foreground)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Elapsed time. Fix this session")
            .accessibilityIdentifier("runningClock")

            if typeSize.isAccessibilitySize {
                clockButton
                stopButton.frame(maxWidth: .infinity)
            } else {
                HStack(alignment: .center) {
                    clockButton
                    Spacer(minLength: 12)
                    stopButton
                }
            }
            Group {
                if running.pending {
                    Text("Syncing…").foregroundStyle(Theme.amber).pendingPulse(true)
                } else {
                    Text("since \(clock(running.startTime)) · tap the time to fix it").foregroundStyle(Theme.mutedForeground)
                }
            }
            .font(.footnote)
        }
        .padding(.vertical, 6)
        .listRowSeparator(.hidden)
    }

    private var stopButton: some View {
        Button { model.stop() } label: {
            Label(model.stopQueued ? "Saving…" : "Stop", systemImage: "stop.fill")
                .font(.body.weight(.semibold))
                .padding(.horizontal, 6)
                .frame(minHeight: 36)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .tint(Theme.destructive)
        .foregroundStyle(.white)
        .accessibilityIdentifier("stopRunning")
    }
}

// MARK: - Task row

/// accent dot · name · today's time · ▶ / ■. Tap = start / switch (tap the running one to stop).
struct TaskRow: View {
    @Environment(AppModel.self) private var model
    let task: TrackifyTask
    var onLogPast: () -> Void
    var onDetails: () -> Void

    var body: some View {
        let isRunning = model.running?.taskId == task.id
        Button { model.toggle(task.id) } label: {
            HStack(spacing: 12) {
                AccentDot(hex: task.accentHex, size: 10)
                VStack(alignment: .leading, spacing: 2) {
                    Text(task.name)
                        .font(.body.weight(isRunning ? .semibold : .regular))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(2)
                    if let g = task.taskGroup {
                        Text(g.name).font(.caption).foregroundStyle(Color(hex: g.accentHex)).lineLimit(1)
                    }
                }
                Spacer(minLength: 8)
                TimelineView(.periodic(from: .now, by: isRunning ? 1 : 60)) { ctx in
                    let live = isRunning ? liveTodayMs(ctx.date) : 0
                    let today = Analytics.todayMs(task, now: ctx.date) + live
                    if today > 0 {
                        Text(Fmt.durationWords(today)).font(.subheadline).tabular().foregroundStyle(Theme.mutedForeground)
                    }
                }
                Image(systemName: isRunning ? "stop.fill" : "play.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(isRunning ? Color.white : Theme.foreground)
                    .frame(width: 32, height: 32)
                    .background(isRunning ? Theme.destructive : Theme.muted, in: Circle())
                    .accessibilityHidden(true)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(isRunning ? Theme.emerald.opacity(0.10) : nil)
        .accessibilityLabel(task.name + (isRunning ? ", running" : ""))
        .accessibilityHint(isRunning ? "Stops the timer" : "Starts the timer")
        .accessibilityIdentifier("task-\(task.name)")
        .swipeActions(edge: .trailing, allowsFullSwipe: false) {
            Button { Task { try? await model.hide(task.id) } } label: { Label("Hide", systemImage: "eye.slash") }
                .tint(Theme.mutedForeground)
            Button(action: onDetails) { Label("Details", systemImage: "info.circle") }
                .tint(Theme.blue)
        }
        .swipeActions(edge: .leading) {
            Button(action: onLogPast) { Label("Log time", systemImage: "clock.arrow.circlepath") }
                .tint(Theme.emerald)
        }
        .contextMenu {
            Button { model.toggle(task.id) } label: {
                Label(isRunning ? "Stop" : "Start", systemImage: isRunning ? "stop.fill" : "play.fill")
            }
            Button(action: onLogPast) { Label("Log past time…", systemImage: "clock.arrow.circlepath") }
                .accessibilityIdentifier("logPast-\(task.name)")
            Button(action: onDetails) { Label("Details", systemImage: "info.circle") }
            Divider()
            Button { Task { try? await model.hide(task.id) } } label: { Label("Hide", systemImage: "eye.slash") }
        }
    }

    private func liveTodayMs(_ now: Date) -> Int64 {
        guard let r = model.running else { return 0 }
        let calc = DayCalc.current
        return liveRangeMs(startTime: r.startTime, now: now.ms, rangeStart: calc.startOfDay(now), rangeEnd: calc.endOfDay(now))
    }
}
