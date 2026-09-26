import XCTest

/// Shared helpers: launch with test hooks, screenshots written straight to the host (SHOT_DIR) and attached to the result.
class TrackifyUITestCase: XCTestCase {
    var app: XCUIApplication!
    let env = ProcessInfo.processInfo.environment
    var server: String { env["TRACKIFY_SERVER"] ?? "https://trackify-native.dev.bitterlemon.co" }
    var prefix: String { env["SHOT_PREFIX"] ?? "iphone" }
    var isPad: Bool { UIDevice.current.userInterfaceIdiom == .pad }

    override func setUp() {
        continueAfterFailure = true
        if let o = env["SHOT_ORIENTATION"], o == "landscape" { XCUIDevice.shared.orientation = .landscapeLeft }
        else { XCUIDevice.shared.orientation = .portrait }
    }

    func launch(account: String? = "demo@trackify.test:trackify-demo", screen: String = "home", extra: [String] = []) {
        app = XCUIApplication()
        var args = ["-TrackifyServer", server, "-TrackifyScreen", screen]
        if let account { args += ["-TrackifyAutoLogin", account] }
        if let cat = env["SHOT_CONTENT_SIZE"], !cat.isEmpty { args += ["-UIPreferredContentSizeCategoryName", cat] }
        app.launchArguments = args + extra
        app.launchEnvironment["TRACKIFY_UI_TEST"] = "1"
        app.launch()
    }

    func shot(_ name: String, settle: TimeInterval = 0.8) {
        Thread.sleep(forTimeInterval: settle)
        let s = XCUIScreen.main.screenshot()
        let a = XCTAttachment(screenshot: s)
        a.name = "\(prefix)-\(name)"
        a.lifetime = .keepAlways
        add(a)
        if let dir = env["SHOT_DIR"], !dir.isEmpty {
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            try? s.pngRepresentation.write(to: URL(fileURLWithPath: dir).appendingPathComponent("\(prefix)-\(name).png"))
        }
    }

    @discardableResult
    func waitFor(_ e: XCUIElement, _ timeout: TimeInterval = 20) -> Bool { e.waitForExistence(timeout: timeout) }

    /// Tab bar (iPhone) or sidebar (iPad / regular width).
    func go(_ label: String) {
        let tab = app.tabBars.buttons[label]
        if tab.exists { tab.tap(); return }
        let nav = app.descendants(matching: .any).matching(identifier: "nav-\(label)").firstMatch
        if nav.exists {
            nav.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            Thread.sleep(forTimeInterval: 0.8)
            return
        }
        let cell = app.collectionViews.cells.containing(.staticText, identifier: label).firstMatch
        if cell.exists { cell.tap(); return }
        let text = app.staticTexts[label].firstMatch
        if text.exists { text.tap(); return }
        app.buttons[label].firstMatch.tap()
    }

    func dismissSheet() {
        let close = app.buttons["Close"].firstMatch
        if close.exists && close.isHittable { close.tap() }
        else { app.swipeDown(velocity: .fast) }
        Thread.sleep(forTimeInterval: 0.6)
    }

    func scrollDown(_ times: Int = 1) {
        for _ in 0..<times { app.swipeUp(velocity: .slow) }
    }

    func scrollTop() {
        for _ in 0..<4 { app.swipeDown(velocity: .fast) }
    }
}

/// Walks every screen with the rich demo account and saves screenshots.
final class ScreenshotWalkTests: TrackifyUITestCase {

    func test01Login() {
        launch(account: nil, extra: ["-TrackifyResetSession", "YES"])
        XCTAssertTrue(waitFor(app.buttons["signIn"]))
        shot("00-login")
        app.buttons["advanced"].tap()
        shot("00-login-advanced")
    }

    func test02Walk() {
        launch()
        XCTAssertTrue(waitFor(app.staticTexts["Dashboard"], 40), "home never appeared")
        waitFor(app.otherElements["leaderboard"], 10)
        shot("01-home", settle: 2.5)
        scrollDown()
        shot("02-home-tasks")
        scrollDown(2)
        shot("03-home-timespent", settle: 1.5)
        if app.buttons["Yearly"].exists {
            app.buttons["Yearly"].tap()
            shot("04-home-yearly", settle: 1.2)
        }
        scrollTop()

        // Fix this session (a timer is running on the demo account during CI)
        let clock = app.buttons["runningClock"]
        if clock.waitForExistence(timeout: 5) {
            clock.tap()
            if waitFor(app.buttons["fixSave"], 5) { shot("05-fix-session") }
            dismissSheet()
        }

        // Log past time on the first task card
        let plus = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'logPast-'")).firstMatch
        if plus.waitForExistence(timeout: 5) {
            plus.tap()
            if waitFor(app.buttons["logPastSave"], 5) { shot("06-log-past") }
            dismissSheet()
        }

        app.buttons["newTask"].tap()
        if waitFor(app.textFields["newTaskName"], 5) { shot("07-new-task") }
        dismissSheet()

        // Task detail
        let card = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'taskCard-'")).element(boundBy: 1)
        if card.waitForExistence(timeout: 5) {
            // Tap the title area — the lower half holds Start/Stop buttons.
            card.coordinate(withNormalizedOffset: CGVector(dx: 0.25, dy: 0.12)).tap()
            if waitFor(app.buttons["taskName"], 8) {
                shot("08-task-detail", settle: 1.5)
                scrollDown(2)
                shot("09-task-billing", settle: 1.2)
            }
            let back = app.navigationBars.buttons.element(boundBy: 0)
            if back.exists { back.tap() }
        }

        go("Stats")
        shot("10-stats", settle: 2)
        scrollDown(2)
        shot("11-stats-top")
        scrollDown(3)
        shot("12-stats-groups")
        if app.buttons["createGroup"].exists {
            app.buttons["createGroup"].tap()
            if waitFor(app.textFields["groupName"], 5) { shot("13-group-editor") }
            dismissSheet()
        }

        go("Team")
        shot("14-team", settle: 2.5)
        scrollDown(2)
        shot("15-team-race", settle: 3)

        go("Billing")
        shot("16-billing", settle: 2.5)
        scrollDown(2)
        shot("17-billing-sessions", settle: 1)
        scrollTop()
        for (tab, name) in [("History", "18-billing-history"), ("Rates", "19-billing-rates"), ("AI billing", "20-billing-ai")] {
            let b = app.buttons[tab].firstMatch
            if b.exists {
                b.tap()
                shot(name, settle: 2)
                scrollDown(2)
                shot(name + "-more", settle: 1)
                scrollTop()
            }
        }

        go("Chat")
        shot("21-chat", settle: 1.5)
        let firstConversation = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'chatTab-'")).firstMatch
        if firstConversation.waitForExistence(timeout: 3) {
            firstConversation.tap()
            shot("21-chat-conversation", settle: 3)
        }

        if isPad || !app.tabBars.firstMatch.exists {
            go("Settings")
        } else {
            go("Home")
            app.buttons["openSettings"].tap()
        }
        shot("22-settings", settle: 1.5)
        scrollDown(2)
        shot("23-settings-more")
    }

    /// Live Activity on the lock screen and in the Dynamic Island (timer running on the demo account in CI).
    func test03LiveActivity() {
        launch()
        XCTAssertTrue(waitFor(app.staticTexts["Dashboard"], 40))
        guard app.buttons["runningClock"].waitForExistence(timeout: 10) else { return }
        Thread.sleep(forTimeInterval: 3)
        XCUIDevice.shared.press(.home)
        shot("24-dynamic-island", settle: 2.5)
        XCUIDevice.shared.perform(NSSelectorFromString("pressLockButton"))
        shot("25-lock-screen-live-activity", settle: 3)
    }
}
