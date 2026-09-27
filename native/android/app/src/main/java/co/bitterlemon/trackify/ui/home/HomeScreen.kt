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

    Column(Modifier.fillMaxSize()) {
        // Compact header: today's total (live), connection dot, new task.
        Row(
            Modifier.fillMaxWidth().height(64.dp).padding(start = 20.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Today", fontSize = 20.sp, color = T.c.mutedForeground)
            Spacer(Modifier.width(8.dp))
            Text(
                if (tasksOrNull == null) "—" else Format.durationWords(todayTotal).let { if (todayTotal < 60_000) "0m" else it },
                fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = Tabular,
            )
            Spacer(Modifier.width(10.dp))
            ConnectionDot(status)
            Spacer(Modifier.weight(1f))
            IconButton(onClick = { newTaskOpen = true }) {
                Icon(Icons.Outlined.Add, "New task", tint = T.c.foreground)
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
            LazyColumn(
                Modifier.fillMaxSize(),
                contentPadding = PaddingValues(bottom = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                if (running != null) {
                    item(key = "running") {
                        RunningCard(
                            timer, tasks.firstOrNull { it.id == running.taskId }, now,
                            onClock = { fixOpen = true }, onStop = { graph.engine.stop() },
                            onName = { onOpenTask(running.taskId) },
                        )
                    }
                }
                item(key = "search") {
                    SearchField(query, { query = it.take(100) }, onGo = { go() })
                }
                saveError?.let { msg ->
                    item(key = "save-error") {
                        ErrorAlert("Couldn't save", msg, onDismiss = { saveError = null }, modifier = Modifier.widthIn(max = 720.dp).padding(horizontal = 16.dp, vertical = 4.dp))
                    }
                }
                when {
                    tasksOrNull == null && tasksError != null -> item(key = "err") {
                        ErrorAlert("Couldn't load tasks", tasksError, modifier = Modifier.widthIn(max = 720.dp).padding(16.dp))
                    }
                    tasksOrNull == null -> items(6, key = { "sk$it" }) {
                        Row(Modifier.widthIn(max = 720.dp).fillMaxWidth().height(60.dp).padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                            Skeleton(Modifier.size(10.dp))
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
            SheetAction(Icons.Outlined.History, "Log past time", { menuFor = null; logFor = t })
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

@Composable
private fun RunningCard(timer: TimerUi, task: Task?, now: Long, onClock: () -> Unit, onStop: () -> Unit, onName: () -> Unit) {
    val r = timer.running ?: return
    val elapsed = maxOf(0L, now - r.startTime)
    Column(
        Modifier
            .widthIn(max = 720.dp)
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(16.dp))
            .background(T.c.muted)
            .padding(start = 20.dp, end = 16.dp, top = 16.dp, bottom = 16.dp),
    ) {
        Row(
            Modifier.clip(RoundedCornerShape(6.dp)).clickable(onClickLabel = "Open task", onClick = onName),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AccentDot(hexColor(task?.accent ?: "#22C55E"), 10.dp)
            Spacer(Modifier.width(10.dp))
            Text(task?.name ?: "…", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
            task?.taskGroup?.let {
                Text("  ·  ${it.name}", fontSize = 14.sp, color = T.c.mutedForeground, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                Format.duration(elapsed),
                style = MonoDigits, fontSize = 40.sp, fontWeight = FontWeight.Bold, color = T.c.foreground,
                modifier = Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(8.dp))
                    .clickable(onClickLabel = "Fix this session", role = Role.Button, onClick = onClock)
                    .semantics { contentDescription = "Elapsed ${Format.durationWords(elapsed, true)}. Tap to fix this session" }
                    .padding(vertical = 6.dp),
            )
            Spacer(Modifier.width(12.dp))
            Row(
                Modifier
                    .heightIn(min = 48.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .background(T.c.destructive)
                    .clickable(role = Role.Button, onClickLabel = "Stop", onClick = onStop)
                    .padding(horizontal = 20.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Stop, null, tint = T.c.onDestructive, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(6.dp))
                Text("Stop", color = T.c.onDestructive, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        Pulsing(timer.pending) { a ->
            Text(
                if (timer.pending) "Syncing…" else "Since ${Time.clock(r.startTime)} · tap the time to fix it",
                fontSize = 13.sp, color = T.c.mutedForeground, modifier = Modifier.alpha(a),
            )
        }
    }
}

@Composable
private fun SearchField(value: String, onChange: (String) -> Unit, onGo: () -> Unit) {
    BasicTextField(
        value = value,
        onValueChange = onChange,
        singleLine = true,
        textStyle = TextStyle(fontSize = 16.sp, color = T.c.foreground),
        cursorBrush = SolidColor(T.c.foreground),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Go),
        keyboardActions = KeyboardActions(onGo = { onGo() }),
        modifier = Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        decorationBox = { inner ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 48.dp)
                    .clip(RoundedCornerShape(24.dp))
                    .border(1.dp, T.c.border, RoundedCornerShape(24.dp))
                    .padding(start = 16.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Search, null, tint = T.c.mutedForeground, modifier = Modifier.size(20.dp))
                Spacer(Modifier.width(12.dp))
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty()) Text("Start a task…", color = T.c.mutedForeground, fontSize = 16.sp, maxLines = 1)
                    inner()
                }
                if (value.isNotEmpty()) {
                    IconButton(onClick = { onChange("") }) { Icon(Icons.Outlined.Close, "Clear", tint = T.c.mutedForeground, modifier = Modifier.size(20.dp)) }
                } else Spacer(Modifier.width(12.dp))
            }
        },
    )
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TaskRow(task: Task, isRunning: Boolean, pending: Boolean, todayMs: Long, onTap: () -> Unit, onMenu: () -> Unit) {
    Column(Modifier.widthIn(max = 720.dp).fillMaxWidth()) {
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 60.dp)
                .background(if (isRunning) T.c.muted.copy(alpha = 0.6f) else androidx.compose.ui.graphics.Color.Transparent)
                .combinedClickable(
                    onClick = onTap, onLongClick = onMenu, role = Role.Button,
                    onClickLabel = if (isRunning) "Stop" else "Start", onLongClickLabel = "More actions",
                )
                .padding(start = 20.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AccentDot(hexColor(task.accent), 10.dp)
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
                Text(
                    task.name, fontSize = 16.sp, fontWeight = if (isRunning) FontWeight.SemiBold else FontWeight.Normal,
                    color = T.c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis,
                )
                task.taskGroup?.let { Text(it.name, fontSize = 13.sp, color = T.c.mutedForeground, maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
            if (todayMs >= 60_000) {
                Spacer(Modifier.width(8.dp))
                Text(Format.durationWords(todayMs), fontSize = 14.sp, color = T.c.mutedForeground, style = Tabular, maxLines = 1)
            }
            Spacer(Modifier.width(12.dp))
            Pulsing(pending) { a ->
                Box(
                    Modifier.size(36.dp).alpha(a).clip(CircleShape)
                        .then(if (isRunning) Modifier.background(T.c.foreground) else Modifier.border(1.dp, T.c.border, CircleShape)),
                    contentAlignment = Alignment.Center,
                ) {
                    Icon(
                        if (isRunning) Icons.Outlined.Stop else Icons.Outlined.PlayArrow, null,
                        tint = if (isRunning) T.c.background else T.c.foreground, modifier = Modifier.size(20.dp),
                    )
                }
            }
            IconButton(onClick = onMenu) { Icon(Icons.Outlined.MoreVert, "More for ${task.name}", tint = T.c.mutedForeground) }
        }
        RowDivider(inset = 46.dp)
    }
}

@Composable
private fun CreateRow(name: String, creating: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.widthIn(max = 720.dp).fillMaxWidth().heightIn(min = 60.dp)
            .clickable(enabled = !creating, role = Role.Button, onClick = onClick)
            .padding(horizontal = 20.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Outlined.Add, null, tint = T.c.foreground, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(12.dp))
        Text(
            if (creating) "Creating…" else "Create \u201c$name\u201d and start", fontSize = 16.sp, fontWeight = FontWeight.Medium,
            color = T.c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
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

