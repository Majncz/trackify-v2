package co.bitterlemon.trackify.ui.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import co.bitterlemon.trackify.ui.theme.T

/** shadcn-style dialog: centred card, title, close X, content, right-aligned footer. */
@Composable
fun TDialog(
    title: String,
    onDismiss: () -> Unit,
    description: String? = null,
    maxWidth: Dp = 512.dp,
    dismissOnOutside: Boolean = true,
    scrollable: Boolean = true,
    footer: (@Composable RowScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val screenH = LocalConfiguration.current.screenHeightDp.dp
    Dialog(
        onDismissRequest = onDismiss,
        properties = DialogProperties(usePlatformDefaultWidth = false, dismissOnClickOutside = dismissOnOutside, decorFitsSystemWindows = false),
    ) {
        Column(
            Modifier
                .imePadding()
                .padding(horizontal = 14.dp, vertical = 24.dp)
                .widthIn(max = maxWidth)
                .fillMaxWidth()
                .heightIn(max = screenH - 48.dp)
                .shadow(16.dp, RoundedCornerShape(14.dp))
                .clip(RoundedCornerShape(14.dp))
                .background(T.c.card)
                .border(1.dp, T.c.border, RoundedCornerShape(14.dp)),
        ) {
            Row(Modifier.fillMaxWidth().padding(start = 20.dp, end = 8.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(title, fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground, modifier = Modifier.weight(1f).padding(top = 6.dp))
                IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, "Close", tint = T.c.mutedForeground, modifier = Modifier.size(18.dp)) }
            }
            if (description != null) {
                Text(description, fontSize = 14.sp, color = T.c.mutedForeground, modifier = Modifier.padding(horizontal = 20.dp))
            }
            Column(
                Modifier
                    .weight(1f, fill = false)
                    .then(if (scrollable) Modifier.verticalScroll(rememberScrollState()) else Modifier)
                    .padding(horizontal = 20.dp, vertical = 12.dp),
                content = content,
            )
            if (footer != null) {
                // FlowRow so the buttons wrap instead of truncating at large font sizes.
                androidx.compose.foundation.layout.FlowRow(
                    Modifier.fillMaxWidth().padding(start = 20.dp, end = 20.dp, bottom = 20.dp, top = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    itemVerticalAlignment = Alignment.CenterVertically,
                ) { footer(this) }
            } else Spacer(Modifier.height(8.dp))
        }
    }
}

/** Simple confirm dialog (web `confirm()` / AlertDialog). */
@Composable
fun ConfirmDialog(
    title: String,
    text: String,
    confirmLabel: String,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
    destructive: Boolean = true,
) {
    TDialog(
        title = title,
        onDismiss = onDismiss,
        maxWidth = 420.dp,
        footer = {
            TButton("Cancel", onDismiss, variant = BtnVariant.Outline)
            TButton(confirmLabel, { onConfirm(); onDismiss() }, variant = if (destructive) BtnVariant.Destructive else BtnVariant.Default)
        },
    ) {
        Text(text, fontSize = 14.sp, color = T.c.mutedForeground)
    }
}
