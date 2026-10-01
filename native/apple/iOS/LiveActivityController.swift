import Foundation
import TrackifyKit
#if canImport(ActivityKit)
import ActivityKit
#endif

/// Starts/updates/ends the Live Activity from the timer state.
@MainActor
final class LiveActivityController {
    static let shared = LiveActivityController()
    private weak var model: AppModel?

    func attach(to model: AppModel) {
        self.model = model
        model.timerObservers.append { [weak self] running in
            Task { @MainActor in self?.sync(running) }
        }
    }

    func sync(_ running: RunningTimer?) {
        #if canImport(ActivityKit)
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let activities = Activity<TrackifyActivityAttributes>.activities
        guard let running, let model else {
            for a in activities {
                Task { await a.end(nil, dismissalPolicy: .immediate) }
            }
            return
        }
        let task = model.task(running.taskId)
        let snapTask = SnapshotStore.shared.load().tasks.first { $0.id == running.taskId }
        let state = TrackifyActivityAttributes.ContentState(
            taskId: running.taskId,
            taskName: task?.name ?? snapTask?.name ?? "Tracking",
            accentHex: task?.accentHex ?? snapTask?.accentHex ?? Accent.taskAccentHex(running.taskId),
            startTime: Date(ms: running.startTime),
            pending: running.pending)
        let content = ActivityContent(state: state, staleDate: nil)
        if let current = activities.first {
            for extra in activities.dropFirst() { Task { await extra.end(nil, dismissalPolicy: .immediate) } }
            if current.content.state != state { Task { await current.update(content) } }
        } else {
            _ = try? Activity.request(attributes: TrackifyActivityAttributes(), content: content, pushType: nil)
        }
        #endif
    }

    /// Name may arrive after the timer (tasks refresh) — refresh the activity text.
    func refreshNames() {
        sync(model?.running)
    }
}
