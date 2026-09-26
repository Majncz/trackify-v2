import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

public struct APIError: Error, LocalizedError, Sendable, Equatable {
    public enum Kind: Sendable, Equatable {
        case network          // no response (offline, DNS, timeout)
        case unauthorized     // 401
        case retryable        // 408 / 429 / 5xx
        case client           // other 4xx
        case decoding
    }
    public var kind: Kind
    public var status: Int
    public var message: String
    /// Parsed JSON body when the response was JSON.
    public var json: JSONValue?
    /// True when the body wasn't JSON (HTML error pages, proxies).
    public var bodyIsJSON: Bool

    public init(kind: Kind, status: Int, message: String, json: JSONValue? = nil, bodyIsJSON: Bool = false) {
        self.kind = kind; self.status = status; self.message = message; self.json = json; self.bodyIsJSON = bodyIsJSON
    }

    public var errorDescription: String? { message }

    /// A 404 that means "this server doesn't have the route" (NATIVE_SPEC §2 compatibility rule),
    /// as opposed to a real `{"error":"Task not found"}`.
    public var isMissingRoute: Bool {
        guard status == 404 else { return false }
        guard bodyIsJSON, let err = json?["error"]?.stringValue else { return true }
        return err != "Task not found" && err != "Not found" && err != "Event not found" && err != "Unauthorized"
    }

    public static func network(_ message: String) -> APIError { APIError(kind: .network, status: 0, message: message) }

    public static func classify(status: Int, data: Data) -> APIError {
        let json = try? JSONDecoder().decode(JSONValue.self, from: data)
        let isJSON = json != nil && (json?.objectValue != nil || json?.arrayValue != nil)
        var message = json?["error"]?.stringValue ?? ""
        if message.isEmpty {
            let text = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            if !text.isEmpty && !text.hasPrefix("<") && text.count < 300 { message = text }
        }
        if message.isEmpty { message = HTTPStatus.defaultMessage(status) }
        let kind: Kind
        switch status {
        case 401: kind = .unauthorized
        case 408, 429, 500...599: kind = .retryable
        default: kind = .client
        }
        return APIError(kind: kind, status: status, message: message, json: json, bodyIsJSON: isJSON)
    }
}

enum HTTPStatus {
    static func defaultMessage(_ s: Int) -> String {
        switch s {
        case 400: "Bad request"
        case 401: "Unauthorized"
        case 403: "Forbidden"
        case 404: "Not found"
        case 409: "Conflict"
        case 500...599: "Server error (\(s))"
        default: "Request failed (\(s))"
        }
    }
}

/// Minimal async HTTP client (Foundation only, works on Linux too).
public final class APIClient: @unchecked Sendable {
    public static let liveServer = URL(string: "https://trackify.ranajakub.com")!

    private let lock = NSLock()
    private var _baseURL: URL
    private var _token: String?
    let session: URLSession
    public var timezone: String = TimeZone.current.identifier

    public var baseURL: URL {
        get { lock.lock(); defer { lock.unlock() }; return _baseURL }
        set { lock.lock(); _baseURL = newValue; lock.unlock() }
    }
    public var token: String? {
        get { lock.lock(); defer { lock.unlock() }; return _token }
        set { lock.lock(); _token = newValue; lock.unlock() }
    }

    public init(baseURL: URL, token: String? = nil, session: URLSession? = nil) {
        _baseURL = baseURL
        _token = token
        if let session { self.session = session } else {
            let cfg = URLSessionConfiguration.default
            cfg.timeoutIntervalForRequest = 20
            cfg.timeoutIntervalForResource = 60
            #if canImport(Darwin)
            cfg.waitsForConnectivity = false
            #endif
            cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
            self.session = URLSession(configuration: cfg)
        }
    }

    /// Normalise a user-typed server string ("trackify.example.com", "https://x/") to an origin URL.
    public static func normalizeServer(_ raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if s.isEmpty { return nil }
        if !s.lowercased().hasPrefix("http://") && !s.lowercased().hasPrefix("https://") { s = "https://" + s }
        while s.hasSuffix("/") { s.removeLast() }
        guard let u = URL(string: s), u.host != nil else { return nil }
        return u
    }

    public func url(_ path: String, query: [String: String?] = [:]) -> URL {
        var comps = URLComponents(url: baseURL, resolvingAgainstBaseURL: false)!
        let basePath = comps.path.hasSuffix("/") ? String(comps.path.dropLast()) : comps.path
        comps.path = basePath + path
        let items = query.compactMap { k, v in v.map { URLQueryItem(name: k, value: $0) } }.sorted { $0.name < $1.name }
        if !items.isEmpty {
            comps.queryItems = items
            // "+" must be escaped for timezone offsets etc.
            comps.percentEncodedQuery = comps.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
        }
        return comps.url!
    }

    public func makeRequest(_ method: String, _ path: String, query: [String: String?] = [:], body: Data? = nil, auth: Bool = true) -> URLRequest {
        var req = URLRequest(url: url(path, query: query))
        req.httpMethod = method
        req.setValue("application/json", forHTTPHeaderField: "Accept")
        if let body {
            req.httpBody = body
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        if auth, let token { req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }
        return req
    }

    /// Performs the request; throws `APIError` for non-2xx and transport failures.
    @discardableResult
    public func send(_ req: URLRequest) async throws -> Data {
        let (data, resp): (Data, URLResponse)
        do {
            (data, resp) = try await perform(req)
        } catch let e as APIError {
            throw e
        } catch {
            throw APIError.network((error as NSError).localizedDescription)
        }
        guard let http = resp as? HTTPURLResponse else { throw APIError.network("No response") }
        guard (200..<300).contains(http.statusCode) else { throw APIError.classify(status: http.statusCode, data: data) }
        return data
    }

    private func perform(_ req: URLRequest) async throws -> (Data, URLResponse) {
        try await withCheckedThrowingContinuation { cont in
            let task = session.dataTask(with: req) { data, resp, err in
                if let err { cont.resume(throwing: err); return }
                guard let resp else { cont.resume(throwing: APIError.network("No response")); return }
                cont.resume(returning: (data ?? Data(), resp))
            }
            task.resume()
        }
    }

    public func decode<T: Decodable>(_ type: T.Type, _ data: Data) throws -> T {
        do { return try TrackifyJSON.decoder().decode(T.self, from: data) }
        catch { throw APIError(kind: .decoding, status: 200, message: "Unexpected response from server") }
    }

    public func get<T: Decodable>(_ path: String, query: [String: String?] = [:], as: T.Type = T.self) async throws -> T {
        try decode(T.self, try await send(makeRequest("GET", path, query: query)))
    }

    public func json(_ method: String, _ path: String, _ body: [String: Any?]? = nil, query: [String: String?] = [:]) async throws -> Data {
        var data: Data? = nil
        if let body {
            let cleaned = body.mapValues { v -> Any in v ?? NSNull() }
            data = try JSONSerialization.data(withJSONObject: cleaned.mapValues(Self.jsonSafe))
        }
        return try await send(makeRequest(method, path, query: query, body: data))
    }

    public func json<T: Decodable>(_ method: String, _ path: String, _ body: [String: Any?]? = nil, query: [String: String?] = [:], as: T.Type) async throws -> T {
        try decode(T.self, try await json(method, path, body, query: query))
    }

    static func jsonSafe(_ v: Any) -> Any {
        switch v {
        case let d as Date: return ISODate.string(d)
        case let j as JSONValue: return (try? JSONSerialization.jsonObject(with: j.encodedData(), options: [.fragmentsAllowed])) ?? NSNull()
        case let a as [Any]: return a.map(jsonSafe)
        case let o as [String: Any]: return o.mapValues(jsonSafe)
        case let o as [String: Any?]: return o.mapValues { $0.map(jsonSafe) ?? NSNull() }
        default: return v
        }
    }
}
