package co.bitterlemon.trackify.widget

import android.content.Context
import android.content.Intent
import android.os.SystemClock
import android.widget.RemoteViews
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.GlanceTheme
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.LocalSize
import androidx.glance.action.ActionParameters
import androidx.glance.action.actionParametersOf
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.action.clickable
import androidx.glance.appwidget.AndroidRemoteViews
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.action.ActionCallback
import androidx.glance.appwidget.action.actionRunCallback
import androidx.glance.appwidget.cornerRadius
import androidx.glance.appwidget.lazy.LazyColumn
import androidx.glance.appwidget.lazy.items
import androidx.glance.appwidget.provideContent
import androidx.glance.background
import androidx.glance.color.ColorProvider
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxHeight
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontFamily
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider as FixedColor
import androidx.compose.ui.unit.DpSize
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.MainActivity
import co.bitterlemon.trackify.R
import co.bitterlemon.trackify.util.Format

// ---- palette (NATIVE_SPEC §4), chosen per the widget theme setting ----
private class Pal(
    val bg: androidx.glance.unit.ColorProvider,
    val fg: androidx.glance.unit.ColorProvider,
    val muted: androidx.glance.unit.ColorProvider,
    val mutedBg: androidx.glance.unit.ColorProvider,
    val primary: androidx.glance.unit.ColorProvider,
    val onPrimary: androidx.glance.unit.ColorProvider,
    val liveBg: androidx.glance.unit.ColorProvider,
)

private fun pal(light: Long, dark: Long, theme: String): androidx.glance.unit.ColorProvider = when (theme) {
    "light" -> FixedColor(Color(light))
    "dark" -> FixedColor(Color(dark))
    else -> ColorProvider(day = Color(light), night = Color(dark))
}

private fun palette(theme: String) = Pal(
    bg = pal(0xFFFFFFFF, 0xFF111111, theme),
    fg = pal(0xFF0A0A0A, 0xFFFAFAFA, theme),
    muted = pal(0xFF737373, 0xFFA3A3A3, theme),
    mutedBg = pal(0xFFF5F5F5, 0xFF262626, theme),
    primary = pal(0xFF171717, 0xFFFAFAFA, theme),
    onPrimary = pal(0xFFFAFAFA, 0xFF171717, theme),
    liveBg = pal(0x1A10B981, 0x2610B981, theme),
)

private val LocalPal = androidx.compose.runtime.staticCompositionLocalOf { palette("system") }
private val Bg @Composable get() = LocalPal.current.bg
private val Fg @Composable get() = LocalPal.current.fg
private val Muted @Composable get() = LocalPal.current.muted
private val MutedBg @Composable get() = LocalPal.current.mutedBg
private val Primary @Composable get() = LocalPal.current.primary
private val OnPrimary @Composable get() = LocalPal.current.onPrimary
private val LiveBg @Composable get() = LocalPal.current.liveBg
private val Destructive = FixedColor(Color(0xFFEF4444))
private val White = FixedColor(Color(0xFFFAFAFA))

@Composable
private fun Themed(snap: WidgetSnapshotData, content: @Composable () -> Unit) {
    val chrono = when (snap.theme) { "light" -> 0xFF0A0A0A.toInt(); "dark" -> 0xFFFAFAFA.toInt(); else -> null }
    androidx.compose.runtime.CompositionLocalProvider(LocalPal provides palette(snap.theme), LocalChronoColor provides chrono) {
        GlanceTheme { content() }
    }
}

private val TaskKey = ActionParameters.Key<String>("taskId")

private fun hex(h: String): Color = Accents_parse(h)
@Suppress("FunctionName")
private fun Accents_parse(h: String): Color =
    co.bitterlemon.trackify.util.Accents.parseHex(h)?.let { Color(0xFF000000.toInt() or it) } ?: Color(0xFF22C55E)

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

/** Chronometer text colour for a forced widget theme (null = the layout's day/night colour). */
private val LocalChronoColor = androidx.compose.runtime.staticCompositionLocalOf<Int?> { null }

@Composable
private fun Chrono(startTime: Long, sizeLayout: Int, height: Int = 36) {
    val ctx = LocalContext.current
    val rv = RemoteViews(ctx.packageName, sizeLayout)
    val base = SystemClock.elapsedRealtime() - (System.currentTimeMillis() - startTime)
    rv.setChronometer(R.id.chrono, base, null, true)
    LocalChronoColor.current?.let { rv.setTextColor(R.id.chrono, it) }
    AndroidRemoteViews(rv, modifier = GlanceModifier.height(height.dp))
}

@Composable
private fun Wordmark(size: Int = 13) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("Trackify", style = TextStyle(color = Fg, fontSize = size.sp, fontWeight = FontWeight.Bold))
        Text(".", style = TextStyle(color = FixedColor(Color(0xFF22C55E)), fontSize = size.sp, fontWeight = FontWeight.Bold))
    }
}

@Composable
private fun Dot(color: Color, size: Int = 8) {
    Box(GlanceModifier.size(size.dp).cornerRadius((size / 2).dp).background(color)) {}
}

@Composable
private fun Pill(label: String, bg: androidx.glance.unit.ColorProvider, fg: androidx.glance.unit.ColorProvider, icon: Int, modifier: GlanceModifier) {
    Row(
        modifier.cornerRadius(18.dp).background(bg).padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(ImageProvider(icon), contentDescription = null, modifier = GlanceModifier.size(14.dp), colorFilter = androidx.glance.ColorFilter.tint(fg))
        Spacer(GlanceModifier.width(6.dp))
        Text(label, style = TextStyle(color = fg, fontSize = 13.sp, fontWeight = FontWeight.Medium), maxLines = 1)
    }
}

private fun openApp(context: Context) = actionStartActivity(
    Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
)

// ---------------- Small ----------------

class SmallTimerWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Exact

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val flow = WidgetSnapshot.flow(context)
        provideContent {
            val snap by flow.collectAsState()
            val data = snap ?: WidgetSnapshot.read(context)
            Themed(data) { SmallContent(context, data) }
        }
    }
}

@Composable
private fun SmallContent(context: Context, snap: WidgetSnapshotData) {
    val r = snap.running
    val now = System.currentTimeMillis()
    val size = LocalSize.current
    Column(GlanceModifier.fillMaxSize().cornerRadius(20.dp).background(Bg).padding(12.dp)) {
        Row(GlanceModifier.fillMaxWidth().clickable(openApp(context)), verticalAlignment = Alignment.CenterVertically) {
            Wordmark()
            Spacer(GlanceModifier.defaultWeight())
            if (snap.signedIn && r == null) {
                val today = snap.todayTotalLive(now)
                if (today > 0) Text(Format.durationWords(today), style = TextStyle(color = Muted, fontSize = 12.sp, fontWeight = FontWeight.Medium))
            } else if (r != null) {
                Dot(Color(0xFF22C55E), 7)
            }
        }
        Spacer(GlanceModifier.height(8.dp))
        if (!snap.signedIn) {
            Text("Sign in to start tracking", style = TextStyle(color = Muted, fontSize = 13.sp), modifier = GlanceModifier.clickable(openApp(context)))
            return@Column
        }
        if (r != null) {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = GlanceModifier.clickable(openApp(context))) {
                Dot(hex(r.accentHex))
                Spacer(GlanceModifier.width(6.dp))
                Text(r.taskName, style = TextStyle(color = Fg, fontSize = 14.sp, fontWeight = FontWeight.Medium), maxLines = 1)
            }
            Chrono(r.startTime, R.layout.widget_chrono_small)
            Spacer(GlanceModifier.height(6.dp))
            Pill("Stop", Destructive, White, R.drawable.ic_stop, GlanceModifier.fillMaxWidth().clickable(actionRunCallback<StopAction>()))
            // Room left: one-tap switch to the next tasks.
            if (size.height >= 200.dp) {
                Spacer(GlanceModifier.height(8.dp))
                TaskGrid(snap.tasks.filter { it.id != r.taskId }.take(2), columns = 2, modifier = GlanceModifier.fillMaxWidth().defaultWeight())
            }
        } else {
            // Idle: your top tasks, one tap to start.
            val rows = if (size.height < 150.dp) 1 else if (size.height < 260.dp) 2 else 3
            val cols = if (size.width < 200.dp) 2 else 3
            val tasks = snap.tasks.take(rows * cols)
            if (tasks.isEmpty()) {
                Text("Create a task in the app to start tracking", style = TextStyle(color = Muted, fontSize = 12.sp), modifier = GlanceModifier.clickable(openApp(context)))
            } else {
                TaskGrid(tasks, cols, GlanceModifier.fillMaxWidth().defaultWeight())
            }
        }
    }
}

/** Grid of start buttons (accent dot + name, up to two lines). */
@Composable
private fun TaskGrid(tasks: List<SnapshotTask>, columns: Int, modifier: GlanceModifier) {
    Column(modifier) {
        tasks.chunked(columns).forEachIndexed { i, row ->
            if (i > 0) Spacer(GlanceModifier.height(6.dp))
            Row(GlanceModifier.fillMaxWidth().defaultWeight()) {
                row.forEachIndexed { j, t ->
                    if (j > 0) Spacer(GlanceModifier.width(6.dp))
                    Column(
                        GlanceModifier.defaultWeight().fillMaxHeight().cornerRadius(12.dp).background(MutedBg)
                            .padding(horizontal = 8.dp, vertical = 6.dp)
                            .clickable(actionRunCallback<StartTaskAction>(actionParametersOf(TaskKey to t.id))),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            Dot(hex(t.accentHex), 7)
                            Spacer(GlanceModifier.defaultWeight())
                            Image(ImageProvider(R.drawable.ic_play), contentDescription = "Start ${t.name}", modifier = GlanceModifier.size(11.dp), colorFilter = androidx.glance.ColorFilter.tint(Muted))
                        }
                        Spacer(GlanceModifier.height(3.dp))
                        Text(t.name, style = TextStyle(color = Fg, fontSize = 12.sp, fontWeight = FontWeight.Medium), maxLines = 2)
                    }
                }
                // Keep cells equal width on a short last row.
                repeat(columns - row.size) {
                    Spacer(GlanceModifier.width(6.dp))
                    Spacer(GlanceModifier.defaultWeight())
                }
            }
        }
    }
}

class SmallTimerWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = SmallTimerWidget()
}

// ---------------- Large ----------------

class LargeTimerWidget : GlanceAppWidget() {
    override val sizeMode = SizeMode.Responsive(setOf(DpSize(250.dp, 180.dp), DpSize(250.dp, 300.dp)))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val flow = WidgetSnapshot.flow(context)
        provideContent {
            val snap by flow.collectAsState()
            val data = snap ?: WidgetSnapshot.read(context)
            Themed(data) { LargeContent(context, data) }
        }
    }
}

@Composable
private fun LargeContent(context: Context, snap: WidgetSnapshotData) {
    val r = snap.running
    val now = System.currentTimeMillis()
    val size = LocalSize.current
    Column(GlanceModifier.fillMaxSize().cornerRadius(20.dp).background(Bg).padding(14.dp)) {
        Row(GlanceModifier.fillMaxWidth().clickable(openApp(context)), verticalAlignment = Alignment.CenterVertically) {
            Wordmark(15)
            Spacer(GlanceModifier.defaultWeight())
            // Today's total is a static value (widgets can't tick), so show it only while idle.
            if (snap.signedIn && r == null && snap.todayTotalMs > 0) {
                Text("Today ", style = TextStyle(color = Muted, fontSize = 12.sp))
                Text(
                    Format.durationWords(snap.todayTotalLive(now)),
                    style = TextStyle(color = Fg, fontSize = 12.sp, fontWeight = FontWeight.Medium),
                )
            }
        }
        Spacer(GlanceModifier.height(10.dp))
        if (!snap.signedIn) {
            Text("Sign in to start tracking", style = TextStyle(color = Muted, fontSize = 13.sp), modifier = GlanceModifier.clickable(openApp(context)))
            return@Column
        }
        if (r != null) {
            Row(
                GlanceModifier.fillMaxWidth().cornerRadius(14.dp).background(LiveBg).padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(GlanceModifier.defaultWeight()) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Dot(hex(r.accentHex))
                        Spacer(GlanceModifier.width(6.dp))
                        Text(
                            if (r.pending) "Syncing…" else "Currently tracking",
                            style = TextStyle(color = Muted, fontSize = 11.sp),
                        )
                    }
                    Text(r.taskName, style = TextStyle(color = Fg, fontSize = 15.sp, fontWeight = FontWeight.Medium), maxLines = 1)
                    Chrono(r.startTime, R.layout.widget_chrono_large, 30)
                }
                Pill("Stop", Destructive, White, R.drawable.ic_stop, GlanceModifier.clickable(actionRunCallback<StopAction>()))
            }
        } else {
            Row(
                GlanceModifier.fillMaxWidth().cornerRadius(14.dp).background(MutedBg).padding(horizontal = 12.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Not tracking — tap a task to start", style = TextStyle(color = Muted, fontSize = 13.sp), maxLines = 1)
            }
        }
        Spacer(GlanceModifier.height(8.dp))
        val tasks = snap.tasks.filter { it.id != r?.taskId }
        if (tasks.isEmpty()) {
            Text("No tasks yet", style = TextStyle(color = Muted, fontSize = 13.sp))
        }
        LazyColumn(GlanceModifier.fillMaxWidth().defaultWeight()) {
            items(tasks, itemId = { it.id.hashCode().toLong() }) { t ->
                Row(
                    // End padding keeps the ▶ clear of the list's scroll bar.
                    GlanceModifier.fillMaxWidth().padding(start = 0.dp, top = 6.dp, end = 12.dp, bottom = 6.dp)
                        .clickable(actionRunCallback<StartTaskAction>(actionParametersOf(TaskKey to t.id))),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Dot(hex(t.accentHex))
                    Spacer(GlanceModifier.width(8.dp))
                    Text(t.name, style = TextStyle(color = Fg, fontSize = 14.sp), maxLines = 1, modifier = GlanceModifier.defaultWeight())
                    Text(
                        if (t.todayMs > 0) Format.durationWords(t.todayMs) else "",
                        style = TextStyle(color = Muted, fontSize = 12.sp),
                    )
                    Spacer(GlanceModifier.width(8.dp))
                    Box(
                        GlanceModifier.size(30.dp).cornerRadius(15.dp).background(MutedBg),
                        contentAlignment = Alignment.Center,
                    ) {
                        Image(ImageProvider(R.drawable.ic_play), contentDescription = "Start ${t.name}", modifier = GlanceModifier.size(14.dp), colorFilter = androidx.glance.ColorFilter.tint(Fg))
                    }
                }
            }
        }
    }
}

class LargeTimerWidgetReceiver : GlanceAppWidgetReceiver() {
    override val glanceAppWidget: GlanceAppWidget = LargeTimerWidget()
}
