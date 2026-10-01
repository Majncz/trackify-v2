import XCTest
@testable import TrackifyKit

/// Scriptable fake server.
final class FakeTransport: TimerTransport, @unchecked Sendable {
    let lock = NSLock()
    var calls: [String] = []
    var server = ServerTimerState(running: false)
    var events: [TimeEvent] = []
    var failNext: [APIError] = []
    var legacyOnly = false
    var eventConflict = false

    func record(_ s: String) throws {
        lock.lock(); defer { lock.unlock() }
        calls.append(s)
        if !failNext.isEmpty { throw failNext.removeFirst() }
    }

    static let missing = APIError.classify(status: 404, data: Data("<html>404</html>".utf8))

    func timerSwitch(taskId: String, at: Int64) async throws -> ServerTimerState {
        try record("switch \(taskId) \(at)")
        if legacyOnly { throw Self.missing }
        if server.running, server.taskId == taskId { return server }
        if server.running, let a = server.taskId, let s = server.startTime, at - s >= 60_000 {
            events.append(TimeEvent(id: UUID().uuidString, from: Date(ms: s), to: Date(ms: at), taskId: a))
        }
        server = ServerTimerState(running: true, taskId: taskId, startTime: at)
        return server
    }

    func timerStop(taskId: String?, endTime: Int64?, startTime: Int64?) async throws {
        try record("stop \(taskId ?? "-") \(endTime ?? 0) \(startTime.map(String.init) ?? "-")")
        if legacyOnly { throw Self.missing }
        guard server.running, taskId == nil || server.taskId == taskId else { return }
        let s = startTime ?? server.startTime!
        let e = endTime ?? 0
        if e - s >= 60_000 { events.append(TimeEvent(id: UUID().uuidString, from: Date(ms: s), to: Date(ms: e), taskId: server.taskId!)) }
        server = ServerTimerState(running: false)
    }

    func timerAdjust(taskId: String, newStart: Int64) async throws -> ServerTimerState {
        try record("adjust \(taskId) \(newStart)")
        server.startTime = newStart
        return server
    }

    func timer() async throws -> ServerTimerState { try record("get"); return server }

    func createEvent(taskId: String, from: Date, to: Date, name: String, manual: Bool) async throws -> Bool {
        try record("event \(taskId) \(from.ms) \(to.ms)")
        if eventConflict { throw APIError.classify(status: 409, data: Data(#"{"error":"overlap"}"#.utf8)) }
        events.append(TimeEvent(id: UUID().uuidString, from: from, to: to, taskId: taskId))
        return true
    }

    func events(taskId: String?) async throws -> [TimeEvent] { try record("events"); return events.filter { $0.taskId == taskId } }

    func legacyTimerStart(taskId: String, startTime: Int64) async throws -> ServerTimerState {
        try record("legacyStart \(taskId) \(startTime)")
        server = ServerTimerState(running: true, taskId: taskId, startTime: startTime)
        return server
    }

    func legacyTimerDelete(taskId: String?) async throws {
        try record("legacyDelete \(taskId ?? "-")")
        if server.taskId == taskId || taskId == nil { server = ServerTimerState(running: false) }
    }
}

final class Clock: @unchecked Sendable {
    var now: Int64 = 1_790_416_800_000
    let lock = NSLock()
    func get() -> Int64 { lock.lock(); defer { lock.unlock() }; return now }
    func advance(_ ms: Int64) { lock.lock(); now += ms; lock.unlock() }
}

final class TimerEngineTests: XCTestCase {
    func makeEngine(_ t: FakeTransport, _ c: Clock, store: TimerStateStore = InMemoryTimerStore()) -> TimerEngine {
        TimerEngine(transport: t, store: store, clock: { c.get() }, sleeper: { _ in await Task.yield() })
    }

    func testStartSwitchStopHappyPath() async {
        let t = FakeTransport(), c = Clock()
        let e = makeEngine(t, c)
        await e.start(taskId: "A")
        var s = await e.state
        XCTAssertEqual(s.running?.taskId, "A")
        XCTAssertEqual(s.running?.pending, true)
        await e.waitUntilIdle()
        s = await e.state
        XCTAssertEqual(s.running?.pending, false)
        XCTAssertTrue(s.queue.isEmpty)

        c.advance(10 * 60_000)
        await e.start(taskId: "B")
        await e.waitUntilIdle()
        XCTAssertEqual(t.events.count, 1)
        XCTAssertEqual(t.events[0].taskId, "A")
        XCTAssertEqual(t.events[0].durationMs, 10 * 60_000)

        c.advance(5 * 60_000)
        await e.stop()
        s = await e.state
        XCTAssertNil(s.running)
        await e.waitUntilIdle()
        XCTAssertEqual(t.events.count, 2)
        XCTAssertFalse(t.server.running)
    }

    func testOfflineQueueHeals() async {
        let t = FakeTransport(), c = Clock()
        let e = makeEngine(t, c)
        t.failNext = [.network("offline"), .network("offline"), .network("offline")]
        await e.start(taskId: "A")
        c.advance(3 * 60_000)
        await e.stop()
        await e.waitUntilIdle()
        let s = await e.state
        XCTAssertTrue(s.queue.isEmpty)
        XCTAssertEqual(t.events.count, 1)
        XCTAssertEqual(t.events[0].durationMs, 3 * 60_000)
    }

    func testClientErrorDropsOpAndReports() async {
        let t = FakeTransport(), c = Clock()
        let e = makeEngine(t, c)
        final class Box: @unchecked Sendable { var errors: [String] = [] }
        let box = Box()
        await e.setListener { ev in if case .error(let m) = ev { box.errors.append(m) } }
        t.failNext = [APIError.classify(status: 404, data: Data(#"{"error":"Task not found"}"#.utf8))]
        await e.start(taskId: "gone")
        await e.waitUntilIdle()
        let s = await e.state
        XCTAssertNil(s.running)
        XCTAssertTrue(s.queue.isEmpty)
        XCTAssertEqual(box.errors, ["Couldn't save: Task not found"])
        XCTAssertFalse(s.legacyServer)
    }

    func testLegacyFallbackOn404() async {
        let t = FakeTransport(), c = Clock()
        t.legacyOnly = true
        let e = makeEngine(t, c)
        await e.start(taskId: "A")
        await e.waitUntilIdle()
        var s = await e.state
        XCTAssertTrue(s.legacyServer)
        XCTAssertEqual(t.server.taskId, "A")
        c.advance(2 * 60_000)
        await e.start(taskId: "B")
        await e.waitUntilIdle()
        XCTAssertEqual(t.events.count, 1)
        XCTAssertEqual(t.events[0].taskId, "A")
        XCTAssertEqual(t.server.taskId, "B")
        c.advance(30_000) // < 60 s → nothing saved
        await e.stop()
        await e.waitUntilIdle()
        XCTAssertEqual(t.events.count, 1)
        XCTAssertFalse(t.server.running)
        s = await e.state
        XCTAssertNil(s.running)
        XCTAssertTrue(t.calls.contains("legacyDelete B"))
    }

    func testLegacyConflictIdempotent() async {
        let t = FakeTransport(), c = Clock()
        t.legacyOnly = true
        let e = makeEngine(t, c)
        await e.start(taskId: "A")
        await e.waitUntilIdle()
        let start = c.get()
        c.advance(5 * 60_000)
        // Simulate: event already saved by an earlier attempt, server replies 409.
        t.events.append(TimeEvent(id: "x", from: Date(ms: start + 1000), to: Date(ms: c.get()), taskId: "A"))
        t.eventConflict = true
        await e.stop()
        await e.waitUntilIdle()
        let s = await e.state
        XCTAssertTrue(s.queue.isEmpty)
        XCTAssertFalse(t.server.running)
    }

    func testSocketIgnoredWhilePending() async {
        let t = FakeTransport(), c = Clock()
        let e = makeEngine(t, c)
        await e.setAutoSync(false)
        await e.start(taskId: "A")
        await e.handleSocket(.stopped(taskId: "A"))
        var s = await e.state
        XCTAssertEqual(s.running?.taskId, "A")
        await e.drain()
        await e.handleSocket(.started(taskId: "Z", startTime: 5))
        s = await e.state
        XCTAssertEqual(s.running?.taskId, "Z")
        await e.handleSocket(.startUpdated(taskId: "Z", startTime: 7))
        s = await e.state
        XCTAssertEqual(s.running?.startTime, 7)
        await e.handleSocket(.stopped(taskId: "Q"))
        s = await e.state
        XCTAssertNotNil(s.running)
        await e.handleSocket(.stopped(taskId: "Z"))
        s = await e.state
        XCTAssertNil(s.running)
    }

    func testAdjustStartRevertsOn409() async {
        let t = FakeTransport(), c = Clock()
        let e = makeEngine(t, c)
        await e.start(taskId: "A")
        await e.waitUntilIdle()
        let orig = await e.state.running!.startTime
        t.failNext = [APIError.classify(status: 409, data: Data(#"{"error":"This time entry overlaps"}"#.utf8))]
        do {
            try await e.adjustStart(orig - 10 * 60_000)
            XCTFail("should throw")
        } catch let err as APIError {
            XCTAssertEqual(err.message, "This time entry overlaps")
        } catch { XCTFail() }
        let s = await e.state
        XCTAssertEqual(s.running?.startTime, orig)
        try? await e.adjustStart(orig - 5 * 60_000)
        let s2 = await e.state
        XCTAssertEqual(s2.running?.startTime, orig - 5 * 60_000)
        XCTAssertEqual(t.server.startTime, orig - 5 * 60_000)
    }

    func testStopInPastWithStartOverride() async {
        let t = FakeTransport(), c = Clock()
        let e = makeEngine(t, c)
        await e.start(taskId: "A")
        await e.waitUntilIdle()
        let st = c.get()
        c.advance(60 * 60_000)
        await e.stop(at: st + 40 * 60_000, startOverride: st - 10 * 60_000)
        await e.waitUntilIdle()
        XCTAssertEqual(t.events.last?.durationMs, 50 * 60_000)
    }

    func testPersistedQueueReplaysAfterRelaunch() async {
        let t = FakeTransport(), c = Clock()
        let store = InMemoryTimerStore()
        let e1 = makeEngine(t, c, store: store)
        await e1.setAutoSync(false)
        await e1.start(taskId: "A")
        c.advance(2 * 60_000)
        await e1.stop()
        XCTAssertEqual(store.load()?.queue.count, 2)
        // "Relaunch"
        let e2 = makeEngine(t, c, store: store)
        await e2.kick()
        await e2.waitUntilIdle()
        XCTAssertEqual(t.events.count, 1)
        let s = await e2.state
        XCTAssertTrue(s.queue.isEmpty)
    }

    func testBindDifferentUserWipes() async {
        let t = FakeTransport(), c = Clock()
        let e = makeEngine(t, c)
        await e.bind(userId: "u1")
        await e.setAutoSync(false)
        await e.start(taskId: "A")
        await e.bind(userId: "u2")
        let s = await e.state
        XCTAssertNil(s.running)
        XCTAssertTrue(s.queue.isEmpty)
    }
}
