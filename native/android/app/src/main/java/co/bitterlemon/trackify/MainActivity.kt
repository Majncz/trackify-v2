package co.bitterlemon.trackify

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import co.bitterlemon.trackify.ui.AppRoot
import co.bitterlemon.trackify.ui.theme.TrackifyTheme
import co.bitterlemon.trackify.util.Shortcuts

class MainActivity : ComponentActivity() {
    /** Deep link target (e.g. "task/<id>") requested by an intent. */
    val pendingRoute = mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT),
            navigationBarStyle = SystemBarStyle.auto(android.graphics.Color.TRANSPARENT, android.graphics.Color.TRANSPARENT),
        )
        super.onCreate(savedInstanceState)
        val graph = AppGraph.get(this)
        handleIntent(intent)
        setContent {
            val theme by graph.session.theme.collectAsState()
            TrackifyTheme(theme) {
                AppRoot(pendingRoute)
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleIntent(intent)
    }

    private fun handleIntent(intent: Intent?) {
        val graph = AppGraph.get(this)
        if (graph.session.session.value == null) return
        when (intent?.action) {
            Shortcuts.ACTION_START -> intent.getStringExtra("taskId")?.let { graph.engine.start(it) }
            Shortcuts.ACTION_STOP -> graph.engine.stop()
        }
        intent?.getStringExtra("route")?.let { pendingRoute.value = it }
        if (intent?.action == Shortcuts.ACTION_START || intent?.action == Shortcuts.ACTION_STOP) {
            intent.action = Intent.ACTION_MAIN
        }
    }
}
