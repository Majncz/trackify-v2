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

        /**
         * Send the queue now, for taps outside the app (widgets). The tap redraws and returns at once; this job
         * keeps the process running (not frozen) while the request goes out. Expedited on Android 12+, where
         * it needs no notification.
         */
        fun expedite(context: Context) {
            val b = OneTimeWorkRequestBuilder<TimerSyncWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 15, TimeUnit.SECONDS)
            if (android.os.Build.VERSION.SDK_INT >= 31) b.setExpedited(androidx.work.OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            WorkManager.getInstance(context).enqueueUniqueWork("$NAME-now", ExistingWorkPolicy.APPEND_OR_REPLACE, b.build())
        }

        fun cancel(context: Context) {
            WorkManager.getInstance(context).cancelUniqueWork(NAME)
            WorkManager.getInstance(context).cancelUniqueWork("$NAME-now")
        }
    }
}
