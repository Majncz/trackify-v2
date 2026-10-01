package co.bitterlemon.trackify.ui.stats

import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.MoreHoriz
import androidx.compose.foundation.clickable
import co.bitterlemon.trackify.ui.components.Section
import co.bitterlemon.trackify.ui.components.SectionDivider
import co.bitterlemon.trackify.ui.components.TCard
import co.bitterlemon.trackify.ui.components.SectionLabel
import co.bitterlemon.trackify.ui.components.ListRow
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.DateRange
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.Group
import co.bitterlemon.trackify.ui.components.BtnSize
import co.bitterlemon.trackify.ui.components.BtnVariant
import co.bitterlemon.trackify.ui.components.Chip
import co.bitterlemon.trackify.ui.components.DateField
import co.bitterlemon.trackify.ui.components.ActionSheet
import co.bitterlemon.trackify.ui.components.ListRow
import co.bitterlemon.trackify.ui.components.RowDivider
import co.bitterlemon.trackify.ui.components.ScreenBar
import co.bitterlemon.trackify.ui.components.SectionLabel
import co.bitterlemon.trackify.ui.components.Segmented
import co.bitterlemon.trackify.ui.components.SheetAction
import co.bitterlemon.trackify.ui.components.Skeleton
import co.bitterlemon.trackify.ui.components.TButton
import co.bitterlemon.trackify.ui.components.TCard
import co.bitterlemon.trackify.ui.components.TooltipPopup
import co.bitterlemon.trackify.ui.team.rememberTicker
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.ui.theme.Tabular
import co.bitterlemon.trackify.ui.theme.hexColor
import co.bitterlemon.trackify.util.Format
import co.bitterlemon.trackify.util.StatsData
import co.bitterlemon.trackify.util.StatsResult
import co.bitterlemon.trackify.util.TaskSpans
import co.bitterlemon.trackify.util.Time
import co.bitterlemon.trackify.util.TrendRow
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate

enum class StatsRange(val label: String) { Today("Today"), Week("Week"), Month("Month"), AllTime("All Time"), Custom("Custom") }

fun rangeBounds(r: StatsRange, customFrom: LocalDate, customTo: LocalDate, today: LocalDate = Time.today()): Pair<Long?, Long?> = when (r) {
    StatsRange.Today -> Time.startOfDay(today) to Time.endOfDay(today)
    StatsRange.Week -> Time.startOfDay(Time.mondayOf(today)) to Time.endOfDay(Time.sundayOf(today))
    StatsRange.Month -> Time.startOfDay(today.withDayOfMonth(1)) to Time.endOfDay(today.withDayOfMonth(today.lengthOfMonth()))
    StatsRange.AllTime -> null to null
    StatsRange.Custom -> Time.startOfDay(customFrom) to Time.endOfDay(customTo)
}

@Composable
fun StatsScreen(onOpenTask: (String) -> Unit = {}) {
    val graph = AppGraph.get(LocalContext.current)
    val tasks by graph.repo.tasks.collectAsState()
    val groups by graph.repo.groups.collectAsState()
    val timer by graph.engine.ui.collectAsState()
    var rangeName by rememberSaveable { mutableStateOf(StatsRange.Week.name) }
    val range = StatsRange.valueOf(rangeName)
    var customFrom by rememberSaveable { mutableStateOf(Time.mondayOf(Time.today()).toString()) }
    var customTo by rememberSaveable { mutableStateOf(Time.sundayOf(Time.today()).toString()) }
    var editGroup by remember { mutableStateOf<Group?>(null) }
    var createOpen by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val clipboard = LocalClipboardManager.current

    LaunchedEffect(Unit) { if (graph.repo.groups.value == null) graph.repo.refreshGroups() }

    // Live timer included (web ticks each second; recomputing the whole page every second is wasteful,
    // so stats refresh every 5 s while running — the running total still reads live).
    val now = rememberTicker(timer.running != null, 5000)
    val (rFrom, rTo) = rangeBounds(range, LocalDate.parse(customFrom), LocalDate.parse(customTo))
    val result by produceState<StatsResult?>(null, tasks, groups, rFrom, rTo, now, timer.running) {
        val t = tasks ?: return@produceState
        value = withContext(Dispatchers.Default) {
            val spans = t.map { task ->
                val ev = task.events.map { it.fromMs to it.toMs }
                val r = timer.running
                TaskSpans(task, if (r != null && r.taskId == task.id) ev + (r.startTime to now) else ev)
            }
            StatsData.compute(spans, groups ?: emptyList(), rFrom, rTo)
        }
    }

    Column(Modifier.fillMaxSize()) {
    ScreenBar("Stats")
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        val res = result
        // iOS layout: one card with the range picker (+ calendar for a custom range) and the two totals.
        item(key = "ranges") {
            TCard(Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(horizontal = 16.dp).padding(top = 8.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Segmented(
                        listOf(StatsRange.Today to "Today", StatsRange.Week to "Week", StatsRange.Month to "Month", StatsRange.AllTime to "All"),
                        range, { rangeName = it.name }, Modifier.weight(1f),
                    )
                    Spacer(Modifier.width(4.dp))
                    IconButton({ rangeName = if (range == StatsRange.Custom) StatsRange.Week.name else StatsRange.Custom.name }) {
                        Icon(
                            if (range == StatsRange.Custom) Icons.Filled.CalendarMonth else Icons.Outlined.CalendarMonth, "Custom range",
                            tint = T.c.foreground,
                        )
                    }
                }
                if (range == StatsRange.Custom) {
                    Spacer(Modifier.height(10.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        DateField(LocalDate.parse(customFrom), { customFrom = it.toString() }, Modifier.weight(1f), maxDate = null)
                        Text("  to  ", fontSize = 14.sp, color = T.c.mutedForeground)
                        DateField(LocalDate.parse(customTo), { customTo = it.toString() }, Modifier.weight(1f), maxDate = null)
                    }
                }
                HorizontalDivider(Modifier.padding(vertical = 14.dp), thickness = 0.8.dp, color = T.c.separator)
                if (res == null) {
                    Skeleton(Modifier.fillMaxWidth(0.6f).height(44.dp))
                } else {
                    Row(verticalAlignment = Alignment.Bottom) {
                        Column(Modifier.weight(1f)) {
                            Text(Format.fmtMs(res.totalMs), fontSize = 26.sp, fontWeight = FontWeight.Bold, color = T.c.foreground, style = Tabular, maxLines = 1)
                            Text(rangeLabel(range, rFrom, rTo), fontSize = 15.sp, color = T.c.mutedForeground, maxLines = 2)
                        }
                        Spacer(Modifier.width(12.dp))
                        Column(horizontalAlignment = Alignment.End) {
                            Text(Format.fmtMs(res.dailyAvgMs), fontSize = 26.sp, fontWeight = FontWeight.Bold, color = T.c.foreground, style = Tabular, maxLines = 1)
                            Text("daily average", fontSize = 15.sp, color = T.c.mutedForeground, maxLines = 1)
                        }
                    }
                }
            }
        }
        if (res == null) {
            item(key = "sk") {
                Column(Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Skeleton(Modifier.fillMaxWidth().height(200.dp))
                    Skeleton(Modifier.fillMaxWidth().height(128.dp))
                }
            }
            return@LazyColumn
        }
        if (res.trend.any { it.total > 0 }) {
            item(key = "trend") {
                TCard(Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(horizontal = 16.dp).padding(top = 20.dp)) {
                    Text("Daily breakdown", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
                    Spacer(Modifier.height(8.dp))
                    // Axis labels are part of the graphic: they must not overlap at large font sizes.
                    co.bitterlemon.trackify.ui.components.CappedFontScale(1f) { BreakdownChart(res) }
                    Spacer(Modifier.height(10.dp))
                    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(14.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        res.series.forEach { s ->
                            if (s.name == "Other" && res.trend.none { it.values.last() > 0 }) return@forEach
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Box(Modifier.size(11.dp).clip(RoundedCornerShape(3.dp)).background(hexColor(s.hex).copy(alpha = s.alpha)))
                                Spacer(Modifier.width(6.dp))
                                Text(s.name, fontSize = 14.sp, color = T.c.mutedForeground, maxLines = 1)
                            }
                        }
                    }
                }
            }
        }
        if (res.top.isNotEmpty()) {
            item(key = "top") {
                Section(Modifier.widthIn(max = 720.dp), header = "Top tasks") {
                    res.top.forEachIndexed { i, (t, ms) ->
                        if (i > 0) SectionDivider()
                        Row(
                            Modifier.fillMaxWidth().clickable(onClickLabel = "Open task") { onOpenTask(t.id) }
                                .padding(start = 16.dp, end = 10.dp, top = 12.dp, bottom = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            val bar = hexColor(co.bitterlemon.trackify.util.Accents.TASK_COLORS[i % 6])
                            Column(Modifier.weight(1f)) {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    co.bitterlemon.trackify.ui.components.AccentDot(bar, 10.dp)
                                    Spacer(Modifier.width(10.dp))
                                    Text(t.name, fontSize = 17.sp, color = T.c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                    Spacer(Modifier.width(8.dp))
                                    Text(Format.fmtMs(ms), fontSize = 17.sp, color = T.c.mutedForeground, style = Tabular, maxLines = 1)
                                }
                                Spacer(Modifier.height(8.dp))
                                Box(Modifier.fillMaxWidth().height(5.dp).clip(RoundedCornerShape(3.dp)).background(T.c.fill)) {
                                    Box(
                                        Modifier.fillMaxWidth(if (res.totalMs > 0) ms.toFloat() / res.totalMs else 0f).height(5.dp).clip(RoundedCornerShape(3.dp))
                                            .background(bar.copy(alpha = 0.88f)),
                                    )
                                }
                            }
                            Spacer(Modifier.width(4.dp))
                            co.bitterlemon.trackify.ui.components.Chevron()
                        }
                    }
                }
            }
        }
        item(key = "groups") {
            GroupsSection(
                res, onCopy = { text -> clipboard.setText(AnnotatedString(text)) },
                onEdit = { editGroup = it },
                onDelete = { g -> scope.launch { runCatching { graph.api.deleteGroup(g.id) }; graph.repo.refreshGroups(); graph.repo.requestRefresh(0) } },
                onCreate = { createOpen = true },
            )
        }
        if (!tasks.isNullOrEmpty()) {
            item(key = "activity-h") { SectionLabel("Activity", Modifier.widthIn(max = 720.dp)) }
            item(key = "activity") {
                Box(Modifier.widthIn(max = 720.dp).padding(horizontal = 16.dp)) {
                    co.bitterlemon.trackify.ui.home.TimeSpentCard(tasks!!, timer.running?.taskId, timer.running?.startTime)
                }
            }
        }
    }
    }

    if (createOpen) GroupDialog(null, tasks ?: emptyList(), result?.taskMsInRange ?: emptyMap()) { createOpen = false }
    editGroup?.let { g -> GroupDialog(g, tasks ?: emptyList(), result?.taskMsInRange ?: emptyMap()) { editGroup = null } }
}

/** "Sep 28 – Oct 4, 2026" under the total (iOS), or "All time". */
private fun rangeLabel(range: StatsRange, from: Long?, to: Long?): String {
    if (range == StatsRange.AllTime || from == null || to == null) return "All time"
    val a = Time.localDate(from)
    val b = Time.localDate(to)
    return when {
        a == b -> Time.format(a, "EEE, MMM d, yyyy")
        a.year == b.year -> Time.format(a, "MMM d") + " – " + Time.format(b, "MMM d, yyyy")
        else -> Time.format(a, "MMM d, yyyy") + " – " + Time.format(b, "MMM d, yyyy")
    }
}

@Composable
private fun StatCard(title: String, value: String, caption: String?, modifier: Modifier) {
    TCard(modifier) {
        Text(title, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground)
        Spacer(Modifier.height(8.dp))
        Text(value, fontSize = 24.sp, fontWeight = FontWeight.Medium, color = T.c.foreground, style = Tabular, maxLines = 1)
        if (caption != null) Text(caption, fontSize = 12.sp, color = T.c.mutedForeground)
    }
}

/** Stacked bar chart drawn with Canvas (web recharts "Daily breakdown"). */
@Composable
private fun BreakdownChart(res: StatsResult) {
    val density = LocalDensity.current
    val measurer = rememberTextMeasurer()
    val c = T.c
    var selected by remember(res) { mutableStateOf<Pair<Int, IntOffset>?>(null) }
    var origin by remember { mutableStateOf(Offset.Zero) }
    val rows = res.trend
    val maxH = rows.maxOf { it.total } / 3_600_000.0
    val (axisMax, step) = StatsData.niceAxis(maxH)
    val axisW = with(density) { 36.dp.toPx() }
    val bottomH = with(density) { 22.dp.toPx() }
    val topPad = with(density) { 10.dp.toPx() }
    val labelStyle = TextStyle(fontSize = 11.sp, color = c.mutedForeground)
    // Many weekly bars: allow horizontal scroll with a min bar slot.
    val minSlot = with(density) { 14.dp.toPx() }
    Box(Modifier.fillMaxWidth()) {
        androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxWidth()) {
            val mw = maxWidth
            val availPx = with(density) { mw.toPx() }
            val slotW = maxOf(minSlot, (availPx - axisW) / rows.size)
            val contentW = with(density) { (axisW + slotW * rows.size).toDp() }
            val scroll = rememberScrollState(Int.MAX_VALUE)
            Box(Modifier.fillMaxWidth().horizontalScroll(scroll)) {
                Canvas(
                    Modifier.width(maxOf(contentW, mw)).height(208.dp)
                        .onGloballyPositioned { origin = it.boundsInWindow().topLeft }
                        .pointerInput(rows, slotW) {
                            detectTapGestures { p ->
                                val i = ((p.x - axisW) / slotW).toInt()
                                if (i in rows.indices && rows[i].total > 0) {
                                    val plotH = size.height - bottomH - topPad
                                    val top = topPad + plotH * (1 - (rows[i].total / 3_600_000.0 / axisMax)).toFloat()
                                    selected = i to IntOffset((origin.x + axisW + slotW * (i + 0.5f)).toInt(), (origin.y + top).toInt())
                                }
                            }
                        }
                ) {
                    val plotH = size.height - bottomH - topPad
                    // grid + y ticks
                    var v = 0.0
                    while (v <= axisMax + 1e-9) {
                        val y = topPad + plotH * (1 - (v / axisMax)).toFloat()
                        drawLine(c.border.copy(alpha = 0.55f), Offset(axisW, y), Offset(size.width, y), 1f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f)))
                        val label = if (v == Math.floor(v)) "${v.toLong()}h" else "${"%.1f".format(v)}h"
                        val m = measurer.measure(label, labelStyle)
                        drawText(m, topLeft = Offset(axisW - m.size.width - 6f, y - m.size.height / 2f))
                        v += step
                    }
                    val barW = minOf(21.dp.toPx(), slotW * 0.74f)
                    val labelEvery = maxOf(1, kotlin.math.ceil(48.dp.toPx() / slotW).toInt())
                    rows.forEachIndexed { i, row ->
                        val cx = axisW + slotW * (i + 0.5f)
                        var yBase = topPad + plotH
                        row.values.forEachIndexed { si, ms ->
                            if (ms <= 0) return@forEachIndexed
                            val h = (plotH * (ms / 3_600_000.0 / axisMax)).toFloat()
                            val s = res.series[si]
                            val col = hexColor(s.hex).copy(alpha = s.alpha)
                            drawRoundRect(col, Offset(cx - barW / 2, yBase - h), Size(barW, h), CornerRadius(2.dp.toPx()))
                            drawRoundRect(c.cell, Offset(cx - barW / 2, yBase - h), Size(barW, h), CornerRadius(2.dp.toPx()), style = Stroke(1.5f))
                            yBase -= h
                        }
                        if (selected?.first == i) {
                            drawRoundRect(c.foreground.copy(alpha = 0.06f), Offset(cx - slotW / 2, topPad), Size(slotW, plotH), CornerRadius(4f))
                        }
                        if (i % labelEvery == 0 || i == rows.lastIndex && rows.size > 1 && (rows.lastIndex % labelEvery) > labelEvery / 2) {
                            val m = measurer.measure(row.label, labelStyle)
                            drawText(m, topLeft = Offset((cx - m.size.width / 2f).coerceIn(axisW - 4f, size.width - m.size.width), size.height - bottomH + 6f))
                        }
                    }
                }
            }
        }
    }
    selected?.let { (i, anchor) -> ChartTooltip(res, rows[i], anchor) { selected = null } }
}

@Composable
private fun ChartTooltip(res: StatsResult, row: TrendRow, anchor: IntOffset, onDismiss: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    var copied by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val rows = StatsData.tooltipRows(row)
    fun pct(p: Double) = if (p == Math.floor(p)) p.toLong().toString() else p.toString()
    TooltipPopup(anchor, onDismiss, width = 300) {
        Row {
            Column(Modifier.weight(1f)) {
                Text(row.detail, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
                Text(row.numeric, fontSize = 11.sp, color = T.c.mutedForeground, style = Tabular)
                Text("Day total · ${Format.fmtMs(row.total)}", fontSize = 11.sp, color = T.c.mutedForeground)
            }
            IconButton({
                val text = (listOf(row.detail, row.numeric, "Day total · ${Format.fmtMs(row.total)}", "") +
                    rows.map { (si, p, ms) -> "${res.series[si].name} — ${pct(p)}% · ${Format.fmtMs(ms)}" }).joinToString("\n")
                clipboard.setText(AnnotatedString(text)); copied = true
                scope.launch { delay(1600); copied = false }
            }, modifier = Modifier.size(32.dp)) {
                Icon(if (copied) Icons.Outlined.Check else Icons.Outlined.ContentCopy, "Copy details", tint = if (copied) T.c.emerald else T.c.mutedForeground, modifier = Modifier.size(16.dp))
            }
        }
        Spacer(Modifier.height(8.dp))
        HorizontalDivider(color = T.c.border)
        Spacer(Modifier.height(8.dp))
        rows.forEach { (si, p, ms) ->
            val s = res.series[si]
            Row(Modifier.padding(vertical = 3.dp)) {
                Box(Modifier.padding(top = 3.dp).size(10.dp).clip(RoundedCornerShape(2.dp)).background(hexColor(s.hex).copy(alpha = s.alpha)))
                Spacer(Modifier.width(8.dp))
                Column {
                    Text(s.name, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
                    Text("${pct(p)}% · ${Format.fmtMs(ms)}", fontSize = 11.sp, color = T.c.mutedForeground, style = Tabular)
                }
            }
        }
    }
}

@Composable
private fun GroupsSection(res: StatsResult, onCopy: (String) -> Unit, onEdit: (Group) -> Unit, onDelete: (Group) -> Unit, onCreate: () -> Unit) {
    val groups = res.groups
    var menuFor by remember { mutableStateOf<co.bitterlemon.trackify.util.GroupRow?>(null) }
    Column(Modifier.widthIn(max = 720.dp).fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(start = 32.dp, end = 20.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Groups", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = T.c.mutedForeground, modifier = Modifier.weight(1f))
            if (groups.size >= 2) IconButton({ onCopy(groups.joinToString("\n\n") { StatsData.groupText(it) }) }) {
                Icon(Icons.Outlined.ContentCopy, "Copy all groups", tint = T.c.foreground, modifier = Modifier.size(20.dp))
            }
            IconButton(onCreate) { Icon(Icons.Outlined.Add, "Create a group from tasks", tint = T.c.foreground) }
        }
        if (groups.isEmpty()) {
            Section(topGap = 0.dp) {
                Text("No saved groups yet. Tap + to group tasks together.", fontSize = 15.sp, color = T.c.mutedForeground, modifier = Modifier.padding(16.dp))
            }
        } else Section(topGap = 0.dp) {
            groups.forEachIndexed { i, g ->
                if (i > 0) SectionDivider()
                val members = when {
                    g.group.taskIds.isEmpty() -> "No tasks"
                    g.members.isEmpty() && g.orphanIds.isNotEmpty() -> "${g.orphanIds.size} missing task${if (g.orphanIds.size != 1) "s" else ""}"
                    else -> g.members.joinToString(" · ") { (t, ms) -> t.name + (if (t.hidden) " (hidden)" else "") + " " + Format.fmtMs(ms) } +
                        (if (g.orphanIds.isNotEmpty()) " · ${g.orphanIds.size} removed" else "")
                }
                ListRow(
                    g.group.name, subtitle = members, onClick = { onEdit(g.group) },
                    trailing = {
                        Text(Format.fmtMs(g.ms), fontSize = 17.sp, color = T.c.mutedForeground, style = Tabular)
                        IconButton({ menuFor = g }, Modifier.size(36.dp)) { Icon(Icons.Outlined.MoreHoriz, "More for ${g.group.name}", tint = T.c.foreground) }
                    },
                    modifier = Modifier.padding(end = 0.dp),
                )
            }
        }
    }
    menuFor?.let { g ->
        ActionSheet(g.group.name, onDismiss = { menuFor = null }) {
            SheetAction(Icons.Outlined.Edit, "Edit", { menuFor = null; onEdit(g.group) }, first = true)
            SheetAction(Icons.Outlined.ContentCopy, "Copy summary", { menuFor = null; onCopy(StatsData.groupText(g)) })
            SheetAction(Icons.Outlined.Delete, "Delete", { menuFor = null; onDelete(g.group) }, destructive = true)
        }
    }
}
