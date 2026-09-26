import XCTest

/// End-to-end timer flows on the near-empty `native@` account, verified against the lane API.
final class TimerFlowTests: TrackifyUITestCase {
    let account = "native@trackify.test"
    let password = "trackify-native"
    var token = ""

    // MARK: tiny API client for verification
    func api(_ method: String, _ path: String, _ body: [String: Any]? = nil) -> Any? {
        var req = URLRequest(url: URL(string: server + path)!)
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        if !token.isEmpty { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        if let body { req.httpBody = try? JSONSerialization.data(withJSONObject: body) }
        let sem = DispatchSemaphore(value: 0)
        var out: Any?
        URLSession.shared.dataTask(with: req) { d, _, _ in
            if let d { out = try? JSONSerialization.jsonObject(with: d) }
            sem.signal()
        }.resume()
        _ = sem.wait(timeout: .now() + 20)
        return out
    }

    func login() {
        let r = api("POST", "/api/auth/token", ["email": account, "password": password, "deviceName": "UI tests"]) as? [String: Any]
        token = r?["token"] as? String ?? ""
        XCTAssertFalse(token.isEmpty, "API login failed")
    }

    func tasks() -> [[String: Any]] { (api("GET", "/api/tasks") as? [[String: Any]]) ?? [] }
    func taskId(_ name: String) -> String? { tasks().first { ($0["name"] as? String) == name }?["id"] as? String }
    func timer() -> [String: Any] { (api("GET", "/api/timer") as? [String: Any]) ?? [:] }

    func ensureTask(_ name: String) {
        if taskId(name) == nil { _ = api("POST", "/api/tasks", ["name": name]) }
    }

    override func setUp() {
        super.setUp()
        login()
        // Clean slate: nothing running.
        _ = api("POST", "/api/timer/stop", [:])
        ensureTask("UITest Alpha")
        ensureTask("UITest Beta")
    }

    override func tearDown() {
        _ = api("POST", "/api/timer/stop", [:])
        // Remove entries created by this run (keeps the account near-empty).
        for name in ["UITest Alpha", "UITest Beta"] {
            if let id = taskId(name), let evs = api("GET", "/api/events?taskId=\(id)") as? [[String: Any]] {
                for e in evs { if let eid = e["id"] as? String { _ = api("DELETE", "/api/events/\(eid)") } }
            }
        }
        super.tearDown()
    }

    /// Finds a task-card button, expanding "Show All" and scrolling as needed.
    func taskButton(_ id: String) -> XCUIElement {
        let b = app.buttons[id]
        if !b.exists, app.buttons["showAllTasks"].exists { app.buttons["showAllTasks"].tap() }
        var tries = 0
        while (!b.exists || !b.isHittable) && tries < 6 { app.swipeUp(velocity: .slow); tries += 1 }
        return b
    }

    func scrollToTop() { for _ in 0..<5 { app.swipeDown(velocity: .fast) } }

    func testStartSwitchStopFixAndLogPast() {
        launch(account: "\(account):\(password)", extra: ["-TrackifyFreshLogin", "YES"])
        XCTAssertTrue(waitFor(app.staticTexts["Dashboard"], 40))

        // Start Alpha — optimistic UI, then the server confirms.
        XCTAssertTrue(waitFor(app.buttons["newTask"], 15))
        let startAlpha = taskButton("start-UITest Alpha")
        XCTAssertTrue(waitFor(startAlpha, 10))
        startAlpha.tap()
        scrollToTop()
        XCTAssertTrue(waitFor(app.buttons["stopRunning"], 5), "running banner missing")
        XCTAssertTrue(expectServer { ($0["taskId"] as? String) == self.taskId("UITest Alpha") }, "server never saw Alpha running")
        shot("flow-01-running")

        // Switch to Beta.
        taskButton("start-UITest Beta").tap()
        scrollToTop()
        XCTAssertTrue(expectServer { ($0["taskId"] as? String) == self.taskId("UITest Beta") }, "switch not saved")
        shot("flow-02-switched")

        // Fix this session: open, then keep (Save start time without moving closes the sheet).
        app.buttons["runningClock"].tap()
        XCTAssertTrue(waitFor(app.buttons["fixSave"], 5))
        shot("flow-03-fix")
        app.buttons["fixSave"].tap()

        // Stop.
        XCTAssertTrue(waitFor(app.buttons["stopRunning"], 5))
        app.buttons["stopRunning"].tap()
        XCTAssertTrue(expectServer { ($0["running"] as? Bool) == false }, "stop not saved")
        XCTAssertFalse(app.buttons["stopRunning"].waitForExistence(timeout: 2))

        // Log past time on Alpha → the server has a new manual entry.
        let alphaId = taskId("UITest Alpha") ?? ""
        let before = (api("GET", "/api/events?taskId=\(alphaId)") as? [[String: Any]])?.count ?? 0
        taskButton("logPast-UITest Alpha").tap()
        XCTAssertTrue(waitFor(app.buttons["logPastSave"], 5))
        shot("flow-04-logpast")
        app.buttons["logPastSave"].tap()
        shot("flow-04b-after-save", settle: 2.5)
        let deadline = Date().addingTimeInterval(15)
        var after = before
        while Date() < deadline && after <= before {
            Thread.sleep(forTimeInterval: 1)
            after = (api("GET", "/api/events?taskId=\(alphaId)") as? [[String: Any]])?.count ?? 0
        }
        XCTAssertEqual(after, before + 1, "log past entry not created")

        // Live sync: a timer started elsewhere (API) shows up via the socket.
        _ = api("POST", "/api/timer/switch", ["taskId": taskId("UITest Beta") ?? ""])
        scrollToTop()
        XCTAssertTrue(waitFor(app.buttons["stopRunning"], 15), "socket timer:started not reflected")
        shot("flow-05-live-sync")
        _ = api("POST", "/api/timer/stop", [:])
        let gone = NSPredicate(format: "exists == false")
        expectation(for: gone, evaluatedWith: app.buttons["stopRunning"])
        waitForExpectations(timeout: 15)
    }

    /// Polls `GET /api/timer` until the predicate holds.
    func expectServer(_ timeout: TimeInterval = 15, _ ok: @escaping ([String: Any]) -> Bool) -> Bool {
        let deadline = Date().addingTimeInterval(timeout)
        while Date() < deadline {
            if ok(timer()) { return true }
            Thread.sleep(forTimeInterval: 0.7)
        }
        return false
    }

    func testLaunchPerformance() {
        let opts = XCTMeasureOptions()
        opts.iterationCount = 3
        measure(metrics: [XCTApplicationLaunchMetric()], options: opts) {
            let a = XCUIApplication()
            a.launchArguments = ["-TrackifyServer", server]
            a.launch()
        }
    }
}
