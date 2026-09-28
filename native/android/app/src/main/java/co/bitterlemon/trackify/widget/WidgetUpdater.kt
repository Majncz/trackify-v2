package co.bitterlemon.trackify.widget

import android.content.Context
import androidx.glance.appwidget.updateAll
import co.bitterlemon.trackify.tile.TimerTileService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch

object WidgetUpdater {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    @Volatile private var lastKey: String? = null

    /** Timer widget id → key of the snapshot it last composed (see [renderKey]). */
    private val rendered = MutableStateFlow<Map<String, Int>>(emptyMap())

    /** What a timer widget shows, minus fields that don't change its pixels. */
    fun renderKey(s: WidgetSnapshotData): Int =
        s.copy(updatedAt = 0, version = 0, running = s.running?.copy(pending = false)).hashCode()

    internal fun markRendered(widgetId: String, key: Int) {
        if (rendered.value[widgetId] == key) return
        rendered.value = rendered.value + (widgetId to key)
    }

    fun updateAll(context: Context, force: Boolean = false) {
        val snap = WidgetSnapshot.read(context)
        // Skip no-op redraws (the snapshot's updatedAt changes on every build).
        val key = snap.copy(updatedAt = 0, version = 0).hashCode().toString()
        // A fresh process: the widgets already show the stored snapshot (drawn by the previous process).
        if (lastKey == null) WidgetSnapshot.storedSnapshotKey?.let { lastKey = it }
        if (!force && key == lastKey) return
        lastKey = key
        // FastWidgets has already drawn this state. Glance settles it a little later (a session that is alive
        // recomposes from the snapshot flow anyway; this starts one if none is).
        pending?.cancel()
        pending = scope.launch {
            delay(SETTLE_MS)
            updateTimerWidgets(context)
        }
    }

    private var pending: kotlinx.coroutines.Job? = null

    /** How long Glance waits behind a fast push (FastWidgets) before it redraws the same state. */
    const val SETTLE_MS = 1_500L

    /** Both timer widgets at once (a closed Glance session takes a few hundred ms to start). */
    private suspend fun updateTimerWidgets(context: Context) = coroutineScope {
        listOf(
            async { runCatching { SmallTimerWidget().updateAll(context) } },
            async { runCatching { LargeTimerWidget().updateAll(context) } },
        ).awaitAll()
    }

    /** Redraw now (always, no dedupe) and wait for it — for background actions and app updates. */
    suspend fun updateAllNow(context: Context) {
        lastKey = WidgetSnapshot.read(context).copy(updatedAt = 0, version = 0).hashCode().toString()
        updateTimerWidgets(context)
    }

    /** Team data changed: redraw the widgets that show it. */
    suspend fun updateTeam(context: Context) = coroutineScope {
        listOf(
            async { runCatching { TeamWidget().updateAll(context) } },
            async { runCatching { LargeTimerWidget().updateAll(context) } },
        ).awaitAll()
    }

    fun requestTileUpdate(context: Context) = TimerTileService.requestUpdate(context)
}
