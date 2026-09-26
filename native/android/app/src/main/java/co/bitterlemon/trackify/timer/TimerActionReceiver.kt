package co.bitterlemon.trackify.timer

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import co.bitterlemon.trackify.AppGraph

/** Notification / widget actions → timer engine (optimistic; WorkManager replays if offline). */
class TimerActionReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_STOP = "co.bitterlemon.trackify.STOP"
        const val ACTION_START = "co.bitterlemon.trackify.START"
        const val ACTION_TOGGLE = "co.bitterlemon.trackify.TOGGLE"
        const val EXTRA_TASK = "taskId"

        fun pending(context: Context, action: String, taskId: String? = null): PendingIntent {
            val i = Intent(context, TimerActionReceiver::class.java).setAction(action)
            if (taskId != null) i.putExtra(EXTRA_TASK, taskId)
            val code = (action + (taskId ?: "")).hashCode()
            return PendingIntent.getBroadcast(context, code, i, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        }
    }

    override fun onReceive(context: Context, intent: Intent) {
        val graph = AppGraph.get(context)
        if (graph.session.session.value == null) return
        when (intent.action) {
            ACTION_STOP -> graph.engine.stop()
            ACTION_START -> intent.getStringExtra(EXTRA_TASK)?.let { graph.engine.start(it) }
            ACTION_TOGGLE -> graph.engine.toggle(intent.getStringExtra(EXTRA_TASK))
        }
    }
}
