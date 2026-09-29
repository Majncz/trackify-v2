package co.bitterlemon.trackify.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.util.SizeF
import co.bitterlemon.trackify.BuildConfig
import co.bitterlemon.trackify.R
import android.widget.RemoteViews
import androidx.compose.runtime.Composable
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.glance.appwidget.ExperimentalGlanceRemoteViewsApi
import androidx.glance.appwidget.GlanceRemoteViews
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

/**
 * Widget redraws without Glance's session machinery. A Glance update needs a live session, and when there is none
 * it starts one through WorkManager — which Doze, battery saver and the rare/restricted standby buckets defer by
 * seconds to minutes on real phones. Timer taps therefore compose the same widget content here with
 * [GlanceRemoteViews] (in-process, no session, no WorkManager) for each placed widget's actual sizes and hand the
 * RemoteViews straight to [AppWidgetManager.updateAppWidget]. The regular Glance update still follows and draws
 * the same snapshot; [pushedVersion] lets a Glance composition of an older snapshot notice and re-push.
 */
@OptIn(ExperimentalGlanceRemoteViewsApi::class)
object FastWidgets {
    private const val TAG = "TrackifyTap"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val lock = Mutex()

    /** Highest snapshot version pushed by this process. */
    @Volatile var pushedVersion = 0L
        private set

    /** Render key of the last push (see [WidgetUpdater.renderKey]), to skip redundant pushes. */
    @Volatile private var lastKey: Int? = null
    @Volatile private var lastTeamKey: Int? = null
    private var repushJob: Job? = null

    private enum class Kind { SMALL, LARGE, TEAM }

    /**
     * Redraw every placed timer, large and team widget from the current snapshot. Returns once all of them have
     * been handed to the launcher. [force] redraws even if the pixels were already pushed.
     */
    suspend fun push(context: Context, force: Boolean = true, animate: Boolean = true) {
        // A newer push supersedes one still composing (it would only draw an older state).
        // A tap (forced) cancels whatever is composing; a background refresh never cancels a tap's push.
        val job = scope.launch(start = kotlinx.coroutines.CoroutineStart.LAZY) { lock.withLock { pushLocked(context, force, animate) } }
        synchronized(this) {
            val cur = current
            if (cur != null && cur.first.isActive && (force || !cur.second)) cur.first.cancel()
            current = job to force
        }
        job.start()
        job.join()
    }

    private var current: Pair<Job, Boolean>? = null

    private suspend fun pushLocked(context: Context, force: Boolean, animate: Boolean) {
        val t0 = SystemClock.uptimeMillis()
        val snap = WidgetSnapshot.read(context)
        val team = TeamSnapshot.read(context)
        currentTheme = snap.theme
        TapLog.observePush(snap.running?.taskId)
        val key = WidgetUpdater.renderKey(snap)
        val teamKey = team.hashCode()
        // A fresh process: the widgets show what the previous one drew from the stored snapshot.
        if (lastKey == null) lastKey = WidgetSnapshot.storedRenderKey
        if (lastTeamKey == null) lastTeamKey = TeamSnapshot.storedKey
        if (!force && key == lastKey && teamKey == lastTeamKey) return
        val m = AppWidgetManager.getInstance(context)
        fun ids(cls: Class<*>) = runCatching { m.getAppWidgetIds(ComponentName(context, cls)) }.getOrDefault(IntArray(0))
        val targets = ids(SmallTimerWidgetReceiver::class.java).map { Kind.SMALL to it } +
            ids(LargeTimerWidgetReceiver::class.java).map { Kind.LARGE to it } +
            (if (force || teamKey != lastTeamKey) ids(TeamWidgetReceiver::class.java).map { Kind.TEAM to it } else emptyList())
        pushedVersion = maxOf(pushedVersion, snap.version)
        pruneFrames(context, targets.map { it.second }.toSet())
        // Widgets of the same kind and size share one composition. The groups compose in parallel, each with its
        // own GlanceRemoteViews (their layout configuration is not shared). Each widget first gets the size it is
        // showing in the current orientation, then the full size map (rotation, foldables).
        val groups = targets.groupBy { (kind, id) -> kind to sizesOf(context, m, id) }
        class Done(val kind: Kind, val sizes: List<DpSize>, val ids: List<Int>, val options: Bundle, val g: GlanceRemoteViews, val main: DpSize, val rv: RemoteViews)
        val firstAt = java.util.concurrent.atomic.AtomicLong(-1)
        // The visible size of every widget (a rotation or resize calls the receiver, which draws again) — timer widgets (they show the tap) before the team widgets.
        suspend fun visible(part: Map<Pair<Kind, List<DpSize>>, List<Pair<Kind, Int>>>) = coroutineScope {
            part.map { (k, members) ->
                async(Dispatchers.Default) {
                    val (kind, sizes) = k
                    val ids = members.map { it.second }
                    runCatching {
                        val options = runCatching { m.getAppWidgetOptions(ids.first()) }.getOrNull() ?: Bundle()
                        val g = GlanceRemoteViews()
                        val main = primary(context, sizes)
                        var rv = g.compose(context, main, null, options) { Content(context, kind, snap, team, true) }.remoteViews
                        // Launchers get the update through a binder transaction with a hard size limit (a 350 KB
                        // update made the widget host "dead" on Android 8): keep it small, drop the heat map if not.
                        var bytes = parcelBytes(rv)
                        if (bytes > MAX_RV_BYTES && kind != Kind.TEAM) {
                            rv = g.compose(context, main, null, options) { Content(context, kind, snap, team, false) }.remoteViews
                            if (force && animate) TapLog.note("RemoteViews were ${bytes / 1024} KB: drew without the heat map")
                            bytes = parcelBytes(rv)
                        }
                        if (force && animate) TapLog.note("${kind.name.lowercase()} RemoteViews ${bytes / 1024} KB")
                        if (force && animate) TapLog.stage("composed ${kind.name.lowercase()}")
                        if (stale(context, snap)) return@async null
                        ids.forEach { drawId(context, m, it, rv, animate) }
                        if (force && animate) TapLog.stage("drawn ${kind.name.lowercase()}")
                        firstAt.compareAndSet(-1, SystemClock.uptimeMillis() - t0)
                        Done(kind, sizes, ids, options, g, main, rv)
                    }.onFailure { if (it !is kotlinx.coroutines.CancellationException) Log.w(TAG, "fast push failed ($kind)", it) }.getOrNull()
                }
            }.awaitAll().filterNotNull()
        }
        val done = visible(groups.filterKeys { it.first != Kind.TEAM }) + visible(groups.filterKeys { it.first == Kind.TEAM })
        val visibleMs = SystemClock.uptimeMillis() - t0
        if (done.isNotEmpty() && !stale(context, snap)) {
            lastKey = key
            lastTeamKey = teamKey
        }
        Log.i(TAG, "fast push v${snap.version} running=${snap.running?.taskId} → ${targets.size} widgets (${groups.size} layouts): first on screen after ${firstAt.get()} ms, all after $visibleMs ms")
    }

    // ---- Animated state changes -------------------------------------------------------------------------------
    // Every widget is a two-frame ViewFlipper ([R.layout.widget_flip]). A full draw puts the content into the shown
    // frame. A tap draws the new state into the hidden frame with a partial update and flips: the launcher plays the
    // cross-fade (in/out animations) by itself. Which frame shows is remembered per widget id (and app build).

    private fun framePrefs(context: Context) = context.getSharedPreferences("widget_frames", Context.MODE_PRIVATE)
    private val frames = java.util.concurrent.ConcurrentHashMap<Int, Int>()

    /** The shown frame of [id] if this build has drawn its wrapper layout before, else null. */
    private fun shownFrame(context: Context, id: Int): Int? {
        frames[id]?.let { return it }
        val v = framePrefs(context).getString(id.toString(), null) ?: return null
        val (build, frame) = v.split(":").let { it[0] to it.getOrNull(1)?.toIntOrNull() }
        if (build != BuildConfig.VERSION_CODE.toString() || frame == null) return null
        return frame.also { frames[id] = it }
    }

    private fun rememberFrame(context: Context, id: Int, frame: Int) {
        frames[id] = frame
        framePrefs(context).edit().putString(id.toString(), "${BuildConfig.VERSION_CODE}:$frame").putString("theme", currentTheme).apply()
    }

    @Volatile private var currentTheme = "system"

    /** Take the overlay away again (a redraw failed or nothing needs drawing): never leave "Stopping…" up. */
    fun hidePending(context: Context) {
        val ids = framePrefs(context).all.keys.mapNotNull { it.toIntOrNull() }
        if (ids.isEmpty()) return
        val rv = RemoteViews(context.packageName, R.layout.widget_flip).also { it.setViewVisibility(R.id.pending, android.view.View.GONE) }
        val m = AppWidgetManager.getInstance(context)
        for (id in ids) runCatching { m.partiallyUpdateAppWidget(id, rv) }
    }

    /** Forget widgets that were removed from the home screen. */
    private fun pruneFrames(context: Context, live: Set<Int>) {
        val p = framePrefs(context)
        val stale = p.all.keys.filter { k -> k.toIntOrNull()?.let { it !in live } == true }
        if (stale.isEmpty()) return
        val e = p.edit()
        stale.forEach { e.remove(it); frames.remove(it.toInt()) }
        e.apply()
    }

    private fun frameView(frame: Int) = if (frame == 0) R.id.frame_a else R.id.frame_b

    private fun wrap(context: Context, content: RemoteViews, frame: Int, hideOverlay: Boolean = true): RemoteViews =
        RemoteViews(context.packageName, R.layout.widget_flip).also {
            it.removeAllViews(frameView(frame))
            it.addView(frameView(frame), content)
            it.setDisplayedChild(R.id.flip, frame)
            if (hideOverlay) it.setViewVisibility(R.id.pending, android.view.View.GONE)
        }

    /**
     * A tap has arrived: put a "Stopping… / Starting…" overlay on every widget this build has drawn, right now.
     * No composition, no snapshot, no Glance: a handful of binder calls with a RemoteViews built from XML, so the
     * widget reacts even when the real redraw is slow (cold process, busy or restricted phone). The redraw that
     * follows removes it.
     */
    fun showPending(context: Context, text: String) {
        val prefs = framePrefs(context)
        val ids = prefs.all.keys.mapNotNull { it.toIntOrNull() }
        if (ids.isEmpty()) return
        val theme = prefs.getString("theme", "system") ?: "system"
        val night = when (theme) {
            "dark" -> true
            "light" -> false
            else -> (context.resources.configuration.uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK) == android.content.res.Configuration.UI_MODE_NIGHT_YES
        }
        val rv = RemoteViews(context.packageName, R.layout.widget_flip)
        rv.setViewVisibility(R.id.pending, android.view.View.VISIBLE)
        rv.setTextViewText(R.id.pending_text, text)
        rv.setTextColor(R.id.pending_text, if (night) 0xFFF2F2F7.toInt() else 0xFF1D1D1F.toInt())
        rv.setInt(R.id.pending_bg, "setColorFilter", if (night) 0xE61C1C1E.toInt() else 0xE6FFFFFF.toInt())
        val m = AppWidgetManager.getInstance(context)
        for (id in ids) runCatching { m.partiallyUpdateAppWidget(id, rv) }
    }

    /** Draw [content] for [id]: animated into the hidden frame when [animate] and the widget already shows a wrapper. */
    private fun drawId(context: Context, m: AppWidgetManager, id: Int, content: RemoteViews, animate: Boolean) {
        val cur = shownFrame(context, id)
        if (animate && cur != null) {
            val next = 1 - cur
            // The new state goes into the hidden frame with a FULL update (same layout, so the launcher applies it
            // in place); then a tiny partial update flips to it and the launcher plays the cross-fade. A partial
            // update that carries the content would be *appended* to the views the system keeps (mergeRemoteViews),
            // growing every tap until the launcher's binder transaction fails (238–570 KB seen on Android 8).
            m.updateAppWidget(id, wrap(context, content, next).also { it.setDisplayedChild(R.id.flip, cur) })
            m.partiallyUpdateAppWidget(id, RemoteViews(context.packageName, R.layout.widget_flip).also {
                it.setDisplayedChild(R.id.flip, next)
                it.setViewVisibility(R.id.pending, android.view.View.GONE)
            })
            rememberFrame(context, id, next)
            return
        }
        val frame = cur ?: 0
        m.updateAppWidget(id, wrap(context, content, frame))
        rememberFrame(context, id, frame)
    }

    /** A newer snapshot exists: never put this one on screen. */
    private fun stale(context: Context, snap: WidgetSnapshotData): Boolean {
        val now = WidgetSnapshot.read(context)
        return now.version > snap.version && WidgetUpdater.renderKey(now) != WidgetUpdater.renderKey(snap)
    }

    /** [push] in the background (surfaces that changed outside a tap: app, socket, sync results). */
    fun pushAsync(context: Context, force: Boolean = false) {
        scope.launch { runCatching { push(context, force = force) } }
    }

    /** A Glance session composed an older snapshot than the one on screen: draw the current one again. */
    internal fun repushSoon(context: Context) {
        if (repushJob?.isActive == true) return
        repushJob = scope.launch {
            delay(250)
            runCatching { push(context, force = true) }
        }
    }

    @Composable
    private fun Content(context: Context, kind: Kind, snap: WidgetSnapshotData, team: TeamSnapshotData, heat: Boolean) {
        androidx.compose.runtime.CompositionLocalProvider(LocalHeat provides heat) {
        Themed(context, snap.theme) {
            when (kind) {
                Kind.SMALL -> TimerContent(context, snap, null, null)
                Kind.LARGE -> TimerContent(context, snap, team, null)
                Kind.TEAM -> TeamContent(context, snap, team)
            }
        }
        }
    }

    /** Size of [rv] as the system parcels it for the launcher. */
    private fun parcelBytes(rv: RemoteViews): Int {
        val p = android.os.Parcel.obtain()
        return try { rv.writeToParcel(p, 0); p.dataSize() } catch (_: Exception) { 0 } finally { p.recycle() }
    }

    private const val MAX_RV_BYTES = 250_000

    /** The size shown in the current orientation: portrait = the narrow, tall one; landscape = the wide one. */
    private fun primary(context: Context, sizes: List<DpSize>): DpSize {
        if (sizes.size == 1) return sizes[0]
        val landscape = context.resources.configuration.orientation == android.content.res.Configuration.ORIENTATION_LANDSCAPE
        return if (landscape) sizes.maxWith(compareBy<DpSize>({ it.width.value }, { -it.height.value }))
        else sizes.minWith(compareBy<DpSize>({ it.width.value }, { -it.height.value }))
    }

    /**
     * The sizes the launcher reports for this widget: Android 12+ lists them; older launchers give the portrait
     * (min width × max height) and landscape (max width × min height) bounds.
     */
    private fun sizesOf(context: Context, m: AppWidgetManager, id: Int): List<DpSize> {
        val o = runCatching { m.getAppWidgetOptions(id) }.getOrNull() ?: Bundle()
        if (Build.VERSION.SDK_INT >= 31) {
            @Suppress("DEPRECATION")
            val list = runCatching { o.getParcelableArrayList<SizeF>(AppWidgetManager.OPTION_APPWIDGET_SIZES) }.getOrNull()
            if (!list.isNullOrEmpty()) return list.map { DpSize(it.width.dp, it.height.dp) }.distinct()
        }
        val minW = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_WIDTH)
        val maxW = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_WIDTH)
        val minH = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MIN_HEIGHT)
        val maxH = o.getInt(AppWidgetManager.OPTION_APPWIDGET_MAX_HEIGHT)
        if (minW == 0 && maxW == 0) {
            val info = runCatching { m.getAppWidgetInfo(id) }.getOrNull()
            val d = context.resources.displayMetrics.density
            val w = ((info?.minWidth ?: 110) / d)
            val h = ((info?.minHeight ?: 110) / d)
            return listOf(DpSize(w.dp, h.dp))
        }
        val portrait = DpSize(minW.dp, maxH.dp)
        val landscape = DpSize(maxW.dp, minH.dp)
        return if (portrait == landscape) listOf(portrait) else listOf(portrait, landscape)
    }
}
