import Foundation
#if os(iOS) && canImport(ActivityKit)
import ActivityKit

/// Live Activity for the running timer (NATIVE_SPEC §5 iOS). Elapsed is rendered locally with `Text(timerInterval:)`.
struct TrackifyActivityAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        var taskId: String
        var taskName: String
        var accentHex: String
        var startTime: Date
        var pending: Bool
    }
    /// Constant for the whole activity.
    var startedFrom: String = "app"
}
#endif
