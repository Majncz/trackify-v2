import SwiftUI
import TrackifyKit

// MARK: - Billing page (WEB_AUDIT §1.7)

struct BillingView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var store = BillingStore()
    @State private var tab: BillingTab = BillingView.initialTab()
    @State private var slideForward = true
    @State private var width: CGFloat = 390
    @State private var showMarkPaid = false
    @State private var markPaidRows: [BillingSessionRow] = []

    /// Test hook / deep link: `TrackifyBillingTab` = sessions | history | rates | ai.
    static func initialTab() -> BillingTab {
        if let raw = UserDefaults.standard.string(forKey: "TrackifyBillingTab"), let t = BillingTab(rawValue: raw) { return t }
        return .sessions
    }

    private var wide: Bool { width >= 700 }

    private var loadKey: BillingLoadKey { BillingLoadKey(tick: model.dataTick, sessions: store.sessionsKey) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                PageHeader("Billing", subtitle: "Rates on tasks, billable sessions, and marking them paid—same chart style as Stats where it helps.")
                BillingSummaryBar(summary: store.summary, failed: store.summaryFailed, wide: wide)
                if store.billingTasks != nil && !store.hasEnrolled {
                    BillingSetupCard { go(.rates) }
                }
                BillingGuide { go(.rates) }
                tabsSection
            }
            .padding(16)
            .frame(maxWidth: 896)
            .frame(maxWidth: .infinity)
            .readWidth($width)
        }
        .background(Theme.background)
        .safeAreaInset(edge: .bottom) {
            if showsSelectionBar {
                BillingSelectionBar(store: store, wide: wide) {
                    markPaidRows = store.selectedSessions
                    if !markPaidRows.isEmpty { showMarkPaid = true }
                }
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .refreshable {
            await store.loadAll(model.api)
            await model.refreshAll()
        }
        .task(id: loadKey) {
            await store.load(tick: model.dataTick, api: model.api)
        }
        .sheet(isPresented: $showMarkPaid) {
            MarkPaidSheet(sessions: markPaidRows) {
                Task { await store.afterPaymentChange(model.api) }
            }
            .trackifySheet()
        }
    }

    private var showsSelectionBar: Bool {
        guard tab == .sessions && store.hasEnrolled && !store.sessionsLoading && store.sessionsError == nil && !store.sessions.isEmpty else { return false }
        // On phones the sticky bar would sit over the page permanently; show it once something is picked.
        return wide || !store.selectedSessions.isEmpty
    }

    // MARK: Tabs

    private var tabsSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            Segmented(items: BillingTab.allCases.map { ($0, $0.label) },
                      selection: Binding(get: { tab }, set: { go($0) }))
                .accessibilityIdentifier("billingTabs")
            ZStack(alignment: .top) {
                tabContent(tab)
                    .id(tab)
                    .transition(slideTransition)
            }
            .frame(maxWidth: .infinity, alignment: .top)
            .clipped()
        }
    }

    @ViewBuilder
    private func tabContent(_ t: BillingTab) -> some View {
        switch t {
        case .sessions:
            BillingSessionsTab(store: store, wide: wide, onGoRates: { go(.rates) })
        case .history:
            BillingHistoryTab(store: store)
        case .rates:
            BillingRatesTab(store: store)
        case .ai:
            AIBillingTab()
        }
    }

    private var slideTransition: AnyTransition {
        .asymmetric(insertion: .move(edge: slideForward ? .trailing : .leading),
                    removal: .move(edge: slideForward ? .leading : .trailing))
    }

    /// Slide the panels like the web carousel (500 ms, cubic-bezier(0.22,1,0.36,1)).
    private func go(_ next: BillingTab) {
        guard next != tab else { return }
        slideForward = next.index > tab.index
        if reduceMotion {
            tab = next
            return
        }
        // Apply the direction first so the outgoing panel picks up the right removal edge.
        DispatchQueue.main.async {
            withAnimation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.5)) { tab = next }
        }
    }
}

// MARK: - Summary bar (summary-bar.tsx)

struct BillingSummaryBar: View {
    let summary: BillingSummary?
    let failed: Bool
    let wide: Bool

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .top), count: wide ? 4 : 2)
    }

    var body: some View {
        if let summary {
            let codes = summary.byCurrency.keys.sorted()
            if codes.isEmpty {
                Text("Enroll tasks in billing to see earnings summary.")
                    .font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
            } else {
                VStack(spacing: 12) {
                    ForEach(codes, id: \.self) { code in
                        if let t = summary.byCurrency[code] {
                            currencyRow(code, t)
                        }
                    }
                }
            }
        } else if failed {
            Text("Could not load billing summary.")
                .font(.scaled(14)).foregroundStyle(Theme.destructive)
        } else {
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(0..<4, id: \.self) { _ in Skeleton(height: 72) }
            }
        }
    }

    private func currencyRow(_ code: String, _ t: BillingCurrencySummary) -> some View {
        LazyVGrid(columns: columns, spacing: 8) {
            BillingStatCard(title: "Unpaid (\(code))", value: Money.format(t.unpaidTotal, code), highlight: true, wide: wide)
            BillingStatCard(title: "This week", value: Money.format(t.thisWeekTotal, code), wide: wide)
            BillingStatCard(title: "This month", value: Money.format(t.thisMonthTotal, code), wide: wide)
            BillingStatCard(title: "All time paid", value: Money.format(t.allTimePaidTotal, code), wide: wide)
        }
    }
}

private struct BillingStatCard: View {
    let title: String
    let value: String
    var highlight = false
    var wide = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(.scaled(12, weight: .medium))
                .foregroundStyle(Theme.mutedForeground)
                .lineLimit(1)
            Text(value)
                .font(.scaled(wide ? 20 : 18, weight: .semibold))
                .foregroundStyle(Theme.foreground)
                .tabular()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(highlight ? Theme.primary.opacity(0.05) : Color.clear, in: shape)
        .background(Theme.card, in: shape)
        .overlay(shape.strokeBorder(highlight ? Theme.primary.opacity(0.4) : Theme.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.06), radius: 2, x: 0, y: 1)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - "Set up billing first"

struct BillingSetupCard: View {
    var onOpenRates: () -> Void

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Set up billing first").font(.cardTitle).foregroundStyle(Theme.foreground)
                Text("Pick which tasks get a rate. After that, your tracked time can be paid out from the Sessions tab.")
                    .font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button("Billable tasks", action: onOpenRates).buttonStyle(.t(.primary))
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.primary.opacity(0.05), in: shape)
        .background(Theme.card, in: shape)
        .overlay(shape.strokeBorder(Theme.primary.opacity(0.25), lineWidth: 1))
    }
}
