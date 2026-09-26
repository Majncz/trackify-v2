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
        SheetScaffold(title: editing == nil ? "New AI billing" : "Edit AI billing", onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 12) {
                ScrollView {
                    VStack(alignment: .leading, spacing: 16) {
                        Text("Same layout as Mark as paid: fill details below, then save. Depletion is set from the entry card after credits run out.")
                            .font(.scaled(13))
                            .foregroundStyle(Theme.mutedForeground)
                            .fixedSize(horizontal: false, vertical: true)
                        summaryLine
                        detailsFields
                        paymentFields
                        periodSection
                        noteField
                        if editing == nil { presetSaveSection }
                    }
                    .padding(.bottom, 4)
                }
                #if os(macOS)
                .frame(minHeight: 420, idealHeight: 620, maxHeight: 720)
                #endif
                footer
            }
        }
    }

    // MARK: Sections

    private var summaryLine: some View {
        let head = isRecurring ? "Recurring · \(cadence.label)" : "One-time · \(cadence.label)"
        let display = name.trimmingCharacters(in: .whitespaces).isEmpty ? "Untitled" : name.trimmingCharacters(in: .whitespaces)
        return (Text(head).fontWeight(.semibold)
            + Text(" · ").foregroundColor(Theme.mutedForeground)
            + Text(currency)
            + Text(" · ").foregroundColor(Theme.mutedForeground)
            + Text(display).fontWeight(.medium))
            .font(.scaled(14))
            .foregroundStyle(Theme.foreground)
            .lineLimit(1)
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous))
    }

    private var detailsFields: some View {
        VStack(alignment: .leading, spacing: 16) {
            AIBillingField(label: "Preset", optional: true) {
                AIBillingMenuPicker(
                    options: [("", "— none —")] + presets.map { ($0.id, $0.name) },
                    selection: Binding(get: { presetId }, set: { id in
                        presetId = id
                        if editing == nil, let pr = presets.first(where: { $0.id == id }) { name = pr.name }
                    })
                )
                .disabled(editing != nil)
            }
            AIBillingField(label: "Display name") {
                TField(placeholder: "", text: $name)
            }
            AIBillingField(label: "Account email", optional: true, hint: "Mailbox or login this subscription is purchased on.") {
                emailField
            }
            AIBillingField(label: "Link to subscription provider", optional: true, hint: "Billing portal, plans page, or customer login.") {
                urlField
            }
        }
    }

    @ViewBuilder private var emailField: some View {
        #if os(iOS)
        TField(placeholder: "you@example.com", text: $billingEmail)
            .keyboardType(.emailAddress)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        #else
        TField(placeholder: "you@example.com", text: $billingEmail)
            .autocorrectionDisabled()
        #endif
    }

    @ViewBuilder private var urlField: some View {
        #if os(iOS)
        TField(placeholder: "https://billing.example.com", text: $providerUrl)
            .keyboardType(.URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
        #else
        TField(placeholder: "https://billing.example.com", text: $providerUrl)
            .autocorrectionDisabled()
        #endif
    }

    @ViewBuilder private var priceField: some View {
        #if os(iOS)
        TField(placeholder: "0.00", text: $price, mono: true).keyboardType(.decimalPad)
        #else
        TField(placeholder: "0.00", text: $price, mono: true)
        #endif
    }

    private var paymentFields: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 8) {
                AIBillingField(label: isRecurring ? "Monthly price" : "Amount paid") { priceField }
                AIBillingField(label: "Currency") { CurrencyPicker(code: $currency) }
            }
            AIBillingField(label: "How you pay",
                           hint: (isRecurring
                                  ? "Each calendar month in your window adds one charge in totals (cadence is stored). Charts still use month buckets for now."
                                  : "One-time: coverage always closes at the end of the calendar period you pick below (week / month / quarter / year). You can override with a custom end date.")
                                + " Credits can run out earlier — Mark depleted on the entry card.") {
                AIBillingMenuPicker(
                    options: [(AIBillingKind.purchase, "One-time subscription"), (AIBillingKind.recurring, "Recurring subscription")],
                    selection: Binding(get: { kind }, set: { next in
                        guard next != kind else { return }
                        kind = next
                        cadence = .monthly
                        hasEndDate = false
                        purchaseUsesComputedEnd = true
                        endDate = startDate
                    })
                )
            }
            AIBillingField(label: isRecurring ? "Billing cycle" : "Paid coverage period",
                           hint: isRecurring
                                ? "Charts still attribute recurring spend by calendar month regardless of cycle."
                                : "Weekly = Monday–Sunday block containing the start date; monthly / quarterly / yearly = through the last day of that calendar bucket.") {
                AIBillingMenuPicker(
                    options: AICadence.allCases.map { ($0.rawValue, $0.label) },
                    selection: Binding(get: { cadence.rawValue }, set: { cadence = AICadence.normalize($0) })
                )
            }
        }
    }

    private var periodSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("SUBSCRIPTION PERIOD")
                    .font(.scaled(11, weight: .medium))
                    .tracking(0.5)
                    .foregroundStyle(Theme.mutedForeground)
                Text("Billing uses whole calendar days (start at the beginning of the start date; the last day runs through the end of that day)."
                     + (isRecurring
                        ? " Use the checkbox below only if this subscription has ended or ends on a known date."
                        : " One-time entries close at the end of the paid coverage period you chose above, unless you pick a custom end date."))
                    .font(.scaled(12))
                    .foregroundStyle(Theme.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            AIBillingDateRow(label: "Starts on", date: $startDate)
            if isRecurring { recurringEnd } else { purchaseEnd }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.muted.opacity(0.3), in: RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous).strokeBorder(Theme.border))
    }

    @ViewBuilder private var purchaseEnd: some View {
        if purchaseUsesComputedEnd {
            let end = cadence.coverageEnd(start: startDate, calc: calc)
            (Text("Coverage ends after period: ").foregroundColor(Theme.mutedForeground)
                + Text(AIBillingFormat.shortDate(end)).fontWeight(.semibold).foregroundColor(Theme.foreground)
                + Text(" (end of \(cadence.label.lowercased()) period)").foregroundColor(Theme.mutedForeground))
                .font(.scaled(12))
                .fixedSize(horizontal: false, vertical: true)
                .padding(8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.background, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Theme.border))
        }
        AIBillingCheckbox(
            isOn: Binding(get: { !purchaseUsesComputedEnd }, set: { custom in
                purchaseUsesComputedEnd = !custom
                if custom { endDate = calc.startOfDay(cadence.coverageEnd(start: startDate, calc: calc)) }
            }),
            title: "Use a different end date",
            detail: "Leave unchecked to end exactly at the last day of the period (for example month-end for Monthly)."
        )
        if !purchaseUsesComputedEnd {
            AIBillingDateRow(label: "Ends on", date: $endDate)
        }
    }

    @ViewBuilder private var recurringEnd: some View {
        AIBillingCheckbox(
            isOn: Binding(get: { hasEndDate }, set: { on in
                hasEndDate = on
                if on { endDate = startDate }
            }),
            title: "Ended / ends on a date",
            detail: "Unchecked means still active (open-ended). Checked reveals an end date."
        )
        if hasEndDate {
            AIBillingDateRow(label: "Ends on", date: $endDate)
        }
    }

    private var noteField: some View {
        AIBillingField(label: "Note", optional: true) {
            TField(placeholder: "Invoice ref, plan tier…", text: Binding(get: { note }, set: { note = String($0.prefix(2000)) }))
        }
    }

    private var presetSaveSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            AIBillingCheckbox(isOn: $saveAsPreset, title: "Save as new preset for next time", detail: nil)
            if saveAsPreset {
                TField(placeholder: "Preset name", text: $saveAsPresetName)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous))
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 8) {
            Hairline()
            InlineError(text: error)
            HStack(spacing: 8) {
                Spacer()
                Button("Cancel") { dismiss() }.buttonStyle(.t(.outline))
                Button(saving ? "Saving…" : (editing == nil ? "Create entry" : "Save entry"), action: save)
                    .buttonStyle(.t(.primary))
                    .disabled(saving)
                    .keyboardShortcut(.defaultAction)
            }
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

// MARK: - Form pieces

struct AIBillingField<Content: View>: View {
    var label: String
    var optional = false
    var hint: String? = nil
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            (Text(label).foregroundColor(Theme.foreground)
                + Text(optional ? " (optional)" : "").fontWeight(.regular).foregroundColor(Theme.mutedForeground))
                .font(.scaled(12, weight: .medium))
            content()
            if let hint {
                Text(hint).font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Menu select with the same look as `CurrencyPicker`.
struct AIBillingMenuPicker: View {
    var options: [(String, String)]
    @Binding var selection: String
    @Environment(\.isEnabled) private var enabled

    var body: some View {
        Menu {
            ForEach(options, id: \.0) { o in
                Button { selection = o.0 } label: {
                    if o.0 == selection { Label(o.1, systemImage: "checkmark") } else { Text(o.1) }
                }
            }
        } label: {
            HStack {
                Text(options.first { $0.0 == selection }?.1 ?? selection).lineLimit(1)
                Spacer(minLength: 6)
                Image(systemName: "chevron.up.chevron.down").font(.scaled(11)).foregroundStyle(Theme.mutedForeground)
            }
            .font(.scaled(14))
            .foregroundStyle(Theme.foreground)
            .padding(.horizontal, 12)
            .frame(maxWidth: .infinity, minHeight: 40)
            .background(Theme.background, in: RoundedRectangle(cornerRadius: Theme.controlRadius))
            .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius).strokeBorder(Theme.border))
            .opacity(enabled ? 1 : 0.5)
        }
        .menuStyle(.button)
        .buttonStyle(.plain)
        .menuIndicator(.hidden)
    }
}

struct AIBillingCheckbox: View {
    @Binding var isOn: Bool
    var title: String
    var detail: String?

    var body: some View {
        Button { isOn.toggle() } label: {
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: isOn ? "checkmark.square.fill" : "square")
                    .font(.scaled(16))
                    .foregroundStyle(isOn ? Theme.primary : Theme.mutedForeground)
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).font(.scaled(12, weight: .medium)).foregroundStyle(Theme.foreground)
                    if let detail {
                        Text(detail).font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isOn ? .isSelected : [])
    }
}

struct AIBillingDateRow: View {
    var label: String
    @Binding var date: Date

    var body: some View {
        HStack(spacing: 8) {
            Label(label, systemImage: "calendar")
                .font(.scaled(12, weight: .medium))
                .foregroundStyle(Theme.foreground)
            Spacer(minLength: 8)
            DatePicker(label, selection: $date, displayedComponents: .date)
                .labelsHidden()
        }
    }
}
