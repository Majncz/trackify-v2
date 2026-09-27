import SwiftUI
import TrackifyKit
#if canImport(AppKit) && !targetEnvironment(macCatalyst)
import AppKit
#endif

// MARK: - Motion

/// Repeating (ambient) animations are skipped during UI tests so XCUITest can reach "idle",
/// and when the user asked to reduce motion.
enum Motion {
    static let uiTesting = ProcessInfo.processInfo.environment["TRACKIFY_UI_TEST"] == "1"
    static var ambient: Bool {
        #if os(iOS)
        return !uiTesting && !UIAccessibility.isReduceMotionEnabled
        #else
        return !uiTesting && !NSWorkspace.shared.accessibilityDisplayShouldReduceMotion
        #endif
    }
}

// MARK: - Card

/// How `.card()` draws. iPhone/iPad screens use `.plain` (content only — the surrounding List/section
/// provides structure, no cards inside cards); the Mac dashboard keeps real cards.
enum CardChrome { case card, plain }

private struct CardChromeKey: EnvironmentKey { static let defaultValue: CardChrome = .card }

extension EnvironmentValues {
    var cardChrome: CardChrome {
        get { self[CardChromeKey.self] }
        set { self[CardChromeKey.self] = newValue }
    }
}

struct CardModifier: ViewModifier {
    var padding: CGFloat = 16
    @Environment(\.cardChrome) private var chrome
    @ViewBuilder func body(content: Content) -> some View {
        if chrome == .plain {
            content.frame(maxWidth: .infinity, alignment: .leading)
        } else {
            chromed(content)
        }
    }

    private func chromed(_ content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous).strokeBorder(Theme.border, lineWidth: 1))
            .shadow(color: .black.opacity(0.06), radius: 2, x: 0, y: 1)
    }
}

extension View {
    func card(padding: CGFloat = 16) -> some View { modifier(CardModifier(padding: padding)) }

    /// Web `pending-pulse`: opacity 1 → 0.4 → 1 over 1.5 s.
    func pendingPulse(_ on: Bool) -> some View { modifier(PendingPulse(active: on)) }

    @ViewBuilder func `if`<T: View>(_ cond: Bool, transform: (Self) -> T) -> some View {
        if cond { transform(self) } else { self }
    }
}

struct PendingPulse: ViewModifier {
    var active: Bool
    @State private var dim = false
    func body(content: Content) -> some View {
        content
            .opacity(active && dim ? 0.4 : 1)
            .animation(active ? .easeInOut(duration: 0.75).repeatForever(autoreverses: true) : .default, value: dim)
            .onAppear { if active && Motion.ambient { dim = true } }
            .onChange(of: active) { _, on in dim = on && Motion.ambient }
    }
}

// MARK: - Buttons

enum TButtonKind { case primary, destructive, outline, secondary, ghost }
enum TButtonSize { case sm, md, lg, icon }

struct TButtonStyle: ButtonStyle {
    var kind: TButtonKind = .primary
    var size: TButtonSize = .md
    var fullWidth = false
    @Environment(\.isEnabled) private var enabled

    func makeBody(configuration: Configuration) -> some View {
        let h: CGFloat = switch size { case .sm: 32; case .md: 36; case .lg: 44; case .icon: 36 }
        configuration.label
            .font(.scaled(size == .sm ? 12 : 14, weight: .medium))
            .lineLimit(1)
            .padding(.horizontal, size == .icon ? 0 : (size == .sm ? 10 : 14))
            .frame(minWidth: size == .icon ? h : nil, maxWidth: fullWidth ? .infinity : nil, minHeight: h)
            .foregroundStyle(fg)
            .background(bg(configuration.isPressed), in: RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous))
            .overlay {
                if kind == .outline {
                    RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous).strokeBorder(Theme.border, lineWidth: 1)
                }
            }
            .contentShape(RoundedRectangle(cornerRadius: Theme.controlRadius))
            .opacity(enabled ? 1 : 0.5)
            .scaleEffect(configuration.isPressed ? 0.98 : 1)
            .animation(.easeOut(duration: 0.12), value: configuration.isPressed)
    }

    private var fg: Color {
        switch kind {
        case .primary: Theme.onPrimary
        case .destructive: Theme.onDestructive
        case .outline, .secondary, .ghost: Theme.foreground
        }
    }

    private func bg(_ pressed: Bool) -> Color {
        switch kind {
        case .primary: Theme.primary.opacity(pressed ? 0.85 : 1)
        case .destructive: Theme.destructive.opacity(pressed ? 0.85 : 1)
        case .outline: pressed ? Theme.muted : Theme.background
        case .secondary: Theme.muted.opacity(pressed ? 0.8 : 1)
        case .ghost: pressed ? Theme.muted : .clear
        }
    }
}

extension ButtonStyle where Self == TButtonStyle {
    static func t(_ kind: TButtonKind = .primary, _ size: TButtonSize = .md, full: Bool = false) -> TButtonStyle {
        TButtonStyle(kind: kind, size: size, fullWidth: full)
    }
}

// MARK: - Pills & badges

/// Task-card group pill: border accent α .92, text accent, 10 px medium.
struct GroupPill: View {
    var name: String
    var hex: String
    var body: some View {
        Text(name)
            .font(.pill10)
            .lineLimit(1)
            .truncationMode(.tail)
            .foregroundStyle(Color(hex: hex))
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .overlay(Capsule().strokeBorder(Color(hex: hex, opacity: 0.92), lineWidth: 1))
            .frame(maxWidth: 176, alignment: .trailing)
            .fixedSize(horizontal: true, vertical: false)
    }
}

/// Detail/billing badge: text accent on accent α .2.
struct AccentBadge: View {
    var text: String
    var hex: String
    var body: some View {
        Text(text)
            .font(.scaled(12, weight: .semibold))
            .lineLimit(1)
            .foregroundStyle(Color(hex: hex))
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(Color(hex: hex, opacity: 0.2), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
    }
}

enum BadgeKind { case primary, secondary, outline, destructive }

struct Badge: View {
    var text: String
    var kind: BadgeKind = .secondary
    var mono = false
    var body: some View {
        Text(text)
            .font(mono ? .mono(12, weight: .semibold) : .scaled(12, weight: .semibold))
            .lineLimit(1)
            .foregroundStyle(kind == .primary ? Theme.onPrimary : kind == .destructive ? Theme.onDestructive : Theme.foreground)
            .padding(.horizontal, 8)
            .padding(.vertical, 2)
            .background(bg, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay {
                if kind == .outline { RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Theme.border) }
            }
    }
    var bg: Color {
        switch kind {
        case .primary: Theme.primary
        case .secondary: Theme.muted
        case .outline: .clear
        case .destructive: Theme.destructive
        }
    }
}

struct AccentDot: View {
    var hex: String
    var size: CGFloat = 8
    var body: some View { Circle().fill(Color(hex: hex)).frame(width: size, height: size) }
}

// MARK: - Wordmark

struct Wordmark: View {
    var size: CGFloat = 18
    var body: some View {
        (Text("Trackify").foregroundStyle(Theme.foreground) + Text(".").foregroundStyle(Theme.green))
            .font(.scaled(size, weight: .bold))
            .accessibilityLabel("Trackify")
    }
}

// MARK: - Connection dot

enum ConnectionLook: Equatable {
    case connected, reconnecting, disconnected
    var label: String { switch self { case .connected: "Connected"; case .reconnecting: "Reconnecting"; case .disconnected: "Disconnected" } }
    var color: Color { switch self { case .connected: Theme.green; case .reconnecting: Theme.amber400; case .disconnected: Theme.red } }
}

struct ConnectionDot: View {
    var look: ConnectionLook
    @State private var pulse = false
    var body: some View {
        Circle()
            .fill(look.color)
            .frame(width: 7, height: 7)
            .shadow(color: look == .connected ? look.color.opacity(0.7) : .clear, radius: 3)
            .scaleEffect(pulse && look != .reconnecting ? 1.1 : 1)
            .opacity(pulse && look != .reconnecting ? 0.7 : 1)
            .animation(.easeInOut(duration: look == .disconnected ? 1.6 : 1).repeatForever(autoreverses: true), value: pulse)
            .onAppear { pulse = Motion.ambient }
            .help(look.label)
            .accessibilityLabel(look.label)
    }
}

// MARK: - Skeleton / empty / error

struct Skeleton: View {
    var height: CGFloat = 16
    var width: CGFloat? = nil
    @State private var on = false
    var body: some View {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
            .fill(Theme.primary.opacity(0.1))
            .frame(width: width, height: height)
            .frame(maxWidth: width == nil ? .infinity : nil, alignment: .leading)
            .opacity(on ? 0.5 : 1)
            .animation(.easeInOut(duration: 1).repeatForever(autoreverses: true), value: on)
            .onAppear { on = Motion.ambient }
            .accessibilityHidden(true)
    }
}

struct EmptyState: View {
    var icon: String? = nil
    var text: String
    var body: some View {
        VStack(spacing: 8) {
            if let icon { Image(systemName: icon).font(.scaled(28)).foregroundStyle(Theme.mutedForeground) }
            Text(text).font(.body14).foregroundStyle(Theme.mutedForeground).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }
}

/// Destructive alert with a title, message and dismiss X (web "Failed to save").
struct ErrorAlert: View {
    var title: String
    var message: String
    var onDismiss: (() -> Void)? = nil
    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.circle").foregroundStyle(Theme.destructive)
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.scaled(14, weight: .semibold)).foregroundStyle(Theme.destructive)
                Text(message).font(.scaled(13)).foregroundStyle(Theme.destructive.opacity(0.9)).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            if let onDismiss {
                Button(action: onDismiss) { Image(systemName: "xmark").font(.scaled(12, weight: .semibold)) }
                    .buttonStyle(.plain)
                    .foregroundStyle(Theme.destructive)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
                    .accessibilityLabel("Dismiss")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.destructive.opacity(0.08), in: RoundedRectangle(cornerRadius: Theme.controlRadius))
        .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius).strokeBorder(Theme.destructive.opacity(0.5)))
    }
}

struct InlineError: View {
    var text: String?
    var body: some View {
        if let text, !text.isEmpty {
            Text(text).font(.scaled(13)).foregroundStyle(Theme.destructive).fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - Page header

struct PageHeader<Trailing: View>: View {
    var title: String
    var subtitle: String?
    @ViewBuilder var trailing: () -> Trailing

    init(_ title: String, subtitle: String? = nil, @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() }) {
        self.title = title; self.subtitle = subtitle; self.trailing = trailing
    }

    var body: some View {
        #if os(iOS)
        // Phones/tablets: no web hero header — the title goes in the navigation bar.
        Color.clear.frame(height: 0)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
        #else
        header
        #endif
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title).font(.pageTitle).tracking(-0.3).foregroundStyle(Theme.foreground)
                if let subtitle { Text(subtitle).font(.scaled(14)).foregroundStyle(Theme.mutedForeground) }
            }
            Spacer(minLength: 0)
            trailing()
        }
    }
}

// MARK: - Segmented control (shadcn tabs look)

struct Segmented<T: Hashable>: View {
    var items: [(T, String)]
    @Binding var selection: T
    var compact = false

    var body: some View {
        // Equal-width segments when they fit; otherwise (large text) a scrollable strip — never truncated labels.
        ViewThatFits(in: .horizontal) {
            strip(fill: true)
            ScrollView(.horizontal, showsIndicators: false) { strip(fill: false) }
        }
    }

    private func strip(fill: Bool) -> some View {
        HStack(spacing: 2) {
            ForEach(items, id: \.0) { item in
                let on = item.0 == selection
                Button {
                    selection = item.0   // instant: no cross-fade between categories
                } label: {
                    Text(item.1)
                        .font(.scaled(compact ? 12 : 13, weight: .medium))
                        .lineLimit(1)
                        .fixedSize()
                        .foregroundStyle(on ? Theme.foreground : Theme.mutedForeground)
                        .padding(.horizontal, compact ? 8 : 10)
                        .frame(maxWidth: fill ? .infinity : nil, minHeight: compact ? 26 : 30)
                        .background(on ? Theme.background : .clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                        .shadow(color: on ? .black.opacity(0.08) : .clear, radius: 1, y: 1)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(on ? .isSelected : [])
            }
        }
        .padding(3)
        .background(Theme.muted, in: RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous))
    }
}

/// Chip row (Visualizations range chips: selected = zinc-900 fill).
struct ChipRow<T: Hashable>: View {
    var items: [(T, String)]
    @Binding var selection: T
    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(items, id: \.0) { item in
                    let on = item.0 == selection
                    Button { selection = item.0 } label: {
                        Text(item.1)
                            .font(.scaled(13, weight: .medium))
                            .padding(.horizontal, 12)
                            .frame(minHeight: 30)
                            .foregroundStyle(on ? Theme.onPrimary : Theme.foreground)
                            .background(on ? Theme.primary : Theme.background, in: Capsule())
                            .overlay(Capsule().strokeBorder(on ? .clear : Theme.border))
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(on ? .isSelected : [])
                }
            }
        }
    }
}

// MARK: - Text field

struct TField: View {
    var placeholder: String
    @Binding var text: String
    var secure = false
    var mono = false

    var body: some View {
        Group {
            if secure { SecureField(placeholder, text: $text) } else { TextField(placeholder, text: $text) }
        }
        .textFieldStyle(.plain)
        .font(mono ? .mono(15) : .scaled(15))
        .padding(.horizontal, 12)
        .frame(minHeight: 40)
        .background(Theme.background, in: RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous).strokeBorder(Theme.border))
    }
}

struct FieldLabel: View {
    var text: String
    var body: some View { Text(text).font(.scaled(14, weight: .medium)).foregroundStyle(Theme.foreground) }
}

// MARK: - Misc

struct Hairline: View {
    var body: some View { Rectangle().fill(Theme.border).frame(height: 1) }
}

/// Colour swatch legend item.
struct LegendItem: View {
    var hex: String
    var name: String
    var body: some View {
        HStack(spacing: 6) {
            RoundedRectangle(cornerRadius: 2).fill(Color(hex: hex)).frame(width: 12, height: 12)
            Text(name).font(.scaled(13)).foregroundStyle(Theme.mutedForeground).lineLimit(1)
        }
    }
}

/// Wraps content into lines (legends, badge rows). Measuring and placing share one line-breaking pass.
struct FlowLayout: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 6

    private func lines(_ subviews: Subviews, maxWidth: CGFloat) -> [[(Int, CGSize)]] {
        var out: [[(Int, CGSize)]] = [[]]
        var x: CGFloat = 0
        for (i, s) in subviews.enumerated() {
            var sz = s.sizeThatFits(.unspecified)
            if maxWidth.isFinite && sz.width > maxWidth {
                sz = s.sizeThatFits(ProposedViewSize(width: maxWidth, height: nil))
                sz.width = min(sz.width, maxWidth)
            }
            if !out[out.count - 1].isEmpty && x + sz.width > maxWidth {
                out.append([])
                x = 0
            }
            out[out.count - 1].append((i, sz))
            x += sz.width + spacing
        }
        return out
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let maxW = proposal.width ?? .infinity
        let ls = lines(subviews, maxWidth: maxW)
        let widest = ls.map { l in l.reduce(0) { $0 + $1.1.width } + spacing * CGFloat(max(0, l.count - 1)) }.max() ?? 0
        let h = ls.reduce(0) { $0 + ($1.map(\.1.height).max() ?? 0) } + lineSpacing * CGFloat(max(0, ls.count - 1))
        return CGSize(width: maxW.isFinite ? maxW : widest, height: h)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for l in lines(subviews, maxWidth: bounds.width) {
            var x = bounds.minX
            let lh = l.map(\.1.height).max() ?? 0
            for (i, sz) in l {
                subviews[i].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(sz))
                x += sz.width + spacing
            }
            y += lh + lineSpacing
        }
    }
}

enum Clipboard {
    static func copy(_ s: String) {
        #if canImport(UIKit)
        UIPasteboard.general.string = s
        #elseif canImport(AppKit)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(s, forType: .string)
        #endif
    }
}

/// Copy button that shows a check for 1.6 s.
struct CopyButton: View {
    var text: () -> String
    var label: String = "Copy"
    var showLabel = false
    @State private var copied = false
    var body: some View {
        Button {
            Clipboard.copy(text())
            copied = true
            Task { try? await Task.sleep(nanoseconds: 1_600_000_000); copied = false }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                    .foregroundStyle(copied ? Theme.emerald : Theme.mutedForeground)
                if showLabel { Text(copied ? "Copied" : label) }
            }
            .font(.scaled(13, weight: .medium))
            .frame(minWidth: 32, minHeight: 32)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

extension View {
    /// Tracks this view's width into a binding (initial + changes).
    func readWidth(_ width: Binding<CGFloat>) -> some View {
        background(GeometryReader { g in
            Color.clear
                .onAppear { width.wrappedValue = g.size.width }
                .onChange(of: g.size.width) { _, w in width.wrappedValue = w }
        })
    }
}
