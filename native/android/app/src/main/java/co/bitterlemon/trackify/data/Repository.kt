package co.bitterlemon.trackify.data

import android.content.Context
import android.util.Log
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.async
import kotlinx.coroutines.coroutineScope
import kotlinx.serialization.builtins.ListSerializer
import java.io.File

/**
 * In-memory source of truth for the UI (tasks with events, groups, stats, profile), cached to disk
 * so the app and widgets have data offline. Refreshes are debounced (≥ 400 ms).
 */
class Repository(
    private val context: Context,
    val api: ApiClient,
    private val relay: () -> SocketManager?,
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private val cacheFile get() = File(context.filesDir, "tasks_cache.json")
    private val etagFile get() = File(context.filesDir, "tasks_cache.etag")
    @Volatile private var etag: String? = null

    private val _tasks = MutableStateFlow<List<Task>?>(null)
    val tasks: StateFlow<List<Task>?> = _tasks.asStateFlow()

    private val _tasksError = MutableStateFlow<String?>(null)
    val tasksError: StateFlow<String?> = _tasksError.asStateFlow()

    private val _groups = MutableStateFlow<List<Group>?>(null)
    val groups: StateFlow<List<Group>?> = _groups.asStateFlow()

    private val _stats = MutableStateFlow<Stats?>(null)
    val stats: StateFlow<Stats?> = _stats.asStateFlow()

    private val _profile = MutableStateFlow<Profile?>(null)
    val profile: StateFlow<Profile?> = _profile.asStateFlow()

    /** Bumped on presence:changed / timer changes so leaderboard screens refetch (debounced 1 s). */
    private val _presenceSignal = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val presenceSignal: SharedFlow<Unit> = _presenceSignal.asSharedFlow()

    /** Bumped after data changes that billing/AI screens care about. */
    private val _dataVersion = MutableStateFlow(0L)
    val dataVersion: StateFlow<Long> = _dataVersion.asStateFlow()

    private val _billingTasks = MutableStateFlow<List<BillingTask>?>(null)
    val billingTasks: StateFlow<List<BillingTask>?> = _billingTasks.asStateFlow()

    suspend fun refreshBillingTasks(): Result<List<BillingTask>> =
        runCatching { api.billingTasks() }.onSuccess { _billingTasks.value = it }

    private var refreshJob: Job? = null
    private var presenceJob: Job? = null

    fun loadCache() {
        try {
            if (cacheFile.exists()) {
                _tasks.value = AppJson.decodeFromString(ListSerializer(Task.serializer()), cacheFile.readText())
                etag = etagFile.takeIf { it.exists() }?.readText()?.takeIf { it.isNotBlank() }
            }
        } catch (e: Exception) {
            Log.w("Repository", "cache unreadable", e)
        }
    }

    fun clear() {
        _tasks.value = null
        _groups.value = null
        _stats.value = null
        _profile.value = null
        _tasksError.value = null
        _billingTasks.value = null
        runCatching { cacheFile.delete() }
        runCatching { etagFile.delete() }
        etag = null
    }

    /** Debounced refresh of tasks + stats (+ presence signal). */
    fun requestRefresh(delayMs: Long = 400) {
        refreshJob?.cancel()
        refreshJob = scope.launch {
            delay(delayMs)
            refreshCore()
            _dataVersion.value += 1
        }
        signalPresence()
    }

    fun signalPresence() {
        presenceJob?.cancel()
        presenceJob = scope.launch {
            delay(1000)
            _presenceSignal.tryEmit(Unit)
        }
    }

    suspend fun refreshCore() = coroutineScope {
        val a = async { refreshTasks() }
        val b = async { refreshStats() }
        val c = async { refreshGroups() }
        a.await(); b.await(); c.await()
    }

    suspend fun refreshAll() = coroutineScope {
        val a = async { refreshCore() }
        val b = async { refreshProfile() }
        a.await(); b.await()
    }

    suspend fun refreshTasks() {
        try {
            val (list, newTag) = api.tasksConditional(if (_tasks.value != null) etag else null)
            _tasksError.value = null
            if (list == null) return // 304: cached list is current
            _tasks.value = list
            etag = newTag
            try {
                cacheFile.writeText(AppJson.encodeToString(ListSerializer(Task.serializer()), list))
                if (newTag != null) etagFile.writeText(newTag) else etagFile.delete()
            } catch (_: Exception) {
            }
        } catch (e: Exception) {
            if (_tasks.value == null) _tasksError.value = e.message ?: "Failed to load tasks"
        }
    }

    suspend fun refreshStats() {
        runCatching { api.stats() }.onSuccess { _stats.value = it }
    }

    suspend fun refreshGroups() {
        runCatching { api.groups() }.onSuccess { _groups.value = it }
    }

    suspend fun refreshProfile() {
        runCatching { api.profile() }.onSuccess { _profile.value = it }
    }

    fun setProfile(p: Profile) {
        _profile.value = p
    }

    // ---- task writes (with socket relays so the web updates live) ----

    suspend fun createTask(name: String): Task {
        val t = api.createTask(name)
        _tasks.value = (_tasks.value ?: emptyList()) + t
        relay()?.relayTaskCreated(AppJson.encodeToString(Task.serializer(), t))
        requestRefresh()
        return t
    }

    suspend fun renameTask(id: String, name: String): Task {
        val t = api.renameTask(id, name)
        _tasks.value = _tasks.value?.map { if (it.id == id) it.copy(name = t.name) else it }
        relay()?.relayTaskUpdated(AppJson.encodeToString(Task.serializer(), t))
        requestRefresh()
        return t
    }

    suspend fun hideTask(id: String) {
        api.hideTask(id)
        _tasks.value = _tasks.value?.filterNot { it.id == id }
        relay()?.relayTaskDeleted(id)
        requestRefresh()
    }

    suspend fun restoreTask(id: String): Task {
        val t = api.setHidden(id, false)
        relay()?.relayTaskUpdated(AppJson.encodeToString(Task.serializer(), t))
        requestRefresh()
        return t
    }

    fun bumpData() {
        _dataVersion.value += 1
    }

    fun optimisticRemoveEvent(eventId: String) {
        _tasks.value = _tasks.value?.map { t -> if (t.events.any { it.id == eventId }) t.copy(events = t.events.filterNot { it.id == eventId }) else t }
    }
}
