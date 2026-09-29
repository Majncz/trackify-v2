import XCTest
@testable import TrackifyKit

final class WidgetDataTests: XCTestCase {
    let calc = DayCalc(timeZone: TimeZone(identifier: "Europe/Prague")!)

    func d(_ s: String) -> Date { ISODate.parse(s)! }

    // MARK: Heat map

    func testHeatLevels() {
        XCTAssertEqual(WidgetHeat.level(0), 0)
        XCTAssertEqual(WidgetHeat.level(-5), 0)
        XCTAssertEqual(WidgetHeat.level(1), 1)
        XCTAssertEqual(WidgetHeat.level(59), 1)
        XCTAssertEqual(WidgetHeat.level(60), 2)
        XCTAssertEqual(WidgetHeat.level(179), 2)
        XCTAssertEqual(WidgetHeat.level(180), 3)
        XCTAssertEqual(WidgetHeat.level(359), 3)
        XCTAssertEqual(WidgetHeat.level(360), 4)
        XCTAssertEqual(WidgetHeat.level(900), 4)
    }

    func testWeeksFor() {
        XCTAssertEqual(WidgetHeat.weeksFor(width: 50), 8)
        XCTAssertEqual(WidgetHeat.weeksFor(width: 318), 23)
        XCTAssertEqual(WidgetHeat.weeksFor(width: 2000), 26)
    }

    func testMinutesPerDaySplitsAtMidnight() {
        // 23:00 → 01:30 local (Prague, UTC+2 in September) = 60 min on the 28th, 90 min on the 29th.
        let t = TrackifyTask(id: "1", name: "A", events: [
            TimeEvent(id: "e", from: d("2026-09-28T21:00:00Z"), to: d("2026-09-28T23:30:00Z"), taskId: "1"),
            TimeEvent(id: "old", from: d("2025-01-01T08:00:00Z"), to: d("2025-01-01T09:00:00Z"), taskId: "1"),
        ])
        let days = WidgetHeat.minutesPerDay(tasks: [t], end: d("2026-09-30T10:00:00Z"), count: 5, calc: calc)
        XCTAssertEqual(days, [0, 0, 60, 90, 0])
    }

    func testGridShape() {
        let now = d("2026-09-30T10:00:00Z")   // a Wednesday
        var days = [Int](repeating: 0, count: WidgetHeat.days)
        days[days.count - 1] = 30              // today (completed)
        days[days.count - 2] = 400             // yesterday
        let g = WidgetHeat.grid(days: days, endKey: "2026-09-30", today: now, weeks: 10, todayMinutes: 75, calc: calc)
        XCTAssertEqual(g.weeks, 10)
        XCTAssertEqual(g.todayWeek, 9)
        XCTAssertEqual(g.todayRow, 2)                       // Mon=0 … Wed=2
        XCTAssertEqual(g.cells[9][1], 400)                  // Tuesday
        XCTAssertEqual(g.cells[9][2], 75)                   // today uses the live figure
        XCTAssertEqual(Array(g.cells[9][3...]), [-1, -1, -1, -1])
        XCTAssertEqual(g.totalMinutes, 475)
    }

    func testGridFromStaleSnapshotShifts() {
        // Snapshot written yesterday; today has no data yet except the live figure.
        var days = [Int](repeating: 0, count: 20)
        days[19] = 120   // 2026-09-29
        let g = WidgetHeat.grid(days: days, endKey: "2026-09-29", today: d("2026-09-30T10:00:00Z"), weeks: 8, todayMinutes: 0, calc: calc)
        XCTAssertEqual(g.cells[7][1], 120)
        XCTAssertEqual(g.cells[7][2], 0)
    }

    func testMonthLabelsSpaced() {
        let g = WidgetHeat.grid(days: [], endKey: nil, today: d("2026-09-30T10:00:00Z"), weeks: 25, calc: calc)
        XCTAssertFalse(g.months.isEmpty)
        for (a, b) in zip(g.months, g.months.dropFirst()) { XCTAssertGreaterThanOrEqual(b.week - a.week, 3) }
        XCTAssertTrue(g.months.allSatisfy { $0.week <= 23 })
        XCTAssertEqual(g.months.last?.label, "Sep")
    }

    func testSnapshotCarriesHeat() {
        let now = d("2026-09-30T10:00:00Z")
        let t = TrackifyTask(id: "1", name: "One", events: [TimeEvent(id: "e", from: d("2026-09-29T06:00:00Z"), to: d("2026-09-29T08:00:00Z"), taskId: "1")])
        let snap = WidgetSnapshot.build(tasks: [t], running: nil, session: StoredSession(server: "s", token: "t", userId: "u", email: "e"), now: now, calc: calc)
        XCTAssertEqual(snap.heatDays?.count, WidgetHeat.days)
        XCTAssertEqual(snap.heatEndKey, "2026-09-30")
        XCTAssertEqual(snap.heatGrid(now: now, weeks: 8, calc: calc)?.cells[7][1], 120)
        // Old snapshots (no heat) decode fine and simply have no map.
        let legacy = #"{"signedIn":true,"serverUrl":"s","updatedAt":0,"todayTotalMs":0,"tasks":[]}"#
        let decoded = try? JSONDecoder().decode(WidgetSnapshot.self, from: Data(legacy.utf8))
        XCTAssertNotNil(decoded)
        XCTAssertNil(decoded?.heatGrid(now: now, weeks: 8, calc: calc))
    }

    // MARK: Layout

    func testLargeBlocksDropTeamThenHeat() {
        // Plenty of room: everything.
        let big = WidgetLayout.largeBlocks(height: 700, running: true, hasHeat: true, teamMembers: 3, taskCount: 20)
        XCTAssertTrue(big.heat); XCTAssertEqual(big.teamRows, 3)
        // iPhone large (≈350 pt of content): heat but no team, the list keeps 3 rows.
        let phone = WidgetLayout.largeBlocks(height: 350, running: true, hasHeat: true, teamMembers: 3, taskCount: 20)
        XCTAssertTrue(phone.heat); XCTAssertFalse(phone.team); XCTAssertEqual(phone.rows, 3)
        // Short: neither, the list still gets its rows.
        let short = WidgetLayout.largeBlocks(height: 230, running: true, hasHeat: true, teamMembers: 3, taskCount: 20)
        XCTAssertFalse(short.heat); XCTAssertFalse(short.team); XCTAssertGreaterThanOrEqual(short.rows, 3)
        // No heat data: the room goes to the team / rows.
        let noHeat = WidgetLayout.largeBlocks(height: 350, running: false, hasHeat: false, teamMembers: 2, taskCount: 20)
        XCTAssertFalse(noHeat.heat); XCTAssertEqual(noHeat.teamRows, 2)
        // Never more rows than the cap.
        XCTAssertLessThanOrEqual(WidgetLayout.largeBlocks(height: 2000, running: false, hasHeat: false, teamMembers: 0, taskCount: 50).rows, WidgetLayout.maxRows)
    }

    // MARK: Paging

    func testPaging() {
        XCTAssertEqual(WidgetPaging.pages(total: 0, perPage: 3), 1)
        XCTAssertEqual(WidgetPaging.pages(total: 7, perPage: 3), 3)
        XCTAssertEqual(WidgetPaging.page(raw: 3, pages: 3), 0)
        XCTAssertEqual(WidgetPaging.page(raw: -1, pages: 3), 2)
        XCTAssertEqual(WidgetPaging.page(raw: 5, pages: 1), 0)
        XCTAssertEqual(WidgetPaging.range(page: 2, perPage: 3, total: 7), 6..<7)
        XCTAssertEqual(WidgetPaging.range(page: 0, perPage: 3, total: 2), 0..<2)
    }

    func testPageStore() {
        let defaults = UserDefaults(suiteName: "widget-page-test-\(UUID().uuidString)")!
        let s = WidgetPageStore(defaults: defaults)
        XCTAssertEqual(s.raw, 0)
        s.move(1); s.move(1)
        XCTAssertEqual(s.raw, 2); XCTAssertEqual(s.direction, 1)
        s.move(-1)
        XCTAssertEqual(s.raw, 1); XCTAssertEqual(s.direction, -1)
        s.reset()
        XCTAssertEqual(s.raw, 0)
    }

    // MARK: Team

    func testTeamRows() {
        let now = d("2026-09-30T10:00:00Z")
        let team = TeamSnapshot(day: "2026-09-30", fetchedAt: 1, myId: "me", members: [
            .init(userId: "a", name: "Alex", todayMs: 2 * HOUR_MS),
            .init(userId: "me", name: "Nina", todayMs: 30 * MINUTE_MS, startTime: now.ms - 2 * HOUR_MS, taskName: "Code review"),
            .init(userId: "z", name: "Zed", todayMs: 0),
        ])
        let rows = team.rows(now: now, calc: calc)
        XCTAssertEqual(rows.map(\.userId), ["me", "a"])     // 2h30 live > 2h; nobody at zero
        XCTAssertEqual(team.totalMs(now: now, calc: calc), 4 * HOUR_MS + 30 * MINUTE_MS)
        XCTAssertEqual(team.trackingCount(now: now, calc: calc), 1)
        // Another day's snapshot shows nothing.
        XCTAssertTrue(team.rows(now: d("2026-10-01T10:00:00Z"), calc: calc).isEmpty)
    }

    func testTeamAppliesLocalTimer() {
        let now = d("2026-09-30T10:00:00Z")
        let team = TeamSnapshot(day: "2026-09-30", fetchedAt: 1, myId: "me", members: [
            .init(userId: "me", name: "Nina", todayMs: HOUR_MS, startTime: now.ms - 30 * MINUTE_MS, taskName: "A"),
        ])
        // Stop: the running half hour becomes completed time.
        let stopped = team.applying(running: nil, userId: "me", now: now, calc: calc)
        XCTAssertNil(stopped.members[0].startTime)
        XCTAssertEqual(stopped.members[0].todayMs, 90 * MINUTE_MS)
        // Switch: new run starts now.
        let r = WidgetSnapshot.Running(taskId: "2", taskName: "B", accentHex: "#000000", startTime: now.ms)
        let switched = team.applying(running: r, userId: "me", now: now, calc: calc)
        XCTAssertEqual(switched.members[0].taskName, "B")
        XCTAssertEqual(switched.members[0].todayMs, 90 * MINUTE_MS)
        XCTAssertEqual(switched.totalMs(now: now, calc: calc), 90 * MINUTE_MS)
        // Unloaded snapshot is left alone.
        XCTAssertEqual(TeamSnapshot.empty.applying(running: r, userId: "me", now: now), .empty)
    }

    func testTeamFromPresence() {
        let p = PresenceResponse(leaderboard: [LeaderboardEntry(userId: "a", name: "Alex", todayMs: 5, startTime: nil, taskName: nil)])
        let t = TeamSnapshot.from(p, day: "2026-09-30", myId: "a", now: d("2026-09-30T10:00:00Z"))
        XCTAssertTrue(t.loaded)
        XCTAssertEqual(t.members.first?.name, "Alex")
    }
}
