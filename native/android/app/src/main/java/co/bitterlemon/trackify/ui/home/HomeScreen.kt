package co.bitterlemon.trackify.ui.home

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.KeyboardArrowUp
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Stop
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import android.content.pm.PackageManager
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.Task
import co.bitterlemon.trackify.data.TaskSort
import co.bitterlemon.trackify.timer.TimerUi
import co.bitterlemon.trackify.ui.auth.friendlyError
import co.bitterlemon.trackify.ui.components.BtnSize
import co.bitterlemon.trackify.ui.components.BtnVariant
import co.bitterlemon.trackify.ui.components.CardShape
import co.bitterlemon.trackify.ui.components.ErrorAlert
import co.bitterlemon.trackify.ui.components.GroupPill
import co.bitterlemon.trackify.ui.components.PageHeader
import co.bitterlemon.trackify.ui.components.Pulsing
import co.bitterlemon.trackify.ui.components.Skeleton
import co.bitterlemon.trackify.ui.components.TButton
import co.bitterlemon.trackify.ui.components.TCard
import co.bitterlemon.trackify.ui.components.TDialog
import co.bitterlemon.trackify.ui.components.TInput
import co.bitterlemon.trackify.ui.team.LeaderboardCard
import co.bitterlemon.trackify.ui.team.rememberTicker
import co.bitterlemon.trackify.ui.theme.MonoDigits
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.ui.theme.hexColor
import co.bitterlemon.trackify.util.Format
import kotlinx.coroutines.launch

@Composable
fun HomeScreen(onOpenTask: (String) -> Unit) {
    val context = LocalContext.current
    val graph = AppGraph.get(context)
    val tasksOrNull by graph.repo.tasks.collectAsState()
    val tasksError by graph.repo.tasksError.collectAsState()
    val timer by graph.engine.ui.collectAsState()
    val scope = rememberCoroutineScope()
    var saveError by remember { mutableStateOf<String?>(null) }
    var newTaskOpen by remember { mutableStateOf(false) }
    var fixOpen by remember { mutableStateOf(false) }
    var logFor by remember { mutableStateOf<Task?>(null) }
    var expanded by rememberSaveable { mutableStateOf(false) }
    var refreshing by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { graph.engine.errors.collect { saveError = it } }

    val notifLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { graph.notifier.invalidate(); graph.repo.requestRefresh(0) }
    fun ensureNotificationPermission() {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        ) notifLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
    }

    fun start(id: String) {
        graph.engine.start(id)
        ensureNotificationPermission()
    }

    val tasks = tasksOrNull ?: emptyList()
    val running = timer.running
    val sorted = remember(tasks, running?.taskId) { TaskSort.home(tasks, running?.taskId) }

    PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = {
            refreshing = true
            scope.launch { graph.engine.refreshTruth(); graph.repo.refreshAll(); refreshing = false }
        },
        modifier = Modifier.fillMaxSize(),
    ) {
        BoxWithConstraints(Modifier.fillMaxSize()) {
            // Expanded width: two panes (work on the left, team on the right).
            val twoPane = maxWidth >= 840.dp
            val listWidth = if (twoPane) maxWidth * 0.6f else maxWidth
            val columns = when {
                listWidth < 360.dp -> 1
                listWidth < 840.dp -> 2
                listWidth < 1100.dp -> 3
                else -> 4
            }
            Row(Modifier.fillMaxSize()) {
            LazyColumn(
                Modifier.weight(if (twoPane) 0.6f else 1f).fillMaxHeight(),
                contentPadding = PaddingValues(horizontal = 16.dp, vertical = 16.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                item(key = "header") {
                    PageHeader("Dashboard", "Track your time efficiently", Modifier.widthIn(max = 896.dp)) {
                        TButton("New Task", { newTaskOpen = true }, icon = Icons.Outlined.Add)
                    }
                }
                saveError?.let { msg ->
                    item(key = "save-error") { ErrorAlert("Failed to save", msg, onDismiss = { saveError = null }, modifier = Modifier.widthIn(max = 896.dp)) }
                }
                if (running != null) {
                    item(key = "running") {
                        RunningBanner(timer, tasks.firstOrNull { it.id == running.taskId }, onClock = { fixOpen = true }, onStop = { graph.engine.stop() })
                    }
                }
                if (!twoPane) item(key = "leaderboard") { LeaderboardCard(Modifier.widthIn(max = 896.dp)) }
                item(key = "tasks-title") {
                    Text(
                        if (tasksOrNull == null) "Tasks" else "Tasks (${tasks.size})", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground,
                        modifier = Modifier.widthIn(max = 896.dp).fillMaxWidth(),
                    )
                }
                when {
                    tasksOrNull == null && tasksError != null -> item {
                        ErrorAlert("Couldn't load tasks", tasksError, modifier = Modifier.widthIn(max = 896.dp))
                    }
                    tasksOrNull == null -> item {
                        Column(Modifier.widthIn(max = 896.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            repeat(2) {
                                Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    repeat(columns) { Skeleton(Modifier.weight(1f).height(118.dp)) }
                                }
                            }
                        }
                    }
                    tasks.isEmpty() -> item {
                        TCard(Modifier.widthIn(max = 896.dp).fillMaxWidth(), padding = PaddingValues(vertical = 32.dp, horizontal = 16.dp)) {
                            Text(
                                "No tasks yet. Click \"New Task\" to get started!", color = T.c.mutedForeground, fontSize = 14.sp,
                                modifier = Modifier.fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                            )
                        }
                    }
                    else -> {
                        val maxVisible = columns * 2
                        val shown = if (expanded) sorted else sorted.take(maxVisible)
                        shown.chunked(columns).forEach { rowTasks ->
                            item(key = "row-" + rowTasks.first().id) {
                                Row(Modifier.widthIn(max = 896.dp).fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                    rowTasks.forEach { t ->
                                        TaskCard(
                                            t, timer, Modifier.weight(1f).fillMaxHeight(),
                                            onStart = { start(t.id) }, onStop = { graph.engine.stop() },
                                            onLog = { logFor = t }, onOpen = { onOpenTask(t.id) },
                                        )
                                    }
                                    repeat(columns - rowTasks.size) { Spacer(Modifier.weight(1f)) }
                                }
                            }
                        }
                        if (sorted.size > maxVisible) {
                            item(key = "expand") {
                                TButton(
                                    if (expanded) "Show Less" else "Show All (${sorted.size - maxVisible} more)",
                                    { expanded = !expanded }, variant = BtnVariant.Outline,
                                    icon = if (expanded) Icons.Outlined.KeyboardArrowUp else Icons.Outlined.KeyboardArrowDown,
                                )
                            }
                        }
                    }
                }
                if (tasks.isNotEmpty()) {
                    item(key = "time-spent") {
                        Box(Modifier.widthIn(max = 896.dp)) {
                            TimeSpentCard(tasks, running?.taskId, running?.startTime)
                        }
                    }
                }
            }
            if (twoPane) {
                androidx.compose.material3.VerticalDivider(color = T.c.border)
                LazyColumn(
                    Modifier.weight(0.4f).fillMaxHeight(),
                    contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    item(key = "leaderboard") { LeaderboardCard(Modifier.fillMaxWidth()) }
                }
            }
            }
        }
    }

    if (newTaskOpen) NewTaskDialog(onDismiss = { newTaskOpen = false })
    if (fixOpen && running != null) FixSessionDialog(running.startTime, tasks, onDismiss = { fixOpen = false })
    if (fixOpen && running == null) fixOpen = false
    logFor?.let { t -> LogPastDialog(t, tasks, running?.startTime, running?.taskId, onDismiss = { logFor = null }) }
}

@Composable
private fun RunningBanner(timer: TimerUi, task: Task?, onClock: () -> Unit, onStop: () -> Unit) {
    val r = timer.running ?: return
    val now = rememberTicker(true, 250)
    Pulsing(timer.pending) { a ->
        TCard(
            Modifier.widthIn(max = 896.dp).fillMaxWidth().alpha(a),
            border = T.c.primary,
            background = T.c.primary.copy(alpha = 0.05f),
        ) {
            Text(if (timer.pending) "Syncing..." else "Currently tracking", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = T.c.primary)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(task?.name ?: "…", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                task?.taskGroup?.let {
                    Spacer(Modifier.width(8.dp)); GroupPill(it.name, hexColor(it.accent))
                }
            }
            Spacer(Modifier.height(12.dp))
            androidx.compose.foundation.layout.FlowRow(
                Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalArrangement = Arrangement.spacedBy(8.dp),
                itemVerticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    Format.duration(maxOf(0L, now - r.startTime)),
                    style = MonoDigits, fontSize = 36.sp, fontWeight = FontWeight.Bold, color = T.c.foreground,
                    modifier = Modifier
                        .clip(RoundedCornerShape(8.dp))
                        .clickable(onClickLabel = "Fix this session", role = Role.Button, onClick = onClock)
                        .semantics { contentDescription = "Elapsed ${Format.durationWords(now - r.startTime, true)}. Tap to fix this session" }
                        .padding(horizontal = 4.dp),
                )
                TButton("Stop", onStop, variant = BtnVariant.Destructive, icon = Icons.Outlined.Stop)
            }
        }
    }
}

@Composable
private fun TaskCard(task: Task, timer: TimerUi, modifier: Modifier, onStart: () -> Unit, onStop: () -> Unit, onLog: () -> Unit, onOpen: () -> Unit) {
    val isActive = timer.running?.taskId == task.id
    val savingThis = task.id in timer.savingTaskIds
    val pending = (isActive && timer.pending) || savingThis
    val now = rememberTicker(isActive)
    val live = if (isActive) maxOf(0L, now - timer.running!!.startTime) else 0L
    val total = task.events.sumOf { maxOf(0L, it.toMs - it.fromMs) } + live
    Pulsing(pending) { a ->
        val ringColor = if (pending) T.c.yellowRing else T.c.primary
        Box(
            modifier
                .alpha(a)
                .then(if (isActive || savingThis) Modifier.border(2.dp, ringColor, RoundedCornerShape(15.dp)).padding(3.dp) else Modifier.padding(3.dp))
        ) {
            TCard(Modifier.fillMaxWidth().fillMaxHeight(), padding = PaddingValues(14.dp), onClick = onOpen) {
                Row(verticalAlignment = Alignment.Top) {
                    Text(task.name, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = T.c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                }
                task.taskGroup?.let {
                    Spacer(Modifier.height(4.dp))
                    GroupPill(it.name, hexColor(it.accent), Modifier.widthIn(max = 176.dp))
                }
                Spacer(Modifier.height(8.dp))
                Text(if (savingThis && !isActive) "Saving..." else "Total: ${Format.durationWords(total)}", fontSize = 13.sp, color = T.c.mutedForeground, maxLines = 1)
                Spacer(Modifier.height(12.dp).weight(1f))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (isActive) {
                        TButton(
                            if (pending) "Syncing..." else "Stop", onStop,
                            Modifier.weight(1f), variant = BtnVariant.Destructive, size = BtnSize.Sm, icon = Icons.Outlined.Stop,
                        )
                    } else {
                        TButton("Start", onStart, Modifier.weight(1f), size = BtnSize.Sm, icon = Icons.Outlined.PlayArrow, contentDescription = "Start ${task.name}")
                    }
                    TButton(null, onLog, variant = BtnVariant.Outline, size = BtnSize.Sm, icon = Icons.Outlined.Add, contentDescription = "Add past time to ${task.name}", modifier = Modifier.width(40.dp))
                }
            }
        }
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
        "Create New Task", onDismiss,
        footer = {
            TButton("Cancel", onDismiss, variant = BtnVariant.Outline)
            TButton(if (creating) "Creating..." else "Create Task", { create() }, enabled = name.isNotBlank() && !creating)
        },
    ) {
        TInput(name, { name = it.take(100) }, placeholder = "Enter task name...", onIme = { create() })
        error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = T.c.destructive, fontSize = 14.sp) }
    }
}

@Suppress("unused")
private val unusedShape = CardShape
