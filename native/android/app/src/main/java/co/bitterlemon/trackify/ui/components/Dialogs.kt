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
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.style.TextOverflow
import co.bitterlemon.trackify.ui.theme.T

/** True on phones (compact width): dialogs become bottom sheets. */
@Composable
fun isCompactWidth(): Boolean = LocalConfiguration.current.screenWidthDp < 600

/**
 * Trackify dialog. On phones it is a Material bottom sheet (drag handle, title, content, footer);
 * on tablets, or with [sheet] = false (confirmations, pickers), a centred card.
 */
@Composable
fun TDialog(
    title: String,
    onDismiss: () -> Unit,
    description: String? = null,
    maxWidth: Dp = 512.dp,
    dismissOnOutside: Boolean = true,
    scrollable: Boolean = true,
    sheet: Boolean = true,
    footer: (@Composable RowScope.() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    if (sheet && isCompactWidth()) {
        TSheet(title, onDismiss, description, scrollable, footer, content)
        return
    }
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
                .shadow(6.dp, RoundedCornerShape(28.dp))
                .clip(RoundedCornerShape(28.dp))
                .background(androidx.compose.material3.MaterialTheme.colorScheme.surfaceContainerHigh),
        ) {
            Row(Modifier.fillMaxWidth().padding(start = 24.dp, end = 8.dp, top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(title, fontSize = 24.sp, fontWeight = FontWeight.Normal, color = T.c.foreground, modifier = Modifier.weight(1f).padding(top = 6.dp))
                IconButton(onClick = onDismiss) { Icon(Icons.Outlined.Close, "Close", tint = T.c.mutedForeground, modifier = Modifier.size(18.dp)) }
            }
            if (description != null) {
                Text(description, fontSize = 14.sp, color = T.c.mutedForeground, modifier = Modifier.padding(horizontal = 24.dp))
            }
            Column(
                Modifier
                    .weight(1f, fill = false)
                    .then(if (scrollable) Modifier.verticalScroll(rememberScrollState()) else Modifier)
                    .padding(horizontal = 24.dp, vertical = 12.dp),
                content = content,
            )
            if (footer != null) {
                // FlowRow so the buttons wrap instead of truncating at large font sizes.
                androidx.compose.foundation.layout.FlowRow(
                    Modifier.fillMaxWidth().padding(start = 24.dp, end = 16.dp, bottom = 20.dp, top = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    itemVerticalAlignment = Alignment.CenterVertically,
                ) { footer(this) }
            } else Spacer(Modifier.height(8.dp))
        }
    }
}

@Composable
private fun TSheet(
    title: String,
    onDismiss: () -> Unit,
    description: String?,
    scrollable: Boolean,
    footer: (@Composable RowScope.() -> Unit)?,
    content: @Composable ColumnScope.() -> Unit,
) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = state,
        // Sheets holding sliders/lists (non-scrollable) must not steal horizontal drags.
        sheetGesturesEnabled = scrollable,
        containerColor = androidx.compose.material3.MaterialTheme.colorScheme.surfaceContainerLow,
        contentColor = T.c.foreground,
    ) {
        Column(Modifier.fillMaxWidth().imePadding()) {
            Text(title, fontSize = 22.sp, fontWeight = FontWeight.Normal, color = T.c.foreground, modifier = Modifier.padding(start = 24.dp, end = 24.dp))
            if (description != null) {
                Text(description, fontSize = 14.sp, color = T.c.mutedForeground, modifier = Modifier.padding(horizontal = 24.dp, vertical = 4.dp))
            }
            Column(
                Modifier
                    .weight(1f, fill = false)
                    .then(if (scrollable) Modifier.verticalScroll(rememberScrollState()) else Modifier)
                    .padding(horizontal = 24.dp, vertical = 16.dp),
                content = content,
            )
            if (footer != null) {
                androidx.compose.foundation.layout.FlowRow(
                    Modifier.fillMaxWidth().padding(start = 24.dp, end = 24.dp, bottom = 16.dp, top = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.End),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    itemVerticalAlignment = Alignment.CenterVertically,
                ) { footer(this) }
            } else Spacer(Modifier.height(16.dp))
        }
    }
}

/** Plain action sheet: a title and full-width rows (row menus). */
@Composable
fun ActionSheet(title: String?, onDismiss: () -> Unit, content: @Composable ColumnScope.() -> Unit) {
    val state = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = state,
        containerColor = androidx.compose.material3.MaterialTheme.colorScheme.surfaceContainerLow,
        contentColor = T.c.foreground,
    ) {
        Column(Modifier.fillMaxWidth().padding(bottom = 12.dp)) {
            if (title != null) {
                Text(title, fontSize = 16.sp, fontWeight = FontWeight.Medium, color = T.c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.padding(start = 24.dp, end = 24.dp, bottom = 8.dp))
            }
            content()
        }
    }
}

/** One row of an [ActionSheet]. */
@Composable
fun SheetAction(icon: ImageVector, label: String, onClick: () -> Unit, destructive: Boolean = false) {
    val color = if (destructive) T.c.destructive else T.c.foreground
    Row(
        Modifier.fillMaxWidth().heightIn(min = 56.dp).clickable(role = Role.Button, onClick = onClick).padding(horizontal = 24.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, null, tint = if (destructive) color else T.c.mutedForeground, modifier = Modifier.size(24.dp))
        Spacer(Modifier.width(16.dp))
        Text(label, fontSize = 16.sp, color = color)
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
        sheet = false,
        footer = {
            TButton("Cancel", onDismiss, variant = BtnVariant.Ghost)
            TButton(confirmLabel, { onConfirm(); onDismiss() }, variant = if (destructive) BtnVariant.DestructiveGhost else BtnVariant.Ghost)
        },
    ) {
        Text(text, fontSize = 14.sp, color = T.c.mutedForeground)
    }
}
