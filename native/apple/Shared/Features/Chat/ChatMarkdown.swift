import SwiftUI
import TrackifyKit

// MARK: - Lightweight GitHub-flavoured Markdown for assistant bubbles

enum ChatMDBlock {
    case paragraph(String)
    case heading(Int, String)
    case bullets([ChatMDListItem])
    case ordered([ChatMDListItem])
    case code(String)
    case table(header: [String], rows: [[String]])
    case rule
}

struct ChatMDListItem {
    var indent: Int
    var marker: String
    var text: String
}

enum ChatMarkdownParser {
    static func parse(_ source: String) -> [ChatMDBlock] {
        let lines = source.replacingOccurrences(of: "\r\n", with: "\n").components(separatedBy: "\n")
        var blocks: [ChatMDBlock] = []
        var para: [String] = []
        var i = 0

        func flushPara() {
            if !para.isEmpty {
                blocks.append(.paragraph(para.joined(separator: "\n")))
                para.removeAll()
            }
        }

        while i < lines.count {
            let line = lines[i]
            let trimmed = line.trimmingCharacters(in: .whitespaces)

            // Fenced code
            if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") {
                flushPara()
                let fence = String(trimmed.prefix(3))
                var code: [String] = []
                i += 1
                while i < lines.count, !lines[i].trimmingCharacters(in: .whitespaces).hasPrefix(fence) {
                    code.append(lines[i])
                    i += 1
                }
                i += 1 // closing fence (or end)
                blocks.append(.code(code.joined(separator: "\n")))
                continue
            }

            if trimmed.isEmpty {
                flushPara()
                i += 1
                continue
            }

            // Heading
            if let h = heading(trimmed) {
                flushPara()
                blocks.append(.heading(h.0, h.1))
                i += 1
                continue
            }

            // Horizontal rule
            if isRule(trimmed) {
                flushPara()
                blocks.append(.rule)
                i += 1
                continue
            }

            // Table: header row + separator row
            if trimmed.contains("|"), i + 1 < lines.count, isTableSeparator(lines[i + 1]) {
                flushPara()
                let header = cells(trimmed)
                var rows: [[String]] = []
                i += 2
                while i < lines.count {
                    let t = lines[i].trimmingCharacters(in: .whitespaces)
                    if t.isEmpty || !t.contains("|") { break }
                    rows.append(cells(t))
                    i += 1
                }
                blocks.append(.table(header: header, rows: rows))
                continue
            }

            // Lists
            if listItem(line, ordered: false) != nil || listItem(line, ordered: true) != nil {
                flushPara()
                let ordered = listItem(line, ordered: true) != nil
                var items: [ChatMDListItem] = []
                while i < lines.count {
                    let l = lines[i]
                    if let item = listItem(l, ordered: ordered) ?? listItem(l, ordered: !ordered) {
                        items.append(item)
                        i += 1
                    } else if !l.trimmingCharacters(in: .whitespaces).isEmpty,
                              l.hasPrefix("  ") || l.hasPrefix("\t"), !items.isEmpty {
                        // continuation line of the previous item
                        items[items.count - 1].text += " " + l.trimmingCharacters(in: .whitespaces)
                        i += 1
                    } else {
                        break
                    }
                }
                blocks.append(ordered ? .ordered(items) : .bullets(items))
                continue
            }

            para.append(line)
            i += 1
        }
        flushPara()
        return blocks
    }

    private static func heading(_ t: String) -> (Int, String)? {
        var level = 0
        for ch in t { if ch == "#" { level += 1 } else { break } }
        guard level >= 1, level <= 6 else { return nil }
        let rest = t.dropFirst(level)
        guard rest.first == " " else { return nil }
        var text = rest.trimmingCharacters(in: .whitespaces)
        while text.hasSuffix("#") { text.removeLast() }
        return (level, text.trimmingCharacters(in: .whitespaces))
    }

    private static func isRule(_ t: String) -> Bool {
        let compact = t.replacingOccurrences(of: " ", with: "")
        guard compact.count >= 3, let first = compact.first, "-*_".contains(first) else { return false }
        return compact.allSatisfy { $0 == first }
    }

    static func isTableSeparator(_ line: String) -> Bool {
        let t = line.trimmingCharacters(in: .whitespaces)
        guard t.contains("-") else { return false }
        let parts = cells(t)
        guard !parts.isEmpty else { return false }
        return parts.allSatisfy { cell in
            let c = cell.trimmingCharacters(in: .whitespaces)
            guard !c.isEmpty else { return false }
            return c.allSatisfy { $0 == "-" || $0 == ":" } && c.contains("-")
        }
    }

    static func cells(_ row: String) -> [String] {
        var t = row.trimmingCharacters(in: .whitespaces)
        if t.hasPrefix("|") { t.removeFirst() }
        if t.hasSuffix("|") && !t.hasSuffix("\\|") { t.removeLast() }
        // Split on unescaped pipes.
        var out: [String] = []
        var cur = ""
        var prev: Character = " "
        for ch in t {
            if ch == "|" && prev != "\\" {
                out.append(cur.trimmingCharacters(in: .whitespaces))
                cur = ""
            } else {
                cur.append(ch)
            }
            prev = ch
        }
        out.append(cur.trimmingCharacters(in: .whitespaces))
        return out.map { $0.replacingOccurrences(of: "\\|", with: "|") }
    }

    static func listItem(_ line: String, ordered: Bool) -> ChatMDListItem? {
        var indentCount = 0
        for ch in line {
            if ch == " " { indentCount += 1 } else if ch == "\t" { indentCount += 4 } else { break }
        }
        let body = line.trimmingCharacters(in: .whitespaces)
        let indent = min(indentCount / 2, 4)
        if ordered {
            var digits = ""
            for ch in body { if ch.isNumber { digits.append(ch) } else { break } }
            guard !digits.isEmpty, digits.count <= 9 else { return nil }
            let rest = body.dropFirst(digits.count)
            guard let sep = rest.first, sep == "." || sep == ")" else { return nil }
            let after = rest.dropFirst()
            guard after.first == " " else { return nil }
            return ChatMDListItem(indent: indent, marker: digits + ".", text: after.trimmingCharacters(in: .whitespaces))
        } else {
            guard let first = body.first, first == "-" || first == "*" || first == "+" else { return nil }
            let after = body.dropFirst()
            guard after.first == " " else { return nil }
            var text = after.trimmingCharacters(in: .whitespaces)
            var marker = "•"
            if text.hasPrefix("[ ] ") { marker = "☐"; text = String(text.dropFirst(4)) }
            else if text.hasPrefix("[x] ") || text.hasPrefix("[X] ") { marker = "☑"; text = String(text.dropFirst(4)) }
            return ChatMDListItem(indent: indent, marker: marker, text: text)
        }
    }

    /// Inline Markdown (bold, italics, code, links, strikethrough).
    static func inline(_ s: String) -> AttributedString {
        if let a = try? AttributedString(markdown: s, options: .init(interpretedSyntax: .inlineOnlyPreservingWhitespace)) {
            return a
        }
        return AttributedString(s)
    }
}

// MARK: - Rendering

struct ChatMarkdownView: View {
    var text: String

    var body: some View {
        let blocks = ChatMarkdownParser.parse(text)
        VStack(alignment: .leading, spacing: 6) {
            ForEach(Array(blocks.enumerated()), id: \.offset) { _, block in
                ChatMDBlockView(block: block)
            }
        }
        .foregroundStyle(Theme.foreground)
        .textSelection(.enabled)
    }
}

struct ChatMDBlockView: View {
    var block: ChatMDBlock

    var body: some View {
        switch block {
        case .paragraph(let s):
            Text(ChatMarkdownParser.inline(s))
                .font(.scaled(14))
                .fixedSize(horizontal: false, vertical: true)
        case .heading(let level, let s):
            Text(ChatMarkdownParser.inline(s))
                .font(.scaled(level == 1 ? 17 : (level == 2 ? 16 : 14), weight: level <= 2 ? .bold : .semibold))
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 2)
        case .bullets(let items), .ordered(let items):
            ChatMDListView(items: items)
        case .code(let code):
            ScrollView(.horizontal, showsIndicators: true) {
                Text(code)
                    .font(.mono(12))
                    .fixedSize()
                    .padding(8)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.background.opacity(0.5), in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        case .table(let header, let rows):
            ChatMDTableView(header: header, rows: rows)
        case .rule:
            Hairline().padding(.vertical, 4)
        }
    }
}

struct ChatMDListView: View {
    var items: [ChatMDListItem]

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            ForEach(Array(items.enumerated()), id: \.offset) { _, item in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(item.marker)
                        .font(.scaled(14))
                        .foregroundStyle(Theme.mutedForeground)
                        .tabular()
                    Text(ChatMarkdownParser.inline(item.text))
                        .font(.scaled(14))
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.leading, CGFloat(item.indent) * 14 + 4)
            }
        }
    }
}

struct ChatMDTableView: View {
    var header: [String]
    var rows: [[String]]

    private var columnCount: Int { max(header.count, rows.map(\.count).max() ?? 0) }

    var body: some View {
        let cols = columnCount
        ScrollView(.horizontal, showsIndicators: true) {
            Grid(alignment: .leading, horizontalSpacing: 0, verticalSpacing: 0) {
                GridRow {
                    ForEach(0..<cols, id: \.self) { c in
                        cell(c < header.count ? header[c] : "", header: true)
                    }
                }
                ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                    GridRow {
                        ForEach(0..<cols, id: \.self) { c in
                            cell(c < row.count ? row[c] : "", header: false)
                        }
                    }
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 6, style: .continuous).strokeBorder(Theme.border.opacity(0.5)))
            .padding(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func cell(_ s: String, header: Bool) -> some View {
        Text(ChatMarkdownParser.inline(s))
            .font(.scaled(12, weight: header ? .semibold : .regular))
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(header ? Theme.primary.opacity(0.06) : Theme.background.opacity(0.35))
            .border(Theme.border, width: 0.5)
    }
}
