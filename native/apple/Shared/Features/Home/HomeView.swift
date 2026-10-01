import SwiftUI
import TrackifyKit

enum Route: Hashable {
    case task(String)
}

struct WidthKey: PreferenceKey {
    static var defaultValue: CGFloat = 390
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

extension RunningTimer: Identifiable { public var id: String { "\(taskId)-\(startTime)" } }

#if os(macOS)
// MARK: - Mac Timer (PHONE_REDESIGN.md, adapted)

/// Timer: the running timer (clock → Fix session, Stop), "Start a task…" and a plain list of tasks.
/// Click a row to start / switch; right-click for Log past time, Details, Hide.
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @State private var nav = NavigationState.shared
    @State private var query = UserDefaults.standard.string(forKey: "TrackifyTimerQuery") ?? ""
    @State private var fixing: RunningTimer?
    @State private var loggingPast: TrackifyTask?
    @State private var showNewTask = false
    @State private var createError: String?
    @State private var creating = false
    @State private var now = Date()
    @FocusState private var searchFocused: Bool

    private var trimmed: String { query.trimmingCharacters(in: .whitespaces) }

    private var filtered: [TrackifyTask] {
        let all = model.sortedTasks
        guard !trimmed.isEmpty else { return all }
        return all.filter { $0.name.localizedCaseInsensitiveContains(trimmed) }
    }

    var body: some View {
        VStack(spacing: 0) {
            if let r = model.running {
                RunningHeader(running: r, onFix: { fixing = r }, onOpen: { open(r.taskId) })
                Divider()
            }
            searchField
            Divider()
            if let err = model.saveError { errorBanner(err) }
            list
        }
        .background(Theme.background)
        .accessibilityIdentifier("timerScreen")
        .navigationTitle("Timer")
        .navigationSubtitle("Today \(Fmt.durationWords(model.todayMs(now: now)))" + (model.connectionLook == .connected ? "" : " · \(model.connectionLook.label)"))
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showNewTask = true } label: { Label("New Task", systemImage: "plus") }
                    .keyboardShortcut("n", modifiers: .command)
                    .help("New task (⌘N)")
                    .accessibilityIdentifier("newTask")
            }
        }
        .task {
            if let name = UserDefaults.standard.string(forKey: "TrackifyOpenTaskNamed"), model.isTestHookEnabled {
                while !model.tasksLoaded { try? await Task.sleep(nanoseconds: 200_000_000) }
                if let t = model.tasks.first(where: { $0.name == name }) { open(t.id) }
            }
        }
        .task(id: model.running?.id) {
            while !Task.isCancelled {
                now = Date()
                try? await Task.sleep(nanoseconds: model.running == nil ? 60_000_000_000 : 20_000_000_000)
            }
        }
        .sheet(isPresented: $showNewTask) { NewTaskSheet().trackifySheet() }
        .sheet(item: $fixing) { r in FixSessionSheet(running: r).trackifySheet() }
        .sheet(item: $loggingPast) { t in LogPastSheet(task: t).trackifySheet() }
    }

    private func open(_ taskId: String) { nav.homePath.append(Route.task(taskId)) }

    // MARK: Search / create

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
            TextField("Start a task…", text: $query)
                .textFieldStyle(.plain)
                .font(.title3)
                .focused($searchFocused)
                .onSubmit(submit)
                .onExitCommand { query = ""; createError = nil }
                .accessibilityIdentifier("taskSearch")
            if !query.isEmpty {
                Button { query = ""; createError = nil } label: { Image(systemName: "xmark.circle.fill") }
                    .buttonStyle(.borderless)
                    .foregroundStyle(.secondary)
                    .accessibilityLabel("Clear")
            }
            // ⌘F focuses the field.
            Button("") { searchFocused = true }
                .keyboardShortcut("f", modifiers: .command)
                .opacity(0).frame(width: 0, height: 0).accessibilityHidden(true)
        }
        .padding(.horizontal, 16)
        .frame(height: 44)
    }

    /// Return: start the top match, or create the typed task and start it.
    private func submit() {
        if let first = filtered.first {
            model.start(first.id)
            query = ""
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
            } catch let e as APIError { createError = e.message } catch {}
            creating = false
        }
    }

    private func errorBanner(_ err: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
            Text("Couldn’t save: \(err)").lineLimit(2)
            Spacer(minLength: 0)
            Button("Dismiss") { model.saveError = nil }.controlSize(.small)
        }
        .font(.callout)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .background(Color.red.opacity(0.08))
    }

    // MARK: List

    @ViewBuilder private var list: some View {
        let rows = filtered
        if !model.tasksLoaded {
            if let e = model.tasksError {
                VStack(spacing: 8) {
                    Text("Couldn’t load tasks").font(.headline)
                    Text(e).foregroundStyle(.secondary)
                    Button("Try Again") { Task { await model.refreshTasks() } }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else {
            let exact = rows.contains { $0.name.compare(trimmed, options: .caseInsensitive) == .orderedSame }
            List {
                if !trimmed.isEmpty && !exact {
                    Button { createAndStart(trimmed) } label: {
                        Label {
                            Text("Create “\(trimmed)” and start").lineLimit(1)
                        } icon: {
                            Image(systemName: creating ? "hourglass" : "plus.circle.fill").foregroundStyle(Color.accentColor)
                        }
                        .frame(maxWidth: .infinity, minHeight: 30, alignment: .leading)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("createAndStart")
                    if let createError { Text(createError).foregroundStyle(.red) }
                }
                Section {
                    ForEach(rows) { t in
                        MacTaskRow(task: t, onLogPast: { loggingPast = t }, onDetails: { open(t.id) })
                    }
                } header: {
                    if !rows.isEmpty {
                        HStack {
                            Text(trimmed.isEmpty ? "Tasks" : "Matching tasks")
                            Spacer()
                            Text("Today").frame(width: MacTaskRow.columnWidth, alignment: .trailing)
                            Text("Total").frame(width: MacTaskRow.columnWidth, alignment: .trailing)
                            Color.clear.frame(width: MacTaskRow.actionsWidth)
                        }
                    }
                }
                if rows.isEmpty && trimmed.isEmpty {
                    Text("No tasks yet. Type a name above and press Return to create one.")
                        .foregroundStyle(.secondary)
                }
            }
            .listStyle(.inset(alternatesRowBackgrounds: false))
            .scrollContentBackground(.hidden)
        }
    }
}

// MARK: - Running

/// Only while a timer runs: task (click → details), big clock (click → Fix session), Stop.
private struct RunningHeader: View {
    @Environment(AppModel.self) private var model
    let running: RunningTimer
    var onFix: () -> Void
    var onOpen: () -> Void

    var body: some View {
        let task = model.task(running.taskId)
        HStack(alignment: .center, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Button(action: onOpen) {
                    HStack(spacing: 8) {
                        AccentDot(hex: task?.accentHex ?? Accent.taskAccentHex(running.taskId), size: 9)
                        Text(task?.name ?? "…").font(.title3.weight(.semibold)).lineLimit(1)
                        if let g = task?.taskGroup { GroupPill(name: g.name, hex: g.accentHex) }
                    }
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .help("Show details")
                .accessibilityIdentifier("runningTask")
                Group {
                    if running.pending {
                        Text("Syncing…").foregroundStyle(Theme.amber).pendingPulse(true)
                    } else {
                        Text("Since \(clock(running.startTime)) · click the time to fix it").foregroundStyle(.secondary)
                    }
                }
                .font(.callout)
            }
            Spacer(minLength: 12)
            Button(action: onFix) {
                TimelineView(.periodic(from: .now, by: 1)) { ctx in
                    Text(Fmt.duration(ctx.date.ms - running.startTime))
                        .font(.system(size: 34, weight: .semibold, design: .monospaced))
                        .tabular()
                        .lineLimit(1)
                }
            }
            .buttonStyle(.plain)
            .help("Fix this session")
            .accessibilityLabel("Elapsed time. Fix this session")
            .accessibilityIdentifier("runningClock")
            Button { model.stop() } label: {
                Label(model.stopQueued ? "Saving…" : "Stop", systemImage: "stop.fill")
                    .frame(minWidth: 64)
            }
            .buttonStyle(.borderedProminent)
            .tint(.red)
            .controlSize(.large)
            .keyboardShortcut(".", modifiers: .command)
            .help("Stop (⌘.)")
            .accessibilityIdentifier("stopRunning")
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(Theme.emerald.opacity(0.07))
    }
}

// MARK: - Task row

/// accent dot · name (group) · today · total · ▶/■. Click = start / switch (click the running one to stop).
struct MacTaskRow: View {
    static let columnWidth: CGFloat = 80
    static let actionsWidth: CGFloat = 56

    @Environment(AppModel.self) private var model
    let task: TrackifyTask
    var onLogPast: () -> Void
    var onDetails: () -> Void
    @State private var hovering = false

    var body: some View {
        let isRunning = model.running?.taskId == task.id
        HStack(spacing: 10) {
            AccentDot(hex: task.accentHex, size: 9)
            Text(task.name)
                .fontWeight(isRunning ? .semibold : .regular)
                .lineLimit(1)
            if let g = task.taskGroup {
                Text(g.name).font(.callout).foregroundStyle(Color(hex: g.accentHex)).lineLimit(1)
            }
            Spacer(minLength: 8)
            TimelineView(.periodic(from: .now, by: isRunning ? 1 : 60)) { ctx in
                let live = isRunning ? liveMs(ctx.date, today: true) : 0
                let today = Analytics.todayMs(task, now: ctx.date) + live
                HStack(spacing: 0) {
                    Text(today > 0 ? Fmt.durationWords(today) : "—")
                        .frame(width: Self.columnWidth, alignment: .trailing)
                    Text(Fmt.durationWords(task.totalMs + (isRunning ? liveMs(ctx.date, today: false) : 0)))
                        .frame(width: Self.columnWidth, alignment: .trailing)
                }
                .tabular()
                .foregroundStyle(.secondary)
            }
            HStack(spacing: 6) {
                Button(action: onDetails) { Image(systemName: "info.circle") }
                    .buttonStyle(.borderless)
                    .foregroundStyle(.secondary)
                    .help("Details")
                    .opacity(hovering ? 1 : 0)
                    .accessibilityLabel("Details")
                Image(systemName: isRunning ? "stop.fill" : "play.fill")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundStyle(isRunning ? Color.white : (hovering ? Color.primary : Color.secondary))
                    .frame(width: 24, height: 24)
                    .background(isRunning ? Color.red : Color.primary.opacity(hovering ? 0.12 : 0.06), in: Circle())
                    .accessibilityHidden(true)
            }
            .frame(width: Self.actionsWidth, alignment: .trailing)
        }
        .padding(.vertical, 5)
        .contentShape(Rectangle())
        .onTapGesture { model.toggle(task.id) }
        .onHover { hovering = $0 }
        .listRowBackground(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(isRunning ? Theme.emerald.opacity(0.12) : (hovering ? Color.primary.opacity(0.05) : .clear))
                .padding(.horizontal, 6)
        )
        .help(isRunning ? "Click to stop" : "Click to start")
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isButton)
        .accessibilityLabel(task.name + (isRunning ? ", running" : ""))
        .accessibilityHint(isRunning ? "Stops the timer" : "Starts the timer")
        .accessibilityIdentifier("task-\(task.name)")
        .contextMenu {
            Button(isRunning ? "Stop" : "Start") { model.toggle(task.id) }
            Divider()
            Button("Log Past Time…", action: onLogPast)
                .accessibilityIdentifier("logPast-\(task.name)")
            Button("Details", action: onDetails)
            Divider()
            Button("Hide") { Task { try? await model.hide(task.id) } }
        }
    }

    private func liveMs(_ now: Date, today: Bool) -> Int64 {
        guard let r = model.running else { return 0 }
        if !today { return max(0, now.ms - r.startTime) }
        let calc = DayCalc.current
        return liveRangeMs(startTime: r.startTime, now: now.ms, rangeStart: calc.startOfDay(now), rangeEnd: calc.endOfDay(now))
    }
}
#endif
