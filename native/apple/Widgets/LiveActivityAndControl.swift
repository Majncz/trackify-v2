#if os(iOS)
import WidgetKit
import SwiftUI
import ActivityKit
import AppIntents
import TrackifyKit

/// Live Activity + Dynamic Island (NATIVE_SPEC §5 iOS).
struct TrackifyLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TrackifyActivityAttributes.self) { context in
            LiveActivityLockScreen(state: context.state)
                .activityBackgroundTint(Theme.card)
                .activitySystemActionForegroundColor(Theme.foreground)
                .widgetURL(URL(string: "trackify://task/\(context.state.taskId)"))
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    HStack(spacing: 6) {
                        Circle().fill(Color(hex: context.state.accentHex)).frame(width: 9, height: 9)
                        Text(context.state.taskName).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                    }
                    .padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(timerInterval: context.state.startTime...Date.distantFuture, countsDown: false)
                        .font(.system(size: 15, weight: .semibold, design: .monospaced))
                        .monospacedDigit()
                        .multilineTextAlignment(.trailing)
                        .frame(maxWidth: 90)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    HStack {
                        Text(timerInterval: context.state.startTime...Date.distantFuture, countsDown: false)
                            .font(.system(size: 34, weight: .bold, design: .monospaced))
                            .monospacedDigit()
                        Spacer()
                        Button(intent: StopTimerIntent()) {
                            Label("Stop", systemImage: "square.fill")
                                .font(.system(size: 15, weight: .semibold))
                                .padding(.horizontal, 16).padding(.vertical, 9)
                                .foregroundStyle(.white)
                                .background(Theme.destructive, in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(.horizontal, 4)
                }
            } compactLeading: {
                Circle().fill(Color(hex: context.state.accentHex)).frame(width: 10, height: 10)
            } compactTrailing: {
                Text(timerInterval: context.state.startTime...Date.distantFuture, countsDown: false)
                    .font(.system(size: 14, weight: .semibold, design: .monospaced))
                    .monospacedDigit()
                    .frame(maxWidth: 64)
            } minimal: {
                Circle().fill(Color(hex: context.state.accentHex)).frame(width: 10, height: 10)
            }
            .widgetURL(URL(string: "trackify://task/\(context.state.taskId)"))
            .keylineTint(Color(hex: context.state.accentHex))
        }
    }
}

struct LiveActivityLockScreen: View {
    let state: TrackifyActivityAttributes.ContentState
    var body: some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Circle().fill(Color(hex: state.accentHex)).frame(width: 8, height: 8)
                    Text(state.pending ? "Syncing…" : "Tracking").font(.system(size: 12, weight: .medium)).foregroundStyle(Theme.mutedForeground)
                    Spacer(minLength: 0)
                    Wordmark(size: 12)
                }
                Text(state.taskName).font(.system(size: 17, weight: .semibold)).lineLimit(1).foregroundStyle(Theme.foreground)
                Text(timerInterval: state.startTime...Date.distantFuture, countsDown: false)
                    .font(.system(size: 34, weight: .bold, design: .monospaced))
                    .monospacedDigit()
                    .foregroundStyle(Theme.foreground)
            }
            Button(intent: StopTimerIntent()) {
                VStack(spacing: 4) {
                    Image(systemName: "square.fill").font(.system(size: 16, weight: .bold))
                    Text("Stop").font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(.white)
                .frame(width: 64, height: 64)
                .background(Theme.destructive, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding(16)
    }
}

/// Control Center / Lock Screen control (iOS 18): toggle = stop / start last task.
@available(iOS 18.0, *)
struct TimerControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "TrackifyTimerControl", provider: TimerControlProvider()) { value in
            ControlWidgetToggle(isOn: value.running, action: ToggleTimerIntent()) {
                Label(value.running ? value.name : "Trackify", systemImage: value.running ? "stop.circle.fill" : "play.circle")
            } valueLabel: { on in
                Text(on ? "Tracking" : (value.name.isEmpty ? "Start" : "Start \(value.name)"))
            }
            .tint(.green)
        }
        .displayName("Trackify Timer")
        .description("Start your last task or stop the running timer.")
    }
}

@available(iOS 18.0, *)
struct TimerControlProvider: ControlValueProvider {
    struct Value { var running: Bool; var name: String }
    var previewValue: Value { Value(running: false, name: "Learning Swift") }
    func currentValue() async throws -> Value {
        let snap = TimerProvider.current()
        if let r = snap.running { return Value(running: true, name: r.taskName) }
        return Value(running: false, name: snap.lastTask?.name ?? "")
    }
}
#endif
