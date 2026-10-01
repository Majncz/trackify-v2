import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// MARK: - UI message model (AI SDK v6 UIMessage subset, WEB_AUDIT §2.10)

public struct ChatToolPart: Hashable, Sendable {
    public var toolName: String
    public var toolCallId: String
    /// "input-streaming" | "input-available" | "output-available" | "output-error" | "result" | "call"
    public var state: String
    public var input: JSONValue?
    public var output: JSONValue?
    public var errorText: String?
    var inputText: String = ""

    public init(toolName: String, toolCallId: String, state: String, input: JSONValue? = nil, output: JSONValue? = nil, errorText: String? = nil) {
        self.toolName = toolName; self.toolCallId = toolCallId; self.state = state; self.input = input; self.output = output; self.errorText = errorText
    }

    public var hasResult: Bool { state == "output-available" || state == "result" || state == "output-error" }
}

public enum ChatPart: Hashable, Sendable {
    case text(id: String?, text: String)
    case tool(ChatToolPart)
}

public struct ChatMessage: Identifiable, Hashable, Sendable {
    public var id: String
    public var role: String
    public var parts: [ChatPart]

    public init(id: String, role: String, parts: [ChatPart]) { self.id = id; self.role = role; self.parts = parts }

    public var text: String {
        parts.compactMap { if case .text(_, let t) = $0 { return t }; return nil }.joined()
    }

    /// Encodes to the UIMessage JSON the server expects.
    public var json: JSONValue {
        var arr: [JSONValue] = []
        for p in parts {
            switch p {
            case .text(_, let t): arr.append(.object(["type": .string("text"), "text": .string(t)]))
            case .tool(let tp):
                var o: [String: JSONValue] = ["type": .string("tool-\(tp.toolName)"), "toolCallId": .string(tp.toolCallId),
                                              "state": .string(tp.state == "result" ? "output-available" : tp.state),
                                              "input": tp.input ?? .object([:])]
                if let out = tp.output { o["output"] = out }
                if tp.state == "output-error" { o["errorText"] = .string(tp.errorText ?? "Error") }
                if tp.state == "input-streaming" { o["state"] = .string("input-available") }
                arr.append(.object(o))
            }
        }
        return .object(["id": .string(id), "role": .string(role), "parts": .array(arr)])
    }
}

/// Row from `GET /api/conversations/:id/messages`.
public struct StoredChatMessage: Decodable, Sendable {
    public var id: String
    public var role: String
    public var content: String?
    public var parts: [JSONValue]?

    public var message: ChatMessage {
        var out: [ChatPart] = []
        if let parts, !parts.isEmpty {
            for p in parts {
                guard let type = p["type"]?.stringValue else { continue }
                if type == "text", let t = p["text"]?.stringValue { out.append(.text(id: nil, text: t)) }
                else if type.hasPrefix("tool-") {
                    let name = String(type.dropFirst(5))
                    out.append(.tool(ChatToolPart(toolName: name, toolCallId: p["toolCallId"]?.stringValue ?? UUID().uuidString,
                                                  state: p["state"]?.stringValue ?? "result", input: p["input"], output: p["output"])))
                }
            }
        } else if let c = content, !c.isEmpty {
            out.append(.text(id: nil, text: c))
        }
        return ChatMessage(id: id, role: role, parts: out)
    }
}

// MARK: - Tool copy (chat-interface.tsx)

public enum ChatTools {
    public static let labels: [String: String] = [
        "listTasks": "Get all your tasks",
        "findTask": "Search for a task",
        "listEvents": "List time entries",
        "listTaskGroups": "List task groups",
        "createTask": "Create a new task",
        "createEvent": "Log time to a task",
        "getStats": "Get time statistics",
        "deleteEvent": "Delete a time entry",
        "updateEvent": "Update a time entry",
        "setTaskGroupMembership": "Add task to a group or remove from group",
    ]
    public static let writeTools: Set<String> = ["createTask", "createEvent", "deleteEvent", "updateEvent", "setTaskGroupMembership"]
    public static let examples = ["What tasks do I have?", "How much did I work this week?", "Log 2 hours to my project yesterday"]
    public static let rejectedOutput: JSONValue = .object(["rejected": .bool(true), "message": .string("User rejected this action")])
    public static let supersededOutput: JSONValue = .object(["rejected": .bool(true),
        "message": .string("User sent a new message instead of approving - they may want to change or correct the request")])

    public static func label(_ name: String) -> String { labels[name] ?? name }

    /// en-US `{weekday:"short", month:"short", day:"numeric", hour:"numeric", minute:"2-digit"}` → "Fri, Sep 25, 2:00 PM".
    public static func formatDate(_ s: String, timeZone: TimeZone = .current) -> String {
        guard let d = ISODate.parse(s) ?? parseLocal(s, timeZone) else { return s }
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US")
        f.timeZone = timeZone
        f.dateFormat = "EEE, MMM d, h:mm a"
        return f.string(from: d)
    }

    /// Chat tool dates are wall-clock without an offset ("2026-09-25T14:00:00").
    static func parseLocal(_ s: String, _ tz: TimeZone) -> Date? {
        let f = DateFormatter()
        f.locale = Locale(identifier: "en_US_POSIX")
        f.timeZone = tz
        for p in ["yyyy-MM-dd'T'HH:mm:ss", "yyyy-MM-dd'T'HH:mm", "yyyy-MM-dd HH:mm", "yyyy-MM-dd"] {
            f.dateFormat = p
            if let d = f.date(from: s) { return d }
        }
        return nil
    }

    static func argPairs(_ args: [String: JSONValue], timeZone: TimeZone) -> String {
        args.keys.sorted(by: { insertionRank($0) < insertionRank($1) }).filter { !$0.contains("Id") }.map { k -> String in
            let v = args[k]!
            if k == "duration", let n = v.doubleValue { return Fmt.chatDuration(Int64(n)) }
            if k == "createdAt", let s = v.stringValue { return formatDate(s, timeZone: timeZone) }
            return "\(k): \(v.displayString)"
        }.joined(separator: ", ")
    }

    /// Keep common argument order readable (JSON objects are unordered once decoded).
    static func insertionRank(_ k: String) -> String {
        let order = ["name", "taskName", "query", "from", "to", "newFrom", "newTo", "period", "startDate", "endDate", "limit", "orderBy"]
        if let i = order.firstIndex(of: k) { return String(format: "%02d", i) }
        return "99" + k
    }

    public static func description(_ name: String, args: JSONValue?, timeZone: TimeZone = .current) -> String {
        let a = args?.objectValue ?? [:]
        switch name {
        case "createEvent":
            let task = a["taskName"]?.stringValue.map { "\"\($0)\"" } ?? "task"
            let from = a["from"]?.stringValue.map { formatDate($0, timeZone: timeZone) } ?? "now"
            let to = a["to"]?.stringValue.map { formatDate($0, timeZone: timeZone) } ?? "now"
            return "Log time entry to \(task) from \(from) to \(to)"
        case "createTask": return "Create task \"\(a["name"]?.displayString ?? "undefined")\""
        case "deleteEvent": return "Delete time entry"
        case "updateEvent":
            var changes: [String] = []
            if let d = a["newDate"]?.stringValue { changes.append("move to \(formatDate(d, timeZone: timeZone))") }
            if let n = a["newDuration"]?.doubleValue { changes.append("change duration to \(Fmt.chatDuration(Int64(n)))") }
            if changes.isEmpty {
                // v6 tool uses newFrom/newTo — describe them plainly.
                if let f = a["newFrom"]?.stringValue { changes.append("start \(formatDate(f, timeZone: timeZone))") }
                if let t = a["newTo"]?.stringValue { changes.append("end \(formatDate(t, timeZone: timeZone))") }
            }
            return changes.isEmpty ? "Update time entry" : changes.joined(separator: " and ")
        case "setTaskGroupMembership":
            let gid = a["groupId"]?.stringValue
            return (gid == nil || gid == "") ? "Remove task from its group" : "Assign task to group"
        default:
            return argPairs(a, timeZone: timeZone)
        }
    }

    public static func argsSummary(_ args: JSONValue?, timeZone: TimeZone = .current) -> String {
        argPairs(args?.objectValue ?? [:], timeZone: timeZone)
    }
}

// MARK: - SSE parsing

/// Incremental Server-Sent-Events parser: feed bytes, get `data:` payloads (joined per event).
public struct SSEParser: Sendable {
    private var buffer = Data()
    private var dataLines: [String] = []

    public init() {}

    public mutating func feed(_ chunk: Data) -> [String] {
        buffer.append(chunk)
        var out: [String] = []
        while let nl = buffer.firstIndex(of: 0x0A) {
            var lineData = buffer[buffer.startIndex..<nl]
            if lineData.last == 0x0D { lineData = lineData.dropLast() }
            buffer.removeSubrange(buffer.startIndex...nl)
            let line = String(decoding: lineData, as: UTF8.self)
            if line.isEmpty {
                if !dataLines.isEmpty { out.append(dataLines.joined(separator: "\n")); dataLines.removeAll() }
            } else if line.hasPrefix(":") {
                continue
            } else if line.hasPrefix("data:") {
                var v = String(line.dropFirst(5))
                if v.hasPrefix(" ") { v.removeFirst() }
                dataLines.append(v)
            }
        }
        return out
    }

    public mutating func finish() -> [String] {
        var out = feed(Data([0x0A]))
        if !dataLines.isEmpty { out.append(dataLines.joined(separator: "\n")); dataLines.removeAll() }
        return out
    }
}

// MARK: - UI message stream reducer

/// Applies AI SDK v6 UI-message-stream chunks to a message list.
public struct ChatStreamReducer: Sendable {
    public private(set) var messages: [ChatMessage]
    public private(set) var errorText: String?
    public private(set) var finished = false
    private var assistantIndex: Int?
    private var textPartIndex: [String: Int] = [:]

    public init(messages: [ChatMessage]) {
        self.messages = messages
        if let last = messages.last, last.role == "assistant" { assistantIndex = messages.count - 1 }
    }

    private mutating func assistant(_ id: String? = nil) -> Int {
        if let i = assistantIndex { return i }
        messages.append(ChatMessage(id: id ?? "msg-\(UUID().uuidString.prefix(12))", role: "assistant", parts: []))
        assistantIndex = messages.count - 1
        return assistantIndex!
    }

    private func toolIndex(_ mi: Int, _ callId: String) -> Int? {
        messages[mi].parts.firstIndex { if case .tool(let t) = $0 { return t.toolCallId == callId }; return false }
    }

    private mutating func updateTool(_ callId: String, name: String?, _ f: (inout ChatToolPart) -> Void) {
        let mi = assistant()
        if let pi = toolIndex(mi, callId), case .tool(var t) = messages[mi].parts[pi] {
            f(&t); messages[mi].parts[pi] = .tool(t)
        } else {
            var t = ChatToolPart(toolName: name ?? "unknown", toolCallId: callId, state: "input-streaming")
            f(&t); messages[mi].parts.append(.tool(t))
        }
    }

    /// Returns false for `[DONE]`.
    @discardableResult
    public mutating func apply(_ payload: String) -> Bool {
        if payload == "[DONE]" { finished = true; return false }
        guard let data = payload.data(using: .utf8), let chunk = try? JSONDecoder().decode(JSONValue.self, from: data),
              let type = chunk["type"]?.stringValue else { return true }
        switch type {
        case "start":
            let mi = assistant(chunk["messageId"]?.stringValue)
            if let id = chunk["messageId"]?.stringValue, messages[mi].parts.isEmpty { messages[mi].id = id }
        case "text-start":
            let mi = assistant()
            let id = chunk["id"]?.stringValue ?? UUID().uuidString
            messages[mi].parts.append(.text(id: id, text: ""))
            textPartIndex[id] = messages[mi].parts.count - 1
        case "text-delta":
            let mi = assistant()
            let id = chunk["id"]?.stringValue ?? ""
            let delta = chunk["delta"]?.stringValue ?? chunk["textDelta"]?.stringValue ?? ""
            if let pi = textPartIndex[id], case .text(let tid, let t) = messages[mi].parts[pi] {
                messages[mi].parts[pi] = .text(id: tid, text: t + delta)
            } else {
                messages[mi].parts.append(.text(id: id, text: delta))
                textPartIndex[id] = messages[mi].parts.count - 1
            }
        case "tool-input-start":
            guard let cid = chunk["toolCallId"]?.stringValue else { break }
            updateTool(cid, name: chunk["toolName"]?.stringValue) { $0.state = "input-streaming" }
        case "tool-input-delta":
            guard let cid = chunk["toolCallId"]?.stringValue else { break }
            let d = chunk["inputTextDelta"]?.stringValue ?? ""
            updateTool(cid, name: nil) { $0.inputText += d }
        case "tool-input-available":
            guard let cid = chunk["toolCallId"]?.stringValue else { break }
            let name = chunk["toolName"]?.stringValue
            updateTool(cid, name: name) { t in
                if let name { t.toolName = name }
                t.input = chunk["input"] ?? .object([:])
                t.state = "input-available"
            }
        case "tool-input-error":
            guard let cid = chunk["toolCallId"]?.stringValue else { break }
            updateTool(cid, name: chunk["toolName"]?.stringValue) { t in
                t.input = chunk["input"]; t.state = "output-error"; t.errorText = chunk["errorText"]?.stringValue
            }
        case "tool-output-available":
            guard let cid = chunk["toolCallId"]?.stringValue else { break }
            updateTool(cid, name: nil) { t in t.output = chunk["output"]; t.state = "output-available" }
        case "tool-output-error":
            guard let cid = chunk["toolCallId"]?.stringValue else { break }
            updateTool(cid, name: nil) { t in
                t.state = "output-error"; t.errorText = chunk["errorText"]?.stringValue
                t.output = .object(["success": .bool(false), "error": .string(t.errorText ?? "Error")])
            }
        case "error":
            errorText = chunk["errorText"]?.stringValue ?? "Something went wrong"
        case "finish":
            finished = true
        default:
            break // start-step, finish-step, reasoning-*, source-*, data-*, message-metadata
        }
        return true
    }
}

/// Streams SSE `data:` payloads from a POST (URLSession delegate based so it works on Linux too).
public final class SSEStreamer: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private var parser = SSEParser()
    private var continuation: AsyncThrowingStream<String, Error>.Continuation?
    private var session: URLSession?
    private var task: URLSessionDataTask?
    private var status = 0
    private var errorBody = Data()

    public override init() { super.init() }

    public func stream(_ request: URLRequest) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { cont in
            self.continuation = cont
            let cfg = URLSessionConfiguration.default
            cfg.timeoutIntervalForRequest = 120
            cfg.timeoutIntervalForResource = 600
            let s = URLSession(configuration: cfg, delegate: self, delegateQueue: nil)
            self.session = s
            let t = s.dataTask(with: request)
            self.task = t
            cont.onTermination = { [weak self] _ in self?.cancel() }
            t.resume()
        }
    }

    public func cancel() {
        task?.cancel()
        session?.invalidateAndCancel()
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse,
                           completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        status = (response as? HTTPURLResponse)?.statusCode ?? 0
        completionHandler(.allow)
    }

    public func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if !(200..<300).contains(status) { errorBody.append(data); return }
        for p in parser.feed(data) { continuation?.yield(p) }
    }

    public func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error {
            let ns = error as NSError
            if ns.code == NSURLErrorCancelled { continuation?.finish() }
            else { continuation?.finish(throwing: APIError.network(ns.localizedDescription)) }
        } else if !(200..<300).contains(status) {
            continuation?.finish(throwing: APIError.classify(status: status, data: errorBody))
        } else {
            for p in parser.finish() { continuation?.yield(p) }
            continuation?.finish()
        }
        session.finishTasksAndInvalidate()
    }
}

public extension APIClient {
    /// `POST /api/chat` request (full message list, `trigger: submit-message`).
    func chatRequest(chatId: String, messages: [ChatMessage], conversationId: String?) -> URLRequest {
        let body: JSONValue = .object([
            "id": .string(chatId),
            "messages": .array(messages.map(\.json)),
            "trigger": .string("submit-message"),
            "conversationId": conversationId.map(JSONValue.string) ?? .null,
            "timezone": .string(timezone),
        ])
        var req = makeRequest("POST", "/api/chat", body: body.encodedData())
        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
        req.timeoutInterval = 300
        return req
    }
}
