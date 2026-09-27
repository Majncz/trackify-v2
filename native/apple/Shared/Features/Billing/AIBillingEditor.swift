import SwiftUI
import TrackifyKit

// MARK: - Add / Edit sheet (ai-tools-tab.tsx `PeriodFormDialog`)

enum AIBillingKind {
    static let purchase = "purchase"
    static let recurring = "recurring_monthly"
}

struct AIBillingEditor: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let target: AIBillingEditorTarget
    let presets: [AIPreset]
    var onSaved: () -> Void

    @State private var presetId: String
    @State private var name: String
    @State private var billingEmail: String
    @State private var providerUrl: String
    @State private var price: String
    @State private var currency: String
    @State private var kind: String
    @State private var cadence: AICadence
    @State private var startDate: Date
    @State private var endDate: Date
    @State private var purchaseUsesComputedEnd: Bool
    @State private var hasEndDate: Bool
    @State private var note: String
    @State private var saveAsPreset = false
    @State private var saveAsPresetName = ""
    @State private var error: String?
    @State private var saving = false

    private var editing: AIPeriod? { target.period }
    private var isRecurring: Bool { kind == AIBillingKind.recurring }
    private var calc: DayCalc { DayCalc.current }

    init(target: AIBillingEditorTarget, presets: [AIPreset], onSaved: @escaping () -> Void) {
        self.target = target
        self.presets = presets
        self.onSaved = onSaved
        let calc = DayCalc.current
        if let p = target.period {
            let recurring = p.billingKind == AIBillingKind.recurring
            let cad = AICadence.normalize(p.billingCadence)
            _presetId = State(initialValue: p.presetId ?? "")
            _name = State(initialValue: p.name)
            _billingEmail = State(initialValue: p.billingEmail ?? "")
            _providerUrl = State(initialValue: p.billingProviderUrl ?? "")
            _price = State(initialValue: AIBillingFormat.number(p.price))
            _currency = State(initialValue: p.currency)
            _kind = State(initialValue: recurring ? AIBillingKind.recurring : AIBillingKind.purchase)
            _cadence = State(initialValue: cad)
            _startDate = State(initialValue: calc.startOfDay(p.startsAt))
            _note = State(initialValue: p.note ?? "")
            if recurring {
                _hasEndDate = State(initialValue: p.endsAt != nil)
                _purchaseUsesComputedEnd = State(initialValue: true)
                _endDate = State(initialValue: calc.startOfDay(p.endsAt ?? p.startsAt))
            } else {
                // derivePurchaseUsesComputedEnd: stored end day == computed coverage end day.
                var auto = true
                if let e = p.endsAt {
                    let computed = cad.coverageEnd(start: p.startsAt, calc: calc)
                    auto = calc.startOfDay(e) == calc.startOfDay(computed)
                }
                _purchaseUsesComputedEnd = State(initialValue: auto)
                _hasEndDate = State(initialValue: false)
                _endDate = State(initialValue: calc.startOfDay(p.endsAt ?? p.startsAt))
            }
        } else {
            let today = calc.startOfDay(Date())
            _presetId = State(initialValue: "")
            _name = State(initialValue: "")
            _billingEmail = State(initialValue: "")
            _providerUrl = State(initialValue: "")
            _price = State(initialValue: "")
            _currency = State(initialValue: Money.defaultCurrency)
            _kind = State(initialValue: AIBillingKind.purchase)
            _cadence = State(initialValue: .monthly)
            _startDate = State(initialValue: today)
            _endDate = State(initialValue: today)
            _purchaseUsesComputedEnd = State(initialValue: true)
            _hasEndDate = State(initialValue: false)
            _note = State(initialValue: "")
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                if !presets.isEmpty {
                    Section {
                        Picker("Preset", selection: Binding(get: { presetId }, set: { id in
                            presetId = id
                            if editing == nil, let pr = presets.first(where: { $0.id == id }) { name = pr.name }
                        })) {
                            Text("None").tag("")
                            ForEach(presets) { Text($0.name).tag($0.id) }
                        }
                        .disabled(editing != nil)
                    } footer: {
                        if editing == nil { Text("A preset fills in the name.") }
                    }
                }

                Section {
                    field("Name", text: $name, prompt: "Required")
                        .accessibilityIdentifier("aiName")
                    emailField
                    urlField
                } header: {
                    Text("Subscription")
                } footer: {
                    Text("Email: the mailbox or login the subscription is on. Link: billing portal, plans page or customer login.")
                }

                Section {
                    Picker("How you pay", selection: Binding(get: { kind }, set: { next in
                        guard next != kind else { return }
                        kind = next
                        cadence = .monthly
                        hasEndDate = false
                        purchaseUsesComputedEnd = true
                        endDate = startDate
                    })) {
                        Text("One-time").tag(AIBillingKind.purchase)
                        Text("Recurring").tag(AIBillingKind.recurring)
                    }
                    Picker(isRecurring ? "Billing cycle" : "Paid coverage", selection: Binding(get: { cadence }, set: { cadence = $0 })) {
                        ForEach(AICadence.allCases, id: \.self) { Text($0.label).tag($0) }
                    }
                    priceField
                    Picker("Currency", selection: $currency) {
                        ForEach(Money.options(including: currency), id: \.code) { Text($0.label).tag($0.code) }
                    }
                } header: {
                    Text("Price")
                } footer: {
                    Text(isRecurring
                         ? "Each calendar month in the window adds one charge to the totals. Charts group recurring spend by calendar month."
                         : "One-time coverage ends with the calendar period you pick (weeks run Monday–Sunday), unless you set a different end date.")
                }

                Section {
                    DatePicker("Starts on", selection: $startDate, displayedComponents: .date)
                    if isRecurring { recurringEnd } else { purchaseEnd }
                } header: {
                    Text("Period")
                } footer: {
                    Text("Whole calendar days: from the start of the first day through the end of the last. If credits run out early, mark the entry depleted instead.")
                }

                Section {
                    TextField("Note", text: Binding(get: { note }, set: { note = String($0.prefix(2000)) }),
                              prompt: Text("Invoice ref, plan tier…"), axis: .vertical)
                        .lineLimit(1...4)
                }

                if editing == nil {
                    Section {
                        Toggle("Save as a new preset", isOn: $saveAsPreset)
                        if saveAsPreset {
                            field("Preset name", text: $saveAsPresetName, prompt: "Name")
                        }
                    }
                }

                if let error {
                    Section { Text(error).foregroundStyle(.red) }
                }
            }
            .formStyle(.grouped)
            .navigationTitle(editing == nil ? "New AI Subscription" : "Edit AI Subscription")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(saving ? "Saving…" : (editing == nil ? "Add" : "Save"), action: save)
                        .fontWeight(.semibold)
                        .disabled(saving)
                        .accessibilityIdentifier("aiSave")
                }
            }
            .interactiveDismissDisabled(saving)
        }
        #if os(macOS)
        .frame(minWidth: 500, idealWidth: 540, minHeight: 560, idealHeight: 680)
        #endif
    }

    // MARK: Fields

    /// iPhone: label + trailing field (Settings style). Mac: the Form's own label column.
    @ViewBuilder private func field(_ label: String, text: Binding<String>, prompt: String) -> some View {
        #if os(iOS)
        LabeledContent(label) {
            TextField(label, text: text, prompt: Text(prompt)).multilineTextAlignment(.trailing)
        }
        #else
        TextField(label, text: text, prompt: Text(prompt))
        #endif
    }

    @ViewBuilder private var emailField: some View {
        #if os(iOS)
        field("Account email", text: $billingEmail, prompt: "Optional")
            .keyboardType(.emailAddress)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        #else
        field("Account email", text: $billingEmail, prompt: "Optional")
            .autocorrectionDisabled()
        #endif
    }

    @ViewBuilder private var urlField: some View {
        #if os(iOS)
        field("Provider link", text: $providerUrl, prompt: "Optional")
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        #else
        field("Provider link", text: $providerUrl, prompt: "https://… (optional)")
            .autocorrectionDisabled()
        #endif
    }

    @ViewBuilder private var priceField: some View {
        #if os(iOS)
        field(isRecurring ? "Monthly price" : "Amount paid", text: $price, prompt: "0.00")
            .keyboardType(.decimalPad)
            .monospacedDigit()
        #else
        field(isRecurring ? "Monthly price" : "Amount paid", text: $price, prompt: "0.00")
            .monospacedDigit()
        #endif
    }

    @ViewBuilder private var purchaseEnd: some View {
        Toggle("Different end date", isOn: Binding(get: { !purchaseUsesComputedEnd }, set: { custom in
            purchaseUsesComputedEnd = !custom
            if custom { endDate = calc.startOfDay(cadence.coverageEnd(start: startDate, calc: calc)) }
        }))
        if purchaseUsesComputedEnd {
            LabeledContent("Coverage ends", value: AIBillingFormat.shortDate(cadence.coverageEnd(start: startDate, calc: calc)))
        } else {
            DatePicker("Ends on", selection: $endDate, in: startDate..., displayedComponents: .date)
        }
    }

    @ViewBuilder private var recurringEnd: some View {
        Toggle("Has an end date", isOn: Binding(get: { hasEndDate }, set: { on in
            hasEndDate = on
            if on { endDate = startDate }
        }))
        if hasEndDate {
            DatePicker("Ends on", selection: $endDate, in: startDate..., displayedComponents: .date)
        }
    }

    // MARK: Save

    private func trimmedOrNil(_ s: String) -> String? {
        let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
        return t.isEmpty ? nil : t
    }

    private func save() {
        error = nil
        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedName.isEmpty, let p = Money.parseAmount(price), p > 0 else {
            error = "Name and positive price required"
            return
        }
        let s = calc.startOfDay(startDate)
        var endsAt: Date? = nil
        if !isRecurring {
            if purchaseUsesComputedEnd {
                endsAt = cadence.coverageEnd(start: s, calc: calc)
            } else {
                let e = calc.endOfDay(endDate)
                if e < s { error = "End day must be on or after start day"; return }
                endsAt = e
            }
        } else if hasEndDate {
            let e = calc.endOfDay(endDate)
            if e < s { error = "End day must be on or after start day"; return }
            endsAt = e
        }

        var body: [String: Any?] = [
            "name": trimmedName,
            "price": p,
            "currency": currency,
            "startsAt": s,
            "endsAt": endsAt,
            "billingKind": kind,
            "billingCadence": cadence.rawValue,
            "billingEmail": trimmedOrNil(billingEmail),
            "billingProviderUrl": trimmedOrNil(providerUrl),
            "note": trimmedOrNil(note),
            "presetId": trimmedOrNil(presetId),
        ]
        if editing == nil, saveAsPreset, let presetName = trimmedOrNil(saveAsPresetName) {
            let preset: [String: Any] = ["name": presetName]
            body["saveAsPreset"] = preset
        }

        saving = true
        Task {
            do {
                if let editing {
                    _ = try await model.api.updateAIPeriod(id: editing.id, body)
                } else {
                    _ = try await model.api.createAIPeriod(body)
                }
                saving = false
                onSaved()
                dismiss()
            } catch {
                saving = false
                self.error = (error as? APIError)?.message ?? "Save failed"
            }
        }
    }
}

