package co.bitterlemon.trackify.ui.task

import androidx.compose.material.icons.filled.PlayArrow
import androidx.compose.material.icons.filled.Stop
import androidx.compose.material.icons.outlined.History
import androidx.compose.foundation.background
import androidx.compose.ui.draw.clip
import co.bitterlemon.trackify.ui.components.Section
import co.bitterlemon.trackify.ui.components.SectionDivider
import co.bitterlemon.trackify.ui.components.SectionFooter
import co.bitterlemon.trackify.ui.components.TDialog
import co.bitterlemon.trackify.ui.components.TInput
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.MonetizationOn
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.key.Key
import androidx.compose.ui.input.key.key
import androidx.compose.ui.input.key.onKeyEvent
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.Event
import co.bitterlemon.trackify.data.Task
import co.bitterlemon.trackify.ui.auth.friendlyError
import co.bitterlemon.trackify.ui.billing.BillingRateControls
import co.bitterlemon.trackify.ui.billing.BillingStatsRow
import co.bitterlemon.trackify.ui.billing.BillingStatusBadge
import co.bitterlemon.trackify.ui.billing.GroupOrUngroupedBadge
import co.bitterlemon.trackify.ui.components.AccentBadge
import co.bitterlemon.trackify.ui.components.BadgeVariant
import co.bitterlemon.trackify.ui.components.BtnSize
import co.bitterlemon.trackify.ui.components.BtnVariant
import co.bitterlemon.trackify.ui.components.ConfirmDialog
import co.bitterlemon.trackify.ui.components.ListRow
import co.bitterlemon.trackify.ui.components.RowDivider
import co.bitterlemon.trackify.ui.components.ScreenBar
import co.bitterlemon.trackify.ui.components.SectionLabel
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.heightIn
import co.bitterlemon.trackify.ui.components.ControlShape
import co.bitterlemon.trackify.ui.components.DateField
import co.bitterlemon.trackify.ui.components.EmptyState
import co.bitterlemon.trackify.ui.components.Skeleton
import co.bitterlemon.trackify.ui.components.TBadge
import co.bitterlemon.trackify.ui.components.TButton
import co.bitterlemon.trackify.ui.components.TCard
import co.bitterlemon.trackify.ui.components.TDialog
import co.bitterlemon.trackify.ui.components.TInput
import co.bitterlemon.trackify.ui.components.TimeField
import co.bitterlemon.trackify.ui.home.LogPastDialog
import co.bitterlemon.trackify.ui.theme.MonoDigits
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.ui.theme.Tabular
import co.bitterlemon.trackify.ui.theme.hexColor
import co.bitterlemon.trackify.util.Format
import co.bitterlemon.trackify.util.Time
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime

private data class DayGroup(val date: LocalDate, val events: List<Event>, val totalMs: Long)

@Composable
fun TaskDetailScreen(id: String, onBack: () -> Unit, onOpenBilling: () -> Unit = {}) {
    val graph = AppGraph.get(LocalContext.current)
    val tasks by graph.repo.tasks.collectAsState()
    val timer by graph.engine.ui.collectAsState()
    val billingTasks by graph.repo.billingTasks.collectAsState()
    val scope = rememberCoroutineScope()
    val task = tasks?.firstOrNull { it.id == id }
    var showAll by remember { mutableStateOf(false) }
    var confirmHide by remember { mutableStateOf(false) }
    var hiding by remember { mutableStateOf(false) }
    var editing by remember { mutableStateOf<Event?>(null) }
    var logOpen by remember { mutableStateOf(false) }
    var billingError by remember { mutableStateOf(false) }
    var renameOpen by remember { mutableStateOf(false) }

    LaunchedEffect(id) { billingError = graph.repo.refreshBillingTasks().isFailure && graph.repo.billingTasks.value == null }

    Column(Modifier.fillMaxSize()) {
    // iOS layout: the task name as the centred title, Rename on the right, then grouped sections.
    ScreenBar(task?.name, onBack = onBack) {
        if (task != null) TButton("Rename", { renameOpen = true }, variant = BtnVariant.Ghost)
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(bottom = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        if (tasks == null) {
            item { Skeleton(Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(20.dp).height(200.dp)) }
            return@LazyColumn
        }
        if (task == null) {
            item { EmptyState("Task not found", Modifier.widthIn(max = 720.dp)) }
            return@LazyColumn
        }
        item(key = "head") {
            val running = timer.running?.taskId == task.id
            val now = co.bitterlemon.trackify.ui.team.rememberTicker(running)
            val live = if (running) maxOf(0L, now - timer.running!!.startTime) else 0L
            Column(Modifier.widthIn(max = 720.dp).fillMaxWidth()) {
                Section(topGap = 8.dp) {
                    ListRow("Group", trailing = {
                        val g = task.taskGroup
                        if (g != null) co.bitterlemon.trackify.ui.components.AccentBadge(g.name, hexColor(g.accent))
                        else Text("Ungrouped", fontSize = 17.sp, color = T.c.mutedForeground)
                    })
                    SectionDivider()
                    ListRow("Total time", value = Format.durationWords(task.events.sumOf { it.toMs - it.fromMs } + live))
                    SectionDivider()
                    ListRow("Sessions", value = "${task.events.size}")
                }
                Section {
                    if (running) ListRow("Stop", icon = Icons.Filled.Stop, destructive = true, onClick = { graph.engine.stop() })
                    else ListRow("Start", icon = Icons.Filled.PlayArrow, onClick = { graph.engine.start(task.id) })
                    SectionDivider(icon = true)
                    ListRow("Log past time", icon = Icons.Outlined.History, onClick = { logOpen = true })
                }
            }
        }
        if (task.events.isNotEmpty()) {
            val groups = groupByDay(task.events)
            val shown = if (showAll) groups else groups.take(5)
            items(shown, key = { it.date.toEpochDay() }) { g ->
                DayCard(g) { editing = it }
            }
            if (groups.size > 5) {
                item {
                    Section(Modifier.widthIn(max = 720.dp)) {
                        ListRow(if (showAll) "Show fewer days" else "Show ${groups.size - 5} more days", onClick = { showAll = !showAll }, chevron = !showAll)
                    }
                }
            }
            item { SectionFooter("Tap an entry to edit or delete it.", Modifier.widthIn(max = 720.dp)) }
        }
        item(key = "billing-h") { SectionLabel("Billing", Modifier.widthIn(max = 720.dp)) }
        item(key = "billing") {
            Box(Modifier.widthIn(max = 720.dp).padding(horizontal = 16.dp).clip(co.bitterlemon.trackify.ui.components.CardShape).background(T.c.cell).padding(16.dp)) {
                BillingPanel(task, billingTasks, billingError, onOpenBilling)
            }
        }
        item(key = "hide") {
            Section(Modifier.widthIn(max = 720.dp), footer = "Restore it any time from More → Hidden tasks.") {
                ListRow(if (hiding) "Hiding…" else "Hide task", icon = Icons.Outlined.VisibilityOff, destructive = true, onClick = { if (!hiding) confirmHide = true })
            }
        }
    }
    }

    if (renameOpen && task != null) RenameDialog(task) { renameOpen = false }
    if (confirmHide && task != null) {
        ConfirmDialog(
            "Hide task?", "Hide this task? You can restore it from More → Hidden tasks.", "Hide",
            onConfirm = {
                hiding = true
                scope.launch {
                    try {
                        if (timer.running?.taskId == task.id) graph.engine.stop()
                        graph.repo.hideTask(task.id); onBack()
                    } catch (_: Exception) {
                    }
                    hiding = false
                }
            },
            onDismiss = { confirmHide = false },
        )
    }
    editing?.let { e -> if (task != null) EditEntryDialog(task, e) { editing = null } }
    if (logOpen && task != null) {
        LogPastDialog(task, tasks ?: emptyList(), timer.running?.startTime, timer.running?.taskId) { logOpen = false }
    }
}

private fun groupByDay(events: List<Event>): List<DayGroup> =
    events.sortedByDescending { it.fromMs }
        .groupBy { Time.localDate(it.fromMs) }
        .map { (d, l) -> DayGroup(d, l, l.sumOf { it.toMs - it.fromMs }) }

@Composable
private fun EntriesHeader(count: Int) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Outlined.CalendarToday, null, tint = T.c.mutedForeground, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
        Text("Time Entries", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground, modifier = Modifier.weight(1f))
        TBadge("$count sessions")
    }
    Text("Tap an entry to edit or delete it.", fontSize = 12.sp, color = T.c.mutedForeground, modifier = Modifier.padding(top = 4.dp))
}

@Composable
private fun DayCard(g: DayGroup, onEdit: (Event) -> Unit) {
    val today = Time.today()
    val label = when (g.date) {
        today -> "Today"
        today.minusDays(1) -> "Yesterday"
        else -> Time.format(g.date, "EEEE, d MMMM yyyy")
    }
    Section(Modifier.widthIn(max = 720.dp), header = label, headerTrailing = Format.durationWords(g.totalMs)) {
        g.events.forEachIndexed { i, e ->
            if (i > 0) SectionDivider()
            ListRow(
                "${Time.clock(e.fromMs)} → ${Time.clock(e.toMs)}",
                value = Format.durationWords(e.toMs - e.fromMs),
                onClick = { onEdit(e) },
                trailing = if (e.paymentRecordId != null) ({ TBadge("Paid", variant = BadgeVariant.Secondary) }) else null,
            )
        }
    }
}

/** Rename the task (the Rename button in the top bar). */
@Composable
private fun RenameDialog(task: Task, onDismiss: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    var value by remember(task.name) { mutableStateOf(task.name) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    fun save() {
        val v = value.trim()
        if (v.isEmpty() || busy) return
        if (v == task.name) { onDismiss(); return }
        busy = true
        scope.launch {
            try {
                graph.repo.renameTask(task.id, v); onDismiss()
            } catch (e: Exception) {
                error = friendlyError(e, "Rename failed")
            }
            busy = false
        }
    }
    TDialog(
        "Rename task", onDismiss,
        footer = {
            TButton("Cancel", onDismiss, variant = BtnVariant.Outline)
            TButton(if (busy) "Saving…" else "Save", { save() }, enabled = value.isNotBlank() && !busy)
        },
    ) {
        TInput(value, { value = it.take(100) }, placeholder = "Task name", onIme = { save() }, autoFocus = true)
        error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = T.c.destructive, fontSize = 14.sp) }
    }
}

@Composable
private fun BillingPanel(task: Task, billingTasks: List<co.bitterlemon.trackify.data.BillingTask>?, error: Boolean, onOpenBilling: () -> Unit) {
    val accent = hexColor(task.accent)
    if (billingTasks == null) {
        if (error) TCard(Modifier.widthIn(max = 896.dp).fillMaxWidth()) { Text("Could not load billing settings for this task.", color = T.c.destructive, fontSize = 14.sp) }
        else Skeleton(Modifier.widthIn(max = 896.dp).fillMaxWidth().height(160.dp))
        return
    }
    val billing = billingTasks.firstOrNull { it.taskId == task.id }
    Column(Modifier.fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Row(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GroupOrUngroupedBadge(task); BillingStatusBadge(billing != null)
            }
            TButton("Open Billing", onOpenBilling, variant = BtnVariant.Ghost, size = BtnSize.Sm, icon = Icons.AutoMirrored.Outlined.OpenInNew)
        }
        Spacer(Modifier.height(12.dp))
        BillingStatsRow(task, billing)
        Spacer(Modifier.height(12.dp))
        BillingRateControls(task, billing) {}
        Text("Same settings as Billing → Rates. Changes apply to unpaid sessions.", fontSize = 13.sp, color = T.c.mutedForeground, modifier = Modifier.padding(top = 8.dp))
    }
    @Suppress("UNUSED_VARIABLE") val unusedAccent = accent
}

/** Native extra: edit or delete a time entry (PUT / DELETE /api/events/:id). */
@Composable
private fun EditEntryDialog(task: Task, event: Event, onDismiss: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    val from0 = Time.localDateTime(event.fromMs)
    val to0 = Time.localDateTime(event.toMs)
    var fromDate by remember { mutableStateOf(from0.toLocalDate()) }
    var fromTime by remember { mutableStateOf(from0.toLocalTime().withSecond(0).withNano(0)) }
    var toDate by remember { mutableStateOf(to0.toLocalDate()) }
    var toTime by remember { mutableStateOf(to0.toLocalTime().withSecond(0).withNano(0)) }
    var name by remember { mutableStateOf(event.name) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }

    fun ms(d: LocalDate, t: LocalTime): Long = LocalDateTime.of(d, t).atZone(Time.zone()).toInstant().toEpochMilli()
    // Keep original seconds when the minute didn't change so an untouched field stays exact.
    val fromMs = if (fromDate == from0.toLocalDate() && fromTime == from0.toLocalTime().withSecond(0).withNano(0)) event.fromMs else ms(fromDate, fromTime)
    val toMs = if (toDate == to0.toLocalDate() && toTime == to0.toLocalTime().withSecond(0).withNano(0)) event.toMs else ms(toDate, toTime)
    val duration = toMs - fromMs

    TDialog(
        "Edit time entry", onDismiss, description = task.name,
        footer = {
            TButton("Delete", { confirmDelete = true }, variant = BtnVariant.DestructiveGhost, enabled = !busy)
            Spacer(Modifier.weight(1f))
            TButton("Cancel", onDismiss, variant = BtnVariant.Outline, enabled = !busy)
            TButton(if (busy) "Saving…" else "Save", {
                when {
                    duration <= 0 -> error = "End time must be after start time"
                    toMs > System.currentTimeMillis() + 60_000 -> error = "The entry can't end in the future"
                    else -> {
                        busy = true; error = null
                        scope.launch {
                            try {
                                graph.api.updateEvent(event.id, fromMs, toMs, name.trim().ifEmpty { "Time entry" })
                                graph.repo.requestRefresh(0); onDismiss()
                            } catch (e: Exception) {
                                error = friendlyError(e, "Couldn't save the entry")
                            }
                            busy = false
                        }
                    }
                }
            }, enabled = !busy)
        },
    ) {
        Text(if (duration > 0) Format.durationWords(duration) else "—", style = MonoDigits, fontSize = 32.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, modifier = Modifier.fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        if (event.paymentRecordId != null) {
            Spacer(Modifier.height(8.dp))
            Text("This entry is already marked as paid; the payment total won't change.", fontSize = 12.sp, color = T.c.amber)
        }
        Spacer(Modifier.height(16.dp))
        Text("Starts", fontSize = 14.sp, color = T.c.mutedForeground)
        Spacer(Modifier.height(4.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            DateField(fromDate, { fromDate = it }, Modifier.weight(1.3f))
            TimeField(fromTime, { fromTime = it }, Modifier.weight(1f))
        }
        Spacer(Modifier.height(12.dp))
        Text("Ends", fontSize = 14.sp, color = T.c.mutedForeground)
        Spacer(Modifier.height(4.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            DateField(toDate, { toDate = it }, Modifier.weight(1.3f))
            TimeField(toTime, { toTime = it }, Modifier.weight(1f))
        }
        Spacer(Modifier.height(12.dp))
        TInput(name, { name = it.take(200) }, label = "Name", placeholder = "Time entry")
        error?.let { Spacer(Modifier.height(10.dp)); Text(it, color = T.c.destructive, fontSize = 14.sp) }
    }
    if (confirmDelete) {
        ConfirmDialog(
            "Delete time entry?", "This removes ${Format.durationWords(event.toMs - event.fromMs)} from ${task.name}. This can't be undone.", "Delete",
            onConfirm = {
                busy = true
                scope.launch {
                    try {
                        graph.api.deleteEvent(event.id)
                        graph.repo.optimisticRemoveEvent(event.id)
                        graph.repo.requestRefresh(0); onDismiss()
                    } catch (e: Exception) {
                        error = friendlyError(e, "Couldn't delete the entry")
                    }
                    busy = false
                }
            },
            onDismiss = { confirmDelete = false },
        )
    }
}
