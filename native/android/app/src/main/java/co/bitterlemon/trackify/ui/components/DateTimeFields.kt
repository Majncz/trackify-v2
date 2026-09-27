package co.bitterlemon.trackify.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.CalendarToday
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TimePickerDefaults
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.ui.team.LocalDatePickerDialog
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.ui.theme.Tabular
import co.bitterlemon.trackify.util.Time
import java.time.LocalDate
import java.time.LocalTime

@Composable
fun FieldButton(text: String, icon: ImageVector, onClick: () -> Unit, modifier: Modifier = Modifier, description: String? = null) {
    Row(
        modifier
            .heightIn(min = 40.dp)
            .clip(ControlShape)
            .border(1.dp, T.c.border, ControlShape)
            .background(T.c.background)
            .clickable(onClickLabel = description, onClick = onClick)
            .padding(horizontal = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, fontSize = 14.sp, color = T.c.foreground, style = Tabular, modifier = Modifier.weight(1f), maxLines = 1)
        Spacer(Modifier.width(6.dp))
        Icon(icon, null, tint = T.c.mutedForeground, modifier = Modifier.size(15.dp))
    }
}

/** Date button (opens the Material date picker). */
@Composable
fun DateField(value: LocalDate, onChange: (LocalDate) -> Unit, modifier: Modifier = Modifier, maxDate: LocalDate? = Time.today(), minDate: LocalDate? = LocalDate.of(2018, 1, 1), pattern: String = "MMM d, yyyy") {
    var open by remember { mutableStateOf(false) }
    FieldButton(Time.format(value, pattern), Icons.Outlined.CalendarToday, { open = true }, modifier, "Pick date")
    if (open) LocalDatePickerDialog(value, { open = false }, maxDate = maxDate, minDate = minDate) { onChange(it); open = false }
}

/** 24 h time button (opens the Material time picker). */
@Composable
fun TimeField(value: LocalTime, onChange: (LocalTime) -> Unit, modifier: Modifier = Modifier) {
    var open by remember { mutableStateOf(false) }
    FieldButton("%02d:%02d".format(value.hour, value.minute), Icons.Outlined.Schedule, { open = true }, modifier, "Pick time")
    if (open) {
        val state = rememberTimePickerState(value.hour, value.minute, is24Hour = true)
        TDialog(
            "Pick a time", { open = false }, maxWidth = 380.dp, sheet = false,
            footer = {
                TButton("Cancel", { open = false }, variant = BtnVariant.Outline)
                TButton("OK", { onChange(LocalTime.of(state.hour, state.minute)); open = false })
            },
        ) {
            TimePicker(
                state, Modifier.fillMaxWidth(),
                colors = TimePickerDefaults.colors(
                    clockDialColor = T.c.muted, selectorColor = T.c.primary,
                    timeSelectorSelectedContainerColor = T.c.primary, timeSelectorSelectedContentColor = T.c.onPrimary,
                    timeSelectorUnselectedContainerColor = T.c.muted, timeSelectorUnselectedContentColor = T.c.foreground,
                    clockDialSelectedContentColor = T.c.onPrimary, clockDialUnselectedContentColor = T.c.foreground,
                ),
            )
        }
    }
}

@Suppress("unused")
private val arrangement = Arrangement.Start
