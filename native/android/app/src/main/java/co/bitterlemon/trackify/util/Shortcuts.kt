package co.bitterlemon.trackify.util

import android.content.Context
import android.content.Intent
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import androidx.core.graphics.drawable.IconCompat
import co.bitterlemon.trackify.MainActivity
import co.bitterlemon.trackify.R
import co.bitterlemon.trackify.widget.WidgetSnapshotData

/** Dynamic launcher shortcuts: "Start <task>" for the 4 most recent tasks (+ Stop while running). */
object Shortcuts {
    const val ACTION_START = "co.bitterlemon.trackify.shortcut.START"
    const val ACTION_STOP = "co.bitterlemon.trackify.shortcut.STOP"
    private var lastKey: String? = null

    fun update(context: Context, snap: WidgetSnapshotData) {
        val runningId = snap.running?.taskId
        val candidates = snap.tasks.filter { it.id != runningId }.take(if (runningId != null) 3 else 4)
        val key = snap.signedIn.toString() + runningId + candidates.joinToString { it.id + it.name }
        if (key == lastKey) return
        lastKey = key
        try {
            if (!snap.signedIn) {
                ShortcutManagerCompat.removeAllDynamicShortcuts(context); return
            }
            val list = mutableListOf<ShortcutInfoCompat>()
            if (snap.running != null) {
                list += ShortcutInfoCompat.Builder(context, "stop")
                    .setShortLabel("Stop timer")
                    .setLongLabel("Stop ${snap.running.taskName}")
                    .setIcon(IconCompat.createWithResource(context, R.drawable.ic_shortcut_stop))
                    .setIntent(Intent(context, MainActivity::class.java).setAction(ACTION_STOP))
                    .setRank(0)
                    .build()
            }
            candidates.forEachIndexed { i, t ->
                list += ShortcutInfoCompat.Builder(context, "task-${t.id}")
                    .setShortLabel(t.name.take(24))
                    .setLongLabel("Start ${t.name}".take(40))
                    .setIcon(IconCompat.createWithResource(context, R.drawable.ic_shortcut_play))
                    .setIntent(Intent(context, MainActivity::class.java).setAction(ACTION_START).putExtra("taskId", t.id))
                    .setRank(i + 1)
                    .build()
            }
            ShortcutManagerCompat.setDynamicShortcuts(context, list)
        } catch (_: Exception) {
        }
    }
}
