import SwiftUI
import AppKit
import TrackifyKit

/// The menu-bar panel (NATIVE_SPEC §5 macOS).
struct MenuPanelView: View {
    @Environment(AppModel.self) private var model
    var close: () -> Void
    var openDashboard: (AppScreen?) -> Void
    /// Screenshot window keeps the content alive; the real panel drops it while hidden (idle CPU).
    var alwaysVisible = false
    @State private var visible = false

    @State private var query = ""
    @State private var fixing: RunningTimer?
    @State private var loggingPast: TrackifyTask?
    @State private var hovered: String?
    @State private var launchAtLogin = LaunchAtLogin.isEnabled
    @State private var createError: String?
    @State private var showNewTask = false
    @FocusState private var searchFocused: Bool

    var body: some View {
        Group {
            if visible || alwaysVisible { panel } else { Theme.background }
        }
        .frame(width: 360, height: 560)
        .onReceive(NotificationCenter.default.publisher(for: .trackifyPanelOpened)) { _ in
            visible = true
            query = ""
            launchAtLogin = LaunchAtLogin.isEnabled
            searchFocused = true
            model.foreground()
        }
        .onReceive(NotificationCenter.default.publisher(for: .trackifyPanelClosed)) { _ in
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { visible = false }
        }
    }

    private var panel: some View {
        VStack(spacing: 0) {
            header
            Hairline()
            if model.phase != .signedIn {
                signedOut
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        if let err = model.saveError {
                            ErrorAlert(title: "Failed to save", message: err) { model.saveError = nil }
                        }
                        if let r = model.running { runningCard(r) }
                        searchField
                        taskList
                        liveNow
                    }
                    .padding(12)
                }
            }
        }
        .frame(width: 360, height: 560)
        .background(Theme.background)
        .background(shortcuts)
        .sheet(item: $fixing) { r in FixSessionSheet(running: r).environment(model) }
        .sheet(item: $loggingPast) { t in LogPastSheet(task: t).environment(model) }
        .sheet(isPresented: $showNewTask) { NewTaskSheet(startAfterCreate: true).environment(model) }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 8) {
            Wordmark(size: 16)
            ConnectionDot(look: model.connectionLook)
            Spacer()
            if model.phase == .signedIn {
                TimelineView(.periodic(from: .now, by: 30)) { ctx in
                    Text("Today \(Fmt.durationWords(model.todayMs(now: ctx.date)))")
                        .font(.system(size: 12, weight: .medium)).tabular().foregroundStyle(Theme.mutedForeground)
                }
            }
            Menu {
                Button("Open Dashboard") { openDashboard(nil) }.keyboardShortcut("d")
                Button("Settings…") { openDashboard(.settings) }.keyboardShortcut(",")
                Toggle("Launch at Login", isOn: Binding(get: { launchAtLogin }, set: { launchAtLogin = $0; LaunchAtLogin.set($0) }))
                Divider()
                if model.phase == .signedIn {
                    Button("Sign Out") { Task { await model.signOut() } }
                }
                Button("Quit Trackify") { NSApp.terminate(nil) }.keyboardShortcut("q")
            } label: {
                Image(systemName: "ellipsis.circle").font(.system(size: 15)).foregroundStyle(Theme.mutedForeground)
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityLabel("More")
        }
        .padding(.horizontal, 14)
        .frame(height: 44)
    }

    private var signedOut: some View {
        VStack(spacing: 14) {
            Spacer()
            AppGlyph(size: 48)
            Text("Sign in to start tracking").font(.system(size: 15, weight: .semibold))
            Button("Open Trackify") { openDashboard(.home) }.buttonStyle(.t(.primary))
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: Running card

    private func runningCard(_ r: RunningTimer) -> some View {
        let task = model.task(r.taskId)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                AccentDot(hex: task?.accentHex ?? Accent.taskAccentHex(r.taskId))
                Text(task?.name ?? "…").font(.system(size: 14, weight: .semibold)).lineLimit(1)
                if let g = task?.taskGroup { GroupPill(name: g.name, hex: g.accentHex) }
                Spacer(minLength: 0)
                if r.pending {
                    Text("Syncing…").font(.system(size: 11, weight: .medium)).foregroundStyle(Theme.amber).pendingPulse(true)
                }
            }
            HStack(alignment: .center) {
                Button { fixing = r } label: {
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        Text(Fmt.duration(ctx.date.ms - r.startTime)).font(.system(size: 30, weight: .bold, design: .monospaced)).tabular()
                    }
                }
                .buttonStyle(.plain)
                .help("Fix this session")
                Spacer()
                Button { model.stop() } label: { Label(model.stopQueued ? "Saving..." : "Stop", systemImage: "square.fill") }
                    .buttonStyle(.t(.destructive))
                    .keyboardShortcut(".", modifiers: .command)
            }
            HStack {
                Text("since \(clock(r.startTime))").font(.system(size: 12)).foregroundStyle(Theme.mutedForeground)
                Spacer()
                Button("Fix…") { fixing = r }.buttonStyle(.plain).font(.system(size: 12, weight: .medium))
            }
        }
        .padding(12)
        .background(Theme.primary.opacity(0.05), in: RoundedRectangle(cornerRadius: 10))
        .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(r.pending ? Theme.pending : Theme.primary.opacity(0.6), lineWidth: r.pending ? 1.5 : 1))
    }

    // MARK: Search / quick start

    private var filtered: [TrackifyTask] {
        let all = model.sortedTasks
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return all }
        return all.filter { $0.name.localizedCaseInsensitiveContains(q) }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(Theme.mutedForeground)
            TextField("Start a task…", text: $query)
                .textFieldStyle(.plain)
                .focused($searchFocused)
                .onSubmit(submitSearch)
            if !query.isEmpty {
                Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(Theme.mutedForeground) }
                    .buttonStyle(.plain)
            }
        }
        .font(.system(size: 14))
        .padding(.horizontal, 10)
        .frame(height: 34)
        .background(Theme.muted.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
    }

    private func submitSearch() {
        let q = query.trimmingCharacters(in: .whitespaces)
        if let first = filtered.first {
            model.start(first.id)
            query = ""
        } else if !q.isEmpty {
            createAndStart(q)
        }
    }

    private func createAndStart(_ name: String) {
        createError = nil
        Task {
            do { try await model.createAndStart(name: name); query = "" }
            catch let e as APIError { createError = e.message } catch {}
        }
    }

    // MARK: Task rows

    @ViewBuilder private var taskList: some View {
        let rows = filtered
        VStack(alignment: .leading, spacing: 2) {
            if !model.tasksLoaded {
                ForEach(0..<5, id: \.self) { _ in Skeleton(height: 28).padding(.vertical, 3) }
            } else if rows.isEmpty {
                let q = query.trimmingCharacters(in: .whitespaces)
                if q.isEmpty {
                    Text("No tasks yet. Type a name above to create one.").font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
                        .padding(.vertical, 8)
                } else {
                    Button { createAndStart(q) } label: {
                        HStack {
                            Image(systemName: "plus.circle.fill")
                            Text("Create “\(q)” and start")
                            Spacer()
                            Text("↩").foregroundStyle(Theme.mutedForeground)
                        }
                        .font(.system(size: 13, weight: .medium))
                        .padding(.horizontal, 10).frame(height: 34)
                        .background(Theme.muted.opacity(0.6), in: RoundedRectangle(cornerRadius: 8))
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
                InlineError(text: createError)
            } else {
                ForEach(Array(rows.enumerated()), id: \.element.id) { i, t in
                    taskRow(t, index: i)
                }
            }
        }
    }

    private func taskRow(_ t: TrackifyTask, index: Int) -> some View {
        let running = model.running?.taskId == t.id
        let isHover = hovered == t.id
        return Button { model.toggle(t.id) } label: {
            HStack(spacing: 10) {
                AccentDot(hex: t.accentHex)
                Text(t.name).font(.system(size: 13, weight: running ? .semibold : .regular)).lineLimit(1)
                Spacer(minLength: 6)
                if isHover || running {
                    Image(systemName: running ? "stop.fill" : "play.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(running ? Theme.destructive : Theme.foreground)
                        .frame(width: 22, height: 22)
                        .background(Theme.muted, in: Circle())
                } else {
                    TimelineView(.periodic(from: .now, by: 30)) { ctx in
                        let today = Analytics.todayMs(t, now: ctx.date)
                        Text("\(Fmt.durationWords(today)) / \(Fmt.durationWords(t.totalMs))")
                            .font(.system(size: 11)).tabular().foregroundStyle(Theme.mutedForeground)
                    }
                }
                if index < 9 {
                    Text("⌘\(index + 1)").font(.system(size: 10, design: .monospaced)).foregroundStyle(Theme.mutedForeground.opacity(0.7))
                        .frame(width: 22, alignment: .trailing)
                }
            }
            .padding(.horizontal, 10)
            .frame(height: 32)
            .background(running ? Theme.emerald.opacity(0.12) : (isHover ? Theme.muted.opacity(0.7) : .clear), in: RoundedRectangle(cornerRadius: 7))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { h in hovered = h ? t.id : (hovered == t.id ? nil : hovered) }
        .contextMenu {
            Button(running ? "Stop" : "Start") { model.toggle(t.id) }
            Button("Log past time…") { loggingPast = t }
            Button("Details") { NavigationState.shared.open(.task(t.id)); openDashboard(.home) }
            Divider()
            Button("Hide") { Task { try? await model.hide(t.id) } }
        }
        .accessibilityLabel("\(t.name)\(running ? ", running" : "")")
    }

    // MARK: Live now

    @ViewBuilder private var liveNow: some View {
        let others = (model.presenceToday?.tracking ?? []).filter { $0.userId != model.session?.userId }
        if !others.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                Text("LIVE NOW").font(.label11).tracking(0.6).foregroundStyle(Theme.mutedForeground)
                TimelineView(.periodic(from: .now, by: 30)) { ctx in
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(others, id: \.userId) { p in
                            HStack(spacing: 6) {
                                Circle().fill(Theme.emerald).frame(width: 6, height: 6)
                                Text(p.name).font(.system(size: 12, weight: .medium)).lineLimit(1)
                                Text("· \(p.taskName)").font(.system(size: 12)).foregroundStyle(Theme.mutedForeground).lineLimit(1)
                                Spacer()
                                Text(Fmt.durationWords(max(0, ctx.date.ms - p.startTime))).font(.system(size: 11)).tabular().foregroundStyle(Theme.emeraldText)
                            }
                        }
                    }
                }
            }
            .padding(10)
            .background(Theme.emerald.opacity(0.06), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    // MARK: Keyboard shortcuts

    private var shortcuts: some View {
        ZStack {
            ForEach(0..<9, id: \.self) { i in
                Button("") {
                    let rows = filtered
                    if i < rows.count { model.start(rows[i].id) }
                }
                .keyboardShortcut(KeyEquivalent(Character("\(i + 1)")), modifiers: .command)
            }
            Button("") { model.stop() }.keyboardShortcut(".", modifiers: .command)
            Button("") { searchFocused = true }.keyboardShortcut("f", modifiers: .command)
            Button("") { showNewTask = true }.keyboardShortcut("n", modifiers: .command)
            Button("") { openDashboard(nil) }.keyboardShortcut("d", modifiers: .command)
            Button("") { close() }.keyboardShortcut(.escape, modifiers: [])
        }
        .opacity(0)
        .frame(width: 0, height: 0)
        .accessibilityHidden(true)
    }
}
