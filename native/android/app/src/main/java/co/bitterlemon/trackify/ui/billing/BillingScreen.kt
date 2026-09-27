package co.bitterlemon.trackify.ui.billing

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.outlined.AutoAwesome
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Payments
import androidx.compose.material.icons.outlined.Sell
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.BillingSummary
import co.bitterlemon.trackify.ui.components.ListRow
import co.bitterlemon.trackify.ui.components.RowDivider
import co.bitterlemon.trackify.ui.components.ScreenBar
import co.bitterlemon.trackify.ui.components.Skeleton
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.ui.theme.Tabular
import co.bitterlemon.trackify.util.Format

/** Billing sub-screens (nav routes under the More tab). */
object BillingRoutes {
    const val SESSIONS = "billing/sessions"
    const val PAYMENTS = "billing/payments"
    const val PAYMENT = "billing/payment"
    const val RATES = "billing/rates"
    const val AI = "billing/ai"
}

/**
 * Billing home: unpaid summary per currency, then plain rows into Sessions, Payments, Rates and AI subscriptions.
 */
@Composable
fun BillingScreen(onBack: () -> Unit, onOpen: (String) -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val billingTasks by graph.repo.billingTasks.collectAsState()
    val dataVersion by graph.repo.dataVersion.collectAsState()
    var summary by remember { mutableStateOf<BillingSummary?>(null) }
    var summaryError by remember { mutableStateOf(false) }
    var paymentCount by remember { mutableStateOf<Int?>(null) }
    var aiActive by remember { mutableStateOf<Int?>(null) }
    var guide by remember { mutableStateOf(false) }

    LaunchedEffect(dataVersion) {
        graph.repo.refreshBillingTasks()
        runCatching { graph.api.billingSummary() }.onSuccess { summary = it; summaryError = false }.onFailure { if (summary == null) summaryError = true }
        runCatching { graph.api.payments() }.onSuccess { paymentCount = it.size }
        runCatching { graph.api.aiPeriods() }.onSuccess { r -> aiActive = r.periods.count { it.metrics.isActive } }
    }

    Column(Modifier.fillMaxSize()) {
        ScreenBar("Billing", onBack = onBack) {
            IconButton({ guide = true }) { Icon(Icons.Outlined.Info, "How billing works", tint = T.c.mutedForeground) }
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            item {
                Column(Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth()) {
                    Summary(summary, summaryError)
                    RowDivider(Modifier.padding(top = 8.dp))
                    val enrolled = billingTasks?.size
                    ListRow(
                        "Sessions", subtitle = "Select tracked time and mark it paid",
                        icon = Icons.AutoMirrored.Outlined.ReceiptLong, onClick = { onOpen(BillingRoutes.SESSIONS) }, trailing = { Chevron() },
                    )
                    ListRow(
                        "Payments", subtitle = paymentCount?.let { if (it == 0) "No payments yet" else "$it payment${if (it == 1) "" else "s"} recorded" } ?: "Payment history",
                        icon = Icons.Outlined.Payments, onClick = { onOpen(BillingRoutes.PAYMENTS) }, trailing = { Chevron() },
                    )
                    ListRow(
                        "Rates", subtitle = when (enrolled) {
                            null -> "Hourly rates per task"
                            0 -> "Set up billing: add a rate to a task"
                            else -> "$enrolled task${if (enrolled == 1) "" else "s"} billing hourly"
                        },
                        icon = Icons.Outlined.Sell, onClick = { onOpen(BillingRoutes.RATES) }, trailing = { Chevron() },
                    )
                    ListRow(
                        "AI subscriptions", subtitle = aiActive?.let { if (it == 0) "No active entries" else "$it active" } ?: "AI tool spend",
                        icon = Icons.Outlined.AutoAwesome, onClick = { onOpen(BillingRoutes.AI) }, trailing = { Chevron() },
                    )
                }
            }
        }
    }
    if (guide) BillingGuideSheet(onOpenRates = { guide = false; onOpen(BillingRoutes.RATES) }, onDismiss = { guide = false })
}

@Composable
private fun Chevron() = Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = T.c.mutedForeground)

@Composable
private fun Summary(summary: BillingSummary?, error: Boolean) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 8.dp)) {
        when {
            summary == null && error -> Text("Couldn't load the billing summary.", fontSize = 15.sp, color = T.c.destructive)
            summary == null -> {
                Skeleton(Modifier.width(120.dp).height(14.dp)); Spacer(Modifier.height(8.dp))
                Skeleton(Modifier.width(220.dp).height(36.dp)); Spacer(Modifier.height(8.dp))
                Skeleton(Modifier.fillMaxWidth().height(14.dp))
            }
            summary.byCurrency.isEmpty() -> Text("Enroll tasks in billing to see earnings summary.", fontSize = 15.sp, color = T.c.mutedForeground)
            else -> summary.byCurrency.entries.sortedBy { it.key }.forEachIndexed { i, (cur, t) ->
                if (i > 0) Spacer(Modifier.height(16.dp))
                Text("Unpaid · $cur", fontSize = 14.sp, color = T.c.mutedForeground)
                Text(Format.money(t.unpaidTotal, cur), fontSize = 34.sp, lineHeight = 40.sp, fontWeight = FontWeight.Bold, color = T.c.foreground, style = Tabular)
                SupportingParts(listOf("This week ${Format.money(t.thisWeekTotal, cur)}", "This month ${Format.money(t.thisMonthTotal, cur)}", "Paid ${Format.money(t.allTimePaidTotal, cur)}"))
            }
        }
    }
}

/** "How billing works" (web dismissible guide) as a sheet behind the ⓘ action. */
@Composable
private fun BillingGuideSheet(onOpenRates: () -> Unit, onDismiss: () -> Unit) {
    FormSheet("How billing works", onDismiss, footer = {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = androidx.compose.foundation.layout.Arrangement.End) {
            androidx.compose.material3.TextButton(onOpenRates) { Text("Open Rates", color = T.c.foreground) }
        }
    }) {
        Text("You don't log time here — billing only reads what you track and handles the money steps.", fontSize = 15.sp, color = T.c.mutedForeground)
        Spacer(Modifier.height(12.dp))
        val steps = listOf(
            listOf("Rates" to true, ": give the tasks you bill an hourly rate. That's the only setup." to false),
            listOf("Track time on the " to false, "Timer" to true, " as usual." to false),
            listOf("Sessions" to true, ": filter by period, group, task or status." to false),
            listOf("Tap rows to select them, then " to false, "Mark as paid" to true, " — one currency per payment. Paid batches are under " to false, "Payments" to true, ", where you can reopen them." to false),
        )
        steps.forEachIndexed { i, parts ->
            Row(Modifier.padding(vertical = 6.dp)) {
                Text("${i + 1}.", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground, modifier = Modifier.width(24.dp))
                Text(buildAnnotatedString {
                    parts.forEach { (t, strong) -> if (strong) withStyle(SpanStyle(color = T.c.foreground, fontWeight = FontWeight.Medium)) { append(t) } else append(t) }
                }, fontSize = 15.sp, color = T.c.mutedForeground, lineHeight = 22.sp)
            }
        }
    }
}
