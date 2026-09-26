package co.bitterlemon.trackify.ui.billing

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.MonetizationOn
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.HorizontalDivider
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.text.withStyle
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.BillingSession
import co.bitterlemon.trackify.data.Payment
import co.bitterlemon.trackify.ui.auth.friendlyError
import co.bitterlemon.trackify.ui.components.AccentBadge
import co.bitterlemon.trackify.ui.components.BadgeVariant
import co.bitterlemon.trackify.ui.components.BtnSize
import co.bitterlemon.trackify.ui.components.BtnVariant
import co.bitterlemon.trackify.ui.components.CardShape
import co.bitterlemon.trackify.ui.components.ConfirmDialog
import co.bitterlemon.trackify.ui.components.DateField
import co.bitterlemon.trackify.ui.components.Skeleton
import co.bitterlemon.trackify.ui.components.TBadge
import co.bitterlemon.trackify.ui.components.TButton
import co.bitterlemon.trackify.ui.components.TCard
import co.bitterlemon.trackify.ui.components.TDialog
import co.bitterlemon.trackify.ui.components.TInput
import co.bitterlemon.trackify.ui.components.TimeField
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.ui.theme.Tabular
import co.bitterlemon.trackify.ui.theme.hexColor
import co.bitterlemon.trackify.util.Format
import co.bitterlemon.trackify.util.Time
import kotlinx.coroutines.launch
import java.time.LocalDateTime
import java.time.LocalTime
import kotlin.math.abs

fun parseLineAmount(raw: String?): Double? {
    if (raw == null || raw.isBlank()) return null
    val n = raw.trim().replace(',', '.').toDoubleOrNull() ?: return null
    if (!n.isFinite() || n < 0) return null
    return Format.round2(n)
}

fun amountText(v: Double): String = if (v == Math.floor(v)) v.toLong().toString() else v.toString()

/** Mark as paid (web `MarkPaidDialog`) with editable per-line amounts. */
@Composable
fun MarkPaidDialog(sessions: List<BillingSession>, onDismiss: () -> Unit, onSuccess: () -> Unit) {
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

    TDialog(
        "Mark as paid", onDismiss, description = "Total = sum of each line below. Override amounts only when needed.", maxWidth = 672.dp,
        footer = {
            Column(Modifier.fillMaxWidth()) {
                Row(Modifier.fillMaxWidth().padding(bottom = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("Total to record", fontSize = 14.sp, color = T.c.mutedForeground, modifier = Modifier.weight(1f))
                    Text(Format.money(total, currency), fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = Tabular)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End)) {
                    TButton("Cancel", onDismiss, variant = BtnVariant.Outline, enabled = !submitting)
                    TButton(if (submitting) "Saving…" else "Mark as paid", {
                        error = null
                        if (invalid || sessions.isEmpty()) {
                            error = "Enter a valid amount (0 or more) for every session."; return@TButton
                        }
                        submitting = true
                        scope.launch {
                            try {
                                val paidAt = LocalDateTime.of(paidDate, paidTime).atZone(Time.zone()).toInstant().toEpochMilli()
                                graph.api.createPayment(sessions.map { it.id }, paidAt, note.trim().ifEmpty { null }, sessions.associate { it.id to parseLineAmount(amounts[it.id])!! })
                                graph.repo.requestRefresh(0)
                                onSuccess(); onDismiss()
                            } catch (e: Exception) {
                                error = friendlyError(e, "Failed to record payment")
                            }
                            submitting = false
                        }
                    }, enabled = !submitting && sessions.isNotEmpty())
                }
            }
        },
    ) {
        InsetBox {
            Text(
                "${sessions.size} session${if (sessions.size != 1) "s" else ""} · ${Format.durationMinutes(mins.toDouble())} · ${Format.money(total, currency)}",
                fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = Tabular,
            )
        }
        Spacer(Modifier.height(10.dp))
        Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).border(2.dp, T.c.border, RoundedCornerShape(10.dp))) {
            Row(Modifier.fillMaxWidth().background(T.c.muted.copy(alpha = 0.55f)).padding(horizontal = 10.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("Sessions", fontSize = 13.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, modifier = Modifier.weight(1f))
                TButton("Reset to calculated", { error = null; sessions.forEach { amounts[it.id] = amountText(it.earnings) } }, variant = BtnVariant.Ghost, size = BtnSize.Sm, enabled = sessions.isNotEmpty() && !allMatch)
            }
            HorizontalDivider(color = T.c.border, thickness = 2.dp)
            Column(Modifier.fillMaxWidth().background(T.c.muted.copy(alpha = 0.2f)).padding(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                sessions.forEach { s ->
                    val accent = hexColor(s.accent)
                    val lineInvalid = parseLineAmount(amounts[s.id]) == null
                    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(T.c.card).background(accent.copy(alpha = 0.06f)).border(2.dp, T.c.border, RoundedCornerShape(8.dp)).padding(8.dp)) {
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(s.taskName, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
                            s.taskGroup?.let { AccentBadge(it.name, accent) }
                        }
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Column(Modifier.weight(1f)) {
                                Text("${Time.format(s.fromMs, "MMM d, yyyy")} · ${Time.clock(s.fromMs)}–${Time.clock(s.toMs)}", fontSize = 12.sp, color = T.c.mutedForeground, style = Tabular)
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    TBadge(Format.durationMinutes(s.durationMinutes.toDouble()))
                                    Text("  Calc ", fontSize = 12.sp, color = T.c.mutedForeground)
                                    Text(Format.money(s.earnings, s.currency), fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.foreground, style = Tabular)
                                }
                            }
                            TInput(
                                amounts[s.id] ?: "", { amounts[s.id] = it }, Modifier.width(128.dp), placeholder = "0",
                                keyboardType = KeyboardType.Decimal, suffix = Format.currencyUnitLabel(s.currency),
                            )
                        }
                        if (lineInvalid) Text("Enter a valid amount (0 or more).", fontSize = 11.sp, fontWeight = FontWeight.Medium, color = T.c.destructive, modifier = Modifier.fillMaxWidth(), textAlign = androidx.compose.ui.text.style.TextAlign.End)
                    }
                }
            }
        }
        Spacer(Modifier.height(14.dp))
        Text("PAYMENT DETAILS", fontSize = 11.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground, letterSpacing = 0.5.sp)
        Spacer(Modifier.height(8.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Column(Modifier.weight(1.3f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.CalendarToday, null, tint = T.c.mutedForeground, modifier = Modifier.size(13.dp)); Text("  Paid on", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
                }
                Spacer(Modifier.height(4.dp))
                DateField(paidDate, { paidDate = it }, maxDate = null)
            }
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Icon(Icons.Outlined.Schedule, null, tint = T.c.mutedForeground, modifier = Modifier.size(13.dp)); Text("  Paid at time", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
                }
                Spacer(Modifier.height(4.dp))
                TimeField(paidTime, { paidTime = it })
            }
        }
        Spacer(Modifier.height(10.dp))
        Row { Text("Note ", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.foreground); Text("(optional)", fontSize = 12.sp, color = T.c.mutedForeground) }
        Spacer(Modifier.height(4.dp))
        TInput(note, { note = it.take(2000) }, placeholder = "Invoice #, reference…", singleLine = false, minLines = 2)
        error?.let { Spacer(Modifier.height(8.dp)); Text(it, color = T.c.destructive, fontSize = 14.sp) }
    }
}

@Composable
fun HistoryTab(dataVersion: Long, onChanged: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    var payments by remember { mutableStateOf<List<Payment>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var tick by remember { mutableStateOf(0) }
    var confirm by remember { mutableStateOf<Payment?>(null) }
    LaunchedEffect(dataVersion, tick) {
        runCatching { graph.api.payments() }.onSuccess { payments = it; error = null }.onFailure { error = it.message ?: "Failed to load payments" }
    }
    Column(Modifier.widthIn(max = 896.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Payment history", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
        Text("Each batch shows amount, date, sessions, and per-line payouts from when you marked them paid.", fontSize = 14.sp, color = T.c.mutedForeground)
        val list = payments
        when {
            list == null && error != null -> Text(error!!, color = T.c.destructive, fontSize = 14.sp)
            list == null -> Skeleton(Modifier.fillMaxWidth().height(140.dp))
            list.isEmpty() -> Box(
                Modifier.fillMaxWidth().clip(CardShape).border(2.dp, T.c.border, CardShape).background(T.c.muted.copy(alpha = 0.25f)).padding(vertical = 40.dp, horizontal = 16.dp),
                contentAlignment = Alignment.Center,
            ) { Text("No payments recorded yet. Mark sessions as paid from the Ledger tab.", fontSize = 14.sp, color = T.c.mutedForeground, textAlign = androidx.compose.ui.text.style.TextAlign.Center) }
            else -> list.forEach { p ->
                Column(Modifier.fillMaxWidth().clip(CardShape).border(2.dp, T.c.border, CardShape).background(T.c.card)) {
                    Row(Modifier.padding(12.dp), verticalAlignment = Alignment.Top) {
                        Column(Modifier.weight(1f)) {
                            Text(Format.money(p.totalAmount, p.currency), fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = Tabular)
                            Text(Time.format(Time.parse(p.paidAt), "MMM d, yyyy · HH:mm"), fontSize = 14.sp, color = T.c.mutedForeground)
                            Spacer(Modifier.height(4.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                TBadge("${p.sessions.size} session${if (p.sessions.size != 1) "s" else ""}")
                                Text("  ${Format.durationMinutes(p.totalMinutes.toDouble())}", fontSize = 12.sp, color = T.c.mutedForeground, style = Tabular)
                            }
                            if (!p.note.isNullOrBlank()) {
                                Spacer(Modifier.height(8.dp)); HorizontalDivider(color = T.c.border, thickness = 2.dp); Spacer(Modifier.height(4.dp))
                                Text(p.note, fontSize = 12.sp, color = T.c.mutedForeground)
                            }
                        }
                        IconButton({ confirm = p }) { Icon(Icons.Outlined.Delete, "Reopen payment", tint = T.c.destructive, modifier = Modifier.size(18.dp)) }
                    }
                    HorizontalDivider(color = T.c.border, thickness = 2.dp)
                    Column(Modifier.fillMaxWidth().background(T.c.muted.copy(alpha = 0.2f)).padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("SESSIONS IN THIS PAYMENT", fontSize = 11.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground, letterSpacing = 0.5.sp)
                        if (p.sessions.isEmpty()) {
                            Text("No line items could be computed for this payment (e.g. billing settings changed). Totals above still reflect what was paid.", fontSize = 12.sp, color = T.c.mutedForeground)
                        } else p.sessions.forEach { s -> PaymentLine(s, p) }
                    }
                }
            }
        }
    }
    confirm?.let { p ->
        ConfirmDialog("Reopen payment?", "Sessions will become unpaid again.", "Reopen", onConfirm = {
            scope.launch {
                runCatching { graph.api.reopenPayment(p.id) }.onFailure { error = it.message }
                tick++; onChanged()
            }
        }, onDismiss = { confirm = null })
    }
}

@Composable
private fun PaymentLine(s: BillingSession, p: Payment) {
    val accent = hexColor(s.accent)
    val sameDay = Time.localDate(s.fromMs) == Time.localDate(s.toMs)
    val session = if (sameDay) "${Time.format(s.fromMs, "MMM d, yyyy")} · ${Time.clock(s.fromMs)}–${Time.clock(s.toMs)}"
    else "${Time.format(s.fromMs, "MMM d, yyyy HH:mm")} → ${Time.format(s.toMs, "MMM d, yyyy HH:mm")}"
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(T.c.card).background(accent.copy(alpha = 0.06f)).border(2.dp, T.c.border, RoundedCornerShape(8.dp)).padding(10.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Box(Modifier.padding(top = 5.dp).size(8.dp).clip(RoundedCornerShape(50)).background(accent))
        Spacer(Modifier.width(8.dp))
        Column(Modifier.weight(1f)) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(s.taskName, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
                s.taskGroup?.let { AccentBadge(it.name, accent) }
            }
            LabeledLine("Session", session)
            LabeledLine("Marked paid", Time.format(Time.parse(s.paymentPaidAt ?: p.paidAt), "MMM d, yyyy · HH:mm"))
            LabeledLine("Duration", Format.durationMinutes(s.durationMinutes.toDouble()))
        }
        Text(Format.money(s.earnings, s.currency), fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = Tabular)
    }
}

@Composable
private fun LabeledLine(label: String, value: String) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(top = 2.dp)) {
        Text(label.uppercase(), fontSize = 10.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground, modifier = Modifier.width(84.dp), letterSpacing = 0.4.sp)
        Text(value, fontSize = 12.sp, color = T.c.foreground, style = Tabular)
    }
}

/** Rates tab (web `TaskEnrollmentSheet`). */
@Composable
fun RatesTab(onChanged: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val tasks by graph.repo.tasks.collectAsState()
    val billingTasks by graph.repo.billingTasks.collectAsState()
    Column(Modifier.widthIn(max = 896.dp).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Billable tasks & rates", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
        Text("Choose which tasks bill hourly and set rate and currency. Only these tasks show up under Sessions.", fontSize = 14.sp, color = T.c.mutedForeground)
        InsetBox {
            Text(
                androidx.compose.ui.text.buildAnnotatedString {
                    withStyle(androidx.compose.ui.text.SpanStyle(color = T.c.foreground, fontWeight = FontWeight.Medium)) { append("How this list works. ") }
                    append("Rows use a light tint from your ")
                    withStyle(androidx.compose.ui.text.SpanStyle(color = T.c.foreground)) { append("group color") }
                    append(" when the task is in a group, or a stable ")
                    withStyle(androidx.compose.ui.text.SpanStyle(color = T.c.foreground)) { append("task color") }
                    append(" when it is ungrouped—matching Sessions. Badges spell out group vs ungrouped explicitly.")
                }, fontSize = 12.sp, color = T.c.mutedForeground, lineHeight = 17.sp,
            )
        }
        val list = tasks
        val bts = billingTasks
        if (list == null || bts == null) {
            Skeleton(Modifier.fillMaxWidth().height(120.dp)); return@Column
        }
        if (list.isEmpty()) {
            Text("No tasks yet. Create one on the home dashboard.", fontSize = 14.sp, color = T.c.mutedForeground)
        }
        val byTask = bts.associateBy { it.taskId }
        list.sortedWith(compareBy({ byTask[it.id] == null }, { it.name.lowercase() })).forEach { t ->
            val b = byTask[t.id]
            val accent = hexColor(t.accent)
            val rawMin = t.events.sumOf { BillingMath.minutes(it.fromMs, it.toMs) }
            val est = b?.let { bb -> t.events.sumOf { BillingMath.earnings(BillingMath.minutes(it.fromMs, it.toMs), bb.hourlyRate) } }
            TCard(Modifier.fillMaxWidth(), background = accent.copy(alpha = if (b != null) 0.05f else 0.08f)) {
                Text(t.name, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
                Spacer(Modifier.height(6.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) { GroupOrUngroupedBadge(t); BillingStatusBadge(b != null) }
                Spacer(Modifier.height(6.dp))
                Text(
                    "Tracked ${Format.durationMinutes(rawMin.toDouble())}" + if (b != null && est != null) " · Est. ${Format.money(est, b.currency)} at current rate" else "",
                    fontSize = 12.sp, color = T.c.mutedForeground, style = Tabular,
                )
                Spacer(Modifier.height(10.dp))
                BillingRateControls(t, b, onChanged)
            }
        }
    }
}

@Suppress("unused")
private val keepIcons = listOf(Icons.Outlined.MonetizationOn, BadgeVariant.Default)
@Suppress("unused")
private fun unusedTime(): LocalTime = LocalTime.MIDNIGHT
@Suppress("unused")
private val unusedHeight = Modifier.heightIn(max = 1.dp)
