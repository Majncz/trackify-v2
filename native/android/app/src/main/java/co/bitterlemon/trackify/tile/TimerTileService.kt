package co.bitterlemon.trackify.tile

import android.content.ComponentName
import android.content.Context
import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.R
import co.bitterlemon.trackify.util.Time
import co.bitterlemon.trackify.widget.WidgetSnapshot

/** Quick Settings tile: tap = stop the running timer / start the last task. */
class TimerTileService : TileService() {
    override fun onStartListening() {
        super.onStartListening()
        render()
    }

    override fun onClick() {
        super.onClick()
        val graph = AppGraph.get(this)
        if (graph.session.session.value == null) {
            render(); return
        }
        val snap = WidgetSnapshot.read(this)
        graph.engine.toggle(snap.lastTaskId)
        // Snapshot is rebuilt asynchronously; render optimistic state now.
        render(optimisticRunning = graph.engine.persisted.value.running != null)
    }

    private fun render(optimisticRunning: Boolean? = null) {
        val tile = qsTile ?: return
        val graph = AppGraph.get(this)
        val snap = WidgetSnapshot.read(this)
        val running = graph.engine.persisted.value.running
        val isRunning = optimisticRunning ?: (running != null)
        tile.icon = Icon.createWithResource(this, R.drawable.ic_stat_timer)
        if (graph.session.session.value == null) {
            tile.state = Tile.STATE_UNAVAILABLE
            tile.label = "Trackify"
            if (Build.VERSION.SDK_INT >= 29) tile.subtitle = "Signed out"
        } else if (isRunning && running != null) {
            val name = snap.tasks.firstOrNull { it.id == running.taskId }?.name ?: snap.running?.taskName ?: "Tracking"
            tile.state = Tile.STATE_ACTIVE
            tile.label = name
            if (Build.VERSION.SDK_INT >= 29) tile.subtitle = "Since ${Time.clock(running.startTime)} · tap to stop"
        } else {
            val last = snap.tasks.firstOrNull { it.id == snap.lastTaskId }
            tile.state = Tile.STATE_INACTIVE
            tile.label = "Trackify"
            if (Build.VERSION.SDK_INT >= 29) tile.subtitle = last?.let { "Start ${it.name}" } ?: "Idle"
        }
        tile.updateTile()
    }

    companion object {
        fun requestUpdate(context: Context) {
            try {
                requestListeningState(context, ComponentName(context, TimerTileService::class.java))
            } catch (_: Exception) {
            }
        }
    }
}
