import SwiftUI
import Charts
import TrackifyKit

/// Heavy stats aggregates, computed off the main actor and cached per data version / range / live tick.
struct StatsComputed {
    var range: Analytics.Range
    var tasks: [TrackifyTask]
    var summary: Analytics.StatsSummary
    var rows: [Analytics.BreakdownRow]

    static func compute(tasks: [TrackifyTask], range r: Analytics.Range, now: Date) async -> StatsComputed {
        await Task.detached(priority: .userInitiated) { () -> StatsComputed in
            let summary = Analytics.statsSummary(tasks: tasks, range: r)
            let rows = summary.totalMs > 0 ? Analytics.breakdown(tasks: tasks, range: r, topIds: summary.topTasks.map(\.task.id), now: now) : []
            return StatsComputed(range: r, tasks: tasks, summary: summary, rows: rows)
        }.value
    }
}

// MARK: - Daily breakdown

struct BreakdownChartCard: View {
    let rows: [Analytics.BreakdownRow]
    let top: [Analytics.TaskTotal]
    @State private var selected: String?

    struct Series: Identifiable { let id: String; let name: String; let hex: String; let alpha: Double }

    /// Short days put ticks below an hour (0.25, 0.5…); `Int(h)` turned them all into "0h".
    static func axisLabel(_ h: Double) -> String {
        if h == 0 { return "0" }
        if h < 1 { return "\(Int((h * 60).rounded()))m" }
        return h == h.rounded() ? "\(Int(h))h" : String(format: "%.1fh", h)
    }

    var body: some View {
        let series = top.enumerated().map { Series(id: $0.element.task.id, name: $0.element.task.name, hex: Accent.taskChartPalette[$0.offset % 6], alpha: 0.84) }
            + [Series(id: Analytics.otherKey, name: "Other", hex: Accent.otherHex, alpha: 0.72)]
        let hasOther = rows.contains { ($0.slices[Analytics.otherKey] ?? 0) > 0 }
        VStack(alignment: .leading, spacing: 12) {
            Text("Daily breakdown").font(.scaled(14, weight: .medium))
            Chart {
                ForEach(rows) { row in
                    ForEach(series) { s in
                        let ms = row.slices[s.id] ?? 0
                        if ms > 0 {
                            BarMark(x: .value("Day", row.label), y: .value("Hours", Double(ms) / 3_600_000), width: .ratio(0.74))
                                .foregroundStyle(Color(hex: s.hex, opacity: selected == nil || selected == row.label ? s.alpha : s.alpha * 0.45))
                                .cornerRadius(2)
                        }
                    }
                }
            }
            // Empty days draw no bar; keep them on the axis so a week shows all 7 days.
            .chartXScale(domain: rows.map(\.label))
            .chartXSelection(value: $selected)
            .chartYAxis {
                AxisMarks(position: .leading) { v in
                    AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [3, 3])).foregroundStyle(Theme.border)
                    AxisValueLabel { if let h = v.as(Double.self) { Text(Self.axisLabel(h)).font(.system(size: 11)) } }
                }
            }
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: rows.count > 7 ? 5 : 7)) { _ in
                    AxisValueLabel().font(.system(size: 11))
                }
            }
            .frame(height: 208)
            if let sel = selected, let row = rows.first(where: { $0.label == sel }) {
                BreakdownDetail(row: row, series: series)
            }
            FlowLayout(spacing: 12) {
                ForEach(series.filter { $0.id != Analytics.otherKey || hasOther }) { s in LegendItem(hex: s.hex, name: s.name) }
            }
        }
        .card()
    }
}

struct BreakdownDetail: View {
    let row: Analytics.BreakdownRow
    let series: [BreakdownChartCard.Series]

    var body: some View {
        let items = series.compactMap { s -> (BreakdownChartCard.Series, Int64)? in
            let v = row.slices[s.id] ?? 0
            return v > 0 ? (s, v) : nil
        }.sorted { $0.1 > $1.1 }
        HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(row.detail).font(.scaled(14, weight: .semibold))
                Text(row.numeric).font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
                Text("Day total · \(Fmt.fmtMs(row.totalMs))").font(.scaled(12, weight: .medium)).tabular()
                ForEach(items, id: \.0.id) { s, v in
                    HStack(spacing: 6) {
                        RoundedRectangle(cornerRadius: 2).fill(Color(hex: s.hex)).frame(width: 8, height: 8)
                        Text("\(s.name) — \(pct(v))% · \(Fmt.fmtMs(v))").font(.scaled(12)).tabular()
                    }
                }
            }
            Spacer()
            CopyButton(text: { plain(items) }, label: "Copy")
        }
        .padding(12)
        .background(Theme.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    }

    private func pct(_ v: Int64) -> Int { row.totalMs > 0 ? Int(Fmt.jsRound(Double(v) / Double(row.totalMs) * 100)) : 0 }

    private func plain(_ items: [(BreakdownChartCard.Series, Int64)]) -> String {
        ([row.detail, row.numeric, "Day total · \(Fmt.fmtMs(row.totalMs))"] + items.map { "\($0.0.name) — \(pct($0.1))% · \(Fmt.fmtMs($0.1))" })
            .joined(separator: "\n")
    }
}

// MARK: - Saved groups

enum GroupSheetMode: Identifiable, Hashable {
    case create
    case edit(TaskGroup)
    var id: String { if case .edit(let g) = self { return g.id }; return "create" }
}

// MARK: - Share row

/// Name · value, with a thin proportion bar underneath (top tasks, groups).
struct ShareRow: View {
    var title: String
    var value: String
    var hex: String
    var fraction: Double
    var subtitle: String? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline) {
                Circle().fill(Color(hex: hex)).frame(width: 8, height: 8)
                Text(title).lineLimit(1)
                if let subtitle { Text(subtitle).font(.footnote).foregroundStyle(Theme.mutedForeground) }
                Spacer()
                Text(value).tabular().foregroundStyle(Theme.mutedForeground)
            }
            GeometryReader { g in
                ZStack(alignment: .leading) {
                    Capsule().fill(Theme.muted)
                    Capsule().fill(Color(hex: hex, opacity: 0.85)).frame(width: max(3, g.size.width * CGFloat(min(1, fraction))))
                }
            }
            .frame(height: 4)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

#if os(macOS)
// MARK: - Mac Stats

/// Range in the toolbar → totals → chart beside top tasks → activity beside groups (stacked when narrow).
struct MacStatsView: View {
    @Environment(AppModel.self) private var model
    @State private var rangeType: Analytics.StatsRange = .week
    @State private var customFrom = DayCalc.current.startOfWeek(Date())
    @State private var customTo = DayCalc.current.endOfWeek(Date())
    @State private var groupSheet: GroupSheetMode?
    @State private var computed: StatsComputed?
    @State private var liveTick = 0
    @State private var width: CGFloat = 900

    private var computeKey: String {
        "\(model.dataTick)|\(model.tasks.count)|\(rangeType.rawValue)|\(customFrom.timeIntervalSince1970)|\(customTo.timeIntervalSince1970)|\(model.running?.id ?? "-")|\(liveTick)"
    }

    private var wide: Bool { width >= 820 }
    private let sideWidth: CGFloat = 340

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if rangeType == .custom {
                    HStack(spacing: 16) {
                        DatePicker("From", selection: $customFrom, displayedComponents: .date)
                        DatePicker("To", selection: $customTo, in: customFrom..., displayedComponents: .date)
                        Spacer()
                    }
                    .datePickerStyle(.compact)
                    .fixedSize()
                }
                totals
                if wide {
                    HStack(alignment: .top, spacing: 16) {
                        chartBox
                        topTasksBox.frame(width: sideWidth)
                    }
                    HStack(alignment: .top, spacing: 16) {
                        activityBox
                        groupsBox.frame(width: sideWidth)
                    }
                } else {
                    chartBox
                    topTasksBox
                    groupsBox
                    activityBox
                }
            }
            .padding(20)
            .frame(maxWidth: 1280, alignment: .leading)
            .frame(maxWidth: .infinity)
            .readWidth($width)
        }
        .navigationTitle("Stats")
        .navigationSubtitle(computed?.range.label ?? "")
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("Range", selection: $rangeType) {
                    ForEach([Analytics.StatsRange.today, .week, .month, .alltime, .custom], id: \.self) { r in
                        Text(r == .alltime ? "All" : r.label).tag(r)
                    }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .accessibilityIdentifier("statsRange")
            }
            ToolbarItem(placement: .primaryAction) {
                Button { groupSheet = .create } label: { Label("New Group", systemImage: "folder.badge.plus") }
                    .help("New group")
                    .accessibilityIdentifier("createGroup")
            }
        }
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

    // MARK: Totals

    private var totals: some View {
        HStack(alignment: .firstTextBaseline, spacing: 40) {
            stat("Total", computed.map { Fmt.fmtMs($0.summary.totalMs) })
            stat("Daily average", computed.map { Fmt.fmtMs($0.summary.dailyAverageMs) })
            Spacer()
        }
        .accessibilityElement(children: .combine)
    }

    private func stat(_ title: String, _ value: String?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(.callout).foregroundStyle(.secondary)
            Text(value ?? "—").font(.system(size: 26, weight: .semibold)).tabular()
        }
    }

    // MARK: Boxes

    private var chartBox: some View {
        GroupBox {
            Group {
                if let c = computed, c.summary.totalMs > 0 {
                    BreakdownChartCard(rows: c.rows, top: c.summary.topTasks)
                } else if computed != nil {
                    empty("No time tracked in this period")
                } else {
                    ProgressView().frame(maxWidth: .infinity, minHeight: 240)
                }
            }
            .padding(8)
        }
        .frame(maxWidth: .infinity)
    }

    private var topTasksBox: some View {
        GroupBox {
            VStack(alignment: .leading, spacing: 4) {
                boxTitle("Top tasks")
                if let c = computed, c.summary.totalMs > 0 {
                    ForEach(Array(c.summary.topTasks.enumerated()), id: \.element.id) { i, t in
                        NavigationLink(value: Route.task(t.task.id)) {
                            ShareRow(title: t.task.name, value: Fmt.fmtMs(t.ms), hex: Accent.taskChartPalette[i % 6],
                                     fraction: Double(t.ms) / Double(max(c.summary.totalMs, 1)))
                                .padding(.vertical, 4)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .help("Show details")
                    }
                } else {
                    empty("Nothing yet")
                }
            }
            .padding(8)
        }
    }

    private var activityBox: some View {
        GroupBox {
            TimeSpentCard().padding(8)
        }
        .frame(maxWidth: .infinity)
    }

    private var groupsBox: some View {
        GroupBox {
            MacGroupsList(onEdit: { groupSheet = .edit($0) }, onCreate: { groupSheet = .create })
                .padding(8)
        }
    }

    private func boxTitle(_ text: String) -> some View {
        Text(text).font(.headline).padding(.bottom, 6)
    }

    private func empty(_ text: String) -> some View {
        Text(text).foregroundStyle(.secondary).frame(maxWidth: .infinity, minHeight: 80)
    }

    private func range(now: Date) -> Analytics.Range {
        Analytics.range(rangeType, customFrom: customFrom, customTo: customTo, now: now)
    }

    private func recompute() async {
        let now = Date()
        computed = await StatsComputed.compute(tasks: model.liveTasks(now: now).filter { !$0.hidden }, range: range(now: now), now: now)
    }
}

/// Saved groups with all-time totals. Click a group to show its tasks; right-click to edit, copy or delete.
struct MacGroupsList: View {
    @Environment(AppModel.self) private var model
    var onEdit: (TaskGroup) -> Void
    var onCreate: () -> Void
    @State private var expanded: Set<String> = []
    @State private var deleting: TaskGroup?
    @State private var error: String?

    var body: some View {
        let data = Analytics.groupTotals(groups: model.groups, tasks: model.tasks + model.hiddenTasks.map { var t = $0; t.hidden = true; return t })
        let maxMs = max(data.map(\.ms).max() ?? 0, 1)
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text("Groups").font(.headline)
                Text("all time").foregroundStyle(.secondary)
                Spacer()
                if data.count >= 2 {
                    Button("Copy All") { Clipboard.copy(data.map(Analytics.groupCopyText).joined(separator: "\n\n")) }
                        .buttonStyle(.borderless)
                        .controlSize(.small)
                }
            }
            .padding(.bottom, 6)
            if !model.groupsLoaded {
                ProgressView().frame(maxWidth: .infinity, minHeight: 60)
            } else if data.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Group tasks to see their combined time.").foregroundStyle(.secondary)
                    Button("New Group…", action: onCreate)
                }
            } else {
                ForEach(data) { g in
                    let open = expanded.contains(g.id)
                    VStack(alignment: .leading, spacing: 6) {
                        HStack(spacing: 6) {
                            Image(systemName: "chevron.right")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundStyle(.secondary)
                                .rotationEffect(.degrees(open ? 90 : 0))
                                .frame(width: 10)
                            ShareRow(title: g.group.name, value: Fmt.fmtMs(g.ms), hex: g.group.accentHex,
                                     fraction: Double(g.ms) / Double(maxMs),
                                     subtitle: "\(g.group.taskIds.count) task\(g.group.taskIds.count == 1 ? "" : "s")")
                        }
                        .padding(.vertical, 4)
                        .contentShape(Rectangle())
                        .onTapGesture { if open { expanded.remove(g.id) } else { expanded.insert(g.id) } }
                        if open {
                            VStack(alignment: .leading, spacing: 4) {
                                if g.members.isEmpty && g.orphanIds.isEmpty {
                                    Text("No tasks in this group").foregroundStyle(.secondary)
                                }
                                ForEach(g.members) { m in
                                    HStack {
                                        Text(m.task.name + (m.task.hidden ? " (hidden)" : "")).lineLimit(1)
                                        Spacer()
                                        Text(Fmt.fmtMs(m.ms)).tabular().foregroundStyle(.secondary)
                                    }
                                }
                                ForEach(g.orphanIds, id: \.self) { id in
                                    Text("Removed · \(id.prefix(8))…").foregroundStyle(.orange)
                                }
                                HStack(spacing: 12) {
                                    Button("Edit…") { onEdit(g.group) }
                                    Button("Copy") { Clipboard.copy(Analytics.groupCopyText(g)) }
                                    Button("Delete…", role: .destructive) { deleting = g.group }
                                }
                                .buttonStyle(.link)
                                .padding(.top, 2)
                            }
                            .font(.callout)
                            .padding(.leading, 16)
                            .padding(.bottom, 6)
                        }
                    }
                    .contextMenu {
                        Button("Edit…") { onEdit(g.group) }
                        Button("Copy") { Clipboard.copy(Analytics.groupCopyText(g)) }
                        Divider()
                        Button("Delete…", role: .destructive) { deleting = g.group }
                    }
                }
            }
            if let error { Text(error).font(.callout).foregroundStyle(.red) }
        }
        .confirmationDialog("Delete “\(deleting?.name ?? "")”?", isPresented: Binding(get: { deleting != nil }, set: { if !$0 { deleting = nil } })) {
            Button("Delete Group", role: .destructive) {
                guard let g = deleting else { return }
                Task {
                    do { try await model.deleteGroup(g.id) } catch let e as APIError { error = e.message } catch {}
                }
            }
        } message: {
            Text("Its tasks and their time stay.")
        }
    }
}
#endif
