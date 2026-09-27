package co.bitterlemon.trackify.ui.billing

import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.KeyboardArrowDown
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
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
import androidx.compose.ui.draw.clip
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
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.AiAnalytics
import co.bitterlemon.trackify.data.AiPeriod
import co.bitterlemon.trackify.data.AiPreset
import co.bitterlemon.trackify.ui.auth.friendlyError
import co.bitterlemon.trackify.ui.components.BadgeVariant
import co.bitterlemon.trackify.ui.components.BtnSize
import co.bitterlemon.trackify.ui.components.BtnVariant
import co.bitterlemon.trackify.ui.components.ConfirmDialog
import co.bitterlemon.trackify.ui.components.DateField
import co.bitterlemon.trackify.ui.components.Skeleton
import co.bitterlemon.trackify.ui.components.TBadge
import co.bitterlemon.trackify.ui.components.TButton
import co.bitterlemon.trackify.ui.components.TCard
import co.bitterlemon.trackify.ui.components.TDialog
import co.bitterlemon.trackify.ui.components.TInput
import co.bitterlemon.trackify.ui.components.TSelect
import co.bitterlemon.trackify.ui.components.TooltipPopup
import co.bitterlemon.trackify.ui.stats.rangeBounds
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
}

private fun providerLabel(raw: String): String = try {
    Uri.parse(raw).host?.removePrefix("www.")?.takeIf { it.isNotBlank() } ?: "Open link"
} catch (_: Exception) {
    "Open link"
}

private fun localDateLabel(ms: Long) = java.text.DateFormat.getDateInstance(java.text.DateFormat.SHORT).format(java.util.Date(ms))

@Composable
fun AiBillingTab() {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    var viewCurrency by rememberSaveable { mutableStateOf("CZK") }
    var data by remember { mutableStateOf<AiAnalytics?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var presets by remember { mutableStateOf<List<AiPreset>>(emptyList()) }
    var tick by remember { mutableStateOf(0) }
    var chartMonthly by rememberSaveable { mutableStateOf(true) }
    var showPast by rememberSaveable { mutableStateOf(false) }
    var dialog by remember { mutableStateOf<Pair<Boolean, AiPeriod?>?>(null) }
    var deleting by remember { mutableStateOf<AiPeriod?>(null) }
    var patchError by remember { mutableStateOf<String?>(null) }
    var patching by remember { mutableStateOf(false) }

    LaunchedEffect(viewCurrency, tick) {
        runCatching { graph.api.aiAnalytics(viewCurrency) }.onSuccess { data = it; error = null }.onFailure { if (data == null) error = friendlyError(it, "Failed to load AI analytics") }
    }
    LaunchedEffect(tick) { runCatching { graph.api.aiPresets() }.onSuccess { presets = it } }

    fun patch(p: AiPeriod, depleted: Long?) {
        patching = true
        scope.launch {
            try {
                graph.api.patchAiPeriod(p.id, buildJsonObject { put("depletedAt", depleted?.let { JsonPrimitive(Time.iso(it)) } ?: JsonNull) })
                patchError = null; tick++
            } catch (e: Exception) {
                patchError = friendlyError(e, "Could not update entry")
            }
            patching = false
        }
    }

    Column(Modifier.widthIn(max = 896.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Column {
            Text("AI billing", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
            Text(buildAnnotatedString {
                append("Each row is a budget line — lifetime totals add up simply (100 + 150 = 250). Timer overlap is split automatically when billing windows overlap: the earliest-start row wins each slice. Active days counts whole calendar days from the row start through today, the end date, or depletion — whichever comes first. Use ")
                withStyle(SpanStyle(color = T.c.foreground, fontWeight = FontWeight.Medium)) { append("Mark depleted") }
                append(" to cap the window when credits run out before the calendar end.")
            }, fontSize = 14.sp, color = T.c.mutedForeground, lineHeight = 20.sp)
        }
        Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            CurrencySelect(viewCurrency, { viewCurrency = it }, Modifier.weight(1f), label = "View totals in")
            TButton("Add AI billing", { dialog = true to null }, icon = Icons.Outlined.Add)
        }
        val d = data
        if (d != null && d.fxMissingCurrencies.isNotEmpty()) {
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).border(1.dp, T.c.amber.copy(alpha = 0.5f), RoundedCornerShape(8.dp)).background(T.c.amber.copy(alpha = 0.1f)).padding(12.dp)) {
                Text("Exchange rate unavailable", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
                Text("Could not load rates for: ${d.fxMissingCurrencies.joinToString(", ")}. Lifetime and chart totals in $viewCurrency may be incomplete; native prices on each card are still shown.", fontSize = 13.sp, color = T.c.foreground)
            }
        }
        when {
            d == null && error != null -> Text(error!!, color = T.c.destructive, fontSize = 14.sp)
            d == null -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { repeat(2) { Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { Skeleton(Modifier.weight(1f).height(72.dp)); Skeleton(Modifier.weight(1f).height(72.dp)) } } }
            else -> {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Kpi("Lifetime AI billing (${d.viewCurrency})", Format.money(d.summary.lifetimeSpendInView, d.viewCurrency), true, Modifier.weight(1f).fillMaxHeight())
                        Kpi("Overlap this month (${d.viewCurrency})", Format.money(d.summary.currentMonthOverlapSpendInView, d.viewCurrency), false, Modifier.weight(1f).fillMaxHeight())
                    }
                    Row(Modifier.height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Kpi("Active entries", "${d.summary.activeSubscriptions}", false, Modifier.weight(1f).fillMaxHeight())
                        Kpi("Total entries", "${d.summary.periodCount}", false, Modifier.weight(1f).fillMaxHeight())
                    }
                }
                if (d.cumulativeByMonth.isNotEmpty()) {
                    TCard(Modifier.fillMaxWidth()) {
                        Row(verticalAlignment = Alignment.Top) {
                            Column(Modifier.weight(1f)) {
                                Text(if (chartMonthly) "Spend per month" else "Cumulative spend", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
                                Text(if (chartMonthly) "Monthly AI billing total in ${d.viewCurrency}" else "Running total in ${d.viewCurrency} over time", fontSize = 13.sp, color = T.c.mutedForeground)
                            }
                            Row(Modifier.clip(RoundedCornerShape(6.dp)).border(1.dp, T.c.border, RoundedCornerShape(6.dp))) {
                                listOf(true to "Monthly", false to "Cumulative").forEach { (m, l) ->
                                    Text(
                                        l, Modifier.background(if (chartMonthly == m) T.c.primary else Color.Transparent).clickable { chartMonthly = m }.padding(horizontal = 10.dp, vertical = 6.dp),
                                        fontSize = 12.sp, fontWeight = FontWeight.Medium, color = if (chartMonthly == m) T.c.onPrimary else T.c.mutedForeground,
                                    )
                                }
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).border(1.dp, T.c.border.copy(alpha = 0.6f), RoundedCornerShape(8.dp)).background(T.c.muted.copy(alpha = 0.2f)).padding(8.dp)) {
                            SpendChart(if (chartMonthly) d.spendByMonth.map { it.month to it.totalInView } else d.cumulativeByMonth.map { it.month to it.totalInView }, chartMonthly, d.viewCurrency)
                        }
                    }
                }
                if (d.rankings.mostTrackedHours.isNotEmpty()) {
                    TCard(Modifier.fillMaxWidth()) {
                        Text("Most tracked hours credited", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
                        Spacer(Modifier.height(8.dp))
                        d.rankings.mostTrackedHours.forEachIndexed { i, r ->
                            if (i > 0) HorizontalDivider(color = T.c.border.copy(alpha = 0.5f))
                            Row(Modifier.padding(vertical = 8.dp)) {
                                Text(r.name, fontSize = 14.sp, color = T.c.foreground, modifier = Modifier.weight(1f))
                                Text("${trimNum(r.trackedHours)}h", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = T.c.foreground, style = Tabular)
                            }
                        }
                    }
                }
                Text("Entries", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
                patchError?.let { Text(it, color = T.c.destructive, fontSize = 14.sp) }
                val active = d.periods.filter { it.metrics.isActive }
                val past = d.periods.filter { !it.metrics.isActive }
                if (d.periods.isEmpty()) {
                    TCard(Modifier.fillMaxWidth(), border = T.c.border) {
                        Text("No AI billing entries yet. Use Add AI billing to start tracking.", fontSize = 14.sp, color = T.c.mutedForeground, modifier = Modifier.fillMaxWidth().padding(vertical = 16.dp), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    }
                } else {
                    if (active.isEmpty()) Text("No active entries.", fontSize = 14.sp, color = T.c.mutedForeground)
                    active.forEach { p -> PeriodCard(p, viewCurrency, patching, { patch(p, it) }, { dialog = true to p }, { deleting = p }) }
                    if (past.isNotEmpty()) {
                        Row(Modifier.clickable { showPast = !showPast }.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(if (showPast) Icons.Outlined.KeyboardArrowDown else Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = T.c.mutedForeground, modifier = Modifier.size(16.dp))
                            Text(" Past entries (${past.size})", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground)
                        }
                        if (showPast) past.forEach { p -> PeriodCard(p, viewCurrency, patching, { patch(p, it) }, { dialog = true to p }, { deleting = p }) }
                    }
                }
            }
        }
    }

    dialog?.let { (_, editing) -> PeriodFormDialog(editing, presets, onDismiss = { dialog = null }, onSaved = { tick++ }) }
    deleting?.let { p ->
        ConfirmDialog("Delete this AI billing entry?", "This removes only the billing line and analytics tied to it. Cannot be undone.", "Delete", onConfirm = {
            scope.launch {
                runCatching { graph.api.deleteAiPeriod(p.id) }.onFailure { patchError = friendlyError(it, "Could not delete") }
                tick++
            }
        }, onDismiss = { deleting = null })
    }
}

private fun trimNum(v: Double) = if (v == Math.floor(v)) v.toLong().toString() else v.toString()

@Composable
private fun Kpi(label: String, value: String, highlight: Boolean, modifier: Modifier) {
    TCard(modifier, padding = androidx.compose.foundation.layout.PaddingValues(12.dp), border = if (highlight) T.c.primary.copy(alpha = 0.4f) else null, background = if (highlight) T.c.primary.copy(alpha = 0.05f) else null) {
        Text(label, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground)
        Text(value, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = Tabular, maxLines = 1)
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
    val axisW = with(density) { 56.dp.toPx() }
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
                    drawLine(c.border.copy(alpha = 0.6f), Offset(axisW, y), Offset(size.width, y), 1f, pathEffect = PathEffect.dashPathEffect(floatArrayOf(6f, 6f)))
                    val m = measurer.measure(compactMoney(v), labelStyle)
                    drawText(m, topLeft = Offset(axisW - m.size.width - 6f, y - m.size.height / 2f))
                    v += step
                }
                val labelEvery = maxOf(1, kotlin.math.ceil(56.dp.toPx() / slot).toInt())
                val path = Path()
                points.forEachIndexed { i, (month, value) ->
                    val cx = axisW + slot * (i + 0.5f)
                    val y = 8f + plotH * (1 - value / axisMax).toFloat()
                    if (bars) {
                        val w = minOf(slot * 0.7f, 28.dp.toPx())
                        drawRoundRect(if (month == current) c.primary else c.primary.copy(alpha = 0.45f), Offset(cx - w / 2, y), Size(w, 8f + plotH - y), CornerRadius(3.dp.toPx()))
                    } else {
                        if (i == 0) path.moveTo(cx, y) else path.lineTo(cx, y)
                    }
                    if (i % labelEvery == 0) {
                        val m = measurer.measure(month, labelStyle)
                        drawText(m, topLeft = Offset((cx - m.size.width / 2f).coerceAtLeast(axisW - 8f), size.height - bottomH + 4f))
                    }
                    if (sel?.first == i) drawRoundRect(c.muted.copy(alpha = 0.5f), Offset(cx - slot / 2, 8f), Size(slot, plotH), CornerRadius(4f))
                }
                if (!bars) drawPath(path, c.primary, style = Stroke(2.dp.toPx()))
            }
        }
    }
    sel?.let { (i, anchor) ->
        TooltipPopup(anchor, { sel = null }, width = 200) {
            Text(points[i].first, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
            Text("${if (bars) "Spend" else "Total"}: ${Format.money(points[i].second, currency)}", fontSize = 12.sp, color = T.c.foreground, style = Tabular)
        }
    }
}

private fun compactMoney(v: Double): String = when {
    v >= 1_000_000 -> "${trimNum(Format.round2(v / 1_000_000))}M"
    v >= 10_000 -> "${trimNum(Format.round2(v / 1000))}k"
    else -> trimNum(Format.round2(v))
}

@Composable
private fun PeriodCard(p: AiPeriod, viewCurrency: String, patching: Boolean, onPatch: (Long?) -> Unit, onEdit: () -> Unit, onDelete: () -> Unit) {
    val context = LocalContext.current
    val state = if (p.depletedAt != null) "Depleted" else if (p.metrics.isActive) "Running" else "Ended"
    val stateColor = when (state) {
        "Running" -> T.c.green
        "Depleted" -> T.c.amber
        else -> T.c.border
    }
    val start = Time.parse(p.startsAt)
    TCard(Modifier.fillMaxWidth(), padding = androidx.compose.foundation.layout.PaddingValues(0.dp)) {
        Row(Modifier.height(IntrinsicSize.Min)) {
            Box(Modifier.width(3.dp).fillMaxHeight().background(stateColor))
            Column(Modifier.weight(1f).padding(14.dp)) {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(4.dp), itemVerticalAlignment = Alignment.CenterVertically) {
                    Text(p.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
                    TBadge(state, variant = BadgeVariant.Outline, color = when (state) {
                        "Running" -> if (T.c.dark) Color(0xFF4ADE80) else Color(0xFF15803D)
                        "Depleted" -> if (T.c.dark) Color(0xFFFBBF24) else Color(0xFFB45309)
                        else -> T.c.mutedForeground
                    })
                    TBadge(AiCadence.label(AiCadence.normalize(p.billingCadence)), variant = BadgeVariant.Outline, color = T.c.mutedForeground)
                }
                Spacer(Modifier.height(4.dp))
                Text("${localDateLabel(start)} → ${p.endsAt?.let { localDateLabel(Time.parse(it)) } ?: "open-ended"}", fontSize = 12.sp, color = T.c.mutedForeground)
                if (p.depletedAt != null) Text("Depleted ${localDateLabel(Time.parse(p.depletedAt))}", fontSize = 12.sp, color = if (T.c.dark) Color(0xCCFDE68A) else Color(0xCC78350F))
                else {
                    var t = System.currentTimeMillis()
                    p.endsAt?.let { t = minOf(t, Time.parse(it)) }
                    Text("Window closes: ${localDateLabel(t)}", fontSize = 12.sp, color = T.c.mutedForeground)
                }
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (p.depletedAt != null) TButton("Clear depletion", { onPatch(null) }, variant = BtnVariant.Ghost, size = BtnSize.Sm, enabled = !patching)
                    else if (p.metrics.isActive) TButton("Mark depleted", { onPatch(System.currentTimeMillis()) }, variant = BtnVariant.Outline, size = BtnSize.Sm, enabled = !patching)
                    Spacer(Modifier.weight(1f))
                    IconButton(onEdit) { Icon(Icons.Outlined.Edit, "Edit AI billing entry", tint = T.c.foreground, modifier = Modifier.size(18.dp)) }
                    IconButton(onDelete) { Icon(Icons.Outlined.Delete, "Delete AI billing entry", tint = T.c.destructive, modifier = Modifier.size(18.dp)) }
                }
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    p.billingEmail?.let { KV("Account email: ", it) }
                    p.billingProviderUrl?.let { url ->
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text("Provider: ", fontSize = 14.sp, color = T.c.mutedForeground)
                            Row(Modifier.clickable { runCatching { context.startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(url))) } }, verticalAlignment = Alignment.CenterVertically) {
                                Text(providerLabel(url), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, textDecoration = androidx.compose.ui.text.style.TextDecoration.Underline)
                                Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, tint = T.c.mutedForeground, modifier = Modifier.padding(start = 3.dp).size(13.dp))
                            }
                        }
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(if (p.billingKind == "recurring_monthly") "Monthly price: " else "One-time price: ", fontSize = 14.sp, color = T.c.mutedForeground)
                        Text(Format.money(p.price, p.currency), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = Tabular)
                        if (viewCurrency != p.currency && p.priceApproxCzk != null && viewCurrency == "CZK") {
                            Text(" (~${Format.money(p.priceApproxCzk, "CZK")} CZK)", fontSize = 12.sp, color = T.c.mutedForeground)
                        }
                    }
                    KV("Overlap hours (${p.metrics.tasksWithTrackedTime} tasks): ", "${trimNum(p.metrics.trackedHours)}h")
                    KV("Active days: ", "${p.metrics.durationDays}")
                    if (p.paidEarningsByCurrency.isNotEmpty()) KV("Paid billable earnings: ", p.paidEarningsByCurrency.entries.joinToString("  ") { (cur, a) -> Format.money(a, cur) })
                }
                Spacer(Modifier.height(8.dp))
                HorizontalDivider(color = T.c.border.copy(alpha = 0.6f))
                Spacer(Modifier.height(6.dp))
                Text("Overlap hours: timer time credited to this row (earliest-start wins across concurrent windows). Paid billable earnings: paid billing sessions in this window — final once ended or depleted.", fontSize = 11.sp, color = T.c.mutedForeground, lineHeight = 15.sp)
                p.note?.takeIf { it.isNotBlank() }?.let { Spacer(Modifier.height(6.dp)); Text(it, fontSize = 12.sp, color = T.c.mutedForeground, fontStyle = FontStyle.Italic) }
            }
        }
    }
}

@Composable
private fun KV(k: String, v: String) {
    Text(buildAnnotatedString {
        withStyle(SpanStyle(color = T.c.mutedForeground)) { append(k) }
        withStyle(SpanStyle(color = T.c.foreground, fontWeight = FontWeight.SemiBold)) { append(v) }
    }, fontSize = 14.sp, style = Tabular)
}

@Composable
private fun PeriodFormDialog(editing: AiPeriod?, presets: List<AiPreset>, onDismiss: () -> Unit, onSaved: () -> Unit) {
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

    TDialog(
        if (e != null) "Edit AI billing" else "New AI billing", onDismiss, maxWidth = 672.dp,
        description = "Same layout as Mark as paid: fill details below, then save. Depletion is set from the entry card after credits run out.",
        footer = {
            TButton("Cancel", onDismiss, variant = BtnVariant.Outline, enabled = !saving)
            TButton(if (saving) "Saving…" else if (e != null) "Save entry" else "Create entry", { save() }, enabled = !saving)
        },
    ) {
        InsetBox {
            Column {
                Text(if (recurring) "Recurring · ${AiCadence.label(cadence)}" else "One-time · ${AiCadence.label(cadence)}", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
                Text("${name.trim().ifEmpty { "Untitled" }} · ${price.replace(',', '.').toDoubleOrNull()?.let { Format.money(it, currency) } ?: "—"}", fontSize = 13.sp, color = T.c.mutedForeground)
            }
        }
        Spacer(Modifier.height(12.dp))
        val presetOptions = listOf("" to "—") + presets.map { it.id to it.name }
        TSelect(presetId, presetOptions, { id ->
            presetId = id
            presets.firstOrNull { it.id == id }?.let { name = it.name }
        }, label = "Preset (optional)", enabled = e == null)
        Spacer(Modifier.height(10.dp))
        TInput(name, { name = it.take(200) }, label = "Display name", placeholder = "e.g. Cursor Pro")
        Spacer(Modifier.height(10.dp))
        TInput(email, { email = it }, label = "Account email (optional)", placeholder = "you@example.com", keyboardType = KeyboardType.Email)
        Spacer(Modifier.height(10.dp))
        TInput(url, { url = it }, label = "Link to subscription provider (optional)", placeholder = "https://billing.example.com", keyboardType = KeyboardType.Uri)
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Bottom) {
            TInput(price, { price = it }, Modifier.weight(1f), label = if (recurring) "Monthly price" else "Amount paid", placeholder = "0", keyboardType = KeyboardType.Decimal)
            CurrencySelect(currency, { currency = it }, Modifier.weight(1f))
        }
        Spacer(Modifier.height(10.dp))
        TSelect(kind, listOf("purchase" to "One-time subscription", "recurring_monthly" to "Recurring subscription"), {
            kind = it; cadence = "monthly"; hasEnd = false; purchaseComputed = true; endDate = startDate
        }, label = "How you pay")
        Text(
            if (recurring) "Each calendar month in your window adds one charge in totals (cadence is stored). Charts still use month buckets for now."
            else "One-time: coverage always closes at the end of the calendar period you pick below (week / month / quarter / year). You can override with a custom end date.",
            fontSize = 12.sp, color = T.c.mutedForeground, modifier = Modifier.padding(top = 4.dp),
        )
        Spacer(Modifier.height(10.dp))
        TSelect(cadence, AiCadence.options, { cadence = it }, label = if (recurring) "Billing cycle" else "Paid coverage period")
        Text(
            if (recurring) "Charts still attribute recurring spend by calendar month regardless of cycle."
            else "Weekly = Monday–Sunday block containing the start date; monthly / quarterly / yearly = through the last day of that calendar bucket.",
            fontSize = 12.sp, color = T.c.mutedForeground, modifier = Modifier.padding(top = 4.dp),
        )
        Spacer(Modifier.height(14.dp))
        Text("SUBSCRIPTION PERIOD", fontSize = 11.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground, letterSpacing = 0.5.sp)
        Spacer(Modifier.height(6.dp))
        Text("Starts on", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
        Spacer(Modifier.height(4.dp))
        DateField(startDate, { startDate = it }, maxDate = null)
        if (!recurring) {
            if (purchaseComputed) {
                Spacer(Modifier.height(6.dp))
                Text("Coverage ends after period: ${localDateLabel(Time.endOfDay(AiCadence.coverageEnd(startDate, cadence)))}", fontSize = 13.sp, color = T.c.mutedForeground)
            }
            CheckRow("Use a different end date", !purchaseComputed) { purchaseComputed = !it; if (it) endDate = AiCadence.coverageEnd(startDate, cadence) }
            if (!purchaseComputed) {
                Text("Ends on", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
                Spacer(Modifier.height(4.dp))
                DateField(endDate, { endDate = it }, maxDate = null, minDate = startDate)
            }
        } else {
            CheckRow("Ended / ends on a date", hasEnd) { hasEnd = it }
            if (hasEnd) {
                Text("Ends on", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
                Spacer(Modifier.height(4.dp))
                DateField(endDate, { endDate = it }, maxDate = null, minDate = startDate)
            } else Text("Unchecked means still active (open-ended).", fontSize = 12.sp, color = T.c.mutedForeground)
        }
        Spacer(Modifier.height(12.dp))
        TInput(note, { note = it.take(2000) }, label = "Note (optional)", placeholder = "Invoice ref, plan tier…", singleLine = false, minLines = 2)
        if (e == null) {
            CheckRow("Save as new preset for next time", saveAsPreset) { saveAsPreset = it }
            if (saveAsPreset) TInput(presetName, { presetName = it.take(120) }, placeholder = "Preset name")
        }
        error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = T.c.destructive, fontSize = 14.sp) }
    }
}

@Composable
private fun CheckRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().clickable { onChange(!checked) }.padding(vertical = 2.dp), verticalAlignment = Alignment.CenterVertically) {
        Checkbox(checked, onChange, colors = CheckboxDefaults.colors(checkedColor = T.c.primary, checkmarkColor = T.c.onPrimary))
        Text(label, fontSize = 14.sp, color = T.c.foreground)
    }
}

@Suppress("unused")
private val keepRange = ::rangeBounds
