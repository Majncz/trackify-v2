import SwiftUI
import TrackifyKit

// MARK: - AI subscription row + detail (ai-tools-tab.tsx `PeriodCard`)

extension AIPeriodState {
    var color: Color {
        switch self {
        case .running: .green
        case .depleted: .orange
        case .ended: .secondary
        }
    }
}

struct AIPeriodCell: View {
    let period: AIPeriod

    var body: some View {
        let state = AIPeriodState.of(period)
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(period.name).lineLimit(2)
                HStack(spacing: 4) {
                    Image(systemName: "circle.fill").font(.system(size: 7)).foregroundStyle(state.color)
                    Text("\(state.label) · \(AICadence.normalize(period.billingCadence).label)")
                }
                .font(.subheadline).foregroundStyle(.secondary)
                Text(AIPeriodDetail.range(period)).font(.subheadline).foregroundStyle(.secondary).monospacedDigit()
            }
            Spacer(minLength: 8)
            Text(Money.format(period.price, period.currency)).monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }
}

struct AIPeriodDetail: View {
    let period: AIPeriod
    var viewCurrency: String
    var active: Bool
    var busy: Bool
    var onEdit: () -> Void
    var onPatch: ([String: Any?]) -> Void
    var onDelete: () -> Void

    static func range(_ p: AIPeriod) -> String {
        "\(AIBillingFormat.shortDate(p.startsAt)) → \(p.endsAt.map(AIBillingFormat.shortDate) ?? "open-ended")"
    }

    private var providerURL: URL? {
        guard let raw = period.billingProviderUrl?.trimmingCharacters(in: .whitespaces), !raw.isEmpty,
              let u = URL(string: raw), u.scheme != nil, u.host != nil else { return nil }
        return u
    }

    private var providerLabel: String {
        guard let host = providerURL?.host, !host.isEmpty else { return period.billingProviderUrl ?? "" }
        return host.lowercased().hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    var body: some View {
        let state = AIPeriodState.of(period)
        Form {
            Section {
                LabeledContent("Status") {
                    HStack(spacing: 4) {
                        Image(systemName: "circle.fill").font(.system(size: 7)).foregroundStyle(state.color)
                        Text(state.label)
                    }
                }
                LabeledContent("Payment", value: "\(period.isRecurring ? "Recurring" : "One-time") · \(AICadence.normalize(period.billingCadence).label)")
                LabeledContent(period.isRecurring ? "Monthly price" : "One-time price") {
                    VStack(alignment: .trailing, spacing: 1) {
                        Text(Money.format(period.price, period.currency))
                        if viewCurrency != period.currency, viewCurrency == Money.defaultCurrency, let approx = period.priceApproxCzk {
                            Text("≈ \(Money.format(approx, Money.defaultCurrency))").font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                LabeledContent("Period", value: Self.range(period))
                if let d = period.depletedAt {
                    LabeledContent("Depleted", value: AIBillingFormat.shortDate(d))
                } else {
                    LabeledContent("Window closes", value: AIBillingFormat.shortDate(AIPeriodState.windowCloses(period)))
                }
            } header: {
                #if os(macOS)
                Text(period.name).font(.title3.weight(.semibold)).foregroundStyle(.primary)
                #endif
            }
            .monospacedDigit()

            if (period.billingEmail ?? "").isEmpty == false || providerURL != nil || (period.billingProviderUrl ?? "").isEmpty == false {
                Section("Account") {
                    if let email = period.billingEmail, !email.isEmpty {
                        LabeledContent("Email") { Text(email).textSelection(.enabled) }
                    }
                    if let url = providerURL {
                        LabeledContent("Provider") {
                            Link(destination: url) {
                                Label(providerLabel, systemImage: "arrow.up.right.square").labelStyle(.titleAndIconTrailing)
                            }
                        }
                    } else if let raw = period.billingProviderUrl, !raw.isEmpty {
                        LabeledContent("Provider", value: raw)
                    }
                }
            }

            if period.metrics != nil || !(period.paidEarningsByCurrency ?? [:]).isEmpty {
                Section {
                    if let m = period.metrics {
                        LabeledContent("Overlap hours (\(m.tasksWithTrackedTime) task\(m.tasksWithTrackedTime == 1 ? "" : "s"))",
                                       value: "\(AIBillingFormat.number(m.trackedHours))h")
                        LabeledContent("Active days", value: "\(m.durationDays)")
                    }
                    if let paid = period.paidEarningsByCurrency, !paid.isEmpty {
                        LabeledContent("Paid billable earnings",
                                       value: paid.keys.sorted().map { Money.format(paid[$0] ?? 0, $0) }.joined(separator: " · "))
                    }
                } header: {
                    Text("Usage")
                } footer: { Group {
                    Text("Overlap hours: timer time credited to this entry (the earliest-starting entry wins when windows overlap). Paid billable earnings: paid billing sessions inside this window — final once it has ended or is depleted.")
                }.billingFooter() }
                .monospacedDigit()
            }

            if let note = period.note, !note.isEmpty {
                Section("Note") { Text(note).textSelection(.enabled) }
            }

            Section {
                Button("Edit…", action: onEdit)
                if period.depletedAt != nil {
                    Button("Clear Depletion") { onPatch(["depletedAt": nil]) }.disabled(busy)
                } else if active {
                    Button("Mark Depleted") { onPatch(["depletedAt": Date()]) }
                        .disabled(busy)
                        .help("When tokens or subscription credits ran out")
                }
                Button("Delete…", role: .destructive, action: onDelete)
            }
        }
        .formStyle(.grouped)
        #if os(iOS)
        .navigationTitle(period.name)
        .navigationBarTitleDisplayMode(.inline)
        #endif
    }
}

private struct TitleAndIconTrailing: LabelStyle {
    func makeBody(configuration: Configuration) -> some View {
        HStack(spacing: 4) { configuration.title; configuration.icon.imageScale(.small) }
    }
}

private extension LabelStyle where Self == TitleAndIconTrailing {
    static var titleAndIconTrailing: TitleAndIconTrailing { TitleAndIconTrailing() }
}
