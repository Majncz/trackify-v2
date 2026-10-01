import SwiftUI
import TrackifyKit

/// Stats tab: range → totals → chart → top tasks → groups → Activity (heat grid / yearly calendar).
struct PhoneStatsView: View {
    @Environment(AppModel.self) private var model
    @State private var rangeType: Analytics.StatsRange = .week
    @State private var customFrom = DayCalc.current.startOfWeek(Date())
    @State private var customTo = DayCalc.current.endOfWeek(Date())
    @State private var groupSheet: GroupSheetMode?
    @State private var computed: StatsComputed?
    @State private var liveTick = 0

    private var computeKey: String {
        "\(model.dataTick)|\(model.tasks.count)|\(rangeType.rawValue)|\(customFrom.timeIntervalSince1970)|\(customTo.timeIntervalSince1970)|\(model.running?.id ?? "-")|\(liveTick)"
    }

    private let quickRanges: [Analytics.StatsRange] = [.today, .week, .month, .alltime]

    var body: some View {
        List {
            Section {
                rangePicker
                if rangeType == .custom {
                    DatePicker("From", selection: $customFrom, displayedComponents: .date)
                    DatePicker("To", selection: $customTo, in: customFrom..., displayedComponents: .date)
                }
                totalsRow
            }
            if let c = computed, c.summary.totalMs > 0 {
                Section { BreakdownChartCard(rows: c.rows, top: c.summary.topTasks) }
                Section("Top tasks") {
                    ForEach(Array(c.summary.topTasks.enumerated()), id: \.element.id) { i, t in
                        NavigationLink(value: Route.task(t.task.id)) {
                            ShareRow(title: t.task.name, value: Fmt.fmtMs(t.ms), hex: Accent.taskChartPalette[i % 6],
                                     fraction: c.summary.totalMs > 0 ? Double(t.ms) / Double(c.summary.totalMs) : 0)
                        }
                    }
                }
            } else if computed != nil {
                Section {
                    Text("No data for this period").foregroundStyle(Theme.mutedForeground)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.vertical, 12)
                }
            }
            groupsSection
            Section("Activity") { TimeSpentCard() }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Stats")
        .navigationBarTitleDisplayMode(.inline)
        .refreshable { await model.refreshAll() }
        .sheet(item: $groupSheet) { mode in GroupEditorSheet(mode: mode, range: range(now: Date())).trackifySheet() }
        .task { if !model.groupsLoaded { await model.refreshGroups() } }
        .task { if !model.hiddenLoaded { await model.refreshHidden() } }
        .task(id: computeKey) { await recompute() }
        .task(id: model.running?.id) {
            guard model.running != nil else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                liveTick += 1
            }
        }
    }

    // MARK: Range

    private var rangePicker: some View {
        HStack(spacing: 8) {
            Picker("Range", selection: Binding(get: { rangeType == .custom ? nil : rangeType }, set: { if let v = $0 { rangeType = v } })) {
                ForEach(quickRanges, id: \.self) { r in Text(r == .alltime ? "All" : r.label).tag(Optional(r)) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .accessibilityIdentifier("statsRange")
            Menu {
                Button { rangeType = .custom } label: { Label("Custom range…", systemImage: "calendar") }
            } label: {
                Image(systemName: rangeType == .custom ? "calendar.circle.fill" : "calendar")
                    .font(.title3)
                    .frame(width: 36, height: 32)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Custom range")
        }
    }

    private var totalsRow: some View {
        HStack(alignment: .firstTextBaseline) {
            if let c = computed {
                VStack(alignment: .leading, spacing: 2) {
                    Text(Fmt.fmtMs(c.summary.totalMs)).font(.title2.weight(.bold)).tabular()
                    Text(c.range.label).font(.footnote).foregroundStyle(Theme.mutedForeground).lineLimit(1)
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(Fmt.fmtMs(c.summary.dailyAverageMs)).font(.title3.weight(.semibold)).tabular()
                    Text("daily average").font(.footnote).foregroundStyle(Theme.mutedForeground)
                }
            } else {
                Skeleton(height: 44)
            }
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }

    // MARK: Groups

    @ViewBuilder private var groupsSection: some View {
        let data = Analytics.groupTotals(groups: model.groups, tasks: model.tasks + model.hiddenTasks.map { var t = $0; t.hidden = true; return t })
        let maxMs = max(data.map(\.ms).max() ?? 0, 1)
        Section {
            if !model.groupsLoaded {
                Skeleton(height: 20).padding(.vertical, 8)
            } else {
                ForEach(data) { g in
                    NavigationLink(value: GroupRoute(id: g.group.id)) {
                        ShareRow(title: g.group.name, value: Fmt.fmtMs(g.ms), hex: g.group.accentHex,
                                 fraction: Double(g.ms) / Double(maxMs),
                                 subtitle: "\(g.group.taskIds.count) task\(g.group.taskIds.count == 1 ? "" : "s")")
                    }
                    .contextMenu {
                        Button { groupSheet = .edit(g.group) } label: { Label("Edit", systemImage: "pencil") }
                        Button { Clipboard.copy(Analytics.groupCopyText(g)) } label: { Label("Copy", systemImage: "doc.on.doc") }
                    }
                }
                .onDelete { idx in
                    let ids = idx.map { data[$0].group.id }
                    Task { for id in ids { try? await model.deleteGroup(id) } }
                }
            }
            Button { groupSheet = .create } label: { Label("New group", systemImage: "plus") }
                .accessibilityIdentifier("createGroup")
        } header: {
            HStack {
                Text("Groups · all time")
                Spacer()
                if data.count >= 2 {
                    Button("Copy all") { Clipboard.copy(data.map(Analytics.groupCopyText).joined(separator: "\n\n")) }
                        .font(.footnote)
                        .textCase(nil)
                }
            }
        }
    }

    private func range(now: Date) -> Analytics.Range {
        Analytics.range(rangeType, customFrom: customFrom, customTo: customTo, now: now)
    }

    private func recompute() async {
        let now = Date()
        let r = range(now: now)
        let tasks = model.liveTasks(now: now).filter { !$0.hidden }
        computed = await Task.detached(priority: .userInitiated) { () -> StatsComputed in
            let summary = Analytics.statsSummary(tasks: tasks, range: r)
            let rows = summary.totalMs > 0 ? Analytics.breakdown(tasks: tasks, range: r, topIds: summary.topTasks.map(\.task.id), now: now) : []
            return StatsComputed(range: r, tasks: tasks, summary: summary, rows: rows)
        }.value
    }
}

/// A saved group: members with their all-time totals; edit / copy / delete.
struct GroupDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let groupId: String
    @State private var editing: TaskGroup?
    @State private var confirmDelete = false
    @State private var error: String?

    var body: some View {
        let data = Analytics.groupTotals(groups: model.groups.filter { $0.id == groupId },
                                         tasks: model.tasks + model.hiddenTasks.map { var t = $0; t.hidden = true; return t })
        List {
            if let g = data.first {
                Section {
                    HStack {
                        Text("Total")
                        Spacer()
                        Text(Fmt.fmtMs(g.ms)).font(.headline).tabular()
                    }
                }
                Section("Tasks") {
                    if g.members.isEmpty && g.orphanIds.isEmpty {
                        Text("No tasks in this group").foregroundStyle(Theme.mutedForeground)
                    }
                    ForEach(Array(g.members.enumerated()), id: \.element.id) { i, m in
                        ShareRow(title: m.task.name + (m.task.hidden ? " (hidden)" : ""), value: Fmt.fmtMs(m.ms),
                                 hex: Accent.taskChartPalette[i % 6], fraction: g.ms > 0 ? Double(m.ms) / Double(g.ms) : 0)
                    }
                    ForEach(g.orphanIds, id: \.self) { id in
                        Text("Removed · \(id.prefix(8))…").font(.footnote).foregroundStyle(Color(light: 0xB45309, dark: 0xFBBF24))
                    }
                }
                Section {
                    Button { Clipboard.copy(Analytics.groupCopyText(g)) } label: { Label("Copy summary", systemImage: "doc.on.doc") }
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Delete group", systemImage: "trash") }
                    if let error { Text(error).font(.footnote).foregroundStyle(Theme.destructive) }
                }
                .confirmationDialog("Delete “\(g.group.name)”?", isPresented: $confirmDelete, titleVisibility: .visible) {
                    Button("Delete group", role: .destructive) {
                        Task {
                            do { try await model.deleteGroup(g.group.id); dismiss() }
                            catch let e as APIError { error = e.message } catch {}
                        }
                    }
                }
            } else {
                Text("Group not found").foregroundStyle(Theme.mutedForeground)
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle(data.first?.group.name ?? "Group")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let g = data.first {
                ToolbarItem(placement: .topBarTrailing) { Button("Edit") { editing = g.group } }
            }
        }
        .sheet(item: $editing) { g in
            GroupEditorSheet(mode: .edit(g), range: Analytics.range(.week, customFrom: nil, customTo: nil)).trackifySheet()
        }
    }
}
