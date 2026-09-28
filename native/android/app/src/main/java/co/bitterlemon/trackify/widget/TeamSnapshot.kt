package co.bitterlemon.trackify.widget

import android.content.Context
import android.util.Log
import androidx.glance.appwidget.GlanceAppWidgetManager
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.AppJson
import co.bitterlemon.trackify.data.Presence
import co.bitterlemon.trackify.util.Time
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.serialization.Serializable
import java.io.File
import java.util.concurrent.TimeUnit

/** One teammate's day, as the Team tab's leaderboard reports it (GET /api/presence, range=day). */
@Serializable
data class TeamMember(
    val userId: String,
    val name: String,
    /** Completed time today; the live part of a running timer is added at render time. */
    val todayMs: Long = 0,
    val startTime: Long? = null,
    val taskName: String? = null,
) {
    val live: Boolean get() = startTime != null

    fun todayLive(now: Long): Long {
        val s = startTime ?: return todayMs
        val today = Time.today()
        return todayMs + Time.liveRangeMs(s, now, Time.startOfDay(today), Time.endOfDay(today))
    }
}

@Serializable
data class TeamSnapshotData(
    val day: String = "",
    val fetchedAt: Long = 0,
    val myId: String? = null,
    val members: List<TeamMember> = emptyList(),
) {
    /** Today's members sorted by hours (the live part included); stale days read as empty. */
    fun rows(now: Long): List<TeamMember> =
        if (day != Time.today().toString()) emptyList()
        else members.filter { it.todayMs > 0 || it.live }.sortedByDescending { it.todayLive(now) }

    fun totalMs(now: Long): Long = rows(now).sumOf { it.todayLive(now) }
    val loaded: Boolean get() = fetchedAt > 0
}

/**
 * Team activity for the widgets. Refreshed when the app syncs (presence signal: timer ops, socket presence events
 * while the app or the timer service is up), when the app comes to the foreground, when a team widget is placed or
 * redrawn by the system, and every 30 minutes by [TeamRefreshWorker] — only while a widget that shows the team exists.
 */
object TeamSnapshot {
    private const val TAG = "TeamSnapshot"
    private val _flow = MutableStateFlow<TeamSnapshotData?>(null)
    private val lock = Mutex()
    @Volatile private var lastFetch = 0L

    private fun file(context: Context) = File(context.filesDir, "widget_team.json")

    fun flow(context: Context): StateFlow<TeamSnapshotData?> {
        if (_flow.value == null) _flow.value = read(context)
        return _flow.asStateFlow()
    }

    fun read(context: Context): TeamSnapshotData {
        _flow.value?.let { return it }
        return try {
            AppJson.decodeFromString(TeamSnapshotData.serializer(), file(context).readText())
        } catch (_: Exception) {
            TeamSnapshotData()
        }.also {
            _flow.value = it
            if (storedKey == null) storedKey = it.hashCode()
        }
    }

    /** Hash of the team data this process found on disk (what the widgets show when it starts). */
    @Volatile var storedKey: Int? = null
        private set

    private fun write(context: Context, data: TeamSnapshotData) {
        _flow.value = data
        runCatching { file(context).writeText(AppJson.encodeToString(TeamSnapshotData.serializer(), data)) }
    }

    /**
     * A timer tap: show it on this user's own team row right away (the next presence fetch confirms it).
     * Only the row's live part moves: what ran so far becomes completed time, the new run starts now.
     */
    fun applyLocalTimer(context: Context, snap: WidgetSnapshotData) {
        val cur = read(context)
        val next = withLocalTimer(cur, snap, System.currentTimeMillis()) ?: return
        write(context, next)
    }

    internal fun withLocalTimer(cur: TeamSnapshotData, snap: WidgetSnapshotData, now: Long): TeamSnapshotData? {
        if (!cur.loaded || cur.day != Time.today().toString()) return null
        val myId = cur.myId ?: snap.userId ?: return null
        val i = cur.members.indexOfFirst { it.userId == myId }
        if (i < 0) return null
        val m = cur.members[i]
        val r = snap.running
        if (m.startTime == r?.startTime && (r == null || m.taskName == r.taskName)) return null
        // The previous run (if any) counts up to where the new one starts (or now, for a stop).
        val today = Time.today()
        val until = minOf(now, r?.startTime ?: now)
        val done = m.todayMs + (m.startTime?.let { Time.liveRangeMs(it, until, Time.startOfDay(today), Time.endOfDay(today)) } ?: 0)
        val nm = m.copy(todayMs = done, startTime = r?.startTime, taskName = r?.taskName)
        return cur.copy(members = cur.members.toMutableList().also { it[i] = nm })
    }

    fun clear(context: Context) {
        _flow.value = TeamSnapshotData()
        runCatching { file(context).delete() }
        lastFetch = 0
    }

    /** Is any widget that shows the team on a home screen? (Nothing is fetched otherwise.) */
    suspend fun anyTeamWidget(context: Context): Boolean = runCatching {
        val m = GlanceAppWidgetManager(context)
        m.getGlanceIds(TeamWidget::class.java).isNotEmpty() || m.getGlanceIds(LargeTimerWidget::class.java).isNotEmpty()
    }.getOrDefault(false)

    /**
     * Fetch today's leaderboard and redraw the team widgets. [minGapMs] throttles bursts (socket events, several
     * triggers at once); pass 0 to force.
     */
    suspend fun refresh(context: Context, minGapMs: Long = 5_000) {
        val g = AppGraph.get(context)
        if (g.session.session.value == null) return
        if (!anyTeamWidget(context)) return
        lock.withLock {
            val now = System.currentTimeMillis()
            if (now - lastFetch < minGapMs) return
            lastFetch = now
            val today = Time.today().toString()
            val p: Presence = try {
                g.api.presence(today, "day")
            } catch (e: Exception) {
                Log.i(TAG, "presence failed: ${e.message}")
                lastFetch = 0
                return
            }
            val myId = g.repo.profile.value?.id ?: g.session.session.value?.userId
            val members = p.leaderboard.map { TeamMember(it.userId, it.name, it.todayMs, it.startTime, it.taskName) }
            var fresh = TeamSnapshotData(day = today, fetchedAt = now, myId = myId, members = members)
            // A timer tap the server hasn't seen yet: keep showing it on our own row (no flash back).
            if (g.engine.persisted.value.queue.isNotEmpty()) {
                fresh = withLocalTimer(fresh, WidgetSnapshot.read(context), now) ?: fresh
            }
            write(context, fresh)
            // The leaderboard also says whether *this* user is tracking. If that disagrees with the local timer
            // (started or stopped on another device while this one was asleep), fetch the timer truth now so the
            // timer widgets don't contradict the team row.
            val mine = members.firstOrNull { it.userId == myId }
            val local = g.engine.persisted.value
            if (mine != null && local.queue.isEmpty() && (mine.live != (local.running != null) || (mine.live && mine.startTime != local.running?.startTime))) {
                runCatching { g.engine.refreshTruth() }
            }
        }
        WidgetUpdater.updateTeam(context)
    }
}

/** Periodic team refresh (30 min, needs network) while a team widget is placed. */
class TeamRefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        if (!TeamSnapshot.anyTeamWidget(applicationContext)) {
            cancel(applicationContext); return Result.success()
        }
        TeamSnapshot.refresh(applicationContext, minGapMs = 60_000)
        return Result.success()
    }

    companion object {
        private const val NAME = "widget-team-refresh"

        fun ensure(context: Context) {
            val req = PeriodicWorkRequestBuilder<TeamRefreshWorker>(30, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(NAME)
        }
    }
}
