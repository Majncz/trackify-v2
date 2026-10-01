import Foundation
import UserNotifications
import TrackifyKit

/// Optional local notification "Still tracking X?" after N hours (setting, default off).
@MainActor
enum Reminder {
    static let id = "trackify.still-tracking"

    static var hours: Int {
        get { AppGroup.defaults.integer(forKey: SharedKeys.reminderHours) }
        set { AppGroup.defaults.set(newValue, forKey: SharedKeys.reminderHours) }
    }

    static func attach(to model: AppModel) {
        model.timerObservers.append { running in
            Task { @MainActor in schedule(running, model: model) }
        }
    }

    static func requestPermission() async -> Bool {
        (try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])) ?? false
    }

    static func schedule(_ running: RunningTimer?, model: AppModel) {
        let center = UNUserNotificationCenter.current()
        center.removePendingNotificationRequests(withIdentifiers: [id])
        guard let running, hours > 0 else { return }
        let fireAt = Date(ms: running.startTime).addingTimeInterval(TimeInterval(hours * 3600))
        let interval = fireAt.timeIntervalSinceNow
        guard interval > 5 else { return }
        let content = UNMutableNotificationContent()
        let name = model.task(running.taskId)?.name ?? "your task"
        content.title = "Still tracking \(name)?"
        content.body = "The timer has been running for \(hours) hour\(hours == 1 ? "" : "s")."
        content.sound = .default
        let req = UNNotificationRequest(identifier: id, content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false))
        center.add(req)
    }
}
