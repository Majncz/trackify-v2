package co.bitterlemon.trackify.ui.billing

import androidx.compose.foundation.clickable
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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material3.Icon
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.BillingSession
import co.bitterlemon.trackify.data.Payment
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
import co.bitterlemon.trackify.util.Time
import kotlinx.coroutines.launch

private fun sessionsLabel(n: Int) = "$n session${if (n == 1) "" else "s"}"

/** Billing → Payments: every recorded payment, newest first. */
@Composable
fun PaymentsScreen(onBack: () -> Unit, onOpen: (String) -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val dataVersion by graph.repo.dataVersion.collectAsState()
    var payments by remember { mutableStateOf<List<Payment>?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(dataVersion) {
        runCatching { graph.api.payments() }.onSuccess { payments = it; error = null }.onFailure { error = friendlyError(it, "Couldn't load payments") }
    }
    Column(Modifier.fillMaxSize()) {
        ScreenBar("Payments", onBack = onBack)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            val list = payments
            when {
                list == null && error != null -> item { StateMessage(error ?: "", T.c.destructive) }
                list == null -> items(5) {
                    Column(Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth().padding(horizontal = 20.dp, vertical = 14.dp)) {
                        Skeleton(Modifier.width(140.dp).height(18.dp)); Spacer(Modifier.height(6.dp)); Skeleton(Modifier.width(220.dp).height(12.dp))
                    }
                }
                list.isEmpty() -> item { StateMessage("No payments recorded yet. Select sessions and mark them as paid.") }
                else -> items(list, key = { it.id }) { p ->
                    Column(Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth()) {
                        Row(
                            Modifier.fillMaxWidth().heightIn(min = 64.dp).clickable(role = Role.Button) { onOpen(p.id) }.padding(start = 20.dp, end = 12.dp, top = 10.dp, bottom = 10.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Column(Modifier.weight(1f)) {
                                Text(Format.money(p.totalAmount, p.currency), fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = Tabular)
                                SupportingParts(listOf(Time.format(Time.parse(p.paidAt), "MMM d, yyyy"), Time.format(Time.parse(p.paidAt), "HH:mm"), sessionsLabel(p.sessions.size), Format.durationMinutes(p.totalMinutes.toDouble())))
                                if (!p.note.isNullOrBlank()) Text(p.note, fontSize = 14.sp, color = T.c.mutedForeground, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            }
                            Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = T.c.mutedForeground)
                        }
                        RowDivider(inset = 20.dp)
                    }
                }
            }
        }
    }
}

/** One payment: totals, note, its sessions, and Reopen (sessions become unpaid again). */
@Composable
fun PaymentDetailScreen(id: String, onBack: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    val dataVersion by graph.repo.dataVersion.collectAsState()
    var payment by remember { mutableStateOf<Payment?>(null) }
    var missing by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirm by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    LaunchedEffect(dataVersion, id) {
        runCatching { graph.api.payments() }
            .onSuccess { l -> payment = l.firstOrNull { it.id == id }; missing = payment == null }
            .onFailure { error = friendlyError(it, "Couldn't load payment") }
    }
    Column(Modifier.fillMaxSize()) {
        ScreenBar("Payment", onBack = onBack) {
            if (payment != null) TextButton({ confirm = true }, enabled = !busy) { Text("Reopen", color = T.c.destructive, fontSize = 15.sp) }
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            val p = payment
            when {
                error != null && p == null -> item { StateMessage(error ?: "", T.c.destructive) }
                missing -> item { StateMessage("This payment no longer exists.") }
                p == null -> item {
                    Column(Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth().padding(20.dp)) {
                        Skeleton(Modifier.width(200.dp).height(36.dp)); Spacer(Modifier.height(8.dp)); Skeleton(Modifier.width(240.dp).height(14.dp))
                    }
                }
                else -> {
                    item {
                        Column(Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
                            Text(Format.money(p.totalAmount, p.currency), fontSize = 34.sp, lineHeight = 40.sp, fontWeight = FontWeight.Bold, color = T.c.foreground, style = Tabular)
                            Text("Paid ${Time.format(Time.parse(p.paidAt), "MMM d, yyyy · HH:mm")}", fontSize = 15.sp, color = T.c.mutedForeground)
                            Text("${sessionsLabel(p.sessions.size)} · ${Format.durationMinutes(p.totalMinutes.toDouble())}", fontSize = 15.sp, color = T.c.mutedForeground, style = Tabular)
                            if (!p.note.isNullOrBlank()) Text(p.note, fontSize = 15.sp, color = T.c.foreground, modifier = Modifier.padding(top = 10.dp))
                            error?.let { Text(it, fontSize = 14.sp, color = T.c.destructive, modifier = Modifier.padding(top = 8.dp)) }
                        }
                    }
                    item { SectionLabel("Sessions in this payment", Modifier.widthIn(max = BillingMaxWidth)) }
                    if (p.sessions.isEmpty()) item {
                        Text(
                            "No line items could be computed for this payment (e.g. billing settings changed). The total above still reflects what was paid.",
                            fontSize = 14.sp, color = T.c.mutedForeground, modifier = Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth().padding(horizontal = 20.dp),
                        )
                    } else items(p.sessions, key = { it.id }) { s -> PaymentLine(s, p) }
                }
            }
        }
    }
    if (confirm) payment?.let { p ->
        ConfirmDialog("Reopen payment?", "Sessions will become unpaid again.", "Reopen", onConfirm = {
            busy = true
            scope.launch {
                runCatching { graph.api.reopenPayment(p.id) }
                    .onSuccess { graph.repo.bumpData(); graph.repo.requestRefresh(0); onBack() }
                    .onFailure { error = friendlyError(it, "Couldn't reopen payment") }
                busy = false
            }
        }, onDismiss = { confirm = false })
    }
}

@Composable
private fun PaymentLine(s: BillingSession, p: Payment) {
    val sameDay = Time.localDate(s.fromMs) == Time.localDate(s.toMs)
    val session = if (sameDay) "${Time.format(s.fromMs, "MMM d, yyyy")} · ${Time.clock(s.fromMs)}–${Time.clock(s.toMs)}"
    else "${Time.format(s.fromMs, "MMM d, yyyy HH:mm")} → ${Time.format(s.toMs, "MMM d, yyyy HH:mm")}"
    Column(Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 10.dp), verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    AccentDot(hexColor(s.accent), 8.dp); Spacer(Modifier.width(8.dp))
                    Text(s.taskName, fontSize = 16.sp, color = T.c.foreground, maxLines = 2, overflow = TextOverflow.Ellipsis)
                }
                Text(listOfNotNull(s.taskGroup?.name, session).joinToString(" · "), fontSize = 14.sp, color = T.c.mutedForeground, style = Tabular)
                Text(
                    "${Format.durationMinutes(s.durationMinutes.toDouble())} · marked paid ${Time.format(Time.parse(s.paymentPaidAt ?: p.paidAt), "MMM d, HH:mm")}",
                    fontSize = 14.sp, color = T.c.mutedForeground, style = Tabular,
                )
            }
            Spacer(Modifier.width(12.dp))
            Text(Format.money(s.earnings, s.currency), fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, style = Tabular, modifier = Modifier.padding(top = 2.dp))
        }
        RowDivider(inset = 20.dp)
    }
}
