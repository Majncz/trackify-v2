package co.bitterlemon.trackify

import android.app.Application

class TrackifyApp : Application() {
    override fun onCreate() {
        super.onCreate()
        AppGraph.get(this)
    }
}
