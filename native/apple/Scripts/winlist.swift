// Prints "<windowId> <width>x<height> <name>" for on-screen windows of a PID (largest first),
// or the main screen size with --screen.
import CoreGraphics
import AppKit

let args = CommandLine.arguments
if args.count > 1 && args[1] == "--screen" {
    let f = NSScreen.main?.frame ?? .zero
    print("\(Int(f.width))x\(Int(f.height))")
    exit(0)
}
guard args.count > 1, let pid = Int32(args[1]) else { print("usage: winlist <pid>|--screen"); exit(1) }
let info = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as? [[String: Any]] ?? []
var rows: [(Int, Int, Int, String)] = []
for w in info {
    guard (w[kCGWindowOwnerPID as String] as? Int32) == pid, (w[kCGWindowLayer as String] as? Int) == 0 else { continue }
    let b = w[kCGWindowBounds as String] as? [String: CGFloat] ?? [:]
    let id = w[kCGWindowNumber as String] as? Int ?? 0
    rows.append((id, Int(b["Width"] ?? 0), Int(b["Height"] ?? 0), w[kCGWindowName as String] as? String ?? ""))
}
for r in rows.sorted(by: { $0.1 * $0.2 > $1.1 * $1.2 }) { print("\(r.0) \(r.1)x\(r.2) \(r.3)") }
