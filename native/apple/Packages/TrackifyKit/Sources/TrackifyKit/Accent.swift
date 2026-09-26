import Foundation

/// Colour algorithms reproduced exactly from the web (WEB_AUDIT §5.3). Hex strings; the UI layer converts.
public enum Accent {
    public static let groupColorPresets = ["#c62828", "#ef6c00", "#f9a825", "#558b2f", "#00796b",
                                           "#0277bd", "#ad1457", "#4527a0", "#4e342e", "#37474f"]

    /// Names shown for preset swatches (accessibility).
    public static let groupColorPresetNames = ["Red", "Orange", "Amber", "Green", "Teal",
                                               "Blue", "Pink", "Indigo", "Brown", "Slate"]

    /// Chart task palette (Home + Stats) and the "Other" grey.
    public static let taskChartPalette = ["#3b82f6", "#f97316", "#10b981", "#8b5cf6", "#ec4899", "#14b8a6"]
    public static let otherHex = "#6b7280"

    /// Visualizations race palette.
    public static let racePalette = ["#2563eb", "#ea580c", "#059669", "#7c3aed", "#db2777",
                                     "#0891b2", "#ca8a04", "#dc2626", "#4f46e5", "#65a30d"]

    /// Leaderboard/race medal colours: amber-600, zinc-500, amber-800.
    public static let rankColors = ["#d97706", "#71717a", "#92400e"]

    /// Preview colour for Auto mode in the Create dialog.
    public static let autoPreviewHex = "#94a3b8"

    /// JS: `h = Math.imul(31, h) + id.charCodeAt(i); return Math.abs(h)` — the add is NOT wrapped.
    public static func hashGroupId(_ id: String) -> Int64 {
        var h: Int64 = 0
        for c in id.utf16 {
            let h32 = Int32(truncatingIfNeeded: h)
            h = Int64(h32 &* 31) + Int64(c)
        }
        return abs(h)
    }

    public static func groupAccentHex(_ groupId: String) -> String {
        groupColorPresets[Int(hashGroupId(groupId) % Int64(groupColorPresets.count))]
    }

    public static func taskAccentHex(_ taskId: String) -> String {
        groupColorPresets[Int(hashGroupId(taskId) % Int64(groupColorPresets.count))]
    }

    public static func isValidHex(_ s: String?) -> Bool {
        guard let s = s?.trimmingCharacters(in: .whitespaces), s.count == 7, s.first == "#" else { return false }
        return s.dropFirst().allSatisfy { $0.isHexDigit }
    }

    public static func resolveGroupAccent(id: String, color: String?) -> String {
        if let c = color?.trimmingCharacters(in: .whitespaces), isValidHex(c) { return c }
        return groupAccentHex(id)
    }

    /// `(hash * 31 + c) >>> 0` with UInt32 wrap.
    public static func raceHash(_ id: String) -> UInt32 {
        var h: UInt32 = 0
        for c in id.utf16 { h = h &* 31 &+ UInt32(c) }
        return h
    }

    public static func colorForId(_ id: String) -> String {
        racePalette[Int(raceHash(id) % UInt32(racePalette.count))]
    }

    public static func initials(_ name: String) -> String {
        let parts = name.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        if parts.isEmpty { return "?" }
        if parts.count == 1 { return String(parts[0].prefix(2)).uppercased() }
        return (String(parts[0].prefix(1)) + String(parts[parts.count - 1].prefix(1))).uppercased()
    }

    /// RGB components 0…1 of a `#RRGGBB` string (black if invalid).
    public static func rgb(_ hex: String) -> (r: Double, g: Double, b: Double) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let n = UInt32(s, radix: 16) else { return (0, 0, 0) }
        return (Double((n >> 16) & 255) / 255, Double((n >> 8) & 255) / 255, Double(n & 255) / 255)
    }
}

/// Yearly contribution heat colours (`lib/yearly-heat-color.ts`).
public enum HeatScale {
    public static let colors = ["#e8eee9", "#86efac", "#22c55e", "#15803d", "#052e16"]

    public static func workingDayMinutes(_ grid: [[Double]]) -> [Double] {
        grid.flatMap { $0 }.filter { $0 > 0 }.sorted()
    }

    static func percentile(_ sorted: [Double], _ p: Double) -> Double {
        guard !sorted.isEmpty else { return 0 }
        let idx = min(sorted.count - 1, max(0, Int((p * Double(sorted.count)).rounded(.up)) - 1))
        return sorted[idx]
    }

    public static func level(_ minutes: Double, working sorted: [Double]) -> Int {
        if minutes <= 0 { return 0 }
        var level = 1
        if minutes >= 3 * 60 { level = 2 }
        if minutes >= 5.5 * 60 { level = 3 }
        if minutes >= 8 * 60 { level = 4 }
        if sorted.count >= 8 {
            let p75 = percentile(sorted, 0.75)
            let p90 = percentile(sorted, 0.9)
            if minutes >= p90 && p90 > 0 { level = 4 }
            else if minutes >= p75 && p75 > 0 { level = level < 3 ? 3 : level }
        }
        return level
    }

    public static func color(_ minutes: Double, working sorted: [Double]) -> String {
        colors[level(minutes, working: sorted)]
    }
}
