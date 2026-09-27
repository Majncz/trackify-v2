import SwiftUI
import TrackifyKit

/// `/tasks/:id` (WEB_AUDIT §1.6) + native extras: edit/delete time entries.
struct TaskDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let taskId: String

    @State private var renaming = false
    @State private var nameDraft = ""
    @State private var renameError: String?
    @State private var confirmHide = false
    @State private var showAllDays = false
    @State private var editing: TimeEvent?
    @State private var loggingPast = false

    var body: some View {
        list
        #if os(iOS)
        .background(Theme.background)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button("Rename") { startRename() }
                    .disabled(model.task(taskId) == nil)
                    .accessibilityIdentifier("renameTask")
            }
        }
        #else
        .toolbar { macToolbar }
        #endif
        .navigationTitle(model.task(taskId)?.name ?? "Task")
        .alert("Rename Task", isPresented: $renaming) {
            TextField("Task name", text: $nameDraft)
                .accessibilityIdentifier("renameField")
            Button("Cancel", role: .cancel) {}
            Button("Save") { if let t = model.task(taskId) { commitRename(t) } }
        }
        .confirmationDialog("Hide this task? You can restore it from Hidden tasks.", isPresented: $confirmHide, titleVisibility: .visible) {
            Button("Hide", role: .destructive) {
                Task {
                    try? await model.hide(taskId)
                    dismiss()
                }
            }
        }
        .sheet(item: $editing) { e in EditEntrySheet(event: e).trackifySheet() }
        .sheet(isPresented: $loggingPast) {
            if let t = model.task(taskId) { LogPastSheet(task: t).trackifySheet() }
        }
    }

    // MARK: A plain grouped list (iPhone / iPad) or grouped form (Mac)

    @ViewBuilder private var list: some View {
        #if os(iOS)
        List { listContent }.listStyle(.insetGrouped)
        #else
        Form { listContent }.formStyle(.grouped)
        #endif
    }

    #if os(macOS)
    @ToolbarContentBuilder private var macToolbar: some ToolbarContent {
        // The hosted window doesn't get NavigationStack's automatic Back button, so add it.
        ToolbarItem(placement: .navigation) {
            Button { dismiss() } label: { Label("Back", systemImage: "chevron.left") }
                .keyboardShortcut("[", modifiers: .command)
                .help("Back (⌘[)")
        }
        if let task = model.task(taskId) {
            let isRunning = model.running?.taskId == task.id
            ToolbarItemGroup(placement: .primaryAction) {
                Button { startRename() } label: { Label("Rename…", systemImage: "pencil") }
                    .help("Rename task")
                Button { loggingPast = true } label: { Label("Log Past Time…", systemImage: "clock.arrow.circlepath") }
                    .help("Log past time")
                Button { confirmHide = true } label: { Label("Hide", systemImage: "eye.slash") }
                    .help("Hide task")
                Button { model.toggle(task.id) } label: {
                    Label(isRunning ? "Stop" : "Start", systemImage: isRunning ? "stop.fill" : "play.fill")
                        .labelStyle(.titleAndIcon)
                }
                .help(isRunning ? "Stop the timer" : "Start the timer")
            }
        }
    }
    #endif

    @ViewBuilder private var listContent: some View {
            if let task = model.task(taskId) {
                let isRunning = model.running?.taskId == task.id
                Section {
                    if let g = task.taskGroup {
                        HStack { Text("Group"); Spacer(); AccentBadge(text: g.name, hex: g.accentHex) }
                    }
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        let live = isRunning ? max(0, ctx.date.ms - (model.running?.startTime ?? 0)) : 0
                        LabeledContent("Total time") { Text(Fmt.durationWords(task.totalMs + live)).tabular() }
                    }
                    LabeledContent("Sessions") { Text("\(task.events.count)").tabular() }
                } footer: {
                    if let renameError { Text(renameError).foregroundStyle(Theme.destructive) }
                }
                #if os(iOS)
                Section {
                    Button { model.toggle(task.id) } label: {
                        Label(isRunning ? "Stop" : "Start", systemImage: isRunning ? "stop.fill" : "play.fill")
                    }
                    .foregroundStyle(isRunning ? Theme.destructive : Theme.foreground)
                    Button { loggingPast = true } label: { Label("Log past time", systemImage: "clock.arrow.circlepath") }
                        .foregroundStyle(Theme.foreground)
                }
                #endif
                entrySections(task)
                TaskBillingSection(task: task)
                #if os(iOS)
                Section {
                    Button(role: .destructive) { confirmHide = true } label: { Label("Hide task", systemImage: "eye.slash") }
                }
                #endif
            } else {
                Text("Task not found").foregroundStyle(Theme.mutedForeground)
            }
    }

    @ViewBuilder private func entrySections(_ task: TrackifyTask) -> some View {
        let calc = DayCalc.current
        let days = Dictionary(grouping: task.events) { calc.dayKey($0.from) }
            .map { (key: $0.key, events: $0.value.sorted { $0.from > $1.from }) }
            .sorted { $0.key > $1.key }
        let shown = showAllDays ? days : Array(days.prefix(5))
        if days.isEmpty {
            Section("Time entries") { Text("No time entries yet.").foregroundStyle(Theme.mutedForeground) }
        }
        ForEach(shown, id: \.key) { day in
            Section {
                ForEach(day.events) { e in
                    Button { editing = e } label: {
                        HStack {
                            Text("\(calc.format(e.from, "h:mm a")) → \(calc.format(e.to, "h:mm a"))").tabular().foregroundStyle(Theme.foreground)
                            if e.paymentRecordId != nil {
                                Text("Paid").font(.caption.weight(.semibold)).foregroundStyle(Theme.mutedForeground)
                            }
                            Spacer()
                            Text(Fmt.durationWords(e.durationMs)).tabular().foregroundStyle(Theme.mutedForeground)
                        }
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .swipeActions {
                        Button(role: .destructive) { Task { try? await model.deleteEvent(e.id) } } label: { Label("Delete", systemImage: "trash") }
                    }
                    .contextMenu {
                        Button { editing = e } label: { Label("Edit", systemImage: "pencil") }
                        Button(role: .destructive) { Task { try? await model.deleteEvent(e.id) } } label: { Label("Delete", systemImage: "trash") }
                    }
                }
            } header: {
                HStack {
                    Text(dayLabel(day.key))
                    Spacer()
                    Text(Fmt.durationWords(day.events.reduce(0) { $0 + $1.durationMs })).tabular()
                }
            }
        }
        if days.count > 5 {
            Section {
                Button(showAllDays ? "Show fewer days" : "Show \(days.count - 5) more days") { showAllDays.toggle() }
            }
        }
    }
    private func startRename() {
        nameDraft = model.task(taskId)?.name ?? ""
        renaming = true
    }

    private func commitRename(_ task: TrackifyTask) {
        let n = nameDraft.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty, n != task.name else { return }
        renameError = nil
        Task {
            do { try await model.rename(task.id, to: n) } catch let e as APIError { renameError = e.message } catch {}
        }
    }

    private func dayLabel(_ key: String) -> String {
        let calc = DayCalc.current
        let today = calc.dayKey(Date())
        let yesterday = calc.dayKey(calc.addDays(Date(), -1))
        if key == today { return "Today" }
        if key == yesterday { return "Yesterday" }
        return calc.date(fromKey: key).map { calc.format($0, "EEEE, MMMM d, yyyy") } ?? key
    }
}


/// Edit/delete a single time entry (beyond web: WEB_AUDIT G16).
struct EditEntrySheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let event: TimeEvent
    @State private var from = Date()
    @State private var to = Date()
    @State private var error: String?
    @State private var busy = false
    @State private var confirmDelete = false

    var body: some View {
        SheetScaffold(title: "Edit time entry", onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 16) {
                Text(Fmt.durationWords(max(0, to.ms - from.ms))).font(.dialogDuration).tabular().lineLimit(1).minimumScaleFactor(0.5).frame(maxWidth: .infinity)
                DatePicker("From", selection: $from, in: ...Date())
                DatePicker("Until", selection: $to, in: from...Date())
                if event.paymentRecordId != nil {
                    Text("This session is already paid. Changing it won't change the recorded payment.")
                        .font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
                }
                InlineError(text: error)
                HStack(spacing: 8) {
                    Button(role: .destructive) { confirmDelete = true } label: { Label("Delete", systemImage: "trash") }
                        .buttonStyle(.t(.ghost))
                        .foregroundStyle(Theme.destructive)
                    Spacer()
                    Button("Cancel") { dismiss() }.buttonStyle(.t(.outline))
                    Button(busy ? "Saving…" : "Save", action: save).buttonStyle(.t(.primary)).disabled(busy || to <= from)
                        .keyboardShortcut(.defaultAction)
                }
            }
        }
        .onAppear { from = event.from; to = event.to }
        .confirmationDialog("Delete this time entry?", isPresented: $confirmDelete, titleVisibility: .visible) {
            Button("Delete", role: .destructive) {
                Task {
                    do { try await model.deleteEvent(event.id); dismiss() }
                    catch let e as APIError { error = e.message } catch {}
                }
            }
        }
    }

    private func save() {
        busy = true
        error = nil
        Task {
            do {
                try await model.updateEvent(event.id, from: Date(ms: snapMinute(from.ms)), to: Date(ms: snapMinute(to.ms)))
                dismiss()
            } catch let e as APIError { error = e.message } catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}

// MARK: - Billing rate rows (shared by task detail + Billing → Rates)

/// Enrol / edit / remove a task's hourly rate as native form rows, inside a `Section` of a List or Form.
struct TaskBillingSection: View {
    @Environment(AppModel.self) private var model
    let task: TrackifyTask
    /// Provided by Billing → Rates (which already loaded the rows); otherwise the section fetches.
    var rows: [BillingTaskRow]? = nil
    var onChanged: (() -> Void)? = nil

    @State private var loaded: [BillingTaskRow]?
    @State private var loadFailed = false
    @State private var draftRate = "50"
    @State private var draftCurrency = Money.defaultCurrency
    @State private var rateText = ""
    @State private var error: String?
    @State private var busy = false
    @State private var confirmRemove = false
    @FocusState private var rateFocused: Bool

    private var billing: BillingTaskRow? { (rows ?? loaded)?.first { $0.taskId == task.id } }
    private var ready: Bool { rows != nil || loaded != nil }

    var body: some View {
        Section {
            if !ready && !loadFailed {
                ProgressView().frame(maxWidth: .infinity)
                    .task(id: model.dataTick) { await load() }
            } else if !ready {
                Text("Could not load billing settings for this task.").foregroundStyle(.red)
                    .task(id: model.dataTick) { await load() }
            } else if let b = billing {
                rateField(text: $rateText, currency: b.currency)
                    .onAppear { rateText = Self.rateString(b.hourlyRate) }
                    .onChange(of: b.hourlyRate) { _, r in rateText = Self.rateString(r) }
                    .onSubmit { saveRate(b) }
                    .onChange(of: rateFocused) { _, f in if !f { saveRate(b) } }
                    .task(id: model.dataTick) { if rows == nil { await load() } }
                currencyPicker(Binding(get: { b.currency }, set: { patch(b, currency: $0) }))
                totals(rate: b.hourlyRate, currency: b.currency)
                Button("Remove from Billing", role: .destructive) { confirmRemove = true }
                    .confirmationDialog("Remove this task from billing?", isPresented: $confirmRemove, titleVisibility: .visible) {
                        Button("Remove", role: .destructive) { remove() }
                    } message: {
                        Text("Paid history stays linked to past sessions.")
                    }
            } else {
                rateField(text: $draftRate, currency: draftCurrency)
                    .task(id: model.dataTick) { if rows == nil { await load() } }
                currencyPicker($draftCurrency)
                totals(rate: nil, currency: draftCurrency)
                Button(busy ? "Adding…" : "Add to Billing", action: enroll)
                    .disabled(busy || Money.parseAmount(draftRate) == nil)
                    .accessibilityIdentifier("enrollBilling")
            }
            if let error { Text(error).foregroundStyle(.red) }
        } header: {
            Text("Billing")
        } footer: {
            if ready {
                Text(billing != nil
                     ? "Rate changes apply to unpaid sessions. Paid sessions keep the amount recorded with their payment."
                     : "Give this task an hourly rate to include its time in Billing sessions and payments.")
            }
        }
    }

    private func rateField(text: Binding<String>, currency: String) -> some View {
        LabeledContent("Hourly rate") {
            HStack(spacing: 6) {
                TextField("Hourly rate", text: text, prompt: Text("0"))
                    .labelsHidden()
                    .multilineTextAlignment(.trailing)
                    .monospacedDigit()
                    .focused($rateFocused)
                    #if os(iOS)
                    .keyboardType(.decimalPad)
                    #else
                    .frame(maxWidth: 120)
                    #endif
                    .accessibilityIdentifier("hourlyRate")
                Text("\(Money.unitLabel(currency)) / h").foregroundStyle(.secondary)
            }
        }
    }

    private func currencyPicker(_ code: Binding<String>) -> some View {
        Picker("Currency", selection: code) {
            ForEach(Money.options(including: code.wrappedValue), id: \.code) { Text($0.label).tag($0.code) }
        }
    }

    @ViewBuilder private func totals(rate: Double?, currency: String) -> some View {
        let minutes = BillingMath.trackedMinutes(task.events)
        LabeledContent("Tracked", value: Fmt.durationMinutes(Double(minutes))).monospacedDigit()
        if let rate {
            let estimate = task.events.reduce(0.0) { $0 + BillingMath.earnings(minutes: BillingMath.durationMinutes(from: $1.from, to: $1.to), rate: rate) }
            LabeledContent("Estimated at this rate", value: Money.format(estimate, currency)).monospacedDigit()
        }
    }

    static func rateString(_ r: Double) -> String {
        r == r.rounded() ? String(Int64(r)) : String(r)
    }

    private func load() async {
        do { loaded = try await model.api.billingTasks(); loadFailed = false }
        catch { if loaded == nil { loadFailed = true } }
    }

    private func changed() async {
        if rows == nil { await load() }
        onChanged?()
    }

    private func enroll() {
        let n = Money.parseAmount(draftRate) ?? 0
        busy = true; error = nil
        Task {
            do { _ = try await model.api.enrollBilling(taskId: task.id, hourlyRate: max(0, n), currency: draftCurrency); await changed() }
            catch let e as APIError { error = e.message } catch {}
            busy = false
        }
    }

    private func saveRate(_ b: BillingTaskRow) {
        guard let n = Money.parseAmount(rateText), n >= 0, n != b.hourlyRate else { return }
        error = nil
        Task {
            do { _ = try await model.api.updateBilling(id: b.id, hourlyRate: n); await changed() }
            catch let e as APIError { error = e.message } catch {}
        }
    }

    private func patch(_ b: BillingTaskRow, currency: String) {
        guard currency != b.currency else { return }
        error = nil
        Task {
            do { _ = try await model.api.updateBilling(id: b.id, currency: currency); await changed() }
            catch let e as APIError { error = e.message } catch {}
        }
    }

    private func remove() {
        guard let b = billing else { return }
        error = nil
        Task {
            do { try await model.api.removeBilling(id: b.id); await changed() }
            catch let e as APIError { error = e.message } catch {}
        }
    }
}

