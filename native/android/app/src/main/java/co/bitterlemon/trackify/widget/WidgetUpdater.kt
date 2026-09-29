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

    /**
     * Widgets are drawn only by [FastWidgets] (RemoteViews handed straight to the launcher); there is no Glance
     * session any more, so nothing can land on top of a newer state or replace the animated layout.
     */
    fun updateAll(context: Context, force: Boolean = false) {
        if (force) FastWidgets.pushAsync(context, force = true)
    }

    /** How long a Glance session used to wait behind a fast push (kept for the team refresh's pacing). */
    const val SETTLE_MS = 0L

    /** Redraw now (always, no dedupe) and wait for it — for background actions and app updates. */
    suspend fun updateAllNow(context: Context) {
        FastWidgets.push(context, force = true)
    }

    /** Team data changed: the fast push that follows a refresh already drew it. */
    suspend fun updateTeam(context: Context) {}

    fun requestTileUpdate(context: Context) = TimerTileService.requestUpdate(context)
}
