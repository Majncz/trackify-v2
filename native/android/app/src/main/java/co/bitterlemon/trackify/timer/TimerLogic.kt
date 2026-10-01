package co.bitterlemon.trackify.timer

import co.bitterlemon.trackify.util.MIN_EVENT_MS
import kotlin.math.min
import kotlin.math.pow

/**
 * Pure timer-engine rules (NATIVE_SPEC §3). No Android, no I/O — unit tested.
 */
object TimerLogic {
    data class Result(val state: TimerPersisted, val changed: Boolean)

    private var counter = 0L
    fun newId(now: Long): String = "op-$now-${counter++}-${(Math.random() * 1e6).toLong()}"

    /** Start or switch. Starting the running task is a no-op. */
    fun start(s: TimerPersisted, taskId: String, now: Long, id: String = newId(now)): Result {
        val cur = s.running
        if (cur != null && cur.taskId == taskId) return Result(s, false)
        val op = TimerOp.Switch(id, taskId, now, cur?.taskId, cur?.startTime)
        return Result(s.copy(running = Running(taskId, now), queue = s.queue + op, updatedAt = now), true)
    }

    /**
     * Stop the running timer at [at] (defaults to now), optionally saving from [startOverride].
     * If the start of this very run is still queued and the stretch is < 60 s, both collapse:
     * nothing reaches the server except (for a switch) saving the previous task up to the switch.
     */
    fun stop(
        s: TimerPersisted,
        now: Long,
        at: Long = now,
        startOverride: Long? = null,
        inFlightId: String? = null,
        id: String = newId(now),
    ): Result {
        val cur = s.running ?: return Result(s, false)
        val end = min(at, now)
        val start = startOverride ?: cur.startTime
        val last = s.queue.lastOrNull()
        if (last is TimerOp.Switch && last.taskId == cur.taskId && last.id != inFlightId &&
            last.at == cur.startTime && end - start < MIN_EVENT_MS
        ) {
            val rest = s.queue.dropLast(1)
            val replacement = if (last.prevTaskId != null && last.prevStart != null) {
                listOf(TimerOp.Stop(id, last.prevTaskId, last.at, last.prevStart))
            } else emptyList()
            return Result(s.copy(running = null, queue = rest + replacement, updatedAt = now), true)
        }
        val op = TimerOp.Stop(id, cur.taskId, end, cur.startTime, startOverride)
        return Result(s.copy(running = null, queue = s.queue + op, updatedAt = now), true)
    }

    /** Optimistically move the start of the running timer. */
    fun adjustStart(s: TimerPersisted, newStart: Long, now: Long, id: String = newId(now)): Result {
        val cur = s.running ?: return Result(s, false)
        if (cur.startTime == newStart) return Result(s, false)
        val op = TimerOp.AdjustStart(id, cur.taskId, newStart)
        return Result(s.copy(running = cur.copy(startTime = newStart), queue = s.queue + op, updatedAt = now), true)
    }

    /** Remove a finished op. */
    fun complete(s: TimerPersisted, opId: String, now: Long): TimerPersisted =
        s.copy(queue = s.queue.filterNot { it.id == opId }, updatedAt = now)

    /** Server truth may be adopted only when no local work is pending. */
    fun canAdoptTruth(s: TimerPersisted): Boolean = s.queue.isEmpty()

    fun adoptTruth(s: TimerPersisted, running: Running?, now: Long): TimerPersisted =
        if (!canAdoptTruth(s) || s.running == running) s else s.copy(running = running, updatedAt = now)

    /** Socket `timer:stopped {taskId}` — only clears when it is about the local task. */
    fun onRemoteStopped(s: TimerPersisted, taskId: String?, now: Long): TimerPersisted {
        if (!canAdoptTruth(s)) return s
        val cur = s.running ?: return s
        if (taskId != null && cur.taskId != taskId) return s
        return s.copy(running = null, updatedAt = now)
    }

    fun onRemoteStartUpdated(s: TimerPersisted, taskId: String, startTime: Long, now: Long): TimerPersisted {
        if (!canAdoptTruth(s)) return s
        val cur = s.running ?: return s
        if (cur.taskId != taskId) return s
        return s.copy(running = cur.copy(startTime = startTime), updatedAt = now)
    }

    /** HTTP status → what to do with the op (NATIVE_SPEC §3 sync loop). */
    fun classify(status: Int): OpOutcome = when {
        status in 200..299 -> OpOutcome.Done
        status == 401 -> OpOutcome.Unauthorized
        status == 408 || status == 429 || status >= 500 -> OpOutcome.Retry
        else -> OpOutcome.Rejected("")
    }

    /** 0.6 s × 1.6^attempt, max 8 s. */
    fun backoffMs(attempt: Int): Long = min(8000.0, 600.0 * 1.6.pow(attempt.toDouble())).toLong()

    /** Legacy flow: does a stretch qualify to be saved? */
    fun shouldSave(from: Long, to: Long) = to - from >= MIN_EVENT_MS

    /** Web idempotency: a 409 on replay counts as saved if an event matches within ±2 s. */
    fun matchesExisting(from: Long, to: Long, events: List<Pair<Long, Long>>): Boolean =
        events.any { (f, t) -> kotlin.math.abs(f - from) <= 2000 && kotlin.math.abs(t - to) <= 2000 }
}
