import Foundation
import SwiftUI
import Observation
import TrackifyKit

/// Chat state + streaming loop (chat-interface.tsx / chat-tab-bar.tsx, WEB_AUDIT §1.11, §2.10).
@Observable
@MainActor
final class ChatSession {
    enum ApprovalState: Equatable { case pending, approved, rejected, executing }

    // MARK: State
    private(set) var conversations: [Conversation] = []
    private(set) var conversationsLoaded = false
    private(set) var currentId: String?
    private(set) var messages: [ChatMessage] = []
    private(set) var isStreaming = false
    private(set) var approvals: [String: ApprovalState] = [:]
    var errorText: String?

    /// CI screenshot hook (`TrackifyChatPrompt`) fires once per app run.
    static var didAutoSend = false

    @ObservationIgnored private weak var model: AppModel?
    @ObservationIgnored private var streamTask: Task<Void, Never>?
    /// Bumped whenever in-flight work must stop publishing (conversation switch, Stop).
    @ObservationIgnored private var generation = 0
    @ObservationIgnored private let chatId = "chat-" + UUID().uuidString.lowercased()

    /// One session per app run so switching screens (iPad/Mac sidebar) keeps the conversation.
    static let shared = ChatSession()

    init() {}

    /// Sign-out: forget everything.
    func reset() {
        streamTask?.cancel()
        streamTask = nil
        generation += 1
        conversations = []
        conversationsLoaded = false
        currentId = nil
        messages = []
        isStreaming = false
        approvals = [:]
        errorText = nil
    }

    func attach(_ model: AppModel) { self.model = model }

    /// Changes whenever visible content grows (drives auto-scroll).
    var contentSignature: Int {
        var h = messages.count &* 1_000_003
        if let last = messages.last {
            h = h &+ last.parts.count &* 10_007
            for p in last.parts {
                switch p {
                case .text(_, let t): h = h &+ t.count
                case .tool(let t): h = h &+ t.state.count &+ (approvals[t.toolCallId] == nil ? 0 : 7)
                }
            }
        }
        if isStreaming { h = h &+ 1 }
        if errorText != nil { h = h &+ 3 }
        return h
    }

    /// Typing indicator: streaming and the assistant hasn't answered yet.
    var awaitingFirstChunk: Bool { isStreaming && messages.last?.role == "user" }

    // MARK: Conversations

    func loadConversations() async {
        guard let model else { return }
        do {
            conversations = try await model.api.conversations()
        } catch {
            // keep whatever we had (web logs and moves on)
        }
        conversationsLoaded = true
    }

    /// Tab tap: switch conversation and load its history.
    func select(_ id: String?) {
        guard id != currentId else { return }
        stopStreaming()
        generation += 1
        approvals = [:]
        errorText = nil
        currentId = id
        messages = []
        guard let id else { return }
        let gen = generation
        Task { await loadMessages(id, gen: gen) }
    }

    private func loadMessages(_ id: String, gen: Int) async {
        guard let model else { return }
        guard let rows = try? await model.api.messages(conversationId: id) else { return }
        guard gen == generation, currentId == id, !rows.isEmpty else { return }
        messages = rows.map(\.message)
    }

    /// "+" button.
    func newConversation() async {
        guard let model else { return }
        do {
            let c = try await model.api.createConversation()
            conversations.append(c)
            select(c.id)
        } catch {
            errorText = (error as? APIError)?.message ?? "Failed to create conversation"
        }
    }

    /// Beyond web: long-press / context menu delete.
    func deleteConversation(_ id: String) async {
        guard let model else { return }
        do {
            try await model.api.deleteConversation(id: id)
            conversations.removeAll { $0.id == id }
            if currentId == id { select(nil) }
        } catch {
            errorText = (error as? APIError)?.message ?? "Could not delete conversation"
        }
    }

    /// First send creates a conversation without reloading (keeps the optimistic message).
    private func ensureConversation() async -> String? {
        if let currentId { return currentId }
        guard let model else { return nil }
        do {
            let c = try await model.api.createConversation()
            if !conversations.contains(where: { $0.id == c.id }) { conversations.append(c) }
            currentId = c.id
            return c.id
        } catch {
            return nil
        }
    }

    // MARK: Sending

    func send(_ raw: String) async {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isStreaming else { return }
        isStreaming = true          // blocks double sends while the conversation is created
        errorText = nil
        guard await ensureConversation() != nil else {
            isStreaming = false
            errorText = "Failed to create conversation"
            return
        }
        // Auto-reject pending approvals: the user is probably correcting the request.
        for call in pendingToolCalls() {
            approvals[call] = .rejected
            setToolOutput(call, ChatTools.supersededOutput)
        }
        messages.append(ChatMessage(id: "user-" + UUID().uuidString.lowercased(), role: "user",
                                    parts: [.text(id: nil, text: text)]))
        startStream()
    }

    /// Stop button.
    func stop() {
        stopStreaming()
    }

    private func stopStreaming() {
        guard streamTask != nil || isStreaming else { return }
        generation += 1
        streamTask?.cancel()
        streamTask = nil
        isStreaming = false
    }

    /// Write-tool calls still waiting for Approve / Reject.
    func pendingToolCalls() -> [String] {
        var out: [String] = []
        for m in messages where m.role == "assistant" {
            for p in m.parts {
                if case .tool(let t) = p, needsApproval(t) { out.append(t.toolCallId) }
            }
        }
        return out
    }

    func needsApproval(_ t: ChatToolPart) -> Bool {
        ChatTools.writeTools.contains(t.toolName) && !t.hasResult && approvals[t.toolCallId] == nil
            && (t.state == "call" || t.state == "input-available")
    }

    private func setToolOutput(_ callId: String, _ output: JSONValue) {
        for mi in messages.indices {
            for pi in messages[mi].parts.indices {
                if case .tool(var t) = messages[mi].parts[pi], t.toolCallId == callId {
                    t.state = "output-available"
                    t.output = output
                    messages[mi].parts[pi] = .tool(t)
                    return
                }
            }
        }
    }

    // MARK: Approvals

    func approve(_ part: ChatToolPart) async {
        guard let model, approvals[part.toolCallId] != .executing, !isStreaming else { return }
        let callId = part.toolCallId
        approvals[callId] = .executing
        let gen = generation
        let output: JSONValue
        var failed = false
        do {
            output = try await model.api.executeTool(name: part.toolName, args: part.input ?? .object([:]))
            if output["success"]?.boolValue == false { failed = true }
        } catch let e as APIError {
            failed = true
            let msg = e.kind == .network ? "Network error - please try again" : e.message
            output = .object(["success": .bool(false), "error": .string(msg)])
        } catch {
            failed = true
            output = .object(["success": .bool(false), "error": .string("Network error - please try again")])
        }
        guard gen == generation else { return }
        // Web: a failed execution is shown as "Rejected"; the model explains the error on continue.
        approvals[callId] = failed ? .rejected : .approved
        setToolOutput(callId, output)
        if !failed, ChatTools.writeTools.contains(part.toolName) {
            Task { await model.refreshAll() }
        }
        startStream()
    }

    func reject(_ part: ChatToolPart) {
        let callId = part.toolCallId
        guard approvals[callId] != .executing, approvals[callId] != .rejected, !isStreaming else { return }
        approvals[callId] = .rejected
        setToolOutput(callId, ChatTools.rejectedOutput)
        startStream()
    }

    // MARK: Streaming

    private func startStream() {
        streamTask?.cancel()
        generation += 1
        let gen = generation
        isStreaming = true
        errorText = nil
        streamTask = Task { [weak self] in
            await self?.runStream(gen: gen)
        }
    }

    private func runStream(gen: Int) async {
        guard let model else { isStreaming = false; return }
        let request = model.api.chatRequest(chatId: chatId, messages: messages, conversationId: currentId)
        var reducer = ChatStreamReducer(messages: messages)
        let streamer = SSEStreamer()
        var lastPublish = Date.distantPast
        var thrown: String?
        do {
            for try await payload in streamer.stream(request) {
                if Task.isCancelled || gen != generation { break }
                let more = reducer.apply(payload)
                let now = Date()
                if now.timeIntervalSince(lastPublish) >= 1.0 / 30.0 {
                    messages = reducer.messages
                    lastPublish = now
                }
                if !more { break }
            }
        } catch let e as APIError {
            thrown = e.message
        } catch is CancellationError {
            // Stop button
        } catch {
            thrown = error.localizedDescription
        }
        streamer.cancel()
        guard gen == generation else { return }
        messages = reducer.messages
        if let thrown { errorText = thrown } else if let e = reducer.errorText { errorText = e }
        isStreaming = false
        streamTask = nil
        // Titles are set server-side on the first message.
        await loadConversations()
    }
}
