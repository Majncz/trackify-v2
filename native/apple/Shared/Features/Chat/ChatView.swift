import SwiftUI
import TrackifyKit

// MARK: - AI chat screen (WEB_AUDIT §1.11)

struct ChatView: View {
    @Environment(AppModel.self) private var model
    @State private var session = ChatSession.shared
    @State private var input = ""

    var body: some View {
        VStack(spacing: 0) {
            ChatTabStrip(session: session)
            Hairline()
            ChatMessageList(session: session, onExample: { text in send(text) })
            Hairline()
            ChatInputBar(text: $input, streaming: session.isStreaming, onSend: sendInput, onStop: { session.stop() })
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.background)
        .task {
            session.attach(model)
            await session.loadConversations()
            if !ChatSession.didAutoSend,
               let prompt = UserDefaults.standard.string(forKey: "TrackifyChatPrompt"),
               !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                ChatSession.didAutoSend = true
                await session.send(prompt)
            }
        }
    }

    private func sendInput() {
        let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !session.isStreaming else { return }
        input = ""
        send(text)
    }

    private func send(_ text: String) {
        Task { await session.send(text) }
    }
}

// MARK: - Conversation tabs (chat-tab-bar.tsx)

struct ChatTabStrip: View {
    let session: ChatSession
    private let endId = "chat-tabs-end"

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 4) {
                    if !session.conversationsLoaded {
                        Text("Loading...")
                            .font(.scaled(14))
                            .foregroundStyle(Theme.mutedForeground)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 8)
                    } else {
                        ForEach(session.conversations) { c in
                            ChatTabButton(title: c.tabTitle, active: session.currentId == c.id) {
                                session.select(c.id)
                            }
                            .contextMenu {
                                Button(role: .destructive) {
                                    Task { await session.deleteConversation(c.id) }
                                } label: {
                                    Label("Delete conversation", systemImage: "trash")
                                }
                            }
                        }
                        Button {
                            Task { await session.newConversation() }
                        } label: {
                            Image(systemName: "plus").font(.scaled(14, weight: .medium))
                        }
                        .buttonStyle(.t(.ghost, .sm))
                        .frame(width: 32, height: 32)
                        .accessibilityLabel("New chat")
                        .id(endId)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
            }
            .onChange(of: session.conversations.map(\.id)) { _, _ in
                scrollToEnd(proxy)
            }
            .onChange(of: session.conversationsLoaded) { _, _ in
                scrollToEnd(proxy)
            }
        }
        .background(Theme.background)
    }

    private func scrollToEnd(_ proxy: ScrollViewProxy) {
        DispatchQueue.main.async { proxy.scrollTo(endId, anchor: .trailing) }
    }
}

struct ChatTabButton: View {
    var title: String
    var active: Bool
    var action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(.scaled(14))
                .lineLimit(1)
                .fixedSize()
                .foregroundStyle(active ? Theme.onPrimary : Theme.foreground)
                .padding(.horizontal, 8)
                .padding(.vertical, 5)
                .background(active ? Theme.primary : Color.clear, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .contentShape(RoundedRectangle(cornerRadius: 6))
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(active ? .isSelected : [])
    }
}

// MARK: - Messages

struct ChatMessageList: View {
    let session: ChatSession
    var onExample: (String) -> Void
    private let bottomId = "chat-bottom"

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    if session.messages.isEmpty && session.errorText == nil {
                        ChatEmptyState(onExample: onExample)
                    }
                    ForEach(Array(session.messages.enumerated()), id: \.offset) { _, m in
                        ChatMessageRow(message: m, session: session)
                    }
                    if session.awaitingFirstChunk {
                        ChatTypingIndicator()
                    }
                    if let err = session.errorText {
                        Text(err)
                            .font(.scaled(14))
                            .foregroundStyle(Theme.destructive)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.destructive.opacity(0.1), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                            .textSelection(.enabled)
                    }
                    Color.clear.frame(height: 1).id(bottomId)
                }
                .padding(16)
                .frame(maxWidth: 900)
                .frame(maxWidth: .infinity)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: session.contentSignature) { _, _ in
                withAnimation(.easeOut(duration: 0.2)) { proxy.scrollTo(bottomId, anchor: .bottom) }
            }
        }
    }
}

struct ChatEmptyState: View {
    var onExample: (String) -> Void

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: "bubble.left.and.text.bubble.right")
                .font(.scaled(40))
                .foregroundStyle(Theme.mutedForeground)
                .padding(.bottom, 16)
            Text("How can I help?")
                .font(.scaled(18, weight: .medium))
                .foregroundStyle(Theme.foreground)
                .padding(.bottom, 8)
            Text("Try something like:")
                .font(.scaled(14))
                .foregroundStyle(Theme.mutedForeground)
                .padding(.bottom, 16)
            VStack(spacing: 8) {
                ForEach(ChatTools.examples, id: \.self) { ex in
                    Button { onExample(ex) } label: {
                        Text("\"\(ex)\"")
                            .font(.scaled(14))
                            .foregroundStyle(Theme.mutedForeground)
                            .multilineTextAlignment(.leading)
                            .padding(.horizontal, 16)
                            .padding(.vertical, 12)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Theme.muted, in: RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous))
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .frame(maxWidth: 448)
        }
        .frame(maxWidth: .infinity, minHeight: 360)
        .padding(.vertical, 24)
    }
}

struct ChatTypingIndicator: View {
    var body: some View {
        HStack {
            ProgressView()
                .controlSize(.small)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Theme.muted, in: RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous))
                .accessibilityLabel("Assistant is typing")
            Spacer(minLength: 0)
        }
    }
}

// MARK: - Input

struct ChatInputBar: View {
    @Binding var text: String
    var streaming: Bool
    var onSend: () -> Void
    var onStop: () -> Void
    @FocusState private var focused: Bool

    private var canSend: Bool { !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            field
            if streaming {
                Button(action: onStop) {
                    Image(systemName: "square.fill").font(.scaled(13))
                }
                .buttonStyle(.t(.destructive, .icon))
                .frame(height: 40)
                .accessibilityLabel("Stop")
            } else {
                Button(action: onSend) {
                    Image(systemName: "paperplane.fill").font(.scaled(14))
                }
                .buttonStyle(.t(.primary, .icon))
                .frame(height: 40)
                .disabled(!canSend)
                .accessibilityLabel("Send")
            }
        }
        .padding(12)
        .frame(maxWidth: 900)
        .frame(maxWidth: .infinity)
        .background(Theme.background)
        .onChange(of: streaming) { _, now in
            if !now { focused = true }
        }
    }

    private var field: some View {
        TextField("Type a message...", text: $text, axis: .vertical)
            .lineLimit(1...5)
            .textFieldStyle(.plain)
            .font(.scaled(14))
            .focused($focused)
            .disabled(streaming)
            .onSubmit(onSend)
            #if os(iOS)
            .submitLabel(.send)
            .onChange(of: text) { old, new in
                // Vertical TextFields insert "\n" on Return on iOS — treat it as send.
                if new.count == old.count + 1, new.hasSuffix("\n") {
                    text = String(new.dropLast())
                    onSend()
                }
            }
            #endif
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(minHeight: 40)
            .background(Theme.background, in: RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous).strokeBorder(Theme.border))
            .opacity(streaming ? 0.5 : 1)
    }
}
