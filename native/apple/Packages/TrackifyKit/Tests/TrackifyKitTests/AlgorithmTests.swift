import XCTest
@testable import TrackifyKit

final class AccentTests: XCTestCase {
    func testHashVectors() {
        // WEB_AUDIT §5.3 test vectors
        let vectors: [(String, Int64, String, UInt32, String)] = [
            ("00000000-0000-0000-0000-000000000000", 1428967488, "#4e342e", 1428967488, "#4f46e5"),
            ("3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c", 182518781, "#ef6c00", 182518781, "#ea580c"),
            ("a", 97, "#4527a0", 97, "#dc2626"),
            ("abc", 96354, "#00796b", 96354, "#db2777"),
        ]
        for (id, h, preset, rh, race) in vectors {
            XCTAssertEqual(Accent.hashGroupId(id), h, id)
            XCTAssertEqual(Accent.groupAccentHex(id), preset, id)
            XCTAssertEqual(Accent.taskAccentHex(id), preset, id)
            XCTAssertEqual(Accent.raceHash(id), rh, id)
            XCTAssertEqual(Accent.colorForId(id), race, id)
        }
    }

    func testResolveGroupAccent() {
        XCTAssertEqual(Accent.resolveGroupAccent(id: "a", color: "#123ABC"), "#123ABC")
        XCTAssertEqual(Accent.resolveGroupAccent(id: "a", color: "red"), "#4527a0")
        XCTAssertEqual(Accent.resolveGroupAccent(id: "a", color: nil), "#4527a0")
        XCTAssertEqual(Accent.resolveGroupAccent(id: "a", color: " #00ff00 "), "#00ff00")
    }

    func testInitials() {
        XCTAssertEqual(Accent.initials(""), "?")
        XCTAssertEqual(Accent.initials("nina"), "NI")
        XCTAssertEqual(Accent.initials("Nina Native"), "NN")
        XCTAssertEqual(Accent.initials("  jakub  von rana "), "JR")
    }

    func testHeatLevels() {
        XCTAssertEqual(HeatScale.level(0, working: []), 0)
        XCTAssertEqual(HeatScale.level(10, working: []), 1)
        XCTAssertEqual(HeatScale.level(180, working: []), 2)
        XCTAssertEqual(HeatScale.level(330, working: []), 3)
        XCTAssertEqual(HeatScale.level(480, working: []), 4)
        // Percentiles kick in with ≥ 8 working days.
        let working: [Double] = [10, 20, 30, 40, 50, 60, 70, 80].sorted()
        // p75 = working[ceil(6)-1] = 60; p90 = working[ceil(7.2)-1]=working[7] = 80
        XCTAssertEqual(HeatScale.level(60, working: working), 3)
        XCTAssertEqual(HeatScale.level(80, working: working), 4)
        XCTAssertEqual(HeatScale.level(59, working: working), 1)
        XCTAssertEqual(HeatScale.color(80, working: working), "#052e16")
        XCTAssertEqual(HeatScale.color(0, working: working), "#e8eee9")
    }
}

final class FormatterTests: XCTestCase {
    func testDuration() {
        XCTAssertEqual(Fmt.duration(0), "00:00:00")
        XCTAssertEqual(Fmt.duration(3_723_000), "01:02:03")
        XCTAssertEqual(Fmt.duration(100 * 3_600_000), "100:00:00")
    }

    func testDurationWords() {
        XCTAssertEqual(Fmt.durationWords(0), "0s")
        XCTAssertEqual(Fmt.durationWords(45_000), "45s")
        XCTAssertEqual(Fmt.durationWords(125_000), "2m")
        XCTAssertEqual(Fmt.durationWords(3_600_000), "1h")
        XCTAssertEqual(Fmt.durationWords(3_660_000), "1h 1m")
        XCTAssertEqual(Fmt.durationWords(3_605_000, seconds: true), "1h 5s")
        XCTAssertEqual(Fmt.durationWords(65_000, seconds: true), "1m 5s")
    }

    func testFmtMs() {
        XCTAssertEqual(Fmt.fmtMs(0), "0s")
        XCTAssertEqual(Fmt.fmtMs(-5), "0s")
        XCTAssertEqual(Fmt.fmtMs(3_660_000), "1h 1m")
        XCTAssertEqual(Fmt.fmtMs(7_200_000), "2h")
        XCTAssertEqual(Fmt.fmtMs(65_000), "1m 5s")
        XCTAssertEqual(Fmt.fmtMs(60_000), "1m")
        XCTAssertEqual(Fmt.fmtMs(5_000), "5s")
    }

    func testHeatMinutes() {
        XCTAssertEqual(Fmt.heatMinutes(0), "0s")
        XCTAssertEqual(Fmt.heatMinutes(-1), "0s")
        XCTAssertEqual(Fmt.heatMinutes(90.5), "1h 30m 30s")
        XCTAssertEqual(Fmt.heatMinutes(2.5), "2m 30s")
        XCTAssertEqual(Fmt.heatMinutes(0.5), "30s")
        XCTAssertEqual(Fmt.heatMinutes(0.005), "0.3s")      // 0.3 s → toFixed(2) = "0.30" → 0.3
        XCTAssertEqual(Fmt.heatMinutes(0.0001), "0.006s")   // 0.006 s → toFixed(3)
    }

    func testDurationMinutesAndRace() {
        XCTAssertEqual(Fmt.durationMinutes(0), "0m")
        XCTAssertEqual(Fmt.durationMinutes(59), "59m")
        XCTAssertEqual(Fmt.durationMinutes(60), "1h")
        XCTAssertEqual(Fmt.durationMinutes(61), "1h 1m")
        XCTAssertEqual(Fmt.raceDuration(0), "0m")
        XCTAssertEqual(Fmt.raceDuration(30_000), "30s")
        XCTAssertEqual(Fmt.raceDuration(3_600_000), "1h")
        XCTAssertEqual(Fmt.raceDuration(3_660_000), "1h 1m")
        XCTAssertEqual(Fmt.playClock(61_000), "1:01")
    }

    func testAgoLabel() {
        let now: Int64 = 10_000_000_000
        XCTAssertEqual(Fmt.agoLabel(now, now: now), "now")
        XCTAssertEqual(Fmt.agoLabel(now - 12 * 60_000, now: now), "12 min ago")
        XCTAssertEqual(Fmt.agoLabel(now - 60 * 60_000, now: now), "1 hour ago")
        XCTAssertEqual(Fmt.agoLabel(now - 120 * 60_000, now: now), "2 hours ago")
        XCTAssertEqual(Fmt.agoLabel(now - 95 * 60_000, now: now), "1h 35m ago")
    }

    func testMoney() {
        let czk = Money.format(1234.5, "CZK")
        XCTAssertTrue(czk.contains("Kč"), czk)
        XCTAssertTrue(czk.contains("234,50"), czk)
        XCTAssertEqual(Money.unitLabel("CZK"), "Kč")
        XCTAssertEqual(Money.unitLabel("EUR"), "€")
        XCTAssertEqual(Money.round2(1.005), 1.0) // JS: Math.round(100.49999…) = 100
        XCTAssertEqual(Money.parseAmount("12,5"), 12.5)
        XCTAssertNil(Money.parseAmount("abc"))
        XCTAssertEqual(Money.options(including: "xyz").last?.label, "XYZ — other")
    }

    func testPersonName() {
        XCTAssertEqual(PersonName.fromEmail("john.doe@x.com"), "John Doe")
        XCTAssertEqual(PersonName.fromEmail("nina_native-dev@x"), "Nina Native Dev")
        XCTAssertEqual(PersonName.name(displayName: "  ", email: "a.b@c"), "A B")
        XCTAssertEqual(PersonName.name(displayName: "Nina", email: "a.b@c"), "Nina")
    }

    func testISODate() {
        let d = ISODate.parse("2026-09-26T10:00:00.000Z")!
        XCTAssertEqual(d.ms, 1_790_416_800_000)
        XCTAssertEqual(ISODate.string(d), "2026-09-26T10:00:00.000Z")
        XCTAssertEqual(ISODate.parse("2026-09-26T12:00:00+02:00")!.ms, d.ms)
        XCTAssertEqual(ISODate.parse("2026-09-26T10:00:00.5Z")!.ms, d.ms + 500)
        XCTAssertEqual(ISODate.string(ms: 1_790_416_800_123), "2026-09-26T10:00:00.123Z")
    }

    func testConversationTitle() {
        XCTAssertEqual(Conversation(id: "1", title: nil).tabTitle, "New chat")
        XCTAssertEqual(Conversation(id: "1", title: "How much did I work").tabTitle, "How much did...")
        XCTAssertEqual(Conversation(id: "1", title: "Hi there").tabTitle, "Hi there")
    }
}

final class SessionMathTests: XCTestCase {
    let m = MINUTE_MS

    func testClampRules() {
        let busy = [TimeSpan(from: 100 * m, to: 120 * m), TimeSpan(from: 200 * m, to: 210 * m)]
        XCTAssertEqual(SessionMath.minStartForEnd(150 * m, busy: busy, earliest: 0), 120 * m)
        XCTAssertEqual(SessionMath.maxEndForStart(130 * m, busy: busy, latest: 300 * m), 200 * m)
        XCTAssertEqual(SessionMath.clampTypedStart(90 * m, end: 150 * m, busy: busy, earliest: 0), 120 * m)
        XCTAssertEqual(SessionMath.clampTypedEnd(250 * m, start: 130 * m, busy: busy, latest: 300 * m), 200 * m)
        XCTAssertEqual(SessionMath.clampTypedEnd(130 * m, start: 130 * m, busy: busy, latest: 300 * m), 131 * m)
    }

    func testInitialViewFrom() {
        let opened: Int64 = 1000 * m
        XCTAssertEqual(SessionMath.initialViewFrom(start: opened - 10 * m, openedAt: opened), opened - 90 * m)
        XCTAssertEqual(SessionMath.initialViewFrom(start: opened - 120 * m, openedAt: opened), opened - 140 * m)
    }

    func testSuggestPastRange() {
        let now: Int64 = 3000 * m
        // Busy until now-10m → the last gap is 10 min (< 25) → take whole gap.
        let busy = [TimeSpan(from: now - 60 * m, to: now - 10 * m)]
        let r = SessionMath.suggestPastRange(now: now, busy: busy, runningStart: nil, preferred: nil)
        XCTAssertEqual(r.start, now - 10 * m)
        XCTAssertEqual(r.end, now)
        // Running timer blocks the tail; the gap before the busy block holds 25 min.
        let r2 = SessionMath.suggestPastRange(now: now, busy: busy, runningStart: now - 10 * m, preferred: nil)
        XCTAssertEqual(r2.end, now - 60 * m)
        XCTAssertEqual(r2.start, now - 85 * m)
        // Empty: take the tail of the only gap.
        let r3 = SessionMath.suggestPastRange(now: now, busy: [], runningStart: nil, preferred: 30 * m)
        XCTAssertEqual(r3.start, now - 30 * m)
    }

    func testTypicalDuration() {
        let evs = [10, 20, 30, 500].map { TimeEvent(id: "\($0)", from: Date(ms: 0), to: Date(ms: Int64($0) * m), taskId: "t") }
        XCTAssertEqual(SessionMath.typicalDuration(evs), 20 * m) // 500 min > 8 h excluded → median of [10,20,30]
    }

    func testRelocate() {
        let busy = [TimeSpan(from: 100 * m, to: 200 * m)]
        let r = SessionMath.relocateToTime(anchor: 150 * m, duration: 30 * m, earliest: 0, latest: 300 * m, busy: busy)!
        // nearest gap to 150: [0,100] distance 50, [200,300] distance 50 → first wins
        XCTAssertEqual(r.end, 100 * m)
        XCTAssertEqual(r.start, 70 * m)
        let v = SessionMath.viewAround(start: 70 * m, end: 100 * m, earliest: 0, latest: 300 * m)
        XCTAssertEqual(v.viewTo - v.viewFrom, 90 * m)
    }

    func testSliderModelDragEnd() {
        let opened: Int64 = 1000 * m
        var s = SessionSliderModel(start: opened - 30 * m, end: opened, endIsLive: true, allowLiveEnd: true, placeInGaps: false,
                                   viewFrom: opened - 90 * m, viewTo: opened, earliest: opened - 40 * 60 * m, horizon: opened, busy: [])
        let width = 336.0
        let endX = s.x(for: s.end, width: width)
        s.begin(x: endX, width: width)
        XCTAssertEqual(s.drag, .end)
        s.move(x: endX - 100, width: width)
        XCTAssertFalse(s.endIsLive)
        s.end(x: endX - 100, width: width)
        XCTAssertEqual(s.end % m, 0)
        XCTAssertLessThan(s.end, opened)
        // Dragging back to the right edge returns to live.
        s.begin(x: s.x(for: s.end, width: width), width: width)
        s.end(x: width, width: width)
        XCTAssertTrue(s.endIsLive)
    }

    func testSliderPlaceInGapsTap() {
        let now: Int64 = 1000 * m
        var s = SessionSliderModel(start: now - 25 * m, end: now, endIsLive: false, allowLiveEnd: false, placeInGaps: true,
                                   viewFrom: now - 90 * m, viewTo: now, earliest: now - 40 * 60 * m, horizon: now,
                                   busy: [TimeSpan(from: now - 50 * m, to: now - 30 * m)])
        let width = 336.0
        let tapX = s.x(for: now - 70 * m, width: width)
        s.begin(x: tapX, width: width)
        XCTAssertEqual(s.drag, .arm)
        s.end(x: tapX, width: width)
        XCTAssertEqual(s.end - s.start, 25 * m)
        XCTAssertLessThanOrEqual(s.end, now - 50 * m)
    }
}

final class AnalyticsTests: XCTestCase {
    let calc = DayCalc(timeZone: TimeZone(identifier: "Europe/Prague")!)

    func ev(_ task: String, _ from: String, _ to: String) -> TimeEvent {
        TimeEvent(id: UUID().uuidString, from: ISODate.parse(from)!, to: ISODate.parse(to)!, taskId: task)
    }

    func testSortTasks() {
        let a = TrackifyTask(id: "a", name: "A", events: [ev("a", "2026-09-20T10:00:00Z", "2026-09-20T11:00:00Z")])
        let b = TrackifyTask(id: "b", name: "B", events: [ev("b", "2026-09-25T10:00:00Z", "2026-09-25T11:00:00Z")])
        let c = TrackifyTask(id: "c", name: "C")
        let h = TrackifyTask(id: "h", name: "H", hidden: true)
        XCTAssertEqual(Analytics.sortTasks([a, b, c, h], runningTaskId: nil).map(\.id), ["c", "b", "a"])
        XCTAssertEqual(Analytics.sortTasks([a, b, c], runningTaskId: "a").map(\.id), ["a", "c", "b"])
    }

    func testWeekStartsMonday() {
        let d = ISODate.parse("2026-09-26T10:00:00Z")! // Saturday
        XCTAssertEqual(calc.dayKey(calc.startOfWeek(d)), "2026-09-21")
        XCTAssertEqual(calc.dayKey(calc.endOfWeek(d)), "2026-09-27")
        let sun = ISODate.parse("2026-09-27T10:00:00Z")!
        XCTAssertEqual(calc.dayKey(calc.startOfWeek(sun)), "2026-09-21")
    }

    func testStatsSummaryAndBreakdown() {
        let t1 = TrackifyTask(id: "1", name: "One", events: [ev("1", "2026-09-22T08:00:00Z", "2026-09-22T10:00:00Z"),
                                                            ev("1", "2026-09-23T08:00:00Z", "2026-09-23T09:00:00Z")])
        let t2 = TrackifyTask(id: "2", name: "Two", events: [ev("2", "2026-09-22T11:00:00Z", "2026-09-22T11:30:00Z")])
        let now = ISODate.parse("2026-09-26T10:00:00Z")!
        let r = Analytics.range(.week, customFrom: nil, customTo: nil, now: now, calc: calc)
        let s = Analytics.statsSummary(tasks: [t1, t2], range: r, calc: calc)
        XCTAssertEqual(s.totalMs, 3 * HOUR_MS + 30 * MINUTE_MS)
        XCTAssertEqual(s.dailyAverageMs, (3 * HOUR_MS + 30 * MINUTE_MS) / 2)
        XCTAssertEqual(s.topTasks.map(\.task.id), ["1", "2"])
        let rows = Analytics.breakdown(tasks: [t1, t2], range: r, topIds: ["1"], now: now, calc: calc)
        XCTAssertEqual(rows.count, 7)
        XCTAssertEqual(rows[1].slices["1"], 2 * HOUR_MS)
        XCTAssertEqual(rows[1].slices[Analytics.otherKey], 30 * MINUTE_MS)
        XCTAssertEqual(r.label, "Sep 21 – Sep 27, 2026")
    }

    func testYearlyCalendar() {
        let t = TrackifyTask(id: "1", name: "One", events: [ev("1", "2026-09-22T08:00:00Z", "2026-09-22T10:00:00Z")])
        let y = YearlyCalendarData.fromTasks([t], now: ISODate.parse("2026-09-26T10:00:00Z")!, calc: calc)
        XCTAssertEqual(y.weeks.count, 1)
        XCTAssertEqual(y.grid[1][0], 120) // Tuesday
        XCTAssertEqual(calc.dayKey(y.startDate), "2026-09-21")
    }

    func testHeatSegmentsBridge() {
        var cells = [HeatHourCell](repeating: HeatHourCell(), count: 24)
        cells[9] = HeatHourCell(totalMinutes: 60, taskMinutes: ["A": 60])
        cells[11] = HeatHourCell(totalMinutes: 30, taskMinutes: ["A": 30])
        cells[14] = HeatHourCell(totalMinutes: 30, taskMinutes: ["B": 30])
        let segs = WeeklyHeatGrid.segments(hourCells: cells, squaresPerHour: 2)
        XCTAssertEqual(segs.count, 2)
        XCTAssertEqual(segs[0].taskName, "A")
        XCTAssertEqual(segs[0].startFlat, 18)
        XCTAssertEqual(segs[0].endFlat, 23)
        XCTAssertEqual(segs[0].bridgedEmptySlots, 2)
        XCTAssertEqual(segs[1].taskName, "B")
        XCTAssertEqual(WeeklyHeatGrid.metrics(availableWidth: 300).squaresPerHour, 1)
        XCTAssertEqual(WeeklyHeatGrid.opacity(0, max: 10), 0.7)
        XCTAssertEqual(WeeklyHeatGrid.opacity(10, max: 10), 1.0, accuracy: 0.0001)
    }

    func testLeaderboardPeriods() {
        XCTAssertEqual(Leaderboard.step(.week, day: "2026-09-26", direction: -1, calc: calc), "2026-09-19")
        XCTAssertEqual(Leaderboard.step(.month, day: "2026-09-26", direction: -1, calc: calc), "2026-08-26")
        XCTAssertTrue(Leaderboard.isCurrent(.week, day: "2026-09-21", today: "2026-09-26", calc: calc))
        XCTAssertFalse(Leaderboard.isCurrent(.day, day: "2026-09-21", today: "2026-09-26", calc: calc))
        XCTAssertEqual(Leaderboard.periodLabel(.week, day: "2026-09-10", isCurrent: false, calc: calc), "7–13 Sep")
        XCTAssertEqual(Leaderboard.periodLabel(.week, day: "2026-09-01", isCurrent: false, calc: calc), "31 Aug – 6 Sep")
        XCTAssertEqual(Leaderboard.pick("2026-10-01", today: "2026-09-26"), "2026-09-26")
    }

    func testRaceTotals() {
        let events = [RaceResponse.Event(userId: "u", from: 0, to: 100), RaceResponse.Event(userId: "u", from: 50, to: 150),
                      RaceResponse.Event(userId: "v", from: 0, to: 40)]
        let merged = Race.mergeIntervals(events)
        XCTAssertEqual(merged["u"]?.count, 1)
        let rows = Race.totalsAt(merged, users: [.init(id: "u", name: "U", color: nil), .init(id: "v", name: "V", color: nil)], rangeStart: 0, at: 120)
        XCTAssertEqual(rows.map(\.ms), [120, 40])
    }

    func testCoverageEnd() {
        let d = calc.date(fromKey: "2026-08-12")!
        XCTAssertEqual(calc.dayKey(AICadence.weekly.coverageEnd(start: d, calc: calc)), "2026-08-16")
        XCTAssertEqual(calc.dayKey(AICadence.monthly.coverageEnd(start: d, calc: calc)), "2026-08-31")
        XCTAssertEqual(calc.dayKey(AICadence.quarterly.coverageEnd(start: d, calc: calc)), "2026-09-30")
        XCTAssertEqual(calc.dayKey(AICadence.yearly.coverageEnd(start: d, calc: calc)), "2026-12-31")
    }

    func testSnapshotToday() {
        let now = ISODate.parse("2026-09-26T10:00:00Z")!
        let t = TrackifyTask(id: "1", name: "One", events: [ev("1", "2026-09-26T06:00:00Z", "2026-09-26T07:00:00Z")])
        let snap = WidgetSnapshot.build(tasks: [t], running: RunningTimer(taskId: "1", startTime: now.ms - 30 * MINUTE_MS, pending: false),
                                        session: StoredSession(server: "https://x", token: "t", userId: "u", email: "e"), now: now, calc: calc)
        XCTAssertEqual(snap.todayTotalMs, HOUR_MS)
        XCTAssertEqual(snap.todayTotal(now: now, calc: calc), HOUR_MS + 30 * MINUTE_MS)
        XCTAssertEqual(snap.running?.taskName, "One")
    }
}
