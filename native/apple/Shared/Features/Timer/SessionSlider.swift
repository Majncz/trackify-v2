import SwiftUI
import TrackifyKit

/// Session range slider (WEB_AUDIT §1.3.5) driven by the shared `SessionSliderModel`.
struct SessionRangeSlider: View {
    @Binding var model: SessionSliderModel
    var disabled = false
    var onDraggingChange: (Bool) -> Void = { _ in }

    private let trackH: CGFloat = 6
    private let trackCenter: CGFloat = 40
    private let knob: CGFloat = 28
    @State private var lastX: Double = 0
    @State private var edgeTask: Task<Void, Never>?

    var body: some View {
        GeometryReader { geo in
            let w = Double(geo.size.width)
            let inset = SessionSliderModel.inset
            let startX = model.x(for: model.start, width: w)
            let endX = model.x(for: model.end, width: w)
            let close = endX - startX < 64
            ZStack(alignment: .topLeading) {
                // Track
                Capsule().fill(Theme.muted)
                    .frame(width: max(0, geo.size.width - inset * 2), height: trackH)
                    .offset(x: inset, y: trackCenter - trackH / 2)
                // Busy blocks
                ForEach(Array(visibleBusy.enumerated()), id: \.offset) { _, b in
                    let l = model.x(for: max(b.from, model.viewFrom), width: w)
                    let r = model.x(for: min(b.to, model.viewTo), width: w)
                    Capsule().fill(Theme.busyBlock)
                        .frame(width: max(3, r - l), height: trackH)
                        .offset(x: l, y: trackCenter - trackH / 2)
                        .help(b.name)
                }
                // Selected range
                Capsule().fill(Theme.foreground)
                    .frame(width: max(2, endX - startX), height: trackH)
                    .offset(x: startX, y: trackCenter - trackH / 2)
                // Labels
                label(clock(model.start), x: startX, side: close ? .left : .center)
                label(model.endIsLive ? "Now" : clock(model.end), x: endX, side: close ? .right : .center)
                // Knobs
                knobView(active: model.drag == .start).offset(x: startX - knob / 2, y: trackCenter - knob / 2)
                    .accessibilityElement()
                    .accessibilityLabel("Start")
                    .accessibilityValue(clock(model.start))
                    .accessibilityAdjustableAction { dir in adjust(.start, dir) }
                knobView(active: model.drag == .end).offset(x: endX - knob / 2, y: trackCenter - knob / 2)
                    .accessibilityElement()
                    .accessibilityLabel(model.endIsLive ? "Now" : "Stop")
                    .accessibilityValue(model.endIsLive ? "Now" : clock(model.end))
                    .accessibilityAdjustableAction { dir in adjust(.end, dir) }
            }
            .frame(width: geo.size.width, height: 64, alignment: .topLeading)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0, coordinateSpace: .local)
                    .onChanged { v in
                        guard !disabled else { return }
                        lastX = v.location.x
                        if model.drag == nil {
                            model.begin(x: v.startLocation.x, width: w)
                            onDraggingChange(true)
                            startEdgeLoop(width: w)
                        }
                        model.move(x: v.location.x, width: w)
                    }
                    .onEnded { v in
                        guard !disabled, model.drag != nil else { return }
                        model.end(x: v.location.x, width: w)
                        edgeTask?.cancel()
                        onDraggingChange(false)
                    }
            )
        }
        .frame(height: 64)
        .opacity(disabled ? 0.6 : 1)
    }

    private var visibleBusy: [TimeSpan] {
        model.busy.filter { $0.to > model.viewFrom && $0.from < model.viewTo }
    }

    private func startEdgeLoop(width: Double) {
        edgeTask?.cancel()
        edgeTask = Task { @MainActor in
            var last = Date()
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 16_000_000)
                let now = Date()
                let dt = min(0.05, now.timeIntervalSince(last))
                last = now
                model.edgeScroll(x: lastX, width: width, dt: dt)
            }
        }
    }

    private func adjust(_ which: SessionSliderModel.Drag, _ dir: AccessibilityAdjustmentDirection) {
        let step: Int64 = dir == .increment ? MINUTE_MS : -MINUTE_MS
        if which == .start {
            model.start = SessionMath.clampTypedStart(model.start + step, end: model.end, busy: model.busy, earliest: model.earliest)
        } else {
            model.endIsLive = false
            model.end = SessionMath.clampTypedEnd(model.end + step, start: model.start, busy: model.busy, latest: model.horizon)
        }
    }

    enum Side { case left, center, right }

    private func label(_ text: String, x: Double, side: Side) -> some View {
        let w: CGFloat = 120
        let (align, dx): (Alignment, CGFloat) = switch side {
        case .left: (.trailing, x - 8 - w)
        case .center: (.center, x - w / 2)
        case .right: (.leading, x + 8)
        }
        return Text(text)
            .font(.mono(12))
            .foregroundStyle(Theme.foreground)
            .lineLimit(1)
            .frame(width: w, alignment: align)
            .offset(x: dx, y: 0)
            .allowsHitTesting(false)
    }

    private func knobView(active: Bool) -> some View {
        Circle()
            .fill(Color.white)
            .frame(width: knob, height: knob)
            .overlay(Circle().strokeBorder(Color.black.opacity(0.08), lineWidth: 1))
            .shadow(color: .black.opacity(0.22), radius: active ? 4 : 1.5, y: active ? 2 : 1)
            .background(Circle().fill(Color.black.opacity(active ? 0.08 : 0)).frame(width: knob + 10, height: knob + 10))
            .allowsHitTesting(false)
    }
}

/// 24 h "HH:mm" in the local zone (web `clock()`).
func clock(_ ms: Int64) -> String { DayCalc.current.format(Date(ms: ms), "HH:mm") }

/// Button showing HH:mm that opens hour/minute wheels (SessionStampField).
struct StampField: View {
    var label: String
    var value: Int64
    var min: Int64
    var max: Int64
    var alignRight = false
    var now: Int64
    var onChange: (Int64) -> Void

    @State private var open = false
    @State private var blocked = false
    @State private var hour = 0
    @State private var minute = 0

    var body: some View {
        VStack(alignment: alignRight ? .trailing : .leading, spacing: 4) {
            Text(label).font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
            Button {
                hour = DayCalc.current.hour(Date(ms: value))
                minute = DayCalc.current.minute(Date(ms: value))
                open = true
            } label: {
                HStack {
                    Text(clock(value)).font(.mono(15))
                    Spacer(minLength: 8)
                    Image(systemName: "clock").font(.scaled(13)).foregroundStyle(Theme.mutedForeground)
                }
                .padding(.horizontal, 12)
                .frame(width: 124, height: 40)
                .background(Theme.background, in: RoundedRectangle(cornerRadius: Theme.controlRadius))
                .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius).strokeBorder(Theme.border))
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(label) time")
            .accessibilityValue(clock(value))
            .popover(isPresented: $open, arrowEdge: .bottom) {
                wheels
                    #if os(iOS)
                    .presentationCompactAdaptation(.popover)
                    #endif
            }
            Text(blocked ? "That time overlaps other work" : Fmt.agoLabel(value, now: now))
                .font(.scaled(13))
                .foregroundStyle(blocked ? Theme.destructive : Theme.mutedForeground)
        }
    }

    @ViewBuilder private var wheels: some View {
        #if os(iOS)
        HStack(spacing: 0) {
            Picker("Hour", selection: $hour) {
                ForEach(0..<24, id: \.self) { Text(String(format: "%02d", $0)).font(.mono(18)).tag($0) }
            }
            .pickerStyle(.wheel).frame(width: 80)
            Text(":").font(.mono(18))
            Picker("Minute", selection: $minute) {
                ForEach(0..<60, id: \.self) { Text(String(format: "%02d", $0)).font(.mono(18)).tag($0) }
            }
            .pickerStyle(.wheel).frame(width: 80)
        }
        .padding(8)
        .onChange(of: hour) { _, h in pick(h, minute) }
        .onChange(of: minute) { _, m in pick(hour, m) }
        #else
        HStack(spacing: 0) {
            WheelColumn(values: Array(0..<24), selected: hour) { hour = $0; pick($0, minute) }
            Rectangle().fill(Theme.border).frame(width: 1)
            WheelColumn(values: Array(0..<60), selected: minute) { minute = $0; pick(hour, $0) }
        }
        .frame(height: 160)
        #endif
    }

    private func pick(_ h: Int, _ m: Int) {
        let next = SessionMath.resolveClock(base: value, hour: h, minute: m, min: min, max: max)
        onChange(next)
        // The parent may clamp — flag if the picked time couldn't be applied.
        DispatchQueue.main.async {
            let landed = Date(ms: next)
            blocked = DayCalc.current.hour(landed) != h || DayCalc.current.minute(landed) != m
        }
    }
}

/// Web-style scrolling list of numbers (macOS wheel substitute).
struct WheelColumn: View {
    var values: [Int]
    var selected: Int
    var onPick: (Int) -> Void
    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.vertical, showsIndicators: false) {
                LazyVStack(spacing: 0) {
                    ForEach(values, id: \.self) { n in
                        Button { onPick(n) } label: {
                            Text(String(format: "%02d", n))
                                .font(.mono(13))
                                .frame(width: 56, height: 28)
                                .foregroundStyle(n == selected ? Theme.onPrimary : Theme.foreground)
                                .background(n == selected ? Theme.primary : .clear)
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .id(n)
                    }
                }
            }
            .onAppear { proxy.scrollTo(selected, anchor: .center) }
        }
        .frame(width: 56)
    }
}
