package co.bitterlemon.trackify.ui.home

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Schedule
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import co.bitterlemon.trackify.ui.components.ControlShape
import co.bitterlemon.trackify.ui.theme.MonoDigits
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.util.Format
import co.bitterlemon.trackify.util.SessionRange
import co.bitterlemon.trackify.util.Time
import java.time.Instant

/** Time button with hour/minute wheels (web `SessionStampField`). */
@Composable
fun SessionStampField(
    label: String,
    value: Long,
    min: Long,
    max: Long,
    now: Long,
    onChange: (Long) -> Unit,
    modifier: Modifier = Modifier,
    alignEnd: Boolean = false,
) {
    var open by remember { mutableStateOf(false) }
    var blocked by remember { mutableStateOf(false) }
    val z = Instant.ofEpochMilli(value).atZone(Time.zone())
    val hour = z.hour
    val minute = z.minute

    fun pick(h: Int, m: Int) {
        val next = SessionRange.resolveClock(value, h, m, min, max)
        onChange(next)
        val landed = Instant.ofEpochMilli(next).atZone(Time.zone())
        blocked = landed.hour != h || landed.minute != m
    }

    Column(modifier, horizontalAlignment = if (alignEnd) Alignment.End else Alignment.Start) {
        Text(label, fontSize = 14.sp, color = T.c.mutedForeground)
        Spacer(Modifier.height(4.dp))
        Box {
            Row(
                Modifier
                    .width(120.dp)
                    .heightIn(min = 40.dp)
                    .clip(ControlShape)
                    .border(1.dp, T.c.border, ControlShape)
                    .background(T.c.background)
                    .clickable(onClickLabel = "$label time") { open = !open }
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(Time.clock(value), style = MonoDigits, fontSize = 15.sp, color = T.c.foreground, modifier = Modifier.weight(1f))
                Icon(Icons.Outlined.Schedule, null, tint = T.c.mutedForeground, modifier = Modifier.size(15.dp))
            }
            if (open) {
                Popup(
                    alignment = if (alignEnd) Alignment.BottomEnd else Alignment.BottomStart,
                    offset = IntOffset(0, -140),
                    onDismissRequest = { open = false },
                    properties = PopupProperties(focusable = true),
                ) {
                    Row(
                        Modifier
                            .shadow(8.dp, ControlShape)
                            .clip(ControlShape)
                            .background(T.c.card)
                            .border(1.dp, T.c.border, ControlShape),
                    ) {
                        Wheel(24, hour) { pick(it, minute) }
                        Box(Modifier.width(1.dp).height(176.dp).background(T.c.border))
                        Wheel(60, minute) { pick(hour, it) }
                    }
                }
            }
        }
        Spacer(Modifier.height(4.dp))
        Text(
            if (blocked) "That time overlaps other work" else Format.agoLabel(value, now),
            fontSize = 13.sp,
            color = T.c.mutedForeground,
        )
    }
}

@Composable
private fun Wheel(count: Int, selected: Int, onPick: (Int) -> Unit) {
    val state = rememberLazyListState(initialFirstVisibleItemIndex = (selected - 2).coerceAtLeast(0))
    LaunchedEffect(selected) { state.animateScrollToItem((selected - 2).coerceAtLeast(0)) }
    LazyColumn(Modifier.width(60.dp).height(176.dp), state = state) {
        items((0 until count).toList()) { n ->
            val active = n == selected
            Box(
                Modifier
                    .fillMaxWidth()
                    .height(35.dp)
                    .background(if (active) T.c.primary else T.c.card)
                    .clickable { onPick(n) },
                contentAlignment = Alignment.Center,
            ) {
                Text(n.toString().padStart(2, '0'), style = MonoDigits, fontSize = 15.sp, color = if (active) T.c.onPrimary else T.c.foreground)
            }
        }
    }
}
