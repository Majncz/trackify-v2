import XCTest
import SwiftUI
import WidgetKit
import TrackifyKit

/// Renders the widget, Live Activity and Dynamic Island views to PNGs (SHOT_DIR) for review.
@MainActor
final class WidgetRenderTests: XCTestCase {
    let dir = ProcessInfo.processInfo.environment["SHOT_DIR"] ?? NSTemporaryDirectory()

    func write<V: View>(_ view: V, name: String, dark: Bool) {
        write(view.environment(\.colorScheme, dark ? .dark : .light), file: "widget-\(name)-\(dark ? "dark" : "light")")
    }

    func write<V: View>(_ view: V, file: String) {
        let r = ImageRenderer(content: view)
        r.scale = 3
        guard let img = r.uiImage, let data = img.pngData() else { XCTFail("render failed: \(file)"); return }
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let url = URL(fileURLWithPath: dir).appendingPathComponent("\(file).png")
        XCTAssertNoThrow(try data.write(to: url))
        let a = XCTAttachment(image: img)
        a.name = url.lastPathComponent
        a.lifetime = .keepAlways
        add(a)
    }

    /// Every home-screen widget at its iPhone 16 Pro and iPad Pro 13" size: light, dark and tinted (iOS 18).
    func testSystemWidgets() {
        for device in [WidgetGallery.Device.iphone, .ipad] {
            for c in WidgetGallery.cases(device, now: now) {
                for look in ["light", "dark", "tinted"] {
                    write(WidgetGallery.tile(c, look: look, desktop: false), file: "widget-\(device.rawValue)-\(c.name)-\(look)")
                }
            }
        }
    }

    var running: WidgetSnapshot { WidgetSamples.snapshot(running: true) }
    var idle: WidgetSnapshot { WidgetSamples.snapshot(running: false) }
    let now = Date()

    func testAccessoryWidgets() {
        let lock = { (v: AnyView, size: CGSize) in
            v.frame(width: size.width, height: size.height)
                .foregroundStyle(.white)
                .padding(20)
                .background(LinearGradient(colors: [Color(rgb: 0x312e81), Color(rgb: 0x0f172a)], startPoint: .top, endPoint: .bottom))
        }
        write(lock(AnyView(RectangularAccessory(s: running)), CGSize(width: 172, height: 76)), name: "accessory-rectangular", dark: true)
        write(lock(AnyView(RectangularAccessory(s: idle)), CGSize(width: 172, height: 76)), name: "accessory-rectangular-idle", dark: true)
        write(lock(AnyView(InlineAccessory(s: running)), CGSize(width: 260, height: 24)), name: "accessory-inline", dark: true)
        write(lock(AnyView(CircularAccessory(s: running).background(Circle().fill(.white.opacity(0.15)))), CGSize(width: 76, height: 76)), name: "accessory-circular", dark: true)
    }

    func testLiveActivity() {
        let state = TrackifyActivityAttributes.ContentState(taskId: "1", taskName: "Learning Swift", accentHex: "#0277bd",
                                                           startTime: Date().addingTimeInterval(-47 * 60), pending: false)
        for dark in [false, true] {
            let lockScreen = LiveActivityLockScreen(state: state)
                .frame(width: 370)
                .background(dark ? Color(rgb: 0x1c1c1e) : Color.white.opacity(0.92), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                .padding(20)
                .background(LinearGradient(colors: [Color(rgb: 0x4338ca), Color(rgb: 0x0f172a)], startPoint: .top, endPoint: .bottom))
            write(lockScreen, name: "liveactivity-lockscreen", dark: dark)
        }
        // Dynamic Island mock-ups (compact + expanded) built from the same regions.
        let compact = HStack {
            Circle().fill(Color(hex: state.accentHex)).frame(width: 10, height: 10)
            Spacer()
            Text("47:12").font(.system(size: 14, weight: .semibold, design: .monospaced)).foregroundStyle(.white)
        }
        .padding(.horizontal, 16)
        .frame(width: 250, height: 37)
        .background(Capsule().fill(.black))
        .padding(20)
        .background(Color(rgb: 0xe5e7eb))
        write(compact, name: "dynamicisland-compact", dark: true)

        let expanded = VStack(spacing: 10) {
            HStack {
                HStack(spacing: 6) {
                    Circle().fill(Color(hex: state.accentHex)).frame(width: 9, height: 9)
                    Text(state.taskName).font(.system(size: 15, weight: .semibold))
                }
                Spacer()
                Text("47:12").font(.system(size: 15, weight: .semibold, design: .monospaced))
            }
            HStack {
                Text(timerInterval: state.startTime...Date.distantFuture, countsDown: false)
                    .font(.system(size: 34, weight: .bold, design: .monospaced))
                Spacer()
                Label("Stop", systemImage: "square.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .padding(.horizontal, 16).padding(.vertical, 9)
                    .background(Theme.destructive, in: Capsule())
            }
        }
        .foregroundStyle(.white)
        .padding(20)
        .frame(width: 370)
        .background(RoundedRectangle(cornerRadius: 44, style: .continuous).fill(.black))
        .padding(20)
        .background(Color(rgb: 0xe5e7eb))
        write(expanded, name: "dynamicisland-expanded", dark: true)
    }
}
