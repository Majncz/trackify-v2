import SwiftUI
import TrackifyKit

// MARK: - Period card (ai-tools-tab.tsx `PeriodCard`)

struct AIBillingPeriodCard: View {
    var period: AIPeriod
    var viewCurrency: String
    var busy: Bool
    var onPatch: ([String: Any?]) -> Void
    var onEdit: () -> Void
    var onDelete: () -> Void

    private var state: AIPeriodState { AIPeriodState.of(period) }

    private var isActive: Bool { period.metrics?.isActive ?? (state == .running) }

    private var stripe: Color {
        switch state {
        case .running: return Theme.green
        case .depleted: return Theme.amber
        case .ended: return Theme.border
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            AIBillingPeriodDetails(period: period, viewCurrency: viewCurrency)
            Text("Overlap hours: timer time credited to this row (earliest-start wins across concurrent windows). Paid billable earnings: paid billing sessions in this window — final once ended or depleted.")
                .font(.scaled(11))
                .foregroundStyle(Theme.mutedForeground)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
                .overlay(alignment: .top) { Rectangle().fill(Theme.border.opacity(0.6)).frame(height: 1) }
            if let note = period.note, !note.isEmpty {
                Text(note).font(.scaled(12)).italic().foregroundStyle(Theme.mutedForeground)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(16)
        .padding(.leading, 3)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card)
        .overlay(alignment: .leading) { Rectangle().fill(stripe).frame(width: 3) }
        .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
        .shadow(color: .black.opacity(0.06), radius: 2, x: 0, y: 1)
    }

    private var header: some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 6) {
                Text(period.name).font(.cardTitle).lineLimit(2).truncationMode(.tail)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    AIBillingStateBadge(state: state)
                    AIBillingOutlineBadge(text: AICadence.normalize(period.billingCadence).label)
                }
                dates
                depletionAction
            }
            Spacer(minLength: 0)
            HStack(spacing: 0) {
                Button(action: onEdit) { Image(systemName: "pencil") }
                    .buttonStyle(.t(.ghost, .icon))
                    .accessibilityLabel("Edit AI billing entry")
                Button(action: onDelete) { Image(systemName: "trash").foregroundStyle(Theme.destructive) }
                    .buttonStyle(.t(.ghost, .icon))
                    .accessibilityLabel("Delete AI billing entry")
            }
        }
    }

    private var dates: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(AIBillingFormat.shortDate(period.startsAt)) → \(period.endsAt.map(AIBillingFormat.shortDate) ?? "open-ended")")
                .foregroundStyle(Theme.mutedForeground)
            if let d = period.depletedAt {
                Text("Depleted \(AIBillingFormat.shortDate(d))")
                    .foregroundStyle(Color(light: 0x78350F, dark: 0xFDE68A).opacity(0.8))
            } else {
                Text("Window closes: \(AIBillingFormat.shortDate(AIPeriodState.windowCloses(period)))")
                    .foregroundStyle(Theme.mutedForeground)
            }
        }
        .font(.scaled(12))
        .tabular()
    }

    @ViewBuilder private var depletionAction: some View {
        if period.depletedAt != nil {
            Button("Clear depletion") { onPatch(["depletedAt": nil]) }
                .buttonStyle(.t(.ghost, .sm))
                .disabled(busy)
        } else if isActive {
            Button("Mark depleted") { onPatch(["depletedAt": Date()]) }
                .buttonStyle(.t(.outline, .sm))
                .disabled(busy)
                .help("When tokens or subscription credits ran out")
        }
    }
}

struct AIBillingStateBadge: View {
    var state: AIPeriodState

    var body: some View {
        let colors = palette
        Text(state.label)
            .font(.scaled(12, weight: .semibold))
            .lineLimit(1)
            .foregroundStyle(colors.text)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(colors.bg, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(colors.border))
    }

    private var palette: (text: Color, bg: Color, border: Color) {
        switch state {
        case .running:
            return (Color(light: 0x166534, dark: 0x86EFAC), Theme.green.opacity(0.1), Color(rgb: 0x16A34A, opacity: 0.4))
        case .depleted:
            return (Color(light: 0x78350F, dark: 0xFDE68A), Theme.amber.opacity(0.1), Color(rgb: 0xD97706, opacity: 0.5))
        case .ended:
            return (Theme.mutedForeground, Color.clear, Theme.border)
        }
    }
}

struct AIBillingOutlineBadge: View {
    var text: String
    var body: some View {
        Text(text)
            .font(.scaled(12, weight: .semibold))
            .lineLimit(1)
            .foregroundStyle(Theme.mutedForeground)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Theme.border))
    }
}

/// Card body: email, provider, price, metrics, paid earnings.
struct AIBillingPeriodDetails: View {
    var period: AIPeriod
    var viewCurrency: String

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let email = period.billingEmail, !email.isEmpty {
                (Text("Account email: ").foregroundColor(Theme.mutedForeground) + Text(email).fontWeight(.semibold))
                    .textSelection(.enabled)
            }
            if let raw = period.billingProviderUrl, !raw.isEmpty {
                AIBillingProviderLink(raw: raw)
            }
            priceLine
            if let m = period.metrics {
                Text("Overlap hours (\(m.tasksWithTrackedTime) tasks): ").foregroundColor(Theme.mutedForeground)
                    + Text("\(AIBillingFormat.number(m.trackedHours))h").fontWeight(.semibold)
                Text("Active days: ").foregroundColor(Theme.mutedForeground)
                    + Text("\(m.durationDays)").fontWeight(.semibold)
            }
            if let paid = period.paidEarningsByCurrency, !paid.isEmpty {
                Text("Paid billable earnings: ").foregroundColor(Theme.mutedForeground)
                    + Text(paid.keys.sorted().map { Money.format(paid[$0] ?? 0, $0) }.joined(separator: "  ")).fontWeight(.semibold)
            }
        }
        .font(.scaled(14))
        .foregroundStyle(Theme.foreground)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var priceLine: Text {
        let label = period.isRecurring ? "Monthly price: " : "One-time price: "
        var t = Text(label).foregroundColor(Theme.mutedForeground)
            + Text(Money.format(period.price, period.currency)).fontWeight(.semibold)
        if viewCurrency != period.currency, let approx = period.priceApproxCzk, viewCurrency == Money.defaultCurrency {
            t = t + Text(" (~\(Money.format(approx, Money.defaultCurrency)) CZK)")
                .font(.scaled(12))
                .foregroundColor(Theme.mutedForeground)
        }
        return t
    }
}

struct AIBillingProviderLink: View {
    var raw: String

    private var url: URL? {
        guard let u = URL(string: raw.trimmingCharacters(in: .whitespaces)), u.scheme != nil, u.host != nil else { return nil }
        return u
    }

    private var label: String {
        guard let host = url?.host, !host.isEmpty else { return "Open link" }
        if host.lowercased().hasPrefix("www.") { return String(host.dropFirst(4)) }
        return host
    }

    var body: some View {
        HStack(spacing: 4) {
            Text("Provider: ").foregroundStyle(Theme.mutedForeground)
            if let url {
                Link(destination: url) {
                    HStack(spacing: 4) {
                        Text(label).fontWeight(.semibold).underline()
                        Image(systemName: "arrow.up.right.square").font(.scaled(12)).opacity(0.7)
                    }
                    .foregroundStyle(Theme.primary)
                }
                .buttonStyle(.plain)
            } else {
                Text(label).fontWeight(.semibold)
            }
        }
    }
}
