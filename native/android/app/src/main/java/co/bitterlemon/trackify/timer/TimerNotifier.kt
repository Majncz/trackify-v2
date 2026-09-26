package co.bitterlemon.trackify.timer

import android.Manifest
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

    fun update(snap: WidgetSnapshotData) {
        val r = snap.running
        if (!snap.signedIn || r == null) {
            cancel(); return
        }
        val key = "${r.taskId}|${r.startTime}|${r.pending}|${r.taskName}"
        if (key == lastKey) return
        if (!canPost()) return
        lastKey = key

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
            .setContentText(if (r.pending) "Syncing…" else "Tracking since ${co.bitterlemon.trackify.util.Time.clock(r.startTime)}")
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
        try {
            NotificationManagerCompat.from(context).notify(NOTIFICATION_ID, b.build())
        } catch (_: SecurityException) {
        }
    }

    fun cancel() {
        lastKey = null
        NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
    }

    fun invalidate() {
        lastKey = null
    }
}
