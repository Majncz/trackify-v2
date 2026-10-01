import SwiftUI
import TrackifyKit

// MARK: - "How billing works" (billing-guide.tsx), shown on demand from the info button

struct BillingGuideSheet: View {
    var onOpenRates: () -> Void
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    step(1, "Choose billable tasks", "Under Rates, give the tasks you bill an hourly rate and currency. That's the only setup.")
                    step(2, "Track time as usual", "Billing only reads your tracked time — you never log time here.")
                    step(3, "Review sessions", "Sessions lists billable time. Filter by period, group, task and status, and group the list by day, week or month.")
                    step(4, "Mark as paid", "Select unpaid sessions (one currency per batch) and mark them paid. Amounts can be adjusted per line. Payments keeps the history; reopen a payment to make its sessions unpaid again.")
                    step(5, "AI subscriptions", "Record AI tool subscriptions to see what they cost next to the time they helped with.")
                } footer: { Group {
                    Text("Rates changes apply to unpaid sessions; paid sessions keep the amount recorded with their payment.")
                }.billingFooter() }
                Section {
                    Button("Open Rates", action: onOpenRates)
                }
            }
            .formStyle(.grouped)
            .navigationTitle("How Billing Works")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
        }
        #if os(macOS)
        .frame(width: 480, height: 520)
        #else
        .presentationDetents([.medium, .large])
        #endif
    }

    private func step(_ n: Int, _ title: String, _ text: String) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.body.weight(.medium))
                Text(text).font(.subheadline).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } icon: {
            Image(systemName: "\(n).circle")
        }
    }
}
