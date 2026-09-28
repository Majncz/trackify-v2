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

    Box(Modifier.fillMaxSize()) {
    Column(Modifier.fillMaxSize()) {
        // Top app bar: today's total (live); a status dot only when the live connection has a problem.
        CappedFontScale {
            Row(
                Modifier.fillMaxWidth().height(64.dp).padding(start = 16.dp, end = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("Today", fontSize = 22.sp, color = T.c.foreground)
                Spacer(Modifier.width(10.dp))
                Text(
                    if (tasksOrNull == null) "—" else Format.durationWords(todayTotal).let { if (todayTotal < 60_000) "0m" else it },
                    fontSize = 22.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.primary, style = Tabular,
                )
                Spacer(Modifier.weight(1f))
                if (status != ConnectionStatus.Connected) {
                    ConnectionDot(status)
                    Spacer(Modifier.width(8.dp))
                    Text(
                        if (status == ConnectionStatus.Reconnecting) "Connecting…" else "Offline",
                        fontSize = 14.sp, color = T.c.mutedForeground,
                    )
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
            // When a timer starts while the list is at the top, reveal the running card (it is inserted above).
            val listState = rememberLazyListState()
            val hasRunning = running != null
            LaunchedEffect(hasRunning) {
                if (hasRunning && listState.firstVisibleItemIndex <= 1) listState.scrollToItem(0)
            }
            LazyColumn(
                Modifier.fillMaxSize(),
                state = listState,
                contentPadding = PaddingValues(bottom = 96.dp),
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
                        Row(Modifier.widthIn(max = 720.dp).fillMaxWidth().height(72.dp).padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                            Skeleton(Modifier.size(40.dp).clip(CircleShape))
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
                        if (q.isEmpty() && shown.isNotEmpty()) item(key = "hint") {
                            Text(
                                if (running != null) "Tap a task to switch · hold for more" else "Tap a task to start · hold for more",
                                fontSize = 14.sp, color = T.c.mutedForeground,
                                modifier = Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 4.dp),
                            )
                        }
                        // The running task is the card above; it only shows in the list while searching.
                        items(if (q.isEmpty() && running != null) shown.filter { it.id != running.taskId } else shown, key = { it.id }) { t ->
                            val isRunning = running?.taskId == t.id
                            TaskRow(
                                t, isRunning,
                                pending = (isRunning && timer.pending) || t.id in timer.savingTaskIds,
                                todayMs = todayMs(t, running?.startTime?.takeIf { isRunning }, now),
                                onTap = { tap(t) }, onMenu = { focus.clearFocus(); menuFor = t },
                                onStop = { graph.engine.stop() },
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
        FloatingActionButton(
            onClick = { newTaskOpen = true },
            containerColor = MaterialTheme.colorScheme.primaryContainer,
            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
            modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
        ) { Icon(Icons.Outlined.Add, "New task") }
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

/** Readable text colour on top of [bg]. */
private fun onColor(bg: Color): Color = if (bg.luminance() > 0.45f) Color(0xFF1B1B1F) else Color.White

/**
 * The running task, as the hero of the screen: a primary-container card with the task, a big live clock and one
 * big Stop. Tap the clock or "Started …" to fix the session; tap the name to open the task.
 */
@Composable
private fun RunningCard(timer: TimerUi, task: Task?, now: Long, onClock: () -> Unit, onStop: () -> Unit, onName: () -> Unit) {
    val r = timer.running ?: return
    val cs = MaterialTheme.colorScheme
    val elapsed = maxOf(0L, now - r.startTime)
    val on = cs.onPrimaryContainer
    Column(
        Modifier
            .widthIn(max = 720.dp)
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 4.dp)
            .clip(RoundedCornerShape(28.dp))
            .background(cs.primaryContainer)
            .padding(start = 20.dp, end = 20.dp, top = 16.dp, bottom = 20.dp),
    ) {
        Row(
            Modifier.clip(RoundedCornerShape(12.dp)).clickable(onClickLabel = "Open task", onClick = onName).padding(vertical = 4.dp),
            verticalAlignment = Alignment.Top,
        ) {
            AccentDot(hexColor(task?.accent ?: "#22C55E"), 12.dp, Modifier.padding(top = 7.dp))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f, fill = false)) {
                Text(task?.name ?: "…", fontSize = 18.sp, fontWeight = FontWeight.Medium, color = on, maxLines = 2, overflow = TextOverflow.Ellipsis)
                task?.taskGroup?.let { Text(it.name, fontSize = 14.sp, color = on.copy(alpha = 0.75f), maxLines = 1, overflow = TextOverflow.Ellipsis) }
            }
        }
        // The clock is a display number: it scales with the card width, not with the font-size setting.
        // Short screens: the Stop button sits beside the clock instead of below it.
        val compact = androidx.compose.ui.platform.LocalConfiguration.current.screenHeightDp < 700
        Row(verticalAlignment = Alignment.CenterVertically) {
        BoxWithConstraints(Modifier.weight(1f)) {
            val size = (maxWidth.value / 4.9f).coerceAtMost(72f)
            CappedFontScale(1f) {
                Text(
                    Format.duration(elapsed),
                    style = MonoDigits, fontSize = size.sp, fontWeight = FontWeight.Normal, color = on,
                    maxLines = 1, letterSpacing = (-1).sp,
                    modifier = Modifier
                        .clip(RoundedCornerShape(12.dp))
                        .clickable(onClickLabel = "Fix this session", role = Role.Button, onClick = onClock)
                        .semantics { contentDescription = "Elapsed ${Format.durationWords(elapsed, true)}. Tap to fix this session" }
                        .padding(vertical = 2.dp),
                )
            }
        }
        if (compact) {
            Spacer(Modifier.width(12.dp))
            FilledIconButton(
                onClick = onStop,
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = cs.primary, contentColor = cs.onPrimary),
                modifier = Modifier.size(64.dp),
            ) { Icon(Icons.Filled.Stop, "Stop", modifier = Modifier.size(28.dp)) }
        }
        }
        Pulsing(timer.pending) { a ->
            Row(
                Modifier.alpha(a).clip(RoundedCornerShape(8.dp)).clickable(onClickLabel = "Fix this session", onClick = onClock).padding(vertical = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    if (timer.pending) "Syncing…" else "Started ${Time.clock(r.startTime)}",
                    fontSize = 14.sp, color = on.copy(alpha = 0.8f),
                )
                if (!timer.pending) {
                    Spacer(Modifier.width(6.dp))
                    Icon(Icons.Outlined.Edit, null, tint = on.copy(alpha = 0.8f), modifier = Modifier.size(16.dp))
                }
            }
        }
        if (!compact) {
        Spacer(Modifier.height(12.dp))
        Row(
            Modifier
                .fillMaxWidth()
                .heightIn(min = 56.dp)
                .clip(RoundedCornerShape(28.dp))
                .background(cs.primary)
                .clickable(role = Role.Button, onClickLabel = "Stop", onClick = onStop),
            horizontalArrangement = Arrangement.Center,
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.Filled.Stop, null, tint = cs.onPrimary, modifier = Modifier.size(24.dp))
            Spacer(Modifier.width(8.dp))
            Text("Stop", color = cs.onPrimary, fontSize = 16.sp, fontWeight = FontWeight.Medium)
        }
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
        cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Sentences, imeAction = ImeAction.Go),
        keyboardActions = KeyboardActions(onGo = { onGo() }),
        modifier = Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
        decorationBox = { inner ->
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = 56.dp)
                    .clip(RoundedCornerShape(28.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                    .padding(start = 16.dp, end = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Search, null, tint = T.c.mutedForeground, modifier = Modifier.size(24.dp))
                Spacer(Modifier.width(16.dp))
                Box(Modifier.weight(1f)) {
                    if (value.isEmpty()) Text("Start a task…", color = T.c.mutedForeground, fontSize = 16.sp, maxLines = 1)
                    inner()
                }
                if (value.isNotEmpty()) {
                    IconButton(onClick = { onChange("") }) { Icon(Icons.Outlined.Close, "Clear", tint = T.c.mutedForeground) }
                } else Spacer(Modifier.width(12.dp))
            }
        },
    )
}

/** Round avatar in the task's colour with its initial (Material list-item leading element). */
@Composable
private fun TaskAvatar(task: Task, size: androidx.compose.ui.unit.Dp = 40.dp) {
    val accent = hexColor(task.accent)
    Box(Modifier.size(size).clip(CircleShape).background(accent), contentAlignment = Alignment.Center) {
        CappedFontScale(1f) {
            Text(
                task.name.trim().firstOrNull()?.uppercase() ?: "•",
                color = onColor(accent), fontSize = (size.value * 0.42f).sp, fontWeight = FontWeight.Medium,
            )
        }
    }
}

/**
 * One task: tap = start / switch, long-press = the row sheet. No per-row buttons; only the running row shows a
 * Stop button (and is tinted).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TaskRow(task: Task, isRunning: Boolean, pending: Boolean, todayMs: Long, onTap: () -> Unit, onMenu: () -> Unit, onStop: () -> Unit) {
    val cs = MaterialTheme.colorScheme
    val fg = if (isRunning) cs.onSecondaryContainer else cs.onSurface
    val sub = if (isRunning) cs.onSecondaryContainer.copy(alpha = 0.8f) else cs.onSurfaceVariant
    Row(
        Modifier
            .widthIn(max = 720.dp)
            .fillMaxWidth()
            .padding(horizontal = if (isRunning) 8.dp else 0.dp, vertical = if (isRunning) 4.dp else 0.dp)
            .clip(RoundedCornerShape(if (isRunning) 20.dp else 0.dp))
            .background(if (isRunning) cs.secondaryContainer else Color.Transparent)
            .combinedClickable(
                onClick = onTap, onLongClick = onMenu, role = Role.Button,
                onClickLabel = if (isRunning) "Stop" else "Start", onLongClickLabel = "More actions",
            )
            .heightIn(min = 72.dp)
            .padding(start = if (isRunning) 8.dp else 16.dp, end = if (isRunning) 8.dp else 24.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Pulsing(pending) { a -> Box(Modifier.alpha(a)) { TaskAvatar(task) } }
        Spacer(Modifier.width(16.dp))
        Column(Modifier.weight(1f).padding(vertical = 8.dp)) {
            Text(
                task.name, fontSize = 16.sp, fontWeight = if (isRunning) FontWeight.Medium else FontWeight.Normal,
                color = fg, maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
            val subtitle = listOfNotNull(if (isRunning) "Running" else null, task.taskGroup?.name).joinToString(" · ")
            if (subtitle.isNotEmpty()) Text(subtitle, fontSize = 14.sp, color = sub, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        if (todayMs >= 60_000) {
            Spacer(Modifier.width(12.dp))
            Text(Format.durationWords(todayMs), fontSize = 14.sp, color = sub, style = Tabular, maxLines = 1)
        }
        if (isRunning) {
            Spacer(Modifier.width(8.dp))
            FilledIconButton(
                onClick = onStop,
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = cs.primary, contentColor = cs.onPrimary),
                modifier = Modifier.size(48.dp),
            ) { Icon(Icons.Filled.Stop, "Stop ${task.name}") }
        }
    }
}

@Composable
private fun CreateRow(name: String, creating: Boolean, onClick: () -> Unit) {
    Row(
        Modifier.widthIn(max = 720.dp).fillMaxWidth().heightIn(min = 72.dp)
            .clickable(enabled = !creating, role = Role.Button, onClick = onClick)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
            Icon(Icons.Outlined.Add, null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
        }
        Spacer(Modifier.width(16.dp))
        Text(
            if (creating) "Creating…" else "Create \u201c$name\u201d and start", fontSize = 16.sp,
            color = T.c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis,
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

