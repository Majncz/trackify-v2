package co.bitterlemon.trackify.timer

import android.content.Context
import android.os.SystemClock
import android.util.Log
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.widget.FastWidgets
import co.bitterlemon.trackify.widget.TeamSnapshot
import co.bitterlemon.trackify.widget.WidgetSnapshot
import co.bitterlemon.trackify.widget.WidgetUpdater
import kotlinx.coroutines.launch

/**
 * Timer taps outside the app (widgets, notification actions, Quick Settings tile, the Switch… picker).
 *
 * The fast path: [apply] changes the local timer state (memory + a small file), builds the next widget snapshot
 * and returns — no DataStore, no Keystore, no network, no WorkManager. [redraw] then pushes the new widget
 * pixels itself ([FastWidgets]) and only afterwards hands the rest (notification, tile, shortcuts, server sync)
 * to the app graph.
 */
object TimerTap {
    private const val TAG = "TrackifyTap"

    enum class Op { START, STOP, TOGGLE }

    /** Taps whose widget redraw hasn't finished yet (process start-up work waits for them). */
    private val inFlight = java.util.concurrent.atomic.AtomicInteger(0)

    /** Start-up work: give a tap that started this process the CPU first (bounded). */
    suspend fun awaitIdle(maxMs: Long = 1_500) {
        kotlinx.coroutines.delay(40) // the tap's broadcast is dispatched right after Application.onCreate
        val until = SystemClock.uptimeMillis() + maxMs
        while (inFlight.get() > 0 && SystemClock.uptimeMillis() < until) kotlinx.coroutines.delay(20)
    }

    /** [apply] + [redraw] in one go, for callers that aren't broadcasts (tile, picker). */
    fun tap(context: Context, op: Op, taskId: String?, source: String = "tile"): Boolean {
        val procAge = SystemClock.uptimeMillis() - android.os.Process.getStartUptimeMillis()
        co.bitterlemon.trackify.widget.TapLog.begin(context, op.name, source, procAge, procAge < 5_000)
        if (!apply(context, op, taskId)) return false
        AppGraph.get(context).scope.launch { redraw(context) }
        return true
    }

    /** Apply [op] locally. False when signed out (nothing to do). Cheap enough for the main thread. */
    fun apply(context: Context, op: Op, taskId: String?): Boolean {
        val t0 = SystemClock.uptimeMillis()
        val prev = WidgetSnapshot.read(context)
        if (!prev.signedIn) return false
        co.bitterlemon.trackify.widget.TapLog.host(prev.serverUrl)
        inFlight.incrementAndGet()
        val g = AppGraph.get(context)
        val t1 = SystemClock.uptimeMillis()
        when (op) {
            Op.START -> taskId?.let { g.engine.start(it) }
            Op.STOP -> g.engine.stop()
            Op.TOGGLE -> g.engine.toggle(taskId ?: prev.lastTaskId)
        }
        val t2 = SystemClock.uptimeMillis()
        val snap = g.buildSnapshot(fromSnapshot = true)
        val t3 = SystemClock.uptimeMillis()
        co.bitterlemon.trackify.widget.TapLog.setIntended(snap.running?.taskId, g.engine.persisted.value.queue.lastOrNull()?.id)
        co.bitterlemon.trackify.widget.TapLog.stage("applied")
        TeamSnapshot.applyLocalTimer(context, snap)
        Log.i(TAG, "tap $op ${taskId ?: ""} applied in ${SystemClock.uptimeMillis() - t0} ms (graph ${t1 - t0}, timer ${t2 - t1}, snapshot ${t3 - t2}; v${snap.version}, process up ${SystemClock.uptimeMillis() - android.os.Process.getStartUptimeMillis()} ms)")
        return true
    }

    /**
     * Push the widgets now, then the other surfaces and the server sync. Waits only for local work, never for the
     * network.
     */
    suspend fun redraw(context: Context) {
        val t0 = SystemClock.uptimeMillis()
        try {
            runCatching { FastWidgets.push(context) }.onFailure { Log.w(TAG, "fast push failed", it); FastWidgets.hidePending(context) }
        } finally {
            inFlight.updateAndGet { maxOf(0, it - 1) }
        }
        val g = AppGraph.get(context)
        WidgetUpdater.requestTileUpdate(context)
        runCatching { g.syncSurfaces() }
        if (g.engine.persisted.value.queue.isNotEmpty()) runCatching { TimerSyncWorker.expedite(context) }
        Log.i(TAG, "redraw + follow-ups in ${SystemClock.uptimeMillis() - t0} ms")
    }
}
