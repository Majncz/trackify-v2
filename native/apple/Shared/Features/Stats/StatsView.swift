import SwiftUI
import Charts
import TrackifyKit

/// `/stats` (WEB_AUDIT §1.5).
struct StatsView: View {
    @Environment(AppModel.self) private var model
    @State private var rangeType: Analytics.StatsRange = .week
    @State private var customFrom = DayCalc.current.startOfWeek(Date())
    @State private var customTo = DayCalc.current.endOfWeek(Date())
    @State private var groupSheet: GroupSheetMode?
    @State private var width: CGFloat = 390

    @State private var computed: StatsComputed?
    @State private var liveTick = 0

    /// Heavy aggregates, computed off the main actor and cached per data version / range / live tick.
    struct StatsComputed {
        var range: Analytics.Range
        var tasks: [TrackifyTask]
        var summary: Analytics.StatsSummary
        var rows: [Analytics.BreakdownRow]
    }

    private var computeKey: String {
        "\(model.dataTick)|\(model.tasks.count)|\(rangeType.rawValue)|\(customFrom.timeIntervalSince1970)|\(customTo.timeIntervalSince1970)|\(model.running?.id ?? "-")|\(liveTick)"
    }

    var body: some View {
        ScrollView {
            content
                .padding(.horizontal, width < 640 ? 12 : 24)
                .padding(.vertical, 16)
                .frame(maxWidth: 896)
                .frame(maxWidth: .infinity)
                .readWidth($width)
        }
        .background(Theme.background)
        .refreshable { await model.refreshAll() }
        .sheet(item: $groupSheet) { mode in GroupEditorSheet(mode: mode, range: range(now: Date())).trackifySheet() }
        .task { if !model.groupsLoaded { await model.refreshGroups() } }
        .task(id: computeKey) { await recompute() }
        .task(id: model.running?.id) {
            // Keep live totals fresh while a timer runs (cheap: computed off-main).
            guard model.running != nil else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                liveTick += 1
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
        let result = await Task.detached(priority: .userInitiated) { () -> StatsComputed in
            let summary = Analytics.statsSummary(tasks: tasks, range: r)
            let rows = summary.totalMs > 0 ? Analytics.breakdown(tasks: tasks, range: r, topIds: summary.topTasks.map(\.task.id), now: now) : []
            return StatsComputed(range: r, tasks: tasks, summary: summary, rows: rows)
        }.value
        computed = result
    }

    @ViewBuilder
    private var content: some View {
        VStack(alignment: .leading, spacing: 16) {
            PageHeader("Stats", subtitle: "Analyse your tracked time")
            rangeControls(label: computed?.range.label ?? range(now: Date()).label)
            if !model.tasksLoaded || computed == nil {
                HStack(spacing: 12) { Skeleton(height: 84); Skeleton(height: 84) }
                Skeleton(height: 240)
            } else if let c = computed {
                HStack(alignment: .top, spacing: 12) {
                    headline("Total Tracked", Fmt.fmtMs(c.summary.totalMs), " ")
                    headline("Daily Average", Fmt.fmtMs(c.summary.dailyAverageMs), "per active day")
                }
                .fixedSize(horizontal: false, vertical: true)
                if c.summary.totalMs > 0 {
                    BreakdownChartCard(rows: c.rows, top: c.summary.topTasks)
                    TopTasksCard(top: c.summary.topTasks, total: c.summary.totalMs)
                } else {
                    EmptyState(icon: "chart.bar", text: "No data for this period").card()
                }
                SavedGroupsCard(onCreate: { groupSheet = .create }, onEdit: { groupSheet = .edit($0) })
            }
        }
    }

    private func rangeControls(label: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Segmented(items: Analytics.StatsRange.allCases.map { ($0, $0.label) }, selection: $rangeType)
                .accessibilityIdentifier("statsRange")
            if rangeType == .custom {
                HStack(spacing: 12) {
                    DatePicker("From", selection: $customFrom, displayedComponents: .date)
                    DatePicker("To", selection: $customTo, in: customFrom..., displayedComponents: .date)
                }
                .font(.scaled(14))
            }
            Text(label).font(.scaled(13)).foregroundStyle(Theme.mutedForeground)
        }
    }

    private func headline(_ title: String, _ value: String, _ caption: String?) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.scaled(14, weight: .medium)).foregroundStyle(Theme.mutedForeground)
            Text(value).font(.scaled(26, weight: .bold)).tabular().lineLimit(1).minimumScaleFactor(0.7)
            if let caption { Text(caption).font(.scaled(12)).foregroundStyle(Theme.mutedForeground) }
        }
        .frame(maxHeight: .infinity, alignment: .topLeading)
        .card()
    }
}

// MARK: - Daily breakdown

struct BreakdownChartCard: View {
    let rows: [Analytics.BreakdownRow]
    let top: [Analytics.TaskTotal]
    @State private var selected: String?

    struct Series: Identifiable { let id: String; let name: String; let hex: String; let alpha: Double }

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
            .chartXSelection(value: $selected)
            .chartYAxis {
                AxisMarks(position: .leading) { v in
                    AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [3, 3])).foregroundStyle(Theme.border)
                    AxisValueLabel { if let h = v.as(Double.self) { Text("\(Int(h))h").font(.system(size: 11)) } }
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

// MARK: - Top tasks

struct TopTasksCard: View {
    let top: [Analytics.TaskTotal]
    let total: Int64
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Top tasks").font(.scaled(14, weight: .medium))
            ForEach(Array(top.enumerated()), id: \.element.id) { i, t in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text("\(i + 1)").font(.scaled(13, weight: .semibold)).foregroundStyle(Theme.mutedForeground).frame(width: 16, alignment: .leading)
                        Text(t.task.name).font(.scaled(14, weight: .medium)).lineLimit(1)
                        Spacer()
                        Text(Fmt.fmtMs(t.ms)).font(.scaled(14)).tabular()
                    }
                    GeometryReader { g in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 3).fill(Theme.muted)
                            RoundedRectangle(cornerRadius: 3).fill(Color(hex: Accent.taskChartPalette[i % 6], opacity: 0.88))
                                .frame(width: g.size.width * CGFloat(total > 0 ? Double(t.ms) / Double(total) : 0))
                        }
                    }
                    .frame(height: 6)
                }
            }
        }
        .card()
    }
}

// MARK: - Saved groups

enum GroupSheetMode: Identifiable, Hashable {
    case create
    case edit(TaskGroup)
    var id: String { if case .edit(let g) = self { return g.id }; return "create" }
}

struct SavedGroupsCard: View {
    @Environment(AppModel.self) private var model
    var onCreate: () -> Void
    var onEdit: (TaskGroup) -> Void
    @State private var error: String?

    var body: some View {
        let data = Analytics.groupTotals(groups: model.groups, tasks: model.tasks + model.hiddenTasks.map { var t = $0; t.hidden = true; return t })
        let withTime = data.filter { $0.ms > 0 }
        let maxMs = withTime.map(\.ms).max() ?? 0
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Text("Saved groups").font(.cardTitle)
                    Spacer()
                    if data.count >= 2 {
                        CopyButton(text: { data.map(Analytics.groupCopyText).joined(separator: "\n\n") }, label: "Copy all", showLabel: true)
                    }
                }
                if withTime.count >= 2 && maxMs > 0 {
                    VStack(spacing: 8) {
                        ForEach(withTime.sorted { $0.ms > $1.ms }) { g in
                            HStack(spacing: 10) {
                                Text(g.group.name).font(.scaled(13, weight: .medium)).lineLimit(1).frame(width: 110, alignment: .leading)
                                GeometryReader { geo in
                                    RoundedRectangle(cornerRadius: 3).fill(Color(hex: g.group.accentHex, opacity: 0.85))
                                        .frame(width: max(4, geo.size.width * CGFloat(Double(g.ms) / Double(maxMs))))
                                }
                                .frame(height: 10)
                                Text(Fmt.fmtMs(g.ms)).font(.scaled(13, weight: .medium)).tabular().frame(width: 72, alignment: .trailing)
                            }
                        }
                    }
                    .padding(.bottom, 4)
                }
                if !model.groupsLoaded {
                    Skeleton(height: 60)
                } else if data.isEmpty {
                    Text("No saved groups yet.").font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
                } else {
                    VStack(spacing: 0) {
                        HStack {
                            Text("Group").frame(maxWidth: .infinity, alignment: .leading)
                            Text("Total").frame(width: 72, alignment: .trailing)
                            Color.clear.frame(width: 100)
                        }
                        .font(.scaled(12, weight: .medium)).foregroundStyle(Theme.mutedForeground)
                        .padding(.vertical, 8)
                        Hairline()
                        ForEach(data) { g in
                            groupRow(g)
                            Hairline()
                        }
                    }
                }
                InlineError(text: error)
            }
            .card()
            Button(action: onCreate) { Label("Create a group from tasks", systemImage: "plus") }
                .buttonStyle(.t(.outline))
                .accessibilityIdentifier("createGroup")
        }
        .task { if !model.hiddenLoaded { await model.refreshHidden() } }
    }

    private func groupRow(_ g: Analytics.GroupTotals) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top) {
                HStack(spacing: 8) {
                    Circle().fill(Color(hex: g.group.accentHex)).frame(width: 9, height: 9)
                    Text(g.group.name).font(.scaled(14, weight: .semibold)).lineLimit(2)
                    Text("\(g.group.taskIds.count)").font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                Text(Fmt.fmtMs(g.ms)).font(.scaled(14, weight: .semibold)).tabular().frame(width: 72, alignment: .trailing)
                HStack(spacing: 0) {
                    CopyButton(text: { Analytics.groupCopyText(g) })
                    Button { onEdit(g.group) } label: { Image(systemName: "pencil").frame(width: 32, height: 32).contentShape(Rectangle()) }
                        .buttonStyle(.plain).foregroundStyle(Theme.mutedForeground).accessibilityLabel("Edit")
                    Button {
                        Task { do { try await model.deleteGroup(g.group.id) } catch let e as APIError { error = e.message } catch {} }
                    } label: { Image(systemName: "trash").frame(width: 32, height: 32).contentShape(Rectangle()) }
                        .buttonStyle(.plain).foregroundStyle(Theme.mutedForeground).accessibilityLabel("Delete")
                }
                .frame(width: 100, alignment: .trailing)
            }
            if g.group.taskIds.isEmpty {
                Text("—").foregroundStyle(Theme.mutedForeground)
            }
            ForEach(Array(g.members.enumerated()), id: \.element.id) { i, m in
                HStack(spacing: 8) {
                    (Text(m.task.name) + Text(m.task.hidden ? " (hidden)" : "").foregroundColor(Theme.mutedForeground))
                        .font(.scaled(13, weight: .medium)).lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            RoundedRectangle(cornerRadius: 2).fill(Theme.muted)
                            RoundedRectangle(cornerRadius: 2).fill(Color(hex: Accent.taskChartPalette[i % 6]))
                                .frame(width: geo.size.width * CGFloat(g.ms > 0 ? Double(m.ms) / Double(g.ms) : 0))
                        }
                    }
                    .frame(width: 70, height: 5)
                    Text(Fmt.fmtMs(m.ms)).font(.scaled(12)).tabular().foregroundStyle(Theme.mutedForeground).frame(width: 68, alignment: .trailing)
                }
                .padding(.leading, 17)
            }
            ForEach(g.orphanIds, id: \.self) { id in
                Text("Removed · \(id.prefix(8))…").font(.scaled(12)).foregroundStyle(Color(light: 0xB45309, dark: 0xFBBF24)).padding(.leading, 17)
            }
            if g.ms == 0 {
                Text("No tracked time").font(.scaled(11)).foregroundStyle(Theme.mutedForeground).padding(.leading, 17)
            }
        }
        .padding(.vertical, 10)
    }
}
