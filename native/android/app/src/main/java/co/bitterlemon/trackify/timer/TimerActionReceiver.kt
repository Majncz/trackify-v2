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
        /** Turn the large widget's task list to the next / previous page (extra [EXTRA_DIR]). */
        const val ACTION_PAGE = "co.bitterlemon.trackify.PAGE"
        const val EXTRA_DIR = "dir"
        const val EXTRA_TASK = "taskId"

        /**
         * The intent for a timer tap. The data URI names the command, so PendingIntents for different commands
         * never collapse into one (extras don't count for PendingIntent identity).
         */
        fun intent(context: Context, action: String, taskId: String? = null, source: String = "widget"): Intent {
            val i = Intent(context, TimerActionReceiver::class.java).setAction(action)
                // Foreground broadcast: delivered from the foreground queue (not behind other apps' background
                // broadcasts) and our process runs at foreground priority until the redraw is done.
                .addFlags(Intent.FLAG_RECEIVER_FOREGROUND)
                .setData(Uri.parse("trackify-timer://${action.substringAfterLast('.').lowercase()}/${Uri.encode(taskId ?: "")}?src=$source"))
            if (taskId != null) i.putExtra(EXTRA_TASK, taskId)
            return i
        }

        fun pending(context: Context, action: String, taskId: String? = null, source: String = "notification"): PendingIntent =
            PendingIntent.getBroadcast(context, 0, intent(context, action, taskId, source), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)

        /** Has this process handled a tap broadcast yet? (The first one after a cold start pays for start-up.) */
        private val firstTap = java.util.concurrent.atomic.AtomicBoolean(true)
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action == ACTION_PAGE) {
            co.bitterlemon.trackify.widget.Paging.move(context, intent.getIntExtra(EXTRA_DIR, 1))
            val app = context.applicationContext
            val pending = goAsync()
            AppGraph.get(context).scope.launch {
                try {
                    co.bitterlemon.trackify.widget.FastWidgets.push(app, force = true, animate = true)
                } finally {
                    pending?.finish()
                }
            }
            return
        }
        val op = when (intent.action) {
            ACTION_STOP -> TimerTap.Op.STOP
            ACTION_START -> TimerTap.Op.START
            ACTION_TOGGLE -> TimerTap.Op.TOGGLE
            else -> return
        }
        // Before anything else: log the arrival and put the "Stopping… / Starting…" overlay on the widgets. Both
        // are a few binder calls, no composition, so the tap is acknowledged on screen even if the real redraw
        // (Compose + Glance on a cold process) takes a while.
        val procAge = android.os.SystemClock.uptimeMillis() - android.os.Process.getStartUptimeMillis()
        val cold = firstTap.getAndSet(false) && procAge < 5_000
        co.bitterlemon.trackify.widget.TapLog.begin(context, op.name, intent.data?.getQueryParameter("src") ?: "widget", procAge, cold)
        co.bitterlemon.trackify.widget.FastWidgets.showPending(context, when (op) { TimerTap.Op.STOP -> "Stopping…"; TimerTap.Op.START -> "Starting…"; else -> "Updating…" })
        co.bitterlemon.trackify.widget.TapLog.stage("overlay")
        val app = context.applicationContext
        if (!TimerTap.apply(context, op, intent.getStringExtra(EXTRA_TASK))) {
            // Signed out: nothing changes, take the overlay away again.
            co.bitterlemon.trackify.widget.FastWidgets.pushAsync(app, force = true)
            return
        }
        co.bitterlemon.trackify.widget.Paging.reset(context)
        // Never block the broadcast on the network: the next tap would queue behind it.
        val pending = goAsync()
        AppGraph.get(context).scope.launch {
            try {
                TimerTap.redraw(context)
            } finally {
                pending?.finish()
            }
        }
    }
}
