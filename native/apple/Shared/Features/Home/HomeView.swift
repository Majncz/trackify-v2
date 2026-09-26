import SwiftUI
import TrackifyKit

enum Route: Hashable {
    case task(String)
}

/// Dashboard `/` (WEB_AUDIT §1.2).
struct HomeView: View {
    @Environment(AppModel.self) private var model
    @State private var showNewTask = false
    @State private var fixing: RunningTimer?
    @State private var loggingPast: TrackifyTask?
    @State private var width: CGFloat = 390

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                PageHeader("Dashboard", subtitle: "Track your time efficiently") {
                    Button { showNewTask = true } label: { Label("New Task", systemImage: "plus") }
                        .buttonStyle(.t(.primary))
                        .keyboardShortcut("n", modifiers: .command)
                        .accessibilityIdentifier("newTask")
                }

                if let err = model.saveError {
                    ErrorAlert(title: "Failed to save", message: err) { model.saveError = nil }
                        .transition(.move(edge: .top).combined(with: .opacity))
                }

                if let r = model.running {
                    RunningBanner(running: r, onFix: { fixing = r })
                        .transition(.opacity.combined(with: .scale(scale: 0.98)))
                }

                LeaderboardCard()

                TaskListSection(width: width, onLogPast: { loggingPast = $0 })

                if !model.tasks.isEmpty {
                    TimeSpentCard()
                }
            }
            .padding(.horizontal, horizontalPadding)
            .padding(.vertical, 16)
            .frame(maxWidth: 896)
            .frame(maxWidth: .infinity)
            .readWidth($width)
            .animation(.easeOut(duration: 0.2), value: model.running)
            .animation(.easeOut(duration: 0.2), value: model.saveError)
        }
        .background(Theme.background)
        .refreshable { await model.refreshAll() }
        .sheet(isPresented: $showNewTask) { NewTaskSheet().trackifySheet() }
        .sheet(item: $fixing) { r in FixSessionSheet(running: r).trackifySheet() }
        .sheet(item: $loggingPast) { t in LogPastSheet(task: t).trackifySheet() }
    }

    private var horizontalPadding: CGFloat {
        width < 640 ? 12 : (width < 1024 ? 16 : 32)
    }
}

struct WidthKey: PreferenceKey {
    static var defaultValue: CGFloat = 390
    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) { value = nextValue() }
}

extension RunningTimer: Identifiable { public var id: String { "\(taskId)-\(startTime)" } }

// MARK: - Running banner

/// "Currently tracking" card with the big clock (tap → Fix this session) and Stop.
struct RunningBanner: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dynamicTypeSize) private var typeSize
    let running: RunningTimer
    var onFix: () -> Void

    var body: some View {
        let large = typeSize.isAccessibilitySize
        Group {
            if large {
                VStack(alignment: .leading, spacing: 12) { info(large: true); stopButton }
            } else {
                HStack(alignment: .center, spacing: 16) { info(large: false); Spacer(minLength: 0); stopButton }
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
            .strokeBorder(running.pending ? Theme.pending : Theme.primary, lineWidth: running.pending ? 2 : 1))
        .pendingPulse(running.pending)
    }

    private var stopButton: some View {
        Button { model.stop() } label: {
            Label(model.stopQueued ? "Saving..." : "Stop", systemImage: "square.fill")
        }
        .buttonStyle(.t(.destructive, .lg))
        .accessibilityIdentifier("stopRunning")
    }

    private func info(large: Bool) -> some View {
        let task = model.task(running.taskId)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Circle().fill(running.pending ? Theme.amber : Theme.emerald).frame(width: 6, height: 6)
                Text(running.pending ? "Syncing..." : "Currently tracking")
                    .font(.scaled(13, weight: .medium))
                    .foregroundStyle(Theme.mutedForeground)
            }
            HStack(spacing: 8) {
                Text(task?.name ?? "…").font(.scaled(18, weight: .semibold)).lineLimit(large ? 2 : 1)
                if let g = task?.taskGroup, !large { GroupPill(name: g.name, hex: g.accentHex) }
            }
            if large, let g = task?.taskGroup { GroupPill(name: g.name, hex: g.accentHex) }
            Button(action: onFix) {
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
            Text("since \(clock(running.startTime)) · tap the clock to fix")
                .font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
        }
    }
}

// MARK: - Task list

struct TaskListSection: View {
    @Environment(AppModel.self) private var model
    var width: CGFloat
    var onLogPast: (TrackifyTask) -> Void
    @State private var showAll = false

    private var columns: Int {
        width < 640 ? 1 : (width < 1024 ? 2 : (width < 1280 ? 3 : 4))
    }

    var body: some View {
        let tasks = model.sortedTasks
        VStack(alignment: .leading, spacing: 12) {
            Text("Tasks (\(tasks.count))").font(.cardTitle)
            if !model.tasksLoaded {
                if let e = model.tasksError {
                    ErrorAlert(title: "Couldn't load tasks", message: e)
                    Button("Retry") { Task { await model.refreshTasks() } }.buttonStyle(.t(.outline, .sm))
                } else {
                    LazyVGrid(columns: grid, spacing: 12) {
                        ForEach(0..<max(2, columns * 2), id: \.self) { _ in
                            VStack(alignment: .leading, spacing: 10) {
                                Skeleton(height: 18, width: 140)
                                Skeleton(height: 12, width: 90)
                                Skeleton(height: 32)
                            }
                            .card()
                        }
                    }
                }
            } else if tasks.isEmpty {
                EmptyState(icon: "checklist", text: "No tasks yet. Click \"New Task\" to get started!")
                    .card()
            } else {
                let limit = columns * 2
                let visible = showAll ? tasks : Array(tasks.prefix(limit))
                LazyVGrid(columns: grid, spacing: 12) {
                    ForEach(visible) { t in
                        TaskCard(task: t, onLogPast: { onLogPast(t) })
                    }
                }
                if tasks.count > limit {
                    Button {
                        withAnimation(.easeOut(duration: 0.2)) { showAll.toggle() }
                    } label: {
                        Label(showAll ? "Show Less" : "Show All (\(tasks.count - limit) more)", systemImage: showAll ? "chevron.up" : "chevron.down")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.t(.ghost, .md, full: true))
                    .accessibilityIdentifier("showAllTasks")
                }
            }
        }
    }

    private var grid: [GridItem] { Array(repeating: GridItem(.flexible(), spacing: 12, alignment: .top), count: columns) }
}

struct TaskCard: View {
    @Environment(AppModel.self) private var model
    let task: TrackifyTask
    var onLogPast: () -> Void

    var body: some View {
        let isRunning = model.running?.taskId == task.id
        let pending = isRunning && (model.running?.pending ?? false)
        NavigationLink(value: Route.task(task.id)) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(task.name).font(.scaled(16, weight: .semibold)).lineLimit(1).foregroundStyle(Theme.foreground)
                    Spacer(minLength: 4)
                    if let g = task.taskGroup { GroupPill(name: g.name, hex: g.accentHex) }
                }
                Group {
                    if isRunning, let r = model.running {
                        TimelineView(.periodic(from: .now, by: 1)) { ctx in
                            Text("Total: \(Fmt.durationWords(task.totalMs + max(0, ctx.date.ms - r.startTime)))")
                        }
                    } else {
                        Text("Total: \(Fmt.durationWords(task.totalMs))")
                    }
                }
                .font(.scaled(14)).foregroundStyle(Theme.mutedForeground).tabular()
                HStack(spacing: 8) {
                    if isRunning {
                        Button { model.stop() } label: {
                            Label(model.stopQueued ? "Saving..." : (pending ? "Syncing..." : "Stop"), systemImage: "square.fill").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.t(.destructive, .md, full: true))
                    } else {
                        Button { model.start(task.id) } label: {
                            Label("Start", systemImage: "play.fill").frame(maxWidth: .infinity)
                        }
                        .buttonStyle(.t(.primary, .md, full: true))
                        .accessibilityIdentifier("start-\(task.name)")
                    }
                    Button(action: onLogPast) { Image(systemName: "plus") }
                        .buttonStyle(.t(.outline, .icon))
                        .help("Add time that already happened")
                        .accessibilityLabel("Add time that already happened")
                        .accessibilityIdentifier("logPast-\(task.name)")
                }
            }
            .padding(16)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous).strokeBorder(Theme.border))
            .overlay {
                if isRunning {
                    RoundedRectangle(cornerRadius: Theme.cardRadius + 3, style: .continuous)
                        .strokeBorder(pending ? Theme.pending : Theme.primary, lineWidth: 2)
                        .padding(-4)
                }
            }
            .shadow(color: .black.opacity(0.05), radius: 1.5, y: 1)
            .pendingPulse(pending)
            .contentShape(RoundedRectangle(cornerRadius: Theme.cardRadius))
        }
        .buttonStyle(.plain)
        .padding(isRunning ? 4 : 0)
        .contextMenu {
            Button { model.toggle(task.id) } label: { Label(isRunning ? "Stop" : "Start", systemImage: isRunning ? "stop.fill" : "play.fill") }
            Button(action: onLogPast) { Label("Log past time…", systemImage: "clock.arrow.circlepath") }
        }
        .accessibilityIdentifier("taskCard-\(task.name)")
    }
}
