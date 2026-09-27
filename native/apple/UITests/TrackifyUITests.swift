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
        if tab.exists { tab.tap(); Thread.sleep(forTimeInterval: 0.4); return }
        let nav = app.descendants(matching: .any).matching(identifier: "nav-\(label)").firstMatch
        if nav.exists {
            nav.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            Thread.sleep(forTimeInterval: 0.8)
            return
        }
        let cell = app.collectionViews.cells.containing(.staticText, identifier: label).firstMatch
        if cell.exists { cell.tap(); return }
        app.buttons[label].firstMatch.tap()
    }

    var hasTabBar: Bool { app.tabBars.firstMatch.exists }

    /// A More destination: More tab → row on iPhone, sidebar row on iPad.
    func openMore(_ id: String, _ label: String) {
        if hasTabBar {
            go("More")
            let row = app.descendants(matching: .any).matching(identifier: "more-\(id)").firstMatch
            if !row.waitForExistence(timeout: 3) { go("More") }   // second tap pops to root
            if row.waitForExistence(timeout: 3) { row.tap() } else { app.staticTexts[label].firstMatch.tap() }
            Thread.sleep(forTimeInterval: 0.6)
        } else {
            go(label)
        }
    }

    /// A row on the Billing screen (Sessions · Payments · Rates · AI Subscriptions).
    @discardableResult
    func openBilling(_ id: String) -> Bool {
        let r = app.descendants(matching: .any).matching(identifier: "billing-\(id)").firstMatch
        guard r.waitForExistence(timeout: 5) else { return false }
        r.tap()
        Thread.sleep(forTimeInterval: 0.6)
        return true
    }

    /// Back to the Billing list: re-enter it from More on iPhone, Back on iPad.
    func backToBilling() {
        if hasTabBar { openMore("billing", "Billing") } else { back() }
    }

    func back() {
        let b = app.navigationBars.buttons.element(boundBy: 0)
        if b.exists { b.tap(); Thread.sleep(forTimeInterval: 0.6) }
    }

    /// Timer tab is on screen (header "Today …").
    var timerHeader: XCUIElement { app.descendants(matching: .any).matching(identifier: "todayTotal").firstMatch }

    /// A task row on the Timer tab, scrolled into view.
    func taskRow(_ name: String) -> XCUIElement {
        let b = app.buttons["task-\(name)"]
        var tries = 0
        while (!b.exists || !b.isHittable) && tries < 6 { app.swipeUp(velocity: .slow); tries += 1 }
        return b
    }

    /// Long-press a row and pick an item from its context menu.
    func rowMenu(_ row: XCUIElement, _ item: String) {
        row.press(forDuration: 1.2)
        let b = app.buttons[item].firstMatch
        if b.waitForExistence(timeout: 3) { b.tap() }
    }

    func waitGone(_ e: XCUIElement, _ timeout: TimeInterval = 5) {
        let deadline = Date().addingTimeInterval(timeout)
        while e.exists && Date() < deadline { Thread.sleep(forTimeInterval: 0.3) }
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

    func hideKeyboard() {
        if app.keyboards.firstMatch.exists {
            let go = app.keyboards.buttons["Go"]
            if go.exists { app.swipeDown(velocity: .fast) } else { app.swipeDown(velocity: .fast) }
        }
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
        XCTAssertTrue(waitFor(timerHeader, 40), "timer tab never appeared")
        waitFor(app.buttons["runningClock"], 8)
        shot("01-timer", settle: 2.5)
        scrollDown()
        shot("02-timer-scrolled")
        scrollTop()

        // Fix this session (a timer is running on the demo account during CI)
        let clock = app.buttons["runningClock"]
        if clock.waitForExistence(timeout: 5) {
            clock.tap()
            if waitFor(app.buttons["fixSave"], 5) { shot("03-fix-session") }
            dismissSheet()
            waitGone(app.buttons["fixSave"])
        }

        // Search → filter, then a name that doesn't exist → "Create … and start"
        let search = app.textFields["taskSearch"]
        if search.waitForExistence(timeout: 5) {
            if !search.isHittable { scrollTop() }
            search.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.5)).tap()
            search.typeText("le")
            shot("04-search")
            search.typeText("sson plans")
            if waitFor(app.buttons["createAndStart"], 3) { shot("05-search-create") }
            app.buttons["Clear"].firstMatch.tap()
            hideKeyboard()
        }

        // Row menu (long press) → Log past time
        let row = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'task-'")).element(boundBy: 1)
        if row.waitForExistence(timeout: 5) {
            row.press(forDuration: 1.2)
            shot("06-row-menu", settle: 1)
            let log = app.buttons["Log past time…"].firstMatch
            if log.waitForExistence(timeout: 3) {
                log.tap()
                if waitFor(app.buttons["logPastSave"], 5) { shot("07-log-past") }
                dismissSheet()
            } else { app.swipeDown(velocity: .fast) }
        }

        app.buttons["newTask"].tap()
        if waitFor(app.textFields["newTaskName"], 5) { shot("08-new-task") }
        dismissSheet()

        // Task detail from the running card's name
        let runningName = app.buttons["runningTask"]
        if runningName.waitForExistence(timeout: 3) {
            runningName.tap()
        } else if row.exists {
            rowMenu(row, "Details")
        }
        if waitFor(app.buttons["renameTask"], 8) {
            shot("09-task-detail", settle: 1.5)
            scrollDown(3)
            shot("10-task-detail-more", settle: 1.2)
            if hasTabBar {
                // Re-tapping the active tab pops back to the Timer list.
                go("Timer")
                XCTAssertTrue(waitFor(app.textFields["taskSearch"], 5), "re-tapping Timer didn't pop to root")
            } else {
                back()
            }
        }

        // Owner bug: switching tabs from a pushed screen must work, and the tab keeps its stack.
        go("Stats")
        shot("11-stats", settle: 2)
        scrollDown(2)
        shot("12-stats-top")
        scrollDown(3)
        shot("13-stats-groups", settle: 1)
        if app.buttons["createGroup"].exists {
            app.buttons["createGroup"].tap()
            if waitFor(app.textFields["groupName"], 5) { shot("14-group-editor") }
            dismissSheet()
            if app.textFields["groupName"].exists {
                // Form sheet on iPad: tap the dimmed area above it.
                app.coordinate(withNormalizedOffset: CGVector(dx: 0.5, dy: 0.04)).tap()
                waitGone(app.textFields["groupName"])
            }
        }
        scrollDown(4)
        shot("15-stats-activity", settle: 1.5)

        go("Team")
        waitFor(app.otherElements["leaderboard"], 10)
        shot("16-team", settle: 2.5)
        var race = app.descendants(matching: .any).matching(identifier: "openRace").firstMatch
        if !race.waitForExistence(timeout: 3) { race = app.staticTexts["Race"].firstMatch }
        if race.waitForExistence(timeout: 3) {
            race.tap()
            shot("17-race", settle: 3)
            if hasTabBar {
                go("Team")
                XCTAssertTrue(race.waitForExistence(timeout: 3), "re-tapping Team didn't pop to root")
            }
        }

        openMore("billing", "Billing")
        shot("18-more-billing", settle: 2.5)
        if openBilling("sessions") {
            shot("19-billing-sessions", settle: 2)
            let select = app.buttons["billingSelect"]
            if select.waitForExistence(timeout: 3) && select.isEnabled {
                select.tap()
                let rows = app.descendants(matching: .any).matching(identifier: "sessionRow")
                if rows.element(boundBy: 1).waitForExistence(timeout: 3) {
                    rows.element(boundBy: 0).tap()
                    rows.element(boundBy: 1).tap()
                }
                shot("19b-billing-select", settle: 1)
                let mark = app.buttons["billingMarkPaid"]
                if mark.waitForExistence(timeout: 2) && mark.isEnabled {
                    mark.tap()
                    if waitFor(app.buttons["markPaidSubmit"], 4) { shot("19c-billing-mark-paid", settle: 1) }
                    app.buttons["Cancel"].firstMatch.tap()
                    waitGone(app.buttons["markPaidSubmit"])
                }
                let done = app.navigationBars.buttons["Done"]
                if done.exists { done.tap() }
            }
            backToBilling()
        }
        if openBilling("payments") {
            shot("20-billing-history", settle: 1.5)
            let payment = app.descendants(matching: .any).matching(identifier: "paymentRow").firstMatch
            if payment.waitForExistence(timeout: 3) {
                payment.tap()
                shot("20b-billing-payment", settle: 1.5)
            }
            backToBilling()
        }
        if openBilling("rates") {
            shot("21-billing-rates", settle: 1.5)
            let rate = app.descendants(matching: .any).matching(NSPredicate(format: "identifier BEGINSWITH 'rate-'")).firstMatch
            if rate.waitForExistence(timeout: 3) {
                rate.tap()
                if waitFor(app.textFields["hourlyRate"], 4) { shot("21b-billing-rate-editor", settle: 1) }
            }
            backToBilling()
        }
        if openBilling("ai") {
            shot("22-billing-ai", settle: 2.5)
            let add = app.buttons["addAIBilling"]
            if add.exists {
                add.tap()
                if waitFor(app.buttons["aiSave"], 4) { shot("22b-billing-ai-editor", settle: 1) }
                app.buttons["Cancel"].firstMatch.tap()
                waitGone(app.buttons["aiSave"])
            }
            scrollDown(4)
            let entry = app.descendants(matching: .any).matching(identifier: "aiEntry").firstMatch
            if entry.waitForExistence(timeout: 3) {
                entry.tap()
                shot("22c-billing-ai-entry", settle: 1.5)
            }
            backToBilling()
        }

        openMore("chat", "AI chat")
        shot("23-chat", settle: 1.5)
        let firstConversation = app.buttons.matching(NSPredicate(format: "identifier BEGINSWITH 'chatTab-'")).firstMatch
        if firstConversation.waitForExistence(timeout: 3) {
            firstConversation.tap()
            shot("24-chat-conversation", settle: 3)
        }

        openMore("settings", "Settings")
        shot("25-settings", settle: 1.5)
        scrollDown(2)
        shot("26-settings-more")

        // Owner's bug: from Settings, tapping Timer must show the timer.
        go("Timer")
        XCTAssertTrue(waitFor(timerHeader, 5), "Timer tab not reachable from Settings")
        if hasTabBar {
            // More remembers Settings; re-tap returns to the More list.
            go("More")
            XCTAssertTrue(app.navigationBars["Settings"].waitForExistence(timeout: 3), "More lost its stack")
            go("More")
            XCTAssertTrue(waitFor(app.descendants(matching: .any).matching(identifier: "more-billing").firstMatch, 3), "re-tapping More didn't pop")
            shot("27-more", settle: 1)
        }

        openMore("hidden", "Hidden tasks")
        shot("28-hidden-tasks", settle: 1.5)
        openMore("widgets", "Widgets")
        shot("29-widgets", settle: 1)
        openMore("about", "About")
        XCTAssertTrue(waitFor(app.staticTexts["appVersion"], 5))
        shot("30-about", settle: 1)
    }

    /// Live Activity on the lock screen and in the Dynamic Island (timer running on the demo account in CI).
    func test03LiveActivity() {
        launch()
        XCTAssertTrue(waitFor(timerHeader, 40))
        guard app.buttons["runningClock"].waitForExistence(timeout: 10) else { return }
        Thread.sleep(forTimeInterval: 3)
        XCUIDevice.shared.press(.home)
        shot("31-dynamic-island", settle: 2.5)
        XCUIDevice.shared.perform(NSSelectorFromString("pressLockButton"))
        shot("32-lock-screen-live-activity", settle: 3)
    }

    /// Short pass over the main screens for the device matrix (keeps CI time bounded).
    func test04KeyScreens() {
        launch()
        XCTAssertTrue(waitFor(timerHeader, 40))
        waitFor(app.buttons["runningClock"], 8)
        shot("k1-timer", settle: 4)
        go("Stats"); shot("k2-stats", settle: 2)
        go("Team"); shot("k3-team", settle: 2.5)
        if hasTabBar { go("More"); shot("k4-more", settle: 1) }
        openMore("billing", "Billing"); shot("k5-billing", settle: 2.5)
        openMore("chat", "AI chat"); shot("k6-chat", settle: 1.5)
        openMore("settings", "Settings"); shot("k7-settings", settle: 1.5)
    }
}
