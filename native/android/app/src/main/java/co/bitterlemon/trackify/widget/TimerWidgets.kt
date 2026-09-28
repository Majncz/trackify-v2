package co.bitterlemon.trackify.widget

import android.content.Context
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalSize
import androidx.glance.action.Action
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.provideContent
import androidx.glance.layout.Alignment
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.R
import co.bitterlemon.trackify.util.Time
import kotlin.math.floor
import kotlin.math.min

/*
 * Timer widgets, after the Mac widgets: the running task with a colour dot and "Since 19:06" above a large live
 * clock with a soft red Stop pill; a thin divider; then quiet task rows (dot · name · today · ▶). Idle shows
 * "Not tracking" with today's total big and a Start list. Every size has its own layout (SizeMode.Exact):
 *   one row high and narrow (2×1) · one row, wide (4×1) · narrow and tall (2×2) · wide (4×2) · large (4×3 and up).
 * "Timer and tasks" adds the team's day under the tasks when it is tall enough.
 */

// ---------------------------------------------------------------------------------------------------------------
// Actions: optimistic. Change local state, redraw, return; an expedited job sends the op (AppGraph.afterExternalTap).

private val TaskKey = ActionParameters.Key<String>("taskId")

class StartTaskAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val id = parameters[TaskKey] ?: return
        val g = AppGraph.get(context)
        if (g.session.session.value == null) return
        g.engine.start(id)
        g.afterExternalTap()
    }
}

class StopAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val g = AppGraph.get(context)
        if (g.session.session.value == null) return
        g.engine.stop()
        g.afterExternalTap()
    }
}

internal fun startAction(id: String): Action = actionRunCallback<StartTaskAction>(actionParametersOf(TaskKey to id))
internal fun stopAction(): Action = actionRunCallback<StopAction>()

// ---------------------------------------------------------------------------------------------------------------
// Data helpers

private fun lastTask(snap: WidgetSnapshotData): SnapshotTask? =
    snap.tasks.firstOrNull { it.id == snap.lastTaskId } ?: snap.tasks.firstOrNull()

/** One-tap starts: the last task first, then the rest by recency, never the running one. */
private fun startable(snap: WidgetSnapshotData): List<SnapshotTask> {
    val last = lastTask(snap)
    return (listOfNotNull(last) + snap.tasks.filter { it.id != last?.id }).filter { it.id != snap.running?.taskId }
}

/** Today's time per task including the running stretch. */
private fun todayOf(t: SnapshotTask, snap: WidgetSnapshotData, now: Long): Long {
    val r = snap.running
    if (r == null || r.taskId != t.id) return t.todayMs
    val today = Time.today()
    return t.todayMs + Time.liveRangeMs(r.startTime, now, Time.startOfDay(today), Time.endOfDay(today))
}

@Composable
private fun SinceLine(snap: WidgetSnapshotData, r: SnapshotRunning, size: Int = 12) {
    val notice = snap.noticeNow(System.currentTimeMillis())
    if (notice != null) Txt("Couldn't sync: $notice", P.stopFg, size)
    else Txt("Since ${Time.clock(r.startTime)}", P.muted, size)
}

@Composable
private fun TaskTitle(r: SnapshotRunning, size: Int = 15, maxLines: Int = 1) {
    Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Dot(accent(r.accentHex), 8.dp)
        Spacer(GlanceModifier.width(8.dp))
        Txt(r.taskName, P.fg, size, FontWeight.Bold, maxLines = maxLines, modifier = GlanceModifier.defaultWeight())
    }
}

/**
 * A task row: colour dot · name · today's time (muted) · outlined ▶. The running row shows a filled red stop.
 * The whole row is the tap target.
 */
@Composable
private fun TaskRow(t: SnapshotTask, snap: WidgetSnapshotData, height: Int, showToday: Boolean, now: Long, compact: Boolean = false) {
    val running = snap.running?.taskId == t.id
    Row(
        GlanceModifier.fillMaxWidth().height(height.dp).clickable(if (running) stopAction() else startAction(t.id)),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Dot(accent(t.accentHex), 8.dp)
        Spacer(GlanceModifier.width(if (compact) 8.dp else 10.dp))
        Txt(t.name, P.fg, 14, if (running) FontWeight.Bold else FontWeight.Normal, modifier = GlanceModifier.defaultWeight())
        val today = todayOf(t, snap, now)
        if (showToday && today >= 60_000) {
            Spacer(GlanceModifier.width(8.dp))
            Txt(hm(today), P.muted, 13)
        }
        Spacer(GlanceModifier.width(if (compact) 6.dp else 10.dp))
        val icon = if (compact) 20.dp else 22.dp
        if (running) Image(ImageProvider(R.drawable.ic_w_stop_disc), "Stop ${t.name}", GlanceModifier.size(icon))
        else Image(ImageProvider(R.drawable.ic_w_play_ring), "Start ${t.name}", GlanceModifier.size(icon), colorFilter = ColorFilter.tint(P.muted))
    }
}

@Composable
internal fun Header(left: String, right: String?, modifier: GlanceModifier = GlanceModifier) {
    Row(modifier.fillMaxWidth().height(22.dp), verticalAlignment = Alignment.CenterVertically) {
        Txt(left, P.muted, 13, FontWeight.Medium, modifier = GlanceModifier.defaultWeight())
        if (right != null) Txt(right, P.muted, 13)
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Content by size

internal const val WIDE = 250 // dp: 3+ columns on phones
internal const val BAR = 130 // dp: below this the widget is one row high

@Composable
internal fun TimerContent(context: Context, snap: WidgetSnapshotData, team: TeamSnapshotData?, widgetId: String?) {
    if (widgetId != null) {
        val key = WidgetUpdater.renderKey(snap)
        SideEffect { WidgetUpdater.markRendered(widgetId, key) }
    }
    if (!snap.signedIn) return Message(context, "Not signed in", "Open Trackify to sign in")
    val size = LocalSize.current
    if (snap.running == null && startable(snap).isEmpty()) return Message(context, "No tasks yet", "Create one in Trackify")
    val w = size.width.value
    val h = size.height.value
    when {
        h < BAR && w < WIDE -> BarNarrow(context, snap)
        h < BAR -> BarWide(context, snap)
        w < WIDE -> Square(context, snap)
        h < 300 -> Medium(context, snap)
        else -> Large(context, snap, team)
    }
}

/** 2×1: task + clock and a round Stop; idle, the whole widget resumes the last task. */
@Composable
private fun BarNarrow(context: Context, snap: WidgetSnapshotData) {
    val r = snap.running
    if (r != null) {
        Card(padding = 14.dp) {
            Row(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                Column(GlanceModifier.defaultWeight().clickable(openApp(context))) {
                    TaskTitle(r, 13, maxLines = if (fontScale(context) > 1.15f) 1 else 2)
                    Clock(r.startTime, 26f)
                }
                Spacer(GlanceModifier.width(8.dp))
                RoundButton(R.drawable.ic_stop, "Stop", P.stopBg, P.stopFg, 42.dp, stopAction())
            }
        }
        return
    }
    val t = startable(snap).first()
    Card(GlanceModifier.clickable(startAction(t.id)), padding = 14.dp) {
        Row(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            Column(GlanceModifier.defaultWeight()) {
                Txt("Not tracking", P.muted, 12, FontWeight.Medium)
                Row(verticalAlignment = Alignment.Top) {
                    Column(GlanceModifier.height(19.dp), verticalAlignment = Alignment.CenterVertically) { Dot(accent(t.accentHex), 8.dp) }
                    Spacer(GlanceModifier.width(8.dp))
                    Txt(t.name, P.fg, 14, FontWeight.Medium, maxLines = if (fontScale(context) > 1.15f) 1 else 2)
                }
            }
            Spacer(GlanceModifier.width(8.dp))
            RoundButton(R.drawable.ic_play, "Start ${t.name}", P.soft, P.fg, 42.dp, null)
        }
    }
}

/** 4×1: task, since, clock and the Stop pill in one line; idle, today's total and two starts. */
@Composable
private fun BarWide(context: Context, snap: WidgetSnapshotData) {
    val r = snap.running
    val now = System.currentTimeMillis()
    val h = LocalSize.current.height.value
    Card(padding = 14.dp) {
        if (r != null) {
            Row(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                Column(GlanceModifier.defaultWeight().clickable(openApp(context))) {
                    TaskTitle(r, 14)
                    SinceLine(snap, r)
                }
                Spacer(GlanceModifier.width(10.dp))
                Clock(r.startTime, 30f, GlanceModifier.clickable(openApp(context)))
                Spacer(GlanceModifier.width(12.dp))
                StopPill(stopAction())
            }
        } else {
            val rows = floor((h - 28) / 34f).toInt().coerceIn(1, 2)
            Row(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                Column(GlanceModifier.width(112.dp).clickable(openApp(context))) {
                    Txt("Not tracking", P.muted, 12, FontWeight.Medium)
                    Txt(hm(snap.todayTotalLive(now)), P.fg, 24, FontWeight.Medium)
                }
                Spacer(GlanceModifier.width(8.dp))
                Column(GlanceModifier.defaultWeight(), verticalAlignment = Alignment.CenterVertically) {
                    startable(snap).take(rows).forEach { TaskRow(it, snap, 34, showToday = false, now, compact = true) }
                }
            }
        }
    }
}

/** 2×2 (Mac small): task + since at the top, the clock and a full-width Stop at the bottom. */
@Composable
private fun Square(context: Context, snap: WidgetSnapshotData) {
    val r = snap.running
    val now = System.currentTimeMillis()
    val h = LocalSize.current.height.value
    val fs = fontScale(context)
    Card(padding = 14.dp) {
        Column(GlanceModifier.fillMaxSize()) {
            if (r != null) {
                // (No weighted spacer inside a clickable column: RemoteViews ignores it there.)
                Column(GlanceModifier.fillMaxWidth().clickable(openApp(context))) {
                    TaskTitle(r, 15, maxLines = 2)
                    SinceLine(snap, r)
                }
                Spacer(GlanceModifier.defaultWeight())
                Clock(r.startTime, 34f, GlanceModifier.clickable(openApp(context)))
                Spacer(GlanceModifier.height(8.dp))
                StopPill(stopAction(), GlanceModifier.fillMaxWidth())
            } else {
                Column(GlanceModifier.fillMaxWidth().clickable(openApp(context))) {
                    Txt("Not tracking", P.muted, 12, FontWeight.Medium)
                    Txt(hm(snap.todayTotalLive(now)), P.fg, 26, FontWeight.Medium)
                }
                val top = (17 + 34) * fs + 8
                val rows = floor((h - 28 - top) / 32f).toInt().coerceIn(1, 3)
                Spacer(GlanceModifier.defaultWeight())
                startable(snap).take(rows).forEach { TaskRow(it, snap, 32, showToday = false, now, compact = true) }
            }
        }
    }
}

/** 4×2 (Mac medium): the timer on the left, "Switch to" / "Start" rows on the right. */
@Composable
private fun Medium(context: Context, snap: WidgetSnapshotData) {
    val r = snap.running
    val now = System.currentTimeMillis()
    val h = LocalSize.current.height.value
    val rows = floor((h - 32 - 26) / 34f).toInt().coerceIn(1, 5)
    val list = startable(snap)
    // The timer column needs ~130 dp (clock + pill); the task list gets the rest, so names rarely truncate.
    val left = ((LocalSize.current.width.value - 48) * 0.42f).coerceIn(124f, 170f)
    Card {
        Row(GlanceModifier.fillMaxSize()) {
            Column(GlanceModifier.width(left.dp).fillMaxHeight()) {
                if (r != null) {
                    Column(GlanceModifier.fillMaxWidth().clickable(openApp(context))) {
                        TaskTitle(r, 15)
                        SinceLine(snap, r)
                    }
                    Spacer(GlanceModifier.defaultWeight())
                    Clock(r.startTime, 36f, GlanceModifier.clickable(openApp(context)))
                    Spacer(GlanceModifier.height(8.dp))
                    StopPill(stopAction(), GlanceModifier.fillMaxWidth())
                } else {
                    val last = lastTask(snap)
                    Column(GlanceModifier.fillMaxWidth().clickable(openApp(context))) {
                        Txt("Not tracking", P.muted, 13, FontWeight.Medium)
                        Txt(hm(snap.todayTotalLive(now)), P.fg, 30, FontWeight.Medium)
                    }
                    Spacer(GlanceModifier.defaultWeight())
                    if (last != null) Txt("Last: ${last.name}", P.muted, 12, modifier = GlanceModifier.clickable(startAction(last.id)))
                }
            }
            Spacer(GlanceModifier.width(16.dp))
            Column(GlanceModifier.defaultWeight().fillMaxHeight()) {
                Header(if (r != null) "Switch to" else "Start", null)
                Spacer(GlanceModifier.height(4.dp))
                list.take(rows).forEach { TaskRow(it, snap, 34, showToday = false, now, compact = true) }
            }
        }
    }
}

/** 4×3 and up (Mac large): timer, divider, "Tasks · Today" rows; plus the team's day on "Timer and tasks". */
@Composable
private fun Large(context: Context, snap: WidgetSnapshotData, team: TeamSnapshotData?) {
    val r = snap.running
    val now = System.currentTimeMillis()
    val h = LocalSize.current.height.value
    val fs = fontScale(context)
    val taskRowH = if (fs > 1.15f) 40 else 36
    val teamRowH = if (fs > 1.15f) 46 else 42
    val heroH = if (r != null) (22 + 17) * fs + 52 else (18 + 42) * fs
    val headerH = 22 + 4
    var avail = h - 32 - heroH - 21 - headerH
    // Team section: up to 4 members, but never at the cost of the first 3 task rows.
    val members = team?.rows(now) ?: emptyList()
    var teamRows = 0
    if (team != null && team.loaded) {
        var k = min(4, maxOf(1, members.size))
        while (k > 0 && avail - (21 + headerH + k * teamRowH) < 3 * taskRowH) k--
        teamRows = k
        if (k > 0) avail -= 21 + headerH + k * teamRowH
    }
    val tasks = snap.tasks
    val taskRows = min(tasks.size, floor(avail / taskRowH).toInt().coerceAtLeast(1))
    Card(padding = 16.dp) {
        Column(GlanceModifier.fillMaxSize()) {
            if (r != null) {
                Column(GlanceModifier.fillMaxWidth().clickable(openApp(context))) {
                    TaskTitle(r, 16)
                    SinceLine(snap, r, 13)
                }
                Row(GlanceModifier.fillMaxWidth().height(52.dp), verticalAlignment = Alignment.CenterVertically) {
                    Clock(r.startTime, 42f, GlanceModifier.defaultWeight().clickable(openApp(context)))
                    StopPill(stopAction(), height = 38.dp)
                }
            } else {
                Column(GlanceModifier.fillMaxWidth().clickable(openApp(context))) {
                    Txt("Not tracking", P.muted, 13, FontWeight.Medium)
                    Txt(hm(snap.todayTotalLive(now)), P.fg, 32, FontWeight.Medium)
                }
            }
            Divider()
            // Running: "Tasks · Today 3h 59m" (Mac). Idle, the total is already the big number above.
            Header(if (r != null) "Tasks" else "Start", if (r != null) "Today ${hm(snap.todayTotalLive(now))}" else null)
            Spacer(GlanceModifier.height(4.dp))
            // Glance allows at most 10 children per Column: keep the rows in their own.
            Column(GlanceModifier.fillMaxWidth()) {
                tasks.take(min(taskRows, 10)).forEach { TaskRow(it, snap, taskRowH, showToday = true, now) }
            }
            if (team != null && teamRows > 0) {
                Divider()
                TeamSection(context, team, members, teamRows, teamRowH, now)
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Widgets

class SmallTimerWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact
    override val previewSizeMode = SizeMode.Responsive(setOf(DpSize(170.dp, 190.dp)))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val flow = WidgetSnapshot.flow(context)
        val wid = id.toString()
        provideContent {
            val snap by flow.collectAsState()
            val data = snap ?: WidgetSnapshot.read(context)
            Themed(context, data.theme) { TimerContent(context, data, null, wid) }
        }
    }

    override suspend fun providePreview(context: Context, widgetCategory: Int) {
        provideContent { Themed(context, "system") { TimerContent(context, PreviewData.running, null, null) } }
    }
}

class SmallTimerWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SmallTimerWidget()
}

class LargeTimerWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact
    override val previewSizeMode = SizeMode.Responsive(setOf(DpSize(320.dp, 440.dp)))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val flow = WidgetSnapshot.flow(context)
        val teamFlow = TeamSnapshot.flow(context)
        val wid = id.toString()
        provideContent {
            val snap by flow.collectAsState()
            val team by teamFlow.collectAsState()
            val data = snap ?: WidgetSnapshot.read(context)
            Themed(context, data.theme) { TimerContent(context, data, team ?: TeamSnapshotData(), wid) }
        }
    }

    override suspend fun providePreview(context: Context, widgetCategory: Int) {
        provideContent { Themed(context, "system") { TimerContent(context, PreviewData.running, PreviewData.team, null) } }
    }
}

class LargeTimerWidgetReceiver : TeamAwareReceiver() {
    override val glanceAppWidget: GlanceAppWidget = LargeTimerWidget()
}

// ---------------------------------------------------------------------------------------------------------------
// Picker previews (Android 15+ generated previews)

internal object PreviewData {
    private val tasks = listOf(
        SnapshotTask("p1", "Learning Swift", "#334155", 47 * 60_000L, 0),
        SnapshotTask("p2", "Code review", "#dc2626", 70 * 60_000L, 0),
        SnapshotTask("p3", "Bombay kitchen hub", "#ea580c", 45 * 60_000L, 0),
        SnapshotTask("p4", "Emails & admin", "#f59e0b", 30 * 60_000L, 0),
        SnapshotTask("p5", "Research: pricing", "#65a30d", 0, 0),
        SnapshotTask("p6", "Standup", "#0d9488", 15 * 60_000L, 0),
    )
    val running: WidgetSnapshotData
        get() = WidgetSnapshotData(
            signedIn = true,
            running = SnapshotRunning("p1", "Learning Swift", "#334155", System.currentTimeMillis() - 47 * 60_000L),
            tasks = tasks, lastTaskId = "p1", todayTotalMs = 3 * 3_600_000L + 12 * 60_000L, day = Time.today().toString(),
        )
    val team: TeamSnapshotData
        get() {
            val now = System.currentTimeMillis()
            return TeamSnapshotData(
                day = Time.today().toString(), fetchedAt = now, myId = "u1",
                members = listOf(
                    TeamMember("u1", "Taryk", 3 * 3_600_000L, now - 47 * 60_000L, "Learning Swift"),
                    TeamMember("u2", "Jakub", 4 * 3_600_000L + 20 * 60_000L, now - 12 * 60_000L, "Kitchen hub"),
                    TeamMember("u3", "Eva", 2 * 3_600_000L + 5 * 60_000L),
                ),
            )
        }
}

/** Publish the generated previews once per app version (the system rate-limits this call). */
object WidgetPreviews {
    suspend fun publish(context: Context) {
        if (Build.VERSION.SDK_INT < 35) return
        val prefs = context.getSharedPreferences("widget_previews", Context.MODE_PRIVATE)
        val version = co.bitterlemon.trackify.BuildConfig.VERSION_CODE
        if (prefs.getInt("version", 0) == version) return
        val m = androidx.glance.appwidget.GlanceAppWidgetManager(context)
        val ok = runCatching {
            listOf(SmallTimerWidgetReceiver::class, LargeTimerWidgetReceiver::class, TeamWidgetReceiver::class).all {
                m.setWidgetPreviews(it) == androidx.glance.appwidget.GlanceAppWidgetManager.SET_WIDGET_PREVIEWS_RESULT_SUCCESS
            }
        }.getOrDefault(false)
        if (ok) prefs.edit().putInt("version", version).apply()
    }
}
