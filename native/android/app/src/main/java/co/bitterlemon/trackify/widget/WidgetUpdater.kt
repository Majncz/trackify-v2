package co.bitterlemon.trackify.widget

import android.content.Context
import androidx.glance.appwidget.GlanceAppWidgetManager
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
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

object WidgetUpdater {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    @Volatile private var lastKey: String? = null

    /** Timer widget id → key of the snapshot it last composed (see [renderKey]). */
    private val rendered = MutableStateFlow<Map<String, Int>>(emptyMap())

    /** What a timer widget shows, minus fields that don't change its pixels. */
    fun renderKey(s: WidgetSnapshotData): Int =
        s.copy(updatedAt = 0, running = s.running?.copy(pending = false)).hashCode()

    internal fun markRendered(widgetId: String, key: Int) {
        if (rendered.value[widgetId] == key) return
        rendered.value = rendered.value + (widgetId to key)
    }

    fun updateAll(context: Context, force: Boolean = false) {
        val snap = WidgetSnapshot.read(context)
        // Skip no-op redraws (the snapshot's updatedAt changes on every build).
        val key = snap.copy(updatedAt = 0).hashCode().toString()
        if (!force && key == lastKey) return
        lastKey = key
        scope.launch { updateTimerWidgets(context) }
    }

    /** Both timer widgets at once (a closed Glance session takes a few hundred ms to start). */
    private suspend fun updateTimerWidgets(context: Context) = coroutineScope {
        listOf(
            async { runCatching { SmallTimerWidget().updateAll(context) } },
            async { runCatching { LargeTimerWidget().updateAll(context) } },
        ).awaitAll()
    }

    /** Redraw now (always, no dedupe) and wait for it — for background actions and app updates. */
    suspend fun updateAllNow(context: Context) {
        lastKey = WidgetSnapshot.read(context).copy(updatedAt = 0).hashCode().toString()
        updateTimerWidgets(context)
    }

    /**
     * Redraw the timer widgets and wait (up to [timeoutMs]) until every placed one has composed the current
     * snapshot. Widget taps call this before they return, so the new state is on screen even if the system
     * freezes the process right afterwards.
     */
    suspend fun redrawAndWait(context: Context, timeoutMs: Long = 2_000) {
        val want = renderKey(WidgetSnapshot.read(context))
        updateAllNow(context)
        val ids = runCatching {
            val m = GlanceAppWidgetManager(context)
            (m.getGlanceIds(SmallTimerWidget::class.java) + m.getGlanceIds(LargeTimerWidget::class.java)).map { it.toString() }
        }.getOrDefault(emptyList())
        if (ids.isEmpty()) return
        withTimeoutOrNull(timeoutMs) { rendered.first { map -> ids.all { map[it] == want } } }
        // Composition is done; give Glance a moment to hand the RemoteViews to the launcher.
        delay(60)
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
