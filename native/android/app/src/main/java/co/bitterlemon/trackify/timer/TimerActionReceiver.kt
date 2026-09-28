package co.bitterlemon.trackify.timer

import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import co.bitterlemon.trackify.AppGraph
import kotlinx.coroutines.launch

/**
 * Widget buttons and notification actions → [TimerTap]: change the local timer, push the widget pixels ourselves,
 * then the rest (notification, tile, server sync). Explicit and not exported; Glance's action receiver, sessions
 * and WorkManager are not on this path.
 */
class TimerActionReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_STOP = "co.bitterlemon.trackify.STOP"
        const val ACTION_START = "co.bitterlemon.trackify.START"
        const val ACTION_TOGGLE = "co.bitterlemon.trackify.TOGGLE"
        const val EXTRA_TASK = "taskId"

        /**
         * The intent for a timer tap. The data URI names the command, so PendingIntents for different commands
         * never collapse into one (extras don't count for PendingIntent identity).
         */
        fun intent(context: Context, action: String, taskId: String? = null): Intent {
            val i = Intent(context, TimerActionReceiver::class.java).setAction(action)
                // Foreground broadcast: delivered from the foreground queue (not behind other apps' background
                // broadcasts) and our process runs at foreground priority until the redraw is done.
                .addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
                .setData(Uri.parse("trackify-timer://${action.substringAfterLast('.').lowercase()}/${Uri.encode(taskId ?: "")}"))
            if (taskId != null) i.putExtra(EXTRA_TASK, taskId)
            return i
        }

        fun pending(context: Context, action: String, taskId: String? = null): PendingIntent =
            PendingIntent.getBroadcast(context, 0, intent(context, action, taskId), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

    override fun onReceive(context: Context, intent: Intent) {
        val op = when (intent.action) {
            ACTION_STOP -> TimerTap.Op.STOP
            ACTION_START -> TimerTap.Op.START
            ACTION_TOGGLE -> TimerTap.Op.TOGGLE
            else -> return
        }
        if (!TimerTap.apply(context, op, intent.getStringExtra(EXTRA_TASK))) return
        // Never block the broadcast on the network: the next tap would queue behind it.
        val pending = goAsync()
        AppGraph.get(context).scope.launch {
            try {
                TimerTap.redraw(context)
            } finally {
                pending.finish()
            }
        }
    }
}
