package co.bitterlemon.trackify.widget

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.os.Build
import android.os.SystemClock
import android.util.TypedValue
import android.widget.RemoteViews
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.ColorFilter
import androidx.glance.GlanceModifier
import androidx.glance.Image
import androidx.glance.ImageProvider
import androidx.glance.LocalContext
import androidx.glance.action.Action
import androidx.glance.action.clickable
import androidx.glance.appwidget.AndroidRemoteViews
import androidx.glance.appwidget.action.actionStartActivity
import androidx.glance.appwidget.appWidgetBackground
import androidx.glance.appwidget.cornerRadius
import androidx.glance.background
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.ContentScale
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.padding
import androidx.glance.layout.size
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import co.bitterlemon.trackify.MainActivity
import co.bitterlemon.trackify.R
import co.bitterlemon.trackify.util.Format

/*
 * Shared look of the home-screen widgets, after the Apple widgets: a plain neutral card (white in light mode,
 * near-black in dark), colour dots, muted secondary text, a soft red Stop. "System" follows the system light/dark
 * mode through resource colours (res/values*\/widget_colors.xml); "Light" / "Dark" force one of them.
 */

internal class Pal(
    val bg: ColorProvider,
    val fg: ColorProvider,
    val muted: ColorProvider,
    val line: ColorProvider,
    val soft: ColorProvider,
    val stopBg: ColorProvider,
    val stopFg: ColorProvider,
    val live: ColorProvider,
    /** Chronometer text colour when the theme is forced (null = the layout's own light/dark colour). */
    val clockArgb: Int?,
)

internal fun palette(context: Context, theme: String): Pal = when (theme) {
    "light" -> fixedPalette(context, night = false)
    "dark" -> fixedPalette(context, night = true)
    else -> Pal(
        ColorProvider(R.color.w_bg), ColorProvider(R.color.w_fg), ColorProvider(R.color.w_muted),
        ColorProvider(R.color.w_line), ColorProvider(R.color.w_soft), ColorProvider(R.color.w_stop_bg),
        ColorProvider(R.color.w_stop_fg), ColorProvider(R.color.w_live), null,
    )
}

private fun fixedPalette(context: Context, night: Boolean): Pal {
    val conf = Configuration(context.resources.configuration)
    conf.uiMode = (conf.uiMode and Configuration.UI_MODE_NIGHT_MASK.inv()) or
        (if (night) Configuration.UI_MODE_NIGHT_YES else Configuration.UI_MODE_NIGHT_NO)
    val c = context.createConfigurationContext(conf)
    fun p(id: Int) = ColorProvider(Color(c.getColor(id)))
    return Pal(
        p(R.color.w_bg), p(R.color.w_fg), p(R.color.w_muted), p(R.color.w_line), p(R.color.w_soft),
        p(R.color.w_stop_bg), p(R.color.w_stop_fg), p(R.color.w_live), c.getColor(R.color.w_fg),
    )
}

internal val LocalPal = staticCompositionLocalOf<Pal> { error("no widget palette") }
internal val P: Pal @Composable get() = LocalPal.current

@Composable
internal fun Themed(context: Context, theme: String, content: @Composable () -> Unit) {
    CompositionLocalProvider(LocalPal provides palette(context, theme), content = content)
}

/** Font scale, for the row budgets (text is in sp and grows with it). */
internal fun fontScale(context: Context): Float = context.resources.configuration.fontScale.coerceIn(0.85f, 2f)

// ---------------------------------------------------------------------------------------------------------------
// Building blocks

internal fun accent(h: String): Color =
    co.bitterlemon.trackify.util.Accents.parseHex(h)?.let { Color(0xFF000000.toInt() or it) } ?: Color(0xFF22C55E)

/** Rounded fill. Android 12+ clips natively; older launchers get a tinted rounded drawable. */
internal fun GlanceModifier.rounded(color: ColorProvider, radius: Dp): GlanceModifier =
    if (Build.VERSION.SDK_INT >= 31) cornerRadius(radius).background(color)
    else background(ImageProvider(R.drawable.widget_shape), contentScale = ContentScale.FillBounds, colorFilter = ColorFilter.tint(color))

internal fun GlanceModifier.circle(color: ColorProvider, size: Dp): GlanceModifier =
    if (Build.VERSION.SDK_INT >= 31) size(size).cornerRadius(size / 2).background(color)
    else size(size).background(ImageProvider(R.drawable.widget_circle), contentScale = ContentScale.FillBounds, colorFilter = ColorFilter.tint(color))

/** The widget card: the launcher's corner radius on Android 12+, a plain neutral surface. */
@Composable
internal fun Card(modifier: GlanceModifier = GlanceModifier, padding: Dp = 16.dp, content: @Composable () -> Unit) {
    val base = GlanceModifier.fillMaxSize().appWidgetBackground()
    val shaped = if (Build.VERSION.SDK_INT >= 31) base.cornerRadius(android.R.dimen.system_app_widget_background_radius).background(P.bg)
    else base.background(ImageProvider(R.drawable.widget_shape_outer), contentScale = ContentScale.FillBounds, colorFilter = ColorFilter.tint(P.bg))
    Box(shaped.then(modifier).padding(padding)) { content() }
}

@Composable
internal fun Dot(color: Color, size: Dp = 8.dp) {
    Box(GlanceModifier.circle(ColorProvider(color), size)) {}
}

@Composable
internal fun DotP(color: ColorProvider, size: Dp = 8.dp) {
    Box(GlanceModifier.circle(color, size)) {}
}

@Composable
internal fun Txt(
    text: String, color: ColorProvider, size: Int = 14, weight: FontWeight = FontWeight.Normal,
    maxLines: Int = 1, modifier: GlanceModifier = GlanceModifier,
) {
    Text(text, modifier = modifier, maxLines = maxLines, style = TextStyle(color = color, fontSize = size.sp, fontWeight = weight))
}

@Composable
internal fun Divider(vertical: Dp = 10.dp) {
    Column(GlanceModifier.fillMaxWidth()) {
        Spacer(GlanceModifier.height(vertical))
        Box(GlanceModifier.fillMaxWidth().height(1.dp).background(P.line)) {}
        Spacer(GlanceModifier.height(vertical))
    }
}

/** Live clock: a RemoteViews Chronometer, so it ticks without redraws. Sized in dp (a display number). */
@Composable
internal fun Clock(startTime: Long, sizeDp: Float, modifier: GlanceModifier = GlanceModifier) {
    val ctx = LocalContext.current
    val rv = RemoteViews(ctx.packageName, R.layout.widget_chrono)
    val base = SystemClock.elapsedRealtime() - (System.currentTimeMillis() - startTime)
    rv.setChronometer(R.id.chrono, base, null, true)
    rv.setTextViewTextSize(R.id.chrono, TypedValue.COMPLEX_UNIT_DIP, sizeDp)
    P.clockArgb?.let { rv.setTextColor(R.id.chrono, it) }
    AndroidRemoteViews(rv, modifier)
}

/** Soft red "■ Stop" pill (Mac widget). */
@Composable
internal fun StopPill(action: Action, modifier: GlanceModifier = GlanceModifier, height: Dp = 36.dp) {
    Row(
        modifier.height(height).rounded(P.stopBg, height / 2).tap(action).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Image(ImageProvider(R.drawable.ic_stop), null, GlanceModifier.size(15.dp), colorFilter = ColorFilter.tint(P.stopFg))
        Spacer(GlanceModifier.width(8.dp))
        Txt("Stop", P.stopFg, 15, FontWeight.Medium)
    }
}

/** Round soft button with an icon (Stop on the 2×1 widget, Play when idle). */
@Composable
internal fun RoundButton(icon: Int, label: String, bg: ColorProvider, fg: ColorProvider, size: Dp, action: Action?) {
    Box(GlanceModifier.circle(bg, size).let { if (action != null) it.tap(action, round = true) else it }, contentAlignment = Alignment.Center) {
        Image(ImageProvider(icon), contentDescription = label, modifier = GlanceModifier.size(size * 0.4f), colorFilter = ColorFilter.tint(fg))
    }
}

/** A tap target with visible press feedback (ripple), drawn by the launcher before any data changes. */
internal fun GlanceModifier.tap(action: Action, round: Boolean = false): GlanceModifier =
    clickable(action, if (round) R.drawable.w_ripple_round else R.drawable.w_ripple)

internal fun openApp(context: Context, route: String? = null): Action = actionStartActivity(
    Intent(context, MainActivity::class.java)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP)
        .also { if (route != null) it.putExtra("route", route) }
)

/** "3h 12m", or "0m" before the first minute. */
internal fun hm(ms: Long): String = if (ms < 60_000) "0m" else Format.durationWords(ms)

@Composable
internal fun Message(context: Context, title: String, body: String) {
    Card(GlanceModifier.tap(openApp(context))) {
        Column(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.Bottom) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Txt("Trackify", P.fg, 15, FontWeight.Bold)
                Spacer(GlanceModifier.width(2.dp))
                DotP(P.live, 5.dp)
            }
            Spacer(GlanceModifier.defaultWeight())
            Txt(title, P.fg, 14, FontWeight.Medium, maxLines = 2)
            Txt(body, P.muted, 12, maxLines = 2)
        }
    }
}
