package co.bitterlemon.trackify

import android.app.Application
import androidx.work.Configuration

/**
 * WorkManager is initialised on demand (Configuration.Provider; its start-up initializer is removed in the
 * manifest), so a process started by a widget tap doesn't set it up on the main thread before the tap runs.
 */
class TrackifyApp : Application(), Configuration.Provider {
    override val workManagerConfiguration: Configuration
        get() = Configuration.Builder().build()

    override fun onCreate() {
        super.onCreate()
        AppGraph.get(this)
    }
}
