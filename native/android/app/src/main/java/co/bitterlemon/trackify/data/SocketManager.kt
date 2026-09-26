package co.bitterlemon.trackify.data

import android.util.Log
import io.socket.client.IO
import io.socket.client.Socket
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import org.json.JSONObject

enum class ConnectionStatus { Connected, Reconnecting, Disconnected }

interface SocketListener {
    fun onAuthenticated()
    fun onTimerStarted(taskId: String, startTime: Long)
    fun onTimerStopped(taskId: String?)
    fun onTimerStartUpdated(taskId: String, startTime: Long)
    fun onTimerState(taskId: String, startTime: Long)
    fun onTasksChanged()
    fun onPresenceChanged()
    fun onAuthError()
}

/**
 * Socket.IO v4 live sync (NATIVE_SPEC §3): authenticate {token} on every connect, then
 * timer:request-state. Status dot turns red only after an 8 s grace.
 */
class SocketManager(private val listener: SocketListener) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var socket: Socket? = null
    private var currentKey: String? = null
    private var token: String? = null
    private var graceJob: Job? = null

    private val _status = MutableStateFlow(ConnectionStatus.Reconnecting)
    val status: StateFlow<ConnectionStatus> = _status.asStateFlow()

    @Volatile var authenticated = false
        private set

    fun connect(server: String, token: String) {
        val key = "$server|$token"
        this.token = token
        if (socket != null && currentKey == key) {
            if (socket?.connected() != true) socket?.connect()
            return
        }
        disconnect()
        currentKey = key
        val opts = IO.Options().apply {
            path = "/socket.io"
            transports = arrayOf("websocket")
            reconnection = true
            reconnectionAttempts = Int.MAX_VALUE
            reconnectionDelay = 400
            reconnectionDelayMax = 5000
            randomizationFactor = 0.5
            timeout = 20_000
            forceNew = true
        }
        val s = try {
            IO.socket(server, opts)
        } catch (e: Exception) {
            Log.w(TAG, "bad socket url", e); return
        }
        socket = s
        startGrace()
        s.on(Socket.EVENT_CONNECT) {
            authenticated = false
            s.emit("authenticate", JSONObject().put("token", this.token))
        }
        s.on(Socket.EVENT_DISCONNECT) {
            authenticated = false
            _status.value = ConnectionStatus.Reconnecting
            startGrace()
        }
        s.on(Socket.EVENT_CONNECT_ERROR) {
            if (_status.value == ConnectionStatus.Connected) _status.value = ConnectionStatus.Reconnecting
            startGrace()
        }
        s.on("auth:success") {
            authenticated = true
            graceJob?.cancel()
            _status.value = ConnectionStatus.Connected
            s.emit("timer:request-state")
            listener.onAuthenticated()
        }
        s.on("auth:error") {
            authenticated = false
            listener.onAuthError()
        }
        s.on("timer:started") { args -> obj(args)?.let { o -> ts(o)?.let { listener.onTimerStarted(it.first, it.second) } } }
        s.on("timer:state") { args ->
            obj(args)?.let { o -> if (o.optBoolean("running", true)) ts(o)?.let { listener.onTimerState(it.first, it.second) } }
        }
        s.on("timer:start-updated") { args -> obj(args)?.let { o -> ts(o)?.let { listener.onTimerStartUpdated(it.first, it.second) } } }
        s.on("timer:stopped") { args -> listener.onTimerStopped(obj(args)?.optString("taskId")?.takeIf { it.isNotEmpty() }) }
        s.on("task:created") { listener.onTasksChanged() }
        s.on("task:updated") { listener.onTasksChanged() }
        s.on("task:deleted") { listener.onTasksChanged() }
        s.on("presence:changed") { listener.onPresenceChanged() }
        s.connect()
    }

    private fun startGrace() {
        if (graceJob?.isActive == true) return
        graceJob = scope.launch {
            delay(8_000)
            if (!authenticated) _status.value = ConnectionStatus.Disconnected
        }
    }

    fun disconnect() {
        socket?.off()
        socket?.disconnect()
        socket?.close()
        socket = null
        currentKey = null
        authenticated = false
        graceJob?.cancel()
        _status.value = ConnectionStatus.Reconnecting
    }

    fun isActive() = socket != null

    /** Ask again (foreground / network back). */
    fun nudge() {
        val s = socket ?: return
        if (!s.connected()) s.connect()
        else if (authenticated) s.emit("timer:request-state")
        else s.emit("authenticate", JSONObject().put("token", token))
    }

    fun relayTaskCreated(taskJson: String) = emitJson("task:created", taskJson)
    fun relayTaskUpdated(taskJson: String) = emitJson("task:updated", taskJson)
    fun relayTaskDeleted(taskId: String) {
        if (authenticated) socket?.emit("task:deleted", taskId)
    }

    private fun emitJson(event: String, json: String) {
        if (!authenticated) return
        try {
            socket?.emit(event, JSONObject(json))
        } catch (_: Exception) {
        }
    }

    private fun obj(args: Array<Any?>): JSONObject? = args.firstOrNull() as? JSONObject

    private fun ts(o: JSONObject): Pair<String, Long>? {
        val id = o.optString("taskId").takeIf { it.isNotEmpty() } ?: return null
        val st = o.opt("startTime")
        val ms = when (st) {
            is Number -> st.toLong()
            is String -> st.toLongOrNull() ?: co.bitterlemon.trackify.util.Time.parse(st)
            else -> return null
        }
        return id to ms
    }

    companion object {
        private const val TAG = "Socket"
    }
}
