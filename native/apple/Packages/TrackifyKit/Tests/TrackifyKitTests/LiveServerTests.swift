import XCTest
@testable import TrackifyKit

/// Read-only decoding checks against the lane server. Run with `TRACKIFY_LIVE=1 swift test --filter LiveServerTests`.
final class LiveServerTests: XCTestCase {
    var server: URL { URL(string: ProcessInfo.processInfo.environment["TRACKIFY_SERVER"] ?? "https://trackify-native.dev.bitterlemon.co")! }

    override func setUpWithError() throws {
        try XCTSkipUnless(ProcessInfo.processInfo.environment["TRACKIFY_LIVE"] == "1", "live tests disabled")
    }

    func client() async throws -> APIClient {
        let c = APIClient(baseURL: server)
        let auth = try await c.login(email: "demo@trackify.test", password: "trackify-demo", deviceName: "TrackifyKit tests")
        c.token = auth.token
        return c
    }

    func testDecodeEverything() async throws {
        let c = try await client()
        let tasks = try await c.tasks()
        XCTAssertFalse(tasks.isEmpty)
        _ = try await c.tasks(hidden: true)
        _ = try await c.stats()
        let p = try await c.profile()
        XCTAssertNotNil(p.id)
        _ = try await c.groups()
        _ = try await c.timer()
        _ = try await c.presence(day: DayCalc.current.dayKey(Date()), range: .week)
        let race = try await c.race(from: DayCalc.current.dayKey(Date().addingTimeInterval(-6 * 86400)), to: DayCalc.current.dayKey(Date()))
        XCTAssertFalse(race.users.isEmpty)
        _ = try await c.billingTasks()
        let sessions = try await c.billingSessions(from: nil, to: nil, status: .all, taskGroupId: nil, taskId: nil)
        XCTAssertFalse(sessions.isEmpty)
        _ = try await c.billingSummary()
        _ = try await c.payments()
        _ = try await c.aiPresets()
        _ = try await c.aiPeriods()
        _ = try await c.aiAnalytics(viewCurrency: "CZK")
        _ = try await c.conversations()
        try await c.logout()
    }

    func testSocketAuthenticates() async throws {
        #if !canImport(Darwin)
        throw XCTSkip("URLSessionWebSocketTask needs libcurl websockets on Linux")
        #endif
        let c = try await client()
        let sock = SocketIOClient()
        let exp = expectation(description: "auth")
        sock.onEvent = { name, _ in if name == "auth:success" { exp.fulfill() } }
        sock.connect(baseURL: server, token: c.token!)
        await fulfillment(of: [exp], timeout: 15)
        sock.disconnect()
    }
}
