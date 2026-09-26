import SwiftUI
import TrackifyKit
#if canImport(UIKit)
import UIKit
typealias PlatformColor = UIColor
#elseif canImport(AppKit)
import AppKit
typealias PlatformColor = NSColor
#endif

// MARK: - Colour tokens (NATIVE_SPEC §4)

extension Color {
    /// `#RRGGBB` → Color (black if invalid).
    init(hex: String, opacity: Double = 1) {
        let c = Accent.rgb(hex)
        self.init(.sRGB, red: c.r, green: c.g, blue: c.b, opacity: opacity)
    }

    init(rgb: UInt32, opacity: Double = 1) {
        self.init(.sRGB, red: Double((rgb >> 16) & 255) / 255, green: Double((rgb >> 8) & 255) / 255,
                  blue: Double(rgb & 255) / 255, opacity: opacity)
    }

    /// Light/dark dynamic colour.
    init(light: UInt32, dark: UInt32) {
        #if canImport(UIKit)
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? PlatformColor(rgb: dark) : PlatformColor(rgb: light) })
        #else
        self.init(nsColor: NSColor(name: nil) { appearance in
            let match = appearance.bestMatch(from: [.aqua, .darkAqua, .vibrantLight, .vibrantDark])
            return (match == .darkAqua || match == .vibrantDark) ? PlatformColor(rgb: dark) : PlatformColor(rgb: light)
        })
        #endif
    }
}

extension PlatformColor {
    convenience init(rgb: UInt32, alpha: CGFloat = 1) {
        self.init(red: CGFloat((rgb >> 16) & 255) / 255, green: CGFloat((rgb >> 8) & 255) / 255,
                  blue: CGFloat(rgb & 255) / 255, alpha: alpha)
    }
}

enum Theme {
    static let background = Color(light: 0xFFFFFF, dark: 0x0A0A0A)
    static let foreground = Color(light: 0x0A0A0A, dark: 0xFAFAFA)
    static let card = Color(light: 0xFFFFFF, dark: 0x111111)
    static let primary = Color(light: 0x171717, dark: 0xFAFAFA)
    static let onPrimary = Color(light: 0xFAFAFA, dark: 0x171717)
    static let muted = Color(light: 0xF5F5F5, dark: 0x262626)
    static let mutedForeground = Color(light: 0x737373, dark: 0xA3A3A3)
    static let border = Color(light: 0xE5E5E5, dark: 0x262626)
    static let destructive = Color(rgb: 0xEF4444)
    static let onDestructive = Color(rgb: 0xFAFAFA)
    static let emerald = Color(rgb: 0x10B981)
    static let emeraldText = Color(light: 0x047857, dark: 0x34D399)   // emerald-700 / emerald-400
    static let green = Color(rgb: 0x22C55E)
    static let amber = Color(rgb: 0xF59E0B)
    static let amber400 = Color(rgb: 0xFBBF24)
    static let red = Color(rgb: 0xEF4444)
    static let blue = Color(rgb: 0x3B82F6)
    static let pending = Color(rgb: 0xEAB308)            // yellow-500 ring
    static let busyBlock = Color(rgb: 0xA3A3A3).opacity(0.7) // neutral-400/70
    /// Heat level 0 in dark mode is muted (NATIVE_SPEC §4).
    static let heatEmpty = Color(light: 0xE8EEE9, dark: 0x262626)
    /// Race stage background.
    static let stage = Color(light: 0xF7F7F5, dark: 0x141414)
    static let stageInk = Color(light: 0x27272A, dark: 0xF4F4F5)   // zinc-800
    static let stageMuted = Color(rgb: 0xA1A1AA)                   // zinc-400
    static let stageTrack = Color(light: 0xE4E4E7, dark: 0x27272A).opacity(0.5)

    static func heat(_ level: Int) -> Color {
        level <= 0 ? heatEmpty : Color(hex: HeatScale.colors[level])
    }

    static func rank(_ index: Int) -> Color? {
        index < Accent.rankColors.count ? Color(hex: Accent.rankColors[index]) : nil
    }

    // Radii
    static let cardRadius: CGFloat = 12
    static let controlRadius: CGFloat = 8
}

// MARK: - Typography (scales with Dynamic Type)

/// Maps design sizes (web px) to Dynamic Type: body-relative factor, damped for display sizes so clocks don't explode.
enum DynamicScale {
    static func value(_ size: CGFloat) -> CGFloat {
        #if os(iOS)
        let factor = UIFontMetrics(forTextStyle: .body).scaledValue(for: 17) / 17
        let capped = size >= 24 ? min(factor, 1.3) : min(factor, 1.9)
        return (size * max(capped, 0.85)).rounded()
        #else
        return size
        #endif
    }
}

extension Font {
    /// System font at a design size, scaled with the user's text size.
    static func scaled(_ size: CGFloat, weight: Font.Weight = .regular, design: Font.Design = .default) -> Font {
        .system(size: DynamicScale.value(size), weight: weight, design: design)
    }
    /// Running clock (web: mono bold 36 px, tabular).
    static var clock: Font { .scaled(36, weight: .bold, design: .monospaced) }
    static var dialogDuration: Font { .scaled(36, weight: .semibold, design: .monospaced) }
    static func mono(_ size: CGFloat, weight: Font.Weight = .regular) -> Font { .scaled(size, weight: weight, design: .monospaced) }
    static var pageTitle: Font { .scaled(24, weight: .bold) }
    static var cardTitle: Font { .scaled(16, weight: .semibold) }
    static var body14: Font { .scaled(14) }
    static var caption12: Font { .scaled(12) }
    static var label11: Font { .scaled(11, weight: .medium) }
    static var pill10: Font { .scaled(10, weight: .medium) }
}

extension View {
    /// Monospaced digits for times & totals.
    func tabular() -> some View { monospacedDigit() }
}
