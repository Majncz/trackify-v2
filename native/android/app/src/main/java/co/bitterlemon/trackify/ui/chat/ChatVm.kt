package co.bitterlemon.trackify.ui.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.ChatChunk
import co.bitterlemon.trackify.data.ChatMessage
import co.bitterlemon.trackify.data.ChatPart
import co.bitterlemon.trackify.data.ChatProtocol
import co.bitterlemon.trackify.data.Conversation
import co.bitterlemon.trackify.data.chatStream
import co.bitterlemon.trackify.data.str
import co.bitterlemon.trackify.ui.auth.friendlyError
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.util.UUID

val WRITE_TOOLS = setOf("createTask", "createEvent", "deleteEvent", "updateEvent", "setTaskGroupMembership")

val TOOL_DESCRIPTIONS = mapOf(
    "listTasks" to "Get all your tasks",
    "findTask" to "Search for a task",
    "listEvents" to "List time entries",
    "listTaskGroups" to "List task groups",
    "createTask" to "Create a new task",
    "createEvent" to "Log time to a task",
    "getStats" to "Get time statistics",
    "deleteEvent" to "Delete a time entry",
    "updateEvent" to "Update a time entry",
    "setTaskGroupMembership" to "Add task to a group or remove from group",
)

/** Approval state per toolCallId (web `pendingApprovals`). */
enum class Approval { Executing, Approved, Rejected }

class ChatVm(private val graph: AppGraph) : ViewModel() {
    val conversations = mutableStateListOf<Conversation>()
    var conversationsLoaded by mutableStateOf(false)
    var currentId by mutableStateOf<String?>(null)
    val messages = mutableStateListOf<ChatMessage>()
    val approvals = mutableStateMapOf<String, Approval>()
    var streaming by mutableStateOf(false)
    var loadingMessages by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var input by mutableStateOf("")
    private val chatId = UUID.randomUUID().toString()
    private var streamJob: Job? = null
    private var loadJob: Job? = null

    init {
        refreshConversations()
    }

    fun refreshConversations() {
        viewModelScope.launch {
            runCatching { graph.api.conversations() }.onSuccess {
                conversations.clear(); conversations.addAll(it.sortedBy { c -> c.updatedAt ?: c.createdAt ?: "" })
            }
            conversationsLoaded = true
        }
    }

    fun select(id: String?) {
        if (id == currentId) return
        stop()
        currentId = id
        approvals.clear()
        messages.clear()
        error = null
        loadJob?.cancel()
        if (id == null) return
        loadingMessages = true
        loadJob = viewModelScope.launch {
            runCatching { graph.api.messages(id) }.onSuccess { list ->
                if (currentId == id) {
                    messages.clear()
                    messages.addAll(list.map { ChatMessage(it.id, it.role, ChatProtocol.partsFromStored(it)) })
                }
            }.onFailure { error = friendlyError(it, "Failed to load messages") }
            loadingMessages = false
        }
    }

    fun newConversation() {
        viewModelScope.launch {
            runCatching { graph.api.createConversation() }.onSuccess { c ->
                conversations.add(c); select(c.id)
            }.onFailure { error = friendlyError(it, "Couldn't create a conversation") }
        }
    }

    fun delete(id: String) {
        viewModelScope.launch {
            runCatching { graph.api.deleteConversation(id) }.onSuccess {
                conversations.removeAll { it.id == id }
                if (currentId == id) select(null)
            }.onFailure { error = friendlyError(it, "Couldn't delete the conversation") }
        }
    }

    private suspend fun ensureConversation(): String? {
        currentId?.let { return it }
        return runCatching { graph.api.createConversation() }.onSuccess { c ->
            conversations.add(c); currentId = c.id
        }.onFailure { error = friendlyError(it, "Couldn't create a conversation") }.getOrNull()?.id
    }

    /** Tool parts that still need Approve / Reject. */
    fun pendingToolCalls(): List<ChatPart.Tool> = messages.filter { it.role == "assistant" }.flatMap { m ->
        m.parts.filterIsInstance<ChatPart.Tool>().filter { needsApproval(it) }
    }

    fun needsApproval(p: ChatPart.Tool): Boolean {
        val hasResult = p.state == "output-available" || p.state == "result"
        return p.toolName in WRITE_TOOLS && !hasResult && approvals[p.toolCallId] == null && (p.state == "input-available" || p.state == "call")
    }

    fun send(text: String = input) {
        val t = text.trim()
        if (t.isEmpty() || streaming) return
        input = ""
        viewModelScope.launch {
            ensureConversation() ?: return@launch
            // Sending while approvals are pending auto-rejects them (web behaviour).
            pendingToolCalls().forEach { p ->
                approvals[p.toolCallId] = Approval.Rejected
                setToolOutput(p.toolCallId, buildJsonObject {
                    put("rejected", true)
                    put("message", "User sent a new message instead of approving - they may want to change or correct the request")
                })
            }
            messages.add(ChatMessage(UUID.randomUUID().toString(), "user", listOf(ChatPart.Text(null, t))))
            runStream()
        }
    }

    fun approve(p: ChatPart.Tool) {
        if (approvals[p.toolCallId] == Approval.Executing) return
        approvals[p.toolCallId] = Approval.Executing
        viewModelScope.launch {
            try {
                val result = graph.api.executeTool(p.toolName, p.input ?: JsonObject(emptyMap()))
                val failed = (result as? JsonObject)?.get("success")?.toString() == "false"
                approvals[p.toolCallId] = if (failed) Approval.Rejected else Approval.Approved
                setToolOutput(p.toolCallId, result)
                if (!failed && p.toolName in WRITE_TOOLS) {
                    graph.repo.requestRefresh(0); graph.repo.refreshGroups(); graph.repo.bumpData()
                }
            } catch (e: Exception) {
                approvals[p.toolCallId] = Approval.Rejected
                setToolOutput(p.toolCallId, buildJsonObject { put("success", false); put("error", "Network error - please try again") })
            }
            runStream()
        }
    }

    fun reject(p: ChatPart.Tool) {
        val s = approvals[p.toolCallId]
        if (s == Approval.Executing || s == Approval.Rejected) return
        approvals[p.toolCallId] = Approval.Rejected
        setToolOutput(p.toolCallId, buildJsonObject { put("rejected", true); put("message", "User rejected this action") })
        viewModelScope.launch { runStream() }
    }

    private fun setToolOutput(toolCallId: String, output: JsonElement) {
        for (i in messages.indices) {
            val m = messages[i]
            val idx = m.parts.indexOfFirst { it is ChatPart.Tool && it.toolCallId == toolCallId }
            if (idx >= 0) {
                val parts = m.parts.toMutableList()
                parts[idx] = (parts[idx] as ChatPart.Tool).copy(state = "output-available", output = output)
                messages[i] = m.copy(parts = parts)
                return
            }
        }
    }

    private fun runStream() {
        streamJob?.cancel()
        error = null
        streaming = true
        val convId = currentId
        streamJob = viewModelScope.launch {
            // Continue the last assistant message after tool outputs; otherwise start a new one.
            val continuing = messages.lastOrNull()?.role == "assistant"
            var index = if (continuing) messages.lastIndex else {
                messages.add(ChatMessage(UUID.randomUUID().toString(), "assistant", emptyList())); messages.lastIndex
            }
            val snapshot = messages.toList().let { if (continuing) it else it.dropLast(1) }
            try {
                graph.api.chatStream(chatId, snapshot, convId).collect { chunk ->
                    if (currentId != convId) return@collect
                    when (chunk) {
                        is ChatChunk.Error -> error = chunk.text
                        is ChatChunk.Start -> Unit
                        else -> if (index in messages.indices) messages[index] = ChatProtocol.apply(messages[index], chunk)
                    }
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                error = friendlyError(e, "Something went wrong")
            } finally {
                streaming = false
                // Drop an empty assistant bubble (e.g. error before any output).
                if (index in messages.indices && messages[index].role == "assistant" && messages[index].parts.isEmpty()) messages.removeAt(index)
                index = -1
                refreshConversations()
            }
        }
    }

    fun stop() {
        streamJob?.cancel()
        streaming = false
    }

    companion object {
        fun describe(name: String, args: JsonObject?): String {
            val a = args ?: JsonObject(emptyMap())
            fun s(k: String) = a.str(k) ?: (a[k]?.toString()?.trim('"'))
            fun date(v: String?): String = v?.let { localOrIsoDate(it) } ?: "now"
            return when (name) {
                "createEvent" -> "Log time entry to ${s("taskName")?.let { "\"$it\"" } ?: "task"} from ${date(s("from"))} to ${date(s("to"))}"
                "createTask" -> "Create task \"${s("name")}\""
                "deleteEvent" -> "Delete time entry"
                "updateEvent" -> "Update time entry"
                "setTaskGroupMembership" -> if (a["groupId"] == null || a["groupId"].toString() == "null" || s("groupId").isNullOrEmpty()) "Remove task from its group" else "Assign task to group"
                else -> formatArgs(a)
            }
        }

        /** JS `new Date(str)`: strings without an offset are local time. */
        fun localOrIsoDate(v: String): String = runCatching {
            val ms = if (Regex("(Z|[+-]\\d{2}:?\\d{2})$").containsMatchIn(v)) co.bitterlemon.trackify.util.Time.parse(v)
            else java.time.LocalDateTime.parse(v).atZone(co.bitterlemon.trackify.util.Time.zone()).toInstant().toEpochMilli()
            co.bitterlemon.trackify.util.Time.format(ms, "EEE, MMM d, h:mm a")
        }.getOrDefault(v)

        fun formatArgs(a: JsonObject?): String = (a ?: JsonObject(emptyMap())).entries.filter { !it.key.contains("Id") }
            .joinToString(", ") { (k, v) -> "$k: ${(v as? kotlinx.serialization.json.JsonPrimitive)?.content ?: v.toString()}" }
    }
}
