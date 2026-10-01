import AppKit
import SwiftUI
import QuartzCore
import TrackifyKit

// Test hooks for the menu-bar panel (test-hook builds only: DEBUG or TRACKIFY_UI_TEST=1):
//   -TrackifyPanelBench <file>   open/close, typing, hover, scroll and CPU numbers for the panel → text file, then quit
//   -TrackifyPanelShot <file.png> [-TrackifyPanelQuery text] [-TrackifyPanelHover n] [-TrackifyPanelScroll pt]
//                                the panel in its real window, imaged by the app itself, then quit
// Both put the panel far off-screen and never activate the app, so they can run on a Mac someone is using.

extension Notification.Name {
    /// Test hooks: set the panel's search text / hovered row (object: String or nil).
    static let trackifyBenchQuery = Notification.Name("trackify.bench.query")
    static let trackifyBenchHover = Notification.Name("trackify.bench.hover")
}

/// Pings the main thread every few ms from a background thread; records how long each ping waited.
final class MainThreadHitchMonitor: @unchecked Sendable {
    private let lock = NSLock()
    private var worst = 0.0
    private var over16 = 0
    private var over50 = 0
    private var stopped = false
    private var paused = false

    func start() {
        Thread.detachNewThread { [self] in
            while !isStopped {
                if isPaused { usleep(50_000); continue }
                let t0 = CACurrentMediaTime()
                let sem = DispatchSemaphore(value: 0)
                DispatchQueue.main.async { sem.signal() }
                sem.wait()
                record((CACurrentMediaTime() - t0) * 1000)
                usleep(4000)
            }
        }
    }

    private var isStopped: Bool { lock.lock(); defer { lock.unlock() }; return stopped }
    func stop() { lock.lock(); stopped = true; lock.unlock() }
    private var isPaused: Bool { lock.lock(); defer { lock.unlock() }; return paused }
    /// CPU samples run with the monitor paused (its pings cost CPU themselves).
    func pause(_ p: Bool) { lock.lock(); paused = p; lock.unlock() }

    private func record(_ ms: Double) {
        lock.lock()
        worst = max(worst, ms)
        if ms > 16.7 { over16 += 1 }
        if ms > 50 { over50 += 1 }
        lock.unlock()
    }

    /// (worst ms, pings over one 60 Hz frame, pings over 50 ms) since the last reset.
    func reset() -> (Double, Int, Int) {
        lock.lock(); defer { lock.unlock() }
        let r = (worst, over16, over50)
        worst = 0; over16 = 0; over50 = 0
        return r
    }
}

@MainActor
enum PanelBench {
    /// Read once: the panel's rows only subscribe to the hover hook in test-hook runs that ask for it.
    nonisolated(unsafe) static let hooksEnabled: Bool = {
        let d = UserDefaults.standard
        return d.string(forKey: "TrackifyPanelBench") != nil || d.string(forKey: "TrackifyPanelShot") != nil
    }()
    nonisolated(unsafe) static let shotRequested: Bool = UserDefaults.standard.string(forKey: "TrackifyPanelShot") != nil
    static var benchRequested: Bool { UserDefaults.standard.string(forKey: "TrackifyPanelBench") != nil }

    static func runIfRequested(model: AppModel) {
        guard model.isTestHookEnabled else { return }
        if let mode = UserDefaults.standard.string(forKey: "TrackifyPanelHold") { Task { await hold(model: model, mode: mode) } }
        if benchRequested { Task { await bench(model: model) } }
        if shotRequested { Task { await shot(model: model) } }
    }

    // MARK: Window

    @MainActor final class Host {
        let window: MenuPanelWindow
        let model: AppModel
        init(model: AppModel) {
            self.model = model
            window = StatusItemController.makePanelWindow(model: model, panelModel: PanelModel(model: model), close: {}, openDashboard: { _ in })
            window.benchForceKey = true
            window.setFrameOrigin(NSPoint(x: -20000, y: -20000))
        }
        func open() {
            window.setFrameOrigin(NSPoint(x: -20000, y: -20000))
            window.alphaValue = 1
            window.orderFront(nil)
            NotificationCenter.default.post(name: .trackifyPanelOpened, object: nil)
            if Self.refreshAfterOpen { DispatchQueue.main.async { [model] in model.foreground() } }
        }
        /// The status item refreshes once the panel's first frame is up (as `StatusItemController.showPanel`).
        static var refreshAfterOpen = true
        func close() {
            NotificationCenter.default.post(name: .trackifyPanelClosed, object: nil)
            window.orderOut(nil)
        }
        var scrollView: NSScrollView? { Self.find(NSScrollView.self, in: window.contentView) }
        static func find<T: NSView>(_ type: T.Type, in v: NSView?) -> T? {
            guard let v else { return nil }
            if let t = v as? T { return t }
            for s in v.subviews { if let t = find(type, in: s) { return t } }
            return nil
        }
    }

    /// Runs `f`, then waits until the main run loop is about to sleep again: SwiftUI's update, layout, drawing and
    /// the Core Animation commit for that change have all happened by then. Returns milliseconds.
    static func measure(_ f: () -> Void) async -> Double {
        let t0 = CACurrentMediaTime()
        f()
        return await withCheckedContinuation { (c: CheckedContinuation<Double, Never>) in
            let obs = CFRunLoopObserverCreateWithHandler(nil, CFRunLoopActivity.beforeWaiting.rawValue, false, CFIndex.max) { _, _ in
                c.resume(returning: (CACurrentMediaTime() - t0) * 1000)
            }
            CFRunLoopAddObserver(CFRunLoopGetMain(), obs, .commonModes)
        }
    }

    static func sleep(_ s: Double) async { try? await Task.sleep(nanoseconds: UInt64(s * 1e9)) }

    static func cpuSeconds() -> Double {
        var u = rusage()
        getrusage(RUSAGE_SELF, &u)
        return Double(u.ru_utime.tv_sec + u.ru_stime.tv_sec) + Double(u.ru_utime.tv_usec + u.ru_stime.tv_usec) / 1e6
    }

    static func waitForData(_ model: AppModel) async {
        for _ in 0..<300 where !(model.phase == .signedIn && model.tasksLoaded) { await sleep(0.1) }
        await sleep(3)   // first refresh + presence settle
    }

    static func stats(_ xs: [Double]) -> String {
        guard !xs.isEmpty else { return "n/a" }
        let s = xs.sorted()
        let med = s[s.count / 2]
        let p90 = s[min(s.count - 1, Int(Double(s.count) * 0.9))]
        return String(format: "median %.1f ms · p90 %.1f ms · max %.1f ms (n=%d)", med, p90, s.last!, s.count)
    }

    // MARK: Bench

    static func bench(model: AppModel) async {
        let out = UserDefaults.standard.string(forKey: "TrackifyPanelBench")!
        await waitForData(model)
        var lines: [String] = []
        func log(_ s: String) { lines.append(s); NSLog("bench: %@", s) }
        log("tasks \(model.tasks.count), events \(model.tasks.reduce(0) { $0 + $1.events.count }), running \(model.running != nil)")
        let mon = MainThreadHitchMonitor()
        mon.start()
        let host = Host(model: model)

        // The status item builds its panel ahead of the first click.
        host.window.contentView?.layoutSubtreeIfNeeded()
        await sleep(1)

        // Open / close.
        var opens: [Double] = []
        var settle: [String] = []
        for i in 0..<8 {
            _ = mon.reset()
            let ms = await measure { host.open() }
            opens.append(ms)
            await sleep(1.5)
            let h = mon.reset()
            settle.append(String(format: "%.0f", h.0))
            if i == 0 { log(String(format: "open (first, cold): %.1f ms", ms)) }
            host.close()
            await sleep(0.6)
        }
        log("open (warm, 7×): " + stats(Array(opens.dropFirst())))
        log("worst main-thread stall in the 1.5 s after each open (ms): " + settle.joined(separator: ", "))

        // Open and idle: the ticking clock.
        host.open()
        await sleep(2)
        mon.pause(true)
        var c0 = cpuSeconds()
        await sleep(20)
        var c1 = cpuSeconds()
        mon.pause(false)
        log(String(format: "CPU, panel open, idle 20 s: %.2f %%", (c1 - c0) / 20 * 100))
        var h = mon.reset()

        // Typing in search (one character at a time, then back).
        let word = "server"
        var typing: [Double] = []
        for n in 1...word.count {
            typing.append(await measure { NotificationCenter.default.post(name: .trackifyBenchQuery, object: String(word.prefix(n))) })
            await sleep(0.12)
        }
        for n in stride(from: word.count - 1, through: 0, by: -1) {
            typing.append(await measure { NotificationCenter.default.post(name: .trackifyBenchQuery, object: String(word.prefix(n))) })
            await sleep(0.12)
        }
        log("search keystroke → frame: " + stats(typing))

        // Hover across the rows.
        var hovers: [Double] = []
        let ids = Analytics.sortTasks(model.tasks, runningTaskId: model.running?.taskId).prefix(16).map(\.id)
        for id in ids {
            hovers.append(await measure { NotificationCenter.default.post(name: .trackifyBenchHover, object: id) })
            await sleep(0.05)
        }
        hovers.append(await measure { NotificationCenter.default.post(name: .trackifyBenchHover, object: nil) })
        log("hover row → frame: " + stats(hovers))

        // Scroll the list down and back up in 40 pt steps.
        if let sv = host.scrollView, let doc = sv.documentView {
            var scrolls: [Double] = []
            let maxY = max(0, doc.frame.height - sv.contentView.bounds.height)
            var y: CGFloat = 0
            var dir: CGFloat = 1
            _ = mon.reset()
            for _ in 0..<80 {
                y = min(maxY, max(0, y + dir * 40))
                if y >= maxY || y <= 0 { dir = -dir }
                let target = y
                scrolls.append(await measure {
                    sv.contentView.scroll(to: NSPoint(x: 0, y: target))
                    sv.reflectScrolledClipView(sv.contentView)
                })
                await sleep(0.016)
            }
            h = mon.reset()
            log(String(format: "scroll step (40 pt, document %.0f pt): ", doc.frame.height) + stats(scrolls) + String(format: " · frames over 16.7 ms: %d", h.1))
        } else {
            log("scroll: no scroll view found")
        }

        // Closed, timer running: the app as it sits in the menu bar.
        host.close()
        await sleep(2)
        mon.pause(true)
        c0 = cpuSeconds()
        await sleep(20)
        c1 = cpuSeconds()
        log(String(format: "CPU, panel closed, 20 s: %.2f %%", (c1 - c0) / 20 * 100))
        let rss = ProcessInfo.processInfo.physicalMemoryFootprintMB
        log(String(format: "memory footprint %.0f MB", rss))
        mon.stop()
        try? lines.joined(separator: "\n").appending("\n").write(toFile: out, atomically: true, encoding: .utf8)
        NSApp.terminate(nil)
    }

    // MARK: Hold (for `sample` / Instruments from outside)

    /// `-TrackifyPanelHold open|closed|type|scroll|hover`: one steady activity for 30 s after the data is in, then quit.
    static func hold(model: AppModel, mode: String) async {
        await waitForData(model)
        let host = Host(model: model)
        host.window.contentView?.layoutSubtreeIfNeeded()
        if mode != "closed" { host.open() }
        NSLog("bench: hold %@ start", mode)
        let end = Date().addingTimeInterval(30)
        let ids = Analytics.sortTasks(model.tasks, runningTaskId: model.running?.taskId).prefix(16).map(\.id)
        var i = 0
        while Date() < end {
            switch mode {
            case "type":
                let word = "server"
                let n = i % (2 * word.count)
                let q = String(word.prefix(n <= word.count ? n : 2 * word.count - n))
                NotificationCenter.default.post(name: .trackifyBenchQuery, object: q)
                await sleep(0.1)
            case "hover":
                NotificationCenter.default.post(name: .trackifyBenchHover, object: ids[i % ids.count])
                await sleep(0.05)
            case "scroll":
                if let sv = host.scrollView, let doc = sv.documentView {
                    let maxY = max(1, doc.frame.height - sv.contentView.bounds.height)
                    let phase = Double(i % 120) / 60
                    let y = maxY * (phase <= 1 ? phase : 2 - phase)
                    sv.contentView.scroll(to: NSPoint(x: 0, y: y))
                    sv.reflectScrolledClipView(sv.contentView)
                }
                await sleep(0.016)
            default:
                await sleep(1)
            }
            i += 1
        }
        NSLog("bench: hold %@ end", mode)
        NSApp.terminate(nil)
    }

    // MARK: Screenshot

    static func shot(model: AppModel) async {
        let d = UserDefaults.standard
        let out = d.string(forKey: "TrackifyPanelShot")!
        await waitForData(model)
        let host = Host(model: model)
        host.open()
        await sleep(1)
        if let q = d.string(forKey: "TrackifyPanelQuery") {
            NotificationCenter.default.post(name: .trackifyBenchQuery, object: q)
        }
        if d.object(forKey: "TrackifyPanelHover") != nil {
            let i = d.integer(forKey: "TrackifyPanelHover")
            let sorted = Analytics.sortTasks(model.tasks, runningTaskId: model.running?.taskId)
            if i < sorted.count { NotificationCenter.default.post(name: .trackifyBenchHover, object: sorted[i].id) }
        }
        await sleep(0.6)
        let scroll = d.double(forKey: "TrackifyPanelScroll")
        if scroll > 0, let sv = host.scrollView {
            let clip = sv.contentView
            clip.scroll(to: clip.constrainBoundsRect(NSRect(origin: NSPoint(x: 0, y: scroll), size: clip.bounds.size)).origin)
            sv.reflectScrolledClipView(sv.contentView)
        }
        await sleep(1.2)
        for _ in 0..<5 {
            if DebugPanelCapture.capture(host.window, to: out) { break }
            await sleep(0.5)
        }
        NSApp.terminate(nil)
    }
}

extension ProcessInfo {
    var physicalMemoryFootprintMB: Double {
        var info = task_vm_info_data_t()
        var count = mach_msg_type_number_t(MemoryLayout<task_vm_info_data_t>.size / MemoryLayout<integer_t>.size)
        let kr = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) { task_info(mach_task_self_, task_flavor_t(TASK_VM_INFO), $0, &count) }
        }
        return kr == KERN_SUCCESS ? Double(info.phys_footprint) / 1_048_576 : 0
    }
}

/// Images one of the app's own windows (with its shadow-less frame) to a PNG.
@MainActor
enum DebugPanelCapture {
    @discardableResult
    static func capture(_ window: NSWindow, to path: String) -> Bool {
        typealias Fn = @convention(c) (CGRect, UInt32, UInt32, UInt32) -> Unmanaged<CGImage>?
        var image: CGImage?
        if let sym = dlsym(UnsafeMutableRawPointer(bitPattern: -2), "CGWindowListCreateImage") {
            let f = unsafeBitCast(sym, to: Fn.self)
            image = f(.null, 1 << 3, UInt32(window.windowNumber), (1 << 0) | (1 << 3))?.takeRetainedValue()
        }
        guard let image else { NSLog("panel snapshot failed"); return false }
        return (try? NSBitmapImageRep(cgImage: image).representation(using: .png, properties: [:])?.write(to: URL(fileURLWithPath: path))) != nil
    }
}
