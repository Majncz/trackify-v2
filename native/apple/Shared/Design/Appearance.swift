import SwiftUI
import TrackifyKit
#if os(macOS)
import AppKit
#endif

/// User-chosen light/dark mode ("system" follows the device). Separate settings for the app and the widgets.
enum AppearanceChoice: String, CaseIterable, Identifiable {
    case system, light, dark
    var id: String { rawValue }
    var label: String { self == .system ? "System" : self == .light ? "Light" : "Dark" }
    var colorScheme: ColorScheme? { self == .light ? .light : self == .dark ? .dark : nil }

    static var app: AppearanceChoice {
        AppearanceChoice(rawValue: AppGroup.defaults.string(forKey: SharedKeys.appAppearance) ?? "") ?? .system
    }
    static var widgets: AppearanceChoice {
        AppearanceChoice(rawValue: AppGroup.defaults.string(forKey: SharedKeys.widgetAppearance) ?? "") ?? .system
    }

    #if os(macOS)
    /// macOS: menu-bar panel and dashboard windows follow NSApp.appearance.
    @available(macOSApplicationExtension, unavailable)
    static func applyToMacApp() {
        switch app {
        case .system: NSApp.appearance = nil
        case .light: NSApp.appearance = NSAppearance(named: .aqua)
        case .dark: NSApp.appearance = NSAppearance(named: .darkAqua)
        }
    }
    #endif
}

extension View {
    /// Force a color scheme only when one is chosen (nil = follow the system).
    @ViewBuilder func forcedColorScheme(_ scheme: ColorScheme?) -> some View {
        if let scheme { self.environment(\.colorScheme, scheme) } else { self }
    }
}
