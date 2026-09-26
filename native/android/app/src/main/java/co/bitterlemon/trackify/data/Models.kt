package co.bitterlemon.trackify.data

import co.bitterlemon.trackify.util.Accents
import co.bitterlemon.trackify.util.Time
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.Transient
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject

@Serializable
data class TokenResponse(val token: String, val expiresAt: String? = null, val user: TokenUser)

@Serializable
data class TokenUser(val id: String, val email: String)

@Serializable
data class Event(
    val id: String,
    val from: String,
    val to: String,
    val name: String = "Time entry",
    val taskId: String = "",
    val paymentRecordId: String? = null,
    val paidAmount: Double? = null,
) {
    @Transient val fromMs: Long = Time.parse(from)
    @Transient val toMs: Long = Time.parse(to)
}

@Serializable
data class TaskGroupRef(val id: String, val name: String, val color: String? = null) {
    val accent: String get() = Accents.resolveGroupAccent(id, color)
}

@Serializable
data class Task(
    val id: String,
    val name: String,
    val hidden: Boolean = false,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val userId: String? = null,
    val taskGroupId: String? = null,
    val events: List<Event> = emptyList(),
    val taskGroup: TaskGroupRef? = null,
) {
    /** Group accent if grouped, else the stable task accent (billing / widget chrome). */
    val accent: String get() = taskGroup?.accent ?: Accents.taskAccentHex(id)
}

@Serializable
data class Group(
    val id: String,
    val name: String,
    val color: String? = null,
    val userId: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val taskIds: List<String> = emptyList(),
) {
    val accent: String get() = Accents.resolveGroupAccent(id, color)
}

@Serializable
data class TimerState(val running: Boolean = false, val taskId: String? = null, val startTime: Long? = null)

@Serializable
data class SwitchResponse(val running: Boolean = true, val taskId: String? = null, val startTime: Long? = null)

@Serializable
data class StopResponse(val stopped: Boolean = false, val running: Boolean = false, val skipped: Boolean? = null)

@Serializable
data class StatsTask(val taskId: String, val taskName: String, val totalTime: Long = 0, val todayTime: Long = 0)

@Serializable
data class Stats(val tasks: List<StatsTask> = emptyList(), val grandTotal: Long = 0, val todayTotal: Long = 0)

@Serializable
data class Profile(val id: String? = null, val email: String = "", val displayName: String = "")

@Serializable
data class PresenceEntry(
    val userId: String,
    val name: String,
    val taskName: String? = null,
    val startTime: Long? = null,
    val todayMs: Long = 0,
)

@Serializable
data class LeaderboardEntry(
    val userId: String,
    val name: String,
    val todayMs: Long = 0,
    val startTime: Long? = null,
    val taskName: String? = null,
)

@Serializable
data class Presence(
    val tracking: List<PresenceEntry> = emptyList(),
    val leaderboard: List<LeaderboardEntry> = emptyList(),
    val day: String? = null,
    val range: String? = null,
    val isToday: Boolean = true,
    val isCurrent: Boolean? = null,
)

@Serializable
data class RaceUser(val id: String, val name: String, val color: String? = null)

@Serializable
data class RaceEvent(val userId: String, val from: Long, val to: Long)

@Serializable
data class RaceData(
    val from: String = "",
    val to: String = "",
    val rangeStart: Long = 0,
    val rangeEnd: Long = 0,
    val users: List<RaceUser> = emptyList(),
    val events: List<RaceEvent> = emptyList(),
)

// ---- Billing ----

@Serializable
data class BillingTaskRef(val id: String, val name: String, val hidden: Boolean = false, val taskGroup: TaskGroupRef? = null)

@Serializable
data class BillingTask(
    val id: String,
    val taskId: String,
    val userId: String? = null,
    val hourlyRate: Double = 0.0,
    val currency: String = "CZK",
    val roundingMins: Int = 0,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val task: BillingTaskRef? = null,
)

@Serializable
data class BillingSession(
    val id: String,
    val from: String,
    val to: String,
    val name: String = "",
    val taskId: String,
    val taskName: String = "",
    val taskGroup: TaskGroupRef? = null,
    val hourlyRate: Double = 0.0,
    val currency: String = "CZK",
    val rawDurationMinutes: Int = 0,
    val durationMinutes: Int = 0,
    val earnings: Double = 0.0,
    val isPaid: Boolean = false,
    val paymentRecordId: String? = null,
    val paymentPaidAt: String? = null,
    val groupDay: String = "",
    val groupWeek: String = "",
    val groupMonth: String = "",
) {
    @Transient val fromMs: Long = Time.parse(from)
    @Transient val toMs: Long = Time.parse(to)
    val accent: String get() = taskGroup?.accent ?: Accents.taskAccentHex(taskId)
}

@Serializable
data class BillingSessionsResponse(val sessions: List<BillingSession> = emptyList(), val groupBy: String? = null)

@Serializable
data class CurrencySummary(
    val unpaidTotal: Double = 0.0,
    val thisWeekTotal: Double = 0.0,
    val thisMonthTotal: Double = 0.0,
    val allTimeTotal: Double = 0.0,
    val allTimePaidTotal: Double = 0.0,
)

@Serializable
data class BillingSummary(val byCurrency: Map<String, CurrencySummary> = emptyMap())

@Serializable
data class Payment(
    val id: String,
    val paidAt: String,
    val note: String? = null,
    val totalAmount: Double = 0.0,
    val totalMinutes: Int = 0,
    val currency: String = "CZK",
    val createdAt: String? = null,
    val sessions: List<BillingSession> = emptyList(),
)

// ---- AI subscriptions ----

@Serializable
data class AiPreset(
    val id: String,
    val name: String,
    val providerKey: String? = null,
    val isBuiltIn: Boolean = false,
    val sortOrder: Int = 0,
)

@Serializable
data class AiMetrics(
    val tasksWithTrackedTime: Int = 0,
    val trackedHours: Double = 0.0,
    val eventsInWindow: Int = 0,
    val durationDays: Int = 0,
    val isActive: Boolean = false,
)

@Serializable
data class AiPeriod(
    val id: String,
    val presetId: String? = null,
    val name: String,
    val price: Double = 0.0,
    val currency: String = "CZK",
    val startsAt: String,
    val endsAt: String? = null,
    val depletedAt: String? = null,
    val billingKind: String = "purchase",
    val billingCadence: String = "monthly",
    val billingEmail: String? = null,
    val billingProviderUrl: String? = null,
    val note: String? = null,
    val createdAt: String? = null,
    val updatedAt: String? = null,
    val priceApproxCzk: Double? = null,
    val metrics: AiMetrics = AiMetrics(),
    val paidEarningsByCurrency: Map<String, Double> = emptyMap(),
)

@Serializable
data class AiPeriodsResponse(val periods: List<AiPeriod> = emptyList())

@Serializable
data class AiPeriodResponse(val period: AiPeriod? = null)

@Serializable
data class MonthTotal(val month: String, val totalInView: Double = 0.0)

@Serializable
data class AiRankItem(val id: String, val name: String, val trackedHours: Double = 0.0)

@Serializable
data class AiRankings(val mostTrackedHours: List<AiRankItem> = emptyList())

@Serializable
data class AiSummary(
    val lifetimeSpendInView: Double = 0.0,
    val currentMonthOverlapSpendInView: Double = 0.0,
    val activeSubscriptions: Int = 0,
    val periodCount: Int = 0,
)

@Serializable
data class AiAnalytics(
    val viewCurrency: String = "CZK",
    val fxMissingCurrencies: List<String> = emptyList(),
    val summary: AiSummary = AiSummary(),
    val cumulativeByMonth: List<MonthTotal> = emptyList(),
    val spendByMonth: List<MonthTotal> = emptyList(),
    val rankings: AiRankings = AiRankings(),
    val periods: List<AiPeriod> = emptyList(),
)

// ---- Chat ----

@Serializable
data class Conversation(val id: String, val title: String? = null, val updatedAt: String? = null, val createdAt: String? = null)

@Serializable
data class StoredMessage(
    val id: String,
    val conversationId: String? = null,
    val role: String,
    val content: String = "",
    val parts: List<JsonObject>? = null,
    val createdAt: String? = null,
)

@Serializable
data class ErrorBody(val error: String? = null, val overlap: JsonElement? = null)

@Serializable
data class ModelInfo(val model: String? = null, val gitShaShort: String? = null, val builtAt: String? = null)

@Serializable
data class OkResponse(val success: Boolean? = null, val ok: Boolean? = null)

@Suppress("unused")
@Serializable
data class SkippedResponse(val skipped: Boolean? = null, @SerialName("reason") val reason: String? = null)
