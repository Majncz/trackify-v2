import SwiftUI
import TrackifyKit

/// Sheet chrome shared by the timer dialogs.
struct SheetScaffold<Content: View>: View {
    var title: String
    var onClose: () -> Void
    @ViewBuilder var content: () -> Content

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline) {
                Text(title).font(.scaled(18, weight: .semibold)).lineLimit(2)
                Spacer()
                Button(action: onClose) {
                    Image(systemName: "xmark").font(.scaled(13, weight: .semibold)).foregroundStyle(Theme.mutedForeground)
                        .frame(width: 32, height: 32).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .keyboardShortcut(.cancelAction)
                .accessibilityLabel("Close")
            }
            .padding(.bottom, 12)
            content()
        }
        .padding(20)
        .frame(maxWidth: 512)
        #if os(macOS)
        .frame(minWidth: 460)
        #endif
        .background(Theme.card)
    }
}

// MARK: - Fix this session (adjust running timer) — WEB_AUDIT §1.3.3

struct FixSessionSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let running: RunningTimer
    @State private var openedAt: Int64 = 0
    @State private var slider: SessionSliderModel
    @State private var now: Int64 = Date().ms
    @State private var saving = false
    @State private var error: String?
    @State private var dragging = false

    init(running: RunningTimer) {
        self.running = running
        let opened = Date().ms
        _openedAt = State(initialValue: opened)
        _slider = State(initialValue: SessionSliderModel(
            start: running.startTime, end: opened, endIsLive: true, allowLiveEnd: true, placeInGaps: false,
            viewFrom: SessionMath.initialViewFrom(start: running.startTime, openedAt: opened), viewTo: opened,
            earliest: opened - MAX_LOOKBACK_MS, horizon: opened, busy: []))
    }

    private var stillRunning: Bool { slider.endIsLive }
    private var duration: Int64 { max(0, (stillRunning ? now : slider.end) - slider.start) }

    var body: some View {
        SheetScaffold(title: "Fix this session", onClose: { dismiss() }) {
            VStack(spacing: 20) {
                VStack(spacing: 4) {
                    Text(Fmt.durationWords(duration)).font(.dialogDuration).tabular().tracking(-0.5)
                        .contentTransition(.numericText())
                    Text(stillRunning ? "Started \(clock(slider.start)) · still running" : "Started \(clock(slider.start)) · stopped \(clock(slider.end))")
                        .font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
                }
                .frame(maxWidth: .infinity)

                SessionRangeSlider(model: $slider, disabled: saving, onDraggingChange: { dragging = $0 })
                    .accessibilityIdentifier("sessionSlider")

                HStack(alignment: .top) {
                    StampField(label: "Started", value: slider.start, min: openedAt - MAX_LOOKBACK_MS, max: slider.end - MINUTE_MS, now: now) { next in
                        let c = SessionMath.clampTypedStart(next, end: slider.end, busy: slider.busy, earliest: openedAt - MAX_LOOKBACK_MS)
                        slider.start = c
                        if c < slider.viewFrom { slider.viewFrom = c }
                    }
                    Spacer()
                    StampField(label: stillRunning ? "Until · now" : "Until", value: slider.end, min: slider.start + MINUTE_MS, max: openedAt,
                               alignRight: true, now: now) { next in
                        slider.end = SessionMath.clampTypedEnd(next, start: slider.start, busy: slider.busy, latest: openedAt)
                        slider.endIsLive = false
                    }
                }

                InlineError(text: error)

                HStack(spacing: 8) {
                    Spacer()
                    Button("Cancel") { dismiss() }.buttonStyle(.t(.outline)).disabled(saving)
                    Button(saving ? "Saving…" : (stillRunning ? "Save start time" : "Stop \(Fmt.agoLabel(slider.end, now: now))"), action: save)
                        .buttonStyle(.t(.primary))
                        .disabled(saving)
                        .keyboardShortcut(.defaultAction)
                        .accessibilityIdentifier("fixSave")
                }
            }
        }
        .onAppear { slider.busy = SessionMath.busySpans(tasks: model.tasks) }
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                if !dragging { now = Date().ms }
            }
        }
        .interactiveDismissDisabled(dragging)
    }

    private func save() {
        let moved = abs(slider.start - running.startTime) >= 500
        let newStart = moved ? snapMinute(slider.start) : slider.start
        if !stillRunning {
            model.stop(at: snapMinute(slider.end), startOverride: moved ? newStart : nil)
            dismiss()
            return
        }
        guard moved else { dismiss(); return }
        saving = true
        error = nil
        Task {
            do {
                try await model.adjustStart(newStart)
                dismiss()
            } catch let e as APIError {
                error = e.message
            } catch { self.error = error.localizedDescription }
            saving = false
        }
    }
}

// MARK: - Add time to {task} (log past) — WEB_AUDIT §1.3.4

struct LogPastSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss

    let task: TrackifyTask
    @State private var openedAt: Int64 = Date().ms
    @State private var slider = SessionSliderModel(start: 0, end: 0, endIsLive: false, allowLiveEnd: false, placeInGaps: true,
                                                   viewFrom: 0, viewTo: 1, earliest: 0, horizon: 1, busy: [])
    @State private var seeded = false
    @State private var now: Int64 = Date().ms
    @State private var saving = false
    @State private var error: String?
    @State private var dragging = false

    private var earliest: Int64 { openedAt - MAX_LOOKBACK_MS }
    private var duration: Int64 { max(0, slider.end - slider.start) }

    var body: some View {
        SheetScaffold(title: "Add time to \(task.name)", onClose: { dismiss() }) {
            VStack(spacing: 20) {
                VStack(spacing: 4) {
                    Text(Fmt.durationWords(duration)).font(.dialogDuration).tabular().tracking(-0.5)
                    Text("\(clock(slider.start)) → \(openedAt - slider.end < 90_000 ? "just now" : clock(slider.end))")
                        .font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
                }
                .frame(maxWidth: .infinity)

                SessionRangeSlider(model: $slider, disabled: saving, onDraggingChange: { dragging = $0 })
                    .accessibilityIdentifier("pastSlider")

                HStack(alignment: .top) {
                    StampField(label: "From", value: slider.start, min: earliest, max: openedAt, now: now) { jump(to: $0, asEnd: false) }
                    Spacer()
                    StampField(label: "Until", value: slider.end, min: earliest, max: openedAt, alignRight: true, now: now) { jump(to: $0, asEnd: true) }
                }

                InlineError(text: error)

                HStack(spacing: 8) {
                    Spacer()
                    Button("Cancel") { dismiss() }.buttonStyle(.t(.outline)).disabled(saving)
                    Button(saving ? "Adding…" : "Add \(Fmt.durationWords(duration))", action: save)
                        .buttonStyle(.t(.primary))
                        .disabled(saving || duration < MINUTE_MS)
                        .keyboardShortcut(.defaultAction)
                        .accessibilityIdentifier("logPastSave")
                }
            }
        }
        .onAppear(perform: seed)
        .task {
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_000_000_000)
                now = Date().ms
            }
        }
        .interactiveDismissDisabled(dragging)
    }

    private func seed() {
        guard !seeded else { return }
        seeded = true
        let n = Date().ms
        openedAt = n
        now = n
        var busy = SessionMath.busySpans(tasks: model.tasks)
        if let r = model.running {
            busy.append(TimeSpan(from: r.startTime, to: n, name: r.taskId == task.id ? "This timer" : "Running timer"))
        }
        let preferred = SessionMath.typicalDuration(task.events)
        let guess = SessionMath.suggestPastRange(now: n, busy: SessionMath.busySpans(tasks: model.tasks),
                                                 runningStart: model.running?.startTime, preferred: preferred)
        let w = SessionMath.viewAround(start: guess.start, end: guess.end, earliest: n - MAX_LOOKBACK_MS, latest: n)
        slider = SessionSliderModel(start: guess.start, end: guess.end, endIsLive: false, allowLiveEnd: false, placeInGaps: true,
                                    viewFrom: w.viewFrom, viewTo: w.viewTo, earliest: n - MAX_LOOKBACK_MS, horizon: n, busy: busy)
    }

    private func jump(to anchor: Int64, asEnd: Bool) {
        guard let placed = SessionMath.relocateToTime(anchor: anchor, duration: max(MINUTE_MS, slider.end - slider.start), asEnd: asEnd,
                                                      earliest: earliest, latest: openedAt, busy: slider.busy) else { return }
        slider.start = placed.start
        slider.end = placed.end
        let w = SessionMath.viewAround(start: placed.start, end: placed.end, earliest: earliest, latest: openedAt)
        slider.viewFrom = w.viewFrom
        slider.viewTo = w.viewTo
    }

    private func save() {
        saving = true
        error = nil
        Task {
            do {
                try await model.logPast(taskId: task.id, from: slider.start, to: slider.end)
                Haptics.success()
                dismiss()
            } catch let e as APIError {
                error = e.message
            } catch { self.error = "Could not add that time" }
            saving = false
        }
    }
}

// MARK: - New task

struct NewTaskSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    var startAfterCreate = false
    @State private var name = ""
    @State private var busy = false
    @State private var error: String?
    @FocusState private var focused: Bool

    var body: some View {
        SheetScaffold(title: "Create New Task", onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 16) {
                TField(placeholder: "Enter task name...", text: $name)
                    .focused($focused)
                    .submitLabel(.done)
                    .onSubmit(create)
                    .accessibilityIdentifier("newTaskName")
                InlineError(text: error)
                HStack(spacing: 8) {
                    Spacer()
                    Button("Cancel") { dismiss() }.buttonStyle(.t(.outline))
                    Button(busy ? "Creating..." : "Create Task", action: create)
                        .buttonStyle(.t(.primary))
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                        .keyboardShortcut(.defaultAction)
                        .accessibilityIdentifier("createTask")
                }
            }
        }
        .onAppear { focused = true }
    }

    private func create() {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty, !busy else { return }
        busy = true
        Task {
            do {
                if startAfterCreate { try await model.createAndStart(name: n) } else { try await model.createTask(name: n) }
                dismiss()
            } catch let e as APIError { error = e.message } catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}

extension View {
    /// Sheet sizing that suits each platform.
    func trackifySheet() -> some View {
        #if os(iOS)
        return self.presentationDetents([.medium, .large]).presentationDragIndicator(.visible).presentationBackground(Theme.card)
        #else
        return self
        #endif
    }
}
