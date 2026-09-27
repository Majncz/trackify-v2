package co.bitterlemon.trackify.ui.team

import androidx.compose.animation.core.CubicBezierEasing
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.Pause
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material3.Icon
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.zIndex
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.RaceData
import co.bitterlemon.trackify.ui.components.BtnVariant
import co.bitterlemon.trackify.ui.components.FieldButton
import co.bitterlemon.trackify.ui.components.ListRow
import co.bitterlemon.trackify.ui.components.RowDivider
import co.bitterlemon.trackify.ui.components.ScreenBar
import androidx.compose.material.icons.outlined.Leaderboard
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import co.bitterlemon.trackify.ui.components.Segmented
import co.bitterlemon.trackify.ui.components.Skeleton
import co.bitterlemon.trackify.ui.components.TButton
import co.bitterlemon.trackify.ui.components.TCard
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.ui.theme.Tabular
import co.bitterlemon.trackify.ui.theme.hexColor
import co.bitterlemon.trackify.util.Accents
import co.bitterlemon.trackify.util.Format
import co.bitterlemon.trackify.util.Race
import co.bitterlemon.trackify.util.Time
import java.time.LocalDate

private enum class RacePreset(val label: String) { PastWeek("Past week"), ThisWeek("This week"), ThisMonth("This month"), LastMonth("Last month"), Custom("Custom") }

private fun presetRange(p: RacePreset, cf: LocalDate, ct: LocalDate, today: LocalDate = Time.today()): Pair<LocalDate, LocalDate> = when (p) {
    RacePreset.ThisWeek -> Time.mondayOf(today) to today
    RacePreset.ThisMonth -> today.withDayOfMonth(1) to today
    RacePreset.LastMonth -> today.withDayOfMonth(1).minusMonths(1).let { it to it.withDayOfMonth(it.lengthOfMonth()) }
    RacePreset.Custom -> cf to ct
    RacePreset.PastWeek -> today.minusDays(6) to today
}

@Composable
fun TeamScreen(onOpenRace: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        ScreenBar("Team")
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            item(key = "lb") { LeaderboardCard(Modifier.widthIn(max = 720.dp)) }
            item(key = "race") {
                Column(Modifier.widthIn(max = 720.dp).fillMaxWidth()) {
                    RowDivider()
                    ListRow(
                        "Race", subtitle = "Play the hours back and watch the team race",
                        icon = Icons.Outlined.Leaderboard, onClick = onOpenRace,
                        trailing = { Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = T.c.mutedForeground) },
                    )
                    RowDivider()
                }
            }
        }
    }
}

/** Bar-race player, full screen (pushed from Team). */
@Composable
fun RaceScreen(onBack: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        ScreenBar("Race", onBack = onBack)
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            item(key = "race") { Box(Modifier.widthIn(max = 896.dp)) { Visualizations() } }
        }
    }
}

@Composable
private fun Visualizations() {
    val graph = AppGraph.get(LocalContext.current)
    val today = Time.today()
    var presetName by rememberSaveable { mutableStateOf(RacePreset.PastWeek.name) }
    val preset = RacePreset.valueOf(presetName)
    var customFrom by rememberSaveable { mutableStateOf(today.minusDays(6).toString()) }
    var customTo by rememberSaveable { mutableStateOf(today.toString()) }
    var durationMs by rememberSaveable { mutableStateOf(60_000L) }
    var playing by remember { mutableStateOf(false) }
    var playhead by remember { mutableFloatStateOf(0f) }
    val (from, to) = presetRange(preset, LocalDate.parse(customFrom), LocalDate.parse(customTo))
    var data by remember(from, to) { mutableStateOf<RaceData?>(null) }
    var error by remember(from, to) { mutableStateOf(false) }

    LaunchedEffect(from, to) {
        playhead = 0f; playing = false
        runCatching { graph.api.race(from.toString(), to.toString()) }
            .onSuccess { data = it.copy(events = Race.mergeIntervals(it.events)) }
            .onFailure { error = true }
    }
    LaunchedEffect(playing, durationMs) {
        if (!playing) return@LaunchedEffect
        var last = withFrameNanos { it }
        while (playing) {
            val now = withFrameNanos { it }
            val next = minOf(1f, playhead + ((now - last) / 1e6f) / durationMs)
            last = now
            playhead = next
            if (next >= 1f) {
                playing = false; break
            }
        }
    }
    val loading = data == null && !error

    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(Modifier.fillMaxWidth()) {
            Row(Modifier.horizontalScroll(androidx.compose.foundation.rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                RacePreset.entries.forEach { p ->
                    val sel = p == preset
                    Text(
                        p.label,
                        Modifier.clip(RoundedCornerShape(6.dp)).background(if (sel) T.c.primary else T.c.muted)
                            .clickable { presetName = p.name }.padding(horizontal = 10.dp, vertical = 7.dp),
                        fontSize = 12.sp, fontWeight = FontWeight.Medium, color = if (sel) T.c.onPrimary else T.c.mutedForeground,
                    )
                }
            }
            if (preset == RacePreset.Custom) {
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    var fromOpen by remember { mutableStateOf(false) }
                    var toOpen by remember { mutableStateOf(false) }
                    FieldButton("From  ${Time.format(LocalDate.parse(customFrom), "d MMM")}", Icons.Outlined.CalendarToday, { fromOpen = true }, Modifier.weight(1f))
                    Text("  to  ", fontSize = 12.sp, color = T.c.mutedForeground)
                    FieldButton("To  ${Time.format(LocalDate.parse(customTo), "d MMM")}", Icons.Outlined.CalendarToday, { toOpen = true }, Modifier.weight(1f))
                    if (fromOpen) LocalDatePickerDialog(LocalDate.parse(customFrom), { fromOpen = false }, maxDate = LocalDate.parse(customTo)) { customFrom = it.toString(); fromOpen = false }
                    if (toOpen) LocalDatePickerDialog(LocalDate.parse(customTo), { toOpen = false }, maxDate = today, minDate = LocalDate.parse(customFrom)) { customTo = it.toString(); toOpen = false }
                }
            }
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                TButton(
                    if (playing) "Pause" else if (playhead >= 1f) "Play again" else "Play",
                    {
                        if (playhead >= 1f) playhead = 0f
                        playing = !playing
                    },
                    icon = if (playing) Icons.Outlined.Pause else Icons.Outlined.PlayArrow, enabled = !loading && !error,
                )
                Spacer(Modifier.width(8.dp))
                TButton(null, { playhead = 0f; playing = true }, variant = BtnVariant.Outline, icon = Icons.Outlined.RestartAlt, contentDescription = "Restart", enabled = !loading && !error, modifier = Modifier.width(40.dp))
                Spacer(Modifier.width(10.dp))
                Text(
                    "${Format.playClock((playhead * durationMs).toLong())} / ${Format.playClock(durationMs)}",
                    fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground, style = Tabular,
                )
            }
            Spacer(Modifier.height(10.dp))
            Segmented(listOf(30_000L to "30s", 60_000L to "1 min", 120_000L to "2 min"), durationMs, { durationMs = it }, Modifier.width(220.dp), compact = true)
            Slider(
                value = playhead, onValueChange = { playhead = (Math.round(it * 1000) / 1000f); playing = false },
                enabled = !loading && !error,
                colors = SliderDefaults.colors(thumbColor = T.c.primary, activeTrackColor = T.c.primary, inactiveTrackColor = T.c.muted),
            )
        }
        when {
            loading -> Skeleton(Modifier.fillMaxWidth().height(448.dp))
            error || data == null -> Text("Couldn’t load the race. Try another range.", fontSize = 14.sp, color = T.c.mutedForeground)
            data!!.events.isEmpty() -> Text("Nobody logged time in this range.", fontSize = 14.sp, color = T.c.mutedForeground)
            else -> BarRace(data!!, playhead)
        }
    }
}

private val RaceEasing = CubicBezierEasing(0.22f, 1f, 0.36f, 1f)

@Composable
private fun BarRace(data: RaceData, playhead: Float) {
    val byUser = remember(data) { data.events.groupBy { it.userId } }
    val span = maxOf(1L, data.rangeEnd - data.rangeStart)
    val at = data.rangeStart + (span * playhead).toLong()
    val rows = remember(at, data) { Race.totalsAt(byUser, data.users, data.rangeStart, at) }
    val maxMs = maxOf(rows.firstOrNull()?.ms ?: 0L, 1L)
    val rowH = 64.dp
    val stage = if (T.c.dark) Color(0xFF161616) else Color(0xFFF7F7F5)
    val nameColor = if (T.c.dark) Color(0xFFE4E4E7) else Color(0xFF27272A)
    val zinc400 = Color(0xFFA1A1AA)
    val bigColor = if (T.c.dark) Color(0xFFE4E4E7) else Color(0xFF27272A)
    val trackColor = if (T.c.dark) Color(0x33FFFFFF) else Color(0x80E4E4E7)
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, T.c.border, RoundedCornerShape(12.dp)).background(stage)
            .padding(start = 12.dp, end = 12.dp, top = 20.dp, bottom = 16.dp),
    ) {
        Column {
            Text("HOURS WORKED", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 2.2.sp, color = zinc400)
            Spacer(Modifier.height(16.dp))
            androidx.compose.foundation.layout.BoxWithConstraints(Modifier.fillMaxWidth().height(rowH * maxOf(rows.size, 1))) {
                val nameW = if (maxWidth >= 520.dp) 160.dp else 76.dp
                val order = rows.withIndex().associate { it.value.id to it.index }
                data.users.forEach { u ->
                    val index = order[u.id] ?: 0
                    val row = rows[index]
                    val y by animateDpAsState(rowH * index, tween(700, easing = RaceEasing), label = "y-${u.id}")
                    val color = hexColor(row.color)
                    Row(
                        Modifier.offset(y = y).height(rowH).fillMaxWidth().zIndex((rows.size - index).toFloat()),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(
                            "${index + 1}", Modifier.width(20.dp), fontSize = 14.sp, fontWeight = FontWeight.Bold, style = Tabular,
                            color = Accents.rankColor(index + 1)?.let { hexColor(it) } ?: zinc400, textAlign = androidx.compose.ui.text.style.TextAlign.End,
                        )
                        Spacer(Modifier.width(8.dp))
                        Text(row.name, Modifier.width(nameW), fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = nameColor, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Spacer(Modifier.width(8.dp))
                        BoxWithConstraints(Modifier.weight(1f).height(40.dp)) {
                            val w = maxWidth
                            // Web: max(3%, ms/max × 78%) of the lane; on phones we reserve room for the label instead.
                            val frac = if (row.ms <= 0) 0f else maxOf(0.03f, row.ms.toFloat() / maxMs)
                            Box(Modifier.padding(end = 72.dp).fillMaxWidth().fillMaxHeight().padding(vertical = 10.dp).clip(RoundedCornerShape(2.dp)).background(trackColor))
                            val barW = (w - 100.dp) * frac
                            if (row.ms > 0) {
                                Box(
                                    Modifier.width(barW).fillMaxHeight().padding(vertical = 10.dp)
                                        .shadow(6.dp, RoundedCornerShape(2.dp), ambientColor = color, spotColor = color)
                                        .clip(RoundedCornerShape(2.dp)).background(color),
                                )
                                Box(
                                    Modifier.offset(x = barW - 18.dp, y = 2.dp).size(36.dp).clip(RoundedCornerShape(6.dp)).background(Color.White).padding(3.dp)
                                        .clip(RoundedCornerShape(4.dp)).background(color),
                                    contentAlignment = Alignment.Center,
                                ) { Text(Accents.initials(row.name), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = Color.White) }
                            }
                            Text(
                                Format.raceDuration(row.ms),
                                Modifier.offset(x = barW + 26.dp).align(Alignment.CenterStart),
                                fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = bigColor, style = Tabular, maxLines = 1,
                            )
                        }
                    }
                }
            }
            Spacer(Modifier.height(16.dp))
            Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.End) {
                Text(Time.format(at, "EEEE"), fontSize = 14.sp, fontWeight = FontWeight.Medium, color = zinc400)
                Text(Time.format(at, "d MMM"), fontSize = 36.sp, fontWeight = FontWeight.Bold, color = bigColor, style = Tabular, lineHeight = 38.sp)
                Text(Time.format(at, "HH:mm"), fontSize = 20.sp, fontWeight = FontWeight.Medium, color = zinc400, style = Tabular)
                Spacer(Modifier.height(6.dp))
                Text("TRACKIFY", fontSize = 10.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 2.4.sp, color = zinc400)
            }
        }
    }
}
