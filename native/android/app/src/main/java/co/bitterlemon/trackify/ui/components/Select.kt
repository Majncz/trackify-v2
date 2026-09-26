package co.bitterlemon.trackify.ui.components

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
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Check
import androidx.compose.material.icons.outlined.UnfoldMore
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.ui.theme.T

/** Select-style dropdown (web `<Select>`). */
@Composable
fun <K> TSelect(
    value: K,
    options: List<Pair<K, String>>,
    onChange: (K) -> Unit,
    modifier: Modifier = Modifier,
    label: String? = null,
    enabled: Boolean = true,
    compact: Boolean = false,
) {
    var open by remember { mutableStateOf(false) }
    Column(modifier) {
        if (label != null) {
            Text(label, fontSize = 12.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground)
            Spacer(Modifier.height(4.dp))
        }
        Box {
            Row(
                Modifier
                    .fillMaxWidth()
                    .heightIn(min = if (compact) 36.dp else 40.dp)
                    .clip(ControlShape)
                    .border(1.dp, T.c.border, ControlShape)
                    .background(T.c.background)
                    .clickable(enabled = enabled, role = Role.DropdownList, onClickLabel = label) { open = true }
                    .padding(horizontal = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    options.firstOrNull { it.first == value }?.second ?: "",
                    fontSize = if (compact) 13.sp else 14.sp, color = T.c.foreground, maxLines = 1,
                    overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
                )
                Icon(Icons.Outlined.UnfoldMore, null, tint = T.c.mutedForeground, modifier = Modifier.size(16.dp))
            }
            DropdownMenu(open, { open = false }, containerColor = T.c.card) {
                options.forEach { (k, l) ->
                    DropdownMenuItem(
                        text = { Text(l, fontSize = 14.sp, color = T.c.foreground) },
                        onClick = { open = false; onChange(k) },
                        trailingIcon = if (k == value) ({ Icon(Icons.Outlined.Check, null, tint = T.c.foreground, modifier = Modifier.size(16.dp)) }) else null,
                    )
                }
            }
        }
    }
}
