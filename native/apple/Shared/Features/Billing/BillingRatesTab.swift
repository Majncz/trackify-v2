import SwiftUI
import TrackifyKit

// MARK: - Rates tab (task-enrollment-sheet.tsx)

struct BillingRatesTab: View {
    @Environment(AppModel.self) private var model
    var store: BillingStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Billable tasks & rates").font(.cardTitle).tracking(-0.2).foregroundStyle(Theme.foreground)
                Text("Choose which tasks bill hourly and set rate and currency. Only these tasks show up under Sessions.")
                    .font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
            content
        }
    }

    @ViewBuilder
    private var content: some View {
        if let rows = store.billingTasks, model.tasksLoaded || !model.tasks.isEmpty {
            explainer
            list(rows)
        } else if let err = store.billingTasksError {
            Text(err).font(.scaled(14)).foregroundStyle(Theme.destructive)
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Skeleton(height: 40)
                Skeleton(height: 112)
                Skeleton(height: 112)
                Skeleton(height: 112)
            }
        }
    }

    private var explainer: some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        let parts: [Text] = [
            Text("How this list works.").fontWeight(.medium).foregroundColor(Theme.foreground),
            Text(" Rows use a light tint from your ").foregroundColor(Theme.mutedForeground),
            Text("group color").foregroundColor(Theme.foreground),
            Text(" when the task is in a group, or a stable ").foregroundColor(Theme.mutedForeground),
            Text("task color").foregroundColor(Theme.foreground),
            Text(" when it is ungrouped—matching Sessions. Badges spell out group vs ungrouped explicitly.").foregroundColor(Theme.mutedForeground),
        ]
        let text = parts.dropFirst().reduce(parts[0]) { acc, t in acc + t }
        return text
            .font(.scaled(14))
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.muted.opacity(0.25), in: shape)
            .overlay(shape.strokeBorder(Theme.border, style: StrokeStyle(lineWidth: 2, dash: [6, 4])))
    }

    /// Visible tasks: enrolled first, then alphabetical.
    private func sortedTasks(_ rows: [BillingTaskRow]) -> [TrackifyTask] {
        let enrolled = Set(rows.map(\.taskId))
        return model.tasks.filter { !$0.hidden }.sorted { a, b in
            let aOn = enrolled.contains(a.id), bOn = enrolled.contains(b.id)
            if aOn != bOn { return aOn }
            return a.name.localizedCompare(b.name) == .orderedAscending
        }
    }

    @ViewBuilder
    private func list(_ rows: [BillingTaskRow]) -> some View {
        let tasks = sortedTasks(rows)
        if tasks.isEmpty {
            Text("No visible tasks.")
                .font(.scaled(14))
                .foregroundStyle(Theme.mutedForeground)
                .frame(maxWidth: .infinity)
                .padding(.vertical, 32)
        } else {
            VStack(spacing: 12) {
                ForEach(tasks) { t in
                    TaskBillingPanel(task: t, compact: true, rows: rows, onChanged: {
                        Task { await store.afterRatesChange(model.api) }
                    })
                }
            }
        }
    }
}
