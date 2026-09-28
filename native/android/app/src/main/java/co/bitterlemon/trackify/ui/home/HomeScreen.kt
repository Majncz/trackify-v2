package co.bitterlemon.trackify.ui.home

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.History
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.Icon
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.IconButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Cancel
import co.bitterlemon.trackify.ui.components.GroupPill
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import co.bitterlemon.trackify.data.ConnectionStatus
import co.bitterlemon.trackify.ui.components.CappedFontScale
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.Task
import co.bitterlemon.trackify.data.TaskSort
import co.bitterlemon.trackify.timer.TimerUi
import co.bitterlemon.trackify.ui.auth.friendlyError
import co.bitterlemon.trackify.ui.components.AccentDot
import co.bitterlemon.trackify.ui.components.ActionSheet
import co.bitterlemon.trackify.ui.components.BtnVariant
import co.bitterlemon.trackify.ui.components.ConfirmDialog
import co.bitterlemon.trackify.ui.components.ConnectionDot
import co.bitterlemon.trackify.ui.components.ErrorAlert
import co.bitterlemon.trackify.ui.components.Pulsing
import co.bitterlemon.trackify.ui.components.RowDivider
import co.bitterlemon.trackify.ui.components.SheetAction
import co.bitterlemon.trackify.ui.components.Skeleton
import co.bitterlemon.trackify.ui.components.TButton
import co.bitterlemon.trackify.ui.components.TDialog
import co.bitterlemon.trackify.ui.components.TInput
import co.bitterlemon.trackify.ui.team.rememberTicker
import co.bitterlemon.trackify.ui.theme.MonoDigits
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.ui.theme.Tabular
import co.bitterlemon.trackify.ui.theme.hexColor
import co.bitterlemon.trackify.util.Format
import co.bitterlemon.trackify.util.Time
import kotlinx.coroutines.launch

/** Time of [task] inside today (local), including the live stretch when it runs. */
private fun todayMs(task: Task, runningStart: Long?, now: Long): Long {
    val dayStart = Time.startOfDay(Time.today())
    var ms = task.events.sumOf { Time.overlap(it.fromMs, it.toMs, dayStart, now) }
    if (runningStart != null) ms += maxOf(0L, now - maxOf(runningStart, dayStart))
    return ms
}

/**
 * Timer (home): what's running, a search-to-start field and the task list. Tap a row to start/switch;
 * the row menu has Log past time, Details and Hide.
 */
@Composable
fun HomeScreen(onOpenTask: (String) -> Unit) {
    val context = LocalContext.current
    val graph = AppGraph.get(context)
    val tasksOrNull by graph.repo.tasks.collectAsState()
    val tasksError by graph.repo.tasksError.collectAsState()
    val timer by graph.engine.ui.collectAsState()
    val status by graph.socket.status.collectAsState()
    val scope = rememberCoroutineScope()
    val focus = LocalFocusManager.current
    var saveError by remember { mutableStateOf<String?>(null) }
    var newTaskOpen by remember { mutableStateOf(false) }
    var fixOpen by remember { mutableStateOf(false) }
    var logFor by remember { mutableStateOf<Task?>(null) }
    var menuFor by remember { mutableStateOf<Task?>(null) }
    var hideFor by remember { mutableStateOf<Task?>(null) }
    var query by rememberSaveable { mutableStateOf("") }
    var refreshing by remember { mutableStateOf(false) }
    var creating by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { graph.engine.errors.collect { saveError = it } }

    val notifLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { graph.notifier.invalidate(); graph.repo.requestRefresh(0) }
    fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    val tasks = tasksOrNull ?: emptyList()
    val running = timer.running
    val now = rememberTicker(true, if (running != null) 1000 else 30_000)
    val sorted = remember(tasks, running?.taskId) { TaskSort.home(tasks, running?.taskId) }
    val q = query.trim()
    val shown = if (q.isEmpty()) sorted else sorted.filter { t ->
        t.name.contains(q, ignoreCase = true) || t.taskGroup?.name?.contains(q, ignoreCase = true) == true
    }
    val exactMatch = q.isNotEmpty() && tasks.any { it.name.equals(q, ignoreCase = true) }
    val todayTotal = tasks.sumOf { t -> todayMs(t, running?.startTime?.takeIf { running.taskId == t.id }, now) }

    fun start(id: String) {
        graph.engine.start(id)
        ensureNotificationPermission()
    }

    fun tap(t: Task) {
        if (running?.taskId == t.id) graph.engine.stop() else start(t.id)
        if (query.isNotEmpty()) {
            query = ""; focus.clearFocus()
        }
    }

    fun createAndStart(name: String) {
        if (name.isBlank() || creating) return
        creating = true
        scope.launch {
            try {
                val t = graph.repo.createTask(name.trim())
                start(t.id)
                query = ""; focus.clearFocus()
            } catch (e: Exception) {
                saveError = friendlyError(e, "Failed to create task")
            }
            creating = false
        }
    }

    fun go() {
        val first = shown.firstOrNull()
        when {
            q.isEmpty() -> focus.clearFocus()
            exactMatch -> tap(tasks.first { it.name.equals(q, ignoreCase = true) })
            first != null -> tap(first)
            else -> createAndStart(q)
        }
    }

    Column(Modifier.fillMaxSize().background(T.c.plain)) {
        // iOS-style header: "Today 20m ●" centred (the dot is the live connection), + on the right.
        CappedFontScale {
            Box(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 8.dp)) {
                Row(
                    Modifier.align(Alignment.Center).padding(horizontal = 56.dp).semantics(mergeDescendants = true) { },
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text("Today", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = T.c.mutedForeground)
                    Spacer(Modifier.width(6.dp))
                    Text(
                        if (tasksOrNull == null) "—" else Format.durationWords(todayTotal).let { if (todayTotal < 60_000) "0m" else it },
                        fontSize = 17.sp, fontWeight = FontWeight.Bold, color = T.c.foreground, style = Tabular, maxLines = 1,
                    )
                    Spacer(Modifier.width(6.dp))
                    ConnectionDot(status)
                    if (status != ConnectionStatus.Connected) {
                        Spacer(Modifier.width(6.dp))
                        Text(
                            if (status == ConnectionStatus.Reconnecting) "Connecting…" else "Offline",
                            fontSize = 13.sp, color = T.c.mutedForeground, maxLines = 1,
                        )
                    }
                }
                IconButton(
                    onClick = { newTaskOpen = true },
                    modifier = Modifier.align(Alignment.CenterEnd).size(44.dp),
                ) {
                    Box(
                        Modifier.size(40.dp).clip(CircleShape).background(T.c.fill),
                        contentAlignment = Alignment.Center,
                    ) { Icon(Icons.Outlined.Add, "New task", tint = T.c.foreground, modifier = Modifier.size(24.dp)) }
                }
            }
        }

        PullToRefreshBox(
            isRefreshing = refreshing,
            onRefresh = {
                refreshing = true
                scope.launch { graph.engine.refreshTruth(); graph.repo.refreshAll(); refreshing = false }
            },
            modifier = Modifier.fillMaxSize(),
        ) {
            // When a timer starts while the list is at the top, reveal the running section (it is inserted above).
            val listState = rememberLazyListState()
            val hasRunning = running != null
            LaunchedEffect(hasRunning) {
                if (hasRunning && listState.firstVisibleItemIndex <= 1) listState.scrollToItem(0)
            }
            LazyColumn(
                Modifier.fillMaxSize(),
                state = listState,
                contentPadding = PaddingValues(bottom = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                saveError?.let { msg ->
                    item(key = "save-error") {
                        ErrorAlert("Couldn't save", msg, onDismiss = { saveError = null }, modifier = Modifier.widthIn(max = 720.dp).padding(horizontal = 16.dp, vertical = 4.dp))
                    }
                }
                // The running timer, like iOS: hidden while searching.
                if (running != null && q.isEmpty()) {
                    item(key = "running") {
                        RunningSection(
                            timer, tasks.firstOrNull { it.id == running.taskId }, now,
                            onClock = { fixOpen = true }, onStop = { graph.engine.stop() },
                            onName = { onOpenTask(running.taskId) },
                        )
                    }
                }
                item(key = "search") {
                    SearchField(query, { query = it.take(100) }, onGo = { go() })
                }
                when {
                    tasksOrNull == null && tasksError != null -> item(key = "err") {
                        ErrorAlert("Couldn't load tasks", tasksError, modifier = Modifier.widthIn(max = 720.dp).padding(16.dp))
                    }
                    tasksOrNull == null -> items(6, key = { "sk$it" }) {
                        Row(Modifier.widthIn(max = 720.dp).fillMaxWidth().height(64.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Skeleton(Modifier.size(10.dp).clip(CircleShape))
                            Spacer(Modifier.width(16.dp))
                            Skeleton(Modifier.weight(1f).height(16.dp))
                            Spacer(Modifier.width(48.dp))
                        }
                    }
                    tasks.isEmpty() && q.isEmpty() -> item(key = "empty") {
                        Text(
                            "No tasks yet. Type a name above to create one and start it.",
                            color = T.c.mutedForeground, fontSize = 15.sp,
                            modifier = Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(horizontal = 20.dp, vertical = 32.dp),
                            textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                        )
                    }
                    else -> {
                        items(shown, key = { it.id }) { t ->
                            val isRunning = running?.taskId == t.id
                            TaskRow(
                                t, isRunning,
                                pending = (isRunning && timer.pending) || t.id in timer.savingTaskIds,
                                todayMs = todayMs(t, running?.startTime?.takeIf { isRunning }, now),
                                onTap = { tap(t) }, onMenu = { focus.clearFocus(); menuFor = t },
                            )
                        }
                        if (q.isNotEmpty() && !exactMatch) item(key = "create") {
                            CreateRow(q, creating) { createAndStart(q) }
                        }
                    }
                }
            }
        }
    }

    menuFor?.let { t ->
        ActionSheet(t.name, onDismiss = { menuFor = null }) {
            val isRunning = running?.taskId == t.id
            SheetAction(
                if (isRunning) Icons.Filled.Stop else Icons.Filled.PlayArrow, if (isRunning) "Stop" else "Start",
                { menuFor = null; tap(t) }, first = true,
            )
            SheetAction(Icons.Outlined.History, "Log past time…", { menuFor = null; logFor = t })
            SheetAction(Icons.Outlined.Info, "Details", { menuFor = null; onOpenTask(t.id) })
            SheetAction(Icons.Outlined.VisibilityOff, "Hide", { menuFor = null; hideFor = t }, destructive = true)
        }
    }
    hideFor?.let { t ->
        ConfirmDialog(
            "Hide task?", "Hide \"${t.name}\"? You can restore it from More → Hidden tasks.", "Hide",
            onConfirm = {
                scope.launch {
                    try {
                        if (timer.running?.taskId == t.id) graph.engine.stop()
                        graph.repo.hideTask(t.id)
                    } catch (e: Exception) {
                        saveError = friendlyError(e, "Couldn't hide the task")
                    }
                }
            },
            onDismiss = { hideFor = null },
        )
    }
    if (newTaskOpen) NewTaskDialog(onDismiss = { newTaskOpen = false })
    if (fixOpen && running != null) FixSessionDialog(running.startTime, tasks, onDismiss = { fixOpen = false })
    if (fixOpen && running == null) fixOpen = false
    logFor?.let { t -> LogPastDialog(t, tasks, running?.startTime, running?.taskId, onDismiss = { logFor = null }) }
}

/**
 * The running task, as on iOS: dot · name · group pill, then the big monospaced clock with a red Stop capsule on the
 * right, then "since 09:12 · tap the time to fix it". Tap the name to open the task, the clock to fix the session.
 */
@Composable
private fun RunningSection(timer: TimerUi, task: Task?, now: Long, onClock: () -> Unit, onStop: () -> Unit, onName: () -> Unit) {
    val r = timer.running ?: return
    val elapsed = maxOf(0L, now - r.startTime)
    val fontScale = androidx.compose.ui.platform.LocalDensity.current.fontScale
    Column(
        Modifier
            .widthIn(max = 720.dp)
            .fillMaxWidth()
            .padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 10.dp),
    ) {
        Row(
            Modifier.clip(RoundedCornerShape(8.dp)).clickable(onClickLabel = "Open task", onClick = onName).padding(vertical = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AccentDot(hexColor(task?.accent ?: "#22C55E"), 10.dp)
            Spacer(Modifier.width(10.dp))
            Text(
                task?.name ?: "…", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground,
                maxLines = 2, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false),
            )
            task?.taskGroup?.let {
                Spacer(Modifier.width(8.dp))
                GroupPill(it.name, hexColor(it.accent), Modifier.widthIn(max = 160.dp))
            }
        }
        val clock = @Composable {
            // A display number: scales with text size only up to 130 %, like the iOS clock.
            CappedFontScale(1.3f) {
                Text(
                    Format.duration(elapsed),
                    style = MonoDigits, fontFamily = co.bitterlemon.trackify.ui.theme.Mono, fontSize = 36.sp,
                    fontWeight = FontWeight.Bold, color = T.c.foreground, maxLines = 1, softWrap = false, letterSpacing = (-1.5).sp,
                    modifier = Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .clickable(onClickLabel = "Fix this session", role = Role.Button, onClick = onClock)
                        .semantics { contentDescription = "Elapsed ${Format.durationWords(elapsed, true)}. Tap to fix this session" }
                        .padding(vertical = 2.dp),
                )
            }
        }
        BoxWithConstraints(Modifier.fillMaxWidth()) {
            if (fontScale >= 1.5f || maxWidth < 300.dp) {
                Column {
                    clock()
                    Spacer(Modifier.height(8.dp))
                    StopCapsule(onStop, Modifier.fillMaxWidth())
                }
            } else {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.weight(1f)) { clock() }
                    Spacer(Modifier.width(12.dp))
                    StopCapsule(onStop)
                }
            }
        }
        Pulsing(timer.pending) { a ->
            Text(
                if (timer.pending) "Syncing…" else "since ${Time.clock(r.startTime)} · tap the time to fix it",
                fontSize = 14.sp, color = if (timer.pending) T.c.amber else T.c.mutedForeground,
                modifier = Modifier.alpha(a).padding(top = 4.dp),
            )
        }
    }
}

/** Red Stop capsule (iOS `.borderedProminent` + `.capsule`, destructive tint). */
@Composable
private fun StopCapsule(onStop: () -> Unit, modifier: Modifier = Modifier) {
    Row(
        modifier
            .heightIn(min = 48.dp)
            .clip(RoundedCornerShape(50))
            .background(T.c.stop)
            .clickable(role = Role.Button, onClickLabel = "Stop", onClick = onStop)
            .padding(horizontal = 22.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.Stop, null, tint = Color.White, modifier = Modifier.size(24.dp))
        Spacer(Modifier.width(8.dp))
        Text("Stop", color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
    }
}

@Composable
private fun SearchField(value: String, onChange: (String) -> Unit, onGo: () -> Unit) {
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        textStyle = TextStyle(fontSize = 17.sp, color = T.c.foreground),
        cursorBrush = SolidColor(T.c.foreground),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Go),
        keyboardActions = KeyboardActions(onGo = { onGo() }),
        modifier = Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(horizontal = 16.dp, vertical = 6.dp),
        decorationBox = { inner ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 44.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(T.c.fill)
                    .padding(start = 12.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Search, null, tint = T.c.mutedForeground, modifier = Modifier.size(22.dp))
                Spacer(Modifier.width(8.dp))
                Box(Modifier.weight(1f).padding(vertical = 10.dp)) {
                    if (value.isEmpty()) Text("Start a task…", color = T.c.mutedForeground, fontSize = 17.sp, maxLines = 1)
                    inner()
                }
                if (value.isNotEmpty()) {
                    IconButton(onClick = { onChange("") }, modifier = Modifier.size(40.dp)) {
                        Icon(Icons.Filled.Cancel, "Clear", tint = T.c.mutedForeground, modifier = Modifier.size(20.dp))
                    }
                } else Spacer(Modifier.width(8.dp))
            }
        },
    )
}

/**
 * One task, as on iOS: colour dot · name (group below in its colour) · today's time · a small ▶ circle. The running
 * row gets a soft green background and a red ■ circle. Tap the row (or the circle) to start / switch / stop;
 * long-press for the row sheet. Inset divider under each row.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TaskRow(task: Task, isRunning: Boolean, pending: Boolean, todayMs: Long, onTap: () -> Unit, onMenu: () -> Unit) {
    val accent = hexColor(task.accent)
    Column(
        Modifier
            .widthIn(max = 720.dp)
            .fillMaxWidth()
            .background(if (isRunning) T.c.runningRow else Color.Transparent),
    ) {
        Row(
            Modifier
                .fillMaxWidth()
                .combinedClickable(
                    onClick = onTap, onLongClick = onMenu, role = Role.Button,
                    onClickLabel = if (isRunning) "Stop" else "Start", onLongClickLabel = "More actions",
                )
                .semantics { contentDescription = task.name + if (isRunning) ", running" else "" }
                .heightIn(min = 64.dp)
                .padding(start = 16.dp, end = 16.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Pulsing(pending) { a -> AccentDot(accent, 10.dp, Modifier.alpha(a)) }
            Spacer(Modifier.width(14.dp))
            Column(Modifier.weight(1f)) {
                Text(
                    task.name, fontSize = 17.sp, fontWeight = if (isRunning) FontWeight.SemiBold else FontWeight.Normal,
                    color = T.c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis,
                )
                task.taskGroup?.let {
                    // Dark mode: lift the group colour a little so dark accents stay readable on black.
                    val gc = hexColor(it.accent).let { c -> if (T.c.dark) androidx.compose.ui.graphics.lerp(c, Color.White, 0.3f) else c }
                    Text(it.name, fontSize = 13.sp, color = gc, maxLines = 1, overflow = TextOverflow.Ellipsis)
                }
            }
            if (todayMs >= 1_000) {
                Spacer(Modifier.width(10.dp))
                Text(Format.durationWords(todayMs), fontSize = 15.sp, color = T.c.mutedForeground, style = Tabular, maxLines = 1)
            }
            Spacer(Modifier.width(12.dp))
            Box(
                Modifier.size(34.dp).clip(CircleShape).background(if (isRunning) T.c.stop else T.c.fill),
                contentAlignment = Alignment.Center,
            ) {
                Icon(
                    if (isRunning) Icons.Filled.Stop else Icons.Filled.PlayArrow, null,
                    tint = if (isRunning) Color.White else T.c.foreground, modifier = Modifier.size(if (isRunning) 18.dp else 20.dp),
                )
            }
        }
        RowDivider(Modifier.padding(end = 16.dp), inset = 40.dp)
    }
}

@Composable
private fun CreateRow(name: String, creating: Boolean, onClick: () -> Unit) {
    Column(Modifier.widthIn(max = 720.dp).fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 60.dp)
                .clickable(enabled = !creating, role = Role.Button, onClick = onClick)
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.size(26.dp).clip(CircleShape).background(T.c.foreground), contentAlignment = Alignment.Center) {
                Icon(Icons.Outlined.Add, null, tint = T.c.plain, modifier = Modifier.size(20.dp))
            }
            Spacer(Modifier.width(14.dp))
            Text(
                if (creating) "Creating…" else "Create \u201c$name\u201d and start", fontSize = 17.sp, fontWeight = FontWeight.Medium,
                color = T.c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
        }
        RowDivider(Modifier.padding(end = 16.dp), inset = 56.dp)
    }
}

@Composable
fun NewTaskDialog(onDismiss: () -> Unit, onCreated: (Task) -> Unit = {}) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    var name by remember { mutableStateOf("") }
    var creating by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun create() {
        if (name.isBlank() || creating) return
        creating = true
        scope.launch {
            try {
                val t = graph.repo.createTask(name.trim())
                onCreated(t)
                onDismiss()
            } catch (e: Exception) {
                error = friendlyError(e, "Failed to create task")
            }
            creating = false
        }
    }
    TDialog(
        "New task", onDismiss,
        footer = {
            TButton("Cancel", onDismiss, variant = BtnVariant.Outline)
            TButton(if (creating) "Creating…" else "Create task", { create() }, enabled = name.isNotBlank() && !creating)
        },
    ) {
        TInput(name, { name = it.take(100) }, placeholder = "Task name", onIme = { create() }, autoFocus = true)
        error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = T.c.destructive, fontSize = 14.sp) }
    }
}

