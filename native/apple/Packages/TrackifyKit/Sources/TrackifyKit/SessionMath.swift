import Foundation

/// Session range slider + log-past algorithms (session-range-slider.tsx, suggest-past-range.ts, session-stamp-field.tsx).
public struct TimeSpan: Hashable, Sendable {
    public var from: Int64
    public var to: Int64
    public var name: String
    public init(from: Int64, to: Int64, name: String = "") { self.from = from; self.to = to; self.name = name }
}

public enum SessionMath {
    public static let minDuration: Int64 = MINUTE_MS
    public static let maxLookback: Int64 = MAX_LOOKBACK_MS
    public static let firstView: Int64 = 90 * MINUTE_MS
    public static let pastDefault: Int64 = 25 * MINUTE_MS

    public static func initialViewFrom(start: Int64, openedAt: Int64) -> Int64 {
        let earliest = openedAt - maxLookback
        let duration = max(openedAt - start, MINUTE_MS)
        if duration >= firstView { return max(earliest, start - 20 * MINUTE_MS) }
        return max(earliest, openedAt - firstView)
    }

    public static func minStartForEnd(_ end: Int64, busy: [TimeSpan], earliest: Int64) -> Int64 {
        var m = earliest
        for s in busy where s.from < end { m = max(m, s.to) }
        return m
    }

    public static func maxEndForStart(_ start: Int64, busy: [TimeSpan], latest: Int64) -> Int64 {
        var m = latest
        for s in busy where s.to > start { m = min(m, s.from) }
        return m
    }

    public static func clampTypedStart(_ next: Int64, end: Int64, busy: [TimeSpan], earliest: Int64) -> Int64 {
        clampMs(next, minStartForEnd(end, busy: busy, earliest: earliest), end - minDuration)
    }

    public static func clampTypedEnd(_ next: Int64, start: Int64, busy: [TimeSpan], latest: Int64) -> Int64 {
        clampMs(next, start + minDuration, maxEndForStart(start, busy: busy, latest: latest))
    }

    /// Wheel picker: resolve `HH:mm` to the nearest candidate day among offsets [0,-1,+1,-2] inside [min,max], else clamp.
    public static func resolveClock(base: Int64, hour: Int, minute: Int, min lo: Int64, max hi: Int64, calc: DayCalc = .current) -> Int64 {
        let baseDate = Date(ms: base)
        func onDay(_ off: Int) -> Int64 { snapMinute(calc.dateAt(baseDate, hour: hour, minute: minute, dayOffset: off).ms) }
        var candidates = [0, -1, 1, -2].map(onDay).filter { $0 >= lo && $0 <= hi }
        if candidates.isEmpty { return clampMs(onDay(0), lo, hi) }
        candidates.sort { abs($0 - base) < abs($1 - base) }
        return candidates[0]
    }

    /// `typicalDurationMs` — median of this task's durations between 1 min and 8 h (default 25 min).
    public static func typicalDuration(_ events: [TimeEvent]) -> Int64 {
        let d = events.map(\.durationMs).filter { $0 >= MINUTE_MS && $0 <= 8 * HOUR_MS }.sorted()
        if d.isEmpty { return pastDefault }
        return d[d.count / 2]
    }

    public static func mergeBusy(_ spans: [TimeSpan], earliest: Int64, latest: Int64) -> [TimeSpan] {
        let busy = spans.filter { $0.to > earliest && $0.from < latest }.sorted { $0.from < $1.from }
        var merged: [TimeSpan] = []
        for s in busy {
            if let last = merged.last, s.from <= last.to {
                merged[merged.count - 1].to = max(last.to, s.to)
            } else {
                merged.append(s)
            }
        }
        return merged
    }

    public static func listGaps(earliest: Int64, latest: Int64, busy: [TimeSpan]) -> [TimeSpan] {
        let merged = mergeBusy(busy, earliest: earliest, latest: latest)
        var gaps: [TimeSpan] = []
        var cursor = earliest
        for s in merged {
            if s.from > cursor { gaps.append(TimeSpan(from: cursor, to: s.from)) }
            cursor = max(cursor, s.to)
        }
        if cursor < latest { gaps.append(TimeSpan(from: cursor, to: latest)) }
        return gaps.filter { $0.to - $0.from >= MINUTE_MS }
    }

    static func gapDistance(_ anchor: Int64, _ gap: TimeSpan) -> Int64 {
        if anchor >= gap.from && anchor <= gap.to { return 0 }
        if anchor < gap.from { return gap.from - anchor }
        return anchor - gap.to
    }

    static func fitInGap(_ gap: TimeSpan, duration: Int64, anchor: Int64, asEnd: Bool) -> (start: Int64, end: Int64) {
        let room = gap.to - gap.from
        let dur = min(max(MINUTE_MS, duration), room)
        if asEnd {
            let end = min(gap.to, max(gap.from + dur, anchor))
            return (end - dur, end)
        }
        let start = max(gap.from, min(gap.to - dur, anchor))
        return (start, start + dur)
    }

    /// Relocate a range into the nearest free gap (tap on track / typed time in log-past).
    public static func relocateToTime(anchor: Int64, duration: Int64, asEnd: Bool = false,
                                      earliest: Int64, latest: Int64, busy: [TimeSpan]) -> (start: Int64, end: Int64)? {
        let gaps = listGaps(earliest: earliest, latest: latest, busy: busy)
        guard var best = gaps.first else { return nil }
        var bestDist = gapDistance(anchor, best)
        for g in gaps {
            let d = gapDistance(anchor, g)
            if d < bestDist { best = g; bestDist = d }
        }
        return fitInGap(best, duration: duration, anchor: anchor, asEnd: asEnd)
    }

    public static func viewAround(start: Int64, end: Int64, earliest: Int64, latest: Int64,
                                  window: Int64 = 90 * MINUTE_MS) -> (viewFrom: Int64, viewTo: Int64) {
        let span = max(window, end - start + 20 * MINUTE_MS)
        var from = (start + end) / 2 - span / 2
        var to = from + span
        if to > latest { to = latest; from = to - span }
        if from < earliest { from = earliest; to = min(latest, from + span) }
        if start < from { from = max(earliest, start - 10 * MINUTE_MS) }
        if end > to { to = min(latest, end + 10 * MINUTE_MS) }
        return (from, to)
    }

    /// Initial log-past suggestion: latest gap that fits the preferred length (take its tail), else a whole gap ≥1 min.
    public static func suggestPastRange(now: Int64, busy: [TimeSpan], runningStart: Int64?, preferred: Int64?) -> (start: Int64, end: Int64) {
        let pref = max(MINUTE_MS, preferred ?? pastDefault)
        let earliest = now - maxLookback
        var spans = busy
        if let rs = runningStart, rs > 0 { spans.append(TimeSpan(from: rs, to: now)) }
        let gaps = listGaps(earliest: earliest, latest: now, busy: spans)
        for gap in gaps.reversed() {
            let room = gap.to - gap.from
            if room >= pref { return (gap.to - pref, gap.to) }
            if room >= MINUTE_MS { return (gap.from, gap.to) }
        }
        return (now - pref, now)
    }

    /// Busy spans for all events of all tasks (`Task: entry name` titles).
    public static func busySpans(tasks: [TrackifyTask]) -> [TimeSpan] {
        tasks.flatMap { t in t.events.map { TimeSpan(from: $0.fromMs, to: $0.toMs, name: "\(t.name): \($0.name)") } }
    }
}

/// Pure state machine for the session range slider's gesture handling, so it can be unit-tested
/// and shared by every platform's slider view.
public struct SessionSliderModel: Equatable, Sendable {
    public enum Drag: Equatable, Sendable { case start, end, pan, arm }

    public var start: Int64
    public var end: Int64
    public var endIsLive: Bool
    public var allowLiveEnd: Bool
    public var placeInGaps: Bool
    public var viewFrom: Int64
    public var viewTo: Int64
    public var earliest: Int64
    public var horizon: Int64
    public var busy: [TimeSpan]

    public var drag: Drag?
    var panOrigin: (x: Double, from: Int64, to: Int64) = (0, 0, 0)
    var armOrigin: (x: Double, at: Int64) = (0, 0)

    public static let hit: Double = 44
    public static let inset: Double = 18

    public static func == (a: Self, b: Self) -> Bool {
        a.start == b.start && a.end == b.end && a.endIsLive == b.endIsLive && a.viewFrom == b.viewFrom &&
            a.viewTo == b.viewTo && a.drag == b.drag
    }

    public init(start: Int64, end: Int64, endIsLive: Bool, allowLiveEnd: Bool, placeInGaps: Bool,
                viewFrom: Int64, viewTo: Int64, earliest: Int64, horizon: Int64, busy: [TimeSpan]) {
        self.start = start; self.end = end; self.endIsLive = endIsLive; self.allowLiveEnd = allowLiveEnd
        self.placeInGaps = placeInGaps; self.viewFrom = viewFrom; self.viewTo = viewTo
        self.earliest = earliest; self.horizon = horizon; self.busy = busy
    }

    public func x(for time: Int64, width: Double) -> Double {
        let usable = max(1, width - Self.inset * 2)
        let span = Double(max(1, viewTo - viewFrom))
        return Self.inset + Double(time - viewFrom) / span * usable
    }

    public func time(at x: Double, width: Double) -> Int64 {
        let usable = max(1, width - Self.inset * 2)
        let ratio = min(1, max(0, (x - Self.inset) / usable))
        return viewFrom + Int64(ratio * Double(viewTo - viewFrom))
    }

    public mutating func begin(x: Double, width: Double) {
        let ds = abs(x - self.x(for: start, width: width))
        let de = abs(x - self.x(for: end, width: width))
        if ds <= Self.hit && ds <= de { drag = .start }
        else if de <= Self.hit { drag = .end }
        else if placeInGaps { drag = .arm; armOrigin = (x, time(at: x, width: width)) }
        else { drag = ds <= de ? .start : .end }
        if drag == .start || drag == .end { apply(x: x, width: width, snap: false) }
    }

    public mutating func move(x: Double, width: Double) {
        if drag == .arm {
            if abs(x - armOrigin.x) < 10 { return }
            drag = .pan
            panOrigin = (armOrigin.x, viewFrom, viewTo)
        }
        apply(x: x, width: width, snap: false)
    }

    public mutating func end(x: Double, width: Double) {
        if drag == .arm {
            let at = armOrigin.at
            let onBusy = busy.contains { at >= $0.from && at < $0.to }
            if !onBusy { place(at: at) }
        } else {
            apply(x: x, width: width, snap: true)
        }
        drag = nil
    }

    /// Edge auto-scroll while dragging a knob near the edges (6 h/s).
    public mutating func edgeScroll(x: Double, width: Double, dt: Double) {
        guard drag == .start || drag == .end else { return }
        let usable = max(1, width - Self.inset * 2)
        let ratio = min(1, max(0, (x - Self.inset) / usable))
        let step = Int64(6 * Double(HOUR_MS) * dt)
        if drag == .start, ratio <= 0.07 {
            let lo = SessionMath.minStartForEnd(end, busy: busy, earliest: earliest)
            if viewFrom <= lo { return }
            let next = max(lo, earliest, viewFrom - step)
            if next >= viewFrom { return }
            viewFrom = next
            start = next
        } else if drag == .end, ratio >= 0.93 {
            let hi = SessionMath.maxEndForStart(start, busy: busy, latest: horizon)
            if viewTo >= hi { return }
            let next = min(hi, horizon, viewTo + step)
            if next <= viewTo { return }
            viewTo = next
            end = next
            endIsLive = false
        }
    }

    mutating func apply(x: Double, width: Double, snap: Bool) {
        guard let drag else { return }
        let usable = max(1, width - Self.inset * 2)
        if drag == .pan {
            let spanMs = panOrigin.to - panOrigin.from
            let shift = Int64(-((x - panOrigin.x) / usable) * Double(spanMs))
            var nf = panOrigin.from + shift
            var nt = panOrigin.to + shift
            if nf < earliest { nf = earliest; nt = nf + spanMs }
            if nt > horizon { nt = horizon; nf = nt - spanMs }
            viewFrom = nf; viewTo = nt
            return
        }
        if drag == .arm { return }
        var at = time(at: x, width: width)
        if snap { at = snapMinute(at) }
        if drag == .start {
            let lo = SessionMath.minStartForEnd(end, busy: busy, earliest: earliest)
            let hi = end - SessionMath.minDuration
            start = clampMs(at, lo, hi)
            return
        }
        let lo = start + SessionMath.minDuration
        let hi = SessionMath.maxEndForStart(start, busy: busy, latest: horizon)
        if allowLiveEnd && at >= viewTo - MINUTE_MS / 2 {
            endIsLive = true
            end = viewTo
            return
        }
        endIsLive = false
        end = clampMs(at, lo, hi)
    }

    public mutating func place(at: Int64) {
        guard let placed = SessionMath.relocateToTime(anchor: snapMinute(at), duration: max(SessionMath.minDuration, end - start),
                                                      earliest: earliest, latest: horizon, busy: busy) else { return }
        start = placed.start
        end = placed.end
        let w = SessionMath.viewAround(start: placed.start, end: placed.end, earliest: earliest, latest: horizon)
        viewFrom = w.viewFrom
        viewTo = w.viewTo
    }
}
