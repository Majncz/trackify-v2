import SwiftUI
import Charts
import TrackifyKit

// MARK: - AI billing tab (WEB_AUDIT §1.8, ai-tools-tab.tsx)

/// What the Add/Edit sheet is editing.
enum AIBillingEditorTarget: Identifiable {
    case new
    case edit(AIPeriod)

    var id: String {
        switch self {
        case .new: return "new"
        case .edit(let p): return p.id
        }
    }

    var period: AIPeriod? {
        if case .edit(let p) = self { return p }
        return nil
    }
}

enum AIBillingChartMode: Hashable { case monthly, cumulative }

/// Small formatting helpers shared by the AI billing views.
enum AIBillingFormat {
    /// JS-like number: 2 dp max, no trailing ".0".
    static func number(_ d: Double) -> String {
        let r = (d * 100).rounded() / 100
        if r == r.rounded(), abs(r) < 1e15 { return String(Int64(r)) }
        return String(r)
    }

    /// Compact axis money ("12k Kč", "$1.5k").
    static func compactMoney(_ v: Double, _ currency: String) -> String {
        let a = abs(v)
        let num: String
        if a >= 1_000_000 { num = trim(v / 1_000_000) + "M" }
        else if a >= 1000 { num = trim(v / 1000) + "k" }
        else { num = trim(v) }
        let unit = Money.unitLabel(currency)
        if unit.count == 1 { return unit + num }
        return num + " " + unit
    }

    private static func trim(_ d: Double) -> String {
        let s = String(format: "%.1f", d)
        return s.hasSuffix(".0") ? String(s.dropLast(2)) : s
    }

    /// "yyyy-MM" → first day of that month (local).
    static func monthDate(_ key: String) -> Date? {
        let bits = key.split(separator: "-")
        guard bits.count >= 2, let y = Int(bits[0]), let m = Int(bits[1]) else { return nil }
        var c = DateComponents()
        c.year = y; c.month = m; c.day = 1
        return DayCalc.current.calendar.date(from: c)
    }

    static func shortDate(_ d: Date) -> String { d.formatted(date: .numeric, time: .omitted) }
}

struct AIBillingView: View {
    @Environment(AppModel.self) private var model

    @State private var viewCurrency = Money.defaultCurrency
    @State private var analytics: AIAnalytics?
    @State private var periodList: [AIPeriod]?
    @State private var presets: [AIPreset] = []
    @State private var loading = true
    @State private var loadError: String?
    @State private var actionError: String?
    @State private var patching = false
    @State private var editor: AIBillingEditorTarget?
    @State private var deleteTarget: AIPeriod?
    @State private var chartMode: AIBillingChartMode = .monthly
    @State private var chartSelection: String?
    #if os(macOS)
    @State private var selectedId: String?
    #endif

    private var periods: [AIPeriod] { periodList ?? analytics?.periods ?? [] }

    private func isActive(_ p: AIPeriod) -> Bool {
        p.metrics?.isActive ?? (AIPeriodState.of(p) == .running)
    }

    var body: some View {
        platformBody
            .task(id: "\(viewCurrency)|\(model.dataTick)") { await load() }
            .task { await loadPresets() }
            .sheet(item: $editor) { target in
                AIBillingEditor(target: target, presets: presets) {
                    Task { await load(); await loadPresets() }
                }
            }
            .confirmationDialog("Delete this AI subscription?",
                                isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } }),
                                titleVisibility: .visible,
                                presenting: deleteTarget) { p in
                Button("Delete", role: .destructive) { delete(p) }
                Button("Cancel", role: .cancel) { deleteTarget = nil }
            } message: { _ in
                Text("This removes only this entry and the analytics tied to it. It can't be undone.")
            }
            .alert("Couldn't Update", isPresented: Binding(get: { actionError != nil }, set: { if !$0 { actionError = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(actionError ?? "")
            }
    }

    // MARK: Sections (shared by iPhone list and Mac form)

    @ViewBuilder private var sections: some View {
        Section {
            Picker("View totals in", selection: $viewCurrency) {
                ForEach(Money.options(including: viewCurrency), id: \.code) { Text($0.code).tag($0.code) }
            }
            if let a = analytics {
                let s = a.summary
                LabeledContent("Lifetime AI billing", value: Money.format(s.lifetimeSpendInView, a.viewCurrency))
                LabeledContent("Overlap this month", value: Money.format(s.currentMonthOverlapSpendInView, a.viewCurrency))
                LabeledContent("Active entries", value: "\(s.activeSubscriptions)")
                LabeledContent("Total entries", value: "\(s.periodCount)")
            } else if let loadError {
                Text(loadError).foregroundStyle(.red)
            } else {
                ProgressView().frame(maxWidth: .infinity)
            }
        } header: {
            Text("Summary")
        } footer: { Group {
            Text("Each entry is a budget line; totals simply add up. Timer time that overlaps several windows is credited to the earliest-starting one. Mark an entry depleted when its credits run out early.")
        }.billingFooter() }
        .monospacedDigit()

        if let missing = analytics?.fxMissingCurrencies, !missing.isEmpty {
            Section {
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Exchange rate unavailable").fontWeight(.medium)
                        Text("No rates for \(missing.joined(separator: ", ")). Totals in \(viewCurrency) may be incomplete; each entry still shows its own price.")
                            .font(.subheadline).foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.orange)
                }
            }
        }

        if let a = analytics, !a.cumulativeByMonth.isEmpty {
            let points = chartMode == .monthly ? a.spendByMonth : a.cumulativeByMonth
            Section {
                Picker("Chart", selection: $chartMode) {
                    Text("Monthly").tag(AIBillingChartMode.monthly)
                    Text("Cumulative").tag(AIBillingChartMode.cumulative)
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                VStack(alignment: .leading, spacing: 8) {
                    Group {
                        if let sel = chartSelection, let p = points.first(where: { $0.month == sel }) {
                            let label = AIBillingFormat.monthDate(sel).map { DayCalc.current.format($0, "MMM yyyy") } ?? sel
                            Text("\(label) · \(Money.format(p.totalInView, a.viewCurrency))")
                        } else {
                            Text(chartMode == .monthly ? "Spend per month in \(a.viewCurrency)" : "Running total in \(a.viewCurrency)")
                        }
                    }
                    .font(.footnote).foregroundStyle(.secondary).monospacedDigit()
                    AIBillingChart(points: points, mode: chartMode, currency: a.viewCurrency, selected: $chartSelection)
                        .frame(height: 200)
                }
                .padding(.vertical, 4)
            } header: {
                Text("Spending")
            }
            .onChange(of: chartMode) { _, _ in chartSelection = nil }
        }

        if let ranked = analytics?.rankings.mostTrackedHours, !ranked.isEmpty {
            Section("Most Tracked Hours Credited") {
                ForEach(Array(ranked.prefix(8).enumerated()), id: \.offset) { _, r in
                    LabeledContent(r.name, value: "\(AIBillingFormat.number(r.trackedHours))h").monospacedDigit()
                }
            }
        }

        let active = periods.filter { isActive($0) }
        let past = periods.filter { !isActive($0) }
        Section {
            if loading && analytics == nil && periodList == nil {
                ProgressView().frame(maxWidth: .infinity)
            } else if periods.isEmpty {
                Text("No AI subscriptions yet. Tap + to add one.").foregroundStyle(.secondary)
            } else if active.isEmpty {
                Text("No active entries.").foregroundStyle(.secondary)
            }
            ForEach(active) { p in entryRow(p) }
        } header: {
            Text("Active")
        }
        if !past.isEmpty {
            Section("Past") {
                ForEach(past) { p in entryRow(p) }
            }
        }
    }

    @ViewBuilder private func entryMenu(_ p: AIPeriod) -> some View {
        Button { editor = .edit(p) } label: { Label("Edit…", systemImage: "pencil") }
        if p.depletedAt != nil {
            Button { patch(p, ["depletedAt": nil]) } label: { Label("Clear Depletion", systemImage: "arrow.uturn.backward") }
        } else if isActive(p) {
            Button { patch(p, ["depletedAt": Date()]) } label: { Label("Mark Depleted", systemImage: "battery.0percent") }
        }
        Button(role: .destructive) { deleteTarget = p } label: { Label("Delete…", systemImage: "trash") }
    }

    private func detail(_ p: AIPeriod) -> some View {
        AIPeriodDetail(
            period: p,
            viewCurrency: viewCurrency,
            active: isActive(p),
            busy: patching,
            onEdit: { editor = .edit(p) },
            onPatch: { body in patch(p, body) },
            onDelete: { deleteTarget = p })
    }

    // MARK: iPhone / iPad

    #if os(iOS)
    private var platformBody: some View {
        List { sections }
            .listStyle(.insetGrouped)
            .navigationTitle("AI Subscriptions")
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: AIPeriodRoute.self) { r in
                AIPeriodHost(period: periods.first { $0.id == r.id }) { detail($0) }
            }
            .refreshable { await load() }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { editor = .new } label: { Label("Add AI Subscription", systemImage: "plus") }
                        .accessibilityIdentifier("addAIBilling")
                }
            }
    }

    private func entryRow(_ p: AIPeriod) -> some View {
        NavigationLink(value: AIPeriodRoute(id: p.id)) { AIPeriodCell(period: p) }
            .accessibilityIdentifier("aiEntry")
            .swipeActions {
                Button(role: .destructive) { deleteTarget = p } label: { Label("Delete", systemImage: "trash") }
                if p.depletedAt == nil && isActive(p) {
                    Button { patch(p, ["depletedAt": Date()]) } label: { Label("Depleted", systemImage: "battery.0percent") }
                        .tint(.orange)
                }
            }
            .contextMenu { entryMenu(p) }
    }
    #endif

    // MARK: Mac

    #if os(macOS)
    private var selected: AIPeriod? { periods.first { $0.id == selectedId } }

    private var platformBody: some View {
        Form { sections }
            .formStyle(.grouped)
            .inspector(isPresented: Binding(get: { selected != nil }, set: { if !$0 { selectedId = nil } })) {
                Group {
                    if let p = selected { detail(p) }
                }
                .inspectorColumnWidth(min: 300, ideal: 360, max: 480)
            }
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { editor = .new } label: { Label("Add AI Subscription", systemImage: "plus") }
                        .help("Add an AI subscription")
                        .accessibilityIdentifier("addAIBilling")
                }
            }
    }

    private func entryRow(_ p: AIPeriod) -> some View {
        Button { selectedId = selectedId == p.id ? nil : p.id } label: {
            HStack {
                AIPeriodCell(period: p)
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .listRowBackground(selectedId == p.id ? Color.accentColor.opacity(0.15) : nil)
        .contextMenu { entryMenu(p) }
    }
    #endif

    // MARK: Data

    private func load() async {
        let currency = viewCurrency
        do {
            let a = try await model.api.aiAnalytics(viewCurrency: currency)
            if Task.isCancelled { return }
            analytics = a
            loadError = nil
        } catch {
            if Task.isCancelled { return }
            loadError = (error as? APIError)?.message ?? "Failed to load AI analytics"
        }
        if let list = try? await model.api.aiPeriods(), !Task.isCancelled {
            periodList = list
        }
        loading = false
    }

    private func loadPresets() async {
        if let p = try? await model.api.aiPresets() { presets = p }
    }

    private func patch(_ p: AIPeriod, _ body: [String: Any?]) {
        patching = true
        actionError = nil
        Task {
            do {
                _ = try await model.api.updateAIPeriod(id: p.id, body)
            } catch {
                actionError = (error as? APIError)?.message ?? "Could not update the entry."
            }
            patching = false
            await load()
        }
    }

    private func delete(_ p: AIPeriod) {
        deleteTarget = nil
        actionError = nil
        #if os(macOS)
        if selectedId == p.id { selectedId = nil }
        #endif
        Task {
            do {
                try await model.api.deleteAIPeriod(id: p.id)
            } catch {
                actionError = (error as? APIError)?.message ?? "Could not delete the entry."
            }
            await load()
        }
    }
}

struct AIPeriodRoute: Hashable { let id: String }

#if os(iOS)
/// Pops the pushed detail when its entry was deleted.
private struct AIPeriodHost<Content: View>: View {
    let period: AIPeriod?
    @ViewBuilder var content: (AIPeriod) -> Content
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        Group {
            if let period { content(period) } else { Color.clear }
        }
        .onChange(of: period == nil) { _, gone in if gone { dismiss() } }
    }
}
#endif

struct AIBillingChart: View {
    var points: [AIAnalytics.MonthPoint]
    var mode: AIBillingChartMode
    var currency: String
    @Binding var selected: String?

    private var currentKey: String { DayCalc.current.format(Date(), "yyyy-MM") }

    private var multiYear: Bool { Set(points.map { String($0.month.prefix(4)) }).count > 1 }

    private func monthLabel(_ key: String) -> String {
        guard let d = AIBillingFormat.monthDate(key) else { return key }
        return DayCalc.current.format(d, multiYear ? "MMM yy" : "MMM")
    }

    var body: some View {
        if mode == .monthly { styled(barChart) } else { styled(lineChart) }
    }

    private func styled<C: View>(_ chart: C) -> some View {
        chart
            .chartXSelection(value: $selected)
            .chartYAxis {
                AxisMarks(position: .leading) { v in
                    AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [3, 3])).foregroundStyle(Theme.border)
                    AxisValueLabel {
                        if let d = v.as(Double.self) { Text(AIBillingFormat.compactMoney(d, currency)).font(.scaled(11)) }
                    }
                }
            }
            .chartXAxis {
                AxisMarks(values: .automatic(desiredCount: 6)) { v in
                    AxisValueLabel {
                        if let s = v.as(String.self) { Text(monthLabel(s)).font(.scaled(11)) }
                    }
                }
            }
    }

    private var barChart: some View {
        let cur = currentKey
        return Chart {
            ForEach(points, id: \.month) { p in
                BarMark(x: .value("Month", p.month), y: .value("Spend", p.totalInView))
                    .foregroundStyle(p.month == cur ? Theme.primary : Theme.primary.opacity(0.45))
                    .cornerRadius(3)
            }
        }
    }

    private var lineChart: some View {
        Chart {
            ForEach(points, id: \.month) { p in
                LineMark(x: .value("Month", p.month), y: .value("Total", p.totalInView))
                    .foregroundStyle(Theme.primary)
                    .lineStyle(StrokeStyle(lineWidth: 2))
                    .interpolationMethod(.monotone)
            }
        }
    }
}

