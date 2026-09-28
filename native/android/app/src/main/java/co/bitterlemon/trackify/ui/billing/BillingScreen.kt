package co.bitterlemon.trackify.ui.billing

import co.bitterlemon.trackify.ui.components.SectionLabel
import androidx.compose.ui.draw.clip

import androidx.compose.foundation.background

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
            IconButton({ guide = true }) { Icon(Icons.Outlined.Info, "How billing works", tint = T.c.foreground) }
        }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            item {
                Column(Modifier.widthIn(max = BillingMaxWidth).fillMaxWidth()) {
                    // iOS: "Unpaid" header, one card with a block per currency, then the four rows.
                    SectionLabel("Unpaid", Modifier.padding(top = 0.dp))
                    Summary(summary, summaryError)
                    val enrolled = billingTasks?.size
                    co.bitterlemon.trackify.ui.components.Section {
                        ListRow(
                            "Sessions", icon = Icons.AutoMirrored.Outlined.ReceiptLong, onClick = { onOpen(BillingRoutes.SESSIONS) }, chevron = true,
                        )
                        co.bitterlemon.trackify.ui.components.SectionDivider(icon = true)
                        ListRow(
                            "Payments", value = paymentCount?.takeIf { it > 0 }?.toString(),
                            icon = Icons.Outlined.Payments, onClick = { onOpen(BillingRoutes.PAYMENTS) }, chevron = true,
                        )
                        co.bitterlemon.trackify.ui.components.SectionDivider(icon = true)
                        ListRow(
                            "Rates", subtitle = if (enrolled == 0) "Set up billing: add a rate to a task" else null,
                            value = enrolled?.takeIf { it > 0 }?.toString(),
                            icon = Icons.Outlined.Sell, onClick = { onOpen(BillingRoutes.RATES) }, chevron = true,
                        )
                        co.bitterlemon.trackify.ui.components.SectionDivider(icon = true)
                        ListRow(
                            "AI subscriptions", value = aiActive?.takeIf { it > 0 }?.let { "$it active" },
                            icon = Icons.Outlined.AutoAwesome, onClick = { onOpen(BillingRoutes.AI) }, chevron = true,
                        )
                    }
                }
            }
        }
    }
    if (guide) BillingGuideSheet(onOpenRates = { guide = false; onOpen(BillingRoutes.RATES) }, onDismiss = { guide = false })
}

@Composable
private fun Summary(summary: BillingSummary?, error: Boolean) {
    Column(
        Modifier.fillMaxWidth().padding(horizontal = 16.dp)
            .clip(co.bitterlemon.trackify.ui.components.CardShape).background(T.c.cell)
            .padding(horizontal = 16.dp, vertical = 16.dp),
    ) {
        when {
            summary == null && error -> Text("Couldn't load the billing summary.", fontSize = 15.sp, color = T.c.destructive)
            summary == null -> {
                Skeleton(Modifier.width(120.dp).height(14.dp)); Spacer(Modifier.height(8.dp))
                Skeleton(Modifier.width(220.dp).height(36.dp)); Spacer(Modifier.height(8.dp))
                Skeleton(Modifier.fillMaxWidth().height(14.dp))
            }
            summary.byCurrency.isEmpty() -> Text("Enroll tasks in billing to see earnings summary.", fontSize = 15.sp, color = T.c.mutedForeground)
            else -> summary.byCurrency.entries.sortedBy { it.key }.forEachIndexed { i, (cur, t) ->
                if (i > 0) androidx.compose.material3.HorizontalDivider(Modifier.padding(vertical = 16.dp), thickness = 0.8.dp, color = T.c.separator)
                Text(cur, fontSize = 15.sp, color = T.c.mutedForeground)
                Text(Format.money(t.unpaidTotal, cur), fontSize = 38.sp, lineHeight = 46.sp, fontWeight = FontWeight.Bold, color = T.c.foreground, style = Tabular)
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
            androidx.compose.material3.TextButton(onOpenRates) { Text("Open Rates") }
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
