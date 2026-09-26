import Foundation

/// Formatting helpers reproduced exactly from the web (WEB_AUDIT §5.4).
public enum Fmt {
    /// `HH:MM:SS` with unbounded hours (running clock).
    public static func duration(_ ms: Int64) -> String {
        let seconds = max(0, ms) / 1000
        let minutes = seconds / 60
        let hours = minutes / 60
        return String(format: "%02d:%02d:%02d", Int(hours), Int(minutes % 60), Int(seconds % 60))
    }

    /// Compact `h:mm` used by the macOS menu-bar label.
    public static func hoursMinutes(_ ms: Int64) -> String {
        let minutes = max(0, ms) / 60000
        return String(format: "%d:%02d", Int(minutes / 60), Int(minutes % 60))
    }

    /// `formatDurationWords` — "0s", "Ns", "Nm" (seconds dropped), "Nh", "Nh Nm"; `seconds:true` adds seconds.
    public static func durationWords(_ ms: Int64, seconds withSeconds: Bool = false) -> String {
        if ms == 0 { return "0s" }
        let totalSeconds = ms / 1000
        let s = totalSeconds % 60
        let m = (totalSeconds / 60) % 60
        let h = totalSeconds / 3600
        if withSeconds {
            if h == 0 && m == 0 { return "\(s)s" }
            if h == 0 { return "\(m)m \(s)s" }
            if m == 0 { return "\(h)h \(s)s" }
            return "\(h)h \(m)m \(s)s"
        }
        if h == 0 && m == 0 { return "\(s)s" }
        if h == 0 { return "\(m)m" }
        if m == 0 { return "\(h)h" }
        return "\(h)h \(m)m"
    }

    /// Stats `fmtMs`.
    public static func fmtMs(_ ms: Int64) -> String {
        if ms <= 0 { return "0s" }
        let totalSeconds = ms / 1000
        let h = totalSeconds / 3600
        let m = (totalSeconds % 3600) / 60
        let s = totalSeconds % 60
        if h > 0 && m > 0 { return "\(h)h \(m)m" }
        if h > 0 { return "\(h)h" }
        if m > 0 && s > 0 { return "\(m)m \(s)s" }
        if m > 0 { return "\(m)m" }
        return "\(s)s"
    }

    /// `formatHeatMinutes`.
    public static func heatMinutes(_ totalMinutes: Double) -> String {
        guard totalMinutes.isFinite, totalMinutes > 0 else { return "0s" }
        let secExact = totalMinutes * 60
        let roundedWhole = Int64(jsRound(secExact))
        if roundedWhole == 0 && secExact > 0 {
            let digits = secExact >= 0.1 ? 2 : (secExact >= 0.01 ? 3 : 4)
            let fixed = String(format: "%.\(digits)f", secExact)
            return "\(trimNumber(Double(fixed) ?? secExact))s"
        }
        if roundedWhole == 0 { return "0s" }
        let h = roundedWhole / 3600
        let m = (roundedWhole % 3600) / 60
        let s = roundedWhole % 60
        if h > 0 { return "\(h)h \(m)m \(s)s" }
        if m > 0 { return "\(m)m \(s)s" }
        return "\(s)s"
    }

    /// `formatDurationMinutes` (billing).
    public static func durationMinutes(_ totalMinutes: Double) -> String {
        let m = max(0, Int64(jsRound(totalMinutes)))
        let h = m / 60, mm = m % 60
        if h <= 0 { return "\(mm)m" }
        if mm == 0 { return "\(h)h" }
        return "\(h)h \(mm)m"
    }

    /// `formatRaceDuration`.
    public static func raceDuration(_ ms: Int64) -> String {
        if ms <= 0 { return "0m" }
        if ms < 60_000 { return "\(ms / 1000)s" }
        let totalMinutes = ms / 60_000
        let h = totalMinutes / 60, m = totalMinutes % 60
        if h == 0 { return "\(m)m" }
        if m == 0 { return "\(h)h" }
        return "\(h)h \(m)m"
    }

    /// `formatPlayClock` — "m:ss".
    public static func playClock(_ ms: Int64) -> String {
        let total = max(0, ms / 1000)
        return String(format: "%d:%02d", Int(total / 60), Int(total % 60))
    }

    /// Chat helper `formatDuration`: "Xh Ym" / "Xh" / "Ym".
    public static func chatDuration(_ ms: Int64) -> String {
        let h = ms / 3_600_000, m = (ms % 3_600_000) / 60000
        if h > 0 && m > 0 { return "\(h)h \(m)m" }
        if h > 0 { return "\(h)h" }
        return "\(m)m"
    }

    /// `agoLabel` — "now", "N min ago", "1 hour ago", "N hours ago", "Nh Mm ago".
    public static func agoLabel(_ ms: Int64, now: Int64) -> String {
        let mins = max(0, Int64(jsRound(Double(now - ms) / 60000)))
        if mins <= 0 { return "now" }
        if mins < 60 { return "\(mins) min ago" }
        let hours = mins / 60, rest = mins % 60
        if rest == 0 { return hours == 1 ? "1 hour ago" : "\(hours) hours ago" }
        return "\(hours)h \(rest)m ago"
    }

    /// JS `Math.round` (half up toward +∞).
    public static func jsRound(_ x: Double) -> Double { (x + 0.5).rounded(.down) }

    static func trimNumber(_ d: Double) -> String {
        if d == d.rounded() { return String(Int64(d)) }
        var s = String(d)
        if s.contains("e") { s = String(format: "%.4f", d) }
        while s.hasSuffix("0") { s.removeLast() }
        if s.hasSuffix(".") { s.removeLast() }
        return s
    }
}

/// Money formatting (WEB_AUDIT §1.7): `cs-CZ` for CZK, system locale otherwise.
public enum Money {
    public static let defaultCurrency = "CZK"

    public struct CurrencyOption: Hashable, Sendable { public let code: String; public let label: String }

    public static let presets: [CurrencyOption] = [
        .init(code: "CZK", label: "CZK — Czech koruna"),
        .init(code: "EUR", label: "EUR — Euro"),
        .init(code: "USD", label: "USD — US dollar"),
        .init(code: "GBP", label: "GBP — British pound"),
        .init(code: "PLN", label: "PLN — Polish złoty"),
        .init(code: "CHF", label: "CHF — Swiss franc"),
        .init(code: "SEK", label: "SEK — Swedish krona"),
        .init(code: "NOK", label: "NOK — Norwegian krone"),
        .init(code: "DKK", label: "DKK — Danish krone"),
        .init(code: "HUF", label: "HUF — Hungarian forint"),
    ]

    public static func options(including current: String?) -> [CurrencyOption] {
        var rows = presets
        if let c = current?.trimmingCharacters(in: .whitespaces).uppercased(), !c.isEmpty,
           !presets.contains(where: { $0.code == c }) {
            rows.append(.init(code: c, label: "\(c) — other"))
        }
        return rows
    }

    static func normalized(_ currency: String) -> String {
        currency.count >= 3 ? String(currency.prefix(3)).uppercased() : defaultCurrency
    }

    nonisolated(unsafe) private static var cache: [String: NumberFormatter] = [:]
    private static let lock = NSLock()

    static func formatter(_ code: String, locale: Locale? = nil) -> NumberFormatter {
        let key = code + (locale?.identifier ?? "")
        lock.lock(); defer { lock.unlock() }
        if let f = cache[key] { return f }
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = code
        if let locale { f.locale = locale }
        else if code == "CZK" { f.locale = Locale(identifier: "cs_CZ") }
        else { f.locale = Locale.current }
        if code == "CZK" || locale != nil {
            // keep formatter's own symbol
        } else if let sym = symbolOverrides[code] {
            f.currencySymbol = sym
        }
        cache[key] = f
        return f
    }

    /// Symbols matching `Intl.NumberFormat(undefined, {currency})` in an en locale.
    static let symbolOverrides: [String: String] = ["EUR": "€", "USD": "$", "GBP": "£"]

    public static func format(_ amount: Double, _ currency: String) -> String {
        let code = normalized(currency)
        let f = formatter(code)
        return f.string(from: NSNumber(value: amount)) ?? String(format: "%.2f %@", amount, currency)
    }

    /// `currencyUnitLabel` — the symbol part ("Kč", "€", "$").
    public static func unitLabel(_ currency: String) -> String {
        let code = normalized(currency)
        if code == "CZK" { return "Kč" }
        if let s = symbolOverrides[code] { return s }
        let f = formatter(code)
        let sym = f.currencySymbol ?? code
        return sym.isEmpty ? code : sym
    }

    /// `round2`.
    public static func round2(_ x: Double) -> Double { Fmt.jsRound(x * 100) / 100 }

    /// Parse a user-typed decimal ("12,5", "12.50"); nil if invalid.
    public static func parseAmount(_ s: String) -> Double? {
        let t = s.trimmingCharacters(in: .whitespaces).replacingOccurrences(of: ",", with: ".").replacingOccurrences(of: " ", with: "")
        guard !t.isEmpty, let v = Double(t), v.isFinite else { return nil }
        return v
    }
}

/// Person naming (lib/display-name.ts).
public enum PersonName {
    public static func fromEmail(_ email: String) -> String {
        let local = email.split(separator: "@", maxSplits: 1, omittingEmptySubsequences: false).first.map(String.init) ?? email
        var out = ""
        var prevSep = false
        for ch in local {
            if ch == "." || ch == "_" || ch == "-" {
                if !prevSep { out.append(" ") }
                prevSep = true
            } else { out.append(ch); prevSep = false }
        }
        // \b\w → uppercase first char of each word
        var result = ""
        var atBoundary = true
        for ch in out {
            let isWord = (ch.isASCII && (ch.isLetter || ch.isNumber)) || ch == "_"
            if isWord && atBoundary { result += String(ch).uppercased() } else { result.append(ch) }
            atBoundary = !isWord
        }
        return result.trimmingCharacters(in: .whitespaces)
    }

    public static func name(displayName: String?, email: String) -> String {
        if let d = displayName?.trimmingCharacters(in: .whitespaces), !d.isEmpty { return d }
        return fromEmail(email)
    }
}
