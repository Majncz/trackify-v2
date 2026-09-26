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

struct AIBillingTab: View {
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

    private var periods: [AIPeriod] { periodList ?? analytics?.periods ?? [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            AIBillingHeader(viewCurrency: $viewCurrency) { editor = .new }

            if let missing = analytics?.fxMissingCurrencies, !missing.isEmpty {
                AIBillingFxAlert(currencies: missing, viewCurrency: viewCurrency)
            }

            kpiSection

            if let a = analytics, !a.cumulativeByMonth.isEmpty {
                AIBillingChartCard(analytics: a, mode: $chartMode)
            }

            if let ranked = analytics?.rankings.mostTrackedHours, !ranked.isEmpty {
                AIBillingRankingCard(rows: Array(ranked.prefix(8)))
            }

            AIBillingEntriesSection(
                periods: periods,
                loading: loading && analytics == nil && periodList == nil,
                viewCurrency: viewCurrency,
                busy: patching,
                actionError: actionError,
                onPatch: { p, body in patch(p, body) },
                onEdit: { p in editor = .edit(p) },
                onDelete: { p in deleteTarget = p }
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .task(id: "\(viewCurrency)|\(model.dataTick)") { await load() }
        .task { await loadPresets() }
        .sheet(item: $editor) { target in
            AIBillingEditor(target: target, presets: presets) {
                Task { await load(); await loadPresets() }
            }
            .trackifySheet()
        }
        .confirmationDialog("Delete this AI billing entry?",
                            isPresented: Binding(get: { deleteTarget != nil }, set: { if !$0 { deleteTarget = nil } }),
                            titleVisibility: .visible,
                            presenting: deleteTarget) { p in
            Button("Delete", role: .destructive) { delete(p) }
            Button("Cancel", role: .cancel) { deleteTarget = nil }
        } message: { _ in
            Text("This removes only the billing line and analytics tied to it. Cannot be undone.")
        }
    }

    @ViewBuilder private var kpiSection: some View {
        if let a = analytics {
            AIBillingKPIGrid(analytics: a)
        } else if loading {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
                ForEach(0..<4, id: \.self) { _ in Skeleton(height: 72) }
            }
        } else if let loadError {
            Text(loadError).font(.scaled(14)).foregroundStyle(Theme.destructive)
        }
    }

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
                actionError = (error as? APIError)?.message ?? "Could not update entry"
            }
            patching = false
            await load()
        }
    }

    private func delete(_ p: AIPeriod) {
        deleteTarget = nil
        actionError = nil
        Task {
            do {
                try await model.api.deleteAIPeriod(id: p.id)
            } catch {
                actionError = (error as? APIError)?.message ?? "Could not delete"
            }
            await load()
        }
    }
}

// MARK: - Header

struct AIBillingHeader: View {
    @Binding var viewCurrency: String
    var onAdd: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("AI billing").font(.cardTitle).foregroundStyle(Theme.foreground)
                explainer
                    .font(.scaled(14))
                    .foregroundStyle(Theme.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(alignment: .bottom, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    FieldLabel(text: "View totals in")
                    CurrencyPicker(code: $viewCurrency)
                }
                Spacer(minLength: 0)
                Button(action: onAdd) {
                    Label("Add AI billing", systemImage: "plus")
                }
                .buttonStyle(.t(.primary))
            }
        }
    }

    private var explainer: Text {
        Text("Each row is a budget line — lifetime totals add up simply (100 + 150 = 250). Timer overlap is split automatically when billing windows overlap: the earliest-start row wins each slice. Active days counts whole calendar days from the row start through today, the end date, or depletion — whichever comes first. Use ")
            + Text("Mark depleted").fontWeight(.medium).foregroundColor(Theme.foreground)
            + Text(" to cap the window when credits run out before the calendar end.")
    }
}

struct AIBillingFxAlert: View {
    var currencies: [String]
    var viewCurrency: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Exchange rate unavailable").font(.scaled(14, weight: .semibold)).foregroundStyle(Theme.foreground)
            Text("Could not load rates for: \(currencies.joined(separator: ", ")). Lifetime and chart totals in \(viewCurrency) may be incomplete; native prices on each card are still shown.")
                .font(.scaled(13))
                .foregroundStyle(Theme.foreground.opacity(0.85))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.amber.opacity(0.1), in: RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous).strokeBorder(Theme.amber.opacity(0.5)))
    }
}

// MARK: - KPIs

struct AIBillingKPIGrid: View {
    var analytics: AIAnalytics

    var body: some View {
        let s = analytics.summary
        let cur = analytics.viewCurrency
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 8)], spacing: 8) {
            AIBillingKPICard(title: "Lifetime AI billing (\(cur))", value: Money.format(s.lifetimeSpendInView, cur), highlight: true)
            AIBillingKPICard(title: "Overlap this month (\(cur))", value: Money.format(s.currentMonthOverlapSpendInView, cur))
            AIBillingKPICard(title: "Active entries", value: "\(s.activeSubscriptions)")
            AIBillingKPICard(title: "Total entries", value: "\(s.periodCount)")
        }
    }
}

struct AIBillingKPICard: View {
    var title: String
    var value: String
    var highlight = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title).font(.scaled(12, weight: .medium)).foregroundStyle(Theme.mutedForeground).lineLimit(2)
            Text(value).font(.scaled(18, weight: .semibold)).tabular().foregroundStyle(Theme.foreground)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 72, alignment: .topLeading)
        .background(highlight ? Theme.primary.opacity(0.05) : Theme.card,
                    in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
            .strokeBorder(highlight ? Theme.primary.opacity(0.4) : Theme.border, lineWidth: 1))
    }
}

// MARK: - Chart

struct AIBillingChartCard: View {
    var analytics: AIAnalytics
    @Binding var mode: AIBillingChartMode
    @State private var selected: String?

    private var points: [AIAnalytics.MonthPoint] {
        mode == .monthly ? analytics.spendByMonth : analytics.cumulativeByMonth
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(mode == .monthly ? "Spend per month" : "Cumulative spend").font(.cardTitle)
                    Text(mode == .monthly ? "Monthly AI billing total in \(analytics.viewCurrency)"
                                          : "Running total in \(analytics.viewCurrency) over time")
                        .font(.scaled(13)).foregroundStyle(Theme.mutedForeground)
                }
                Spacer(minLength: 0)
                AIBillingModeToggle(mode: $mode)
            }
            selectionLine
            AIBillingChart(points: points, mode: mode, currency: analytics.viewCurrency, selected: $selected)
                .frame(height: 200)
                .padding(8)
                .background(Theme.muted.opacity(0.2), in: RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous).strokeBorder(Theme.border.opacity(0.6)))
        }
        .card()
        .onChange(of: mode) { _, _ in selected = nil }
    }

    @ViewBuilder private var selectionLine: some View {
        if let sel = selected, let p = points.first(where: { $0.month == sel }) {
            let label = AIBillingFormat.monthDate(sel).map { DayCalc.current.format($0, "MMM yyyy") } ?? sel
            Text("\(label) · \(mode == .monthly ? "Spend" : "Total"): \(Money.format(p.totalInView, analytics.viewCurrency))")
                .font(.scaled(12, weight: .medium)).foregroundStyle(Theme.mutedForeground).tabular()
        }
    }
}

struct AIBillingModeToggle: View {
    @Binding var mode: AIBillingChartMode

    var body: some View {
        HStack(spacing: 0) {
            item(.monthly, "Monthly")
            Rectangle().fill(Theme.border).frame(width: 1)
            item(.cumulative, "Cumulative")
        }
        .fixedSize()
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Theme.border))
    }

    private func item(_ m: AIBillingChartMode, _ label: String) -> some View {
        let on = mode == m
        return Button { mode = m } label: {
            Text(label)
                .font(.scaled(12, weight: .medium))
                .foregroundStyle(on ? Theme.onPrimary : Theme.mutedForeground)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .frame(maxHeight: .infinity)
                .background(on ? Theme.primary : Color.clear)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

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

// MARK: - Rankings

struct AIBillingRankingCard: View {
    var rows: [AIAnalytics.Ranked]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Most tracked hours credited").font(.cardTitle)
            VStack(spacing: 0) {
                ForEach(Array(rows.enumerated()), id: \.offset) { i, r in
                    HStack(spacing: 8) {
                        Text(r.name).lineLimit(1).truncationMode(.tail)
                        Spacer(minLength: 8)
                        Text("\(AIBillingFormat.number(r.trackedHours))h").tabular()
                    }
                    .font(.scaled(14))
                    .padding(.vertical, 8)
                    if i < rows.count - 1 { Rectangle().fill(Theme.border.opacity(0.5)).frame(height: 1) }
                }
            }
        }
        .card()
        .frame(maxWidth: 576, alignment: .leading)
    }
}

// MARK: - Entries

struct AIBillingEntriesSection: View {
    var periods: [AIPeriod]
    var loading: Bool
    var viewCurrency: String
    var busy: Bool
    var actionError: String?
    var onPatch: (AIPeriod, [String: Any?]) -> Void
    var onEdit: (AIPeriod) -> Void
    var onDelete: (AIPeriod) -> Void

    @State private var showPast = false

    private func isActive(_ p: AIPeriod) -> Bool {
        p.metrics?.isActive ?? (AIPeriodState.of(p) == .running)
    }

    var body: some View {
        let active = periods.filter { isActive($0) }
        let past = periods.filter { !isActive($0) }
        VStack(alignment: .leading, spacing: 12) {
            Text("Entries").font(.scaled(14, weight: .semibold))
            InlineError(text: actionError)
            if loading {
                Skeleton(height: 160)
            } else if periods.isEmpty {
                Text("No AI billing entries yet. Use Add AI billing to start tracking.")
                    .font(.scaled(14))
                    .foregroundStyle(Theme.mutedForeground)
                    .multilineTextAlignment(.center)
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 32)
                    .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
                        .strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
            } else {
                if active.isEmpty {
                    Text("No active entries.").font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
                } else {
                    cards(active)
                }
                if !past.isEmpty {
                    DisclosureGroup(isExpanded: $showPast) {
                        cards(past).padding(.top, 8)
                    } label: {
                        Text("Past entries (\(past.count))")
                            .font(.scaled(12, weight: .medium))
                            .foregroundStyle(Theme.mutedForeground)
                    }
                    .tint(Theme.mutedForeground)
                }
            }
        }
    }

    private func cards(_ list: [AIPeriod]) -> some View {
        VStack(spacing: 12) {
            ForEach(list) { p in
                AIBillingPeriodCard(
                    period: p,
                    viewCurrency: viewCurrency,
                    busy: busy,
                    onPatch: { body in onPatch(p, body) },
                    onEdit: { onEdit(p) },
                    onDelete: { onDelete(p) }
                )
            }
        }
    }
}
