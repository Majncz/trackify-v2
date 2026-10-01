package co.bitterlemon.trackify.timer

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import co.bitterlemon.trackify.MainActivity
import co.bitterlemon.trackify.R
import co.bitterlemon.trackify.widget.WidgetSnapshotData

/** Ongoing "running timer" notification with chronometer + Stop + Switch… (promoted on Android 16). */
class TimerNotifier(private val context: Context) {
    companion object {
        const val CHANNEL_ID = "timer"
        const val NOTIFICATION_ID = 42
    }

    private var lastKey: String? = null

    init {
        val nm = context.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            val ch = NotificationChannel(CHANNEL_ID, "Running timer", NotificationManager.IMPORTANCE_DEFAULT).apply {
                description = "Shows the task you are tracking, with Stop and Switch"
                setSound(null, null)
                enableVibration(false)
                setShowBadge(false)
            }
            nm.createNotificationChannel(ch)
        }
    }

    fun canPost(): Boolean =
        Build.VERSION.SDK_INT < 33 ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    private var serviceRunning = false

    fun update(snap: WidgetSnapshotData) {
        val r = snap.running
        if (!snap.signedIn || r == null) {
            cancel(); return
        }
        val key = "${r.taskId}|${r.startTime}|${r.pending}|${r.taskName}"
        if (key == lastKey) return
        if (!canPost()) return
        lastKey = key
        val n = build(snap) ?: return
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, n)
        } catch (_: SecurityException) {
        }
        if (!serviceRunning) {
            serviceRunning = true
            TimerLiveService.start(context)
        }
    }

    /** The running-timer notification for this snapshot, or null when idle / signed out. */
    fun build(snap: WidgetSnapshotData): Notification? {
        val r = snap.running
        if (!snap.signedIn || r == null) return null

        val open = PendingIntent.getActivity(
            context, 0,
            Intent(context, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val stop = TimerActionReceiver.pending(context, TimerActionReceiver.ACTION_STOP)
        val switch = PendingIntent.getActivity(
            context, 1,
            Intent(context, QuickPickerActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )
        val b = NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_timer)
            .setContentTitle(r.taskName)
            .setContentText(if (r.pending) "Syncing…" else "Since ${co.bitterlemon.trackify.util.Time.clock(r.startTime)}")
            // The task's colour tints the icon and the actions, like the dot everywhere else in the app.
            .setColor(co.bitterlemon.trackify.util.Accents.parseHex(r.accentHex)?.let { 0xFF000000.toInt() or it } ?: 0xFF22C55E.toInt())
            .setWhen(r.startTime)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setCategory(NotificationCompat.CATEGORY_STOPWATCH)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setContentIntent(open)
            .addAction(R.drawable.ic_stop, "Stop", stop)
            .addAction(R.drawable.ic_swap, "Switch…", switch)
            .setRequestPromotedOngoing(true)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
        return b.build()
    }

    fun cancel() {
        lastKey = null
        if (serviceRunning) {
            serviceRunning = false
            TimerLiveService.stop(context)
        }
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }

    /** Re-post from the latest snapshot (e.g. right after the permission was granted). */
    fun invalidate() {
        lastKey = null
        update(co.bitterlemon.trackify.widget.WidgetSnapshot.read(context))
    }
}
