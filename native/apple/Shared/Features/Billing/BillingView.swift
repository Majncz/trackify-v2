import SwiftUI
import TrackifyKit

// MARK: - Billing (WEB_AUDIT §1.7–1.8)
//
// iPhone / iPad: a grouped list — unpaid summary per currency, then Sessions · Payments · Rates · AI Subscriptions,
// each pushed. Mac: the same four destinations in a segmented toolbar control.

struct BillingView: View {
    @Environment(AppModel.self) private var model
    @State private var store = BillingStore()
    @State private var showGuide = false
    #if os(macOS)
    @State private var route: BillingRoute = BillingRoute.launchRoute ?? .sessions
    #endif

    var body: some View {
        content
            .task(id: model.dataTick) { await store.load(tick: model.dataTick, api: model.api) }
            .sheet(isPresented: $showGuide) {
                BillingGuideSheet(onOpenRates: { showGuide = false; openRates() })
            }
    }

    private func openRates() {
        #if os(macOS)
        route = .rates
        #else
        pendingRates = true
        #endif
    }

    // MARK: iPhone / iPad

    #if os(iOS)
    @State private var pendingRates = false

    private var content: some View {
        List {
            summarySection
            if store.billingTasks != nil && !store.hasEnrolled {
                Section {
                    NavigationLink(value: BillingRoute.rates) {
                        Label("Choose Billable Tasks", systemImage: "plus.circle")
                    }
                } header: {
                    Text("Set up billing first")
                } footer: { Group {
                    Text("Pick which tasks get an hourly rate. Their tracked time then shows up under Sessions, ready to mark as paid.")
                }.billingFooter() }
            }
            Section {
                ForEach(BillingRoute.allCases) { r in
                    NavigationLink(value: r) { Label(r.label, systemImage: r.icon) }
                        .badge(badge(r))
                        .accessibilityIdentifier("billing-\(r.rawValue)")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Billing")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: BillingRoute.self) { destination($0) }
        .navigationDestination(isPresented: $pendingRates) { destination(.rates) }
        .refreshable {
            await store.loadAll(model.api)
            await model.refreshAll()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button { showGuide = true } label: { Label("How Billing Works", systemImage: "info.circle") }
            }
        }
    }

    private func badge(_ r: BillingRoute) -> Int {
        switch r {
        case .payments: store.payments?.count ?? 0
        case .rates: store.billingTasks?.count ?? 0
        default: 0
        }
    }

    @ViewBuilder private var summarySection: some View {
        Section {
            if let summary = store.summary {
                let codes = summary.byCurrency.keys.sorted()
                if codes.isEmpty {
                    Text("Enroll tasks in billing to see an earnings summary.")
                        .foregroundStyle(.secondary)
                }
                ForEach(codes, id: \.self) { code in
                    if let t = summary.byCurrency[code] {
                        BillingSummaryRow(code: code, totals: t, showCode: codes.count > 1)
                    }
                }
            } else if store.summaryFailed {
                Text("Could not load the billing summary.").foregroundStyle(.red)
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    Text("00 000 Kč").font(.largeTitle.weight(.semibold))
                    Text("This week 0 000 Kč · This month 0 000 Kč").font(.subheadline)
                }
                .padding(.vertical, 4)
                .redacted(reason: .placeholder)
            }
        } header: {
            Text("Unpaid")
        }
    }

    @ViewBuilder private func destination(_ r: BillingRoute) -> some View {
        switch r {
        case .sessions: BillingSessionsView(store: store)
        case .payments: BillingPaymentsView(store: store)
        case .rates: BillingRatesView(store: store)
        case .ai: AIBillingView()
        }
    }
    #endif

    // MARK: Mac

    #if os(macOS)
    @ViewBuilder private var content: some View {
        Group {
            switch route {
            case .sessions: BillingSessionsView(store: store, onGoRates: { route = .rates })
            case .payments: BillingPaymentsView(store: store)
            case .rates: BillingRatesView(store: store)
            case .ai: AIBillingView()
            }
        }
        .navigationTitle("Billing")
        .toolbar {
            ToolbarItem(placement: .principal) {
                Picker("Section", selection: $route) {
                    ForEach(BillingRoute.allCases) { Text($0.label).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
                .accessibilityIdentifier("billingTabs")
            }
            ToolbarItem(placement: .primaryAction) {
                Button { showGuide = true } label: { Label("How Billing Works", systemImage: "info.circle") }
                    .help("How billing works")
            }
        }
    }
    #endif
}

// MARK: - Summary row (summary-bar.tsx)

/// Big unpaid total with this week / this month / all-time paid as secondary text.
struct BillingSummaryRow: View {
    let code: String
    let totals: BillingCurrencySummary
    var showCode = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if showCode {
                Text(code).font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
            }
            Text(Money.format(totals.unpaidTotal, code))
                .font(.largeTitle.weight(.semibold))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .accessibilityIdentifier("billingUnpaid-\(code)")
            Text("This week \(Money.format(totals.thisWeekTotal, code)) · This month \(Money.format(totals.thisMonthTotal, code)) · Paid \(Money.format(totals.allTimePaidTotal, code))")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 4)
        .accessibilityElement(children: .combine)
    }
}

/// Mac: the per-currency totals as one compact line above the sessions table.
struct BillingSummaryStrip: View {
    let summary: BillingSummary?

    var body: some View {
        if let summary, !summary.byCurrency.isEmpty {
            let codes = summary.byCurrency.keys.sorted()
            VStack(alignment: .leading, spacing: 2) {
                ForEach(codes, id: \.self) { code in
                    if let t = summary.byCurrency[code] {
                        HStack(alignment: .firstTextBaseline, spacing: 16) {
                            HStack(alignment: .firstTextBaseline, spacing: 6) {
                                Text("Unpaid").foregroundStyle(.secondary)
                                Text(Money.format(t.unpaidTotal, code)).font(.title3.weight(.semibold))
                            }
                            metric("This week", Money.format(t.thisWeekTotal, code))
                            metric("This month", Money.format(t.thisMonthTotal, code))
                            metric("All-time paid", Money.format(t.allTimePaidTotal, code))
                        }
                        .monospacedDigit()
                    }
                }
            }
            .accessibilityElement(children: .combine)
        }
    }

    private func metric(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(label).foregroundStyle(.secondary)
            Text(value)
        }
    }
}

extension View {
    /// Form section footers: the Mac's grouped form centers wrapped footers, so pin them leading like System Settings.
    func billingFooter() -> some View {
        #if os(macOS)
        self.font(.callout).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
        #else
        self
        #endif
    }
}
