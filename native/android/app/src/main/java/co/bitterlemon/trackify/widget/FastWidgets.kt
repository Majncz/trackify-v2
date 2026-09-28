package co.bitterlemon.trackify.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import android.util.Log
import android.util.SizeF
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

    private const val PHASE2_DELAY_MS = 700L

    /**
     * Redraw every placed timer, large and team widget from the current snapshot. Returns once all of them have
     * been handed to the launcher. [force] redraws even if the pixels were already pushed.
     */
    suspend fun push(context: Context, force: Boolean = true) {
        // A newer push supersedes one still composing (it would only draw an older state).
        // A tap (forced) cancels whatever is composing; a background refresh never cancels a tap's push.
        val job = scope.launch(start = kotlinx.coroutines.CoroutineStart.LAZY) { lock.withLock { pushLocked(context, force) } }
        synchronized(this) {
            val cur = current
            if (cur != null && cur.first.isActive && (force || !cur.second)) cur.first.cancel()
            current = job to force
        }
        job.start()
        job.join()
    }

    private var current: Pair<Job, Boolean>? = null

    private suspend fun pushLocked(context: Context, force: Boolean) {
        val t0 = SystemClock.uptimeMillis()
        val snap = WidgetSnapshot.read(context)
        val team = TeamSnapshot.read(context)
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
        // Widgets of the same kind and size share one composition. The groups compose in parallel, each with its
        // own GlanceRemoteViews (their layout configuration is not shared). Each widget first gets the size it is
        // showing in the current orientation, then the full size map (rotation, foldables).
        val groups = targets.groupBy { (kind, id) -> kind to sizesOf(context, m, id) }
        class Done(val kind: Kind, val sizes: List<DpSize>, val ids: List<Int>, val options: Bundle, val g: GlanceRemoteViews, val main: DpSize, val rv: RemoteViews)
        val firstAt = java.util.concurrent.atomic.AtomicLong(-1)
        // Phase 1: the visible size of every widget — timer widgets (they show the tap) before the team widgets.
        suspend fun visible(part: Map<Pair<Kind, List<DpSize>>, List<Pair<Kind, Int>>>) = coroutineScope {
            part.map { (k, members) ->
                async(Dispatchers.Default) {
                    val (kind, sizes) = k
                    val ids = members.map { it.second }
                    runCatching {
                        val options = runCatching { m.getAppWidgetOptions(ids.first()) }.getOrNull() ?: Bundle()
                        val g = GlanceRemoteViews()
                        val main = primary(context, sizes)
                        val rv = g.compose(context, main, null, options) { Content(context, kind, snap, team) }.remoteViews
                        if (stale(context, snap)) return@async null
                        ids.forEach { m.updateAppWidget(it, rv) }
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
        // Phase 2: every size the launcher may switch to (rotation, foldables) — a moment later, so the launcher
        // applies phase 1 first (it inflates every update on its main thread).
        if (done.any { it.sizes.size > 1 }) delay(PHASE2_DELAY_MS)
        coroutineScope {
            done.filter { it.sizes.size > 1 }.forEach { d ->
                launch(Dispatchers.Default) {
                    runCatching {
                        val views = d.sizes.map { sz ->
                            sz to (if (sz == d.main) d.rv else d.g.compose(context, sz, null, d.options) { Content(context, d.kind, snap, team) }.remoteViews)
                        }
                        val all = combine(views)
                        if (stale(context, snap)) return@launch
                        d.ids.forEach { m.updateAppWidget(it, all) }
                    }.onFailure { if (it !is kotlinx.coroutines.CancellationException) Log.w(TAG, "fast push (all sizes) failed (${d.kind})", it) }
                }
            }
        }
        Log.i(TAG, "fast push v${snap.version} running=${snap.running?.taskId} → ${targets.size} widgets (${groups.size} layouts): first on screen after ${firstAt.get()} ms, all after $visibleMs ms, all sizes after ${SystemClock.uptimeMillis() - t0} ms (incl. ${PHASE2_DELAY_MS} ms pause)")
    }

    /** A newer snapshot exists: never put this one on screen. */
    private fun stale(context: Context, snap: WidgetSnapshotData): Boolean {
        val now = WidgetSnapshot.read(context)
        return now.version > snap.version && WidgetUpdater.renderKey(now) != WidgetUpdater.renderKey(snap)
    }

    /** [push] in the background (surfaces that changed outside a tap: app, socket, sync results). */
    fun pushAsync(context: Context) {
        scope.launch { runCatching { push(context, force = false) } }
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
    private fun Content(context: Context, kind: Kind, snap: WidgetSnapshotData, team: TeamSnapshotData) {
        Themed(context, snap.theme) {
            when (kind) {
                Kind.SMALL -> TimerContent(context, snap, null, null)
                Kind.LARGE -> TimerContent(context, snap, team, null)
                Kind.TEAM -> TeamContent(context, snap, team)
            }
        }
    }

    /** One RemoteViews for all sizes the launcher may show (like Glance's SizeMode.Exact). */
    private fun combine(views: List<Pair<DpSize, RemoteViews>>): RemoteViews {
        if (views.size == 1) return views[0].second
        if (Build.VERSION.SDK_INT >= 31) {
            return RemoteViews(views.associate { (s, rv) -> SizeF(s.width.value, s.height.value) to rv })
        }
        // Pre-12: [portrait, landscape] (see sizesOf).
        return RemoteViews(views[1].second, views[0].second)
    }

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
