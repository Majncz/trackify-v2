package co.bitterlemon.trackify

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.os.Build
import androidx.core.content.getSystemService
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import co.bitterlemon.trackify.data.ApiClient
import co.bitterlemon.trackify.data.Repository
import co.bitterlemon.trackify.data.Session
import co.bitterlemon.trackify.data.SessionStore
import co.bitterlemon.trackify.data.SocketListener
import co.bitterlemon.trackify.data.SocketManager
import co.bitterlemon.trackify.timer.Running
import co.bitterlemon.trackify.timer.TimerEngine
import co.bitterlemon.trackify.timer.TimerNotifier
import co.bitterlemon.trackify.timer.TimerSyncWorker
import co.bitterlemon.trackify.util.Shortcuts
import co.bitterlemon.trackify.widget.WidgetSnapshot
import co.bitterlemon.trackify.widget.WidgetUpdater
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.async
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/** Manual DI container. One per process; widgets, tile, receivers and the worker use it too. */
class AppGraph(private val context: Context) {
    val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    val session = SessionStore(context).also { it.loadBlocking() }

    /** Set when a 401 signed us out, so the login screen can say why. */
    private val _sessionExpired = MutableStateFlow(false)
    val sessionExpired: StateFlow<Boolean> = _sessionExpired.asStateFlow()

    val api = ApiClient(
        serverUrl = { session.server.value },
        token = { session.session.value?.token },
        onUnauthorized = { handleUnauthorized() },
    )

    private var socketRef: SocketManager? = null
    val repo = Repository(context, api) { socketRef }

    val engine = TimerEngine(
        context = context,
        api = api,
        serverUrl = { session.server.value },
        userId = { session.session.value?.userId },
        onUnauthorized = { handleUnauthorized() },
        onOpApplied = { repo.requestRefresh() },
        scheduleBackgroundSync = { pending -> if (pending) TimerSyncWorker.schedule(context) },
    )

    val socket = SocketManager(object : SocketListener {
        override fun onAuthenticated() {
            engine.kick()
            scope.launch { engine.refreshTruth() }
            repo.requestRefresh(0)
        }
        override fun onTimerStarted(taskId: String, startTime: Long) {
            engine.onRemoteStarted(taskId, startTime); repo.requestRefresh()
        }
        override fun onTimerState(taskId: String, startTime: Long) = engine.onRemoteStarted(taskId, startTime)
        override fun onTimerStopped(taskId: String?) {
            engine.onRemoteStopped(taskId); repo.requestRefresh()
        }
        override fun onTimerStartUpdated(taskId: String, startTime: Long) {
            engine.onRemoteStartUpdated(taskId, startTime); repo.signalPresence()
        }
        override fun onTasksChanged() = repo.requestRefresh()
        override fun onPresenceChanged() = repo.signalPresence()
        override fun onAuthError() {
            scope.launch {
                // Token might be expired: confirm over REST (a 401 signs out).
                runCatching { api.profile() }
            }
        }
    }).also { socketRef = it }

    val notifier = TimerNotifier(context)

    @Volatile var foreground = false
        private set

    fun start() {
        engine.ensureUser(session.session.value?.userId)
        // Cached tasks can be large (every event); parse off the main thread.
        scope.launch(kotlinx.coroutines.Dispatchers.IO) {
            repo.loadCache()
            // Every process start (first launch after an update included) redraws the widgets with this build.
            syncSurfaces()
            WidgetUpdater.updateAllNow(context)
            runCatching { co.bitterlemon.trackify.widget.WidgetPreviews.publish(context) }
            if (co.bitterlemon.trackify.widget.TeamSnapshot.anyTeamWidget(context)) {
                co.bitterlemon.trackify.widget.TeamRefreshWorker.ensure(context)
                co.bitterlemon.trackify.widget.TeamSnapshot.refresh(context, minGapMs = 60_000)
            }
        }
        observeEffects()
        ProcessLifecycleOwner.get().lifecycle.addObserver(object : DefaultLifecycleObserver {
            override fun onStart(owner: LifecycleOwner) {
                foreground = true
                onForeground()
            }
            override fun onStop(owner: LifecycleOwner) {
                foreground = false
                updateSocket()
            }
        })
        context.getSystemService<ConnectivityManager>()?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                engine.kick()
                socket.nudge()
            }
        })
        if (engine.persisted.value.queue.isNotEmpty()) engine.kick()
    }

    fun onForeground() {
        if (session.session.value == null) return
        updateSocket()
        engine.kick()
        socket.nudge()
        scope.launch {
            engine.refreshTruth()
            repo.refreshAll()
            co.bitterlemon.trackify.widget.TeamSnapshot.refresh(context)
            session.session.value?.let { s ->
                repo.profile.value?.id?.let { id -> if (id != s.userId) session.updateUserId(id) }
            }
        }
    }

    /** Socket stays up while the app is visible or a timer runs (so the notification stays true). */
    fun updateSocket() {
        val s = session.session.value
        if (s == null) {
            socket.disconnect(); return
        }
        if (foreground || engine.persisted.value.running != null) socket.connect(session.server.value, s.token)
        else socket.disconnect()
    }

    @OptIn(FlowPreview::class)
    private fun observeEffects() {
        // Team widgets follow the app's presence signal (timer ops, socket presence events, task syncs).
        scope.launch { repo.presenceSignal.collect { scope.launch { co.bitterlemon.trackify.widget.TeamSnapshot.refresh(context) } } }
        // A rejected timer op: the engine re-adopts the server state; say why on the widgets for a moment.
        scope.launch { engine.errors.collect { WidgetSnapshot.setNotice(it); syncSurfaces() } }
        scope.launch {
            combine(engine.ui, repo.tasks, session.session) { ui, tasks, s -> Triple(ui, tasks, s) }
                .debounce(150)
                .collect { syncSurfaces() }
        }
        scope.launch {
            engine.ui.combine(session.session) { ui, s -> if (s == null) null else ui.running?.taskId }.distinctUntilChanged().collect { runningId ->
                updateSocket()
                if (runningId != null) co.bitterlemon.trackify.timer.TimerRefreshWorker.schedule(context)
                else co.bitterlemon.trackify.timer.TimerRefreshWorker.cancel(context)
            }
        }
    }

    /** Push the current timer/task state to the notification, widgets, tile and launcher shortcuts. */
    fun syncSurfaces() {
        val s = session.session.value
        val ui = engine.ui.value
        val snap = WidgetSnapshot.build(
            s != null, session.server.value, s?.userId, ui.running, ui.pending, repo.tasks.value, session.widgetTheme.value,
            prev = WidgetSnapshot.read(context),
        )
        WidgetSnapshot.write(context, snap)
        notifier.update(snap)
        WidgetUpdater.updateAll(context)
        WidgetUpdater.requestTileUpdate(context)
        Shortcuts.update(context, snap)
    }

    /** syncSurfaces + wait for the widget redraw (background taps: the process may freeze right after). */
    suspend fun syncSurfacesNow() {
        syncSurfaces()
        WidgetUpdater.updateAllNow(context)
    }

    /**
     * A timer tap outside the app (widget, notification): show the new state on every surface right away and
     * wait until the widgets have drawn it, then let an expedited job send the op. Never waits for the network,
     * so the broadcast finishes quickly and the next tap isn't queued behind this one.
     */
    suspend fun afterExternalTap() {
        syncSurfaces()
        WidgetUpdater.redrawAndWait(context)
        if (engine.persisted.value.queue.isNotEmpty()) TimerSyncWorker.expedite(context)
    }

    // Runs in the app scope: storing the session swaps the login screen out right away, which cancels the
    // caller's scope — the rest of sign-in (persisting the token, first data load) must still finish.
    suspend fun signIn(email: String, password: String): Result<Unit> = scope.async { signInInternal(email, password) }.await()

    private suspend fun signInInternal(email: String, password: String): Result<Unit> = runCatching {
        val device = "Android · ${Build.MANUFACTURER} ${Build.MODEL}".take(60)
        val res = api.login(email.trim(), password, device)
        val newSession = Session(res.token, res.user.id, res.user.email)
        if (engine.persisted.value.userId != null && engine.persisted.value.userId != res.user.id) engine.clear()
        repo.clear()
        session.signIn(newSession)
        _sessionExpired.value = false
        engine.ensureUser(res.user.id)
        updateSocket()
        // The login screen leaves composition right away; load data in the app scope.
        scope.launch {
            repo.refreshAll()
            engine.refreshTruth()
            repo.profile.value?.id?.let { if (it != res.user.id) session.updateUserId(it) }
        }
        Unit
    }

    /** Sign out: flush the queue briefly, revoke the token, wipe local data. */
    suspend fun signOut() {
        withTimeoutOrNull(3000) { engine.drain(3000) }
        runCatching { withTimeoutOrNull(4000) { api.logout() } }
        wipeLocal()
    }

    private fun wipeLocal() {
        scope.launch { session.signOut() }
        engine.clear()
        repo.clear()
        co.bitterlemon.trackify.ui.team.PresenceCache.map.clear()
        co.bitterlemon.trackify.widget.TeamSnapshot.clear(context)
        socket.disconnect()
        notifier.cancel()
        TimerSyncWorker.cancel(context)
    }

    private fun handleUnauthorized() {
        if (session.session.value == null) return
        _sessionExpired.value = true
        wipeLocal()
    }

    fun currentRunning(): Running? = engine.persisted.value.running

    companion object {
        @Volatile private var instance: AppGraph? = null
        fun get(context: Context): AppGraph = instance ?: synchronized(this) {
            instance ?: AppGraph(context.applicationContext).also {
                instance = it
                it.start()
            }
        }
    }
}
