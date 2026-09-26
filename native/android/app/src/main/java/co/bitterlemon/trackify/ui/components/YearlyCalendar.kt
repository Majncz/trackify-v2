package co.bitterlemon.trackify.ui.components

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.background
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.ui.theme.hexColor
import co.bitterlemon.trackify.util.Accents
import co.bitterlemon.trackify.util.Format
import co.bitterlemon.trackify.util.Time
import co.bitterlemon.trackify.util.YearlyData
import java.time.LocalDate

/** GitHub-style yearly contribution calendar (web `YearlyContributionCalendar`), 12 px cells, Monday rows. */
@Composable
fun YearlyCalendar(
    data: YearlyData,
    taskColors: Map<String, String>,
    scroll: ScrollState = rememberScrollState(Int.MAX_VALUE),
    onDayAction: ((LocalDate) -> Unit)? = null,
    dayActionLabel: String = "Filter the ledger to this day",
) {
    val density = LocalDensity.current
    val cell = with(density) { 12.dp.toPx() }
    val gap = with(density) { 2.dp.toPx() }
    val col = cell + gap
    val header = with(density) { 14.dp.toPx() }
    val measurer = rememberTextMeasurer()
    val muted = T.c.mutedForeground
    val emptyColor = if (T.c.dark) T.c.muted else hexColor(Accents.YEARLY_HEAT_COLORS[0])
    val today = Time.today()
    var selected by remember { mutableStateOf<Pair<LocalDate, IntOffset>?>(null) }
    var origin by remember { mutableStateOf(Offset.Zero) }
    val widthDp = with(density) { (data.weeks.size * col).toDp() }
    val heightDp = with(density) { (header + 7 * col).toDp() }

    LaunchedEffect(data.weeks.size) { scroll.scrollTo(scroll.maxValue) }

    Column {
        Row {
            Column(Modifier.width(28.dp).padding(top = 14.dp)) {
                listOf("Mon", "", "Wed", "", "Fri", "", "Sun").forEach {
                    Box(Modifier.height(14.dp), contentAlignment = Alignment.CenterStart) {
                        Text(it, fontSize = 9.sp, color = muted)
                    }
                }
            }
            Box(Modifier.weight(1f).horizontalScroll(scroll)) {
                Canvas(
                    Modifier
                        .width(widthDp)
                        .height(heightDp)
                        .onGloballyPositioned { origin = it.boundsInWindow().topLeft }
                        .pointerInput(data) {
                            detectTapGestures { p ->
                                val w = (p.x / col).toInt()
                                val r = ((p.y - header) / col).toInt()
                                if (w in data.weeks.indices && r in 0..6 && p.y >= header) {
                                    val day = data.dayAt(r, w)
                                    val minutes = data.grid[r][w]
                                    if (minutes > 0 || (onDayAction != null && !day.isAfter(today))) {
                                        selected = day to IntOffset((origin.x + w * col + cell / 2).toInt(), (origin.y + header + r * col).toInt())
                                    }
                                }
                            }
                        }
                ) {
                    var lastMonth = -1
                    var lastLabelEnd = -1f
                    data.weeks.forEachIndexed { wi, monday ->
                        if (monday.monthValue != lastMonth) {
                            val m = measurer.measure(Time.format(monday, "MMM"), TextStyle(fontSize = 9.sp, color = muted))
                            // Skip a label that would collide with the previous one (month change in the first column).
                            if (wi * col >= lastLabelEnd + 4f) {
                                drawText(m, topLeft = Offset(wi * col, 0f))
                                lastLabelEnd = wi * col + m.size.width
                            }
                            lastMonth = monday.monthValue
                        }
                        for (r in 0 until 7) {
                            val minutes = data.grid[r][wi]
                            val level = Accents.yearlyHeatLevel(minutes, data.workingSorted)
                            val color = if (level == 0) emptyColor else hexColor(Accents.YEARLY_HEAT_COLORS[level])
                            val day = monday.plusDays(r.toLong())
                            drawRoundRect(
                                color.copy(alpha = if (day.isAfter(today)) 0.45f else 1f),
                                Offset(wi * col, header + r * col), Size(cell, cell), CornerRadius(2.dp.toPx()),
                            )
                            if (selected?.first == day) {
                                drawRoundRect(
                                    T_FOCUS, Offset(wi * col - 1, header + r * col - 1), Size(cell + 2, cell + 2), CornerRadius(3.dp.toPx()),
                                    style = androidx.compose.ui.graphics.drawscope.Stroke(1.5.dp.toPx()),
                                )
                            }
                        }
                    }
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(top = 10.dp), horizontalArrangement = Arrangement.End, verticalAlignment = Alignment.CenterVertically) {
            Text("Less", fontSize = 10.sp, color = muted)
            Spacer(Modifier.width(6.dp))
            Accents.YEARLY_HEAT_COLORS.forEachIndexed { i, h ->
                Box(Modifier.padding(horizontal = 1.5.dp).size(10.dp).clip(RoundedCornerShape(2.dp)).background(if (i == 0) emptyColor else hexColor(h)))
            }
            Spacer(Modifier.width(6.dp))
            Text("More", fontSize = 10.sp, color = muted)
        }
    }

    selected?.let { (day, anchor) ->
        val w = data.weeks.indexOfFirst { !day.isBefore(it) && day.isBefore(it.plusDays(7)) }
        val r = (day.dayOfWeek.value - 1)
        val minutes = if (w >= 0) data.grid[r][w] else 0.0
        val byTask = (data.dayTaskMinutes[day] ?: emptyMap()).entries.sortedByDescending { it.value }
        TooltipPopup(anchor, onDismiss = { selected = null }) {
            Text(Time.format(day, "EEEE, MMMM d, yyyy"), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
            if (data.dayEarnings == null) {
                Text("Total for this calendar day", fontSize = 12.sp, color = T.c.mutedForeground)
            }
            Spacer(Modifier.height(8.dp))
            HorizontalDivider(color = T.c.border)
            Spacer(Modifier.height(8.dp))
            val totalLine = if (data.dayEarnings != null) {
                "${Format.heatMinutes(minutes)} · ${Format.money(data.dayEarnings[day] ?: 0.0, data.dayCurrency?.get(day) ?: "CZK")}"
            } else "${Format.heatMinutes(minutes)} total"
            Text(totalLine, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
            Spacer(Modifier.height(4.dp))
            byTask.forEach { (name, m) -> TooltipRow(hexColor(taskColors[name] ?: Accents.OTHER_COLOR), name, Format.heatMinutes(m)) }
            if (onDayAction != null) {
                Spacer(Modifier.height(10.dp))
                TButton(dayActionLabel, { selected = null; onDayAction(day) }, size = BtnSize.Sm, variant = BtnVariant.Outline, modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

private val T_FOCUS = androidx.compose.ui.graphics.Color(0xFF3B82F6)
