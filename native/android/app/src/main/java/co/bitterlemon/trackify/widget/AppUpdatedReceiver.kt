package co.bitterlemon.trackify.widget

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import co.bitterlemon.trackify.AppGraph
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.flow.first

/**
 * After an app update the launcher keeps showing the widgets' old RemoteViews until something redraws
 * them. Rebuild the snapshot from the cached data and force both Glance widgets (and the tile) to redraw now.
 */
class AppUpdatedReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Intent.ACTION_MY_PACKAGE_REPLACED) return
        val graph = AppGraph.get(context)
        val pending = goAsync()
        graph.scope.launch {
            try {
                // Cached tasks load asynchronously on process start; give them a moment so the widget isn't empty.
                if (graph.session.session.value != null) withTimeoutOrNull(3_000) { graph.repo.tasks.first { it != null } }
                graph.syncSurfaces()
                WidgetUpdater.updateAllNow(context)
            } finally {
                pending.finish()
            }
        }
    }
}
