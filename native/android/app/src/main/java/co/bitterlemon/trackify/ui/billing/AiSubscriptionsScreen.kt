package co.bitterlemon.trackify.ui.billing

import androidx.compose.foundation.lazy.itemsIndexed
import co.bitterlemon.trackify.ui.components.GroupedItem
import co.bitterlemon.trackify.ui.components.ListRow
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.AiAnalytics
import co.bitterlemon.trackify.data.AiPeriod
import co.bitterlemon.trackify.data.AiPreset
import co.bitterlemon.trackify.ui.auth.friendlyError
import co.bitterlemon.trackify.ui.components.AccentDot
import co.bitterlemon.trackify.ui.components.ConfirmDialog
import co.bitterlemon.trackify.ui.components.RowDivider
import co.bitterlemon.trackify.ui.components.ScreenBar
import co.bitterlemon.trackify.ui.components.SectionLabel
import co.bitterlemon.trackify.ui.components.Skeleton
import co.bitterlemon.trackify.ui.components.SurfaceBlock
import co.bitterlemon.trackify.ui.components.TooltipPopup
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.ui.theme.Tabular
import co.bitterlemon.trackify.util.Format
import co.bitterlemon.trackify.util.StatsData
import co.bitterlemon.trackify.util.Time
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import java.time.LocalDate
import java.time.YearMonth

object AiCadence {
    val options = listOf("monthly" to "Monthly", "weekly" to "Weekly", "quarterly" to "Quarterly", "yearly" to "Yearly")
    fun label(v: String) = options.firstOrNull { it.first == v }?.second ?: "Monthly"
    fun normalize(v: String?) = if (options.any { it.first == v }) v!! else "monthly"

    /** Last day of the calendar bucket (week Mon–Sun / month / quarter / year) containing [start]. */
    fun coverageEnd(start: LocalDate, cadence: String): LocalDate = when (normalize(cadence)) {
        "weekly" -> Time.sundayOf(start)
        "quarterly" -> start.withMonth(((start.monthValue - 1) / 3) * 3 + 3).let { it.withDayOfMonth(it.lengthOfMonth()) }
        "yearly" -> LocalDate.of(start.year, 12, 31)
        else -> start.withDayOfMonth(start.lengthOfMonth())
    }

    /** Running / Depleted / Ended (web period card badge). */
    fun state(p: AiPeriod): String = if (p.depletedAt != null) "Depleted" else if (p.metrics.isActive) "Running" else "Ended"
}

private fun providerLabel(raw: String): String = try {
    Uri.parse(raw).host?.removePrefix("www.")?.takeIf { it.isNotBlank() } ?: "Open link"
} catch (_: Exception) {
    "Open link"
}

private fun dateLabel(ms: Long) = Time.format(ms, "MMM d, yyyy")

private fun trimNum(v: Double) = if (v == Math.floor(v)) v.toLong().toString() else v.toString()

@Composable
private fun stateColor(state: String): Color = when (state) {
    "Running" -> T.c.green
    "Depleted" -> T.c.amber
    else -> T.c.mutedForeground.copy(alpha = 0.5f)
}

/** Billing → AI subscriptions (web AI billing tab). */
@Composable
fun AiSubscriptionsScreen(onBack: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    var viewCurrency by rememberSaveable { mutableStateOf("CZK") }
    var data by remember { mutableStateOf<AiAnalytics?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var presets by remember { mutableStateOf<List<AiPreset>>(emptyList()) }
    var tick by remember { mutableStateOf(0) }
    var chartMonthly by rememberSaveable { mutableStateOf(true) }
    var form by remember { mutableStateOf<Pair<Boolean, AiPeriod?>?>(null) }
    var detail by remember { mutableStateOf<String?>(null) }
    var deleting by remember { mutableStateOf<AiPeriod?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var patching by remember { mutableStateOf(false) }
    var currencySheet by remember { mutableStateOf(false) }

    LaunchedEffect(viewCurrency, tick) {
        runCatching { graph.api.aiAnalytics(viewCurrency) }.onSuccess { data = it; error = null }.onFailure { if (data == null) error = friendlyError(it, "Failed to load AI analytics") }
    }
    LaunchedEffect(tick) { runCatching { graph.api.aiPresets() }.onSuccess { presets = it } }

    fun patch(p: AiPeriod, depleted: Long?) {
        patching = true
        scope.launch {
            try {
                graph.api.patchAiPeriod(p.id, buildJsonObject { put("depletedAt", depleted?.let { JsonPrimitive(Time.iso(it)) } ?: JsonNull) })
                actionError = null; tick++
            } catch (e: Exception) {
                actionError = friendlyError(e, "Could not update entry")
            }
            patching = false
        }
    }

    Column(Modifier.fillMaxSize()) {
        ScreenBar("AI subscriptions", onBack = onBack) {
            IconButton({ form = true to null }) { Icon(Icons.Outlined.Add, "Add AI billing", tint = T.c.foreground) }
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            val d = data
            item {
                Row(Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth().padding(horizontal = 16.dp)) {
                    DropChip("Totals in $viewCurrency", viewCurrency != "CZK") { currencySheet = true }
                }
            }
            when {
                d == null && error != null -> item { StateMessage(error ?: "", T.c.destructive) }
                d == null -> item {
                    Column(Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth().padding(20.dp)) {
                        Skeleton(Modifier.width(140.dp).height(14.dp)); Spacer(Modifier.height(8.dp))
                        Skeleton(Modifier.width(200.dp).height(36.dp)); Spacer(Modifier.height(16.dp))
                        Skeleton(Modifier.fillMaxWidth().height(200.dp))
                    }
                }
                else -> {
                    item {
                        co.bitterlemon.trackify.ui.components.TCard(Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth().padding(horizontal = 16.dp).padding(top = 8.dp)) {
                            if (d.fxMissingCurrencies.isNotEmpty()) {
                                Text(
                                    "Exchange rate unavailable for ${d.fxMissingCurrencies.joinToString(", ")} — totals in ${d.viewCurrency} may be incomplete.",
                                    fontSize = 14.sp, color = if (T.c.dark) T.c.amber400 else Color(0xFFB45309), modifier = Modifier.padding(bottom = 10.dp),
                                )
                            }
                            Text("Lifetime AI billing", fontSize = 15.sp, color = T.c.mutedForeground)
                            Text(Format.money(d.summary.lifetimeSpendInView, d.viewCurrency), fontSize = 34.sp, lineHeight = 40.sp, fontWeight = FontWeight.Bold, color = T.c.foreground, style = Tabular)
                            SupportingParts(listOf("This month ${Format.money(d.summary.currentMonthOverlapSpendInView, d.viewCurrency)}", "${d.summary.activeSubscriptions} active", "${d.summary.periodCount} total"))
                        }
                    }
                    if (d.cumulativeByMonth.isNotEmpty()) item {
                        SurfaceBlock(Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth().padding(horizontal = 16.dp).padding(top = 20.dp)) {
                            Column(Modifier.padding(16.dp)) {
                                FlowRow(
                                    Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Text(if (chartMonthly) "Spend per month" else "Cumulative spend", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, modifier = Modifier.padding(end = 12.dp))
                                    co.bitterlemon.trackify.ui.components.Segmented(
                                        listOf(true to "Monthly", false to "Cumulative"), chartMonthly, { chartMonthly = it }, Modifier.width(230.dp), compact = true,
                                    )
                                }
                                Spacer(Modifier.height(12.dp))
                                SpendChart(if (chartMonthly) d.spendByMonth.map { it.month to it.totalInView } else d.cumulativeByMonth.map { it.month to it.totalInView }, chartMonthly, d.viewCurrency)
                            }
                        }
                    }
                    if (d.rankings.mostTrackedHours.isNotEmpty()) {
                        item { SectionLabel("Most tracked hours credited", Modifier.widthIn(max = BillingMaxWidth)) }
                        val rk = d.rankings.mostTrackedHours
                        itemsIndexed(rk, key = { _, it -> "rk-" + it.id }) { i, r ->
                            GroupedItem(i == 0, i == rk.lastIndex, Modifier.widthIn(max = BillingMaxWidth)) {
                                ListRow(r.name, value = "${trimNum(r.trackedHours)}h")
                            }
                        }
                    }
                    actionError?.let { e -> item { Text(e, color = T.c.destructive, fontSize = 14.sp, modifier = Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) } }
                    val active = d.periods.filter { it.metrics.isActive }
                    val past = d.periods.filter { !it.metrics.isActive }
                    if (d.periods.isEmpty()) item { StateMessage("No AI billing entries yet. Tap + to start tracking.") }
                    if (active.isNotEmpty()) {
                        item { SectionLabel("Active", Modifier.widthIn(max = BillingMaxWidth)) }
                        itemsIndexed(active, key = { _, it -> "a-" + it.id }) { i, p ->
                            GroupedItem(i == 0, i == active.lastIndex, Modifier.widthIn(max = BillingMaxWidth), dividerInset = 42.dp) { PeriodRow(p) { detail = p.id } }
                        }
                    } else if (d.periods.isNotEmpty()) item { SectionLabel("Active", Modifier.widthIn(max = BillingMaxWidth)); Text("No active entries.", fontSize = 15.sp, color = T.c.mutedForeground, modifier = Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth().padding(horizontal = 32.dp)) }
                    if (past.isNotEmpty()) {
                        item { SectionLabel("Past (${past.size})", Modifier.widthIn(max = BillingMaxWidth)) }
                        itemsIndexed(past, key = { _, it -> "p-" + it.id }) { i, p ->
                            GroupedItem(i == 0, i == past.lastIndex, Modifier.widthIn(max = BillingMaxWidth), dividerInset = 42.dp) { PeriodRow(p) { detail = p.id } }
                        }
                    }
                }
            }
        }
    }

    if (currencySheet) ChoiceSheet("View totals in", Currencies.options(viewCurrency), viewCurrency, { viewCurrency = it; currencySheet = false }, { currencySheet = false })
    val open = detail?.let { id -> data?.periods?.firstOrNull { it.id == id } }
    if (open != null) PeriodDetailSheet(
        open, viewCurrency, patching,
        onPatch = { patch(open, it) },
        onEdit = { detail = null; form = true to open },
        onDelete = { deleting = open },
        onDismiss = { detail = null },
    )
    form?.let { (_, editing) -> PeriodFormSheet(editing, presets, onDismiss = { form = null }, onSaved = { tick++ }) }
    deleting?.let { p ->
        ConfirmDialog("Delete this AI billing entry?", "This removes only the billing line and analytics tied to it. Cannot be undone.", "Delete", onConfirm = {
            detail = null
            scope.launch {
                runCatching { graph.api.deleteAiPeriod(p.id) }.onFailure { actionError = friendlyError(it, "Could not delete") }
                tick++
            }
        }, onDismiss = { deleting = null })
    }
}

@Composable
private fun PeriodRow(p: AiPeriod, onClick: () -> Unit) {
    val state = AiCadence.state(p)
    val kind = if (p.billingKind == "recurring_monthly") "${AiCadence.label(AiCadence.normalize(p.billingCadence))} · ${Format.money(p.price, p.currency)}"
    else "One-time · ${Format.money(p.price, p.currency)}"
    Column(Modifier.fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable(role = Role.Button, onClick = onClick).padding(start = 16.dp, end = 10.dp, top = 10.dp, bottom = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AccentDot(stateColor(state), 10.dp)
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(p.name, fontSize = 16.sp, color = T.c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                SupportingParts(kind.split(" · ") + "${dateLabel(Time.parse(p.startsAt))} → ${p.endsAt?.let { dateLabel(Time.parse(it)) } ?: "open-ended"}")
                SupportingParts(listOf(
                    "${trimNum(p.metrics.trackedHours)}h over ${p.metrics.tasksWithTrackedTime} task${if (p.metrics.tasksWithTrackedTime == 1) "" else "s"}",
                    "${p.metrics.durationDays} day${if (p.metrics.durationDays == 1) "" else "s"}", state,
                ))
            }
            co.bitterlemon.trackify.ui.components.Chevron()
        }
    }
}

@Composable
private fun PeriodDetailSheet(p: AiPeriod, viewCurrency: String, patching: Boolean, onPatch: (Long?) -> Unit, onEdit: () -> Unit, onDelete: () -> Unit, onDismiss: () -> Unit) {
    val context = LocalContext.current
    val state = AiCadence.state(p)
    FormSheet(p.name, onDismiss, footer = {
        FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp), itemVerticalAlignment = Alignment.CenterVertically) {
            TextButton(onDelete) { Text("Delete", color = T.c.destructive) }
            Spacer(Modifier.weight(1f))
            if (p.depletedAt != null) OutlinedButton({ onPatch(null) }, enabled = !patching) { Text("Clear depletion", color = T.c.foreground) }
            else if (p.metrics.isActive) OutlinedButton({ onPatch(System.currentTimeMillis()) }, enabled = !patching) { Text("Mark depleted", color = T.c.foreground) }
            Button(onEdit, colors = primaryButton()) { Text("Edit") }
        }
    }) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            AccentDot(stateColor(state), 10.dp); Spacer(Modifier.width(8.dp))
            Text("$state · ${if (p.billingKind == "recurring_monthly") "Recurring" else "One-time"} · ${AiCadence.label(AiCadence.normalize(p.billingCadence))}", fontSize = 15.sp, color = T.c.mutedForeground)
        }
        Spacer(Modifier.height(8.dp))
        val price = Format.money(p.price, p.currency) +
            if (viewCurrency != p.currency && p.priceApproxCzk != null && viewCurrency == "CZK") " (~${Format.money(p.priceApproxCzk, "CZK")})" else ""
        DetailLine(if (p.billingKind == "recurring_monthly") "Monthly price" else "One-time price", price)
        DetailLine("Period", "${dateLabel(Time.parse(p.startsAt))} → ${p.endsAt?.let { dateLabel(Time.parse(it)) } ?: "open-ended"}")
        if (p.depletedAt != null) DetailLine("Depleted", dateLabel(Time.parse(p.depletedAt)))
        else {
            var t = System.currentTimeMillis()
            p.endsAt?.let { t = minOf(t, Time.parse(it)) }
            DetailLine("Window closes", dateLabel(t))
        }
        DetailLine("Overlap hours (${p.metrics.tasksWithTrackedTime} tasks)", "${trimNum(p.metrics.trackedHours)}h")
        DetailLine("Active days", "${p.metrics.durationDays}")
        if (p.paidEarningsByCurrency.isNotEmpty()) DetailLine("Paid billable earnings", p.paidEarningsByCurrency.entries.joinToString(" · ") { (c, a) -> Format.money(a, c) })
        p.billingEmail?.let { DetailLine("Account email", it) }
        p.billingProviderUrl?.let { url ->
            FlowRow(Modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Provider", fontSize = 15.sp, color = T.c.mutedForeground, modifier = Modifier.padding(end = 12.dp))
                Text(
                    providerLabel(url), fontSize = 15.sp, color = T.c.foreground, textDecoration = TextDecoration.Underline,
                    modifier = Modifier.clickable(role = Role.Button) { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } },
                )
            }
        }
        p.note?.takeIf { it.isNotBlank() }?.let { Text(it, fontSize = 15.sp, color = T.c.mutedForeground, fontStyle = FontStyle.Italic, modifier = Modifier.padding(top = 8.dp)) }
        Text(
            "Overlap hours: timer time credited to this entry (earliest start wins when windows overlap). Paid billable earnings: paid billing sessions in this window — final once ended or depleted.",
            fontSize = 13.sp, color = T.c.mutedForeground, lineHeight = 18.sp, modifier = Modifier.padding(top = 12.dp, bottom = 8.dp),
        )
    }
}

@Composable
private fun SpendChart(points: List<Pair<String, Double>>, bars: Boolean, currency: String) {
    val measurer = rememberTextMeasurer()
    val density = LocalDensity.current
    val c = T.c
    val current = YearMonth.now(Time.zone()).toString()
    var sel by remember(points, bars) { mutableStateOf<Pair<Int, IntOffset>?>(null) }
    var origin by remember { mutableStateOf(Offset.Zero) }
    val maxV = points.maxOfOrNull { it.second } ?: 0.0
    val (axisMax, step) = StatsData.niceAxis(maxV)
    val axisW = with(density) { 48.dp.toPx() }
    val bottomH = with(density) { 20.dp.toPx() }
    val labelStyle = TextStyle(fontSize = 11.sp, color = c.mutedForeground)
    BoxWithConstraints(Modifier.fillMaxWidth()) {
        val mw = maxWidth
        val minSlot = with(density) { 28.dp.toPx() }
        val slot = maxOf(minSlot, (with(density) { mw.toPx() } - axisW) / maxOf(1, points.size))
        val contentW = with(density) { (axisW + slot * points.size).toDp() }
        Box(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState(Int.MAX_VALUE))) {
            Canvas(
                Modifier.width(maxOf(contentW, mw)).height(200.dp)
                    .onGloballyPositioned { origin = it.boundsInWindow().topLeft }
                    .pointerInput(points, slot) {
                        detectTapGestures { p ->
                            val i = ((p.x - axisW) / slot).toInt()
                            if (i in points.indices) sel = i to IntOffset((origin.x + axisW + slot * (i + 0.5f)).toInt(), (origin.y + 30).toInt())
                        }
                    }
            ) {
                val plotH = size.height - bottomH - 8f
                var v = 0.0
                while (v <= axisMax + 1e-9) {
                    val y = 8f + plotH * (1 - v / axisMax).toFloat()
                    drawLine(c.border, Offset(axisW, y), Offset(size.width, y), 1f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f)))
                    val m = measurer.measure(compactMoney(v), labelStyle)
                    drawText(m, topLeft = Offset(axisW - m.size.width - 6f, y - m.size.height / 2f))
                    v += step
                }
                val labelEvery = maxOf(1, kotlin.math.ceil(56.dp.toPx() / slot).toInt())
                val path = Path()
                points.forEachIndexed { i, (month, value) ->
                    val cx = axisW + slot * (i + 0.5f)
                    val y = 8f + plotH * (1 - value / axisMax).toFloat()
                    if (sel?.first == i) drawRoundRect(c.muted, Offset(cx - slot / 2, 8f), Size(slot, plotH), CornerRadius(4f))
                    if (bars) {
                        val w = minOf(slot * 0.7f, 28.dp.toPx())
                        drawRoundRect(if (month == current) c.primary else c.primary.copy(alpha = 0.45f), Offset(cx - w / 2, y), Size(w, 8f + plotH - y), CornerRadius(3.dp.toPx()))
                    } else {
                        if (i == 0) path.moveTo(cx, y) else path.lineTo(cx, y)
                    }
                    if (i % labelEvery == 0) {
                        val m = measurer.measure(monthLabel(month), labelStyle)
                        drawText(m, topLeft = Offset((cx - m.size.width / 2f).coerceAtLeast(axisW - 8f), size.height - bottomH + 4f))
                    }
                }
                if (!bars) drawPath(path, c.primary, style = Stroke(2.dp.toPx()))
            }
        }
    }
    sel?.let { (i, anchor) ->
        TooltipPopup(anchor, { sel = null }, width = 200) {
            Text(monthLabel(points[i].first, full = true), fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
            Text("${if (bars) "Spend" else "Total"}: ${Format.money(points[i].second, currency)}", fontSize = 12.sp, color = T.c.foreground, style = Tabular)
        }
    }
}

/** "2026-09" → "Sep" (or "Sep 2026" when [full]); raw key if it doesn't parse. */
fun monthLabel(key: String, full: Boolean = false): String = runCatching {
    val ym = YearMonth.parse(key)
    Time.format(ym.atDay(1), if (full) "MMMM yyyy" else if (ym.monthValue == 1) "MMM yy" else "MMM")
}.getOrDefault(key)

private fun compactMoney(v: Double): String = when {
    v >= 1_000_000 -> "${trimNum(Format.round2(v / 1_000_000))}M"
    v >= 10_000 -> "${trimNum(Format.round2(v / 1000))}k"
    else -> trimNum(Format.round2(v))
}

@Composable
private fun PeriodFormSheet(editing: AiPeriod?, presets: List<AiPreset>, onDismiss: () -> Unit, onSaved: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    val e = editing
    val startInit = e?.let { Time.localDate(Time.parse(it.startsAt)) } ?: Time.today()
    var name by remember { mutableStateOf(e?.name ?: "") }
    var price by remember { mutableStateOf(e?.price?.let { amountText(it) } ?: "") }
    var currency by remember { mutableStateOf(e?.currency ?: "CZK") }
    var kind by remember { mutableStateOf(if (e?.billingKind == "recurring_monthly") "recurring_monthly" else "purchase") }
    var cadence by remember { mutableStateOf(AiCadence.normalize(e?.billingCadence)) }
    var startDate by remember { mutableStateOf(startInit) }
    val endInit = e?.endsAt?.let { Time.localDate(Time.parse(it)) }
    var purchaseComputed by remember { mutableStateOf(if (e == null || e.billingKind == "recurring_monthly" || endInit == null) true else endInit == AiCadence.coverageEnd(startInit, AiCadence.normalize(e.billingCadence))) }
    var hasEnd by remember { mutableStateOf(e?.billingKind == "recurring_monthly" && e.endsAt != null) }
    var endDate by remember { mutableStateOf(endInit ?: startInit) }
    var email by remember { mutableStateOf(e?.billingEmail ?: "") }
    var url by remember { mutableStateOf(e?.billingProviderUrl ?: "") }
    var note by remember { mutableStateOf(e?.note ?: "") }
    var presetId by remember { mutableStateOf(e?.presetId ?: "") }
    var saveAsPreset by remember { mutableStateOf(false) }
    var presetName by remember { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val recurring = kind == "recurring_monthly"

    fun save() {
        error = null
        val p = price.replace(',', '.').toDoubleOrNull()
        if (name.isBlank() || p == null || p <= 0) {
            error = "Name and positive price required"; return
        }
        val startMs = Time.startOfDay(startDate)
        val endMs: Long? = if (!recurring) {
            if (purchaseComputed) Time.endOfDay(AiCadence.coverageEnd(startDate, cadence))
            else {
                val v = Time.endOfDay(endDate)
                if (v < startMs) { error = "End day must be on or after start day"; return }
                v
            }
        } else if (hasEnd) {
            val v = Time.endOfDay(endDate)
            if (v < startMs) { error = "End day must be on or after start day"; return }
            v
        } else null
        val body = buildJsonObject {
            put("name", name.trim()); put("price", p); put("currency", currency)
            put("startsAt", Time.iso(startMs)); put("endsAt", endMs?.let { JsonPrimitive(Time.iso(it)) } ?: JsonNull)
            put("billingKind", kind); put("billingCadence", cadence)
            put("billingEmail", email.trim().ifEmpty { null }?.let { JsonPrimitive(it) } ?: JsonNull)
            put("billingProviderUrl", url.trim().ifEmpty { null }?.let { JsonPrimitive(it) } ?: JsonNull)
            put("note", note.trim().ifEmpty { null }?.let { JsonPrimitive(it) } ?: JsonNull)
            put("presetId", presetId.ifEmpty { null }?.let { JsonPrimitive(it) } ?: JsonNull)
            if (e == null && saveAsPreset && presetName.isNotBlank()) put("saveAsPreset", buildJsonObject { put("name", presetName.trim()) })
        }
        saving = true
        scope.launch {
            try {
                if (e == null) graph.api.createAiPeriod(body) else graph.api.patchAiPeriod(e.id, body)
                onSaved(); onDismiss()
            } catch (ex: Exception) {
                error = friendlyError(ex, "Save failed")
            }
            saving = false
        }
    }

    FormSheet(if (e != null) "Edit AI billing" else "New AI billing", onDismiss, fullHeight = true, footer = {
        error?.let { Text(it, color = T.c.destructive, fontSize = 14.sp, modifier = Modifier.padding(bottom = 8.dp)) }
        Button({ save() }, Modifier.fillMaxWidth().heightIn(min = 52.dp), enabled = !saving, colors = primaryButton()) {
            Text(if (saving) "Saving…" else if (e != null) "Save entry" else "Create entry", fontSize = 16.sp)
        }
    }) {
        val gap = Modifier.height(12.dp)
        if (e == null) {
            BDropdown(presetId, listOf("" to "None") + presets.map { it.id to it.name }, { id ->
                presetId = id
                presets.firstOrNull { it.id == id }?.let { name = it.name }
            }, "Preset (optional)")
            Spacer(gap)
        }
        BField(name, { name = it.take(200) }, "Display name", placeholder = "e.g. Cursor Pro")
        Spacer(gap)
        BField(email, { email = it }, "Account email (optional)", placeholder = "you@example.com", keyboardType = KeyboardType.Email)
        Spacer(gap)
        BField(url, { url = it }, "Link to subscription provider (optional)", placeholder = "https://billing.example.com", keyboardType = KeyboardType.Uri)
        FieldCaption("How you pay")
        SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth()) {
            listOf("purchase" to "One-time", "recurring_monthly" to "Recurring").forEachIndexed { i, (k, l) ->
                SegmentedButton(
                    kind == k, { if (kind != k) { kind = k; cadence = "monthly"; hasEnd = false; purchaseComputed = true; endDate = startDate } },
                    SegmentedButtonDefaults.itemShape(i, 2),
                ) { Text(l, maxLines = 1) }
            }
        }
        Text(
            if (recurring) "Each calendar month in the window adds one charge to totals."
            else "Coverage closes at the end of the calendar period below (week / month / quarter / year) unless you pick another end date.",
            fontSize = 13.sp, color = T.c.mutedForeground, modifier = Modifier.padding(top = 6.dp),
        )
        Spacer(gap)
        val big = largeFont()
        if (big) {
            BField(price, { price = it }, if (recurring) "Monthly price" else "Amount paid", keyboardType = KeyboardType.Decimal)
            Spacer(gap)
            BDropdown(currency, Currencies.options(currency), { currency = it }, "Currency")
        } else Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            BField(price, { price = it }, if (recurring) "Monthly price" else "Amount paid", Modifier.weight(1f), keyboardType = KeyboardType.Decimal)
            BDropdown(currency, Currencies.options(currency), { currency = it }, "Currency", Modifier.weight(1f), fieldText = currency)
        }
        Spacer(gap)
        BDropdown(cadence, AiCadence.options, { cadence = it }, if (recurring) "Billing cycle" else "Paid coverage period")
        FieldCaption("Subscription period")
        BDateField(startDate, { startDate = it }, "Starts on")
        if (!recurring) {
            if (purchaseComputed) Text("Coverage ends after period: ${dateLabel(Time.endOfDay(AiCadence.coverageEnd(startDate, cadence)))}", fontSize = 14.sp, color = T.c.mutedForeground, modifier = Modifier.padding(top = 8.dp))
            CheckRow("Use a different end date", !purchaseComputed) { purchaseComputed = !it; if (it) endDate = AiCadence.coverageEnd(startDate, cadence) }
            if (!purchaseComputed) {
                BDateField(endDate, { endDate = it }, "Ends on", minDate = startDate)
            }
        } else {
            CheckRow("Ended / ends on a date", hasEnd) { hasEnd = it }
            if (hasEnd) {
                BDateField(endDate, { endDate = it }, "Ends on", minDate = startDate)
            } else Text("Unchecked means still active (open-ended).", fontSize = 13.sp, color = T.c.mutedForeground)
        }
        Spacer(gap)
        BField(note, { note = it.take(2000) }, "Note (optional)", placeholder = "Invoice ref, plan tier…", singleLine = false)
        if (e == null) {
            Spacer(Modifier.height(4.dp))
            CheckRow("Save as new preset for next time", saveAsPreset) { saveAsPreset = it }
            if (saveAsPreset) BField(presetName, { presetName = it.take(120) }, "Preset name")
        }
        Spacer(Modifier.height(8.dp))
    }
}

@Composable
private fun CheckRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).clickable(role = Role.Checkbox) { onChange(!checked) }, verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked, onChange)
        Text(label, fontSize = 15.sp, color = T.c.foreground)
    }
}
