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
        NavigationStack {
            Form {
                Section {
                    LabeledContent("Sessions", value: "\(sessions.count)")
                    LabeledContent("Duration", value: Fmt.durationMinutes(Double(minutes)))
                    LabeledContent("Total to record") {
                        Text(Money.format(lineTotal, currency)).fontWeight(.semibold)
                            .accessibilityIdentifier("markPaidTotal")
                    }
                }
                .monospacedDigit()

                Section {
                    ForEach(sessions) { s in
                        MarkPaidLineRow(session: s, amount: amountBinding(s.id))
                    }
                    Button("Reset to Calculated Amounts") {
                        error = nil
                        amounts = Self.calculatedAmounts(sessions)
                    }
                    .disabled(sessions.isEmpty || allLinesMatchCalculated)
                } header: {
                    Text("Amounts")
                } footer: {
                    Text("Each line starts at the calculated amount. The total is the sum of the lines — change one only when needed.")
                }

                Section("Payment") {
                    DatePicker("Paid on", selection: $paidAt, displayedComponents: [.date, .hourAndMinute])
                    TextField("Note", text: $note, prompt: Text("Invoice #, reference…"), axis: .vertical)
                        .lineLimit(1...4)
                        .onChange(of: note) { _, v in
                            if v.count > 2000 { note = String(v.prefix(2000)) }
                        }
                }

                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .formStyle(.grouped)
            .navigationTitle("Mark as Paid")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }.disabled(submitting)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(submitting ? "Saving…" : "Mark Paid", action: submit)
                        .fontWeight(.semibold)
                        .disabled(submitting || sessions.isEmpty || amountsInvalid)
                        .accessibilityIdentifier("markPaidSubmit")
                }
            }
            .interactiveDismissDisabled(submitting)
        }
        #if os(macOS)
        .frame(minWidth: 520, idealWidth: 560, minHeight: 480, idealHeight: 620)
        #endif
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

// MARK: - One line in the sheet

private struct MarkPaidLineRow: View {
    let session: BillingSessionRow
    @Binding var amount: String
    @Environment(\.dynamicTypeSize) private var typeSize

    private var invalid: Bool { MarkPaidSheet.parseLine(amount) == nil }

    var body: some View {
        let layout = typeSize.isAccessibilitySize ? AnyLayout(VStackLayout(alignment: .leading, spacing: 6))
                                                  : AnyLayout(HStackLayout(alignment: .center, spacing: 10))
        VStack(alignment: .leading, spacing: 4) {
            layout {
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Circle().fill(Color(hex: session.accentHex)).frame(width: 8, height: 8)
                        Text(session.taskName).lineLimit(2)
                    }
                    Text("\(session.timeRangeShort) · \(Fmt.durationMinutes(Double(session.durationMinutes)))")
                        .font(.subheadline).foregroundStyle(.secondary)
                    Text("Calculated \(Money.format(session.earnings, session.currency))")
                        .font(.footnote).foregroundStyle(.secondary)
                }
                .monospacedDigit()
                if !typeSize.isAccessibilitySize { Spacer(minLength: 8) }
                HStack(spacing: 6) {
                    TextField("Amount", text: $amount, prompt: Text("0"))
                        .labelsHidden()
                        .multilineTextAlignment(.trailing)
                        .monospacedDigit()
                        #if os(iOS)
                        .keyboardType(.decimalPad)
                        .textFieldStyle(.roundedBorder)
                        #endif
                        .frame(width: 110)
                        .accessibilityLabel("Amount for \(session.taskName) in \(Money.unitLabel(session.currency))")
                    Text(Money.unitLabel(session.currency)).foregroundStyle(.secondary)
                }
            }
            if invalid {
                Text("Enter a valid amount (0 or more).").font(.footnote).foregroundStyle(.red)
            }
        }
        .padding(.vertical, 2)
    }
}
