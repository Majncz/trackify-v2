package co.bitterlemon.trackify.timer

import android.content.Context
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import co.bitterlemon.trackify.AppGraph
import java.util.concurrent.TimeUnit

/**
 * While a timer runs (the ongoing notification is shown), re-checks `GET /api/timer` every 15 min so a stop made
 * on another device clears the notification, widgets and tile even if our process was killed (no push yet).
 */
class TimerRefreshWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val graph = AppGraph.get(applicationContext)
        if (graph.session.session.value == null) {
            cancel(applicationContext); return Result.success()
        }
        graph.engine.refreshTruth()
        graph.repo.refreshTasks()
        graph.syncSurfaces()
        if (graph.engine.persisted.value.running == null) cancel(applicationContext)
        return Result.success()
    }

    companion object {
        private const val NAME = "timer-refresh"

        fun schedule(context: Context) {
            val req = PeriodicWorkRequestBuilder<TimerRefreshWorker>(15, TimeUnit.MINUTES)
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInitialDelay(15, TimeUnit.MINUTES)
                .build()
            WorkManager.getInstance(context).enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.KEEP, req)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(NAME)
        }
    }
}
