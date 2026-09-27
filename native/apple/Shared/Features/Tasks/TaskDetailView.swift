import SwiftUI
import TrackifyKit

/// `/tasks/:id` (WEB_AUDIT §1.6) + native extras: edit/delete time entries.
struct TaskDetailView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let taskId: String

    @State private var editingName = false
    @State private var nameDraft = ""
    @State private var renameError: String?
    @State private var confirmHide = false
    @State private var showAllDays = false
    @State private var editing: TimeEvent?
    @State private var loggingPast = false
    @FocusState private var nameFocused: Bool

    var body: some View {
        Group {
            #if os(iOS)
            phoneList
            #else
            scrollContent
            #endif
        }
        .background(Theme.background)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .navigationTitle(model.task(taskId)?.name ?? "Task")
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

    private var scrollContent: some View {
        ScrollView {
            if let task = model.task(taskId) {
                VStack(alignment: .leading, spacing: 16) {
                    headerCard(task)
                    entriesCard(task)
                    TaskBillingPanel(task: task)
                }
                .padding(16)
                .frame(maxWidth: 896)
                .frame(maxWidth: .infinity)
            } else {
                VStack(spacing: 12) {
                    Text("Task not found").font(.scaled(18, weight: .semibold))
                    Button("Back") { dismiss() }.buttonStyle(.t(.outline))
                }
                .padding(.top, 80)
                .frame(maxWidth: .infinity)
            }
        }
    }

    #if os(iOS)
    // MARK: iPhone / iPad: a plain grouped list

    private var phoneList: some View {
        List {
            if let task = model.task(taskId) {
                let isRunning = model.running?.taskId == task.id
                Section {
                    nameField(task)
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
                Section {
                    Button { model.toggle(task.id) } label: {
                        Label(isRunning ? "Stop" : "Start", systemImage: isRunning ? "stop.fill" : "play.fill")
                    }
                    .foregroundStyle(isRunning ? Theme.destructive : Theme.foreground)
                    Button { loggingPast = true } label: { Label("Log past time", systemImage: "clock.arrow.circlepath") }
                        .foregroundStyle(Theme.foreground)
                }
                entrySections(task)
                Section("Billing") { TaskBillingPanel(task: task).padding(.vertical, 4) }
                Section {
                    Button(role: .destructive) { confirmHide = true } label: { Label("Hide task", systemImage: "eye.slash") }
                }
            } else {
                Text("Task not found").foregroundStyle(Theme.mutedForeground)
            }
        }
        .listStyle(.insetGrouped)
    }

    @ViewBuilder private func nameField(_ task: TrackifyTask) -> some View {
        if editingName {
            TextField("Task name", text: $nameDraft)
                .font(.title3.weight(.semibold))
                .focused($nameFocused)
                .submitLabel(.done)
                .onSubmit { commitRename(task) }
                .onChange(of: nameFocused) { _, f in if !f && editingName { commitRename(task) } }
                .accessibilityIdentifier("renameField")
        } else {
            Button {
                nameDraft = task.name
                editingName = true
                nameFocused = true
            } label: {
                HStack {
                    Text(task.name).font(.title3.weight(.semibold)).foregroundStyle(Theme.foreground).multilineTextAlignment(.leading)
                    Spacer()
                    Image(systemName: "pencil").foregroundStyle(Theme.mutedForeground)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Rename")
            .accessibilityIdentifier("taskName")
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
    #endif

    private func headerCard(_ task: TrackifyTask) -> some View {
        let isRunning = model.running?.taskId == task.id
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                if editingName {
                    TextField("Task name", text: $nameDraft)
                        .textFieldStyle(.plain)
                        .font(.scaled(22, weight: .bold))
                        .focused($nameFocused)
                        .onSubmit { commitRename(task) }
                        .onChange(of: nameFocused) { _, f in if !f && editingName { commitRename(task) } }
                        #if os(macOS)
                        .onExitCommand { editingName = false }
                        #endif
                        .accessibilityIdentifier("renameField")
                } else {
                    Button {
                        nameDraft = task.name
                        editingName = true
                        nameFocused = true
                    } label: {
                        Text(task.name).font(.scaled(22, weight: .bold)).multilineTextAlignment(.leading)
                            .foregroundStyle(Theme.foreground)
                    }
                    .buttonStyle(.plain)
                    .help("Click to rename")
                    .accessibilityHint("Rename")
                    .accessibilityIdentifier("taskName")
                }
                Spacer()
                Button { confirmHide = true } label: { Image(systemName: "eye.slash") }
                    .buttonStyle(.t(.outline, .icon))
                    .help("Hide task")
                    .accessibilityLabel("Hide task")
            }
            InlineError(text: renameError)
            if let g = task.taskGroup { AccentBadge(text: g.name, hex: g.accentHex) }
            HStack(spacing: 8) {
                Button { model.toggle(task.id) } label: {
                    Label(isRunning ? "Stop" : "Start", systemImage: isRunning ? "square.fill" : "play.fill")
                }
                .buttonStyle(.t(isRunning ? .destructive : .primary))
                Button { loggingPast = true } label: { Label("Log past time", systemImage: "plus") }
                    .buttonStyle(.t(.outline))
            }
        }
        .card(padding: 20)
    }

    private func commitRename(_ task: TrackifyTask) {
        let n = nameDraft.trimmingCharacters(in: .whitespaces)
        editingName = false
        guard !n.isEmpty, n != task.name else { return }
        renameError = nil
        Task {
            do { try await model.rename(task.id, to: n) } catch let e as APIError { renameError = e.message } catch {}
        }
    }

    private func entriesCard(_ task: TrackifyTask) -> some View {
        let calc = DayCalc.current
        let days = Dictionary(grouping: task.events) { calc.dayKey($0.from) }
            .map { (key: $0.key, events: $0.value.sorted { $0.from > $1.from }) }
            .sorted { $0.key > $1.key }
        let shown = showAllDays ? days : Array(days.prefix(5))
        return VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 32) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Total Time").font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        let live = model.running?.taskId == task.id ? max(0, ctx.date.ms - (model.running?.startTime ?? 0)) : 0
                        Text(Fmt.durationWords(task.totalMs + live)).font(.scaled(24, weight: .bold)).tabular()
                    }
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("Tracking Sessions").font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
                    Text("\(task.events.count)").font(.scaled(24, weight: .bold)).tabular()
                }
            }
            Hairline()
            Text("Time Entries").font(.cardTitle)
            if days.isEmpty {
                Text("No time entries yet.").font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
            }
            ForEach(shown, id: \.key) { day in
                VStack(alignment: .leading, spacing: 6) {
                    HStack {
                        Text(dayLabel(day.key)).font(.scaled(14, weight: .semibold))
                        Spacer()
                        Text("\(Fmt.durationWords(day.events.reduce(0) { $0 + $1.durationMs })) total")
                            .font(.scaled(13)).foregroundStyle(Theme.mutedForeground).tabular()
                    }
                    ForEach(day.events) { e in
                        entryRow(e)
                    }
                }
            }
            if days.count > 5 {
                Button(showAllDays ? "Show Less" : "Show \(days.count - 5) More Days") {
                    withAnimation { showAllDays.toggle() }
                }
                .buttonStyle(.t(.ghost, .md, full: true))
            }
        }
        .card(padding: 20)
    }

    private func entryRow(_ e: TimeEvent) -> some View {
        let calc = DayCalc.current
        return HStack {
            Text("\(calc.format(e.from, "h:mm a")) → \(calc.format(e.to, "h:mm a"))").font(.scaled(14)).tabular()
            if e.paymentRecordId != nil {
                Text("Paid").font(.scaled(11, weight: .semibold)).foregroundStyle(Theme.mutedForeground)
            }
            Spacer()
            Badge(text: Fmt.durationWords(e.durationMs), kind: .secondary, mono: true)
            Menu {
                Button { editing = e } label: { Label("Edit", systemImage: "pencil") }
                Button(role: .destructive) { Task { try? await model.deleteEvent(e.id) } } label: { Label("Delete", systemImage: "trash") }
            } label: {
                Image(systemName: "ellipsis").font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
                    .frame(width: 32, height: 32).contentShape(Rectangle())
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .fixedSize()
            .accessibilityLabel("Entry actions")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Theme.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
        .contentShape(Rectangle())
        .onTapGesture { editing = e }
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

// MARK: - Billing & rates panel (shared by task detail + Billing → Rates)

struct TaskBillingPanel: View {
    @Environment(AppModel.self) private var model
    let task: TrackifyTask
    var compact = false
    /// Provided by the Rates tab (which already loaded the rows); otherwise the panel fetches.
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
    private var accent: String { task.accentHex }

    var body: some View {
        Group {
            if rows == nil && loaded == nil && !loadFailed {
                VStack(alignment: .leading, spacing: 10) { Skeleton(height: 20, width: 160); Skeleton(height: 40); Skeleton(height: 80) }.card()
            } else if loadFailed && rows == nil {
                Text("Could not load billing settings for this task.").font(.scaled(14)).foregroundStyle(Theme.destructive).card()
            } else {
                panel
            }
        }
        .task(id: model.dataTick) { if rows == nil { await load() } }
        .confirmationDialog("Remove this task from billing? Paid history stays linked to past sessions.", isPresented: $confirmRemove, titleVisibility: .visible) {
            Button("Remove", role: .destructive) { remove() }
        }
    }

    private var panel: some View {
        let minutes = BillingMath.trackedMinutes(task.events)
        let estimate: Double? = billing.map { b in task.events.reduce(0) { $0 + BillingMath.earnings(minutes: BillingMath.durationMinutes(from: $1.from, to: $1.to), rate: b.hourlyRate) } }
        return VStack(alignment: .leading, spacing: 14) {
            if !compact {
                HStack(alignment: .top) {
                    VStack(alignment: .leading, spacing: 4) {
                        Label("Billing & rates", systemImage: "dollarsign.circle").font(.cardTitle)
                        Text("Same settings as Billing → Rates. Changes apply to unpaid sessions on the Sessions tab.")
                            .font(.scaled(13)).foregroundStyle(Theme.mutedForeground)
                    }
                    Spacer()
                }
            } else {
                Text(task.name).font(.scaled(15, weight: .semibold))
            }
            HStack(spacing: 6) {
                if let g = task.taskGroup { AccentBadge(text: g.name, hex: g.accentHex) } else { Badge(text: "Ungrouped") }
                if billing != nil { Badge(text: "Billing on", kind: .primary) } else { Badge(text: "Not billing", kind: .outline) }
            }
            if compact {
                Text("Tracked \(Fmt.durationMinutes(Double(minutes))) · Est. \(billing != nil && estimate != nil ? Money.format(estimate!, billing!.currency) : "—") at current rate")
                    .font(.scaled(13)).foregroundStyle(Theme.mutedForeground).tabular()
            } else {
                HStack(spacing: 24) {
                    stat("Tracked time", Fmt.durationMinutes(Double(minutes)))
                    stat("Est. at current rate", billing != nil && estimate != nil ? Money.format(estimate!, billing!.currency) : "—")
                    Spacer()
                }
            }
            VStack(alignment: .leading, spacing: 12) {
                if let b = billing {
                    HStack {
                        Text("RATE & RULES").font(.label11).tracking(0.6).foregroundStyle(Theme.mutedForeground)
                        Spacer()
                        Button { confirmRemove = true } label: { Image(systemName: "trash").foregroundStyle(Theme.destructive) }
                            .buttonStyle(.plain).frame(width: 32, height: 32).help("Remove from billing")
                            .accessibilityLabel("Remove from billing")
                    }
                    HStack(alignment: .bottom, spacing: 12) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("HOURLY RATE").font(.label11).tracking(0.6).foregroundStyle(Theme.mutedForeground)
                            TField(placeholder: "0", text: $rateText)
                                .focused($rateFocused)
                                #if os(iOS)
                                .keyboardType(.decimalPad)
                                #endif
                                .onSubmit { saveRate(b) }
                                .onChange(of: rateFocused) { _, f in if !f { saveRate(b) } }
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            Text("CURRENCY").font(.label11).tracking(0.6).foregroundStyle(Theme.mutedForeground)
                            CurrencyPicker(code: Binding(get: { b.currency }, set: { c in patch(b, currency: c) }))
                        }
                    }
                    .onAppear { rateText = Self.rateString(b.hourlyRate) }
                    .onChange(of: b.hourlyRate) { _, r in rateText = Self.rateString(r) }
                } else {
                    Text("Add an hourly rate to include this task in Billing sessions and payment history.")
                        .font(.scaled(13)).foregroundStyle(Theme.mutedForeground)
                    HStack(alignment: .bottom, spacing: 10) {
                        VStack(alignment: .leading, spacing: 6) {
                            Text("HOURLY RATE").font(.label11).tracking(0.6).foregroundStyle(Theme.mutedForeground)
                            TField(placeholder: "50", text: $draftRate)
                                #if os(iOS)
                                .keyboardType(.decimalPad)
                                #endif
                                .frame(maxWidth: 120)
                        }
                        VStack(alignment: .leading, spacing: 6) {
                            Text("CURRENCY").font(.label11).tracking(0.6).foregroundStyle(Theme.mutedForeground)
                            CurrencyPicker(code: $draftCurrency)
                        }
                        Spacer(minLength: 0)
                    }
                    Button(busy ? "Adding…" : "Add to billing", action: enroll)
                        .buttonStyle(.t(.primary, .md, full: true)).disabled(busy)
                }
                InlineError(text: error)
            }
            .padding(12)
            .background(Theme.muted.opacity(0.35), in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Theme.border))
        }
        .padding(compact ? 14 : 20)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: accent, opacity: billing != nil ? (compact ? 0.05 : 0.04) : (compact ? 0.08 : 0.06)), in: RoundedRectangle(cornerRadius: Theme.cardRadius))
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius))
        .overlay(alignment: .leading) {
            UnevenRoundedRectangle(topLeadingRadius: Theme.cardRadius, bottomLeadingRadius: Theme.cardRadius).fill(Color(hex: accent)).frame(width: 3)
        }
        .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius).strokeBorder(Theme.border))
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label).font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
            Text(value).font(.scaled(18, weight: .semibold)).tabular()
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
        Task {
            do { _ = try await model.api.updateBilling(id: b.id, hourlyRate: n); await changed() }
            catch let e as APIError { error = e.message } catch {}
        }
    }

    private func patch(_ b: BillingTaskRow, currency: String) {
        guard currency != b.currency else { return }
        Task {
            do { _ = try await model.api.updateBilling(id: b.id, currency: currency); await changed() }
            catch let e as APIError { error = e.message } catch {}
        }
    }

    private func remove() {
        guard let b = billing else { return }
        Task {
            do { try await model.api.removeBilling(id: b.id); await changed() }
            catch let e as APIError { error = e.message } catch {}
        }
    }
}

struct CurrencyPicker: View {
    @Binding var code: String
    var body: some View {
        Menu {
            ForEach(Money.options(including: code), id: \.code) { o in
                Button { code = o.code } label: {
                    if o.code == code { Label(o.label, systemImage: "checkmark") } else { Text(o.label) }
                }
            }
        } label: {
            HStack {
                Text(Money.options(including: code).first { $0.code == code }?.label ?? code).lineLimit(1)
                Spacer(minLength: 6)
                Image(systemName: "chevron.up.chevron.down").font(.scaled(11)).foregroundStyle(Theme.mutedForeground)
            }
            .font(.scaled(14))
            .foregroundStyle(Theme.foreground)
            .padding(.horizontal, 12)
            .frame(minWidth: 150, minHeight: 40)
            .background(Theme.background, in: RoundedRectangle(cornerRadius: Theme.controlRadius))
            .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius).strokeBorder(Theme.border))
        }
        .menuStyle(.button)
            .buttonStyle(.plain)
        .menuIndicator(.hidden)
        .accessibilityLabel("Currency")
    }
}
