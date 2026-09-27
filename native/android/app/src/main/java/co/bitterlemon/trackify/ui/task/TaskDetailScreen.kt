package co.bitterlemon.trackify.ui.task

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

    LaunchedEffect(id) { billingError = graph.repo.refreshBillingTasks().isFailure && graph.repo.billingTasks.value == null }

    Column(Modifier.fillMaxSize()) {
    ScreenBar(null, onBack = onBack)
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
            Column(Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(horizontal = 20.dp)) {
                EditableName(task)
                task.taskGroup?.let {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 4.dp)) {
                        co.bitterlemon.trackify.ui.components.AccentDot(hexColor(it.accent), 8.dp)
                        Spacer(Modifier.width(8.dp))
                        Text(it.name, fontSize = 14.sp, color = T.c.mutedForeground)
                    }
                }
                Row(Modifier.fillMaxWidth().padding(top = 20.dp)) {
                    Column(Modifier.weight(1f)) {
                        Text("Total", fontSize = 13.sp, color = T.c.mutedForeground)
                        Text(Format.durationWords(task.events.sumOf { it.toMs - it.fromMs } + live), fontSize = 26.sp, fontWeight = FontWeight.Bold, color = T.c.foreground, style = Tabular)
                    }
                    Column(Modifier.weight(1f)) {
                        Text("Sessions", fontSize = 13.sp, color = T.c.mutedForeground)
                        Text("${task.events.size}", fontSize = 26.sp, fontWeight = FontWeight.Bold, color = T.c.foreground, style = Tabular)
                    }
                }
                Row(Modifier.fillMaxWidth().padding(top = 20.dp, bottom = 8.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (running) TButton("Stop", { graph.engine.stop() }, Modifier.weight(1f), variant = BtnVariant.Destructive, size = BtnSize.Lg, icon = Icons.Outlined.Stop)
                    else TButton("Start", { graph.engine.start(task.id) }, Modifier.weight(1f), size = BtnSize.Lg, icon = Icons.Outlined.PlayArrow)
                    TButton("Log past time", { logOpen = true }, Modifier.weight(1f), variant = BtnVariant.Outline, size = BtnSize.Lg, icon = Icons.Outlined.Add)
                }
            }
        }
        if (task.events.isNotEmpty()) {
            item(key = "entries-h") { SectionLabel("Time entries · tap one to edit", Modifier.widthIn(max = 720.dp)) }
            val groups = groupByDay(task.events)
            val shown = if (showAll) groups else groups.take(5)
            items(shown, key = { it.date.toEpochDay() }) { g ->
                DayCard(g) { editing = it }
            }
            if (groups.size > 5) {
                item {
                    TButton(if (showAll) "Show fewer days" else "Show ${groups.size - 5} more days", { showAll = !showAll }, variant = BtnVariant.Ghost, modifier = Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(horizontal = 12.dp))
                }
            }
        }
        item(key = "billing-h") { SectionLabel("Billing", Modifier.widthIn(max = 720.dp)) }
        item(key = "billing") {
            Box(Modifier.widthIn(max = 720.dp).padding(horizontal = 20.dp)) { BillingPanel(task, billingTasks, billingError, onOpenBilling) }
        }
        item(key = "hide") {
            Column(Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(top = 16.dp)) {
                RowDivider()
                ListRow(if (hiding) "Hiding…" else "Hide task", subtitle = "Restore it any time from More → Hidden tasks", icon = Icons.Outlined.VisibilityOff, destructive = true, onClick = { if (!hiding) confirmHide = true })
                RowDivider()
            }
        }
    }
    }

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
        else -> Time.format(g.date, "EEE d MMM yyyy")
    }
    Column(Modifier.widthIn(max = 720.dp).fillMaxWidth()) {
        Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(start = 20.dp, end = 20.dp, top = 12.dp, bottom = 4.dp)) {
            Text(label, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, modifier = Modifier.weight(1f))
            Text(Format.durationWords(g.totalMs), fontSize = 14.sp, color = T.c.mutedForeground, style = Tabular)
        }
        g.events.forEach { e ->
            Row(
                Modifier.fillMaxWidth().heightIn(min = 52.dp)
                    .clickable(onClickLabel = "Edit entry") { onEdit(e) }
                    .padding(horizontal = 20.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("${Time.clock(e.fromMs)} – ${Time.clock(e.toMs)}", fontSize = 16.sp, color = T.c.foreground, style = Tabular, modifier = Modifier.weight(1f))
                if (e.paymentRecordId != null) {
                    TBadge("Paid", variant = BadgeVariant.Secondary); Spacer(Modifier.width(8.dp))
                }
                Text(Format.durationWords(e.toMs - e.fromMs), fontSize = 15.sp, color = T.c.mutedForeground, style = Tabular)
            }
        }
        RowDivider(Modifier.padding(top = 4.dp), inset = 20.dp)
    }
}

@Composable
private fun EditableName(task: Task) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf(false) }
    var value by remember(task.name) { mutableStateOf(task.name) }
    var error by remember { mutableStateOf<String?>(null) }
    val focus = remember { FocusRequester() }
    fun save() {
        if (!editing) return
        editing = false
        val v = value.trim()
        if (v.isEmpty() || v == task.name) {
            value = task.name; return
        }
        scope.launch {
            try {
                graph.repo.renameTask(task.id, v); error = null
            } catch (e: Exception) {
                error = friendlyError(e, "Rename failed"); value = task.name
            }
        }
    }
    if (editing) {
        LaunchedEffect(Unit) { focus.requestFocus() }
        BasicTextField(
            value, { value = it.take(100) },
            textStyle = TextStyle(fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground),
            singleLine = true,
            cursorBrush = SolidColor(T.c.foreground),
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(onDone = { save() }),
            modifier = Modifier.fillMaxWidth().focusRequester(focus)
                .onFocusChanged { if (!it.isFocused && editing) save() }
                .onKeyEvent { if (it.key == Key.Escape) { editing = false; value = task.name; true } else false }
                .border(1.dp, T.c.foreground.copy(alpha = 0.3f), ControlShape).padding(horizontal = 10.dp, vertical = 8.dp),
        )
    } else {
        Row(Modifier.clickable(onClickLabel = "Rename task") { editing = true }, verticalAlignment = Alignment.CenterVertically) {
            Text(task.name, fontSize = 24.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, modifier = Modifier.weight(1f, fill = false))
            Spacer(Modifier.width(6.dp))
            Icon(Icons.Outlined.Edit, null, tint = T.c.mutedForeground, modifier = Modifier.size(15.dp))
        }
    }
    error?.let { Text(it, color = T.c.destructive, fontSize = 13.sp) }
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
        Text("Same settings as Billing → Rates. Changes apply to unpaid sessions.", fontSize = 12.sp, color = T.c.mutedForeground, modifier = Modifier.padding(top = 8.dp))
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
