package co.bitterlemon.trackify.data

import co.bitterlemon.trackify.util.Time
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.UUID

/** AI SDK v6 UI message parts (the subset Trackify uses). */
sealed class ChatPart {
    data class Text(val id: String?, val text: String) : ChatPart()
    data class Tool(
        val toolName: String,
        val toolCallId: String,
        /** "input-streaming" | "input-available" | "output-available" | "result" | "output-error" */
        val state: String,
        val input: JsonObject?,
        val output: JsonElement?,
    ) : ChatPart()
    data object StepStart : ChatPart()
}

data class ChatMessage(val id: String, val role: String, val parts: List<ChatPart>)

/** One decoded UI-message-stream chunk (SSE `data: {json}`). */
sealed class ChatChunk {
    data class Start(val messageId: String?) : ChatChunk()
    data object StartStep : ChatChunk()
    data class TextStart(val id: String) : ChatChunk()
    data class TextDelta(val id: String, val delta: String) : ChatChunk()
    data class ToolInputStart(val toolCallId: String, val toolName: String) : ChatChunk()
    data class ToolInputAvailable(val toolCallId: String, val toolName: String, val input: JsonObject?) : ChatChunk()
    data class ToolOutputAvailable(val toolCallId: String, val output: JsonElement?) : ChatChunk()
    data class ToolOutputError(val toolCallId: String, val errorText: String) : ChatChunk()
    data class Error(val text: String) : ChatChunk()
    data object Finish : ChatChunk()
    data object Other : ChatChunk()
}

object ChatProtocol {
    fun parseChunk(json: String): ChatChunk {
        val o = runCatching { AppJson.parseToJsonElement(json).jsonObject }.getOrNull() ?: return ChatChunk.Other
        return when (o.str("type")) {
            "start" -> ChatChunk.Start(o.str("messageId"))
            "start-step" -> ChatChunk.StartStep
            "text-start" -> ChatChunk.TextStart(o.str("id") ?: "")
            "text-delta" -> ChatChunk.TextDelta(o.str("id") ?: "", o.str("delta") ?: o.str("textDelta") ?: "")
            "tool-input-start" -> ChatChunk.ToolInputStart(o.str("toolCallId") ?: "", o.str("toolName") ?: "")
            "tool-input-available" -> ChatChunk.ToolInputAvailable(o.str("toolCallId") ?: "", o.str("toolName") ?: "", o["input"] as? JsonObject)
            "tool-output-available" -> ChatChunk.ToolOutputAvailable(o.str("toolCallId") ?: "", o["output"])
            "tool-output-error", "tool-input-error" -> ChatChunk.ToolOutputError(o.str("toolCallId") ?: "", o.str("errorText") ?: "Tool failed")
            "error" -> ChatChunk.Error(o.str("errorText") ?: "Something went wrong")
            "finish" -> ChatChunk.Finish
            else -> ChatChunk.Other
        }
    }

    /** Apply a chunk to the assistant message being streamed. */
    fun apply(msg: ChatMessage, c: ChatChunk): ChatMessage {
        val parts = msg.parts.toMutableList()
        when (c) {
            is ChatChunk.StartStep -> parts.add(ChatPart.StepStart)
            is ChatChunk.TextStart -> parts.add(ChatPart.Text(c.id, ""))
            is ChatChunk.TextDelta -> {
                val i = parts.indexOfLast { it is ChatPart.Text && (it.id == c.id || c.id.isEmpty()) }
                if (i >= 0) {
                    val t = parts[i] as ChatPart.Text
                    parts[i] = t.copy(text = t.text + c.delta)
                } else parts.add(ChatPart.Text(c.id, c.delta))
            }
            is ChatChunk.ToolInputStart -> parts.add(ChatPart.Tool(c.toolName, c.toolCallId, "input-streaming", null, null))
            is ChatChunk.ToolInputAvailable -> {
                val i = parts.indexOfFirst { it is ChatPart.Tool && it.toolCallId == c.toolCallId }
                val p = ChatPart.Tool(c.toolName, c.toolCallId, "input-available", c.input, null)
                if (i >= 0) parts[i] = p else parts.add(p)
            }
            is ChatChunk.ToolOutputAvailable -> {
                val i = parts.indexOfFirst { it is ChatPart.Tool && it.toolCallId == c.toolCallId }
                if (i >= 0) parts[i] = (parts[i] as ChatPart.Tool).copy(state = "output-available", output = c.output)
            }
            is ChatChunk.ToolOutputError -> {
                val i = parts.indexOfFirst { it is ChatPart.Tool && it.toolCallId == c.toolCallId }
                if (i >= 0) parts[i] = (parts[i] as ChatPart.Tool).copy(state = "output-available", output = buildJsonObject { put("success", false); put("error", c.errorText) })
            }
            else -> Unit
        }
        return msg.copy(parts = parts)
    }

    fun partsFromStored(m: StoredMessage): List<ChatPart> {
        val raw = m.parts
        if (raw.isNullOrEmpty()) return if (m.content.isNotEmpty()) listOf(ChatPart.Text(null, m.content)) else emptyList()
        return raw.mapNotNull { p ->
            val type = p.str("type") ?: return@mapNotNull null
            when {
                type == "text" -> ChatPart.Text(null, p.str("text") ?: "")
                type == "step-start" -> ChatPart.StepStart
                type.startsWith("tool-") -> ChatPart.Tool(type.removePrefix("tool-"), p.str("toolCallId") ?: UUID.randomUUID().toString(), p.str("state") ?: "result", p["input"] as? JsonObject, p["output"])
                else -> null
            }
        }
    }

    private fun partJson(p: ChatPart): JsonObject? = when (p) {
        is ChatPart.Text -> buildJsonObject { put("type", "text"); put("text", p.text) }
        is ChatPart.StepStart -> buildJsonObject { put("type", "step-start") }
        is ChatPart.Tool -> {
            // Persisted history uses state "result"; send it as output-available (or drop if the result was never stored).
            val done = p.state == "output-available" || p.state == "result"
            if (p.state == "input-streaming" || (p.state == "result" && (p.output == null || p.output is JsonNull))) null
            else buildJsonObject {
                put("type", "tool-${p.toolName}")
                put("toolCallId", p.toolCallId)
                put("state", if (done) "output-available" else p.state)
                put("input", p.input ?: JsonObject(emptyMap()))
                if (done) put("output", p.output ?: JsonNull)
            }
        }
    }

    fun requestBody(chatId: String, messages: List<ChatMessage>, conversationId: String?): String {
        val body = buildJsonObject {
            put("id", chatId)
            put("messages", buildJsonArray {
                messages.forEach { m ->
                    add(buildJsonObject {
                        put("id", m.id)
                        put("role", m.role)
                        put("parts", JsonArray(m.parts.mapNotNull { partJson(it) }))
                    })
                }
            })
            put("trigger", "submit-message")
            put("conversationId", conversationId?.let { JsonPrimitive(it) } ?: JsonNull)
            put("timezone", Time.timezoneId())
        }
        return AppJson.encodeToString(JsonElement.serializer(), body)
    }
}

/** Streams `/api/chat` as decoded chunks. Errors come back as plain text (G14). */
fun ApiClient.chatStream(chatId: String, messages: List<ChatMessage>, conversationId: String?): Flow<ChatChunk> = flow {
    val req = authed(Request.Builder().url(url("/api/chat")))
        .header("Accept", "text/event-stream")
        .post(ChatProtocol.requestBody(chatId, messages, conversationId).toRequestBody("application/json".toMediaType()))
        .build()
    val call = streamHttp.newCall(req)
    val resp = try {
        call.execute()
    } catch (e: IOException) {
        throw NetworkException(e)
    }
    resp.use { r ->
        if (!r.isSuccessful) {
            val text = runCatching { r.body.string() }.getOrDefault("")
            val msg = text.jsonObjOrNull()?.str("error") ?: text.takeIf { it.isNotBlank() && it.length < 300 } ?: "Chat failed (${r.code})"
            throw ApiException(r.code, msg, text, false)
        }
        val source = r.body.source()
        try {
            while (true) {
                currentCoroutineContext().ensureActive()
                val line = source.readUtf8Line() ?: break
                if (!line.startsWith("data:")) continue
                val data = line.removePrefix("data:").trim()
                if (data == "[DONE]") break
                if (data.isEmpty()) continue
                emit(ChatProtocol.parseChunk(data))
            }
        } catch (e: IOException) {
            call.cancel()
            throw NetworkException(e)
        } finally {
            call.cancel()
        }
    }
}.flowOn(Dispatchers.IO)
