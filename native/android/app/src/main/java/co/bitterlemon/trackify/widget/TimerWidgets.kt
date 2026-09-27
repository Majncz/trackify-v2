package co.bitterlemon.trackify.widget

import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import android.util.TypedValue
import android.widget.RemoteViews
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.Action
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.action.clickable
import androidx.glance.appwidget.AndroidRemoteViews
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.color.ColorProviders
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.material3.ColorProviders
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.MainActivity
import co.bitterlemon.trackify.R
import co.bitterlemon.trackify.ui.theme.BrandDark
import co.bitterlemon.trackify.ui.theme.BrandLight
import co.bitterlemon.trackify.ui.theme.trackifyColorScheme
import co.bitterlemon.trackify.util.Format
import co.bitterlemon.trackify.util.Time

/*
 * Home-screen widgets (Material You). Both widgets use the launcher's corner radius, the wallpaper colours
 * (GlanceTheme) and SizeMode.Responsive, with a layout designed for each size bucket. The running task and
 * its live clock are the biggest thing; whole tiles and rows are the tap targets.
 *
 * Widget theme setting: "system" = wallpaper colours following the system light/dark mode (brand green before
 * Android 12); "light" / "dark" force that variant of the same palette.
 */

// ---------------------------------------------------------------------------------------------------------------
// Theme

private fun widgetColors(context: Context, theme: String): ColorProviders? = when (theme) {
    "light" -> ColorProviders(trackifyColorScheme(context, false))
    "dark" -> ColorProviders(trackifyColorScheme(context, true))
    else -> if (Build.VERSION.SDK_INT >= 31) null else ColorProviders(light = BrandLight, dark = BrandDark)
}

/** Chronometer text colour when the theme is forced (null = the layout's own day/night wallpaper colour). */
private fun chronoColor(context: Context, theme: String): Int? = when (theme) {
    "light" -> trackifyColorScheme(context, false).onPrimaryContainer.toArgb()
    "dark" -> trackifyColorScheme(context, true).onPrimaryContainer.toArgb()
    else -> null
}

private val LocalChronoColor = androidx.compose.runtime.staticCompositionLocalOf<Int?> { null }

@Composable
private fun Themed(context: Context, snap: WidgetSnapshotData, content: @Composable () -> Unit) {
    val colors = widgetColors(context, snap.theme)
    androidx.compose.runtime.CompositionLocalProvider(LocalChronoColor provides chronoColor(context, snap.theme)) {
        if (colors != null) GlanceTheme(colors = colors, content = content) else GlanceTheme(content = content)
    }
}

private val C @Composable get() = GlanceTheme.colors

// ---------------------------------------------------------------------------------------------------------------
// Actions

private val TaskKey = ActionParameters.Key<String>("taskId")

class StartTaskAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val id = parameters[TaskKey] ?: return
        val g = AppGraph.get(context)
        if (g.session.session.value != null) {
            g.engine.start(id)
            kotlinx.coroutines.withTimeoutOrNull(8_000) { g.engine.drain(8_000) }
            g.syncSurfacesNow()
        }
    }
}

class StopAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val g = AppGraph.get(context)
        if (g.session.session.value != null) {
            g.engine.stop()
            kotlinx.coroutines.withTimeoutOrNull(8_000) { g.engine.drain(8_000) }
            g.syncSurfacesNow()
        }
    }
}

private fun startAction(id: String): Action = actionRunCallback<StartTaskAction>(actionParametersOf(TaskKey to id))
private fun stopAction(): Action = actionRunCallback<StopAction>()

private fun openApp(context: Context) = actionStartActivity(
    Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
)

// ---------------------------------------------------------------------------------------------------------------
// Building blocks

private fun accent(h: String): Color =
    co.bitterlemon.trackify.util.Accents.parseHex(h)?.let { Color(0xFF000000.toInt() or it) } ?: Color(0xFF22C55E)

/** Rounded tonal background. Android 12+ clips natively; older launchers get a tinted rounded drawable. */
private fun GlanceModifier.tonal(color: ColorProvider, radius: Dp = 16.dp): GlanceModifier =
    if (Build.VERSION.SDK_INT >= 31) cornerRadius(radius).background(color)
    else background(ImageProvider(R.drawable.widget_shape), contentScale = ContentScale.FillBounds, colorFilter = ColorFilter.tint(color))

private fun GlanceModifier.circle(color: ColorProvider, size: Dp): GlanceModifier =
    if (Build.VERSION.SDK_INT >= 31) size(size).cornerRadius(size / 2).background(color)
    else size(size).background(ImageProvider(R.drawable.widget_circle), contentScale = ContentScale.FillBounds, colorFilter = ColorFilter.tint(color))

/** The widget's own surface: launcher corner radius, wallpaper-tinted background. */
@Composable
private fun WidgetRoot(bg: ColorProvider, modifier: GlanceModifier = GlanceModifier, padding: Dp = 12.dp, content: @Composable () -> Unit) {
    val base = GlanceModifier.fillMaxSize().appWidgetBackground()
    val shaped = if (Build.VERSION.SDK_INT >= 31) base.cornerRadius(android.R.dimen.system_app_widget_background_radius).background(bg)
    else base.background(ImageProvider(R.drawable.widget_shape_outer), contentScale = ContentScale.FillBounds, colorFilter = ColorFilter.tint(bg))
    Box(shaped.then(modifier).padding(padding)) { content() }
}

@Composable
private fun Dot(color: Color, size: Dp = 10.dp) {
    Box(GlanceModifier.circle(ColorProvider(color), size)) {}
}

/** Round icon button (Stop / Play): the icon on a filled circle. */
@Composable
private fun RoundIcon(icon: Int, label: String, bg: ColorProvider, fg: ColorProvider, size: Dp, action: Action?) {
    Box(
        GlanceModifier.circle(bg, size).let { if (action != null) it.clickable(action) else it },
        contentAlignment = Alignment.Center,
    ) {
        Image(ImageProvider(icon), contentDescription = label, modifier = GlanceModifier.size(size * 0.42f), colorFilter = ColorFilter.tint(fg))
    }
}

@Composable
private fun Chrono(startTime: Long, sizeSp: Float, modifier: GlanceModifier = GlanceModifier) {
    val ctx = LocalContext.current
    val rv = RemoteViews(ctx.packageName, R.layout.widget_chrono)
    val base = SystemClock.elapsedRealtime() - (System.currentTimeMillis() - startTime)
    rv.setChronometer(R.id.chrono, base, null, true)
    rv.setTextViewTextSize(R.id.chrono, TypedValue.COMPLEX_UNIT_SP, sizeSp)
    LocalChronoColor.current?.let { rv.setTextColor(R.id.chrono, it) }
    AndroidRemoteViews(rv, modifier)
}

@Composable
private fun Label(text: String, color: ColorProvider, size: Int = 12, bold: Boolean = false, maxLines: Int = 1, modifier: GlanceModifier = GlanceModifier) {
    Text(
        text, modifier = modifier, maxLines = maxLines,
        style = TextStyle(color = color, fontSize = size.sp, fontWeight = if (bold) FontWeight.Medium else FontWeight.Normal),
    )
}

@Composable
private fun Message(context: Context, text: String) {
    WidgetRoot(C.widgetBackground, GlanceModifier.clickable(openApp(context)), padding = 16.dp) {
        Column(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically, horizontalAlignment = Alignment.CenterHorizontally) {
            Image(ImageProvider(R.drawable.ic_stat_timer), null, GlanceModifier.size(28.dp), colorFilter = ColorFilter.tint(C.primary))
            Spacer(GlanceModifier.height(8.dp))
            Label(text, C.onSurface, 14, maxLines = 3)
        }
    }
}

private fun lastTask(snap: WidgetSnapshotData): SnapshotTask? =
    snap.tasks.firstOrNull { it.id == snap.lastTaskId } ?: snap.tasks.firstOrNull()

/** Tasks to offer as one-tap starts: the last task first, then the rest by recency, never the running one. */
private fun startable(snap: WidgetSnapshotData): List<SnapshotTask> {
    val last = lastTask(snap)
    return (listOfNotNull(last) + snap.tasks.filter { it.id != last?.id }).filter { it.id != snap.running?.taskId }
}

private fun todayText(snap: WidgetSnapshotData): String? {
    val ms = snap.todayTotalLive(System.currentTimeMillis())
    return if (ms >= 60_000) "Today ${Format.durationWords(ms)}" else null
}

/** A start tile: accent dot, the name on up to two lines, the whole tile is the button. */
@Composable
private fun StartTile(t: SnapshotTask, modifier: GlanceModifier, primary: Boolean = false, caption: String? = null) {
    val bg = if (primary) C.primaryContainer else C.secondaryContainer
    val fg = if (primary) C.onPrimaryContainer else C.onSecondaryContainer
    Column(
        modifier.tonal(bg).clickable(startAction(t.id)).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Dot(accent(t.accentHex), 10.dp)
            Spacer(GlanceModifier.defaultWeight())
            Image(ImageProvider(R.drawable.ic_play), contentDescription = "Start ${t.name}", modifier = GlanceModifier.size(16.dp), colorFilter = ColorFilter.tint(fg))
        }
        Spacer(GlanceModifier.height(6.dp))
        if (caption != null) Label(caption, fg, 12)
        Label(t.name, fg, 14, bold = true, maxLines = 2)
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Small widget: "Trackify timer"

private val SmallBar = DpSize(110.dp, 40.dp)
private val SmallBarWide = DpSize(250.dp, 40.dp)
private val SmallSquare = DpSize(110.dp, 100.dp)
private val SmallWide = DpSize(200.dp, 100.dp)

class SmallTimerWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(SmallBar, SmallBarWide, SmallSquare, SmallWide))
    override val previewSizeMode = SizeMode.Responsive(setOf(SmallSquare, SmallWide))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val flow = WidgetSnapshot.flow(context)
        provideContent {
            val snap by flow.collectAsState()
            val data = snap ?: WidgetSnapshot.read(context)
            Themed(context, data) { SmallContent(context, data) }
        }
    }

    override suspend fun providePreview(context: Context, widgetCategory: Int) {
        provideContent { Themed(context, PreviewData.running) { SmallContent(context, PreviewData.running) } }
    }
}

@Composable
private fun SmallContent(context: Context, snap: WidgetSnapshotData) {
    if (!snap.signedIn) return Message(context, "Sign in to Trackify")
    val size = LocalSize.current
    val r = snap.running
    val bar = size.height < 100.dp
    val wide = size.width >= 200.dp
    when {
        r != null && bar -> SmallRunningBar(context, r)
        r != null && wide -> SmallRunningWide(context, r)
        r != null -> SmallRunningSquare(context, r)
        startable(snap).isEmpty() -> Message(context, "Create a task in Trackify")
        bar -> SmallIdleBar(snap, if (size.width >= 250.dp) 3 else 1)
        wide -> SmallIdleGrid(snap, columns = 2)
        else -> SmallIdleSquare(snap)
    }
}

@Composable
private fun SmallRunningBar(context: Context, r: SnapshotRunning) {
    WidgetRoot(C.primaryContainer, padding = 6.dp) {
        Row(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            Column(GlanceModifier.defaultWeight().padding(start = 10.dp).clickable(openApp(context))) {
                Label(r.taskName, C.onPrimaryContainer, 13, bold = true)
                Chrono(r.startTime, 20f)
            }
            RoundIcon(R.drawable.ic_stop, "Stop", C.primary, C.onPrimary, 44.dp, stopAction())
        }
    }
}

@Composable
private fun SmallRunningSquare(context: Context, r: SnapshotRunning) {
    WidgetRoot(C.primaryContainer, padding = 12.dp) {
        Column(GlanceModifier.fillMaxSize()) {
            Column(GlanceModifier.fillMaxWidth().defaultWeight().clickable(openApp(context))) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Dot(accent(r.accentHex), 8.dp)
                    Spacer(GlanceModifier.width(6.dp))
                    Label(if (r.pending) "Syncing…" else "Tracking", C.onPrimaryContainer, 12)
                }
                Spacer(GlanceModifier.height(2.dp))
                Label(r.taskName, C.onPrimaryContainer, 15, bold = true, maxLines = 2)
                Chrono(r.startTime, 26f)
            }
            Row(
                GlanceModifier.fillMaxWidth().height(44.dp).tonal(C.primary, 22.dp).clickable(stopAction()),
                verticalAlignment = Alignment.CenterVertically, horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Image(ImageProvider(R.drawable.ic_stop), null, GlanceModifier.size(18.dp), colorFilter = ColorFilter.tint(C.onPrimary))
                Spacer(GlanceModifier.width(6.dp))
                Label("Stop", C.onPrimary, 14, bold = true)
            }
        }
    }
}

@Composable
private fun SmallRunningWide(context: Context, r: SnapshotRunning) {
    WidgetRoot(C.primaryContainer, padding = 16.dp) {
        Row(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            Column(GlanceModifier.defaultWeight().clickable(openApp(context))) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Dot(accent(r.accentHex), 8.dp)
                    Spacer(GlanceModifier.width(6.dp))
                    Label(if (r.pending) "Syncing…" else "Since ${Time.clock(r.startTime)}", C.onPrimaryContainer, 12)
                }
                Label(r.taskName, C.onPrimaryContainer, 16, bold = true, maxLines = 2)
                Chrono(r.startTime, 34f)
            }
            Spacer(GlanceModifier.width(12.dp))
            RoundIcon(R.drawable.ic_stop, "Stop", C.primary, C.onPrimary, 64.dp, stopAction())
        }
    }
}

/** Idle, 2×2: one big "resume the last task" button. */
@Composable
private fun SmallIdleSquare(snap: WidgetSnapshotData) {
    val t = startable(snap).first()
    WidgetRoot(C.secondaryContainer, GlanceModifier.clickable(startAction(t.id)), padding = 12.dp) {
        Column(GlanceModifier.fillMaxSize()) {
            Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                RoundIcon(R.drawable.ic_play, "Resume ${t.name}", C.primary, C.onPrimary, 44.dp, null)
                Spacer(GlanceModifier.defaultWeight())
                todayText(snap)?.let { Label(it.removePrefix("Today "), C.onSecondaryContainer, 12) }
            }
            Spacer(GlanceModifier.defaultWeight())
            Row(verticalAlignment = Alignment.CenterVertically) {
                Dot(accent(t.accentHex), 8.dp)
                Spacer(GlanceModifier.width(6.dp))
                Label("Resume", C.onSecondaryContainer, 12)
            }
            Label(t.name, C.onSecondaryContainer, 15, bold = true, maxLines = 2)
        }
    }
}

/** Idle, 1 row high: resume (and on wide bars the next tasks) as chips. */
@Composable
private fun SmallIdleBar(snap: WidgetSnapshotData, count: Int) {
    val tasks = startable(snap).take(count)
    WidgetRoot(C.widgetBackground, padding = 6.dp) {
        Row(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
            tasks.forEachIndexed { i, t ->
                if (i > 0) Spacer(GlanceModifier.width(6.dp))
                Row(
                    GlanceModifier.defaultWeight().fillMaxHeight()
                        .tonal(if (i == 0) C.primaryContainer else C.secondaryContainer, 20.dp)
                        .clickable(startAction(t.id)).padding(horizontal = 10.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    val fg = if (i == 0) C.onPrimaryContainer else C.onSecondaryContainer
                    Image(ImageProvider(R.drawable.ic_play), "Start ${t.name}", GlanceModifier.size(16.dp), colorFilter = ColorFilter.tint(fg))
                    Spacer(GlanceModifier.width(8.dp))
                    Label(t.name, fg, 13, bold = true, maxLines = 2)
                }
            }
        }
    }
}

/** Idle, 3–4 columns × 2 rows: resume tile + the next task(s). */
@Composable
private fun SmallIdleGrid(snap: WidgetSnapshotData, columns: Int) {
    val tasks = startable(snap).take(columns)
    WidgetRoot(C.widgetBackground, padding = 8.dp) {
        Row(GlanceModifier.fillMaxSize()) {
            tasks.forEachIndexed { i, t ->
                if (i > 0) Spacer(GlanceModifier.width(6.dp))
                StartTile(t, GlanceModifier.defaultWeight().fillMaxHeight(), primary = i == 0, caption = if (i == 0) "Resume" else null)
            }
        }
    }
}

class SmallTimerWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SmallTimerWidget()
}

// ---------------------------------------------------------------------------------------------------------------
// Large widget: "Trackify tasks"

private val LargeCompact = DpSize(180.dp, 100.dp)
private val LargeList = DpSize(180.dp, 170.dp)
private val LargeListWide = DpSize(300.dp, 170.dp)

class LargeTimerWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(LargeCompact, LargeList, LargeListWide))
    override val previewSizeMode = SizeMode.Responsive(setOf(LargeListWide))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val flow = WidgetSnapshot.flow(context)
        provideContent {
            val snap by flow.collectAsState()
            val data = snap ?: WidgetSnapshot.read(context)
            Themed(context, data) { LargeContent(context, data) }
        }
    }

    override suspend fun providePreview(context: Context, widgetCategory: Int) {
        provideContent { Themed(context, PreviewData.running) { LargeContent(context, PreviewData.running) } }
    }
}

@Composable
private fun LargeContent(context: Context, snap: WidgetSnapshotData) {
    if (!snap.signedIn) return Message(context, "Sign in to Trackify")
    val size = LocalSize.current
    val r = snap.running
    val others = startable(snap)
    if (r == null && others.isEmpty()) return Message(context, "Create a task in Trackify")
    val wide = size.width >= 300.dp
    WidgetRoot(C.widgetBackground, padding = 8.dp) {
        Column(GlanceModifier.fillMaxSize()) {
            if (r != null) RunningHero(context, r, wide) else ResumeHero(others.first(), wide)
            if (size.height >= 170.dp) {
                val list = if (r != null) others else others.drop(1)
                Row(GlanceModifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = 10.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                    Label(if (r != null) "Switch to" else "Recent", C.onSurfaceVariant, 13, bold = true, modifier = GlanceModifier.defaultWeight())
                    todayText(snap)?.let { Label(it, C.onSurfaceVariant, 13) }
                }
                LazyColumn(GlanceModifier.fillMaxWidth().defaultWeight()) {
                    items(list, itemId = { it.id.hashCode().toLong() }) { t -> TaskListRow(t) }
                }
            }
        }
    }
}

@Composable
private fun RunningHero(context: Context, r: SnapshotRunning, wide: Boolean) {
    Row(
        GlanceModifier.fillMaxWidth().tonal(C.primaryContainer, 20.dp).padding(start = 16.dp, end = 12.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(GlanceModifier.defaultWeight().clickable(openApp(context))) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Dot(accent(r.accentHex), 8.dp)
                Spacer(GlanceModifier.width(6.dp))
                Label(if (r.pending) "Syncing…" else "Since ${Time.clock(r.startTime)}", C.onPrimaryContainer, 12)
            }
            Label(r.taskName, C.onPrimaryContainer, 16, bold = true, maxLines = 2)
            Chrono(r.startTime, if (wide) 36f else 30f)
        }
        Spacer(GlanceModifier.width(8.dp))
        RoundIcon(R.drawable.ic_stop, "Stop", C.primary, C.onPrimary, if (wide) 64.dp else 56.dp, stopAction())
    }
}

@Composable
private fun ResumeHero(t: SnapshotTask, wide: Boolean) {
    Row(
        GlanceModifier.fillMaxWidth().tonal(C.secondaryContainer, 20.dp).clickable(startAction(t.id))
            .padding(start = 16.dp, end = 12.dp, top = 12.dp, bottom = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(GlanceModifier.defaultWeight()) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Dot(accent(t.accentHex), 8.dp)
                Spacer(GlanceModifier.width(6.dp))
                Label("Not tracking · resume", C.onSecondaryContainer, 12)
            }
            Label(t.name, C.onSecondaryContainer, 18, bold = true, maxLines = 2)
        }
        Spacer(GlanceModifier.width(8.dp))
        RoundIcon(R.drawable.ic_play, "Start ${t.name}", C.primary, C.onPrimary, if (wide) 64.dp else 56.dp, null)
    }
}

/** A task row: the whole row starts (or switches to) the task. */
@Composable
private fun TaskListRow(t: SnapshotTask) {
    Column(GlanceModifier.fillMaxWidth()) {
        Row(
            GlanceModifier.fillMaxWidth().height(48.dp).tonal(C.surface, 16.dp).clickable(startAction(t.id)).padding(horizontal = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Dot(accent(t.accentHex), 10.dp)
            Spacer(GlanceModifier.width(12.dp))
            Label(t.name, C.onSurface, 14, maxLines = 1, modifier = GlanceModifier.defaultWeight())
            if (t.todayMs >= 60_000) {
                Spacer(GlanceModifier.width(8.dp))
                Label(Format.durationWords(t.todayMs), C.onSurfaceVariant, 13)
            }
        }
        Spacer(GlanceModifier.height(4.dp))
    }
}

class LargeTimerWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = LargeTimerWidget()
}

// ---------------------------------------------------------------------------------------------------------------
// Picker previews (Android 15+ generated previews)

private object PreviewData {
    private val tasks = listOf(
        SnapshotTask("p1", "Client portal", "#3b82f6", 45 * 60_000L, 0),
        SnapshotTask("p2", "Code review", "#10b981", 20 * 60_000L, 0),
        SnapshotTask("p3", "Emails & admin", "#db2777", 0, 0),
        SnapshotTask("p4", "Standup", "#f59e0b", 15 * 60_000L, 0),
    )
    val running: WidgetSnapshotData
        get() = WidgetSnapshotData(
            signedIn = true,
            running = SnapshotRunning("p1", "Client portal", "#3b82f6", System.currentTimeMillis() - (84 * 60_000L + 9_000L)),
            tasks = tasks, lastTaskId = "p1", todayTotalMs = 80 * 60_000L,
        )
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
            m.setWidgetPreviews(SmallTimerWidgetReceiver::class) == androidx.glance.appwidget.GlanceAppWidgetManager.SET_WIDGET_PREVIEWS_RESULT_SUCCESS &&
                m.setWidgetPreviews(LargeTimerWidgetReceiver::class) == androidx.glance.appwidget.GlanceAppWidgetManager.SET_WIDGET_PREVIEWS_RESULT_SUCCESS
        }.getOrDefault(false)
        if (ok) prefs.edit().putInt("version", version).apply()
    }
}
