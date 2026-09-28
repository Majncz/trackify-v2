package co.bitterlemon.trackify.widget

import android.content.Context
import co.bitterlemon.trackify.data.AppJson
import co.bitterlemon.trackify.data.Task
import co.bitterlemon.trackify.data.TaskSort
import co.bitterlemon.trackify.timer.Running
import co.bitterlemon.trackify.util.Time
import kotlinx.serialization.Serializable
import java.io.File

@Serializable
data class SnapshotRunning(val taskId: String, val taskName: String, val accentHex: String, val startTime: Long, val pending: Boolean = false)

@Serializable
data class SnapshotTask(val id: String, val name: String, val accentHex: String, val todayMs: Long, val totalMs: Long)

/** Shared snapshot for widgets / tile / notification / shortcuts (NATIVE_SPEC §6). */
@Serializable
data class WidgetSnapshotData(
    val signedIn: Boolean = false,
    val serverUrl: String = "",
    val userId: String? = null,
    val updatedAt: Long = 0,
    val running: SnapshotRunning? = null,
    /** Completed events today (local); add the live part at render time. */
    val todayTotalMs: Long = 0,
    val tasks: List<SnapshotTask> = emptyList(),
    val lastTaskId: String? = null,
    /** Local calendar day the today numbers belong to. */
    val day: String = "",
    /** Widget appearance: "system" | "light" | "dark". */
    val theme: String = "system",
    /** Last "couldn't save" message from the timer queue, shown briefly on the widgets. */
    val notice: String? = null,
    val noticeAt: Long = 0,
    /**
     * Monotonic build number. A widget tap pushes RemoteViews itself (FastWidgets); a Glance composition of an
     * older snapshot must never land on top of it.
     */
    val version: Long = 0,
) {
    fun noticeNow(now: Long): String? = notice?.takeIf { now - noticeAt in 0..90_000 }

    fun todayTotalLive(now: Long): Long {
        val r = running ?: return todayTotalMs
        val today = Time.today()
        return todayTotalMs + Time.liveRangeMs(r.startTime, now, Time.startOfDay(today), Time.endOfDay(today))
    }
}

object WidgetSnapshot {
    @Volatile private var cached: WidgetSnapshotData? = null

    /** Render key of the snapshot this process found on disk (what the widgets show when it starts). */
    @Volatile var storedRenderKey: Int? = null
        private set
    @Volatile var storedSnapshotKey: String? = null
        private set
    private val _flow = kotlinx.coroutines.flow.MutableStateFlow<WidgetSnapshotData?>(null)

    /** Live snapshot for running Glance sessions (they recompose on change). */
    fun flow(context: Context): kotlinx.coroutines.flow.StateFlow<WidgetSnapshotData?> {
        if (_flow.value == null) _flow.value = read(context)
        return _flow
    }

    @Volatile private var notice: Pair<String, Long>? = null

    /** Remember a timer error for the widgets (the next build shows it). */
    fun setNotice(message: String) {
        notice = message to System.currentTimeMillis()
    }

    fun build(signedIn: Boolean, server: String, userId: String?, running: Running?, pending: Boolean, tasks: List<Task>?, theme: String = "system", prev: WidgetSnapshotData? = null): WidgetSnapshotData {
        val n = notice
        // Cold start: the tasks cache is still loading. Keep the last snapshot's lists and only move the timer,
        // so a widget tap can redraw right away without waiting for (or wiping) the task list.
        if (tasks == null && signedIn && prev != null && prev.signedIn && prev.userId == userId && prev.day == Time.today().toString()) {
            val t = running?.let { r -> prev.tasks.firstOrNull { it.id == r.taskId } }
            return prev.copy(
                updatedAt = System.currentTimeMillis(), version = nextVersion(prev), theme = theme, notice = n?.first, noticeAt = n?.second ?: 0,
                running = running?.let { SnapshotRunning(it.taskId, t?.name ?: prev.running?.takeIf { p -> p.taskId == it.taskId }?.taskName ?: "Task", t?.accentHex ?: "#22c55e", it.startTime, pending) },
                lastTaskId = running?.taskId ?: prev.lastTaskId,
            )
        }
        val list = tasks ?: emptyList()
        val today = Time.today()
        val dayStart = Time.startOfDay(today)
        val dayEnd = Time.endOfDay(today) + 1
        val sorted = TaskSort.home(list, running?.taskId)
        fun todayOf(t: Task) = t.events.sumOf { Time.overlap(it.fromMs, it.toMs, dayStart, dayEnd) }
        val runTask = running?.let { r -> list.firstOrNull { it.id == r.taskId } }
        return WidgetSnapshotData(
            signedIn = signedIn,
            serverUrl = server,
            userId = userId,
            updatedAt = System.currentTimeMillis(),
            running = running?.let {
                SnapshotRunning(it.taskId, runTask?.name ?: "Task", runTask?.accent ?: "#22c55e", it.startTime, pending)
            },
            todayTotalMs = list.sumOf { todayOf(it) },
            theme = theme,
            tasks = sorted.take(12).map { t ->
                SnapshotTask(t.id, t.name, t.accent, todayOf(t), t.events.sumOf { (it.toMs - it.fromMs).coerceAtLeast(0) })
            },
            lastTaskId = TaskSort.lastUsed(list)?.id ?: sorted.firstOrNull()?.id,
            day = today.toString(),
            notice = n?.first,
            noticeAt = n?.second ?: 0,
            version = nextVersion(prev),
        )
    }

    private fun nextVersion(prev: WidgetSnapshotData?): Long =
        maxOf((prev?.version ?: 0) + 1, (cached?.version ?: 0) + 1)

    /** The newer of two snapshots (by [WidgetSnapshotData.version]). */
    fun newest(a: WidgetSnapshotData?, b: WidgetSnapshotData): WidgetSnapshotData = if (a != null && a.version >= b.version) a else b

    private fun file(context: Context) = File(context.filesDir, "widget_snapshot.json")

    /**
     * Build and store the next snapshot atomically: [block] reads the live state (timer, tasks) under the lock,
     * so two writers (a widget tap on the main thread, the app's debounced sync) can't store an older state last.
     */
    fun update(context: Context, stamp: () -> List<Any?> = { emptyList() }, block: (prev: WidgetSnapshotData) -> WidgetSnapshotData): WidgetSnapshotData {
        // Build outside the lock (a full build walks every event), store only if nothing changed meanwhile —
        // so a tap on the main thread never waits for a background rebuild.
        repeat(3) {
            val prev = read(context)
            val s0 = stamp()
            val next = block(prev)
            synchronized(this) {
                if (read(context) === prev && sameRefs(stamp(), s0)) {
                    write(context, next)
                    return next
                }
            }
        }
        return synchronized(this) { block(read(context)).also { write(context, it) } }
    }

    private fun sameRefs(a: List<Any?>, b: List<Any?>) = a.size == b.size && a.indices.all { a[it] === b[it] }

    fun write(context: Context, data: WidgetSnapshotData) {
        cached = data
        // Running Glance sessions recompose from this flow right away: they must never hold an older state (an
        // explicit Glance update re-sends a session's last composition).
        _flow.value = data
        val f = file(context)
        co.bitterlemon.trackify.util.Persist.write(f.path) {
            try {
                f.writeText(AppJson.encodeToString(WidgetSnapshotData.serializer(), data))
            } catch (_: Exception) {
            }
        }
    }

    fun read(context: Context): WidgetSnapshotData {
        cached?.let { return it }
        return try {
            AppJson.decodeFromString(WidgetSnapshotData.serializer(), file(context).readText()).also {
                cached = it
                if (storedRenderKey == null) storedRenderKey = WidgetUpdater.renderKey(it)
                if (storedSnapshotKey == null) storedSnapshotKey = it.copy(updatedAt = 0, version = 0).hashCode().toString()
            }
        } catch (_: Exception) {
            WidgetSnapshotData()
        }
    }
}
