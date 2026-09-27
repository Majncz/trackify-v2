package co.bitterlemon.trackify.timer

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import co.bitterlemon.trackify.AppGraph
import java.util.concurrent.TimeUnit

/** Replays the timer queue in the background once the network is back (survives process death). */
class TimerSyncWorker(context: Context, params: WorkerParameters) : CoroutineWorker(context, params) {
    override suspend fun doWork(): Result {
        val graph = AppGraph.get(applicationContext)
        if (graph.session.session.value == null) return Result.success()
        val empty = graph.engine.drain(45_000)
        if (empty) graph.repo.refreshCore()
        graph.syncSurfacesNow()
        return if (empty) Result.success() else Result.retry()
    }

    companion object {
        private const val NAME = "timer-sync"

        fun schedule(context: Context) {
            val req = OneTimeWorkRequestBuilder<TimerSyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setInitialDelay(5, TimeUnit.SECONDS)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork(NAME, ExistingWorkPolicy.KEEP, req)
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(NAME)
        }
    }
}
