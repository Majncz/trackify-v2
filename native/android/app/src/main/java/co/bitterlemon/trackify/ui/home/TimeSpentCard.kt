package co.bitterlemon.trackify.ui.home

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.animateScrollBy
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
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
import androidx.compose.ui.text.drawText
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.data.Task
import co.bitterlemon.trackify.ui.components.BtnSize
import co.bitterlemon.trackify.ui.components.BtnVariant
import co.bitterlemon.trackify.ui.components.TButton
import co.bitterlemon.trackify.ui.components.TCard
import co.bitterlemon.trackify.ui.components.TooltipPopup
import co.bitterlemon.trackify.ui.components.YearlyCalendar
import co.bitterlemon.trackify.ui.theme.MonoDigits
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.ui.theme.hexColor
import co.bitterlemon.trackify.util.Accents
import co.bitterlemon.trackify.util.ChartData
import co.bitterlemon.trackify.util.DayEvent
import co.bitterlemon.trackify.util.Format
import co.bitterlemon.trackify.util.Time
import co.bitterlemon.trackify.util.WeekGrid
import co.bitterlemon.trackify.util.WeeklySegment
import co.bitterlemon.trackify.util.YearlyData
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.time.LocalDate

private class TimeSpentModel(
    val eventsByDate: Map<LocalDate, List<DayEvent>>,
    val week: WeekGrid,
    val yearly: YearlyData?,
    val weeklyColors: Map<String, String>,
    val hasOther: Boolean,
    val yearlyColors: Map<String, String>,
)

/** Home "Time Spent" card: Weekly (day × hour heat grid, 1000 days) and Yearly (contribution calendar). */
@Composable
fun TimeSpentCard(tasks: List<Task>, liveTaskId: String?, liveStart: Long?) {
    var mode by rememberSaveable { mutableStateOf("weekly") }
    // Live timer is a synthetic event refreshed every 10 s (web).
    val liveNow = co.bitterlemon.trackify.ui.team.rememberTicker(liveTaskId != null, 10_000)
    // The expensive 1000-day grid is built once per task list; the live stretch only rebuilds its own day rows.
    val base by produceState<Pair<Map<LocalDate, List<DayEvent>>, WeekGrid>?>(null, tasks) {
        value = withContext(Dispatchers.Default) {
            val ebd = ChartData.eventsByDate(tasks.map { t -> t.name to t.events.map { it.fromMs to it.toMs } })
            ebd to ChartData.buildWeekGrid(ebd)
        }
    }
    val model by produceState<TimeSpentModel?>(null, base, liveTaskId, liveStart, liveNow) {
        val b = base ?: return@produceState
        value = withContext(Dispatchers.Default) {
            val liveTask = tasks.firstOrNull { it.id == liveTaskId }
            val liveEvent = if (liveTask != null && liveStart != null) DayEvent(liveTask.name, liveStart, liveNow) else null
            val (grid, ebd) = ChartData.withLiveRows(b.second, b.first, liveEvent)
            val withLive = ChartData.withLive(tasks, liveTaskId, liveStart, liveNow)
            val (wc, other) = ChartData.weeklyTaskColors(withLive, tasks, liveTaskId)
            TimeSpentModel(ebd, grid, ChartData.buildYearly(ebd), wc, other, ChartData.yearlyTaskColors(tasks))
        }
    }
    val listState = rememberLazyListState(initialFirstVisibleItemIndex = ChartData.DAYS_TO_LOAD - 1)
    val yearScroll = rememberScrollState(Int.MAX_VALUE)
    val scope = rememberCoroutineScope()

    Column(Modifier.fillMaxWidth()) {
        co.bitterlemon.trackify.ui.components.Segmented(
            listOf("weekly" to "Weekly", "yearly" to "Yearly"), mode, { mode = it }, Modifier.fillMaxWidth(),
        )
        val m = model
        Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            if (mode == "weekly") {
                IconButton({ scope.launch { listState.animateScrollBy(-120f) } }) { Icon(Icons.Outlined.KeyboardArrowUp, "Scroll up", tint = T.c.foreground) }
                Text(
                    m?.week?.let { "${Time.format(it.days.first(), "MMM d")} - ${Time.format(it.days.last(), "MMM d, yyyy")}" } ?: "",
                    fontSize = 14.sp, color = T.c.mutedForeground, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                )
                IconButton({ scope.launch { listState.animateScrollBy(120f) } }) { Icon(Icons.Outlined.KeyboardArrowDown, "Scroll down", tint = T.c.foreground) }
            } else {
                IconButton({ scope.launch { yearScroll.animateScrollBy(-120f) } }) { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, "Scroll left", tint = T.c.foreground) }
                Text("Yearly Calendar", fontSize = 14.sp, color = T.c.mutedForeground, modifier = Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                IconButton({ scope.launch { yearScroll.animateScrollBy(120f) } }) { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, "Scroll right", tint = T.c.foreground) }
            }
        }
        Spacer(Modifier.height(4.dp))
        when {
            m == null -> Box(Modifier.fillMaxWidth().height(240.dp), contentAlignment = Alignment.Center) { Text("Loading...", color = T.c.mutedForeground) }
            mode == "weekly" && !m.week.hasData || mode == "yearly" && m.yearly == null ->
                Box(Modifier.fillMaxWidth().height(200.dp), contentAlignment = Alignment.Center) { Text("No data for this period", color = T.c.mutedForeground) }
            mode == "weekly" -> WeeklyGrid(m, listState)
            else -> YearlyCalendar(m.yearly!!, m.yearlyColors, yearScroll)
        }
    }
}


private data class SegSel(val day: LocalDate, val seg: WeeklySegment, val anchor: IntOffset, val sph: Int)

@Composable
private fun WeeklyGrid(m: TimeSpentModel, listState: androidx.compose.foundation.lazy.LazyListState) {
    val density = LocalDensity.current
    var selected by remember { mutableStateOf<SegSel?>(null) }
    Column {
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            val labelW = 52.dp
            val availablePx = with(density) { (maxWidth - labelW - 2.dp).toPx() }
            val gapPx = with(density) { 2.dp.toPx() }
            val (sph, cellPx) = ChartData.weeklyGridMetrics(availablePx / density.density, 2f).let { it.first to it.second * density.density }
            val hourW = cellPx * sph + (sph - 1) * gapPx
            val rowH = with(density) { (cellPx + gapPx).toDp() }
            val muted = T.c.muted
            Column {
                val tickMeasurer = androidx.compose.ui.text.rememberTextMeasurer()
                val tickColor = T.c.mutedForeground
                Canvas(Modifier.fillMaxWidth().height(14.dp)) {
                    val x0 = (labelW + 2.dp).toPx()
                    for (h in listOf(0, 6, 12, 18)) {
                        val m = tickMeasurer.measure("$h", androidx.compose.ui.text.TextStyle(fontSize = 9.sp, color = tickColor))
                        val cx = x0 + h * (hourW + gapPx) + hourW / 2
                        drawText(m, topLeft = Offset(cx - m.size.width / 2f, 0f))
                    }
                }
                LazyColumn(Modifier.fillMaxWidth().height(240.dp), state = listState) {
                    itemsIndexed(m.week.days, key = { _, d -> d.toEpochDay() }) { idx, day ->
                        val cells = m.week.grid[idx]
                        val segments = remember(cells, sph) { ChartData.buildDaySegments(cells, sph, maxOf(sph, 2)) }
                        var origin by remember { mutableStateOf(Offset.Zero) }
                        Row(Modifier.height(rowH), verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                Time.format(day, "MMM d"), fontSize = 11.sp, color = T.c.mutedForeground, style = co.bitterlemon.trackify.ui.theme.Tabular,
                                modifier = Modifier.width(labelW).padding(end = 6.dp), textAlign = androidx.compose.ui.text.style.TextAlign.End, maxLines = 1,
                            )
                            Spacer(Modifier.width(2.dp))
                            Canvas(
                                Modifier.fillMaxWidth().height(rowH)
                                    .onGloballyPositioned { origin = it.boundsInWindow().topLeft }
                                    .pointerInput(segments, sph) {
                                        detectTapGestures { p ->
                                            val flat = (p.x / (cellPx + gapPx)).toInt()
                                            val seg = segments.firstOrNull { flat in it.startFlat..it.endFlat }
                                            if (seg != null) selected = SegSel(day, seg, IntOffset((origin.x + p.x).toInt(), origin.y.toInt()), sph)
                                        }
                                    }
                            ) {
                                val top = (size.height - cellPx) / 2
                                for (hour in 0 until 24) {
                                    val cell = cells[hour]
                                    val dominant = cell.dominant()
                                    for (sq in 0 until sph) {
                                        val flat = hour * sph + sq
                                        val seg = segments.firstOrNull { flat in it.startFlat..it.endFlat }
                                        val fill = seg?.taskName ?: dominant
                                        val base = if (fill != null) hexColor(m.weeklyColors[fill] ?: Accents.OTHER_COLOR) else muted
                                        val hasTime = cell.totalMinutes > 0
                                        val opacity = when {
                                            hasTime -> Accents.weeklyOpacity(cell.totalMinutes, m.week.maxMinutes)
                                            seg != null -> 0.42
                                            else -> 0.7
                                        }
                                        val sel = selected?.let { it.day == day && flat in it.seg.startFlat..it.seg.endFlat } == true
                                        drawRoundRect(
                                            base.copy(alpha = (opacity * base.alpha).toFloat().let { if (sel) minOf(1f, it + 0.25f) else it }),
                                            Offset(flat * (cellPx + gapPx), top), Size(cellPx, cellPx), CornerRadius(2.dp.toPx()),
                                        )
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        val legend = m.weeklyColors.entries.toList()
        if (legend.isNotEmpty()) {
            Spacer(Modifier.height(12.dp))
            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp, Alignment.CenterHorizontally), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                legend.forEach { (name, color) ->
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(Modifier.size(12.dp).clip(RoundedCornerShape(2.dp)).background(hexColor(color)))
                        Spacer(Modifier.width(6.dp))
                        Text(name, fontSize = 13.sp, color = T.c.mutedForeground)
                    }
                }
            }
        }
    }
    selected?.let { s -> SegmentTooltip(s, m, onDismiss = { selected = null }) }
}

@Composable
private fun SegmentTooltip(s: SegSel, m: TimeSpentModel, onDismiss: () -> Unit) {
    val clipboard = LocalClipboardManager.current
    var copied by remember(s) { mutableStateOf(false) }
    val (rs, _) = ChartData.slotRange(s.day, s.seg.startFlat, s.sph)
    val (_, re) = ChartData.slotRange(s.day, s.seg.endFlat, s.sph)
    val dayEvents = m.eventsByDate[s.day] ?: emptyList()
    val precise = ChartData.preciseWindow(dayEvents, rs, re, s.seg.taskName)
    val mins = ChartData.minutesForTask(dayEvents, s.seg.taskName, rs, re)
    val timeLine = if (precise != null) "${Time.format(precise.first, "HH:mm:ss")} → ${Time.format(precise.second, "HH:mm:ss")}"
    else "${Time.format(rs, "HH:mm:ss")} → ${Time.format(re, "HH:mm:ss")} (grid)"
    val gapMin = if (s.seg.bridgedEmptySlots > 0) s.seg.bridgedEmptySlots * (60.0 / s.sph) else 0.0
    val scope = rememberCoroutineScope()
    TooltipPopup(s.anchor, onDismiss, width = 236) {
        Row {
            Column(Modifier.weight(1f)) {
                Text(Time.format(s.day, "EEEE, MMMM d, yyyy"), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
                Text(Time.format(s.day, "d.M.yyyy"), fontSize = 12.sp, color = T.c.mutedForeground)
                Text(timeLine, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.foreground, style = MonoDigits)
            }
            IconButton({
                val lines = mutableListOf(
                    "Trackify - time segment", "", "Date: ${Time.format(s.day, "EEEE, MMMM d, yyyy")}", Time.format(s.day, "d.M.yyyy"), "",
                    "Task: ${s.seg.taskName}", "Time logged: ${Format.heatMinutes(mins)}", "", timeLine.replace("→", "->"),
                )
                if (gapMin > 0) {
                    lines += ""; lines += "Streak gap (no logged time): ${Format.heatMinutes(gapMin)}"
                }
                clipboard.setText(AnnotatedString(lines.joinToString("\n")))
                copied = true
                scope.launch { delay(1600); copied = false }
            }, modifier = Modifier.size(32.dp)) {
                Icon(if (copied) Icons.Outlined.Check else Icons.Outlined.ContentCopy, "Copy details", tint = if (copied) T.c.emerald else T.c.mutedForeground, modifier = Modifier.size(16.dp))
            }
        }
        Spacer(Modifier.height(8.dp))
        HorizontalDivider(color = T.c.border)
        Spacer(Modifier.height(8.dp))
        Row {
            Box(Modifier.padding(top = 4.dp).size(10.dp).clip(RoundedCornerShape(2.dp)).background(hexColor(m.weeklyColors[s.seg.taskName] ?: Accents.OTHER_COLOR)))
            Spacer(Modifier.width(8.dp))
            Column {
                Text(s.seg.taskName, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = T.c.foreground, maxLines = 2)
                Text(Format.heatMinutes(mins), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = MonoDigits)
            }
        }
        if (gapMin > 0) {
            Text(
                "Short gap in this streak: ${Format.heatMinutes(gapMin)} with no logged time",
                fontSize = 12.sp, color = T.c.mutedForeground, modifier = Modifier.padding(start = 18.dp, top = 6.dp),
            )
        }
    }
}
