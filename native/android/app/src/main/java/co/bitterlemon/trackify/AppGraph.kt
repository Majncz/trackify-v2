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

    // Loading the session reads DataStore and decrypts the token with the Keystore: tens to hundreds of ms on a
    // cold process. Widget / tile / notification taps don't need it (the widget snapshot says who is signed in),
    // so it loads on first use — in the app, or in the background after a tap.
    private val sessionLazy = lazy { SessionStore(context).also { it.loadBlocking() } }
    val session: SessionStore by sessionLazy

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
        // WorkManager is initialised on demand: never on the tap path.
        scheduleBackgroundSync = { pending -> if (pending) scope.launch { runCatching { TimerSyncWorker.schedule(context) } } },
    )

    val socket = SocketManager(object : SocketListener {
        override fun onAuthenticated() {
            engine.kick()
            scope.launch { engine.refreshTruth("socket connected") }
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

    val notifier by lazy { TimerNotifier(context) }

    @Volatile var foreground = false
        private set

    fun start() {
        // Everything heavy runs in the background, after a timer tap that started this process has redrawn the
        // widgets (the tap competes for the same few CPU cores on a cold start).
        scope.launch(kotlinx.coroutines.Dispatchers.IO) {
            co.bitterlemon.trackify.timer.TimerTap.awaitIdle()
            engine.ensureUser(session.session.value?.userId)
            context.getSystemService<ConnectivityManager>()?.registerDefaultNetworkCallback(object : ConnectivityManager.NetworkCallback() {
                override fun onAvailable(network: Network) {
                    engine.kick()
                    socket.nudge()
                }
            })
            if (engine.persisted.value.queue.isNotEmpty()) engine.kick()
            // Cached tasks can be large (every event); parse off the main thread.
            repo.loadCache()
            // Every process start (first launch after an update included) redraws the widgets with this build.
            syncSurfaces()
            // Redraw through Glance too (new build, new day), a little later: a tap that started this process
            // has pushed its own RemoteViews already and shouldn't compete with eight Glance compositions.
            kotlinx.coroutines.delay(5_000)
            co.bitterlemon.trackify.widget.FastWidgets.push(context, force = false)
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
    }

    fun onForeground() {
        if (session.session.value == null) return
        updateSocket()
        engine.kick()
        socket.nudge()
        scope.launch {
            engine.refreshTruth("app foreground")
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
        val snap = buildSnapshot()
        notifier.update(snap)
        // Our own RemoteViews first (no Glance session / WorkManager needed), then the regular Glance update.
        co.bitterlemon.trackify.widget.FastWidgets.pushAsync(context)
        WidgetUpdater.updateAll(context)
        WidgetUpdater.requestTileUpdate(context)
        Shortcuts.update(context, snap)
    }

    /**
     * Build and store the widget snapshot from the live timer and tasks. [fromSnapshot] (timer taps) takes who is
     * signed in, the server and the widget theme from the previous snapshot instead of loading the session.
     */
    fun buildSnapshot(fromSnapshot: Boolean = false): co.bitterlemon.trackify.widget.WidgetSnapshotData {
        // Load the session (if needed) before taking the snapshot lock, so a tap on the main thread never waits on it.
        if (!fromSnapshot) session.session.value
        return WidgetSnapshot.update(context, stamp = { listOf(engine.ui.value, repo.tasks.value) }) { prev ->
            val ui = engine.ui.value
            if (fromSnapshot && !sessionLazy.isInitialized()) {
                WidgetSnapshot.build(prev.signedIn, prev.serverUrl, prev.userId, ui.running, ui.pending, repo.tasks.value, prev.theme, prev)
            } else {
                val s = session.session.value
                WidgetSnapshot.build(s != null, session.server.value, s?.userId, ui.running, ui.pending, repo.tasks.value, session.widgetTheme.value, prev)
            }
        }
    }

    /** syncSurfaces + wait for the widget redraw (background taps: the process may freeze right after). */
    suspend fun syncSurfacesNow() {
        syncSurfaces()
        co.bitterlemon.trackify.widget.FastWidgets.push(context, force = false)
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
