package co.bitterlemon.trackify.ui.billing

import android.content.Context
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListScope
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.automirrored.outlined.HelpOutline
import androidx.compose.material.icons.automirrored.outlined.MenuBook
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.positionInWindow
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.BillingSession
import co.bitterlemon.trackify.data.BillingSummary
import co.bitterlemon.trackify.data.BillingTask
import co.bitterlemon.trackify.ui.components.AccentBadge
import co.bitterlemon.trackify.ui.components.BadgeVariant
import co.bitterlemon.trackify.ui.components.BtnSize
import co.bitterlemon.trackify.ui.components.BtnVariant
import co.bitterlemon.trackify.ui.components.CardShape
import co.bitterlemon.trackify.ui.components.DateField
import co.bitterlemon.trackify.ui.components.Segmented
import co.bitterlemon.trackify.ui.components.Skeleton
import co.bitterlemon.trackify.ui.components.TBadge
import co.bitterlemon.trackify.ui.components.TButton
import co.bitterlemon.trackify.ui.components.TCard
import co.bitterlemon.trackify.ui.components.TSelect
import co.bitterlemon.trackify.ui.components.TooltipPopup
import co.bitterlemon.trackify.ui.components.YearlyCalendar
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.ui.theme.Tabular
import co.bitterlemon.trackify.ui.theme.hexColor
import co.bitterlemon.trackify.util.ChartData
import co.bitterlemon.trackify.util.Format
import co.bitterlemon.trackify.util.Time
import java.time.LocalDate

enum class BillingTab(val label: String) { Sessions("Sessions"), History("History"), Rates("Rates"), Ai("AI billing") }

enum class BillingPeriod(val label: String) { ThisWeek("This week"), ThisMonth("This month"), LastMonth("Last month"), AllTime("All time"), Custom("Custom…") }

fun billingRange(p: BillingPeriod, cf: LocalDate, ct: LocalDate, today: LocalDate = Time.today()): Pair<Long?, Long?> = when (p) {
    BillingPeriod.ThisWeek -> Time.startOfDay(Time.mondayOf(today)) to Time.endOfDay(Time.sundayOf(today))
    BillingPeriod.ThisMonth -> Time.startOfDay(today.withDayOfMonth(1)) to Time.endOfDay(today.withDayOfMonth(today.lengthOfMonth()))
    BillingPeriod.LastMonth -> today.withDayOfMonth(1).minusMonths(1).let { Time.startOfDay(it) to Time.endOfDay(it.withDayOfMonth(it.lengthOfMonth())) }
    BillingPeriod.AllTime -> null to null
    BillingPeriod.Custom -> Time.startOfDay(cf) to Time.endOfDay(ct)
}


@Composable
fun BillingScreen(onBack: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val context = LocalContext.current
    val billingTasks by graph.repo.billingTasks.collectAsState()
    val dataVersion by graph.repo.dataVersion.collectAsState()
    var tabName by rememberSaveable { mutableStateOf(BillingTab.Sessions.name) }
    val tab = BillingTab.valueOf(tabName)
    var summary by remember { mutableStateOf<BillingSummary?>(null) }
    var summaryError by remember { mutableStateOf(false) }
    var summaryTick by remember { mutableStateOf(0) }
    var guideVisible by remember { mutableStateOf(false) }

    // Sessions filters (hoisted so the heatmap can drive them)
    val s = rememberSessionsState()

    LaunchedEffect(dataVersion, summaryTick) {
        graph.repo.refreshBillingTasks()
        runCatching { graph.api.billingSummary() }.onSuccess { summary = it; summaryError = false }.onFailure { if (summary == null) summaryError = true }
    }
    val refreshAll: () -> Unit = { summaryTick++; s.reloadTick++ }

    Column(Modifier.fillMaxSize()) {
    co.bitterlemon.trackify.ui.components.ScreenBar("Billing", onBack = onBack) {
        androidx.compose.material3.IconButton({ guideVisible = !guideVisible }) {
            androidx.compose.material3.Icon(androidx.compose.material.icons.Icons.Outlined.Info, "How billing works", tint = if (guideVisible) T.c.foreground else T.c.mutedForeground)
        }
    }
    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(start = 16.dp, end = 16.dp, bottom = 16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        item(key = "summary") { SummaryBar(summary, summaryError) }
        val hasEnrolled = !billingTasks.isNullOrEmpty()
        if (billingTasks != null && !hasEnrolled) {
            item(key = "setup") {
                TCard(Modifier.widthIn(max = 896.dp).fillMaxWidth(), border = T.c.primary.copy(alpha = 0.25f), background = T.c.primary.copy(alpha = 0.05f)) {
                    Text("Set up billing first", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
                    Text("Pick which tasks get a rate. After that, your tracked time can be paid out from the Sessions tab.", fontSize = 14.sp, color = T.c.mutedForeground)
                    Spacer(Modifier.height(12.dp))
                    TButton("Billable tasks", { tabName = BillingTab.Rates.name })
                }
            }
        }
        if (guideVisible) {
            item(key = "guide") {
                BillingGuide(onOpenRates = { tabName = BillingTab.Rates.name }, onDismiss = { guideVisible = false })
            }
        }
        item(key = "tabs") {
            Segmented(BillingTab.entries.map { it to it.label }, tab, { tabName = it.name }, Modifier.widthIn(max = 896.dp).fillMaxWidth())
        }
        when (tab) {
            BillingTab.Sessions -> sessionsTab(s, billingTasks, hasEnrolled, onGoRates = { tabName = BillingTab.Rates.name }, onPaid = refreshAll)
            BillingTab.History -> item(key = "history") { HistoryTab(dataVersion, onChanged = refreshAll) }
            BillingTab.Rates -> item(key = "rates") { RatesTab(onChanged = refreshAll) }
            BillingTab.Ai -> item(key = "ai") { AiBillingTab() }
        }
    }
    }

    if (s.markOpen) {
        val selected = s.sessions.orEmpty().filter { it.id in s.selected && !it.isPaid }
        MarkPaidDialog(selected, onDismiss = { s.markOpen = false }, onSuccess = { s.selected.clear(); refreshAll() })
    }
}

@Composable
private fun SummaryBar(summary: BillingSummary?, error: Boolean) {
    Column(Modifier.widthIn(max = 896.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        when {
            summary == null && error -> Text("Could not load billing summary.", fontSize = 14.sp, color = T.c.destructive)
            summary == null -> Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { repeat(2) { Skeleton(Modifier.weight(1f).height(64.dp)) } }
            summary.byCurrency.isEmpty() -> Text("Enroll tasks in billing to see earnings summary.", fontSize = 14.sp, color = T.c.mutedForeground)
            else -> summary.byCurrency.entries.sortedBy { it.key }.forEach { (cur, t) ->
                Column(Modifier.padding(horizontal = 4.dp)) {
                    Text("Unpaid · $cur", fontSize = 13.sp, color = T.c.mutedForeground)
                    Text(Format.money(t.unpaidTotal, cur), fontSize = 26.sp, fontWeight = FontWeight.Bold, color = T.c.foreground, style = Tabular, maxLines = 1)
                    Text(
                        "This week ${Format.money(t.thisWeekTotal, cur)} · This month ${Format.money(t.thisMonthTotal, cur)} · Paid ${Format.money(t.allTimePaidTotal, cur)}",
                        fontSize = 13.sp, color = T.c.mutedForeground, style = Tabular,
                    )
                }
            }
        }
    }
}

@Composable
private fun SummaryCard(label: String, value: String, highlight: Boolean, modifier: Modifier) {
    TCard(
        modifier, padding = PaddingValues(12.dp),
        border = if (highlight) T.c.primary.copy(alpha = 0.4f) else null,
        background = if (highlight) T.c.primary.copy(alpha = 0.05f) else null,
    ) {
        Text(label, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground)
        Text(value, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = Tabular, maxLines = 1)
    }
}

@Composable
private fun BillingGuide(onOpenRates: () -> Unit, onDismiss: () -> Unit) {
    TCard(Modifier.widthIn(max = 896.dp).fillMaxWidth(), border = T.c.primary.copy(alpha = 0.25f), background = T.c.primary.copy(alpha = 0.05f)) {
        Row(verticalAlignment = Alignment.Top) {
            Box(Modifier.size(36.dp).clip(RoundedCornerShape(6.dp)).background(T.c.primary.copy(alpha = 0.1f)), contentAlignment = Alignment.Center) {
                Icon(Icons.AutoMirrored.Outlined.MenuBook, null, tint = T.c.primary, modifier = Modifier.size(16.dp))
            }
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text("How billing works", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
                Text("Same idea as Stats: pick a range, read the chart, act on the list. You don't log time here—only money-related steps.", fontSize = 14.sp, color = T.c.mutedForeground)
            }
            IconButton(onDismiss, Modifier.size(32.dp)) { Icon(Icons.Outlined.Close, "Hide guide", tint = T.c.foreground, modifier = Modifier.size(16.dp)) }
        }
        Spacer(Modifier.height(12.dp))
        val steps = listOf(
            listOf("Rates" to true, " tab: choose which existing tasks have a rate (that's the only setup)." to false),
            listOf("Track time on the " to false, "home" to true, " dashboard as usual—billing only reads it." to false),
            listOf("Sessions" to true, " tab: use the filters at the top of the card (period, task group, task, status), then work the list below." to false),
            listOf("Tap an " to false, "unpaid row" to true, " to select it (or the checkbox). Use " to false, "All unpaid" to true, " for the whole list (again to clear), then " to false, "Mark as paid…" to true, " — one currency per batch. History is under " to false, "History" to true, "." to false),
        )
        steps.forEachIndexed { i, parts ->
            Row(Modifier.padding(vertical = 3.dp)) {
                Text("${i + 1}.", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground, modifier = Modifier.width(20.dp))
                Text(buildAnnotatedString {
                    parts.forEach { (t, strong) -> if (strong) withStyle(SpanStyle(color = T.c.foreground, fontWeight = FontWeight.Medium)) { append(t) } else append(t) }
                }, fontSize = 14.sp, color = T.c.mutedForeground, lineHeight = 21.sp)
            }
        }
        Spacer(Modifier.height(12.dp))
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            TButton("Open billable tasks", onOpenRates, variant = BtnVariant.Secondary, size = BtnSize.Sm)
            TButton("Don't show this again", onDismiss, variant = BtnVariant.Outline, size = BtnSize.Sm)
        }
    }
}

// ---------------- Sessions tab ----------------

class SessionsState {
    var period by mutableStateOf(BillingPeriod.ThisMonth)
    var customFrom by mutableStateOf(Time.today())
    var customTo by mutableStateOf(Time.today())
    var groupId by mutableStateOf("all")
    var taskId by mutableStateOf("all")
    var status by mutableStateOf("unpaid")
    var groupBy by mutableStateOf("day")
    var sessions by mutableStateOf<List<BillingSession>?>(null)
    var loading by mutableStateOf(true)
    var error by mutableStateOf<String?>(null)
    val selected = androidx.compose.runtime.mutableStateListOf<String>()
    val collapsed = mutableStateMapOf<String, Boolean>()
    var markOpen by mutableStateOf(false)
    var reloadTick by mutableStateOf(0)
    var calendarOpen by mutableStateOf(false)
}

@Composable
fun rememberSessionsState(): SessionsState {
    val graph = AppGraph.get(LocalContext.current)
    val s = remember { SessionsState() }
    val (from, to) = billingRange(s.period, s.customFrom, s.customTo)
    LaunchedEffect(from, to, s.groupId, s.taskId, s.status, s.reloadTick) {
        s.loading = s.sessions == null
        runCatching {
            graph.api.billingSessions(from, to, s.status, s.groupId.takeIf { it != "all" }, s.taskId.takeIf { it != "all" })
        }.onSuccess { r ->
            s.sessions = r.sessions; s.error = null
            val ids = r.sessions.filter { !it.isPaid }.map { it.id }.toSet()
            s.selected.retainAll(ids)
        }.onFailure { s.error = it.message ?: "Failed to load" }
        s.loading = false
    }
    return s
}

private fun LazyListScope.sessionsTab(s: SessionsState, billingTasks: List<BillingTask>?, hasEnrolled: Boolean, onGoRates: () -> Unit, onPaid: () -> Unit) {
    if (billingTasks != null && !hasEnrolled) {
        item(key = "noenrolled") {
            TCard(Modifier.widthIn(max = 896.dp).fillMaxWidth()) {
                Text("No billable tasks yet", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
                Text("Add at least one task with a rate on the Rates tab, then come back here.", fontSize = 14.sp, color = T.c.mutedForeground)
                Spacer(Modifier.height(12.dp))
                TButton("Go to Rates", onGoRates)
            }
        }
        return
    }
    item(key = "filters") { SessionFilters(s, billingTasks ?: emptyList()) }
    val sessions = s.sessions
    when {
        s.loading && sessions == null -> item(key = "sk") { Skeleton(Modifier.widthIn(max = 896.dp).fillMaxWidth().height(160.dp)) }
        s.error != null && sessions == null -> item(key = "err") { Text(s.error ?: "Failed to load", color = T.c.destructive, fontSize = 14.sp) }
        sessions.isNullOrEmpty() -> item(key = "empty") {
            Box(
                Modifier.widthIn(max = 896.dp).fillMaxWidth().clip(CardShape).border(2.dp, T.c.border, CardShape).background(T.c.muted.copy(alpha = 0.25f)).padding(vertical = 40.dp, horizontal = 16.dp),
                contentAlignment = Alignment.Center,
            ) { Text("No sessions in this range. Try another filter or enroll a task.", fontSize = 14.sp, color = T.c.mutedForeground, textAlign = androidx.compose.ui.text.style.TextAlign.Center) }
        }
        else -> {
            stickyHeader(key = "selbar") { SelectionBar(s, sessions) }
            val groups = sessions.groupBy { when (s.groupBy) { "week" -> it.groupWeek; "month" -> it.groupMonth; else -> it.groupDay } }
            groups.forEach { (key, list) ->
                item(key = "sec-$key") { SectionHeader(s, key, list) }
                if (s.collapsed[key] != true) {
                    items(list, key = { "row-" + it.id }) { row -> SessionRow(row, row.id in s.selected) { sel -> if (sel) s.selected.add(row.id) else s.selected.remove(row.id) } }
                }
            }
        }
    }
    item(key = "calendar") { ActivityCalendar(s) }
    @Suppress("UNUSED_EXPRESSION") onPaid
}

@Composable
private fun SessionFilters(s: SessionsState, billingTasks: List<BillingTask>) {
    val groups = billingTasks.mapNotNull { it.task?.taskGroup }.distinctBy { it.id }.sortedBy { it.name }
    val hasUngrouped = billingTasks.any { it.task?.taskGroup == null }
    val groupOptions = listOf("all" to "All groups") + (if (hasUngrouped) listOf("ungrouped" to "Ungrouped") else emptyList()) + groups.map { it.id to it.name }
    val enrolled = billingTasks.filter {
        when (s.groupId) {
            "all" -> true
            "ungrouped" -> it.task?.taskGroup == null
            else -> it.task?.taskGroup?.id == s.groupId
        }
    }
    val taskOptions = listOf("all" to "All enrolled") + enrolled.map { it.taskId to (it.task?.name ?: "Task") }
    LaunchedEffect(s.groupId, billingTasks) { if (s.taskId != "all" && enrolled.none { it.taskId == s.taskId }) s.taskId = "all" }
    TCard(Modifier.widthIn(max = 896.dp).fillMaxWidth()) {
        Text("Sessions", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
        Text("Billable time (rates below). List is the focus — use the compact bar to select payouts.", fontSize = 12.sp, color = T.c.mutedForeground)
        Spacer(Modifier.height(12.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TSelect(s.period, BillingPeriod.entries.map { it to it.label }, { s.period = it }, Modifier.weight(1f), label = "PERIOD", compact = true)
            TSelect(s.status, listOf("unpaid" to "Unpaid", "all" to "All", "paid" to "Paid"), { s.status = it }, Modifier.weight(1f), label = "STATUS", compact = true)
        }
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TSelect(s.groupId, groupOptions, { s.groupId = it; s.taskId = "all" }, Modifier.weight(1f), label = "GROUP", compact = true)
            TSelect(s.taskId, taskOptions, { s.taskId = it }, Modifier.weight(1f), label = "TASK", compact = true)
        }
        if (s.period == BillingPeriod.Custom) {
            Spacer(Modifier.height(8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f)) {
                    Text("FROM", fontSize = 11.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground); Spacer(Modifier.height(4.dp))
                    DateField(s.customFrom, { s.customFrom = it }, maxDate = null)
                }
                Column(Modifier.weight(1f)) {
                    Text("TO", fontSize = 11.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground); Spacer(Modifier.height(4.dp))
                    DateField(s.customTo, { s.customTo = it }, maxDate = null)
                }
            }
        }
        Spacer(Modifier.height(10.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("GROUP LIST BY", fontSize = 11.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground, letterSpacing = 0.5.sp)
            Spacer(Modifier.width(10.dp))
            Segmented(listOf("day" to "Day", "week" to "Week", "month" to "Month"), s.groupBy, { s.groupBy = it }, Modifier.weight(1f), compact = true)
        }
    }
}

@Composable
private fun SelectionBar(s: SessionsState, sessions: List<BillingSession>) {
    val selected = sessions.filter { it.id in s.selected && !it.isPaid }
    val byCur = selected.groupBy { it.currency }.mapValues { (_, l) -> l.sumOf { it.earnings } }
    val mins = selected.sumOf { it.durationMinutes }
    val ready = selected.isNotEmpty() && byCur.size == 1
    val unpaid = sessions.filter { !it.isPaid }
    val allSelected = unpaid.isNotEmpty() && unpaid.all { it.id in s.selected }
    var help by remember { mutableStateOf(false) }
    var anchor by remember { mutableStateOf(androidx.compose.ui.unit.IntOffset.Zero) }
    val hint = when (s.status) {
        "paid" -> "Switch status to Unpaid or All to select open amounts."
        "unpaid" -> "Tap unpaid rows or checkboxes. Select all selects every unpaid row in this list (tap again to clear). Mark as paid: one currency per batch."
        else -> "Select unpaid rows only; paid rows are read-only. Mark as paid uses one currency per batch."
    }
    Box(Modifier.fillMaxWidth().background(T.c.background).padding(vertical = 4.dp), contentAlignment = Alignment.Center) {
        Row(
            Modifier.widthIn(max = 896.dp).fillMaxWidth().shadow(4.dp, RoundedCornerShape(10.dp)).clip(RoundedCornerShape(10.dp))
                .border(2.dp, T.c.border, RoundedCornerShape(10.dp)).background(T.c.card).padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            IconButton({ help = true }, Modifier.size(28.dp).then(Modifier.onGloballyPositionedAnchor { anchor = it })) {
                Icon(Icons.AutoMirrored.Outlined.HelpOutline, "How selection works", tint = T.c.mutedForeground, modifier = Modifier.size(16.dp))
            }
            Spacer(Modifier.width(4.dp))
            Column(Modifier.weight(1f)) {
                if (selected.isNotEmpty()) {
                    Text(
                        buildAnnotatedString {
                            withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append("${selected.size}") }
                            append(" · ${Format.durationMinutes(mins.toDouble())}")
                            byCur.forEach { (c, a) -> append(" · "); withStyle(SpanStyle(fontWeight = FontWeight.SemiBold)) { append(Format.money(a, c)) } }
                        }, fontSize = 12.sp, color = T.c.foreground, style = Tabular,
                    )
                    if (!ready) Text("Multiple currencies — narrow selection to one currency.", fontSize = 11.sp, color = T.c.destructive)
                } else if (s.status == "paid") {
                    Text("Paid-only view — selection disabled.", fontSize = 12.sp, color = T.c.mutedForeground)
                } else {
                    Text("Nothing selected" + (if (unpaid.isNotEmpty()) " · ${unpaid.size} unpaid in list" else "") + ".", fontSize = 12.sp, color = T.c.mutedForeground)
                }
            }
            if (unpaid.isNotEmpty() && s.status != "paid") {
                TButton(if (allSelected) "Clear all" else "All unpaid (${unpaid.size})", {
                    if (allSelected) s.selected.removeAll(unpaid.map { it.id }.toSet())
                    else { s.selected.clear(); s.selected.addAll(unpaid.map { it.id }) }
                }, variant = BtnVariant.Outline, size = BtnSize.Sm)
                Spacer(Modifier.width(6.dp))
            }
            TButton("Mark as paid…", { s.markOpen = true }, size = BtnSize.Sm, enabled = ready)
        }
    }
    if (help) TooltipPopup(anchor, { help = false }) { Text(hint, fontSize = 12.sp, color = T.c.foreground, lineHeight = 17.sp) }
}

private fun Modifier.onGloballyPositionedAnchor(set: (androidx.compose.ui.unit.IntOffset) -> Unit): Modifier =
    this.onGloballyPositioned { c ->
        val p = c.positionInWindow()
        set(androidx.compose.ui.unit.IntOffset((p.x + c.size.width / 2).toInt(), (p.y + c.size.height + 60).toInt()))
    }

@Composable
private fun SectionHeader(s: SessionsState, key: String, list: List<BillingSession>) {
    val collapsed = s.collapsed[key] == true
    val mins = list.sumOf { it.durationMinutes }
    val unpaid = list.filter { !it.isPaid }
    val byCur = unpaid.groupBy { it.currency }.mapValues { (_, l) -> l.sumOf { it.earnings } }
    val ids = unpaid.map { it.id }
    val allSel = ids.isNotEmpty() && ids.all { it in s.selected }
    Row(
        Modifier.widthIn(max = 896.dp).fillMaxWidth().clip(RoundedCornerShape(10.dp)).border(2.dp, T.c.border, RoundedCornerShape(10.dp))
            .background(T.c.muted.copy(alpha = 0.55f)).padding(start = 6.dp, end = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Row(Modifier.weight(1f).clickable(role = Role.Button, onClickLabel = if (collapsed) "Expand" else "Collapse") { s.collapsed[key] = !collapsed }.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            Icon(if (collapsed) Icons.AutoMirrored.Outlined.KeyboardArrowRight else Icons.Outlined.KeyboardArrowDown, null, tint = T.c.foreground, modifier = Modifier.size(18.dp))
            Spacer(Modifier.width(4.dp))
            Column {
                Text(key, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = T.c.foreground, style = Tabular)
                Text(
                    "${Format.durationMinutes(mins.toDouble())} total" + byCur.entries.joinToString("") { (c, a) -> " · ${Format.money(a, c)} unpaid" },
                    fontSize = 12.sp, color = T.c.mutedForeground, style = Tabular,
                )
            }
        }
        Checkbox(
            allSel, { v -> if (v) s.selected.addAll(ids.filter { it !in s.selected }) else s.selected.removeAll(ids.toSet()) },
            enabled = ids.isNotEmpty(), colors = CheckboxDefaults.colors(checkedColor = T.c.primary, checkmarkColor = T.c.onPrimary),
        )
        Text("Group", fontSize = 11.sp, color = T.c.mutedForeground, modifier = Modifier.padding(end = 10.dp))
    }
}

@Composable
private fun SessionRow(row: BillingSession, selected: Boolean, onToggle: (Boolean) -> Unit) {
    val accent = hexColor(row.accent)
    val shape = RoundedCornerShape(8.dp)
    Row(
        Modifier.widthIn(max = 896.dp).fillMaxWidth()
            .then(if (selected) Modifier.shadow(4.dp, shape, ambientColor = accent, spotColor = accent) else Modifier)
            .clip(shape)
            .background(T.c.card)
            .background(accent.copy(alpha = if (selected) 0.22f else 0.12f))
            .border(2.dp, if (selected) accent.copy(alpha = 0.55f) else T.c.border, shape)
            .clickable(enabled = !row.isPaid, role = Role.Checkbox) { onToggle(!selected) }
            .padding(start = 2.dp, end = 10.dp, top = 6.dp, bottom = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Checkbox(selected, { onToggle(it) }, enabled = !row.isPaid, colors = CheckboxDefaults.colors(checkedColor = T.c.primary, checkmarkColor = T.c.onPrimary))
        Column(Modifier.weight(1f)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(row.taskName, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
                row.taskGroup?.let { AccentBadge(it.name, accent) }
            }
            Text("${Time.format(row.fromMs, "MMM d, yyyy")} · ${Time.clock(row.fromMs)}–${Time.clock(row.toMs)}", fontSize = 12.sp, color = T.c.mutedForeground, style = Tabular)
            row.paymentPaidAt?.let { if (row.isPaid) Text("Paid ${Time.format(Time.parse(it), "MMM d, yyyy")}", fontSize = 11.sp, color = T.c.mutedForeground) }
        }
        Spacer(Modifier.width(8.dp))
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(3.dp)) {
            TBadge(Format.durationMinutes(row.durationMinutes.toDouble()), variant = BadgeVariant.Secondary)
            Text(Format.money(row.earnings, row.currency), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = Tabular)
            if (row.isPaid) TBadge("Paid", variant = BadgeVariant.Default) else TBadge("Unpaid", variant = BadgeVariant.Outline)
        }
    }
}

@Composable
private fun ActivityCalendar(s: SessionsState) {
    val sessions = s.sessions ?: emptyList()
    val (_, to) = billingRange(s.period, s.customFrom, s.customTo)
    val endDay = if (s.period == BillingPeriod.AllTime || to == null) null else Time.localDate(to)
    Column(
        Modifier.widthIn(max = 896.dp).fillMaxWidth().clip(CardShape).border(1.dp, T.c.border, CardShape)
            .background(if (s.calendarOpen) T.c.card else T.c.muted.copy(alpha = 0.2f)),
    ) {
        Column(Modifier.fillMaxWidth().clickable { s.calendarOpen = !s.calendarOpen }.padding(horizontal = 16.dp, vertical = 12.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("Activity calendar", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
                Text("  (optional)", fontSize = 12.sp, color = T.c.mutedForeground, modifier = Modifier.weight(1f))
                Icon(if (s.calendarOpen) Icons.Outlined.KeyboardArrowDown else Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = T.c.mutedForeground, modifier = Modifier.size(18.dp))
            }
            Text("Same yearly heatmap as home · open when you want the overview", fontSize = 12.sp, color = T.c.mutedForeground)
        }
        AnimatedVisibility(s.calendarOpen) {
            Column(Modifier.padding(horizontal = 8.dp, vertical = 12.dp)) {
                val data = remember(sessions, endDay) { ChartData.buildYearlyFromBilling(sessions, endDay) }
                val colors = remember(sessions) { sessions.associate { it.taskName to it.accent } }
                YearlyCalendar(data, colors, rememberScrollState(Int.MAX_VALUE), onDayAction = { day ->
                    s.period = BillingPeriod.Custom; s.customFrom = day; s.customTo = day; s.status = "all"
                })
            }
        }
    }
}
