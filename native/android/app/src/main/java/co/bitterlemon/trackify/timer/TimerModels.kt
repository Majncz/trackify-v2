package co.bitterlemon.trackify.timer

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

/** The running timer as this device believes it (optimistic). */
@Serializable
data class Running(val taskId: String, val startTime: Long)

/** A queued timer mutation, replayed FIFO until the server accepts or definitively rejects it. */
@Serializable
sealed class TimerOp {
    abstract val id: String
    abstract val taskId: String

    /** Start [taskId] at [at]; the server saves whatever ran before up to [at]. [prev*] feed the legacy fallback. */
    @Serializable
    @SerialName("switch")
    data class Switch(
        override val id: String,
        override val taskId: String,
        val at: Long,
        val prevTaskId: String? = null,
        val prevStart: Long? = null,
    ) : TimerOp()

    /** Stop [taskId] at [at] saving [startOverride ?: start, at]. */
    @Serializable
    @SerialName("stop")
    data class Stop(
        override val id: String,
        override val taskId: String,
        val at: Long,
        val start: Long,
        val startOverride: Long? = null,
    ) : TimerOp()

    /** Move the running timer's start ("Fix this session"). */
    @Serializable
    @SerialName("adjust")
    data class AdjustStart(
        override val id: String,
        override val taskId: String,
        val newStart: Long,
    ) : TimerOp()
}

@Serializable
data class TimerPersisted(
    val userId: String? = null,
    val running: Running? = null,
    val queue: List<TimerOp> = emptyList(),
    /** Server lacks /api/timer/switch|stop (answered with a route-missing 404) → use the web flow. */
    val legacyServer: String? = null,
    val updatedAt: Long = 0,
)

/** Outcome of sending one op. */
sealed class OpOutcome {
    data object Done : OpOutcome()
    data object Retry : OpOutcome()
    data object Unauthorized : OpOutcome()
    data class Rejected(val message: String) : OpOutcome()
}
