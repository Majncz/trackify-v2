package co.bitterlemon.trackify.ui.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.AppJson
import co.bitterlemon.trackify.data.Task
import co.bitterlemon.trackify.data.isSkipped
import co.bitterlemon.trackify.timer.AdjustResult
import co.bitterlemon.trackify.ui.auth.friendlyError
import co.bitterlemon.trackify.ui.components.BtnVariant
import co.bitterlemon.trackify.ui.components.TButton
import co.bitterlemon.trackify.ui.components.TDialog
import co.bitterlemon.trackify.ui.theme.MonoDigits
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.util.Format
import co.bitterlemon.trackify.util.MAX_LOOKBACK
import co.bitterlemon.trackify.util.MINUTE
import co.bitterlemon.trackify.util.SessionRange
import co.bitterlemon.trackify.util.Span
import co.bitterlemon.trackify.util.Time
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.abs
import kotlin.math.max

fun busySpans(tasks: List<Task>): List<Span> = tasks.flatMap { t -> t.events.map { Span(it.fromMs, it.toMs, "${t.name}: ${it.name}") } }

@Composable
private fun rememberClock(active: Boolean = true): Long {
    var now by remember { mutableLongStateOf(System.currentTimeMillis()) }
    LaunchedEffect(active) {
        while (active) {
            now = System.currentTimeMillis(); delay(1000)
        }
    }
    return now
}

/** "Fix this session" (web adjust-timer-dialog): move the start, or stop in the past. */
@Composable
fun FixSessionDialog(currentStart: Long, tasks: List<Task>, onDismiss: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    val openedAt = remember { System.currentTimeMillis() }
    val clockNow = rememberClock()
    var viewFrom by remember { mutableLongStateOf(SessionRange.initialViewFrom(currentStart, openedAt)) }
    var startTime by remember { mutableLongStateOf(currentStart) }
    var endTime by remember { mutableStateOf<Long?>(null) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val busy = remember(tasks) { busySpans(tasks) }
    val viewTo = openedAt
    val earliest = openedAt - MAX_LOOKBACK
    val stillRunning = endTime == null
    val sliderEnd = endTime ?: viewTo
    val durationMs = max(0L, (if (stillRunning) clockNow else sliderEnd) - startTime)

    fun save() {
        val startMoved = abs(startTime - currentStart) >= 500
        val newStart = if (startMoved) Time.snapMinute(startTime) else startTime
        val end = endTime
        if (end != null) {
            val stopAt = minOf(Time.snapMinute(end), System.currentTimeMillis())
            if (stopAt <= newStart) {
                error = "Stop time must be after the start"; return
            }
            graph.engine.stopAt(stopAt, if (startMoved) newStart else null)
            onDismiss()
            return
        }
        if (!startMoved) {
            onDismiss(); return
        }
        saving = true
        error = null
        scope.launch {
            when (val r = graph.engine.adjustStart(newStart)) {
                AdjustResult.Ok -> onDismiss()
                is AdjustResult.Error -> {
                    error = r.message; startTime = currentStart
                }
            }
            saving = false
        }
    }

    TDialog(
        title = "Fix this session",
        onDismiss = onDismiss,
        scrollable = false,
        footer = {
            TButton("Cancel", onDismiss, variant = BtnVariant.Outline, enabled = !saving)
            TButton(
                if (saving) "Saving…" else if (stillRunning) "Save start time" else "Stop ${Format.agoLabel(sliderEnd, clockNow)}",
                { save() }, enabled = !saving,
            )
        },
    ) {
        DurationHeader(
            Format.durationWords(durationMs),
            if (stillRunning) "Started ${Time.clock(startTime)} · still running" else "Started ${Time.clock(startTime)} · stopped ${Time.clock(sliderEnd)}",
        )
        Spacer(Modifier.height(16.dp))
        SessionRangeSlider(
            startTime = startTime,
            endTime = sliderEnd,
            endIsLive = stillRunning,
            allowLiveEnd = true,
            busy = busy,
            viewFrom = viewFrom,
            viewTo = viewTo,
            earliest = earliest,
            enabled = !saving,
            onViewFrom = { viewFrom = it },
            onStartTime = { startTime = it; error = null },
            onEndTime = { endTime = it; error = null },
        )
        Spacer(Modifier.height(16.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            SessionStampField("Started", startTime, earliest, sliderEnd - MINUTE, clockNow, { next ->
                val clamped = SessionRange.clampTypedStart(next, sliderEnd, busy, earliest)
                startTime = clamped
                if (clamped < viewFrom) viewFrom = clamped
            })
            SessionStampField(if (stillRunning) "Until · now" else "Until", sliderEnd, startTime + MINUTE, openedAt, clockNow, { next ->
                endTime = SessionRange.clampTypedEnd(next, startTime, busy, openedAt)
            }, alignEnd = true)
        }
        error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = T.c.destructive, fontSize = 14.sp)
        }
    }
}

@Composable
private fun DurationHeader(big: String, caption: String) {
    Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(big, style = MonoDigits, fontSize = 36.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, textAlign = TextAlign.Center)
        Spacer(Modifier.height(4.dp))
        Text(caption, fontSize = 14.sp, color = T.c.mutedForeground, textAlign = TextAlign.Center)
    }
}

/** "Add time to {task}" (web log-past-dialog). */
@Composable
fun LogPastDialog(task: Task, tasks: List<Task>, runningStart: Long?, runningTaskId: String?, onDismiss: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    val openedAt = remember { System.currentTimeMillis() }
    val clockNow = rememberClock()
    val earliest = openedAt - MAX_LOOKBACK
    val busy = remember(tasks) {
        busySpans(tasks) + (runningStart?.let {
            listOf(Span(it, openedAt, if (runningTaskId == task.id) "This timer" else "Running timer"))
        } ?: emptyList())
    }
    val initial = remember {
        val preferred = SessionRange.typicalDurationMs(task.events.map { it.fromMs to it.toMs })
        SessionRange.suggestPastRange(openedAt, tasks.flatMap { t -> t.events.map { it.fromMs to it.toMs } }, runningStart, preferred)
    }
    val initialView = remember { SessionRange.viewAround(initial.first, initial.second, earliest, openedAt) }
    var startTime by remember { mutableLongStateOf(initial.first) }
    var endTime by remember { mutableLongStateOf(initial.second) }
    var viewFrom by remember { mutableLongStateOf(initialView.first) }
    var viewTo by remember { mutableLongStateOf(initialView.second) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val durationMs = max(0L, endTime - startTime)
    val endedJustNow = openedAt - endTime < 90_000

    fun applyRange(s: Long, e: Long) {
        startTime = s; endTime = e
        val w = SessionRange.viewAround(s, e, earliest, openedAt)
        viewFrom = w.first; viewTo = w.second
    }

    fun jumpTo(anchor: Long, asEnd: Boolean) {
        SessionRange.relocateToTime(anchor, max(MINUTE, endTime - startTime), asEnd, earliest, openedAt, busy)?.let { applyRange(it.first, it.second) }
    }

    fun save() {
        saving = true
        error = null
        scope.launch {
            try {
                val text = graph.api.createEvent(task.id, Time.snapMinute(startTime), Time.snapMinute(endTime), "Time entry", "manual")
                runCatching { AppJson.parseToJsonElement(text).isSkipped() }
                graph.repo.requestRefresh(0)
                onDismiss()
            } catch (e: Exception) {
                error = friendlyError(e, "Could not add that time")
            }
            saving = false
        }
    }

    TDialog(
        title = "Add time to ${task.name}",
        onDismiss = onDismiss,
        scrollable = false,
        footer = {
            TButton("Cancel", onDismiss, variant = BtnVariant.Outline, enabled = !saving)
            TButton(if (saving) "Adding…" else "Add ${Format.durationWords(durationMs)}", { save() }, enabled = !saving)
        },
    ) {
        DurationHeader(
            Format.durationWords(durationMs),
            "${Time.clock(startTime)} → ${if (endedJustNow) "just now" else Time.clock(endTime)}",
        )
        Spacer(Modifier.height(16.dp))
        SessionRangeSlider(
            startTime = startTime,
            endTime = endTime,
            busy = busy,
            viewFrom = viewFrom,
            viewTo = viewTo,
            earliest = earliest,
            horizon = openedAt,
            placeInGaps = true,
            enabled = !saving,
            onViewFrom = { viewFrom = it },
            onViewTo = { viewTo = it },
            onStartTime = { startTime = it; error = null },
            onEndTime = { if (it != null) endTime = it; error = null },
        )
        Spacer(Modifier.height(16.dp))
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            SessionStampField("From", startTime, earliest, openedAt, clockNow, { jumpTo(it, false) })
            SessionStampField("Until", endTime, earliest, openedAt, clockNow, { jumpTo(it, true) }, alignEnd = true)
        }
        error?.let {
            Spacer(Modifier.height(12.dp))
            Text(it, color = T.c.destructive, fontSize = 14.sp)
        }
    }
}
