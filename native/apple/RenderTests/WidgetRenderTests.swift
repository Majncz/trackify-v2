import XCTest
import SwiftUI
import WidgetKit
import TrackifyKit

/// Renders the widget, Live Activity and Dynamic Island views to PNGs (SHOT_DIR) for review.
@MainActor
final class WidgetRenderTests: XCTestCase {
    let dir = ProcessInfo.processInfo.environment["SHOT_DIR"] ?? NSTemporaryDirectory()

    func write<V: View>(_ view: V, name: String, dark: Bool) {
        let r = ImageRenderer(content: view.environment(\.colorScheme, dark ? .dark : .light))
        r.scale = 3
        guard let img = r.uiImage, let data = img.pngData() else { XCTFail("render failed: \(name)"); return }
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
        let url = URL(fileURLWithPath: dir).appendingPathComponent("widget-\(name)-\(dark ? "dark" : "light").png")
        XCTAssertNoThrow(try data.write(to: url))
        let a = XCTAttachment(image: img)
        a.name = url.lastPathComponent
        a.lifetime = .keepAlways
        add(a)
    }

    /// A home-screen-like tile.
    func tile<V: View>(_ content: V, size: CGSize, dark: Bool) -> some View {
        ZStack {
            (dark ? Color(rgb: 0x111111) : Color.white)
            content.padding(16)
        }
        .frame(width: size.width, height: size.height)
        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        .padding(24)
        .background(LinearGradient(colors: dark ? [Color(rgb: 0x1f2937), Color(rgb: 0x0f172a)] : [Color(rgb: 0xdbeafe), Color(rgb: 0xfce7f3)],
                                    startPoint: .topLeading, endPoint: .bottomTrailing))
    }

    var running: WidgetSnapshot { .preview }
    var idle: WidgetSnapshot { var s = WidgetSnapshot.preview; s.running = nil; return s }
    let now = Date()

    func testSystemWidgets() {
        for dark in [false, true] {
            write(tile(SmallWidget(s: running, now: now), size: CGSize(width: 170, height: 170), dark: dark), name: "small-running", dark: dark)
            write(tile(SmallWidget(s: idle, now: now), size: CGSize(width: 170, height: 170), dark: dark), name: "small-idle", dark: dark)
            write(tile(MediumWidget(s: running, now: now), size: CGSize(width: 364, height: 170), dark: dark), name: "medium-running", dark: dark)
            write(tile(MediumWidget(s: idle, now: now), size: CGSize(width: 364, height: 170), dark: dark), name: "medium-idle", dark: dark)
            write(tile(LargeWidget(s: running, now: now), size: CGSize(width: 364, height: 382), dark: dark), name: "large-running", dark: dark)
            write(tile(SignedOutWidget(compact: true), size: CGSize(width: 170, height: 170), dark: dark), name: "small-signedout", dark: dark)
        }
    }

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
