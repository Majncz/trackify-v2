package co.bitterlemon.trackify.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import android.os.Bundle
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Every widget receiver draws itself through [FastWidgets] the moment the system asks (placed, resized, rotated,
 * periodic update, restored), so a widget's first picture never waits for Glance's WorkManager session. On some
 * phones (Samsung battery management, restricted standby) that job starts seconds late, or never, and the widget
 * stayed on its loading layout. Glance's own session still runs and settles the state afterwards.
 */
abstract class FastAwareReceiver : GlanceAppWidgetReceiver() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        drawNow(context)
    }

    override fun onAppWidgetOptionsChanged(context: Context, appWidgetManager: AppWidgetManager, appWidgetId: Int, newOptions: Bundle) {
        super.onAppWidgetOptionsChanged(context, appWidgetManager, appWidgetId, newOptions)
        drawNow(context)
    }

    override fun onRestored(context: Context, oldWidgetIds: IntArray, newWidgetIds: IntArray) {
        super.onRestored(context, oldWidgetIds, newWidgetIds)
        drawNow(context)
    }

    private fun drawNow(context: Context) {
        val app = context.applicationContext
        val pending = goAsync()
        CoroutineScope(Dispatchers.Default).launch {
            try {
                withTimeoutOrNull(8_000) { FastWidgets.push(app, force = true) }
            } finally {
                pending.finish()
            }
        }
    }
}
