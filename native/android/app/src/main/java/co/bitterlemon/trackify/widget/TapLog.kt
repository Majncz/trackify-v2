package co.bitterlemon.trackify.widget

import android.content.Context
import co.bitterlemon.trackify.data.AppJson
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import java.io.File
import java.util.concurrent.Executors

/**
 * On-device timeline of widget / tile / notification taps (More → About → Widget diagnostics), so a slow or
 * flipping Stop can be read off a real phone without adb. The last [MAX] taps are kept in memory and in a tiny
 * file; recording is a few list appends on the tap thread, and everything else (standby bucket, battery
 * optimisation, disk) happens on a background thread.
 */
@Serializable
data class TapStage(val name: String, val at: Long)

@Serializable
data class TapRecord(
    val id: Long,
    val wall: Long,
    val op: String,
    val source: String,
    val cold: Boolean,
    val procAgeMs: Long,
    val bucket: String = "?",
    val batteryOpt: String = "?",
    val fgService: Boolean = false,
    val host: String = "",
    val stages: List<TapStage> = emptyList(),
    val notes: List<String> = emptyList(),
    /** Task id the widget should show after this tap ("none" = idle). */
    val intended: String? = null,
    val opIds: List<String> = emptyList(),
)

object TapLog {
    const val MAX = 30
    private const val WINDOW_MS = 30_000L

    private val lock = Any()
    private var records: MutableList<TapRecord> = mutableListOf()
    private var loaded = false
    private var startMs = 0L
    @Volatile private var currentId = -1L
    private var counter = 0L
    private var lastReason: Pair<String, Long>? = null
    private var lastPushState: String? = null
    private val io by lazy { Executors.newSingleThreadExecutor { r -> Thread(r, "trackify-taplog").apply { isDaemon = true } } }
    @Volatile private var fileRef: File? = null

    private fun now() = System.nanoTime() / 1_000_000L

    private fun file(context: Context) = File(context.filesDir, "tap_log.json").also { fileRef = it }

    private fun ensureLoaded(context: Context?) {
        if (loaded) return
        val f = context?.let { file(it) } ?: fileRef ?: return
        loaded = true
        runCatching {
            if (f.exists()) records = AppJson.decodeFromString(ListSerializer(TapRecord.serializer()), f.readText()).toMutableList()
        }
        counter = (records.maxOfOrNull { it.id } ?: 0L)
    }

    /** A tap arrived (broadcast received). [op] = START / STOP / TOGGLE / PAGE, [source] = widget / tile / notification. */
    fun begin(context: Context, op: String, source: String, procAgeMs: Long, cold: Boolean, host: String = "") {
        val app = context.applicationContext
        synchronized(lock) {
            ensureLoaded(app)
            startMs = now()
            counter++
            currentId = counter
            records.add(TapRecord(counter, System.currentTimeMillis(), op, source, cold, procAgeMs, host = host, stages = listOf(TapStage("recv", 0))))
            while (records.size > MAX) records.removeAt(0)
            lastPushState = null
        }
        io.execute { fillEnvironment(app, currentId) }
    }

    private fun fillEnvironment(context: Context, id: Long) {
        val bucket = runCatching {
            if (android.os.Build.VERSION.SDK_INT < 28) return@runCatching "n/a (API<28)"
            val um = context.getSystemService(android.app.usage.UsageStatsManager::class.java)
            when (val b = um.appStandbyBucket) {
                10 -> "ACTIVE"; 20 -> "WORKING_SET"; 30 -> "FREQUENT"; 40 -> "RARE"; 45 -> "RESTRICTED"; 5 -> "EXEMPTED"; 50 -> "NEVER"
                else -> "bucket $b"
            }
        }.getOrDefault("?")
        val batt = runCatching {
            val pm = context.getSystemService(android.os.PowerManager::class.java)
            if (pm.isIgnoringBatteryOptimizations(context.packageName)) "unrestricted" else "optimised"
        }.getOrDefault("?")
        val fg = co.bitterlemon.trackify.timer.TimerLiveService.running
        synchronized(lock) {
            val i = records.indexOfFirst { it.id == id }
            if (i >= 0) records[i] = records[i].copy(bucket = bucket, batteryOpt = batt, fgService = fg)
        }
        save()
    }

    private fun update(id: Long, block: (TapRecord) -> TapRecord) {
        val i = records.indexOfLast { it.id == id }
        if (i >= 0) records[i] = block(records[i])
    }

    private fun withinWindow(): Boolean = currentId >= 0 && now() - startMs < WINDOW_MS

    /** A stage of the current tap, timed from its arrival. */
    fun stage(name: String) {
        synchronized(lock) {
            if (!withinWindow()) return
            val at = now() - startMs
            update(currentId) { it.copy(stages = it.stages + TapStage(name, at)) }
        }
        save()
    }

    fun note(text: String) {
        synchronized(lock) {
            if (!withinWindow()) return
            val at = now() - startMs
            update(currentId) { it.copy(notes = it.notes + "+$at $text") }
        }
        save()
    }

    /** Server host of the current tap (from the stored snapshot). */
    fun host(url: String) {
        val h = runCatching { android.net.Uri.parse(if (url.contains("://")) url else "https://$url").host }.getOrNull() ?: url
        synchronized(lock) { if (currentId >= 0) update(currentId) { it.copy(host = h ?: "") } }
    }

    /** What the widget should show after the current tap (task id, or "none"). */
    fun setIntended(taskId: String?, opId: String?) {
        synchronized(lock) {
            if (!withinWindow()) return
            update(currentId) { it.copy(intended = taskId ?: "none", opIds = if (opId != null) it.opIds + opId else it.opIds) }
        }
    }

    /** Server-op stage, for the tap that created op [opId]. */
    fun opStage(opId: String, name: String) {
        if (currentId < 0) return
        synchronized(lock) {
            val r = records.lastOrNull { opId in it.opIds } ?: return
            val at = (now() - startMs).takeIf { r.id == currentId } ?: (System.currentTimeMillis() - r.wall)
            update(r.id) { it.copy(stages = it.stages + TapStage(name, at)) }
        }
        save()
    }

    /** Why the next state change (socket event, refresh…) happens; used to explain a flip-back. */
    fun reason(text: String) {
        if (currentId < 0) return
        lastReason = text to now()
    }

    /** A push of widget pixels: does it contradict what the last tap intended? */
    fun observePush(runningTaskId: String?) {
        val state = runningTaskId ?: "none"
        synchronized(lock) {
            val prev = lastPushState
            lastPushState = state
            if (!withinWindow()) return
            val rec = records.lastOrNull { it.id == currentId } ?: return
            val want = rec.intended ?: return
            if (state != want && prev != state) {
                val r = lastReason?.takeIf { now() - it.second < 15_000 }?.first ?: "unknown"
                val at = now() - startMs
                update(currentId) { it.copy(notes = it.notes + "+$at FLIP-BACK: widget now shows ${label(state)} instead of ${label(want)} (reason: $r)") }
            }
        }
        save()
    }

    private fun label(s: String) = if (s == "none") "idle" else "task ${s.take(6)}"

    fun all(context: Context): List<TapRecord> = synchronized(lock) { ensureLoaded(context); records.toList() }

    fun clear(context: Context) {
        synchronized(lock) { ensureLoaded(context); records.clear(); currentId = -1 }
        save()
    }

    private fun save() {
        io.execute {
            val f = fileRef ?: return@execute
            val snapshot = synchronized(lock) { records.toList() }
            runCatching {
                val tmp = File(f.parentFile, f.name + ".tmp")
                tmp.writeText(AppJson.encodeToString(ListSerializer(TapRecord.serializer()), snapshot))
                tmp.renameTo(f)
            }
        }
    }

    // ---- Text --------------------------------------------------------------------------------------------------

    private val clock by lazy { java.text.SimpleDateFormat("HH:mm:ss", java.util.Locale.US) }

    /** "14:02:11 STOP · widget · cold · recv +0 · applied +12 · drawn +140 · …" plus a line of environment. */
    fun format(r: TapRecord): String {
        val sb = StringBuilder()
        sb.append(synchronized(clock) { clock.format(java.util.Date(r.wall)) }).append(' ').append(r.op)
            .append(" · ").append(r.source).append(" · ").append(if (r.cold) "cold" else "warm")
        for (s in r.stages) sb.append(" · ").append(s.name).append(" +").append(s.at)
        val flip = r.notes.filter { it.contains("FLIP-BACK") }
        sb.append(" · flip-back: ").append(if (flip.isEmpty()) "none" else flip.size.toString() + "x")
        sb.append("\n    process age ${r.procAgeMs} ms · standby ${r.bucket} · battery ${r.batteryOpt} · timer service ${if (r.fgService) "on" else "off"} · ${r.host.ifEmpty { "?" }}")
        for (n in r.notes) sb.append("\n    ").append(n)
        return sb.toString()
    }

    fun text(context: Context): String {
        val list = all(context)
        val head = "Trackify ${co.bitterlemon.trackify.BuildConfig.VERSION_NAME} · ${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL} · Android ${android.os.Build.VERSION.RELEASE} (API ${android.os.Build.VERSION.SDK_INT})"
        return head + "\n" + list.reversed().joinToString("\n") { format(it) }
    }
}
