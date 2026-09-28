package co.bitterlemon.trackify.ui.billing

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDropDown
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.RadioButton
import androidx.compose.material3.RadioButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.util.Format
import co.bitterlemon.trackify.util.Time
import java.time.LocalDate
import java.time.format.TextStyle
import java.time.temporal.IsoFields
import java.util.Locale

/** Max content width for billing screens on tablets (same as More). */
val BillingMaxWidth = 720.dp

/** True when the user runs a large font scale: rows stack instead of squeezing. */
@Composable
fun largeFont(): Boolean = LocalDensity.current.fontScale > 1.3f

enum class BillingPeriod(val label: String) { ThisWeek("This week"), ThisMonth("This month"), LastMonth("Last month"), AllTime("All time"), Custom("Custom") }

fun billingRange(p: BillingPeriod, cf: LocalDate, ct: LocalDate, today: LocalDate = Time.today()): Pair<Long?, Long?> = when (p) {
    BillingPeriod.ThisWeek -> Time.startOfDay(Time.mondayOf(today)) to Time.endOfDay(Time.sundayOf(today))
    BillingPeriod.ThisMonth -> Time.startOfDay(today.withDayOfMonth(1)) to Time.endOfDay(today.withDayOfMonth(today.lengthOfMonth()))
    BillingPeriod.LastMonth -> today.withDayOfMonth(1).minusMonths(1).let { Time.startOfDay(it) to Time.endOfDay(it.withDayOfMonth(it.lengthOfMonth())) }
    BillingPeriod.AllTime -> null to null
    BillingPeriod.Custom -> Time.startOfDay(cf) to Time.endOfDay(ct)
}

/** Pure ledger helpers (unit-tested). */
object BillingLedger {
    /** Server section key for a session (UTC keys: "2026-09-26", "2026-W39", "2026-09"). */
    fun key(groupDay: String, groupWeek: String, groupMonth: String, groupBy: String): String = when (groupBy) {
        "week" -> groupWeek
        "month" -> groupMonth
        else -> groupDay
    }

    /** Friendly header for a server key; falls back to the raw key when it doesn't parse. */
    fun label(key: String, groupBy: String, today: LocalDate = Time.today(), locale: Locale = Locale.getDefault()): String = runCatching {
        when (groupBy) {
            "week" -> {
                val (y, w) = key.split("-W").let { it[0].toInt() to it[1].toInt() }
                val thisWeek = today.get(IsoFields.WEEK_OF_WEEK_BASED_YEAR) == w && today.get(IsoFields.WEEK_BASED_YEAR) == y
                val monday = LocalDate.of(y, 1, 4).with(IsoFields.WEEK_OF_WEEK_BASED_YEAR, w.toLong()).with(java.time.DayOfWeek.MONDAY)
                val range = "${Time.format(monday, "MMM d")} – ${Time.format(monday.plusDays(6), "MMM d")}"
                if (thisWeek) "This week · $range" else "Week $w · $range"
            }
            "month" -> {
                val (y, m) = key.split("-").let { it[0].toInt() to it[1].toInt() }
                val name = java.time.Month.of(m).getDisplayName(TextStyle.FULL_STANDALONE, locale).replaceFirstChar { it.titlecase(locale) }
                if (y == today.year) name else "$name $y"
            }
            else -> {
                val d = LocalDate.parse(key)
                when (d) {
                    today -> "Today"
                    today.minusDays(1) -> "Yesterday"
                    else -> Time.format(d, if (d.year == today.year) "EEE, MMM d" else "EEE, MMM d, yyyy")
                }
            }
        }
    }.getOrDefault(key)

    data class Selection(val count: Int, val minutes: Int, val byCurrency: Map<String, Double>) {
        val ready: Boolean get() = count > 0 && byCurrency.size == 1
        val multiCurrency: Boolean get() = byCurrency.size > 1
    }

    fun selection(rows: List<Triple<Int, String, Double>>): Selection =
        Selection(rows.size, rows.sumOf { it.first }, rows.groupBy { it.second }.mapValues { (_, l) -> Format.round2(l.sumOf { it.third }) })
}

fun parseLineAmount(raw: String?): Double? {
    if (raw == null || raw.isBlank()) return null
    val n = raw.trim().replace(',', '.').toDoubleOrNull() ?: return null
    if (!n.isFinite() || n < 0) return null
    return Format.round2(n)
}

fun amountText(v: Double): String = if (v == Math.floor(v)) v.toLong().toString() else v.toString()

// ---------------- UI building blocks ----------------

private val handle: @Composable () -> Unit = {
    Box(Modifier.padding(top = 10.dp, bottom = 6.dp).size(width = 36.dp, height = 4.dp).clip(RoundedCornerShape(2.dp)).background(T.c.mutedForeground.copy(alpha = 0.4f)))
}

/**
 * Bottom-sheet form: title row with close, scrollable body, pinned footer.
 * [fullHeight] makes it fill the screen (Mark as paid, AI entry form).
 */
@Composable
fun FormSheet(
    title: String,
    onDismiss: () -> Unit,
    fullHeight: Boolean = false,
    footer: (@Composable ColumnScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = state,
        containerColor = T.c.card,
        contentColor = T.c.foreground,
        tonalElevation = 0.dp,
        scrimColor = Color.Black.copy(alpha = 0.4f),
        dragHandle = handle,
    ) {
        Column(Modifier.fillMaxWidth().then(if (fullHeight) Modifier.fillMaxHeight() else Modifier).imePadding()) {
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(title, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, modifier = Modifier.weight(1f))
                IconButton(onDismiss) { Icon(Icons.Outlined.Close, "Close", tint = T.c.mutedForeground) }
            }
            Column(
                Modifier.weight(1f, fill = fullHeight).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp, vertical = 8.dp),
                content = content,
            )
            if (footer != null) {
                HorizontalDivider(color = T.c.border)
                Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 12.dp), content = footer)
            }
        }
    }
}

/** Single-choice sheet (filters, currency): radio rows. */
@Composable
fun <K> ChoiceSheet(
    title: String,
    options: List<Pair<K, String>>,
    selected: K,
    onSelect: (K) -> Unit,
    onDismiss: () -> Unit,
    extra: (@Composable ColumnScope.() -> Unit)? = null,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = state,
        containerColor = T.c.card,
        contentColor = T.c.foreground,
        tonalElevation = 0.dp,
        scrimColor = Color.Black.copy(alpha = 0.4f),
        dragHandle = handle,
    ) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(bottom = 16.dp)) {
            Text(title, fontSize = 20.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp))
            options.forEach { (k, label) ->
                Row(
                    Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.RadioButton) { onSelect(k) }.padding(horizontal = 8.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(k == selected, { onSelect(k) })
                    Spacer(Modifier.width(8.dp))
                    Text(label, fontSize = 16.sp, color = T.c.foreground)
                }
            }
            extra?.invoke(this)
        }
    }
}

/** Material filter chip with a dropdown arrow: opens a choice sheet. */
@Composable
fun DropChip(label: String, active: Boolean, onClick: () -> Unit) {
    FilterChip(
        selected = active,
        onClick = onClick,
        label = { Text(label, fontSize = 14.sp, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        trailingIcon = { Icon(Icons.Outlined.ArrowDropDown, null, modifier = Modifier.size(18.dp)) },
        colors = FilterChipDefaults.filterChipColors(
            containerColor = Color.Transparent,
            labelColor = T.c.foreground,
            iconColor = T.c.mutedForeground,
            selectedContainerColor = T.c.muted,
            selectedLabelColor = T.c.foreground,
            selectedTrailingIconColor = T.c.foreground,
        ),
        border = FilterChipDefaults.filterChipBorder(enabled = true, selected = active, borderColor = T.c.border, selectedBorderColor = T.c.muted),
    )
}

/** Material outlined text field in Trackify neutrals. */
@Composable
fun BField(
    value: String,
    onChange: (String) -> Unit,
    label: String,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    keyboardType: KeyboardType = KeyboardType.Text,
    suffix: String? = null,
    singleLine: Boolean = true,
    isError: Boolean = false,
    supporting: String? = null,
    enabled: Boolean = true,
) {
    OutlinedTextField(
        value, onChange, modifier.fillMaxWidth(),
        label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
        placeholder = placeholder?.let { { Text(it) } },
        suffix = suffix?.let { { Text(it, color = T.c.mutedForeground) } },
        singleLine = singleLine,
        minLines = if (singleLine) 1 else 2,
        isError = isError,
        enabled = enabled,
        supportingText = supporting?.let { { Text(it) } },
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
    )
}

/** Small caption above a form group. */
@Composable
fun FieldCaption(text: String, modifier: Modifier = Modifier) {
    Text(text, fontSize = 13.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground, modifier = modifier.padding(top = 12.dp, bottom = 6.dp))
}

/** Label/value line used in detail sheets. */
@Composable
fun DetailLine(label: String, value: String, modifier: Modifier = Modifier) {
    FlowRow(modifier.fillMaxWidth().padding(vertical = 6.dp), horizontalArrangement = Arrangement.SpaceBetween) {
        Text(label, fontSize = 15.sp, lineHeight = 22.sp, color = T.c.mutedForeground, modifier = Modifier.padding(end = 12.dp))
        Text(value, fontSize = 15.sp, lineHeight = 22.sp, color = T.c.foreground, style = co.bitterlemon.trackify.ui.theme.Tabular)
    }
}

/** Centered muted message for empty / error states. */
@Composable
fun StateMessage(text: String, color: Color = T.c.mutedForeground, action: (@Composable RowScope.() -> Unit)? = null) {
    Column(Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(text, fontSize = 15.sp, color = color, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
        if (action != null) Row(Modifier.padding(top = 16.dp), content = action)
    }
}

/** Material exposed dropdown (read-only outlined field + menu). */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun <K> BDropdown(value: K, options: List<Pair<K, String>>, onChange: (K) -> Unit, label: String, modifier: Modifier = Modifier, enabled: Boolean = true, fieldText: String? = null) {
    var open by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    androidx.compose.material3.ExposedDropdownMenuBox(open && enabled, { if (enabled) open = it }, modifier) {
        OutlinedTextField(
            fieldText ?: options.firstOrNull { it.first == value }?.second ?: "", {}, readOnly = true, enabled = enabled, singleLine = true,
            label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            trailingIcon = { androidx.compose.material3.ExposedDropdownMenuDefaults.TrailingIcon(open) },
            modifier = Modifier.fillMaxWidth().menuAnchor(androidx.compose.material3.ExposedDropdownMenuAnchorType.PrimaryNotEditable, enabled),
        )
        ExposedDropdownMenu(open, { open = false }, containerColor = T.c.card) {
            options.forEach { (k, l) ->
                androidx.compose.material3.DropdownMenuItem(
                    text = { Text(l, fontSize = 15.sp, color = T.c.foreground) },
                    onClick = { open = false; onChange(k) },
                    contentPadding = androidx.compose.material3.ExposedDropdownMenuDefaults.ItemContentPadding,
                )
            }
        }
    }
}

/** Muted "a · b · c" line that wraps only between parts. */
@Composable
fun SupportingParts(parts: List<String>, modifier: Modifier = Modifier) {
    FlowRow(modifier) {
        parts.forEachIndexed { i, t ->
            Text(t.replace(' ', '\u00A0') + (if (i < parts.lastIndex) "\u00A0·\u00A0" else ""), fontSize = 14.sp, color = T.c.mutedForeground, style = co.bitterlemon.trackify.ui.theme.Tabular)
        }
    }
}

/** Read-only outlined field that opens a picker on tap. */
@Composable
private fun PickerField(text: String, label: String, icon: androidx.compose.ui.graphics.vector.ImageVector, onClick: () -> Unit, modifier: Modifier) {
    Box(modifier) {
        OutlinedTextField(
            text, {}, Modifier.fillMaxWidth(), readOnly = true, singleLine = true,
            label = { Text(label, maxLines = 1, overflow = TextOverflow.Ellipsis) },
            trailingIcon = { Icon(icon, null) },
            textStyle = androidx.compose.material3.LocalTextStyle.current.merge(co.bitterlemon.trackify.ui.theme.Tabular),
        )
        // Covers the field (below the floating label) so a tap opens the picker instead of focusing text.
        Box(Modifier.matchParentSize().padding(top = 8.dp).clip(RoundedCornerShape(4.dp)).clickable(role = Role.Button, onClickLabel = label, onClick = onClick))
    }
}

/** Material date field: opens the date picker. */
@Composable
fun BDateField(value: LocalDate, onChange: (LocalDate) -> Unit, label: String, modifier: Modifier = Modifier, minDate: LocalDate? = LocalDate.of(2018, 1, 1)) {
    var open by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    PickerField(Time.format(value, "EEE, MMM d, yyyy"), label, Icons.Outlined.CalendarToday, { open = true }, modifier)
    if (open) co.bitterlemon.trackify.ui.team.LocalDatePickerDialog(value, { open = false }, maxDate = null, minDate = minDate) { onChange(it); open = false }
}

/** Material 24 h time field: opens the time picker. */
@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun BTimeField(value: java.time.LocalTime, onChange: (java.time.LocalTime) -> Unit, label: String, modifier: Modifier = Modifier) {
    var open by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    PickerField("%02d:%02d".format(value.hour, value.minute), label, Icons.Outlined.Schedule, { open = true }, modifier)
    if (open) {
        val state = androidx.compose.material3.rememberTimePickerState(value.hour, value.minute, is24Hour = true)
        androidx.compose.material3.AlertDialog(
            onDismissRequest = { open = false },
            confirmButton = { androidx.compose.material3.TextButton({ onChange(java.time.LocalTime.of(state.hour, state.minute)); open = false }) { Text("OK") } },
            dismissButton = { androidx.compose.material3.TextButton({ open = false }) { Text("Cancel") } },
            text = {
                androidx.compose.material3.TimePicker(
                    state,
                )
            },
        )
    }
}
