import SwiftUI
import TrackifyKit

// MARK: - Sessions ledger (billing-page.tsx ledger panel, session-ledger.tsx, session-row.tsx)

/// A batch of sessions to mark as paid.
struct MarkPaidBatch: Identifiable {
    let id = UUID()
    let rows: [BillingSessionRow]
}

struct BillingSessionsView: View {
    @Environment(AppModel.self) private var model
    @Bindable var store: BillingStore
    var onGoRates: (() -> Void)? = nil

    @State private var markPaid: MarkPaidBatch?
    @State private var showCalendar = false
    #if os(iOS)
    @State private var editMode: EditMode = .inactive
    @Environment(\.dynamicTypeSize) private var typeSize
    private var editing: Bool { editMode.isEditing }
    #endif

    private var sections: [BillingMath.Section] { BillingMath.sections(store.sessions, by: store.groupBy) }
    private var selection: BillingMath.SelectionSummary { BillingMath.summary(store.selectedSessions) }
    private var canSelect: Bool { store.status != .paid && !store.unpaidInList.isEmpty }

    var body: some View {
        platformBody
            .task(id: store.sessionsKey) { await store.filtersChanged(model.api) }
            .task(id: model.dataTick) { await store.load(tick: model.dataTick, api: model.api) }
            .sheet(item: $markPaid) { batch in
                MarkPaidSheet(sessions: batch.rows) {
                    #if os(iOS)
                    editMode = .inactive
                    #endif
                    Task { await store.afterPaymentChange(model.api) }
                }
            }
            .sheet(isPresented: $showCalendar) {
                BillingCalendarSheet(store: store)
            }
    }

    private func openMarkPaid(_ rows: [BillingSessionRow]) {
        let unpaid = rows.filter { !$0.isPaid }
        guard !unpaid.isEmpty, Set(unpaid.map(\.currency)).count == 1 else { return }
        markPaid = MarkPaidBatch(rows: unpaid)
    }

    // MARK: Shared states

    @ViewBuilder private var stateView: some View {
        if store.billingTasks == nil, let err = store.billingTasksError {
            ContentUnavailableView("Couldn't Load Billing", systemImage: "exclamationmark.triangle", description: Text(err))
        } else if store.billingTasks != nil && !store.hasEnrolled {
            ContentUnavailableView {
                Label("No Billable Tasks", systemImage: "tag")
            } description: {
                Text("Give at least one task an hourly rate under Rates, then come back here.")
            } actions: {
                if let onGoRates { Button("Open Rates", action: onGoRates) }
            }
        } else if let err = store.sessionsError {
            ContentUnavailableView("Couldn't Load Sessions", systemImage: "exclamationmark.triangle", description: Text(err))
        } else if store.sessionsLoading || store.billingTasks == nil {
            ProgressView()
        } else {
            ContentUnavailableView("No Sessions", systemImage: "clock",
                                   description: Text("No sessions in this range. Try another filter or enroll a task."))
        }
    }

    private var showsList: Bool {
        store.hasEnrolled && !store.sessionsLoading && store.sessionsError == nil && !store.sessions.isEmpty
    }

    private var filterSummary: String {
        var parts = [store.period.label.replacingOccurrences(of: "…", with: ""), store.status.label]
        if store.groupFilter != "all" { parts.append(store.groupOptions.first { $0.0 == store.groupFilter }?.1 ?? "") }
        if store.taskFilter != "all" { parts.append(store.taskOptions.first { $0.0 == store.taskFilter }?.1 ?? "") }
        parts.append("by \(store.groupBy.label.lowercased())")
        return parts.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    // MARK: iPhone / iPad

    #if os(iOS)
    private var platformBody: some View {
        List(selection: $store.selected) {
            Section {
                if store.period == .custom {
                    DatePicker("From", selection: $store.customFrom, displayedComponents: .date)
                    DatePicker("To", selection: $store.customTo, in: store.customFrom..., displayedComponents: .date)
                }
            } header: {
                Text(filterSummary).textCase(nil)
            }
            if showsList {
                ForEach(sections) { section in
                    Section {
                        ForEach(section.rows) { row in
                            NavigationLink(value: row) {
                                BillingSessionCell(row: row, stacked: typeSize.isAccessibilitySize)
                            }
                            .selectionDisabled(row.isPaid)
                            .swipeActions(edge: .leading) {
                                if !row.isPaid {
                                    Button { openMarkPaid([row]) } label: { Label("Mark Paid", systemImage: "checkmark.circle") }
                                        .tint(.green)
                                }
                            }
                            .contextMenu { rowMenu(row) }
                        }
                    } header: {
                        sectionHeader(section)
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .listSectionSpacing(.compact)
        .overlay { if !showsList { stateView } }
        .environment(\.editMode, $editMode)
        .navigationTitle("Sessions")
        .navigationBarTitleDisplayMode(.inline)
        .navigationBarBackButtonHidden(editing)
        .navigationDestination(for: BillingSessionRow.self) { row in
            BillingSessionDetail(row: row, onMarkPaid: { openMarkPaid([row]) })
        }
        .toolbar(editing ? .hidden : .automatic, for: .tabBar)
        .toolbar { iosToolbar }
        .refreshable { await store.loadAll(model.api) }
        .onChange(of: editMode) { _, m in if !m.isEditing { store.selected = [] } }
        .onChange(of: store.unpaidInList.isEmpty) { _, empty in if empty { editMode = .inactive } }
    }

    @ToolbarContentBuilder private var iosToolbar: some ToolbarContent {
        if editing {
            ToolbarItem(placement: .topBarLeading) {
                Button(store.allUnpaidSelected ? "Deselect All" : "Select All") { store.toggleAllUnpaid() }
                    .accessibilityIdentifier("selectAllUnpaid")
            }
            ToolbarItem(placement: .topBarTrailing) {
                Button("Done") { editMode = .inactive }.fontWeight(.semibold)
            }
            if !store.selectedSessions.isEmpty {
                ToolbarItemGroup(placement: .bottomBar) {
                    if selection.multipleCurrencies {
                        Text("Select one currency").font(.footnote).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { openMarkPaid(store.selectedSessions) } label: {
                        Text("Mark as Paid (\(selection.count) · \(selection.byCurrency.map { Money.format($0.1, $0.0) }.joined(separator: " · ")))")
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(selection.multipleCurrencies)
                    .accessibilityIdentifier("billingMarkPaid")
                }
            }
        } else {
            ToolbarItemGroup(placement: .topBarTrailing) {
                BillingFilterMenu(store: store, onCalendar: { showCalendar = true })
                Button("Select") { editMode = .active }
                    .disabled(!canSelect || !showsList)
                    .accessibilityIdentifier("billingSelect")
            }
        }
    }

    private func sectionHeader(_ section: BillingMath.Section) -> some View {
        let ids = section.rows.filter { !$0.isPaid }.map(\.id)
        let allSelected = !ids.isEmpty && ids.allSatisfy { store.selected.contains($0) }
        let unpaid = section.unpaidByCurrency.map { Money.format($0.1, $0.0) }.joined(separator: " · ")
        return HStack(alignment: .firstTextBaseline) {
            VStack(alignment: .leading, spacing: 1) {
                Text(store.groupBy.title(section.key))
                Text(Fmt.durationMinutes(Double(section.totalMinutes)) + (unpaid.isEmpty ? "" : " · \(unpaid) unpaid"))
                    .monospacedDigit()
                    .fontWeight(.regular)
            }
            Spacer()
            if editing && !ids.isEmpty {
                Button(allSelected ? "Deselect" : "Select") { store.setSelected(ids, !allSelected) }
                    .font(.subheadline)
                    .accessibilityLabel("\(allSelected ? "Deselect" : "Select") unpaid in \(store.groupBy.title(section.key))")
            }
        }
        .textCase(nil)
    }

    @ViewBuilder private func rowMenu(_ row: BillingSessionRow) -> some View {
        if !row.isPaid {
            Button { openMarkPaid([row]) } label: { Label("Mark as Paid…", systemImage: "checkmark.circle") }
            Button {
                editMode = .active
                store.selected.insert(row.id)
            } label: { Label("Select", systemImage: "checkmark.circle.badge.plus") }
        }
    }
    #endif

    // MARK: Mac

    #if os(macOS)
    private var macSelection: Binding<Set<String>> {
        Binding(get: { store.selected }, set: { ids in
            let unpaid = Set(store.unpaidInList.map(\.id))
            store.selected = ids.intersection(unpaid)
        })
    }

    private var platformBody: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 12) {
                BillingSummaryStrip(summary: store.summary)
                Spacer(minLength: 12)
                if store.period == .custom {
                    DatePicker("From", selection: $store.customFrom, displayedComponents: .date)
                        .fixedSize()
                    DatePicker("To", selection: $store.customTo, in: store.customFrom..., displayedComponents: .date)
                        .fixedSize()
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 10)
            Divider()
            if showsList {
                table
            } else {
                stateView.frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Divider()
            macStatusBar
        }
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                BillingFilterMenu(store: store, onCalendar: { showCalendar = true })
            }
        }
    }

    private var table: some View {
        Table(of: BillingSessionRow.self, selection: macSelection) {
            TableColumn("Task") { r in
                HStack(spacing: 6) {
                    Circle().fill(Color(hex: r.accentHex)).frame(width: 8, height: 8)
                    Text(r.taskName).lineLimit(1)
                }
                .foregroundStyle(r.isPaid ? .secondary : .primary)
            }
            .width(min: 140, ideal: 220)
            TableColumn("Group") { r in
                Text(r.taskGroup?.name ?? "—").foregroundStyle(.secondary).lineLimit(1)
            }
            .width(min: 70, ideal: 120)
            TableColumn("Date") { r in
                Text(DayCalc.current.format(r.from, "EEE, MMM d")).monospacedDigit()
            }
            .width(min: 80, ideal: 100)
            TableColumn("Time") { r in Text(r.clockRange).monospacedDigit() }
                .width(min: 80, ideal: 96)
            TableColumn("Duration") { r in
                Text(Fmt.durationMinutes(Double(r.durationMinutes))).monospacedDigit()
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 60, ideal: 72)
            TableColumn("Amount") { r in
                Text(Money.format(r.earnings, r.currency)).monospacedDigit()
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 80, ideal: 100)
            TableColumn("Status") { r in
                if r.isPaid {
                    Text(r.paymentPaidAt.map { "Paid \(DayCalc.current.format($0, "MMM d"))" } ?? "Paid").foregroundStyle(.secondary)
                } else {
                    Text("Unpaid")
                }
            }
            .width(min: 70, ideal: 90)
        } rows: {
            ForEach(sections) { section in
                Section {
                    ForEach(section.rows) { TableRow($0) }
                } header: {
                    HStack {
                        Text(store.groupBy.title(section.key))
                        Spacer()
                        Text(sectionTotals(section)).foregroundStyle(.secondary).monospacedDigit()
                    }
                }
            }
        }
        .contextMenu(forSelectionType: String.self) { ids in
            let rows = store.sessions.filter { ids.contains($0.id) && !$0.isPaid }
            if !rows.isEmpty {
                Button("Mark as Paid…") { openMarkPaid(rows) }
                    .disabled(Set(rows.map(\.currency)).count > 1)
            }
            if ids.count == 1, let r = store.sessions.first(where: { ids.contains($0.id) }) {
                Button("Open Task") { NavigationState.shared.open(.task(r.taskId)) }
            }
        } primaryAction: { ids in
            let rows = store.sessions.filter { ids.contains($0.id) && !$0.isPaid }
            if !rows.isEmpty { openMarkPaid(rows) }
        }
    }

    private func sectionTotals(_ s: BillingMath.Section) -> String {
        let unpaid = s.unpaidByCurrency.map { Money.format($0.1, $0.0) }.joined(separator: " · ")
        return Fmt.durationMinutes(Double(s.totalMinutes)) + (unpaid.isEmpty ? "" : " · \(unpaid) unpaid")
    }

    private var macStatusBar: some View {
        HStack(spacing: 12) {
            Text(statusText)
                .foregroundStyle(selection.multipleCurrencies ? Color.red : Color.secondary)
                .monospacedDigit()
                .lineLimit(1)
            Spacer()
            if canSelect && showsList {
                Button(store.allUnpaidSelected ? "Deselect All" : "Select All Unpaid (\(store.unpaidInList.count))") {
                    store.toggleAllUnpaid()
                }
                .accessibilityIdentifier("selectAllUnpaid")
            }
            Button("Mark as Paid…") { openMarkPaid(store.selectedSessions) }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.defaultAction)
                .accessibilityIdentifier("billingMarkPaid")
                .disabled(store.selectedSessions.isEmpty || selection.multipleCurrencies)
        }
        .controlSize(.small)
        .font(.callout)
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
    }

    private var statusText: String {
        if selection.count > 0 {
            return selection.multipleCurrencies
                ? "\(selection.line) — select one currency to mark as paid"
                : "\(selection.line) selected"
        }
        if store.status == .paid { return "\(filterSummary) — paid sessions can't be selected" }
        let n = store.unpaidInList.count
        return "\(filterSummary) — \(n) unpaid session\(n == 1 ? "" : "s")"
    }
    #endif
}

// MARK: - Filters (billing-filters.tsx) as one toolbar menu

struct BillingFilterMenu: View {
    @Bindable var store: BillingStore
    var onCalendar: () -> Void

    private var active: Bool {
        store.period != .thisMonth || store.status != .unpaid || store.groupFilter != "all" || store.taskFilter != "all"
    }

    var body: some View {
        Menu {
            Picker("Period", selection: $store.period) {
                ForEach(BillingMath.Period.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.menu)
            Picker("Status", selection: $store.status) {
                ForEach(BillingMath.Status.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.menu)
            Picker("Group", selection: Binding(get: { store.groupFilter }, set: { store.setGroupFilter($0) })) {
                ForEach(store.groupOptions, id: \.0) { Text($0.1).tag($0.0) }
            }
            .pickerStyle(.menu)
            Picker("Task", selection: $store.taskFilter) {
                ForEach(store.taskOptions, id: \.0) { Text($0.1).tag($0.0) }
            }
            .pickerStyle(.menu)
            Picker("Group By", selection: $store.groupBy) {
                ForEach(BillingMath.GroupBy.allCases, id: \.self) { Text($0.label).tag($0) }
            }
            .pickerStyle(.menu)
            Divider()
            Button(action: onCalendar) { Label("Activity Calendar", systemImage: "calendar") }
            if active {
                Button {
                    store.period = .thisMonth
                    store.status = .unpaid
                    store.setGroupFilter("all")
                } label: { Label("Reset Filters", systemImage: "arrow.counterclockwise") }
            }
        } label: {
            Label("Filter", systemImage: active ? "line.3.horizontal.decrease.circle.fill" : "line.3.horizontal.decrease.circle")
        }
        .help("Filter and group sessions")
        .accessibilityIdentifier("billingFilters")
    }
}

// MARK: - Session cell (iPhone / iPad)

struct BillingSessionCell: View {
    let row: BillingSessionRow
    var stacked = false

    var body: some View {
        let layout = stacked ? AnyLayout(VStackLayout(alignment: .leading, spacing: 4))
                             : AnyLayout(HStackLayout(alignment: .firstTextBaseline, spacing: 8))
        layout {
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Circle().fill(Color(hex: row.accentHex)).frame(width: 8, height: 8)
                        .alignmentGuide(.firstTextBaseline) { d in d[.bottom] - 1 }
                    Text(row.taskName).lineLimit(2)
                }
                Text([row.clockRange, row.taskGroup?.name].compactMap { $0 }.joined(separator: " · "))
                    .font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
                if row.isPaid {
                    Label(row.paymentPaidAt.map { "Paid \(DayCalc.current.format($0, "MMM d"))" } ?? "Paid", systemImage: "checkmark.seal")
                        .font(.footnote).foregroundStyle(.secondary)
                }
            }
            if !stacked { Spacer(minLength: 8) }
            VStack(alignment: stacked ? .leading : .trailing, spacing: 2) {
                Text(Money.format(row.earnings, row.currency)).monospacedDigit()
                Text(Fmt.durationMinutes(Double(row.durationMinutes)))
                    .font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Session detail

struct BillingSessionDetail: View {
    let row: BillingSessionRow
    var onMarkPaid: () -> Void

    var body: some View {
        Form {
            Section {
                LabeledContent("Task") {
                    HStack(spacing: 6) {
                        Circle().fill(Color(hex: row.accentHex)).frame(width: 8, height: 8)
                        Text(row.taskName)
                    }
                }
                LabeledContent("Group", value: row.taskGroup?.name ?? "Ungrouped")
            }
            Section {
                LabeledContent("Session", value: BillingMath.sessionRange(from: row.from, to: row.to))
                LabeledContent("Duration", value: Fmt.durationMinutes(Double(row.durationMinutes)))
                LabeledContent("Rate", value: "\(Money.format(row.hourlyRate, row.currency)) / h")
                LabeledContent("Amount", value: Money.format(row.earnings, row.currency))
                LabeledContent("Status", value: row.isPaid
                               ? (row.paymentPaidAt.map { "Paid \(DayCalc.current.format($0, "MMM d, yyyy · HH:mm"))" } ?? "Paid")
                               : "Unpaid")
            }
            .monospacedDigit()
            Section {
                if !row.isPaid {
                    Button("Mark as Paid…", action: onMarkPaid)
                }
                NavigationLink("Open Task", value: Route.task(row.taskId))
            }
        }
        .formStyle(.grouped)
        .navigationTitle(row.taskName)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

// MARK: - Activity calendar (calendar-heatmap.tsx, the "(optional)" details)

struct BillingCalendarSheet: View {
    var store: BillingStore
    @Environment(\.dismiss) private var dismiss

    private var blurb: String {
        let base = "Billable time for the current filters. Tap a day to show just that day in Sessions."
        if let end = store.calendarEnd { return base + " Shown through \(DayCalc.current.format(end, "MMM d, yyyy"))." }
        return base
    }

    /// First session per task name decides its colour (group accent or task accent).
    private var taskColors: [String: String] {
        var m: [String: String] = [:]
        for s in store.sessions where m[s.taskName] == nil { m[s.taskName] = s.accentHex }
        return m
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    if store.sessionsLoading {
                        ProgressView().frame(maxWidth: .infinity)
                    } else {
                        let data = YearlyCalendarData.fromBilling(store.sessions, calendarEndDay: store.calendarEnd)
                        let colors = taskColors
                        YearlyCalendarView(
                            data: data,
                            taskColors: colors,
                            detail: { day, minutes, key, taskMinutes in
                                AnyView(BillingCalendarDetail(
                                    day: day, minutes: minutes,
                                    earnings: data.billingDayEarnings?[key] ?? 0,
                                    currency: data.billingDayCurrency?[key] ?? Money.defaultCurrency,
                                    taskMinutes: taskMinutes, colors: colors))
                            },
                            onDayTap: { _, day in
                                store.filterToDay(day)
                                dismiss()
                            })
                        .padding(.vertical, 6)
                    }
                } footer: { Group {
                    Text(blurb)
                }.billingFooter() }
            }
            .formStyle(.grouped)
            .navigationTitle("Activity Calendar")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } }
            }
        }
        #if os(macOS)
        .frame(minWidth: 760, minHeight: 360)
        #else
        .presentationDetents([.medium, .large])
        #endif
    }
}

private struct BillingCalendarDetail: View {
    let day: Date
    let minutes: Double
    let earnings: Double
    let currency: String
    let taskMinutes: [String: Double]
    let colors: [String: String]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(DayCalc.current.format(day, "EEEE, MMMM d, yyyy")).font(.subheadline.weight(.semibold))
            Text("\(Fmt.heatMinutes(minutes)) · \(Money.format(earnings, currency))")
                .font(.footnote.weight(.medium)).monospacedDigit()
            ForEach(taskMinutes.sorted { $0.value > $1.value }, id: \.key) { entry in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Circle().fill(Color(hex: colors[entry.key] ?? Accent.otherHex)).frame(width: 7, height: 7)
                    Text(entry.key).fontWeight(.medium)
                    Text(Fmt.heatMinutes(entry.value)).foregroundStyle(.secondary)
                }
                .font(.footnote)
            }
            Text("Tap to show this day in Sessions").font(.caption2).foregroundStyle(.secondary)
        }
    }
}
