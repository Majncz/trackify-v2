package co.bitterlemon.trackify.timer

import android.content.Context
import android.util.Log
import co.bitterlemon.trackify.data.ApiClient
import co.bitterlemon.trackify.data.ApiException
import co.bitterlemon.trackify.data.AppJson
import co.bitterlemon.trackify.data.NetworkException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.delay
import java.io.File

/** What the UI renders. */
data class TimerUi(
    val running: Running? = null,
    /** Any op not yet confirmed — shows the calm "Syncing…" pulse. */
    val pending: Boolean = false,
    /** A stop is queued ("Saving…" on stop buttons). */
    val saving: Boolean = false,
    /** Tasks whose stretch is still being saved (yellow pending ring on their cards). */
    val savingTaskIds: Set<String> = emptySet(),
)

sealed class AdjustResult {
    data object Ok : AdjustResult()
    data class Error(val message: String) : AdjustResult()
}

/**
 * Timer engine (NATIVE_SPEC §3): optimistic local state + a persisted FIFO op queue replayed
 * one op at a time with backoff. Shared by the app, notification actions, widgets, tile and worker.
 */
class TimerEngine(
    context: Context,
    private val api: ApiClient,
    private val serverUrl: () -> String,
    private val userId: () -> String?,
    private val onUnauthorized: () -> Unit,
    private val onOpApplied: () -> Unit,
    private val scheduleBackgroundSync: (Boolean) -> Unit,
) {
    private val file = File(context.filesDir, "timer_state.json")
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private val lock = Mutex()
    private val wake = Channel<Unit>(Channel.CONFLATED)

    private val _state = MutableStateFlow(load())
    val persisted: StateFlow<TimerPersisted> = _state.asStateFlow()

    private val _ui = MutableStateFlow(toUi(_state.value))
    val ui: StateFlow<TimerUi> = _ui.asStateFlow()

    private val _errors = MutableSharedFlow<String>(extraBufferCapacity = 8)
    /** "Couldn't save: …" banners. */
    val errors: SharedFlow<String> = _errors.asSharedFlow()

    @Volatile private var inFlightId: String? = null
    private var loopJob: Job? = null
    private var attempt = 0

    private fun toUi(s: TimerPersisted) = TimerUi(
        running = s.running,
        pending = s.queue.isNotEmpty(),
        saving = s.queue.any { it is TimerOp.Stop },
        savingTaskIds = s.queue.mapNotNull {
            when (it) {
                is TimerOp.Stop -> it.taskId
                is TimerOp.Switch -> it.prevTaskId
                else -> null
            }
        }.toSet(),
    )

    private fun load(): TimerPersisted = try {
        if (file.exists()) AppJson.decodeFromString(TimerPersisted.serializer(), file.readText()) else TimerPersisted()
    } catch (e: Exception) {
        Log.w(TAG, "timer state unreadable, starting fresh", e)
        TimerPersisted()
    }

    private fun save(s: TimerPersisted) {
        try {
            val tmp = File(file.parentFile, file.name + ".tmp")
            tmp.writeText(AppJson.encodeToString(TimerPersisted.serializer(), s))
            tmp.renameTo(file)
        } catch (e: Exception) {
            Log.e(TAG, "save failed", e)
        }
    }

    private fun set(s: TimerPersisted) {
        val scoped = s.copy(userId = userId() ?: s.userId)
        _state.value = scoped
        _ui.value = toUi(scoped)
        save(scoped)
        scheduleBackgroundSync(scoped.queue.isNotEmpty())
    }

    private inline fun mutate(block: (TimerPersisted) -> TimerPersisted) {
        synchronized(this) {
            val next = block(_state.value)
            if (next != _state.value) set(next)
        }
    }

    // ----------------- user actions (optimistic) -----------------

    fun start(taskId: String) {
        mutate { TimerLogic.start(it, taskId, System.currentTimeMillis()).state }
        kick()
    }

    fun stop() {
        mutate { TimerLogic.stop(it, System.currentTimeMillis(), inFlightId = inFlightId).state }
        kick()
    }

    /** Toggle used by the tile / small widget: stop if running, else start [fallbackTaskId]. */
    fun toggle(fallbackTaskId: String?) {
        if (_state.value.running != null) stop() else if (fallbackTaskId != null) start(fallbackTaskId)
    }

    /** "Stop N min ago" from the Fix-session dialog (optionally with a moved start). */
    fun stopAt(endMs: Long, startOverride: Long?) {
        val now = System.currentTimeMillis()
        mutate { TimerLogic.stop(it, now, at = endMs, startOverride = startOverride, inFlightId = inFlightId).state }
        kick()
    }

    /**
     * "Save start time": tries the server right away so a 409 can be shown inline in the dialog.
     * Offline (or with other work queued) it applies optimistically and queues.
     */
    suspend fun adjustStart(newStart: Long): AdjustResult {
        val cur = _state.value.running ?: return AdjustResult.Error("No active timer found to adjust")
        if (_state.value.queue.isEmpty()) {
            try {
                val res = api.timerAdjust(cur.taskId, newStart)
                mutate {
                    val r = it.running
                    if (r != null && r.taskId == cur.taskId) it.copy(running = r.copy(startTime = res.startTime ?: newStart)) else it
                }
                onOpApplied()
                return AdjustResult.Ok
            } catch (e: ApiException) {
                if (e.status == 401) {
                    onUnauthorized(); return AdjustResult.Error("Session expired")
                }
                if (!e.isRetryable) return AdjustResult.Error(e.message ?: "Couldn't adjust the start")
            } catch (_: NetworkException) {
                // fall through to queue
            }
        }
        mutate { TimerLogic.adjustStart(it, newStart, System.currentTimeMillis()).state }
        kick()
        return AdjustResult.Ok
    }

    // ----------------- truth -----------------

    fun adoptServer(running: Running?) {
        mutate { TimerLogic.adoptTruth(it, running, System.currentTimeMillis()) }
    }

    fun onRemoteStarted(taskId: String, startTime: Long) = adoptServer(Running(taskId, startTime))

    fun onRemoteStopped(taskId: String?) {
        mutate { TimerLogic.onRemoteStopped(it, taskId, System.currentTimeMillis()) }
    }

    fun onRemoteStartUpdated(taskId: String, startTime: Long) {
        mutate { TimerLogic.onRemoteStartUpdated(it, taskId, startTime, System.currentTimeMillis()) }
    }

    /** GET /api/timer and adopt it if nothing is queued. */
    suspend fun refreshTruth() {
        if (_state.value.queue.isNotEmpty() || userId() == null) return
        try {
            val t = api.timer()
            adoptServer(if (t.running && t.taskId != null && t.startTime != null) Running(t.taskId, t.startTime) else null)
        } catch (_: Exception) {
        }
    }

    /** Wipe local state (sign out / account switch). */
    fun clear() {
        synchronized(this) { set(TimerPersisted(legacyServer = _state.value.legacyServer)) }
    }

    /** Called at startup: drop state that belongs to another account. */
    fun ensureUser(uid: String?) {
        val s = _state.value
        if (uid != null && s.userId != null && s.userId != uid) clear()
    }

    // ----------------- sync loop -----------------

    /** Wake the sync loop now (after an action, reconnect, foreground, network available). */
    fun kick() {
        attempt = 0
        wake.trySend(Unit)
        if (loopJob?.isActive != true) {
            loopJob = scope.launch { loop() }
        }
    }

    /**
     * Send the head of the queue (under the lock, so the loop and [drain] never send the same op twice) and
     * apply the outcome. Returns null when there is nothing to do.
     */
    private suspend fun step(): OpOutcome? = lock.withLock {
        val op = _state.value.queue.firstOrNull() ?: return@withLock null
        if (userId() == null) return@withLock null
        val outcome = send(op)
        when (outcome) {
            OpOutcome.Done -> {
                attempt = 0
                mutate { TimerLogic.complete(it, op.id, System.currentTimeMillis()) }
            }
            is OpOutcome.Rejected -> {
                attempt = 0
                mutate { TimerLogic.complete(it, op.id, System.currentTimeMillis()) }
                _errors.tryEmit(outcome.message)
            }
            else -> Unit
        }
        outcome
    }

    private suspend fun afterApplied() {
        if (_state.value.queue.isEmpty()) refreshTruth()
        onOpApplied()
    }

    private suspend fun loop() {
        while (true) {
            when (step() ?: break) {
                OpOutcome.Done, is OpOutcome.Rejected -> afterApplied()
                OpOutcome.Unauthorized -> {
                    onUnauthorized(); break
                }
                OpOutcome.Retry -> {
                    val wait = TimerLogic.backoffMs(attempt++)
                    withTimeoutOrNull(wait) { wake.receive() }
                }
            }
        }
    }

    /** Replay everything now (WorkManager, notification/widget actions). Returns true when the queue is empty. */
    suspend fun drain(maxMillis: Long = 60_000): Boolean {
        val deadline = System.currentTimeMillis() + maxMillis
        var tries = 0
        while (System.currentTimeMillis() < deadline) {
            when (step() ?: return true) {
                OpOutcome.Done, is OpOutcome.Rejected -> afterApplied()
                OpOutcome.Unauthorized -> {
                    onUnauthorized(); return true
                }
                OpOutcome.Retry -> {
                    if (++tries >= 3) return false
                    delay(TimerLogic.backoffMs(tries))
                }
            }
        }
        return _state.value.queue.isEmpty()
    }

    private fun legacy(): Boolean = _state.value.legacyServer == serverUrl()

    private fun markLegacy() {
        mutate { it.copy(legacyServer = serverUrl()) }
    }

    private suspend fun send(op: TimerOp): OpOutcome = withContext(Dispatchers.IO) {
        inFlightId = op.id
        try {
            when (op) {
                is TimerOp.Switch -> sendSwitch(op)
                is TimerOp.Stop -> sendStop(op)
                is TimerOp.AdjustStart -> {
                    api.timerAdjust(op.taskId, op.newStart); OpOutcome.Done
                }
            }
        } catch (e: ApiException) {
            outcomeFor(e)
        } catch (_: NetworkException) {
            OpOutcome.Retry
        } catch (e: Exception) {
            Log.w(TAG, "op failed", e)
            OpOutcome.Retry
        } finally {
            inFlightId = null
        }
    }

    private fun outcomeFor(e: ApiException): OpOutcome = when (val c = TimerLogic.classify(e.status)) {
        is OpOutcome.Rejected -> OpOutcome.Rejected(e.message ?: "Request failed")
        else -> c
    }

    private suspend fun sendSwitch(op: TimerOp.Switch): OpOutcome {
        if (!legacy()) {
            try {
                api.timerSwitch(op.taskId, op.at)
                return OpOutcome.Done
            } catch (e: ApiException) {
                if (!e.isRouteMissing) return outcomeFor(e)
                markLegacy()
            }
        }
        // Web flow (WEB_AUDIT §4.5): save the previous stretch, then start.
        var warning: String? = null
        if (op.prevTaskId != null && op.prevStart != null && TimerLogic.shouldSave(op.prevStart, op.at)) {
            when (val r = legacySaveStretch(op.prevTaskId, op.prevStart, op.at)) {
                OpOutcome.Done -> Unit
                is OpOutcome.Rejected -> warning = r.message
                else -> return r
            }
        }
        api.timerStart(op.taskId, op.at)
        return if (warning != null) OpOutcome.Rejected(warning) else OpOutcome.Done
    }

    private suspend fun sendStop(op: TimerOp.Stop): OpOutcome {
        if (!legacy()) {
            try {
                api.timerStop(op.taskId, endTime = op.at, startTime = op.startOverride)
                return OpOutcome.Done
            } catch (e: ApiException) {
                if (!e.isRouteMissing) return outcomeFor(e)
                markLegacy()
            }
        }
        val from = op.startOverride ?: op.start
        var warning: String? = null
        if (TimerLogic.shouldSave(from, op.at)) {
            when (val r = legacySaveStretch(op.taskId, from, op.at)) {
                OpOutcome.Done -> Unit
                is OpOutcome.Rejected -> warning = r.message
                else -> return r
            }
        }
        try {
            api.timerDelete(op.taskId)
        } catch (e: ApiException) {
            if (e.status == 401) return OpOutcome.Unauthorized
            if (e.isRetryable) return OpOutcome.Retry
            // other rejections of DELETE count as ok (web)
        }
        return if (warning != null) OpOutcome.Rejected(warning) else OpOutcome.Done
    }

    private suspend fun legacySaveStretch(taskId: String, from: Long, to: Long): OpOutcome {
        return try {
            api.createEvent(taskId, from, to)
            OpOutcome.Done
        } catch (e: ApiException) {
            if (e.status == 409) {
                val existing = runCatching { api.events(taskId) }.getOrNull()
                if (existing != null && TimerLogic.matchesExisting(from, to, existing.map { it.fromMs to it.toMs })) {
                    OpOutcome.Done
                } else OpOutcome.Rejected(e.message ?: "Overlap")
            } else outcomeFor(e)
        }
    }

    companion object {
        private const val TAG = "TimerEngine"
    }
}
