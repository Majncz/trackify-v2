package co.bitterlemon.trackify.timer

import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.widget.WidgetSnapshot

/**
 * Keeps the process (and its Socket.IO connection to our own server) alive while a timer
 * runs, so a stop/switch made on another device reaches the notification, widgets and
 * tile within seconds — no third-party push. It owns the existing timer notification and
 * stops itself as soon as nothing is running.
 */
class TimerLiveService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val graph = AppGraph.get(applicationContext)
        val snap = WidgetSnapshot.read(applicationContext)
        val notification = graph.notifier.build(snap)
        if (notification == null) {
            stopSelf()
            return START_NOT_STICKY
        }
        try {
            ServiceCompat.startForeground(
                this, TimerNotifier.NOTIFICATION_ID, notification,
                if (Build.VERSION.SDK_INT >= 34) ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE else 0,
            )
        } catch (e: Exception) {
            Log.w("TimerLiveService", "could not go foreground", e)
            stopSelf()
            return START_NOT_STICKY
        }
        graph.updateSocket()
        return START_STICKY
    }

    companion object {
        fun start(context: Context) {
            try {
                ContextCompat.startForegroundService(context, Intent(context, TimerLiveService::class.java))
            } catch (e: Exception) {
                // Background-start limits (Android 12+): the plain notification + periodic check still work.
                Log.w("TimerLiveService", "start refused", e)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, TimerLiveService::class.java))
        }
    }
}
