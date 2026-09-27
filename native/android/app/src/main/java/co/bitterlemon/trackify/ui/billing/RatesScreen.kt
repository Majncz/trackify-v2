package co.bitterlemon.trackify.ui.billing

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.clickable
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.BillingTask
import co.bitterlemon.trackify.data.Task
import co.bitterlemon.trackify.ui.auth.friendlyError
import co.bitterlemon.trackify.ui.components.AccentDot
import co.bitterlemon.trackify.ui.components.ConfirmDialog
import co.bitterlemon.trackify.ui.components.RowDivider
import co.bitterlemon.trackify.ui.components.ScreenBar
import co.bitterlemon.trackify.ui.components.SectionLabel
import co.bitterlemon.trackify.ui.components.Skeleton
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.ui.theme.Tabular
import co.bitterlemon.trackify.ui.theme.hexColor
import co.bitterlemon.trackify.util.Format
import kotlinx.coroutines.launch

/** Billing → Rates (web `TaskEnrollmentSheet`): every visible task, billing ones first; tap for the rate sheet. */
@Composable
fun RatesScreen(onBack: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val tasks by graph.repo.tasks.collectAsState()
    val billingTasks by graph.repo.billingTasks.collectAsState()
    var editing by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { graph.repo.refreshBillingTasks() }

    Column(Modifier.fillMaxSize()) {
        ScreenBar("Rates", onBack = onBack)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            item {
                Text(
                    "Tasks with an hourly rate show up under Sessions. Rate changes apply to unpaid sessions.",
                    fontSize = 15.sp, color = T.c.mutedForeground,
                    modifier = Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth().padding(horizontal = 20.dp, vertical = 4.dp),
                )
            }
            val list = tasks
            val bts = billingTasks
            if (list == null || bts == null) {
                items(5) {
                    Column(Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp)) {
                        Skeleton(Modifier.width(160.dp).height(16.dp)); Spacer(Modifier.height(6.dp)); Skeleton(Modifier.width(220.dp).height(12.dp))
                    }
                }
                return@LazyColumn
            }
            if (list.isEmpty()) item { StateMessage("No tasks yet. Create one on the Timer.") }
            val byTask = bts.associateBy { it.taskId }
            val sorted = list.sortedBy { it.name.lowercase() }
            val on = sorted.filter { byTask[it.id] != null }
            val off = sorted.filter { byTask[it.id] == null }
            if (on.isNotEmpty()) {
                item { SectionLabel("Billing", Modifier.widthIn(max = BillingMaxWidth)) }
                items(on, key = { "on-" + it.id }) { t -> RateRow(t, byTask[t.id]) { editing = t.id } }
            }
            if (off.isNotEmpty()) {
                item { SectionLabel("Not billing", Modifier.widthIn(max = BillingMaxWidth)) }
                items(off, key = { "off-" + it.id }) { t -> RateRow(t, null) { editing = t.id } }
            }
        }
    }
    val t = editing?.let { id -> tasks?.firstOrNull { it.id == id } }
    if (t != null) RateSheet(t, billingTasks?.firstOrNull { it.taskId == t.id }) { editing = null }
}

@Composable
private fun RateRow(t: Task, b: BillingTask?, onClick: () -> Unit) {
    val rawMin = t.events.sumOf { BillingMath.minutes(it.fromMs, it.toMs) }
    val est = b?.let { bb -> t.events.sumOf { BillingMath.earnings(BillingMath.minutes(it.fromMs, it.toMs), bb.hourlyRate) } }
    val big = largeFont()
    Column(Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth()) {
        Row(
            Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 20.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            AccentDot(hexColor(t.accent), 10.dp)
            Spacer(Modifier.width(16.dp))
            Column(Modifier.weight(1f)) {
                Text(t.name, fontSize = 16.sp, color = T.c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                SupportingParts(listOfNotNull(
                    t.taskGroup?.name ?: "Ungrouped",
                    "Tracked ${Format.durationMinutes(rawMin.toDouble())}",
                    if (b != null && est != null) "Est. ${Format.money(est, b.currency)}" else null,
                ))
                if (big) RateTrailing(b)
            }
            if (!big) { Spacer(Modifier.width(12.dp)); RateTrailing(b) }
        }
        RowDivider(inset = 46.dp)
    }
}

@Composable
private fun RateTrailing(b: BillingTask?) {
    if (b != null) Text("${Format.money(b.hourlyRate, b.currency)}/h", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = Tabular)
    else Text("Add rate", fontSize = 15.sp, color = T.c.mutedForeground)
}

/** Enroll / edit rate + currency / remove from billing. */
@Composable
fun RateSheet(task: Task, billing: BillingTask?, onDismiss: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    var rate by remember { mutableStateOf(billing?.let { trimRate(it.hourlyRate) } ?: "50") }
    var currency by remember { mutableStateOf(billing?.currency ?: "CZK") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmRemove by remember { mutableStateOf(false) }
    val parsed = rate.replace(',', '.').toDoubleOrNull()?.takeIf { it.isFinite() && it >= 0 }

    fun run(block: suspend () -> Unit) {
        busy = true; error = null
        scope.launch {
            try {
                block(); graph.repo.refreshBillingTasks(); graph.repo.bumpData(); onDismiss()
            } catch (e: Exception) {
                error = friendlyError(e, "Update failed")
            }
            busy = false
        }
    }

    FormSheet(task.name, onDismiss, footer = {
        error?.let { Text(it, fontSize = 14.sp, color = T.c.destructive, modifier = Modifier.padding(bottom = 8.dp)) }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
            if (billing != null) TextButton({ confirmRemove = true }, enabled = !busy) { Text("Remove", color = T.c.destructive) }
            Spacer(Modifier.weight(1f))
            Button(
                {
                    val n = parsed ?: return@Button
                    if (billing == null) run { graph.api.enroll(task.id, n, currency) }
                    else run {
                        graph.api.patchBillingTask(billing.id, rate = n.takeIf { it != billing.hourlyRate }, currency = currency.takeIf { it != billing.currency })
                    }
                },
                enabled = !busy && parsed != null && (billing == null || parsed != billing.hourlyRate || currency != billing.currency),
                colors = primaryButton(), modifier = Modifier.heightIn(min = 48.dp),
            ) { Text(if (busy) "Saving…" else if (billing == null) "Add to billing" else "Save") }
        }
    }) {
        Text(
            if (billing == null) "Add an hourly rate to include this task in Sessions and payment history."
            else "Billing on · ${task.taskGroup?.name ?: "Ungrouped"}",
            fontSize = 15.sp, color = T.c.mutedForeground,
        )
        Spacer(Modifier.height(12.dp))
        BField(rate, { rate = it }, "Hourly rate", keyboardType = KeyboardType.Decimal, suffix = Format.currencyUnitLabel(currency), isError = parsed == null)
        Spacer(Modifier.height(12.dp))
        BDropdown(currency, Currencies.options(currency), { currency = it }, "Currency")
        Spacer(Modifier.height(8.dp))
    }
    if (confirmRemove && billing != null) {
        ConfirmDialog(
            "Remove from billing?", "Remove this task from billing? Paid history stays linked to past sessions.", "Remove",
            onConfirm = { run { graph.api.unenroll(billing.id) } }, onDismiss = { confirmRemove = false },
        )
    }
}
