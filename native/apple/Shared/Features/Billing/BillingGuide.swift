import SwiftUI
import TrackifyKit

// MARK: - "How billing works" (billing-guide.tsx)

struct BillingGuide: View {
    var onOpenTasksTab: () -> Void
    /// Web: localStorage `billing-guide-dismissed=1`.
    @AppStorage("billing-guide-dismissed") private var dismissed = false

    var body: some View {
        if !dismissed {
            content
        }
    }

    private var content: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous)
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "book")
                    .font(.scaled(15, weight: .medium))
                    .foregroundStyle(Theme.primary)
                    .frame(width: 36, height: 36)
                    .background(Theme.primary.opacity(0.1), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text("How billing works").font(.cardTitle).foregroundStyle(Theme.foreground)
                    Text("Same idea as Stats: pick a range, read the chart, act on the list. You don't log time here—only money-related steps.")
                        .font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                Button(action: dismiss) {
                    Image(systemName: "xmark").font(.scaled(13, weight: .semibold))
                }
                .buttonStyle(.t(.ghost, .icon))
                .accessibilityLabel("Hide guide")
            }
            VStack(alignment: .leading, spacing: 10) {
                step(1, [Self.em("Rates"), Self.muted(" tab: choose which existing tasks have a rate (that's the only setup).")])
                step(2, [Self.muted("Track time on the "), Self.em("home"), Self.muted(" dashboard as usual—billing only reads it.")])
                step(3, [Self.em("Sessions"), Self.muted(" tab: use the filters at the top of the card (period, task group, task, status), then work the list below.")])
                step(4, [Self.muted("Tap an "), Self.em("unpaid row"), Self.muted(" to select it (or the checkbox). Use "),
                         Self.em("All unpaid"), Self.muted(" for the whole list (again to clear), then "),
                         Self.em("Mark as paid…"), Self.muted(" — one currency per batch. History is under "),
                         Self.em("History"), Self.muted(".")])
            }
            FlowLayout(spacing: 8, lineSpacing: 8) {
                Button("Open billable tasks", action: onOpenTasksTab).buttonStyle(.t(.secondary, .sm))
                Button("Don't show this again", action: dismiss).buttonStyle(.t(.outline, .sm))
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.primary.opacity(0.05), in: shape)
        .background(Theme.card, in: shape)
        .overlay(shape.strokeBorder(Theme.primary.opacity(0.25), lineWidth: 1))
    }

    private func step(_ n: Int, _ parts: [Text]) -> some View {
        let text = parts.dropFirst().reduce(parts.first ?? Text("")) { acc, t in acc + t }
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text("\(n).").font(.scaled(14, weight: .medium)).foregroundStyle(Theme.mutedForeground)
                .frame(minWidth: 16, alignment: .trailing)
            text.font(.scaled(14))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private static func em(_ s: String) -> Text {
        Text(s).fontWeight(.medium).foregroundColor(Theme.foreground)
    }

    private static func muted(_ s: String) -> Text {
        Text(s).foregroundColor(Theme.mutedForeground)
    }

    private func dismiss() {
        withAnimation(.easeOut(duration: 0.2)) { dismissed = true }
    }
}
