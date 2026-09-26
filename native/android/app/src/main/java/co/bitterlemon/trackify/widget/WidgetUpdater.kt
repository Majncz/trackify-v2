package co.bitterlemon.trackify.widget

import android.content.Context
import androidx.glance.appwidget.updateAll
import co.bitterlemon.trackify.tile.TimerTileService
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

object WidgetUpdater {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var lastKey: String? = null

    fun updateAll(context: Context, force: Boolean = false) {
        val snap = WidgetSnapshot.read(context)
        // Skip no-op redraws (the snapshot's updatedAt changes on every build).
        val key = snap.copy(updatedAt = 0).hashCode().toString()
        if (!force && key == lastKey) return
        lastKey = key
        scope.launch {
            runCatching { SmallTimerWidget().updateAll(context) }
            runCatching { LargeTimerWidget().updateAll(context) }
        }
    }

    fun requestTileUpdate(context: Context) = TimerTileService.requestUpdate(context)
}
