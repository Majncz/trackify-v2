import SwiftUI
import TrackifyKit

// MARK: - History tab (payment-history.tsx)

struct BillingHistoryTab: View {
    @Environment(AppModel.self) private var model
    var store: BillingStore

    @State private var pendingReopen: PaymentRecord?
    @State private var confirmReopen = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Payment history").font(.cardTitle).tracking(-0.2).foregroundStyle(Theme.foreground)
                Text("Each batch shows amount, date, sessions, and per-line payouts from when you marked them paid.")
                    .font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            InlineError(text: store.reopenError)
            content
        }
        .confirmationDialog("Reopen payment?", isPresented: $confirmReopen, titleVisibility: .visible, presenting: pendingReopen) { p in
            Button("Reopen payment", role: .destructive) {
                Task { await store.reopen(p.id, api: model.api) }
            }
            Button("Cancel", role: .cancel) {}
        } message: { _ in
            Text("Sessions will become unpaid again.")
        }
    }

    @ViewBuilder
    private var content: some View {
        if let payments = store.payments {
            if payments.isEmpty {
                BillingDashedBox(text: "No payments recorded yet. Mark sessions as paid from the Ledger tab.")
            } else {
                VStack(spacing: 12) {
                    ForEach(payments) { p in
                        BillingPaymentCard(payment: p, busy: store.reopening != nil) {
                            pendingReopen = p
                            confirmReopen = true
                        }
                    }
                }
            }
        } else if store.paymentsFailed {
            let shape = RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
            Text("Could not load payment history.")
                .font(.scaled(14))
                .foregroundStyle(Theme.destructive)
                .padding(.horizontal, 16)
                .padding(.vertical, 20)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.destructive.opacity(0.05), in: shape)
                .overlay(shape.strokeBorder(Theme.destructive.opacity(0.4), lineWidth: 2))
        } else {
            VStack(spacing: 12) {
                Skeleton(height: 112)
                Skeleton(height: 112)
                Skeleton(height: 112)
            }
        }
    }
}

// MARK: - Payment card

struct BillingPaymentCard: View {
    let payment: PaymentRecord
    var busy = false
    var onReopen: () -> Void

    private var lines: [BillingSessionRow] { payment.sessions ?? [] }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
        VStack(spacing: 0) {
            header
            Rectangle().fill(Theme.border).frame(height: 2)
            linesBlock
        }
        .background(Theme.card)
        .clipShape(shape)
        .overlay(shape.strokeBorder(Theme.border, lineWidth: 2))
        .shadow(color: .black.opacity(0.05), radius: 1, x: 0, y: 1)
    }

    private var header: some View {
        let n = lines.count
        return HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(Money.format(payment.totalAmount, payment.currency))
                        .font(.scaled(18, weight: .semibold))
                        .tracking(-0.2)
                        .foregroundStyle(Theme.foreground)
                        .tabular()
                    Text(DayCalc.current.format(payment.paidAt, "MMM d, yyyy · HH:mm"))
                        .font(.scaled(14))
                        .foregroundStyle(Theme.mutedForeground)
                        .tabular()
                }
                HStack(spacing: 8) {
                    Badge(text: "\(n) session\(n == 1 ? "" : "s")", kind: .secondary)
                    Text(Fmt.durationMinutes(Double(payment.totalMinutes)))
                        .font(.scaled(12))
                        .foregroundStyle(Theme.mutedForeground)
                        .tabular()
                }
                if let note = payment.note, !note.isEmpty {
                    Rectangle().fill(Theme.border).frame(height: 2).padding(.top, 4)
                    Text(note)
                        .font(.scaled(12))
                        .foregroundStyle(Theme.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                        .textSelection(.enabled)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Button(action: onReopen) {
                Image(systemName: "trash").font(.scaled(14)).foregroundStyle(Theme.destructive)
            }
            .buttonStyle(.t(.ghost, .icon))
            .disabled(busy)
            .help("Reopen payment")
            .accessibilityLabel("Reopen payment")
        }
        .padding(14)
    }

    private var linesBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            BillingKicker(text: "Sessions in this payment")
                .padding(.bottom, 2)
            if lines.isEmpty {
                Text("No line items could be computed for this payment (e.g. billing settings changed). Totals above still reflect what was paid.")
                    .font(.scaled(12))
                    .foregroundStyle(Theme.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(lines) { s in
                    BillingPaymentLine(row: s, markedPaidAt: s.paymentPaidAt ?? payment.paidAt)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.muted.opacity(0.2))
    }
}

// MARK: - Payment line (PaymentSessionLine)

private struct BillingPaymentLine: View {
    let row: BillingSessionRow
    let markedPaidAt: Date

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 6) {
                    Text(row.taskName)
                        .font(.scaled(14, weight: .medium))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(2)
                        .layoutPriority(1)
                    if let g = row.taskGroup {
                        AccentBadge(text: g.name, hex: row.accentHex)
                    }
                }
                VStack(alignment: .leading, spacing: 3) {
                    meta("Session", BillingMath.sessionRange(from: row.from, to: row.to))
                    meta("Marked paid", DayCalc.current.format(markedPaidAt, "MMM d, yyyy · HH:mm"))
                    meta("Duration", Fmt.durationMinutes(Double(row.durationMinutes)))
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            Text(Money.format(row.earnings, row.currency))
                .font(.scaled(13, weight: .semibold))
                .foregroundStyle(Theme.foreground)
                .tabular()
                .fixedSize()
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(Color(hex: row.accentHex, opacity: 0.12), in: shape)
        .background(Theme.card, in: shape)
        .overlay(shape.strokeBorder(Theme.border, lineWidth: 2))
    }

    private func meta(_ label: String, _ value: String) -> some View {
        (Text(label + " ").fontWeight(.medium).foregroundColor(Theme.mutedForeground)
         + Text(value).foregroundColor(Theme.foreground.opacity(0.9)))
            .font(.scaled(12))
            .monospacedDigit()
            .fixedSize(horizontal: false, vertical: true)
    }
}
