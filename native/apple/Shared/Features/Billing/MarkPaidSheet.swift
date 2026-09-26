import SwiftUI
import TrackifyKit

// MARK: - Mark as paid (mark-paid-dialog.tsx)

struct MarkPaidSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let sessions: [BillingSessionRow]
    var onSuccess: () -> Void

    @State private var amounts: [String: String]
    @State private var paidAt = Date()
    @State private var note = ""
    @State private var submitting = false
    @State private var error: String?

    init(sessions: [BillingSessionRow], onSuccess: @escaping () -> Void) {
        self.sessions = sessions
        self.onSuccess = onSuccess
        _amounts = State(initialValue: Self.calculatedAmounts(sessions))
    }

    static func calculatedAmounts(_ sessions: [BillingSessionRow]) -> [String: String] {
        Dictionary(sessions.map { ($0.id, amountString($0.earnings)) }, uniquingKeysWith: { a, _ in a })
    }

    /// JS `String(n)`-like: "120", "12.5", "12.35".
    static func amountString(_ x: Double) -> String {
        let r = Money.round2(x)
        if r == r.rounded(), abs(r) < 1e15 { return String(Int64(r)) }
        return String(r)
    }

    /// Valid line: a number ≥ 0 (comma accepted), rounded to 2 dp.
    static func parseLine(_ raw: String?) -> Double? {
        guard let raw, let v = Money.parseAmount(raw), v >= 0 else { return nil }
        return Money.round2(v)
    }

    private var currency: String { sessions.first?.currency ?? Money.defaultCurrency }
    private var minutes: Int { sessions.reduce(0) { $0 + $1.durationMinutes } }
    private var amountsInvalid: Bool { sessions.contains { Self.parseLine(amounts[$0.id]) == nil } }

    private var lineTotal: Double {
        Money.round2(sessions.reduce(0.0) { acc, s in acc + (Self.parseLine(amounts[s.id]) ?? 0) })
    }

    private var allLinesMatchCalculated: Bool {
        sessions.allSatisfy { s in
            guard let v = Self.parseLine(amounts[s.id]) else { return false }
            return abs(v - s.earnings) < 0.005
        }
    }

    var body: some View {
        SheetScaffold(title: "Mark as paid", onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 12) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        Text("Total = sum of each line below. Override amounts only when needed.")
                            .font(.scaled(13)).foregroundStyle(Theme.mutedForeground)
                            .fixedSize(horizontal: false, vertical: true)
                        headerSummary
                        linesSection
                        detailsSection
                    }
                    .padding(.bottom, 4)
                }
                #if os(macOS)
                .frame(minHeight: 380, idealHeight: 560, maxHeight: 720)
                #endif
                if let error {
                    Text(error)
                        .font(.scaled(12, weight: .medium))
                        .foregroundStyle(Theme.destructive)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(Theme.destructive.opacity(0.1), in: RoundedRectangle(cornerRadius: 6))
                        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Theme.destructive.opacity(0.4)))
                }
                footer
            }
        }
    }

    // MARK: Parts

    private var headerSummary: some View {
        let n = sessions.count
        let line = Text("\(n)").fontWeight(.semibold).foregroundColor(Theme.foreground)
            + Text(n == 1 ? " session" : " sessions").foregroundColor(Theme.mutedForeground)
            + Text("  ·  ").foregroundColor(Theme.mutedForeground)
            + Text(Fmt.durationMinutes(Double(minutes))).foregroundColor(Theme.foreground)
        let full = line
            + Text("  ·  ").foregroundColor(Theme.mutedForeground)
            + Text(Money.format(lineTotal, currency)).fontWeight(.semibold).foregroundColor(Theme.foreground)
        return full
            .font(.scaled(14))
            .monospacedDigit()
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.muted.opacity(0.35), in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Theme.border))
    }

    private var linesSection: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
        return VStack(spacing: 0) {
            HStack {
                Text("Sessions").font(.scaled(13, weight: .semibold))
                Spacer()
                Button("Reset to calculated") {
                    error = nil
                    amounts = Self.calculatedAmounts(sessions)
                }
                .buttonStyle(.t(.ghost, .sm))
                .disabled(sessions.isEmpty || allLinesMatchCalculated)
                .accessibilityLabel("Reset all line amounts to calculated values")
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 4)
            .background(Theme.muted.opacity(0.55))
            Rectangle().fill(Theme.border).frame(height: 2)
            VStack(spacing: 6) {
                ForEach(sessions) { s in
                    MarkPaidLineRow(session: s, amount: amountBinding(s.id))
                }
            }
            .padding(6)
            .background(Theme.muted.opacity(0.2))
        }
        .background(Theme.card)
        .clipShape(shape)
        .overlay(shape.strokeBorder(Theme.border, lineWidth: 2))
    }

    private var detailsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            BillingKicker(text: "Payment details")
            HStack(alignment: .top, spacing: 16) {
                VStack(alignment: .leading, spacing: 4) {
                    Label("Paid on", systemImage: "calendar")
                        .font(.scaled(12, weight: .medium))
                    DatePicker("Paid on", selection: $paidAt, displayedComponents: .date)
                        .labelsHidden()
                }
                VStack(alignment: .leading, spacing: 4) {
                    Label("Paid at time", systemImage: "clock")
                        .font(.scaled(12, weight: .medium))
                    DatePicker("Paid at time", selection: $paidAt, displayedComponents: .hourAndMinute)
                        .labelsHidden()
                }
                Spacer(minLength: 0)
            }
            VStack(alignment: .leading, spacing: 4) {
                (Text("Note").foregroundColor(Theme.foreground)
                 + Text(" (optional)").fontWeight(.regular).foregroundColor(Theme.mutedForeground))
                    .font(.scaled(12, weight: .medium))
                TField(placeholder: "Invoice #, reference…", text: $note)
                    .onChange(of: note) { _, v in
                        if v.count > 2000 { note = String(v.prefix(2000)) }
                    }
            }
        }
        .padding(.top, 4)
    }

    private var footer: some View {
        HStack(alignment: .bottom, spacing: 8) {
            VStack(alignment: .leading, spacing: 0) {
                Text("Total to record")
                    .font(.scaled(10, weight: .medium))
                    .tracking(0.6)
                    .textCase(.uppercase)
                    .foregroundStyle(Theme.mutedForeground)
                Text(Money.format(lineTotal, currency))
                    .font(.scaled(22, weight: .bold))
                    .tracking(-0.3)
                    .tabular()
                    .lineLimit(1)
                    .minimumScaleFactor(0.6)
            }
            Spacer(minLength: 8)
            Button("Cancel") { dismiss() }
                .buttonStyle(.t(.outline))
                .disabled(submitting)
            Button(submitting ? "Saving…" : "Mark as paid", action: submit)
                .buttonStyle(.t(.primary))
                .disabled(submitting || sessions.isEmpty || amountsInvalid)
                .keyboardShortcut(.defaultAction)
        }
        .padding(.top, 8)
    }

    private func amountBinding(_ id: String) -> Binding<String> {
        Binding(get: { amounts[id] ?? "" }, set: { amounts[id] = $0 })
    }

    // MARK: Submit

    private func submit() {
        error = nil
        guard !amountsInvalid, !sessions.isEmpty else {
            error = "Enter a valid amount (0 or more) for every session."
            return
        }
        var lines: [String: Double] = [:]
        for s in sessions {
            if let v = Self.parseLine(amounts[s.id]) { lines[s.id] = v }
        }
        // "Paid on" + "Paid at time" combined as local time (seconds dropped like the web's HH:mm).
        let cal = Calendar.current
        let parts = cal.dateComponents([.year, .month, .day, .hour, .minute], from: paidAt)
        let when = cal.date(from: parts) ?? paidAt
        let trimmed = note.trimmingCharacters(in: .whitespacesAndNewlines)
        let ids = sessions.map(\.id)
        submitting = true
        Task {
            do {
                try await model.api.markPaid(eventIds: ids, paidAt: when, note: trimmed.isEmpty ? nil : trimmed, lineAmounts: lines)
                submitting = false
                onSuccess()
                dismiss()
            } catch let e as APIError {
                submitting = false
                error = e.message
            } catch {
                submitting = false
                self.error = "Something went wrong"
            }
        }
    }
}

// MARK: - One line in the dialog

private struct MarkPaidLineRow: View {
    let session: BillingSessionRow
    @Binding var amount: String

    private var invalid: Bool { MarkPaidSheet.parseLine(amount) == nil }

    private var timeRange: String {
        let calc = DayCalc.current
        return "\(calc.format(session.from, "MMM d, yyyy")) · \(calc.format(session.from, "HH:mm"))–\(calc.format(session.to, "HH:mm"))"
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        VStack(alignment: .trailing, spacing: 4) {
            HStack(alignment: .center, spacing: 10) {
                details
                Spacer(minLength: 6)
                amountField
            }
            if invalid {
                Text("Enter a valid amount (0 or more).")
                    .font(.scaled(10, weight: .medium))
                    .foregroundStyle(Theme.destructive)
            }
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background(Color(hex: session.accentHex, opacity: 0.06), in: shape)
        .background(Theme.card, in: shape)
        .overlay(shape.strokeBorder(Theme.border, lineWidth: 2))
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 6) {
                Text(session.taskName)
                    .font(.scaled(14, weight: .semibold))
                    .foregroundStyle(Theme.foreground)
                    .lineLimit(2)
                    .layoutPriority(1)
                if let g = session.taskGroup {
                    AccentBadge(text: g.name, hex: session.accentHex)
                }
            }
            FlowLayout(spacing: 6, lineSpacing: 3) {
                Text(timeRange)
                    .font(.scaled(11)).foregroundStyle(Theme.mutedForeground).tabular()
                Badge(text: Fmt.durationMinutes(Double(session.durationMinutes)), kind: .secondary, mono: true)
                (Text("Calc ").foregroundColor(Theme.mutedForeground)
                 + Text(Money.format(session.earnings, session.currency)).fontWeight(.medium).foregroundColor(Theme.foreground))
                    .font(.scaled(11))
                    .monospacedDigit()
            }
        }
    }

    private var amountField: some View {
        HStack(spacing: 6) {
            TField(placeholder: "0", text: $amount)
                .multilineTextAlignment(.trailing)
                #if os(iOS)
                .keyboardType(.decimalPad)
                #endif
                .frame(width: 104)
                .overlay {
                    if invalid {
                        RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous)
                            .strokeBorder(Theme.destructive, lineWidth: 1)
                    }
                }
                .accessibilityLabel("Amount to record for \(session.taskName) in \(Money.unitLabel(session.currency))")
            Text(Money.unitLabel(session.currency))
                .font(.scaled(12, weight: .semibold))
                .foregroundStyle(Theme.mutedForeground)
                .tabular()
        }
    }
}
