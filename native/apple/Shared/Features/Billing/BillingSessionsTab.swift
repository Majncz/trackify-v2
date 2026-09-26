import SwiftUI
import TrackifyKit

// MARK: - Sessions tab (billing-page.tsx ledger panel, session-ledger.tsx, session-row.tsx)

struct BillingSessionsTab: View {
    var store: BillingStore
    var wide: Bool
    var onGoRates: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if store.billingTasks == nil {
                if let err = store.billingTasksError {
                    Text(err).font(.scaled(14)).foregroundStyle(Theme.destructive)
                } else {
                    VStack(spacing: 10) {
                        Skeleton(height: 90)
                        Skeleton(height: 160)
                    }
                }
            } else if store.hasEnrolled {
                sessionsCard
                BillingActivityCalendar(store: store, onGoRates: onGoRates)
            } else {
                noTasksCard
            }
        }
    }

    private var sessionsCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Sessions").font(.cardTitle).foregroundStyle(Theme.foreground)
                Text("Billable time (rates below). List is the focus — use the compact bar to select payouts.")
                    .font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            BillingFiltersBar(store: store, wide: wide)
            ledger
        }
        .card()
    }

    @ViewBuilder
    private var ledger: some View {
        if store.sessionsLoading {
            Skeleton(height: 160)
        } else if let err = store.sessionsError {
            Text(err).font(.scaled(14)).foregroundStyle(Theme.destructive)
        } else if store.sessions.isEmpty {
            BillingDashedBox(text: "No sessions in this range. Try another filter or enroll a task.")
        } else {
            VStack(spacing: 8) {
                ForEach(BillingMath.sections(store.sessions, by: store.groupBy)) { section in
                    BillingLedgerSection(section: section, store: store)
                }
            }
            .padding(.top, 4)
        }
    }

    private var noTasksCard: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("No billable tasks yet").font(.cardTitle).foregroundStyle(Theme.foreground)
                Text("Add at least one task with a rate on the Rates tab, then come back here.")
                    .font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button("Go to Rates", action: onGoRates).buttonStyle(.t(.primary))
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: shape)
        .overlay(shape.strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 1, dash: [5, 4])))
    }
}

/// Dashed, muted empty-state box (web: `border-2 border-dashed bg-muted/25 shadow-inner`).
struct BillingDashedBox: View {
    var text: String
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
        Text(text)
            .font(.scaled(14))
            .foregroundStyle(Theme.mutedForeground)
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 16)
            .padding(.vertical, 36)
            .frame(maxWidth: .infinity)
            .background(Theme.muted.opacity(0.25), in: shape)
            .overlay(shape.strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 2, dash: [6, 4])))
    }
}

// MARK: - Filters toolbar (billing-filters.tsx)

struct BillingFiltersBar: View {
    @Bindable var store: BillingStore
    var wide: Bool

    private var columns: [GridItem] {
        Array(repeating: GridItem(.flexible(), spacing: 8, alignment: .topLeading), count: wide ? 4 : 2)
    }

    private var periodOptions: [(BillingMath.Period, String)] { BillingMath.Period.allCases.map { ($0, $0.label) } }
    private var statusOptions: [(BillingMath.Status, String)] { BillingMath.Status.allCases.map { ($0, $0.label) } }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        VStack(alignment: .leading, spacing: 10) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 8) {
                BillingFilterMenu(title: "Period", options: periodOptions, selection: $store.period)
                BillingFilterMenu(title: "Group", options: store.groupOptions,
                                  selection: Binding(get: { store.groupFilter }, set: { store.setGroupFilter($0) }))
                BillingFilterMenu(title: "Task", options: store.taskOptions, selection: $store.taskFilter)
                BillingFilterMenu(title: "Status", options: statusOptions, selection: $store.status)
            }
            if store.period == .custom {
                customRange
            }
            Rectangle().fill(Theme.border).frame(height: 2)
            groupByRow
        }
        .padding(10)
        .background(Theme.card, in: shape)
        .overlay(shape.strokeBorder(Theme.border, lineWidth: 2))
        .shadow(color: .black.opacity(0.08), radius: 6, x: 0, y: 3)
    }

    private var customRange: some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        return HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                BillingKicker(text: "From")
                DatePicker("From", selection: $store.customFrom, displayedComponents: .date)
                    .labelsHidden()
            }
            VStack(alignment: .leading, spacing: 2) {
                BillingKicker(text: "To")
                DatePicker("To", selection: $store.customTo, displayedComponents: .date)
                    .labelsHidden()
            }
            Spacer(minLength: 0)
        }
        .padding(8)
        .background(Theme.muted.opacity(0.3), in: shape)
        .overlay(shape.strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 2, dash: [5, 4])))
    }

    private var groupByRow: some View {
        HStack(spacing: 6) {
            BillingKicker(text: "Group list by")
            Spacer(minLength: 8)
            ForEach(BillingMath.GroupBy.allCases, id: \.self) { g in
                Button(g.label) { store.groupBy = g }
                    .buttonStyle(.t(store.groupBy == g ? .secondary : .outline, .sm))
                    .accessibilityAddTraits(store.groupBy == g ? .isSelected : [])
            }
        }
    }
}

/// 11 pt uppercase muted label (web `text-[11px] uppercase tracking-wide`).
struct BillingKicker: View {
    var text: String
    var body: some View {
        Text(text)
            .font(.label11)
            .tracking(0.6)
            .textCase(.uppercase)
            .foregroundStyle(Theme.mutedForeground)
            .lineLimit(1)
    }
}

/// Compact select: label + menu button showing the current choice.
struct BillingFilterMenu<V: Hashable>: View {
    var title: String
    var options: [(V, String)]
    @Binding var selection: V

    private var currentLabel: String {
        options.first(where: { $0.0 == selection })?.1 ?? options.first?.1 ?? ""
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            BillingKicker(text: title)
            Menu {
                Picker(title, selection: $selection) {
                    ForEach(options, id: \.0) { opt in
                        Text(opt.1).tag(opt.0)
                    }
                }
                .pickerStyle(.inline)
            } label: {
                HStack(spacing: 4) {
                    Text(currentLabel)
                        .font(.scaled(13))
                        .foregroundStyle(Theme.foreground)
                        .lineLimit(1)
                        .truncationMode(.tail)
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.up.chevron.down")
                        .font(.scaled(10, weight: .semibold))
                        .foregroundStyle(Theme.mutedForeground)
                }
                .padding(.horizontal, 10)
                .frame(maxWidth: .infinity, minHeight: 32)
                .background(Theme.background, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Theme.border))
                .contentShape(Rectangle())
            }
            .menuStyle(.button)
            .buttonStyle(.plain)
            .menuIndicator(.hidden)
            .accessibilityLabel("\(title): \(currentLabel)")
        }
    }
}

// MARK: - Ledger section

struct BillingLedgerSection: View {
    let section: BillingMath.Section
    var store: BillingStore

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
        let isCollapsed = store.collapsed.contains(section.key)
        VStack(spacing: 0) {
            header(isCollapsed: isCollapsed)
            if !isCollapsed {
                Rectangle().fill(Theme.border).frame(height: 2)
                VStack(spacing: 8) {
                    ForEach(section.rows) { row in
                        BillingSessionRowView(row: row, selected: store.selected.contains(row.id)) {
                            store.toggle(row.id)
                        }
                    }
                }
                .padding(8)
                .background(Theme.muted.opacity(0.2))
            }
        }
        .background(Theme.card)
        .clipShape(shape)
        .overlay(shape.strokeBorder(Theme.border, lineWidth: 2))
        .shadow(color: .black.opacity(0.05), radius: 1, x: 0, y: 1)
    }

    private func header(isCollapsed: Bool) -> some View {
        let ids = section.rows.filter { !$0.isPaid }.map(\.id)
        let allSelected = !ids.isEmpty && ids.allSatisfy { store.selected.contains($0) }
        return VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 8) {
                Button {
                    withAnimation(.easeOut(duration: 0.2)) { store.toggleCollapsed(section.key) }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: isCollapsed ? "chevron.right" : "chevron.down")
                            .font(.scaled(12, weight: .semibold))
                            .frame(width: 16)
                        Text(section.key).font(.scaled(14, weight: .medium)).tabular()
                    }
                    .foregroundStyle(Theme.foreground)
                    .frame(minHeight: 30)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("\(section.key), \(isCollapsed ? "collapsed" : "expanded")")
                Spacer(minLength: 8)
                BillingCheckbox(checked: allSelected, disabled: ids.isEmpty, label: "Select all unpaid in \(section.key)") {
                    store.setSelected(ids, !allSelected)
                }
                Text("Group").font(.scaled(11)).foregroundStyle(Theme.mutedForeground)
            }
            FlowLayout(spacing: 10, lineSpacing: 2) {
                Text("\(Fmt.durationMinutes(Double(section.totalMinutes))) total")
                    .font(.scaled(12)).foregroundStyle(Theme.mutedForeground).tabular()
                ForEach(section.unpaidByCurrency, id: \.0) { entry in
                    Text("\(Money.format(entry.1, entry.0)) unpaid")
                        .font(.scaled(12, weight: .medium)).foregroundStyle(Theme.mutedForeground).tabular()
                }
            }
            .padding(.leading, 20)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.muted.opacity(0.55))
    }
}

// MARK: - Checkbox

struct BillingCheckbox: View {
    var checked: Bool
    var disabled = false
    var label: String
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            ZStack {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(checked ? Theme.primary : Theme.background)
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .strokeBorder(checked ? Theme.primary : Theme.mutedForeground.opacity(0.6), lineWidth: 1)
                if checked {
                    Image(systemName: "checkmark")
                        .font(.scaled(10, weight: .bold))
                        .foregroundStyle(Theme.onPrimary)
                }
            }
            .frame(width: 18, height: 18)
            .frame(width: 30, height: 30)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.5 : 1)
        .accessibilityLabel(label)
        .accessibilityValue(checked ? "Checked" : "Unchecked")
    }
}

// MARK: - Session row (session-row.tsx)

struct BillingSessionRowView: View {
    let row: BillingSessionRow
    let selected: Bool
    let onToggle: () -> Void

    private var interactive: Bool { !row.isPaid }
    private var highlighted: Bool { interactive && selected }

    private var timeRange: String {
        let calc = DayCalc.current
        return "\(calc.format(row.from, "MMM d, yyyy")) · \(calc.format(row.from, "HH:mm"))–\(calc.format(row.to, "HH:mm"))"
    }

    private var borderColor: Color {
        if highlighted { return Color(hex: row.accentHex, opacity: 0.55) }
        if row.isPaid { return Theme.mutedForeground.opacity(0.25) }
        return Theme.border
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        let accent = row.accentHex
        HStack(alignment: .top, spacing: 8) {
            BillingCheckbox(checked: selected, disabled: row.isPaid,
                            label: row.isPaid ? "Session already paid" : "Select session to include in payment",
                            action: onToggle)
                .padding(.top, -4)
            info
            Spacer(minLength: 6)
            trailing
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color(hex: accent, opacity: highlighted ? 0.22 : 0.12), in: shape)
        .background(Theme.card, in: shape)
        .overlay(shape.strokeBorder(borderColor, lineWidth: 2))
        .overlay {
            if highlighted {
                RoundedRectangle(cornerRadius: 9, style: .continuous)
                    .stroke(Color(hex: accent, opacity: 0.35), lineWidth: 1)
                    .padding(-1)
            }
        }
        .shadow(color: highlighted ? Color(hex: accent, opacity: 0.2) : Color.black.opacity(0.05),
                radius: highlighted ? 4 : 1, x: 0, y: highlighted ? 2 : 1)
        .contentShape(shape)
        .onTapGesture { if interactive { onToggle() } }
        .animation(.easeOut(duration: 0.15), value: selected)
    }

    private var info: some View {
        VStack(alignment: .leading, spacing: 4) {
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
            Text(timeRange)
                .font(.scaled(12)).foregroundStyle(Theme.mutedForeground).tabular()
            if row.isPaid, let paidAt = row.paymentPaidAt {
                Text("Paid \(DayCalc.current.format(paidAt, "MMM d, yyyy"))")
                    .font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
            }
        }
    }

    private var trailing: some View {
        VStack(alignment: .trailing, spacing: 6) {
            Badge(text: Fmt.durationMinutes(Double(row.durationMinutes)), kind: .secondary, mono: true)
            Text(Money.format(row.earnings, row.currency))
                .font(.scaled(14, weight: .semibold))
                .foregroundStyle(Theme.foreground)
                .tabular()
            Badge(text: row.isPaid ? "Paid" : "Unpaid", kind: row.isPaid ? .primary : .outline)
        }
        .fixedSize()
    }
}

// MARK: - Sticky selection bar (session-ledger.tsx toolbar)

struct BillingSelectionBar: View {
    var store: BillingStore
    var wide: Bool
    var onMarkPaid: () -> Void
    @State private var showHelp = false

    private var hint: String {
        switch store.status {
        case .paid: "Switch status to Unpaid or All to select open amounts."
        case .unpaid: "Tap unpaid rows or checkboxes. Select all selects every unpaid row in this list (tap again to clear). Mark as paid: one currency per batch."
        case .all: "Select unpaid rows only; paid rows are read-only. Mark as paid uses one currency per batch."
        }
    }

    var body: some View {
        let sum = BillingMath.summary(store.selectedSessions)
        let unpaid = store.unpaidInList.count
        let ready = sum.count > 0 && sum.byCurrency.count == 1
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        Group {
            if wide {
                HStack(alignment: .center, spacing: 10) {
                    summaryBlock(sum, unpaid: unpaid, ready: ready)
                    buttons(unpaid: unpaid, ready: ready)
                }
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    summaryBlock(sum, unpaid: unpaid, ready: ready)
                    HStack(spacing: 8) {
                        Spacer(minLength: 0)
                        buttons(unpaid: unpaid, ready: ready)
                    }
                }
            }
        }
        .padding(10)
        .background(Theme.card.opacity(0.9), in: shape)
        .background(.regularMaterial, in: shape)
        .overlay(shape.strokeBorder(Theme.border, lineWidth: 2))
        .shadow(color: .black.opacity(0.12), radius: 8, x: 0, y: 4)
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .frame(maxWidth: 896)
        .frame(maxWidth: .infinity)
    }

    private func summaryBlock(_ sum: BillingMath.SelectionSummary, unpaid: Int, ready: Bool) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Button { showHelp.toggle() } label: {
                Image(systemName: "questionmark.circle")
                    .font(.scaled(15))
                    .foregroundStyle(Theme.mutedForeground)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("How selection works")
            .popover(isPresented: $showHelp) {
                Text(hint)
                    .font(.scaled(12))
                    .foregroundStyle(Theme.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(width: 260, alignment: .leading)
                    .padding(12)
                    #if os(iOS)
                    .presentationCompactAdaptation(.popover)
                    #endif
            }
            VStack(alignment: .leading, spacing: 3) {
                summaryLine(sum, unpaid: unpaid)
                    .font(.scaled(12))
                    .foregroundStyle(Theme.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
                if sum.count > 0 && !ready {
                    Text("Multiple currencies — narrow selection to one currency.")
                        .font(.scaled(11))
                        .foregroundStyle(Theme.destructive)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.top, 6)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func summaryLine(_ sum: BillingMath.SelectionSummary, unpaid: Int) -> Text {
        if sum.count > 0 {
            var t = Text("\(sum.count)").fontWeight(.semibold).foregroundColor(Theme.foreground)
            t = t + Text(" · ").foregroundColor(Theme.mutedForeground)
            t = t + Text(Fmt.durationMinutes(Double(sum.minutes))).foregroundColor(Theme.foreground)
            for entry in sum.byCurrency {
                t = t + Text(" · ").foregroundColor(Theme.mutedForeground)
                t = t + Text(Money.format(entry.1, entry.0)).fontWeight(.semibold).foregroundColor(Theme.foreground)
            }
            return t.monospacedDigit()
        }
        if store.status == .paid {
            return Text("Paid-only view — selection disabled.")
        }
        return Text("Nothing selected" + (unpaid > 0 ? " · \(unpaid) unpaid in list" : "") + ".")
    }

    @ViewBuilder
    private func buttons(unpaid: Int, ready: Bool) -> some View {
        if unpaid > 0 && store.status != .paid {
            Button(store.allUnpaidSelected ? "Clear all" : "All unpaid (\(unpaid))") { store.toggleAllUnpaid() }
                .buttonStyle(.t(.outline, .sm))
        }
        Button("Mark as paid…", action: onMarkPaid)
            .buttonStyle(.t(.primary, .sm))
            .disabled(!ready)
            .accessibilityIdentifier("billingMarkPaid")
    }
}

// MARK: - Activity calendar (calendar-heatmap.tsx inside the "(optional)" details)

struct BillingActivityCalendar: View {
    var store: BillingStore
    var onGoRates: () -> Void
    @State private var expanded = false

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeOut(duration: 0.2)) { expanded.toggle() }
            } label: {
                HStack(alignment: .center, spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        (Text("Activity calendar").font(.scaled(14, weight: .medium)).foregroundColor(Theme.foreground)
                         + Text("  (optional)").font(.scaled(12)).foregroundColor(Theme.mutedForeground))
                        Text("Same yearly heatmap as home · open when you want the overview")
                            .font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.down")
                        .font(.scaled(12, weight: .semibold))
                        .foregroundStyle(Theme.mutedForeground)
                        .rotationEffect(.degrees(expanded ? 0 : -90))
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isHeader)
            if expanded {
                Hairline()
                content.padding(12)
            }
        }
        .background(expanded ? Theme.card : Theme.muted.opacity(0.2), in: shape)
        .overlay(shape.strokeBorder(Theme.border, lineWidth: 1))
    }

    @ViewBuilder
    private var content: some View {
        if store.sessionsLoading {
            VStack(alignment: .leading, spacing: 8) {
                Text("Billable activity").font(.cardTitle)
                Text("Loading…").font(.scaled(13)).foregroundStyle(Theme.mutedForeground)
                Skeleton(height: 200)
            }
        } else {
            BillingCalendarBody(sessions: store.sessions, calendarEnd: store.calendarEnd, onGoRates: onGoRates) { day in
                store.filterToDay(day)
            }
        }
    }
}

private struct BillingCalendarBody: View {
    let sessions: [BillingSessionRow]
    let calendarEnd: Date?
    let onGoRates: () -> Void
    let onDay: (Date) -> Void

    private var blurb: String {
        let base = "Yearly heatmap like the home dashboard—scoped by your filters. Click a day to jump the list there."
        if let end = calendarEnd { return base + " Shown through \(DayCalc.current.format(end, "MMM d, yyyy"))." }
        return base + " Through today for All time."
    }

    /// First session per task name decides its colour (group accent or task accent).
    private var taskColors: [String: String] {
        var m: [String: String] = [:]
        for s in sessions where m[s.taskName] == nil { m[s.taskName] = s.accentHex }
        return m
    }

    var body: some View {
        let data = YearlyCalendarData.fromBilling(sessions, calendarEndDay: calendarEnd)
        let colors = taskColors
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Billable activity").font(.cardTitle).foregroundStyle(Theme.foreground)
                Text(blurb)
                    .font(.scaled(13)).foregroundStyle(Theme.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button("Set up billable tasks", action: onGoRates).buttonStyle(.t(.outline, .sm))
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
                onDayTap: { _, day in onDay(day) })
        }
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
            VStack(alignment: .leading, spacing: 2) {
                Text(DayCalc.current.format(day, "EEEE, MMMM d, yyyy")).font(.scaled(14, weight: .semibold))
                Text("Billable time (same filters as the ledger)").font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
            }
            Hairline()
            Text("\(Fmt.heatMinutes(minutes)) · \(Money.format(earnings, currency))")
                .font(.scaled(12, weight: .medium)).tabular()
            ForEach(taskMinutes.sorted { $0.value > $1.value }, id: \.key) { entry in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(Color(hex: colors[entry.key] ?? Accent.otherHex))
                        .frame(width: 8, height: 8)
                    (Text(entry.key).fontWeight(.medium)
                     + Text(" · \(Fmt.heatMinutes(entry.value))").foregroundColor(Theme.mutedForeground))
                        .font(.scaled(12))
                }
            }
            Text("Click to filter the ledger to this day")
                .font(.scaled(10)).foregroundStyle(Theme.mutedForeground)
        }
    }
}
