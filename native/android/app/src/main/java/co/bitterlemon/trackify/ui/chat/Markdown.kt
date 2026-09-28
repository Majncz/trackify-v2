package co.bitterlemon.trackify.ui.chat

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.withLink
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.ui.theme.T

/** Minimal GitHub-flavoured Markdown: paragraphs, headings, bold/italic/strike, code, lists, quotes, tables, links. */
sealed class MdBlock {
    data class Para(val text: String) : MdBlock()
    data class Heading(val level: Int, val text: String) : MdBlock()
    data class Code(val text: String) : MdBlock()
    data class ListBlock(val ordered: Boolean, val items: List<Pair<Int, String>>, val start: Int) : MdBlock()
    data class Quote(val text: String) : MdBlock()
    data class Table(val header: List<String>, val rows: List<List<String>>) : MdBlock()
    data object Rule : MdBlock()
}

object MarkdownParser {
    private val ulRe = Regex("^(\\s*)[-*+]\\s+(.*)$")
    private val olRe = Regex("^(\\s*)(\\d+)[.)]\\s+(.*)$")
    private val sepRe = Regex("^\\s*\\|?\\s*:?-{2,}:?\\s*(\\|\\s*:?-{2,}:?\\s*)*\\|?\\s*$")

    fun splitRow(line: String): List<String> {
        var s = line.trim()
        if (s.startsWith("|")) s = s.substring(1)
        if (s.endsWith("|")) s = s.dropLast(1)
        return s.split("|").map { it.trim() }
    }

    fun parse(src: String): List<MdBlock> {
        val lines = src.replace("\r\n", "\n").split("\n")
        val out = ArrayList<MdBlock>()
        var i = 0
        val para = StringBuilder()
        fun flush() {
            if (para.isNotBlank()) out.add(MdBlock.Para(para.toString().trim()))
            para.clear()
        }
        while (i < lines.size) {
            val line = lines[i]
            val t = line.trim()
            when {
                t.startsWith("```") -> {
                    flush()
                    val sb = StringBuilder()
                    i++
                    while (i < lines.size && !lines[i].trim().startsWith("```")) {
                        sb.append(lines[i]).append('\n'); i++
                    }
                    out.add(MdBlock.Code(sb.toString().trimEnd('\n')))
                    i++; continue
                }
                t.isEmpty() -> flush()
                t.matches(Regex("^(-{3,}|\\*{3,}|_{3,})$")) -> { flush(); out.add(MdBlock.Rule) }
                t.startsWith("#") -> {
                    flush()
                    val level = t.takeWhile { it == '#' }.length.coerceAtMost(6)
                    out.add(MdBlock.Heading(level, t.drop(level).trim()))
                }
                t.startsWith(">") -> {
                    flush()
                    val sb = StringBuilder()
                    while (i < lines.size && lines[i].trim().startsWith(">")) {
                        sb.append(lines[i].trim().removePrefix(">").trim()).append(' '); i++
                    }
                    out.add(MdBlock.Quote(sb.toString().trim())); continue
                }
                t.contains("|") && i + 1 < lines.size && sepRe.matches(lines[i + 1]) -> {
                    flush()
                    val header = splitRow(t)
                    i += 2
                    val rows = ArrayList<List<String>>()
                    while (i < lines.size && lines[i].contains("|") && lines[i].isNotBlank()) {
                        rows.add(splitRow(lines[i])); i++
                    }
                    out.add(MdBlock.Table(header, rows)); continue
                }
                ulRe.matches(line) || olRe.matches(line) -> {
                    flush()
                    val ordered = olRe.matches(line) && !ulRe.matches(line)
                    val items = ArrayList<Pair<Int, String>>()
                    val start = olRe.find(line)?.groupValues?.get(2)?.toIntOrNull() ?: 1
                    while (i < lines.size) {
                        val l = lines[i]
                        val u = ulRe.find(l)
                        val o = olRe.find(l)
                        when {
                            u != null -> items.add((u.groupValues[1].length / 2) to u.groupValues[2])
                            o != null -> items.add((o.groupValues[1].length / 2) to o.groupValues[3])
                            l.isNotBlank() && l.startsWith("  ") && items.isNotEmpty() -> {
                                val last = items.removeAt(items.size - 1); items.add(last.first to last.second + " " + l.trim())
                            }
                            else -> break
                        }
                        i++
                    }
                    out.add(MdBlock.ListBlock(ordered, items, start)); continue
                }
                else -> para.append(if (para.isEmpty()) t else "\n$t")
            }
            i++
        }
        flush()
        return out
    }

    /** Inline spans. */
    fun inline(text: String, codeBg: Color, linkColor: Color): AnnotatedString = buildAnnotatedString {
        var i = 0
        while (i < text.length) {
            val c = text[i]
            fun closing(token: String, from: Int): Int = text.indexOf(token, from)
            when {
                c == '`' -> {
                    val end = closing("`", i + 1)
                    if (end > i) {
                        withStyle(SpanStyle(fontFamily = FontFamily.Monospace, background = codeBg, fontSize = 13.sp)) { append(text.substring(i + 1, end)) }
                        i = end + 1; continue
                    }
                }
                text.startsWith("**", i) || text.startsWith("__", i) -> {
                    val tok = text.substring(i, i + 2)
                    val end = closing(tok, i + 2)
                    if (end > i + 2) {
                        withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(inline(text.substring(i + 2, end), codeBg, linkColor)) }
                        i = end + 2; continue
                    }
                }
                text.startsWith("~~", i) -> {
                    val end = closing("~~", i + 2)
                    if (end > i + 2) {
                        withStyle(SpanStyle(textDecoration = TextDecoration.LineThrough)) { append(text.substring(i + 2, end)) }
                        i = end + 2; continue
                    }
                }
                (c == '*' || c == '_') && i + 1 < text.length && text[i + 1] != ' ' -> {
                    val end = closing(c.toString(), i + 1)
                    val wordBoundary = c == '*' || i == 0 || !text[i - 1].isLetterOrDigit()
                    if (end > i + 1 && wordBoundary) {
                        withStyle(SpanStyle(fontStyle = FontStyle.Italic)) { append(inline(text.substring(i + 1, end), codeBg, linkColor)) }
                        i = end + 1; continue
                    }
                }
                c == '[' -> {
                    val close = closing("](", i + 1)
                    val endUrl = if (close > 0) closing(")", close + 2) else -1
                    if (close > 0 && endUrl > close) {
                        val label = text.substring(i + 1, close)
                        val url = text.substring(close + 2, endUrl)
                        withLink(LinkAnnotation.Url(url, TextLinkStyles(SpanStyle(color = linkColor, textDecoration = TextDecoration.Underline)))) { append(label) }
                        i = endUrl + 1; continue
                    }
                }
            }
            append(c)
            i++
        }
    }
}

@Composable
fun MarkdownText(text: String, color: Color, modifier: Modifier = Modifier) {
    val blocks = remember(text) { MarkdownParser.parse(text) }
    val codeBg = T.c.background.copy(alpha = 0.5f)
    val link = T.c.foreground
    Column(modifier) {
        blocks.forEachIndexed { idx, b ->
            if (idx > 0) Spacer(Modifier.padding(top = 4.dp))
            when (b) {
                is MdBlock.Para -> Text(MarkdownParser.inline(b.text, codeBg, link), color = color, fontSize = 16.sp, lineHeight = 22.sp)
                is MdBlock.Heading -> Text(MarkdownParser.inline(b.text, codeBg, link), color = color, fontSize = if (b.level <= 2) 16.sp else 15.sp, fontWeight = FontWeight.SemiBold)
                is MdBlock.Code -> Text(
                    b.text, color = color, fontFamily = FontFamily.Monospace, fontSize = 12.sp,
                    modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(codeBg).horizontalScroll(rememberScrollState()).padding(8.dp),
                )
                is MdBlock.Quote -> Row {
                    Spacer(Modifier.width(3.dp).padding(vertical = 2.dp).background(T.c.border))
                    Text(MarkdownParser.inline(b.text, codeBg, link), color = T.c.mutedForeground, fontSize = 16.sp, modifier = Modifier.padding(start = 8.dp))
                }
                is MdBlock.ListBlock -> Column {
                    b.items.forEachIndexed { n, (level, t) ->
                        Row(Modifier.padding(start = (12 * level).dp)) {
                            Text(if (b.ordered) "${b.start + n}." else "•", color = color, fontSize = 16.sp, modifier = Modifier.widthIn(min = 16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text(MarkdownParser.inline(t, codeBg, link), color = color, fontSize = 16.sp, lineHeight = 22.sp)
                        }
                    }
                }
                is MdBlock.Table -> Column(Modifier.horizontalScroll(rememberScrollState()).border(1.dp, T.c.border)) {
                    val cols = maxOf(b.header.size, b.rows.maxOfOrNull { it.size } ?: 0)
                    val widths = (0 until cols).map { c ->
                        val len = (listOf(b.header) + b.rows).maxOf { it.getOrElse(c) { "" }.replace("*", "").length }
                        (len * 7 + 18).coerceIn(56, 220)
                    }
                    TableRow(b.header, widths, true, codeBg, link, color)
                    b.rows.forEach { TableRow(it, widths, false, codeBg, link, color) }
                }
                MdBlock.Rule -> Spacer(Modifier.padding(vertical = 4.dp).width(40.dp).background(T.c.border))
            }
        }
    }
}

@Composable
private fun TableRow(cells: List<String>, widths: List<Int>, header: Boolean, codeBg: Color, link: Color, color: Color) {
    Row(if (header) Modifier.background(T.c.muted.copy(alpha = 0.5f)).height(IntrinsicSize.Min) else Modifier.height(IntrinsicSize.Min)) {
        for (c in widths.indices) {
            Text(
                MarkdownParser.inline(cells.getOrElse(c) { "" }, codeBg, link), color = color, fontSize = 12.sp,
                fontWeight = if (header) FontWeight.Medium else FontWeight.Normal,
                modifier = Modifier.fillMaxHeight().border(0.5.dp, T.c.border).width(widths[c].dp).padding(horizontal = 8.dp, vertical = 3.dp),
            )
        }
    }
}
