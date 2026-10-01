import AppIntents
import TrackifyKit

/// Siri / Shortcuts / Spotlight / Action button.
struct TrackifyShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: StartTaskIntent(),
                    phrases: ["Start \(\.$task) in \(.applicationName)", "Track \(\.$task) with \(.applicationName)"],
                    shortTitle: "Start Task", systemImageName: "play.fill")
        AppShortcut(intent: StopTimerIntent(),
                    phrases: ["Stop \(.applicationName)", "Stop the \(.applicationName) timer"],
                    shortTitle: "Stop Timer", systemImageName: "stop.fill")
        AppShortcut(intent: CurrentTimerIntent(),
                    phrases: ["What am I tracking in \(.applicationName)", "\(.applicationName) current timer"],
                    shortTitle: "Current Timer", systemImageName: "timer")
    }
}
