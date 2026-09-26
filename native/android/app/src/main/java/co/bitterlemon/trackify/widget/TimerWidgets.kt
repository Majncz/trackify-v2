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

// ---- palette (NATIVE_SPEC §4) ----
private val Bg = ColorProvider(day = Color(0xFFFFFFFF), night = Color(0xFF111111))
private val Fg = ColorProvider(day = Color(0xFF0A0A0A), night = Color(0xFFFAFAFA))
private val Muted = ColorProvider(day = Color(0xFF737373), night = Color(0xFFA3A3A3))
private val MutedBg = ColorProvider(day = Color(0xFFF5F5F5), night = Color(0xFF262626))
private val Primary = ColorProvider(day = Color(0xFF171717), night = Color(0xFFFAFAFA))
private val OnPrimary = ColorProvider(day = Color(0xFFFAFAFA), night = Color(0xFF171717))
private val Destructive = FixedColor(Color(0xFFEF4444))
private val White = FixedColor(Color(0xFFFAFAFA))
private val LiveBg = ColorProvider(day = Color(0x1A10B981), night = Color(0x2610B981))

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
        }
    }
}

class StopAction : ActionCallback {
    override suspend fun onAction(context: Context, glanceId: GlanceId, parameters: ActionParameters) {
        val g = AppGraph.get(context)
        if (g.session.session.value != null) {
            g.engine.stop()
            kotlinx.coroutines.withTimeoutOrNull(8_000) { g.engine.drain(8_000) }
        }
    }
}

@Composable
private fun Chrono(startTime: Long, sizeLayout: Int, height: Int = 36) {
    val ctx = LocalContext.current
    val rv = RemoteViews(ctx.packageName, sizeLayout)
    val base = SystemClock.elapsedRealtime() - (System.currentTimeMillis() - startTime)
    rv.setChronometer(R.id.chrono, base, null, true)
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
            GlanceTheme { SmallContent(context, snap ?: WidgetSnapshot.read(context)) }
        }
    }
}

@Composable
private fun SmallContent(context: Context, snap: WidgetSnapshotData) {
    val r = snap.running
    val now = System.currentTimeMillis()
    Column(
        GlanceModifier.fillMaxSize().cornerRadius(20.dp).background(Bg).padding(14.dp).clickable(openApp(context)),
    ) {
        Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Wordmark()
            Spacer(GlanceModifier.defaultWeight())
            if (r != null) Dot(Color(0xFF22C55E), 7)
        }
        Spacer(GlanceModifier.defaultWeight())
        if (!snap.signedIn) {
            Text("Sign in to start tracking", style = TextStyle(color = Muted, fontSize = 13.sp))
            Spacer(GlanceModifier.defaultWeight())
            return@Column
        }
        if (r != null) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Dot(hex(r.accentHex))
                Spacer(GlanceModifier.width(6.dp))
                Text(r.taskName, style = TextStyle(color = Fg, fontSize = 14.sp, fontWeight = FontWeight.Medium), maxLines = 1)
            }
            Chrono(r.startTime, R.layout.widget_chrono_small)
            Spacer(GlanceModifier.height(6.dp))
            Pill("Stop", Destructive, White, R.drawable.ic_stop, GlanceModifier.fillMaxWidth().clickable(actionRunCallback<StopAction>()))
        } else {
            val last = snap.tasks.firstOrNull { it.id == snap.lastTaskId } ?: snap.tasks.firstOrNull()
            Text("Not tracking", style = TextStyle(color = Muted, fontSize = 12.sp))
            Text(
                "Today ${Format.durationWords(snap.todayTotalLive(now))}",
                style = TextStyle(color = Fg, fontSize = 18.sp, fontWeight = FontWeight.Bold),
                maxLines = 1,
            )
            Spacer(GlanceModifier.height(8.dp))
            if (last != null) {
                Pill(
                    last.name, Primary, OnPrimary, R.drawable.ic_play,
                    GlanceModifier.fillMaxWidth().clickable(actionRunCallback<StartTaskAction>(actionParametersOf(TaskKey to last.id))),
                )
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
            GlanceTheme { LargeContent(context, snap ?: WidgetSnapshot.read(context)) }
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
            if (snap.signedIn) {
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
        val tasks = snap.tasks.filter { it.id != r?.taskId }.take(if (size.height < 250.dp) 3 else 8)
        if (tasks.isEmpty()) {
            Text("No tasks yet", style = TextStyle(color = Muted, fontSize = 13.sp))
        }
        LazyColumn(GlanceModifier.fillMaxWidth().defaultWeight()) {
            items(tasks, itemId = { it.id.hashCode().toLong() }) { t ->
                Row(
                    GlanceModifier.fillMaxWidth().padding(vertical = 6.dp)
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
