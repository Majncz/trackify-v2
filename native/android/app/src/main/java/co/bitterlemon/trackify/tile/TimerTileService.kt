package co.bitterlemon.trackify.tile

import android.content.ComponentName
import android.content.Context
import android.graphics.drawable.Icon
import android.os.Build
import android.service.quicksettings.Tile
import android.service.quicksettings.TileService
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.R
import co.bitterlemon.trackify.timer.TimerTap
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
        // Same fast path as the widgets: local state, widget pixels, then notification + sync in the background.
        TimerTap.tap(this, TimerTap.Op.TOGGLE, null)
        render()
    }

    private fun render() {
        val tile = qsTile ?: return
        // The snapshot says who is signed in; the engine has the timer (neither needs the session loaded).
        val snap = WidgetSnapshot.read(this)
        val running = if (snap.signedIn) AppGraph.get(this).engine.persisted.value.running else null
        tile.icon = Icon.createWithResource(this, R.drawable.ic_stat_timer)
        if (!snap.signedIn) {
            tile.state = Tile.STATE_UNAVAILABLE
            tile.label = "Trackify"
            if (Build.VERSION.SDK_INT >= 29) tile.subtitle = "Signed out"
        } else if (running != null) {
            val name = snap.tasks.firstOrNull { it.id == running.taskId }?.name ?: snap.running?.taskName ?: "Tracking"
            tile.state = Tile.STATE_ACTIVE
            tile.label = name
            if (Build.VERSION.SDK_INT >= 29) tile.subtitle = "Since ${Time.clock(running.startTime)} · tap to stop"
            if (Build.VERSION.SDK_INT >= 30) tile.stateDescription = "Tracking $name"
        } else {
            val last = snap.tasks.firstOrNull { it.id == snap.lastTaskId }
            tile.state = Tile.STATE_INACTIVE
            tile.label = "Trackify"
            if (Build.VERSION.SDK_INT >= 29) tile.subtitle = last?.let { "Tap to resume ${it.name}" } ?: "Not tracking"
            if (Build.VERSION.SDK_INT >= 30) tile.stateDescription = "Not tracking"
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
