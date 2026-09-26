import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Engine.IO v4 / Socket.IO v4 frame codec (text frames, default namespace).
public enum SocketFrame: Equatable, Sendable {
    case open(sid: String?, pingInterval: Int?, pingTimeout: Int?)   // "0{…}"
    case close                                                        // "1"
    case ping                                                         // "2"
    case pong                                                         // "3"
    case connect                                                      // "40" / "40{sid}"
    case disconnect                                                   // "41"
    case event(name: String, args: [JSONValue])                       // "42[…]"
    case ack                                                          // "43…"
    case connectError(String)                                         // "44{message}"
    case noop                                                         // "6" or unknown

    public static func parse(_ text: String) -> SocketFrame {
        guard let first = text.first else { return .noop }
        switch first {
        case "0":
            let body = String(text.dropFirst())
            let json = (try? JSONDecoder().decode(JSONValue.self, from: Data(body.utf8)))
            return .open(sid: json?["sid"]?.stringValue, pingInterval: json?["pingInterval"]?.doubleValue.map { Int($0) },
                         pingTimeout: json?["pingTimeout"]?.doubleValue.map { Int($0) })
        case "1": return .close
        case "2": return .ping
        case "3": return .pong
        case "4":
            let rest = text.dropFirst()
            guard let t = rest.first else { return .noop }
            var payload = String(rest.dropFirst())
            // Optional namespace ("/ns,") — we only use "/".
            if payload.hasPrefix("/"), let comma = payload.firstIndex(of: ",") { payload = String(payload[payload.index(after: comma)...]) }
            switch t {
            case "0": return .connect
            case "1": return .disconnect
            case "2", "3":
                // Strip an optional numeric ack id before the JSON array.
                let trimmed = payload.drop(while: { $0.isNumber })
                if t == "3" { return .ack }
                guard let arr = (try? JSONDecoder().decode([JSONValue].self, from: Data(trimmed.utf8))),
                      let name = arr.first?.stringValue else { return .noop }
                return .event(name: name, args: Array(arr.dropFirst()))
            case "4":
                let json = try? JSONDecoder().decode(JSONValue.self, from: Data(payload.utf8))
                return .connectError(json?["message"]?.stringValue ?? payload)
            default: return .noop
            }
        default: return .noop
        }
    }

    /// `42["name",payload]`
    public static func encodeEvent(_ name: String, _ payload: JSONValue?) -> String {
        var arr: [JSONValue] = [.string(name)]
        if let payload { arr.append(payload) }
        let data = (try? JSONEncoder().encode(JSONValue.array(arr))) ?? Data("[]".utf8)
        return "42" + String(decoding: data, as: UTF8.self)
    }
}

public enum SocketStatus: Sendable, Equatable {
    case connected       // authenticated
    case connecting      // (re)connecting
    case disconnected
}

/// Tiny Socket.IO client over `URLSessionWebSocketTask` with auto-reconnect and token auth.
public final class SocketIOClient: NSObject, @unchecked Sendable {
    public var onStatus: (@Sendable (SocketStatus) -> Void)?
    public var onEvent: (@Sendable (String, [JSONValue]) -> Void)?

    private let queue = DispatchQueue(label: "trackify.socket")
    private var session: URLSession?
    private var task: URLSessionWebSocketTask?
    private var baseURL: URL?
    private var token: String?
    private var wanted = false
    private var attempt = 0
    private var generation = 0
    private var pingTimeout: TimeInterval = 60
    private var watchdog: DispatchWorkItem?
    private(set) public var status: SocketStatus = .disconnected

    public override init() { super.init() }

    public static func socketURL(for base: URL) -> URL? {
        var c = URLComponents(url: base, resolvingAgainstBaseURL: false)
        c?.scheme = base.scheme == "http" ? "ws" : "wss"
        c?.path = "/socket.io/"
        c?.queryItems = [URLQueryItem(name: "EIO", value: "4"), URLQueryItem(name: "transport", value: "websocket")]
        return c?.url
    }

    public func connect(baseURL: URL, token: String) {
        queue.async {
            self.baseURL = baseURL
            self.token = token
            self.wanted = true
            self.attempt = 0
            self.open()
        }
    }

    public func disconnect() {
        queue.async {
            self.wanted = false
            self.generation += 1
            self.teardown()
            self.setStatus(.disconnected)
        }
    }

    /// Reconnect immediately (foreground / network available).
    public func nudge() {
        queue.async {
            guard self.wanted, self.status != .connected else { return }
            self.attempt = 0
            self.open()
        }
    }

    public func emit(_ name: String, _ payload: JSONValue? = nil) {
        queue.async {
            guard self.status == .connected || name == "authenticate" else { return }
            self.send(SocketFrame.encodeEvent(name, payload))
        }
    }

    // MARK: internals (on `queue`)

    private func setStatus(_ s: SocketStatus) {
        guard s != status else { return }
        status = s
        onStatus?(s)
    }

    private func teardown() {
        watchdog?.cancel()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        session?.invalidateAndCancel()
        session = nil
    }

    private func open() {
        teardown()
        guard wanted, let base = baseURL, let url = Self.socketURL(for: base) else { return }
        generation += 1
        let gen = generation
        setStatus(.connecting)
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 20
        let s = URLSession(configuration: cfg)
        session = s
        let t = s.webSocketTask(with: url)
        task = t
        t.resume()
        receive(gen)
        armWatchdog(gen, after: 20)
    }

    private func armWatchdog(_ gen: Int, after: TimeInterval) {
        watchdog?.cancel()
        let w = DispatchWorkItem { [weak self] in
            guard let self, gen == self.generation else { return }
            self.scheduleReconnect(gen)
        }
        watchdog = w
        queue.asyncAfter(deadline: .now() + after, execute: w)
    }

    private func receive(_ gen: Int) {
        task?.receive { [weak self] result in
            guard let self else { return }
            self.queue.async {
                guard gen == self.generation else { return }
                switch result {
                case .failure:
                    self.scheduleReconnect(gen)
                case .success(let msg):
                    switch msg {
                    case .string(let text): self.handle(text, gen)
                    case .data(let d): self.handle(String(decoding: d, as: UTF8.self), gen)
                    @unknown default: break
                    }
                    self.receive(gen)
                }
            }
        }
    }

    private func handle(_ text: String, _ gen: Int) {
        switch SocketFrame.parse(text) {
        case .open(_, let interval, let timeout):
            pingTimeout = TimeInterval((interval ?? 25000) + (timeout ?? 20000)) / 1000
            armWatchdog(gen, after: pingTimeout)
            send("40")
        case .connect:
            attempt = 0
            if let token { send(SocketFrame.encodeEvent("authenticate", .object(["token": .string(token)]))) }
        case .ping:
            send("3")
            armWatchdog(gen, after: pingTimeout)
        case .event(let name, let args):
            if name == "auth:success" { setStatus(.connected) }
            if name == "auth:error" {
                onEvent?(name, args)
                scheduleReconnect(gen, delay: 15)
                return
            }
            onEvent?(name, args)
        case .disconnect, .close, .connectError:
            scheduleReconnect(gen)
        default: break
        }
    }

    private func send(_ text: String) {
        task?.send(.string(text)) { _ in }
    }

    private func scheduleReconnect(_ gen: Int, delay: TimeInterval? = nil) {
        guard gen == generation else { return }
        generation += 1
        teardown()
        guard wanted else { setStatus(.disconnected); return }
        setStatus(.connecting)
        // Web: delay 400 ms, max 5 s, randomisation 0.5.
        let base = min(5.0, 0.4 * pow(2, Double(attempt)))
        attempt += 1
        let jitter = base * 0.5 * Double.random(in: -1...1)
        let d = delay ?? max(0.2, base + jitter)
        let g = generation
        queue.asyncAfter(deadline: .now() + d) { [weak self] in
            guard let self, g == self.generation, self.wanted else { return }
            self.open()
        }
    }
}
