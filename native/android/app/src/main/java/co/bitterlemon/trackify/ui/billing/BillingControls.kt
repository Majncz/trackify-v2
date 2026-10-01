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
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.BillingTask
import co.bitterlemon.trackify.data.Task
import co.bitterlemon.trackify.ui.auth.friendlyError
import co.bitterlemon.trackify.ui.components.AccentBadge
import co.bitterlemon.trackify.ui.components.BadgeVariant
import co.bitterlemon.trackify.ui.components.ConfirmDialog
import co.bitterlemon.trackify.ui.components.ControlShape
import co.bitterlemon.trackify.ui.components.TBadge
import co.bitterlemon.trackify.ui.components.TButton
import co.bitterlemon.trackify.ui.components.TInput
import co.bitterlemon.trackify.ui.components.TSelect
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.ui.theme.Tabular
import co.bitterlemon.trackify.ui.theme.hexColor
import co.bitterlemon.trackify.util.Format
import kotlinx.coroutines.launch

object Currencies {
    val PRESETS = listOf(
        "CZK" to "CZK — Czech koruna", "EUR" to "EUR — Euro", "USD" to "USD — US dollar",
        "GBP" to "GBP — British pound", "PLN" to "PLN — Polish złoty", "CHF" to "CHF — Swiss franc",
        "SEK" to "SEK — Swedish krona", "NOK" to "NOK — Norwegian krone", "DKK" to "DKK — Danish krone",
        "HUF" to "HUF — Hungarian forint",
    )

    fun options(current: String?): List<Pair<String, String>> {
        val u = current?.trim()?.uppercase().orEmpty()
        return if (u.isNotEmpty() && PRESETS.none { it.first == u }) PRESETS + (u to "$u — other") else PRESETS
    }
}

object BillingMath {
    fun minutes(from: Long, to: Long): Int = maxOf(0L, (to - from) / 60_000).toInt()
    fun earnings(minutes: Int, rate: Double): Double = Format.round2(minutes / 60.0 * rate)

    /** Web `eventToBillingSession` earnings for an event (paidAmount wins when recorded). */
    fun eventEarnings(from: Long, to: Long, rate: Double, paidAmount: Double? = null): Double =
        paidAmount?.let { Format.round2(it) } ?: earnings(minutes(from, to), rate)
}

@Composable
fun CurrencySelect(value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier, label: String? = "Currency") {
    TSelect(value, Currencies.options(value), onChange, modifier, label = label)
}

/** Web `billingSurface.inset`: 1 px border, muted/35 background. */
@Composable
fun InsetBox(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Box(
        modifier.fillMaxWidth().clip(ControlShape).border(1.dp, T.c.border, ControlShape)
            .background(T.c.muted.copy(alpha = 0.35f)).padding(12.dp),
    ) { content() }
}

/**
 * Enrol / edit rate / remove controls shared by Task detail and the Rates tab
 * (web `TaskBillingPanel` + `TaskEnrollmentSheet`).
 */
@Composable
fun BillingRateControls(task: Task, billing: BillingTask?, onChanged: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    var draftRate by remember { mutableStateOf("50") }
    var draftCurrency by remember { mutableStateOf("CZK") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmRemove by remember { mutableStateOf(false) }

    fun run(block: suspend () -> Unit) {
        busy = true; error = null
        scope.launch {
            try {
                block(); graph.repo.refreshBillingTasks(); graph.repo.bumpData(); onChanged()
            } catch (e: Exception) {
                error = friendlyError(e, "Update failed")
            }
            busy = false
        }
    }

    if (billing == null) {
        InsetBox {
            Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Add an hourly rate to include this task in Billing sessions and payment history.", fontSize = 14.sp, color = T.c.mutedForeground)
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Bottom) {
                    Column(Modifier.width(110.dp)) {
                        Text("Hourly rate", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground)
                        Spacer(Modifier.height(4.dp))
                        TInput(draftRate, { draftRate = it }, placeholder = "50", keyboardType = KeyboardType.Decimal)
                    }
                    CurrencySelect(draftCurrency, { draftCurrency = it }, Modifier.weight(1f))
                }
                TButton(if (busy) "Adding…" else "Add to billing", {
                    val n = draftRate.replace(',', '.').toDoubleOrNull()
                    run { graph.api.enroll(task.id, if (n != null && n.isFinite()) maxOf(0.0, n) else 0.0, draftCurrency) }
                }, Modifier.fillMaxWidth(), enabled = !busy)
                error?.let { Text(it, fontSize = 12.sp, color = T.c.destructive) }
            }
        }
    } else {
        var rate by remember(billing.id, billing.hourlyRate) { mutableStateOf(trimRate(billing.hourlyRate)) }
        InsetBox {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Rate & rules", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground, modifier = Modifier.weight(1f))
                    IconButton({ confirmRemove = true }, enabled = !busy, modifier = Modifier.size(36.dp)) {
                        Icon(Icons.Outlined.Delete, "Remove from billing", tint = T.c.destructive, modifier = Modifier.size(18.dp))
                    }
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.Bottom) {
                    Column(Modifier.width(110.dp)) {
                        Text("Hourly rate", fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground)
                        Spacer(Modifier.height(4.dp))
                        Box(Modifier.onFocusChanged { f ->
                            if (!f.isFocused) {
                                val n = rate.replace(',', '.').toDoubleOrNull()
                                if (n != null && n >= 0 && n != billing.hourlyRate) run { graph.api.patchBillingTask(billing.id, rate = n) }
                            }
                        }) {
                            TInput(rate, { rate = it }, keyboardType = KeyboardType.Decimal, onIme = {
                                val n = rate.replace(',', '.').toDoubleOrNull()
                                if (n != null && n >= 0 && n != billing.hourlyRate) run { graph.api.patchBillingTask(billing.id, rate = n) }
                            })
                        }
                    }
                    CurrencySelect(billing.currency, { c -> if (c != billing.currency) run { graph.api.patchBillingTask(billing.id, currency = c) } }, Modifier.weight(1f))
                }
                error?.let { Text(it, fontSize = 12.sp, color = T.c.destructive) }
            }
        }
    }
    if (confirmRemove && billing != null) {
        ConfirmDialog(
            "Remove from billing?", "Remove this task from billing? Paid history stays linked to past sessions.", "Remove",
            onConfirm = { run { graph.api.unenroll(billing.id) } }, onDismiss = { confirmRemove = false },
        )
    }
}

fun trimRate(v: Double): String = if (v == Math.floor(v)) v.toLong().toString() else v.toString()

@Composable
fun GroupOrUngroupedBadge(task: Task) {
    val g = task.taskGroup
    if (g != null) AccentBadge(g.name, hexColor(g.accent)) else TBadge("Ungrouped", variant = BadgeVariant.Secondary)
}

@Composable
fun BillingStatusBadge(on: Boolean) {
    if (on) TBadge("Billing on", variant = BadgeVariant.Default) else TBadge("Not billing", variant = BadgeVariant.Outline, color = T.c.mutedForeground)
}

@Composable
fun BillingStatsRow(task: Task, billing: BillingTask?) {
    val trackedMinutes = task.events.sumOf { BillingMath.minutes(it.fromMs, it.toMs) }
    val est = billing?.let { b -> task.events.sumOf { BillingMath.earnings(BillingMath.minutes(it.fromMs, it.toMs), b.hourlyRate) } }
    Row(Modifier.fillMaxWidth()) {
        Column(Modifier.weight(1f)) {
            Text("Tracked time", fontSize = 14.sp, color = T.c.mutedForeground)
            Text(Format.durationMinutes(trackedMinutes.toDouble()), fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = Tabular)
        }
        Column(Modifier.weight(1f)) {
            Text("Est. at current rate", fontSize = 14.sp, color = T.c.mutedForeground)
            Text(if (billing != null && est != null) Format.money(est, billing.currency) else "—", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = Tabular)
        }
    }
}

