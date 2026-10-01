package co.bitterlemon.trackify.ui.team

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDefaults
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.SelectableDates
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.Presence
import co.bitterlemon.trackify.ui.components.Skeleton
import co.bitterlemon.trackify.ui.components.TCard
import co.bitterlemon.trackify.ui.theme.MonoDigits
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.ui.theme.hexColor
import co.bitterlemon.trackify.util.Accents
import co.bitterlemon.trackify.util.Format
import co.bitterlemon.trackify.util.Time
import kotlinx.coroutines.delay
import androidx.lifecycle.repeatOnLifecycle
import java.time.LocalDate
import java.time.ZoneOffset

/** Last presence per (day, range) so the card renders instantly and offline. */
object PresenceCache {
    val map = java.util.concurrent.ConcurrentHashMap<String, Presence>()
}

enum class LbRange(val key: String, val label: String, val noun: String) {
    Day("day", "Daily", "day"), Week("week", "Weekly", "week"), Month("month", "Monthly", "month")
}

object Period {
    fun isCurrent(range: LbRange, day: LocalDate, today: LocalDate = Time.today()) = when (range) {
        LbRange.Week -> Time.mondayOf(day) == Time.mondayOf(today)
        LbRange.Month -> day.year == today.year && day.month == today.month
        LbRange.Day -> day == today
    }

    /** [start, endInclusive] local ms. */
    fun bounds(range: LbRange, day: LocalDate): Pair<Long, Long> = when (range) {
        LbRange.Week -> Time.startOfDay(Time.mondayOf(day)) to Time.endOfDay(Time.sundayOf(day))
        LbRange.Month -> Time.startOfDay(day.withDayOfMonth(1)) to Time.endOfDay(day.withDayOfMonth(day.lengthOfMonth()))
        LbRange.Day -> Time.startOfDay(day) to Time.endOfDay(day)
    }

    fun step(range: LbRange, day: LocalDate, dir: Int): LocalDate = when (range) {
        LbRange.Week -> day.plusDays(7L * dir)
        LbRange.Month -> day.plusMonths(dir.toLong())
        LbRange.Day -> day.plusDays(dir.toLong())
    }

    fun label(range: LbRange, day: LocalDate, current: Boolean): String = when (range) {
        LbRange.Week -> if (current) "This week" else {
            val s = Time.mondayOf(day); val e = Time.sundayOf(day)
            if (s.month == e.month) "${Time.format(s, "d")}–${Time.format(e, "d MMM")}" else "${Time.format(s, "d MMM")} – ${Time.format(e, "d MMM")}"
        }
        LbRange.Month -> if (current) "This month" else Time.format(day, "MMM yyyy")
        LbRange.Day -> if (current) "Today" else Time.format(day, "EEE d MMM")
    }
}

/** A clock that ticks only while the screen is visible (no work in the background). */
@Composable
fun rememberTicker(active: Boolean, periodMs: Long = 1000): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    val owner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    LaunchedEffect(active, owner, periodMs) {
        now = System.currentTimeMillis()
        if (!active) return@LaunchedEffect
        owner.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
            while (true) {
                now = System.currentTimeMillis(); delay(periodMs - (System.currentTimeMillis() % periodMs).coerceAtMost(periodMs - 1))
            }
        }
    }
    return now
}

/** Leaderboard card (web `DailyLeaderboard`) with Daily/Weekly/Monthly, prev/next and a date picker. */
@Composable
fun LeaderboardCard(modifier: Modifier = Modifier) {
    val graph = AppGraph.get(LocalContext.current)
    var dayKey by rememberSaveable { mutableStateOf(Time.today().toString()) }
    var rangeKey by rememberSaveable { mutableStateOf(LbRange.Day.name) }
    val day = LocalDate.parse(dayKey)
    val range = LbRange.valueOf(rangeKey)
    val today = Time.today()
    val current = Period.isCurrent(range, day, today)
    val cacheKey = "$dayKey|$rangeKey"
    var data by remember(dayKey, rangeKey) { mutableStateOf(PresenceCache.map[cacheKey]) }
    var loading by remember(dayKey, rangeKey) { mutableStateOf(data == null) }
    var reloadTick by remember { mutableStateOf(0) }
    val stats by graph.repo.stats.collectAsState()
    val timer by graph.engine.ui.collectAsState()
    val session by graph.session.session.collectAsState()
    val myId = graph.repo.profile.collectAsState().value?.id ?: session?.userId
    var picker by remember { mutableStateOf(false) }

    val owner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    LaunchedEffect(dayKey, rangeKey, reloadTick) {
        // Poll every 15 s for the current period, only while visible.
        owner.repeatOnLifecycle(androidx.lifecycle.Lifecycle.State.STARTED) {
            while (true) {
                runCatching { graph.api.presence(dayKey, range.key) }.onSuccess { data = it; PresenceCache.map[cacheKey] = it }
                loading = false
                if (!current) break
                delay(15_000)
            }
        }
    }
    LaunchedEffect(Unit) { graph.repo.presenceSignal.collect { reloadTick++ } }
    LifecycleResumeEffect(Unit) {
        reloadTick++
        onPauseOrDispose { }
    }

    val rows = (data?.leaderboard ?: emptyList()).filter { it.todayMs > 0 || (current && it.startTime != null) }
    val anyoneLive = current && rows.any { it.startTime != null }
    val running = timer.running
    val now = rememberTicker(current && (anyoneLive || running != null))
    val (bStart, bEnd) = Period.bounds(range, day)
    val liveAll = if (current && running != null) maxOf(0L, now - running.startTime) else 0L
    val liveYou = if (current && running != null) Time.liveRangeMs(running.startTime, now, bStart, bEnd) else 0L
    val yourRow = rows.firstOrNull { it.userId == myId }
    val yourTotal = if (range == LbRange.Day && current) (stats?.todayTotal ?: 0L) + liveYou else (yourRow?.todayMs ?: 0L) + liveYou
    val allTime = (stats?.grandTotal ?: 0L) + liveAll

    fun pick(d: LocalDate) {
        dayKey = (if (d.isAfter(today)) today else d).toString()
    }

    // iOS card: title + subtitle, ‹ [calendar | Daily Weekly Monthly] ›, the ranked rows, then Your today / All time.
    Column(modifier.fillMaxWidth().clip(co.bitterlemon.trackify.ui.components.CardShape).background(T.c.cell).padding(vertical = 16.dp)) {
        Column(Modifier.padding(horizontal = 16.dp)) {
            Text(
                when (range) {
                    LbRange.Day -> if (current) "Today\u2019s leaderboard" else "Leaderboard"
                    LbRange.Week -> if (current) "This week\u2019s leaderboard" else "Leaderboard"
                    LbRange.Month -> if (current) "This month\u2019s leaderboard" else "Leaderboard"
                },
                fontSize = 20.sp, fontWeight = FontWeight.Bold, color = T.c.foreground,
            )
            Text(
                if (current) "Who\u2019s grinding the most ${range.noun.let { if (it == "day") "today" else "this $it" }}" else Period.label(range, day, current),
                fontSize = 15.sp, color = T.c.mutedForeground,
            )
        }
        co.bitterlemon.trackify.ui.components.CappedFontScale(1.15f) {
            Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton(onClick = { pick(Period.step(range, day, -1)) }) {
                    Icon(Icons.AutoMirrored.Outlined.KeyboardArrowLeft, "Previous ${range.noun}", tint = T.c.foreground)
                }
                IconButton(onClick = { picker = true }) {
                    Icon(Icons.Outlined.CalendarToday, "Pick a date", tint = T.c.foreground, modifier = Modifier.size(20.dp))
                }
                co.bitterlemon.trackify.ui.components.Segmented(
                    // Narrow phones: the short labels, so no segment gets cut off.
                    LbRange.entries.map {
                        val short = androidx.compose.ui.platform.LocalConfiguration.current.screenWidthDp < 400
                        it to when (it) {
                            LbRange.Day -> if (short) "Day" else "Daily"
                            LbRange.Week -> if (short) "Week" else "Weekly"
                            LbRange.Month -> if (short) "Month" else "Monthly"
                        }
                    },
                    range, { rangeKey = it.name }, Modifier.weight(1f), compact = true,
                )
                IconButton(onClick = { pick(Period.step(range, day, 1)) }, enabled = !current) {
                    Icon(
                        Icons.AutoMirrored.Outlined.KeyboardArrowRight, "Next ${range.noun}",
                        tint = if (current) T.c.mutedForeground.copy(alpha = 0.4f) else T.c.foreground,
                    )
                }
            }
        }
        if (loading && data == null) {
            Column(Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                repeat(3) { Skeleton(Modifier.fillMaxWidth().height(24.dp)) }
            }
        } else if (rows.isEmpty()) {
            Text("Nobody logged time that ${range.noun}.", fontSize = 15.sp, color = T.c.mutedForeground, modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp))
        } else {
            rows.forEachIndexed { index, row ->
                val isLive = current && row.startTime != null
                val live = if (isLive) Time.liveRangeMs(row.startTime!!, now, bStart, bEnd) else 0L
                val sessionMs = if (isLive) maxOf(0L, now - row.startTime!!) else 0L
                val isYou = row.userId == myId
                Row(
                    Modifier.padding(horizontal = 16.dp, vertical = 2.dp).fillMaxWidth().heightIn(min = 46.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .background(if (isYou) T.c.fill else Color.Transparent)
                        .padding(horizontal = 14.dp, vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val rc = Accents.rankColor(index + 1)
                    Text(
                        "${index + 1}", modifier = Modifier.width(30.dp), fontSize = 17.sp, fontWeight = FontWeight.SemiBold,
                        color = rc?.let { hexColor(it) } ?: T.c.mutedForeground, style = co.bitterlemon.trackify.ui.theme.Tabular,
                    )
                    Column(Modifier.weight(1f)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                row.name + if (isYou) " \u00b7 you" else "", fontSize = 17.sp,
                                color = T.c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
                            )
                            if (isLive) {
                                Spacer(Modifier.width(8.dp)); LivePing()
                            }
                        }
                        if (isLive && row.taskName != null) {
                            Text(
                                row.taskName + if (sessionMs > 0) " · ${Format.durationWords(sessionMs)}" else "",
                                fontSize = 13.sp,
                                color = if (T.c.dark) Color(0xFF34D399) else Color(0xFF047857), maxLines = 1, overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                    Spacer(Modifier.width(8.dp))
                    Text(Format.durationWords(row.todayMs + live), fontSize = 17.sp, fontWeight = FontWeight.Medium, color = T.c.foreground, style = co.bitterlemon.trackify.ui.theme.Tabular)
                }
            }
        }
        HorizontalDivider(Modifier.padding(horizontal = 16.dp, vertical = 12.dp), thickness = 0.8.dp, color = T.c.separator)
        Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp), verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                Text(
                    when (range) {
                        LbRange.Week -> if (current) "Your week" else "You that week"
                        LbRange.Month -> if (current) "Your month" else "You that month"
                        LbRange.Day -> if (current) "Your today" else "You that day"
                    }, fontSize = 15.sp, color = T.c.mutedForeground,
                )
                Text(Format.durationWords(yourTotal), fontSize = 26.sp, fontWeight = FontWeight.Bold, color = T.c.foreground, style = co.bitterlemon.trackify.ui.theme.Tabular)
            }
            Column(horizontalAlignment = Alignment.End) {
                Text("All time", fontSize = 15.sp, color = T.c.mutedForeground)
                Text(if (stats == null) "—" else Format.durationWords(allTime), fontSize = 26.sp, fontWeight = FontWeight.Bold, color = T.c.foreground, style = co.bitterlemon.trackify.ui.theme.Tabular)
            }
        }
    }

    if (picker) {
        LocalDatePickerDialog(day, onDismiss = { picker = false }) { pick(it); picker = false }
    }
}

@Composable
fun LivePing() {
    val t = rememberInfiniteTransition(label = "ping")
    val s by t.animateFloat(1f, 2.2f, infiniteRepeatable(tween(1000), RepeatMode.Restart), label = "s")
    val a by t.animateFloat(0.7f, 0f, infiniteRepeatable(tween(1000), RepeatMode.Restart), label = "a")
    Box(Modifier.size(8.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.size(8.dp).scale(s).clip(CircleShape).background(Color(0xFF34D399).copy(alpha = a)))
        Box(Modifier.size(8.dp).clip(CircleShape).background(T.c.emerald))
    }
}

/** Material date picker limited to 2018…today (local dates). */
@Composable
fun LocalDatePickerDialog(initial: LocalDate, onDismiss: () -> Unit, maxDate: LocalDate? = Time.today(), minDate: LocalDate? = LocalDate.of(2018, 1, 1), onPick: (LocalDate) -> Unit) {
    val utcMillis = initial.atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli()
    val state = rememberDatePickerState(
        initialSelectedDateMillis = utcMillis,
        yearRange = (minDate?.year ?: 2018)..(maxDate?.year ?: (Time.today().year + 5)),
        selectableDates = object : SelectableDates {
            override fun isSelectableDate(utcTimeMillis: Long): Boolean {
                val d = java.time.Instant.ofEpochMilli(utcTimeMillis).atZone(ZoneOffset.UTC).toLocalDate()
                return (maxDate == null || !d.isAfter(maxDate)) && (minDate == null || !d.isBefore(minDate))
            }
        },
    )
    DatePickerDialog(
        onDismissRequest = onDismiss,
        confirmButton = {
            TextButton(onClick = {
                state.selectedDateMillis?.let { onPick(java.time.Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate()) } ?: onDismiss()
            }) { Text("OK") }
        },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    ) {
        DatePicker(
            state, showModeToggle = false,
        )
    }
}
