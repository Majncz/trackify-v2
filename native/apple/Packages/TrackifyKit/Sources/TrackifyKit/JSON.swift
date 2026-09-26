import Foundation

/// ISO 8601 parsing/formatting that matches the server (Prisma: `2026-09-26T10:00:00.000Z`; zod `.datetime()` wants `Z`).
public enum ISODate {
    /// Fast parser for `yyyy-MM-ddTHH:mm:ss(.fff…)(Z|±hh:mm)` and plain `yyyy-MM-dd` (treated as UTC midnight).
    public static func parse(_ s: String) -> Date? {
        let u = Array(s.utf8)
        func num(_ a: Int, _ n: Int) -> Int? {
            guard a + n <= u.count else { return nil }
            var v = 0
            for i in a..<(a + n) {
                let c = u[i]
                guard c >= 48 && c <= 57 else { return nil }
                v = v * 10 + Int(c - 48)
            }
            return v
        }
        guard let y = num(0, 4), u.count >= 10, u[4] == 45, let mo = num(5, 2), u[7] == 45, let d = num(8, 2) else { return nil }
        var h = 0, mi = 0, sec = 0
        var frac = 0.0
        var offset = 0
        if u.count > 10 {
            guard u[10] == 84 || u[10] == 32, let hh = num(11, 2), u.count > 13, u[13] == 58, let mm = num(14, 2) else { return nil }
            h = hh; mi = mm
            var i = 16
            if i < u.count, u[i] == 58, let ss = num(17, 2) { sec = ss; i = 19 }
            if i < u.count, u[i] == 46 {
                i += 1
                var scale = 0.1
                while i < u.count, u[i] >= 48, u[i] <= 57 { frac += Double(u[i] - 48) * scale; scale /= 10; i += 1 }
            }
            if i < u.count {
                if u[i] == 90 || u[i] == 122 { offset = 0 }
                else if u[i] == 43 || u[i] == 45 {
                    let sign = u[i] == 43 ? 1 : -1
                    guard let oh = num(i + 1, 2) else { return nil }
                    var om = 0
                    if i + 3 < u.count {
                        if u[i + 3] == 58 { om = num(i + 4, 2) ?? 0 } else { om = num(i + 3, 2) ?? 0 }
                    }
                    offset = sign * (oh * 3600 + om * 60)
                }
            }
        }
        let days = daysFromCivil(y, mo, d)
        let secs = Double(days) * 86400 + Double(h * 3600 + mi * 60 + sec - offset) + frac
        return Date(timeIntervalSince1970: secs)
    }

    /// `2026-09-26T10:00:00.000Z` — the only form zod v4 `.datetime()` accepts.
    public static func string(_ date: Date) -> String {
        let totalMs = date.ms
        var secs = totalMs / 1000
        var ms = totalMs % 1000
        if ms < 0 { ms += 1000; secs -= 1 }
        var days = secs / 86400
        var rem = secs % 86400
        if rem < 0 { rem += 86400; days -= 1 }
        let (y, m, d) = civilFromDays(Int(days))
        let h = rem / 3600, mi = (rem % 3600) / 60, s = rem % 60
        return String(format: "%04d-%02d-%02dT%02d:%02d:%02d.%03dZ", y, m, d, Int(h), Int(mi), Int(s), Int(ms))
    }

    public static func string(ms: Int64) -> String { string(Date(ms: ms)) }

    // Howard Hinnant's algorithms.
    static func daysFromCivil(_ y0: Int, _ m: Int, _ d: Int) -> Int {
        let y = m <= 2 ? y0 - 1 : y0
        let era = (y >= 0 ? y : y - 399) / 400
        let yoe = y - era * 400
        let mp = (m + 9) % 12
        let doy = (153 * mp + 2) / 5 + d - 1
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy
        return era * 146097 + doe - 719468
    }

    static func civilFromDays(_ z0: Int) -> (Int, Int, Int) {
        let z = z0 + 719468
        let era = (z >= 0 ? z : z - 146096) / 146097
        let doe = z - era * 146097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365
        let y = yoe + era * 400
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        return (m <= 2 ? y + 1 : y, m, d)
    }
}

public enum TrackifyJSON {
    public static func decoder() -> JSONDecoder {
        let d = JSONDecoder()
        d.dateDecodingStrategy = .custom { dec in
            let c = try dec.singleValueContainer()
            if let s = try? c.decode(String.self) {
                if let date = ISODate.parse(s) { return date }
                throw DecodingError.dataCorruptedError(in: c, debugDescription: "Bad date \(s)")
            }
            if let n = try? c.decode(Double.self) { return Date(timeIntervalSince1970: n / 1000) }
            throw DecodingError.dataCorruptedError(in: c, debugDescription: "Bad date")
        }
        return d
    }

    public static func encoder() -> JSONEncoder {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .custom { date, enc in
            var c = enc.singleValueContainer()
            try c.encode(ISODate.string(date))
        }
        e.outputFormatting = [.sortedKeys]
        return e
    }
}

/// A loosely-typed JSON value (chat tool inputs/outputs, arbitrary payloads).
public enum JSONValue: Codable, Hashable, Sendable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let n = try? c.decode(Double.self) { self = .number(n); return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let a = try? c.decode([JSONValue].self) { self = .array(a); return }
        if let o = try? c.decode([String: JSONValue].self) { self = .object(o); return }
        throw DecodingError.dataCorruptedError(in: c, debugDescription: "Unsupported JSON")
    }

    public func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        switch self {
        case .null: try c.encodeNil()
        case .bool(let b): try c.encode(b)
        case .number(let n):
            if n == n.rounded(), abs(n) < 1e15 { try c.encode(Int64(n)) } else { try c.encode(n) }
        case .string(let s): try c.encode(s)
        case .array(let a): try c.encode(a)
        case .object(let o): try c.encode(o)
        }
    }

    public subscript(key: String) -> JSONValue? {
        if case .object(let o) = self { return o[key] }
        return nil
    }

    public var stringValue: String? { if case .string(let s) = self { return s }; return nil }
    public var doubleValue: Double? { if case .number(let n) = self { return n }; return nil }
    public var boolValue: Bool? { if case .bool(let b) = self { return b }; return nil }
    public var objectValue: [String: JSONValue]? { if case .object(let o) = self { return o }; return nil }
    public var arrayValue: [JSONValue]? { if case .array(let a) = self { return a }; return nil }
    public var isNull: Bool { if case .null = self { return true }; return false }

    /// JS-like `String(v)` for display in "key: value" tool summaries.
    public var displayString: String {
        switch self {
        case .null: return "null"
        case .bool(let b): return b ? "true" : "false"
        case .number(let n): return n == n.rounded() && abs(n) < 1e15 ? String(Int64(n)) : String(n)
        case .string(let s): return s
        case .array(let a): return a.map(\.displayString).joined(separator: ",")
        case .object: return "[object Object]"
        }
    }

    public static func from(any: Any?) -> JSONValue {
        guard let any else { return .null }
        switch any {
        case let v as JSONValue: return v
        case let b as Bool: return .bool(b)
        case let i as Int: return .number(Double(i))
        case let i as Int64: return .number(Double(i))
        case let d as Double: return .number(d)
        case let s as String: return .string(s)
        case let a as [Any]: return .array(a.map { from(any: $0) })
        case let o as [String: Any]: return .object(o.mapValues { from(any: $0) })
        default: return .null
        }
    }

    public func encodedData() -> Data { (try? JSONEncoder().encode(self)) ?? Data("null".utf8) }
}
