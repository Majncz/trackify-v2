import SwiftUI
import TrackifyKit

// MARK: - Message bubbles (chat-interface.tsx)

struct ChatMessageRow: View {
    let message: ChatMessage
    let session: ChatSession

    var body: some View {
        if message.role == "user" {
            ChatUserBubble(text: message.text)
        } else if hasVisibleParts {
            ChatAssistantBubble(message: message, session: session)
        }
    }

    private var hasVisibleParts: Bool {
        message.parts.contains { part in
            switch part {
            case .text(_, let t): return !t.isEmpty
            case .tool: return true
            }
        }
    }
}

struct ChatUserBubble: View {
    var text: String

    var body: some View {
        HStack {
            Spacer(minLength: 48)
            Text(text)
                .font(.scaled(14))
                .foregroundStyle(Theme.onPrimary)
                .multilineTextAlignment(.leading)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(Theme.primary, in: RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous))
                .frame(maxWidth: 420, alignment: .trailing)
        }
    }
}

struct ChatAssistantBubble: View {
    let message: ChatMessage
    let session: ChatSession

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(Array(message.parts.enumerated()), id: \.offset) { _, part in
                    partView(part)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(Theme.muted, in: RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous))
            Spacer(minLength: 24)
        }
    }

    @ViewBuilder private func partView(_ part: ChatPart) -> some View {
        switch part {
        case .text(_, let t):
            if !t.isEmpty { ChatMarkdownView(text: t) }
        case .tool(let tp):
            ChatToolPartView(
                part: tp,
                approval: session.approvals[tp.toolCallId],
                needsApproval: session.needsApproval(tp),
                onApprove: { Task { await session.approve(tp) } },
                onReject: { session.reject(tp) }
            )
        }
    }
}

// MARK: - Tool parts

struct ChatToolPartView: View {
    let part: ChatToolPart
    let approval: ChatSession.ApprovalState?
    let needsApproval: Bool
    var onApprove: () -> Void
    var onReject: () -> Void

    private var label: String { ChatTools.label(part.toolName) }
    private var hasArgs: Bool { !(part.input?.objectValue ?? [:]).isEmpty }

    var body: some View {
        if needsApproval {
            approvalCard
        } else if approval == .executing {
            statusLine(background: Theme.card.opacity(0.5)) {
                ProgressView().controlSize(.small).tint(Theme.blue)
                Text("Executing \(label)...").foregroundStyle(Theme.mutedForeground)
            }
        } else if approval == .rejected {
            statusLine(background: Theme.red.opacity(0.1)) {
                Image(systemName: "xmark").font(.scaled(11, weight: .semibold)).foregroundStyle(Theme.red)
                Text("\(label) - Rejected").foregroundStyle(Theme.mutedForeground)
            }
        } else {
            completedLine
        }
    }

    private var approvalCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Image(systemName: "exclamationmark.circle").foregroundStyle(Theme.amber)
                Text(label).font(.scaled(14, weight: .medium)).foregroundStyle(Theme.foreground)
            }
            if hasArgs {
                Text(ChatTools.description(part.toolName, args: part.input))
                    .font(.scaled(14))
                    .foregroundStyle(Theme.foreground)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.leading, 20)
            }
            HStack(spacing: 6) {
                Button(action: onApprove) {
                    Label("Approve", systemImage: "checkmark")
                }
                .buttonStyle(.t(.primary, .sm))
                Button(action: onReject) {
                    Label("Reject", systemImage: "xmark")
                }
                .buttonStyle(.t(.outline, .sm))
            }
            .disabled(approval == .executing)
            .padding(.leading, 20)
            .padding(.top, 2)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.amber.opacity(0.1), in: RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.controlRadius, style: .continuous).strokeBorder(Theme.amber.opacity(0.5), lineWidth: 2))
    }

    private var failure: (failed: Bool, message: String?) {
        guard let out = part.output else { return (false, nil) }
        let err = out["error"]
        let hasError: Bool = {
            guard let err else { return false }
            switch err {
            case .null: return false
            case .bool(let b): return b
            case .string(let s): return !s.isEmpty
            default: return true
            }
        }()
        let failed = out["success"]?.boolValue == false || hasError
        return (failed, failed && hasError ? err?.displayString : nil)
    }

    private var completedLine: some View {
        let isComplete = part.hasResult || approval == .approved
        let f = failure
        return statusLine(background: f.failed ? Theme.red.opacity(0.1) : Theme.card.opacity(0.5)) {
            if isComplete {
                if f.failed {
                    Image(systemName: "xmark").font(.scaled(11, weight: .semibold)).foregroundStyle(Theme.red)
                } else {
                    Image(systemName: "checkmark").font(.scaled(11, weight: .semibold)).foregroundStyle(Theme.green)
                }
            } else {
                ProgressView().controlSize(.small)
            }
            completedText(errorMessage: f.message)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func completedText(errorMessage: String?) -> Text {
        var t = Text(label).foregroundColor(Theme.mutedForeground)
        if hasArgs {
            t = t + Text(" (\(ChatTools.argsSummary(part.input)))").foregroundColor(Theme.mutedForeground.opacity(0.7))
        }
        if let errorMessage {
            t = t + Text(" - \(errorMessage)").foregroundColor(Theme.red)
        }
        return t
    }

    private func statusLine<C: View>(background: Color, @ViewBuilder content: () -> C) -> some View {
        HStack(alignment: .center, spacing: 6) {
            content()
        }
        .font(.scaled(14))
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(background, in: RoundedRectangle(cornerRadius: 4, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(Theme.border))
    }
}
