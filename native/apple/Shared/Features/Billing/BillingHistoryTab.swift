import SwiftUI
import TrackifyKit

// MARK: - Payments (payment-history.tsx)

struct BillingPaymentsView: View {
    @Environment(AppModel.self) private var model
    var store: BillingStore

    @State private var pendingReopen: PaymentRecord?
    #if os(macOS)
    @State private var selectedId: String?
    #endif

    private var payments: [PaymentRecord] { store.payments ?? [] }

    var body: some View {
        platformBody
            .overlay { stateView }
            .confirmationDialog("Reopen payment?",
                                isPresented: Binding(get: { pendingReopen != nil }, set: { if !$0 { pendingReopen = nil } }),
                                titleVisibility: .visible, presenting: pendingReopen) { p in
                Button("Reopen Payment", role: .destructive) {
                    Task { await store.reopen(p.id, api: model.api) }
                }
                Button("Cancel", role: .cancel) {}
            } message: { _ in
                Text("Its sessions will become unpaid again.")
            }
            .alert("Couldn't Reopen", isPresented: Binding(get: { store.reopenError != nil }, set: { if !$0 { store.reopenError = nil } })) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(store.reopenError ?? "")
            }
    }

    @ViewBuilder private var stateView: some View {
        if let list = store.payments, list.isEmpty {
            ContentUnavailableView("No Payments", systemImage: "banknote",
                                   description: Text("Payments appear here after you mark sessions as paid."))
        } else if store.payments == nil {
            if store.paymentsFailed {
                ContentUnavailableView("Couldn't Load Payments", systemImage: "exclamationmark.triangle")
            } else {
                ProgressView()
            }
        }
    }

    /// Payments grouped by the month they were paid in (newest first, server order).
    private var byMonth: [(key: String, title: String, items: [PaymentRecord])] {
        var order: [String] = []
        var map: [String: [PaymentRecord]] = [:]
        let calc = DayCalc.current
        for p in payments {
            let k = calc.format(p.paidAt, "yyyy-MM")
            if map[k] == nil { order.append(k) }
            map[k, default: []].append(p)
        }
        return order.map { k in
            let first = map[k]![0].paidAt
            return (k, calc.format(first, "MMMM yyyy"), map[k]!)
        }
    }

    // MARK: iPhone / iPad

    #if os(iOS)
    private var platformBody: some View {
        List {
            ForEach(byMonth, id: \.key) { month in
                Section(month.title) {
                    ForEach(month.items) { p in
                        NavigationLink(value: p) { BillingPaymentCell(payment: p) }
                            .swipeActions {
                                Button("Reopen", role: .destructive) { pendingReopen = p }
                            }
                            .contextMenu {
                                Button(role: .destructive) { pendingReopen = p } label: {
                                    Label("Reopen Payment…", systemImage: "arrow.uturn.backward")
                                }
                            }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Payments")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: PaymentRecord.self) { p in
            PaymentDetailHost(store: store, payment: p) { pendingReopen = p }
        }
        .refreshable { await store.loadPayments(model.api) }
    }
    #endif

    // MARK: Mac

    #if os(macOS)
    private var selected: PaymentRecord? { payments.first { $0.id == selectedId } }

    private var platformBody: some View {
        Table(payments, selection: $selectedId) {
            TableColumn("Paid") { p in
                Text(DayCalc.current.format(p.paidAt, "MMM d, yyyy · HH:mm")).monospacedDigit()
            }
            .width(min: 130, ideal: 150)
            TableColumn("Amount") { p in
                Text(Money.format(p.totalAmount, p.currency)).monospacedDigit()
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 90, ideal: 110)
            TableColumn("Sessions") { p in
                Text("\(p.sessions?.count ?? p.eventCount ?? 0)").monospacedDigit()
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 60, ideal: 70)
            TableColumn("Duration") { p in
                Text(Fmt.durationMinutes(Double(p.totalMinutes))).monospacedDigit()
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 60, ideal: 80)
            TableColumn("Note") { p in
                Text(p.note ?? "").foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .contextMenu(forSelectionType: String.self) { ids in
            if let id = ids.first, let p = payments.first(where: { $0.id == id }) {
                Button("Reopen Payment…") { pendingReopen = p }
            }
        }
        .inspector(isPresented: Binding(get: { selected != nil }, set: { if !$0 { selectedId = nil } })) {
            Group {
                if let p = selected {
                    BillingPaymentDetail(payment: p, busy: store.reopening != nil) { pendingReopen = p }
                }
            }
            .inspectorColumnWidth(min: 300, ideal: 360, max: 480)
        }
    }
    #endif
}

#if os(iOS)
/// Pops the pushed detail once a reopen removed the payment.
private struct PaymentDetailHost: View {
    var store: BillingStore
    let payment: PaymentRecord
    var onReopen: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        BillingPaymentDetail(payment: payment, busy: store.reopening != nil, onReopen: onReopen)
            .onChange(of: store.payments?.contains { $0.id == payment.id }) { _, has in
                if has == false { dismiss() }
            }
    }
}
#endif

// MARK: - Row

struct BillingPaymentCell: View {
    let payment: PaymentRecord

    var body: some View {
        let n = payment.sessions?.count ?? payment.eventCount ?? 0
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(Money.format(payment.totalAmount, payment.currency)).font(.headline)
                Spacer(minLength: 8)
                Text(DayCalc.current.format(payment.paidAt, "MMM d")).foregroundStyle(.secondary)
            }
            Text("\(n) session\(n == 1 ? "" : "s") · \(Fmt.durationMinutes(Double(payment.totalMinutes)))")
                .font(.subheadline).foregroundStyle(.secondary)
            if let note = payment.note, !note.isEmpty {
                Text(note).font(.subheadline).foregroundStyle(.secondary).lineLimit(1)
            }
        }
        .monospacedDigit()
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Detail (list push on iPhone, inspector on the Mac)

struct BillingPaymentDetail: View {
    let payment: PaymentRecord
    var busy = false
    var onReopen: () -> Void

    private var lines: [BillingSessionRow] { payment.sessions ?? [] }

    var body: some View {
        Form {
            Section {
                LabeledContent("Amount") {
                    Text(Money.format(payment.totalAmount, payment.currency)).fontWeight(.semibold)
                }
                LabeledContent("Paid", value: DayCalc.current.format(payment.paidAt, "MMM d, yyyy · HH:mm"))
                LabeledContent("Sessions", value: "\(lines.count)")
                LabeledContent("Duration", value: Fmt.durationMinutes(Double(payment.totalMinutes)))
                if let note = payment.note, !note.isEmpty {
                    LabeledContent("Note") {
                        Text(note).textSelection(.enabled).multilineTextAlignment(.trailing)
                    }
                }
            }
            .monospacedDigit()

            Section("Sessions in This Payment") {
                if lines.isEmpty {
                    Text("No line items could be computed for this payment (for example, billing settings changed). The totals above still reflect what was paid.")
                        .font(.subheadline).foregroundStyle(.secondary)
                } else {
                    ForEach(lines) { s in
                        HStack(alignment: .firstTextBaseline) {
                            VStack(alignment: .leading, spacing: 2) {
                                HStack(alignment: .firstTextBaseline, spacing: 6) {
                                    Circle().fill(Color(hex: s.accentHex)).frame(width: 8, height: 8)
                                    Text(s.taskName).lineLimit(2)
                                }
                                Text(BillingMath.sessionRange(from: s.from, to: s.to))
                                    .font(.subheadline).foregroundStyle(.secondary)
                                Text([Fmt.durationMinutes(Double(s.durationMinutes)), s.taskGroup?.name].compactMap { $0 }.joined(separator: " · "))
                                    .font(.subheadline).foregroundStyle(.secondary)
                            }
                            Spacer(minLength: 8)
                            Text(Money.format(s.earnings, s.currency))
                        }
                        .monospacedDigit()
                        .accessibilityElement(children: .combine)
                    }
                }
            }

            Section {
                Button("Reopen Payment…", role: .destructive, action: onReopen)
                    .disabled(busy)
                    .accessibilityIdentifier("reopenPayment")
            } footer: {
                Text("Reopening deletes this payment; its sessions become unpaid again.")
            }
        }
        .formStyle(.grouped)
        .navigationTitle(Money.format(payment.totalAmount, payment.currency))
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}
