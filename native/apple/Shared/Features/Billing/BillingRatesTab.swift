import SwiftUI
import TrackifyKit

// MARK: - Rates (task-enrollment-sheet.tsx)

/// Pushed rate editor for one task.
struct BillingRateRoute: Hashable { let taskId: String }

struct BillingRatesView: View {
    @Environment(AppModel.self) private var model
    var store: BillingStore
    #if os(macOS)
    @State private var selectedId: String?
    #endif

    private var enrolledIds: Set<String> { Set((store.billingTasks ?? []).map(\.taskId)) }

    private var visible: [TrackifyTask] {
        model.tasks.filter { !$0.hidden }.sorted { $0.name.localizedCompare($1.name) == .orderedAscending }
    }

    private var billing: [TrackifyTask] { visible.filter { enrolledIds.contains($0.id) } }
    private var notBilling: [TrackifyTask] { visible.filter { !enrolledIds.contains($0.id) } }

    private func rate(_ t: TrackifyTask) -> BillingTaskRow? { store.billingTasks?.first { $0.taskId == t.id } }

    private var ready: Bool { store.billingTasks != nil && (model.tasksLoaded || !model.tasks.isEmpty) }

    var body: some View {
        platformBody
            .overlay {
                if !ready {
                    if let err = store.billingTasksError {
                        ContentUnavailableView("Couldn't Load Rates", systemImage: "exclamationmark.triangle", description: Text(err))
                    } else {
                        ProgressView()
                    }
                } else if visible.isEmpty {
                    ContentUnavailableView("No Tasks", systemImage: "tag", description: Text("Create a task on the Timer first."))
                }
            }
    }

    // MARK: iPhone / iPad

    #if os(iOS)
    private var platformBody: some View {
        List {
            if ready {
                Section {
                    ForEach(billing) { t in link(t) }
                    if billing.isEmpty {
                        Text("No billable tasks yet.").foregroundStyle(.secondary)
                    }
                } header: {
                    Text("Billing")
                } footer: {
                    Text("Only these tasks appear under Sessions. Tap a task to change its rate or currency.")
                }
                if !notBilling.isEmpty {
                    Section("Not Billing") {
                        ForEach(notBilling) { t in link(t) }
                    }
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Rates")
        .navigationBarTitleDisplayMode(.inline)
        .navigationDestination(for: BillingRateRoute.self) { r in
            BillingRateEditor(taskId: r.taskId, store: store)
        }
        .refreshable { await store.afterRatesChange(model.api) }
    }

    private func link(_ t: TrackifyTask) -> some View {
        NavigationLink(value: BillingRateRoute(taskId: t.id)) {
            BillingRateCell(task: t, rate: rate(t))
        }
        .accessibilityIdentifier("rate-\(t.name)")
    }
    #endif

    // MARK: Mac

    #if os(macOS)
    private var platformBody: some View {
        Table(of: TrackifyTask.self, selection: $selectedId) {
            TableColumn("Task") { t in
                HStack(spacing: 6) {
                    Circle().fill(Color(hex: t.accentHex)).frame(width: 8, height: 8)
                    Text(t.name).lineLimit(1)
                }
            }
            .width(min: 160, ideal: 240)
            TableColumn("Group") { t in Text(t.taskGroup?.name ?? "—").foregroundStyle(.secondary).lineLimit(1) }
                .width(min: 80, ideal: 130)
            TableColumn("Rate") { t in
                Text(rate(t).map { "\(Money.format($0.hourlyRate, $0.currency)) / h" } ?? "—")
                    .foregroundStyle(rate(t) == nil ? .secondary : .primary)
                    .monospacedDigit()
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 90, ideal: 120)
            TableColumn("Tracked") { t in
                Text(Fmt.durationMinutes(Double(BillingMath.trackedMinutes(t.events)))).monospacedDigit()
                    .frame(maxWidth: .infinity, alignment: .trailing)
            }
            .width(min: 70, ideal: 90)
        } rows: {
            Section {
                ForEach(billing) { TableRow($0) }
            } header: { Text("Billing") }
            Section {
                ForEach(notBilling) { TableRow($0) }
            } header: { Text("Not Billing") }
        }
        .inspector(isPresented: Binding(get: { selectedId != nil }, set: { if !$0 { selectedId = nil } })) {
            Group {
                if let id = selectedId {
                    BillingRateEditor(taskId: id, store: store).id(id)
                }
            }
            .inspectorColumnWidth(min: 300, ideal: 340, max: 440)
        }
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { selectedId = selectedId == nil ? (billing.first ?? notBilling.first)?.id : nil } label: {
                    Label("Edit Rate", systemImage: "sidebar.right")
                }
                .help("Show the rate editor")
            }
        }
    }
    #endif
}

// MARK: - Row

struct BillingRateCell: View {
    let task: TrackifyTask
    let rate: BillingTaskRow?

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Circle().fill(Color(hex: task.accentHex)).frame(width: 8, height: 8)
                .alignmentGuide(.firstTextBaseline) { d in d[.bottom] - 1 }
            VStack(alignment: .leading, spacing: 2) {
                Text(task.name).lineLimit(2)
                Text(task.taskGroup?.name ?? "Ungrouped").font(.subheadline).foregroundStyle(.secondary)
            }
            Spacer(minLength: 8)
            if let rate {
                Text("\(Money.format(rate.hourlyRate, rate.currency)) / h").monospacedDigit().foregroundStyle(.secondary)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Editor (push on iPhone, inspector on the Mac)

struct BillingRateEditor: View {
    @Environment(AppModel.self) private var model
    let taskId: String
    var store: BillingStore

    var body: some View {
        Form {
            if let task = model.task(taskId) {
                Section {
                    LabeledContent("Task") {
                        HStack(spacing: 6) {
                            Circle().fill(Color(hex: task.accentHex)).frame(width: 8, height: 8)
                            Text(task.name)
                        }
                    }
                    LabeledContent("Group", value: task.taskGroup?.name ?? "Ungrouped")
                }
                TaskBillingSection(task: task, rows: store.billingTasks ?? [], onChanged: {
                    Task { await store.afterRatesChange(model.api) }
                })
            } else {
                Text("Task not found").foregroundStyle(.secondary)
            }
        }
        .formStyle(.grouped)
        .navigationTitle(model.task(taskId)?.name ?? "Rate")
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}
