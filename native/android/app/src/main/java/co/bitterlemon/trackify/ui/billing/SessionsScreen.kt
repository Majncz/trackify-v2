package co.bitterlemon.trackify.ui.billing

import androidx.compose.foundation.lazy.itemsIndexed
import co.bitterlemon.trackify.ui.components.GroupedItem
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material.icons.outlined.CheckCircle
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.Deselect
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.outlined.SelectAll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TriStateCheckbox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.BillingSession
import co.bitterlemon.trackify.ui.auth.friendlyError
import co.bitterlemon.trackify.ui.components.AccentDot
import co.bitterlemon.trackify.ui.components.CappedFontScale
import co.bitterlemon.trackify.ui.components.RowDivider
import co.bitterlemon.trackify.ui.components.ScreenBar
import co.bitterlemon.trackify.ui.components.Skeleton
import co.bitterlemon.trackify.ui.components.YearlyCalendar
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.ui.theme.Tabular
import co.bitterlemon.trackify.ui.theme.hexColor
import co.bitterlemon.trackify.util.ChartData
import co.bitterlemon.trackify.util.Format
import co.bitterlemon.trackify.util.Time
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalDateTime
import kotlin.math.abs

private val statusOptions = listOf("unpaid" to "Unpaid", "all" to "All statuses", "paid" to "Paid")
private val groupByOptions = listOf("day" to "By day", "week" to "By week", "month" to "By month")

private fun BillingSession.selectionRow() = Triple(durationMinutes, currency, earnings)

/** Billing → Sessions: filter chips, sticky day/week/month sections, multi-select, Mark as paid. */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SessionsScreen(onBack: () -> Unit, onOpenRates: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val billingTasks by graph.repo.billingTasks.collectAsState()
    val dataVersion by graph.repo.dataVersion.collectAsState()

    var periodName by rememberSaveable { mutableStateOf(BillingPeriod.ThisMonth.name) }
    val period = BillingPeriod.valueOf(periodName)
    var customFrom by rememberSaveable { mutableStateOf(Time.today().toString()) }
    var customTo by rememberSaveable { mutableStateOf(Time.today().toString()) }
    var groupId by rememberSaveable { mutableStateOf("all") }
    var taskId by rememberSaveable { mutableStateOf("all") }
    var status by rememberSaveable { mutableStateOf("unpaid") }
    var groupBy by rememberSaveable { mutableStateOf("day") }
    var sessions by remember { mutableStateOf<List<BillingSession>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var reload by remember { mutableStateOf(0) }
    val selected = remember { mutableStateListOf<String>() }
    val collapsed = remember { mutableStateMapOf<String, Boolean>() }
    var sheet by remember { mutableStateOf<String?>(null) }
    var markOpen by remember { mutableStateOf(false) }

    val cf = LocalDate.parse(customFrom)
    val ct = LocalDate.parse(customTo)
    val (from, to) = billingRange(period, cf, ct)

    LaunchedEffect(Unit) { graph.repo.refreshBillingTasks() }
    LaunchedEffect(from, to, groupId, taskId, status, reload, dataVersion) {
        runCatching { graph.api.billingSessions(from, to, status, groupId.takeIf { it != "all" }, taskId.takeIf { it != "all" }) }
            .onSuccess { r ->
                sessions = r.sessions; error = null
                val open = r.sessions.filter { !it.isPaid }.map { it.id }.toSet()
                selected.retainAll(open)
            }
            .onFailure { error = friendlyError(it, "Couldn't load sessions") }
    }

    val bts = billingTasks ?: emptyList()
    val groups = bts.mapNotNull { it.task?.taskGroup }.distinctBy { it.id }.sortedBy { it.name.lowercase() }
    val hasUngrouped = bts.any { it.task?.taskGroup == null }
    val groupOptions = listOf("all" to "All groups") + (if (hasUngrouped) listOf("ungrouped" to "Ungrouped") else emptyList()) + groups.map { it.id to it.name }
    val enrolledInGroup = bts.filter {
        when (groupId) {
            "all" -> true
            "ungrouped" -> it.task?.taskGroup == null
            else -> it.task?.taskGroup?.id == groupId
        }
    }
    val taskOptions = listOf("all" to "All tasks") + enrolledInGroup.map { it.taskId to (it.task?.name ?: "Task") }
    LaunchedEffect(groupId, billingTasks) { if (taskId != "all" && enrolledInGroup.none { it.taskId == taskId }) taskId = "all" }

    val list = sessions.orEmpty()
    val unpaid = list.filter { !it.isPaid }
    val sel = BillingLedger.selection(list.filter { it.id in selected && !it.isPaid }.map { it.selectionRow() })
    val selecting = selected.isNotEmpty()
    val allSelected = unpaid.isNotEmpty() && unpaid.all { it.id in selected }
    BackHandler(selecting) { selected.clear() }

    fun toggle(id: String) { if (id in selected) selected.remove(id) else selected.add(id) }

    Column(Modifier.fillMaxSize()) {
        if (selecting) {
            CappedFontScale {
                Row(Modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton({ selected.clear() }) { Icon(Icons.Outlined.Close, "Clear selection", tint = T.c.foreground) }
                    Spacer(Modifier.width(4.dp))
                    Text("${sel.count} selected", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, modifier = Modifier.weight(1f), maxLines = 1)
                    IconButton({
                        if (allSelected) selected.clear() else { selected.clear(); selected.addAll(unpaid.map { it.id }) }
                    }) {
                        Icon(if (allSelected) Icons.Outlined.Deselect else Icons.Outlined.SelectAll, if (allSelected) "Clear all" else "Select all unpaid (${unpaid.size})", tint = T.c.foreground)
                    }
                }
            }
        } else {
            ScreenBar("Sessions", onBack = onBack) {
                if (unpaid.isNotEmpty() && status != "paid") IconButton({ selected.addAll(unpaid.map { it.id }) }) {
                    Icon(Icons.Outlined.SelectAll, "Select all unpaid (${unpaid.size})", tint = T.c.foreground)
                }
                IconButton({ sheet = "calendar" }) { Icon(Icons.Outlined.CalendarMonth, "Activity calendar", tint = T.c.foreground) }
            }
        }

        val noEnrolled = billingTasks != null && bts.isEmpty()
        if (!noEnrolled) {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Row(Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth().horizontalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 4.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DropChip(if (period == BillingPeriod.Custom) customLabel(cf, ct) else period.label, period != BillingPeriod.ThisMonth) { sheet = "period" }
                DropChip(statusOptions.first { it.first == status }.second, status != "unpaid") { sheet = "status" }
                DropChip(groupOptions.firstOrNull { it.first == groupId }?.second ?: "All groups", groupId != "all") { sheet = "group" }
                DropChip(taskOptions.firstOrNull { it.first == taskId }?.second ?: "All tasks", taskId != "all") { sheet = "task" }
                DropChip(groupByOptions.first { it.first == groupBy }.second, groupBy != "day") { sheet = "groupBy" }
            }
            }
        }

        Box(Modifier.weight(1f).fillMaxWidth()) {
            LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                when {
                    noEnrolled -> item {
                        StateMessage("No billable tasks yet. Give a task an hourly rate and its time shows up here.") {
                            Button(onOpenRates, colors = primaryButton()) { Text("Set up rates") }
                        }
                    }
                    sessions == null && error != null -> item { StateMessage(error ?: "", T.c.destructive) }
                    sessions == null -> items(6) {
                        Column(Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp)) {
                            Skeleton(Modifier.width(180.dp).height(16.dp)); Spacer(Modifier.height(6.dp)); Skeleton(Modifier.width(240.dp).height(12.dp))
                        }
                    }
                    list.isEmpty() -> item { StateMessage("No sessions in this range. Try another filter or enroll a task.") }
                    else -> {
                        item(key = "hint") {
                            Text(
                                when {
                                    status == "paid" -> "Paid-only view — selection disabled."
                                    unpaid.isEmpty() -> "${list.size} session${if (list.size == 1) "" else "s"}, all paid."
                                    else -> "${unpaid.size} unpaid · " + unpaid.groupBy { it.currency }.entries.sortedBy { it.key }
                                        .joinToString(" · ") { (c, l) -> Format.money(l.sumOf { it.earnings }, c) } + ". Tap rows to select."
                                },
                                fontSize = 14.sp, color = T.c.mutedForeground, style = Tabular,
                                modifier = Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth().padding(horizontal = 32.dp, vertical = 8.dp),
                            )
                        }
                        val sections = list.groupBy { BillingLedger.key(it.groupDay, it.groupWeek, it.groupMonth, groupBy) }
                        sections.forEach { (key, rows) ->
                            stickyHeader(key = "h-$groupBy-$key") {
                                SectionHeader(
                                    BillingLedger.label(key, groupBy), rows, selected, collapsed[key] == true,
                                    onToggleCollapse = { collapsed[key] = collapsed[key] != true },
                                    selectable = status != "paid",
                                )
                            }
                            if (collapsed[key] != true) itemsIndexed(rows, key = { _, it -> "r-" + it.id }) { i, row ->
                                GroupedItem(i == 0, i == rows.lastIndex, Modifier.widthIn(max = BillingMaxWidth), dividerInset = 60.dp) {
                                    SessionRow(row, row.id in selected, showDate = groupBy != "day", showUnpaid = status != "unpaid") { toggle(row.id) }
                                }
                            }
                        }
                    }
                }
            }
        }

        if (selecting) {
            HorizontalDivider(thickness = 0.8.dp, color = T.c.separator)
            Column(Modifier.fillMaxWidth().background(T.c.cell).padding(horizontal = 16.dp, vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                if (sel.multiCurrency) Text("Multiple currencies — narrow the selection to one currency.", fontSize = 14.sp, color = T.c.destructive, modifier = Modifier.padding(bottom = 8.dp))
                Button(
                    { markOpen = true }, Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth().heightIn(min = 52.dp), enabled = sel.ready, colors = primaryButton(),
                ) {
                    Text(
                        "Mark as paid (${sel.count} · " + sel.byCurrency.entries.joinToString(" + ") { (c, a) -> Format.money(a, c) } + ")",
                        fontSize = 16.sp, style = Tabular, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    )
                }
            }
        }
    }

    when (sheet) {
        "period" -> ChoiceSheet("Period", BillingPeriod.entries.map { it to it.label }, period, { p ->
            periodName = p.name
            if (p != BillingPeriod.Custom) sheet = null
        }, { sheet = null }) {
            if (period == BillingPeriod.Custom) {
                Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    BDateField(cf, { customFrom = it.toString(); if (it > ct) customTo = it.toString() }, "From")
                    BDateField(ct, { customTo = it.toString() }, "To", minDate = cf)
                }
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.End) {
                    TextButton({ sheet = null }) { Text("Done") }
                }
            }
        }
        "status" -> ChoiceSheet("Status", statusOptions, status, { status = it; sheet = null }, { sheet = null })
        "group" -> ChoiceSheet("Group", groupOptions, groupId, { groupId = it; taskId = "all"; sheet = null }, { sheet = null })
        "task" -> ChoiceSheet("Task", taskOptions, taskId, { taskId = it; sheet = null }, { sheet = null })
        "groupBy" -> ChoiceSheet("Group list by", groupByOptions, groupBy, { groupBy = it; sheet = null }, { sheet = null })
        "calendar" -> FormSheet("Activity", { sheet = null }) {
            Text("Billed time per day for the current filters. Tap a day to show just that day.", fontSize = 14.sp, color = T.c.mutedForeground)
            Spacer(Modifier.height(12.dp))
            val endDay = if (period == BillingPeriod.AllTime || to == null) null else Time.localDate(to)
            val data = remember(list, endDay) { ChartData.buildYearlyFromBilling(list, endDay) }
            val colors = remember(list) { list.associate { it.taskName to it.accent } }
            YearlyCalendar(data, colors, rememberScrollState(Int.MAX_VALUE), onDayAction = { day ->
                periodName = BillingPeriod.Custom.name; customFrom = day.toString(); customTo = day.toString(); status = "all"; sheet = null
            })
            Spacer(Modifier.height(16.dp))
        }
    }

    if (markOpen) {
        val rows = list.filter { it.id in selected && !it.isPaid }
        MarkPaidSheet(rows, onDismiss = { markOpen = false }, onSuccess = {
            selected.clear(); reload++; graph.repo.bumpData(); graph.repo.requestRefresh(0)
        })
    }
}

private fun customLabel(from: LocalDate, to: LocalDate): String =
    if (from == to) Time.format(from, "MMM d, yyyy") else "${Time.format(from, "MMM d")} – ${Time.format(to, "MMM d")}"

@Composable
fun primaryButton() = ButtonDefaults.buttonColors(
    containerColor = T.c.primary, contentColor = T.c.onPrimary,
    disabledContainerColor = T.c.muted, disabledContentColor = T.c.mutedForeground,
)

@Composable
private fun SectionHeader(
    label: String,
    rows: List<BillingSession>,
    selected: MutableList<String>,
    collapsed: Boolean,
    onToggleCollapse: () -> Unit,
    selectable: Boolean,
) {
    val mins = rows.sumOf { it.durationMinutes }
    val open = rows.filter { !it.isPaid }
    val money = open.groupBy { it.currency }.entries.sortedBy { it.key }.joinToString(" · ") { (c, l) -> Format.money(l.sumOf { it.earnings }, c) + " unpaid" }
    val ids = open.map { it.id }
    val n = ids.count { it in selected }
    Column(Modifier.fillMaxWidth().background(T.c.background), horizontalAlignment = Alignment.CenterHorizontally) {
        Row(
            Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth().heightIn(min = 56.dp)
                .clickable(onClickLabel = if (collapsed) "Expand" else "Collapse", onClick = onToggleCollapse)
                .padding(start = if (selectable && ids.isNotEmpty()) 20.dp else 32.dp, end = 28.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (selectable && ids.isNotEmpty()) {
                TriStateCheckbox(
                    when (n) { 0 -> ToggleableState.Off; ids.size -> ToggleableState.On; else -> ToggleableState.Indeterminate },
                    {
                        if (n == ids.size) selected.removeAll(ids.toSet()) else selected.addAll(ids.filter { it !in selected })
                    },
                    colors = checkColors(),
                )
                Spacer(Modifier.width(4.dp))
            }
            Column(Modifier.weight(1f).padding(vertical = 6.dp)) {
                Text(label, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = T.c.mutedForeground)
                Text(
                    Format.durationMinutes(mins.toDouble()) + (if (money.isNotEmpty()) " · $money" else ""),
                    fontSize = 15.sp, color = T.c.mutedForeground, style = Tabular,
                )
            }
            Icon(
                if (collapsed) Icons.AutoMirrored.Outlined.KeyboardArrowRight else Icons.Outlined.KeyboardArrowDown,
                null, tint = T.c.mutedForeground, modifier = Modifier.size(22.dp),
            )
        }
    }
}

@Composable
private fun checkColors() = CheckboxDefaults.colors(checkedColor = T.c.foreground, checkmarkColor = T.c.plain, uncheckedColor = T.c.mutedForeground)

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun SessionRow(row: BillingSession, selected: Boolean, showDate: Boolean, showUnpaid: Boolean, onToggle: () -> Unit) {
    val accent = hexColor(row.accent)
    val big = largeFont()
    val time = (if (showDate) Time.format(row.fromMs, "MMM d") + " · " else "") +
        "${Time.clock(row.fromMs)}–${Time.clock(row.toMs)} · ${Format.durationMinutes(row.durationMinutes.toDouble())}"
    Box(Modifier.fillMaxWidth().background(if (selected) T.c.fill else Color.Transparent), contentAlignment = Alignment.Center) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 64.dp)
                .combinedClickable(enabled = !row.isPaid, role = Role.Checkbox, onLongClick = onToggle, onClick = onToggle)
                .padding(start = 4.dp, end = 16.dp, top = 8.dp, bottom = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (row.isPaid) {
                Box(Modifier.size(48.dp), contentAlignment = Alignment.Center) {
                    Icon(Icons.Outlined.CheckCircle, "Paid", tint = T.c.mutedForeground, modifier = Modifier.size(20.dp))
                }
            } else Checkbox(selected, { onToggle() }, colors = checkColors())
            Spacer(Modifier.width(4.dp))
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    AccentDot(accent, 8.dp)
                    Spacer(Modifier.width(8.dp))
                    Text(row.taskName, fontSize = 16.sp, color = T.c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                SupportingParts(listOfNotNull(row.taskGroup?.name) + time.split(" · "))
                if (big) {
                    Text(Format.money(row.earnings, row.currency), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = Tabular)
                    if (row.isPaid || showUnpaid) Text(paidLabel(row), fontSize = 13.sp, color = T.c.mutedForeground)
                }
            }
            if (!big) {
                Spacer(Modifier.width(12.dp))
                Column(horizontalAlignment = Alignment.End) {
                    Text(Format.money(row.earnings, row.currency), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = if (row.isPaid) T.c.mutedForeground else T.c.foreground, style = Tabular, maxLines = 1)
                    if (row.isPaid || showUnpaid) Text(paidLabel(row), fontSize = 13.sp, color = T.c.mutedForeground, maxLines = 1)
                }
            }
        }
    }
}

private fun paidLabel(row: BillingSession): String =
    if (row.isPaid) row.paymentPaidAt?.let { "Paid " + Time.format(Time.parse(it), "MMM d") } ?: "Paid" else "Unpaid"

/** Mark as paid (web `MarkPaidDialog`): full-height sheet, editable per-line amounts, paid date/time, note. */
@Composable
fun MarkPaidSheet(sessions: List<BillingSession>, onDismiss: () -> Unit, onSuccess: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    val now = remember { LocalDateTime.now(Time.zone()) }
    var paidDate by remember { mutableStateOf(now.toLocalDate()) }
    var paidTime by remember { mutableStateOf(now.toLocalTime().withSecond(0).withNano(0)) }
    var note by remember { mutableStateOf("") }
    val amounts = remember { mutableStateMapOf<String, String>().apply { sessions.forEach { put(it.id, amountText(it.earnings)) } } }
    var submitting by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val currency = sessions.firstOrNull()?.currency ?: "CZK"
    val parsed = sessions.map { parseLineAmount(amounts[it.id]) }
    val invalid = parsed.any { it == null }
    val total = Format.round2(parsed.filterNotNull().sum())
    val mins = sessions.sumOf { it.durationMinutes }
    val allMatch = sessions.all { s -> parseLineAmount(amounts[s.id])?.let { abs(it - s.earnings) < 0.005 } == true }
    val big = largeFont()

    FormSheet("Mark as paid", onDismiss, fullHeight = true, footer = {
        error?.let { Text(it, color = T.c.destructive, fontSize = 14.sp, modifier = Modifier.padding(bottom = 8.dp)) }
        Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Total to record", fontSize = 15.sp, color = T.c.mutedForeground, modifier = Modifier.weight(1f))
            Text(Format.money(total, currency), fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = Tabular)
        }
        Button(
            {
                error = null
                if (invalid || sessions.isEmpty()) { error = "Enter a valid amount (0 or more) for every session."; return@Button }
                submitting = true
                scope.launch {
                    try {
                        val paidAt = LocalDateTime.of(paidDate, paidTime).atZone(Time.zone()).toInstant().toEpochMilli()
                        graph.api.createPayment(sessions.map { it.id }, paidAt, note.trim().ifEmpty { null }, sessions.associate { it.id to parseLineAmount(amounts[it.id])!! })
                        onSuccess(); onDismiss()
                    } catch (e: Exception) {
                        error = friendlyError(e, "Failed to record payment")
                    }
                    submitting = false
                }
            },
            Modifier.fillMaxWidth().heightIn(min = 52.dp), enabled = !submitting && sessions.isNotEmpty(), colors = primaryButton(),
        ) { Text(if (submitting) "Saving…" else "Mark as paid", fontSize = 16.sp) }
    }) {
        Text(
            "${sessions.size} session${if (sessions.size != 1) "s" else ""} · ${Format.durationMinutes(mins.toDouble())} · ${Format.money(total, currency)}",
            fontSize = 15.sp, color = T.c.mutedForeground, style = Tabular,
        )
        Row(Modifier.fillMaxWidth().padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Amounts", fontSize = 13.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground, modifier = Modifier.weight(1f))
            TextButton({ error = null; sessions.forEach { amounts[it.id] = amountText(it.earnings) } }, enabled = !allMatch) {
                Text("Reset to calculated", color = if (allMatch) T.c.mutedForeground else T.c.foreground)
            }
        }
        sessions.forEachIndexed { i, s ->
            if (i > 0) RowDivider()
            val lineInvalid = parseLineAmount(amounts[s.id]) == null
            val info: @Composable (Modifier) -> Unit = { m ->
                Column(m) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        AccentDot(hexColor(s.accent), 8.dp); Spacer(Modifier.width(8.dp))
                        Text(s.taskName, fontSize = 16.sp, color = T.c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                    }
                    SupportingParts(listOfNotNull(s.taskGroup?.name, Time.format(s.fromMs, "MMM d"), "${Time.clock(s.fromMs)}–${Time.clock(s.toMs)}", Format.durationMinutes(s.durationMinutes.toDouble())))
                    Text("Calculated ${Format.money(s.earnings, s.currency)}", fontSize = 14.sp, color = T.c.mutedForeground, style = Tabular)
                }
            }
            val field: @Composable (Modifier) -> Unit = { m ->
                BField(
                    amounts[s.id] ?: "", { amounts[s.id] = it }, "Amount", m, keyboardType = KeyboardType.Decimal,
                    suffix = Format.currencyUnitLabel(s.currency), isError = lineInvalid,
                    supporting = if (lineInvalid) "Enter a valid amount (0 or more)." else null,
                )
            }
            if (big) {
                Column(Modifier.padding(vertical = 10.dp)) { info(Modifier.fillMaxWidth()); Spacer(Modifier.height(6.dp)); field(Modifier.fillMaxWidth()) }
            } else {
                Row(Modifier.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    info(Modifier.weight(1f)); Spacer(Modifier.width(12.dp)); field(Modifier.width(140.dp))
                }
            }
        }
        FieldCaption("Payment")
        if (big) {
            BDateField(paidDate, { paidDate = it }, "Paid on")
            Spacer(Modifier.height(12.dp))
            BTimeField(paidTime, { paidTime = it }, "Paid at time")
        } else {
            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                BDateField(paidDate, { paidDate = it }, "Paid on", Modifier.weight(1.4f))
                BTimeField(paidTime, { paidTime = it }, "Paid at time", Modifier.weight(1f))
            }
        }
        Spacer(Modifier.height(12.dp))
        BField(note, { note = it.take(2000) }, "Note (optional)", placeholder = "Invoice #, reference…", singleLine = false)
        Spacer(Modifier.height(8.dp))
    }
}

