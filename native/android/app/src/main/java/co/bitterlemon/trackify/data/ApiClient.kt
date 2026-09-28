package co.bitterlemon.trackify.data

import co.bitterlemon.trackify.util.Time
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.KSerializer
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonObjectBuilder
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.put
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import java.io.IOException
import java.util.concurrent.TimeUnit

val AppJson = Json {
    ignoreUnknownKeys = true
    coerceInputValues = true
    explicitNulls = false
    isLenient = true
    encodeDefaults = true
}

/** Non-2xx HTTP answer. [isJson] distinguishes "route missing" HTML 404s from real API 404s. */
class ApiException(val status: Int, message: String, val body: String?, val isJson: Boolean) : Exception(message) {
    val isRouteMissing: Boolean get() = status == 404 && !isJson
    val isRetryable: Boolean get() = status == 408 || status == 429 || status >= 500
}

/** No connection / timeout / DNS. Always retryable. */
class NetworkException(cause: Throwable) : IOException(cause.message ?: "Network error", cause)

class ApiClient(
    private val serverUrl: () -> String,
    private val token: () -> String?,
    private val onUnauthorized: () -> Unit,
) {
    // Built on first request: a widget tap on a cold process must not pay for OkHttp's setup.
    val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .writeTimeout(30, TimeUnit.SECONDS)
            .build()
    }

    /** Long-lived client for the chat SSE stream. */
    val streamHttp: OkHttpClient by lazy { http.newBuilder().readTimeout(5, TimeUnit.MINUTES).build() }

    private val jsonType = "application/json; charset=utf-8".toMediaType()

    fun url(path: String, query: Map<String, String?> = emptyMap()): String {
        val b = (serverUrl().trimEnd('/') + path).toHttpUrl().newBuilder()
        query.forEach { (k, v) -> if (v != null) b.addQueryParameter(k, v) }
        return b.build().toString()
    }

    fun authed(builder: Request.Builder): Request.Builder {
        token()?.let { builder.header("Authorization", "Bearer $it") }
        return builder
    }

    suspend fun raw(
        method: String,
        path: String,
        body: JsonElement? = null,
        query: Map<String, String?> = emptyMap(),
        auth: Boolean = true,
    ): String = withContext(Dispatchers.IO) {
        val rb = Request.Builder().url(url(path, query))
        if (auth) authed(rb)
        rb.header("Accept", "application/json")
        val payload = body?.let { AppJson.encodeToString(JsonElement.serializer(), it).toRequestBody(jsonType) }
        when (method) {
            "GET" -> rb.get()
            "DELETE" -> if (payload != null) rb.delete(payload) else rb.delete()
            else -> rb.method(method, payload ?: "{}".toRequestBody(jsonType))
        }
        val response: Response = try {
            http.newCall(rb.build()).execute()
        } catch (e: IOException) {
            throw NetworkException(e)
        }
        response.use { r ->
            val text = try {
                r.body.string()
            } catch (e: IOException) {
                throw NetworkException(e)
            }
            if (!r.isSuccessful) {
                val ct = r.header("Content-Type") ?: ""
                val parsed = runCatching { AppJson.parseToJsonElement(text) }.getOrNull()
                val isJson = parsed is JsonObject || ct.contains("json")
                val msg = (parsed as? JsonObject)?.get("error")?.let { runCatching { it.jsonPrimitive.content }.getOrNull() }
                    ?: text.takeIf { !it.trimStart().startsWith("<") && it.length < 300 && it.isNotBlank() }
                    ?: defaultMessage(r.code)
                if (r.code == 401 && auth && token() != null) onUnauthorized()
                throw ApiException(r.code, msg, text, isJson)
            }
            text
        }
    }

    private fun defaultMessage(code: Int) = when (code) {
        401 -> "Unauthorized"
        404 -> "Not found"
        in 500..599 -> "Server error ($code)"
        else -> "Request failed ($code)"
    }

    suspend fun <T> call(
        method: String,
        path: String,
        ser: KSerializer<T>,
        body: JsonElement? = null,
        query: Map<String, String?> = emptyMap(),
        auth: Boolean = true,
    ): T {
        val text = raw(method, path, body, query, auth)
        return AppJson.decodeFromString(ser, text.ifBlank { "{}" })
    }

    private fun obj(block: JsonObjectBuilder.() -> Unit) = buildJsonObject(block)
    private val tz get() = Time.timezoneId()

    // ---------------- Auth ----------------
    suspend fun login(email: String, password: String, deviceName: String) =
        call("POST", "/api/auth/token", TokenResponse.serializer(), obj {
            put("email", normEmail(email)); put("password", password); put("deviceName", deviceName)
        }, auth = false)

    suspend fun logout() = raw("DELETE", "/api/auth/token")

    suspend fun register(email: String, password: String) =
        raw("POST", "/api/auth/register", obj { put("email", normEmail(email)); put("password", password) }, auth = false)

    suspend fun forgotPassword(email: String) =
        raw("POST", "/api/auth/forgot-password", obj { put("email", normEmail(email)) }, auth = false)

    /** Emails are case-insensitive; stored lower-case. */
    private fun normEmail(email: String) = email.trim().lowercase()

    // ---------------- Tasks / events ----------------
    suspend fun tasks(hidden: Boolean = false) =
        call("GET", "/api/tasks", ListSerializer(Task.serializer()), query = if (hidden) mapOf("hidden" to "true") else emptyMap())

    /**
     * GET /api/tasks with `If-None-Match`. Returns (null, etag) on 304 = reuse the cached list.
     * Servers without ETags always answer 200 with a null etag.
     */
    suspend fun tasksConditional(etag: String?): Pair<List<Task>?, String?> = withContext(Dispatchers.IO) {
        val rb = authed(Request.Builder().url(url("/api/tasks"))).header("Accept", "application/json")
        if (etag != null) rb.header("If-None-Match", etag)
        val r = try {
            http.newCall(rb.build()).execute()
        } catch (e: IOException) {
            throw NetworkException(e)
        }
        r.use {
            if (it.code == 304) return@withContext null to etag
            val text = try { it.body.string() } catch (e: IOException) { throw NetworkException(e) }
            if (!it.isSuccessful) {
                if (it.code == 401 && token() != null) onUnauthorized()
                val msg = text.jsonObjOrNull()?.str("error") ?: defaultMessage(it.code)
                throw ApiException(it.code, msg, text, text.trimStart().startsWith("{"))
            }
            AppJson.decodeFromString(ListSerializer(Task.serializer()), text) to it.header("ETag")
        }
    }

    suspend fun createTask(name: String) = call("POST", "/api/tasks", Task.serializer(), obj { put("name", name) })
    suspend fun renameTask(id: String, name: String) = call("PUT", "/api/tasks/$id", Task.serializer(), obj { put("name", name) })
    suspend fun setHidden(id: String, hidden: Boolean) = call("PUT", "/api/tasks/$id", Task.serializer(), obj { put("hidden", hidden) })
    suspend fun hideTask(id: String) = raw("DELETE", "/api/tasks/$id")

    suspend fun events(taskId: String? = null) =
        call("GET", "/api/events", ListSerializer(Event.serializer()), query = mapOf("taskId" to taskId))

    /** Returns the created event JSON or `{skipped:true}`. */
    suspend fun createEvent(taskId: String, from: Long, to: Long, name: String = "Time entry", source: String? = null) =
        raw("POST", "/api/events", obj {
            put("taskId", taskId); put("name", name); put("from", Time.iso(from)); put("to", Time.iso(to))
            if (source != null) put("source", source)
        })

    suspend fun updateEvent(id: String, from: Long, to: Long, name: String? = null) =
        raw("PUT", "/api/events/$id", obj {
            put("from", Time.iso(from)); put("to", Time.iso(to)); if (name != null) put("name", name)
        })

    suspend fun deleteEvent(id: String) = raw("DELETE", "/api/events/$id")

    // ---------------- Timer ----------------
    suspend fun timer() = call("GET", "/api/timer", TimerState.serializer())

    suspend fun timerSwitch(taskId: String, at: Long) =
        call("POST", "/api/timer/switch", SwitchResponse.serializer(), obj { put("taskId", taskId); put("at", Time.iso(at)) })

    suspend fun timerStop(taskId: String, endTime: Long?, startTime: Long?) =
        call("POST", "/api/timer/stop", StopResponse.serializer(), obj {
            put("taskId", taskId)
            if (endTime != null) put("endTime", Time.iso(endTime))
            if (startTime != null) put("startTime", Time.iso(startTime))
        })

    suspend fun timerStart(taskId: String, startTime: Long) =
        call("POST", "/api/timer", TimerState.serializer(), obj { put("taskId", taskId); put("startTime", Time.iso(startTime)) })

    suspend fun timerDelete(taskId: String?) = raw("DELETE", "/api/timer", query = mapOf("taskId" to taskId))

    suspend fun timerAdjust(taskId: String, newStart: Long) =
        call("PATCH", "/api/timer", TimerState.serializer(), obj { put("taskId", taskId); put("newStartTime", Time.iso(newStart)) })

    // ---------------- Stats / profile / presence ----------------
    suspend fun stats() = call("GET", "/api/stats", Stats.serializer(), query = mapOf("timezone" to tz))
    suspend fun profile() = call("GET", "/api/profile", Profile.serializer())
    suspend fun setDisplayName(name: String) = call("PATCH", "/api/profile", Profile.serializer(), obj { put("displayName", name) })
    suspend fun changePassword(current: String, new: String) =
        raw("POST", "/api/profile/password", obj { put("currentPassword", current); put("newPassword", new) })
    suspend fun deleteAccount(password: String) = raw("DELETE", "/api/profile", obj { put("password", password) })

    suspend fun presence(day: String?, range: String) =
        call("GET", "/api/presence", Presence.serializer(), query = mapOf("timezone" to tz, "day" to day, "range" to range))

    suspend fun race(from: String, to: String) =
        call("GET", "/api/visualizations/race", RaceData.serializer(), query = mapOf("timezone" to tz, "from" to from, "to" to to))

    // ---------------- Groups ----------------
    suspend fun groups() = call("GET", "/api/groups", ListSerializer(Group.serializer()))
    suspend fun createGroup(name: String, taskIds: List<String>, color: String?) =
        call("POST", "/api/groups", Group.serializer(), obj {
            put("name", name); put("taskIds", JsonArray(taskIds.map { JsonPrimitive(it) })); put("color", color?.let { JsonPrimitive(it) } ?: JsonNull)
        })
    suspend fun updateGroup(id: String, name: String, taskIds: List<String>, color: String?) =
        call("PUT", "/api/groups/$id", Group.serializer(), obj {
            put("name", name); put("taskIds", JsonArray(taskIds.map { JsonPrimitive(it) })); put("color", color?.let { JsonPrimitive(it) } ?: JsonNull)
        })
    suspend fun deleteGroup(id: String) = raw("DELETE", "/api/groups/$id")

    // ---------------- Billing ----------------
    suspend fun billingTasks() = call("GET", "/api/billing/tasks", ListSerializer(BillingTask.serializer()))
    suspend fun enroll(taskId: String, rate: Double, currency: String) =
        call("POST", "/api/billing/tasks", BillingTask.serializer(), obj {
            put("taskId", taskId); put("hourlyRate", rate); put("currency", currency); put("roundingMins", 0)
        })
    suspend fun patchBillingTask(id: String, rate: Double? = null, currency: String? = null) =
        call("PATCH", "/api/billing/tasks/$id", BillingTask.serializer(), obj {
            if (rate != null) put("hourlyRate", rate); if (currency != null) put("currency", currency)
        })
    suspend fun unenroll(id: String) = raw("DELETE", "/api/billing/tasks/$id")

    suspend fun billingSessions(from: Long?, to: Long?, status: String, groupId: String?, taskId: String?) =
        call("GET", "/api/billing/sessions", BillingSessionsResponse.serializer(), query = mapOf(
            "from" to from?.let { Time.iso(it) }, "to" to to?.let { Time.iso(it) }, "status" to status,
            "taskGroupId" to groupId, "taskId" to taskId,
        ))
    suspend fun billingSummary() = call("GET", "/api/billing/summary", BillingSummary.serializer())
    suspend fun payments() = call("GET", "/api/billing/payments", ListSerializer(Payment.serializer()))
    suspend fun createPayment(eventIds: List<String>, paidAt: Long, note: String?, lineAmounts: Map<String, Double>) =
        raw("POST", "/api/billing/payments", obj {
            put("eventIds", JsonArray(eventIds.map { JsonPrimitive(it) }))
            put("paidAt", Time.iso(paidAt))
            if (!note.isNullOrBlank()) put("note", note)
            put("lineAmounts", buildJsonObject { lineAmounts.forEach { (k, v) -> put(k, v) } })
        })
    suspend fun reopenPayment(id: String) = raw("DELETE", "/api/billing/payments/$id")

    // ---------------- AI subscriptions ----------------
    suspend fun aiPresets() = call("GET", "/api/ai-subscriptions/presets", ListSerializer(AiPreset.serializer()))
    suspend fun aiAnalytics(viewCurrency: String) =
        call("GET", "/api/ai-subscriptions/analytics", AiAnalytics.serializer(), query = mapOf("viewCurrency" to viewCurrency))
    suspend fun aiPeriods() = call("GET", "/api/ai-subscriptions/periods", AiPeriodsResponse.serializer())
    suspend fun createAiPeriod(body: JsonObject) = call("POST", "/api/ai-subscriptions/periods", AiPeriodResponse.serializer(), body)
    suspend fun patchAiPeriod(id: String, body: JsonObject) = call("PATCH", "/api/ai-subscriptions/periods/$id", AiPeriodResponse.serializer(), body)
    suspend fun deleteAiPeriod(id: String) = raw("DELETE", "/api/ai-subscriptions/periods/$id")

    // ---------------- Chat ----------------
    suspend fun conversations() = call("GET", "/api/conversations", ListSerializer(Conversation.serializer()))
    suspend fun createConversation() = call("POST", "/api/conversations", Conversation.serializer())
    suspend fun deleteConversation(id: String) = raw("DELETE", "/api/conversations/$id")
    suspend fun messages(id: String) = call("GET", "/api/conversations/$id/messages", ListSerializer(StoredMessage.serializer()))
    suspend fun executeTool(toolName: String, args: JsonElement): JsonElement {
        val text = raw("POST", "/api/chat/execute-tool", obj { put("toolName", toolName); put("args", args); put("timezone", tz) })
        return AppJson.parseToJsonElement(text)
    }
    suspend fun model() = call("GET", "/api/chat/model", ModelInfo.serializer(), auth = false)
}

fun JsonElement.objOrNull(): JsonObject? = this as? JsonObject
fun JsonObject.str(key: String): String? = (this[key] as? JsonPrimitive)?.takeIf { it.isString }?.content
fun JsonElement.isSkipped(): Boolean = (this as? JsonObject)?.get("skipped")?.jsonPrimitive?.content == "true"
fun String.jsonObjOrNull(): JsonObject? = runCatching { AppJson.parseToJsonElement(this).jsonObject }.getOrNull()
