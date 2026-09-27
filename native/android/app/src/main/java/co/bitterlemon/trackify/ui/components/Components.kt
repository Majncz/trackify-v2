package co.bitterlemon.trackify.ui.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SegmentedButton
import co.bitterlemon.trackify.data.ConnectionStatus
import co.bitterlemon.trackify.ui.theme.T

val CardShape = RoundedCornerShape(16.dp)
val ControlShape = RoundedCornerShape(12.dp)
val PillShape = RoundedCornerShape(50)

@Composable
fun Wordmark(size: Int = 18, modifier: Modifier = Modifier) {
    Text(
        buildAnnotatedString {
            append("Trackify")
            withStyle(SpanStyle(color = T.c.green)) { append(".") }
        },
        modifier = modifier,
        fontSize = size.sp,
        fontWeight = FontWeight.Bold,
        color = T.c.foreground,
        letterSpacing = (-0.3).sp,
    )
}

@Composable
fun ConnectionDot(status: ConnectionStatus, modifier: Modifier = Modifier) {
    val color = when (status) {
        ConnectionStatus.Connected -> T.c.green
        ConnectionStatus.Reconnecting -> T.c.amber400
        ConnectionStatus.Disconnected -> T.c.red
    }
    val t = rememberInfiniteTransition(label = "dot")
    val pulse by t.animateFloat(1f, if (status == ConnectionStatus.Reconnecting) 1f else 0.7f, infiniteRepeatable(tween(1000), RepeatMode.Reverse), label = "p")
    val label = when (status) {
        ConnectionStatus.Connected -> "Connected"
        ConnectionStatus.Reconnecting -> "Reconnecting"
        ConnectionStatus.Disconnected -> "Disconnected"
    }
    Box(
        modifier
            .size(7.dp)
            .graphicsLayer { alpha = pulse; scaleX = 0.9f + 0.2f * pulse; scaleY = 0.9f + 0.2f * pulse }
            .clip(CircleShape)
            .background(color)
            .semantics { contentDescription = label }
    )
}

/** Card: rounded 12, 1 px border, card background, soft shadow (web `Card`). */
@Composable
fun TCard(
    modifier: Modifier = Modifier,
    border: Color? = null,
    background: Color? = null,
    borderWidth: Dp = 1.dp,
    padding: PaddingValues = PaddingValues(16.dp),
    onClick: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    // Material 3 filled card: a tonal surface, no hairline and no shadow (a border only when a caller asks for one).
    val bg = background ?: MaterialTheme.colorScheme.surfaceContainer
    Column(
        modifier
            .clip(CardShape)
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .background(bg)
            .then(if (border != null) Modifier.border(borderWidth, border, CardShape) else Modifier)
            .then(if (onClick != null) Modifier.clickable(onClick = onClick) else Modifier)
            .padding(padding),
        content = content,
    )
}

enum class BtnVariant { Default, Destructive, Outline, Secondary, Ghost, DestructiveGhost }
enum class BtnSize { Default, Sm, Lg, Icon }

@Composable
fun TButton(
    text: String?,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
    variant: BtnVariant = BtnVariant.Default,
    size: BtnSize = BtnSize.Default,
    icon: ImageVector? = null,
    enabled: Boolean = true,
    contentDescription: String? = null,
) {
    // Material 3 buttons: filled, filled tonal, outlined and text, all fully rounded.
    val cs = MaterialTheme.colorScheme
    val (bg, fg) = when (variant) {
        BtnVariant.Default -> cs.primary to cs.onPrimary
        BtnVariant.Destructive -> cs.error to cs.onError
        BtnVariant.Outline -> Color.Transparent to cs.primary
        BtnVariant.Secondary -> cs.secondaryContainer to cs.onSecondaryContainer
        BtnVariant.Ghost -> Color.Transparent to cs.primary
        BtnVariant.DestructiveGhost -> Color.Transparent to cs.error
    }
    val height = when (size) {
        BtnSize.Sm -> 32.dp
        BtnSize.Lg -> 48.dp
        BtnSize.Icon -> 40.dp
        BtnSize.Default -> 40.dp
    }
    val fontSize = if (size == BtnSize.Sm) 13.sp else 14.sp
    Row(
        modifier
            .heightIn(min = height)
            .then(if (size == BtnSize.Icon) Modifier.width(height) else Modifier)
            .alpha(if (enabled) 1f else 0.38f)
            .clip(PillShape)
            .background(bg)
            .then(if (variant == BtnVariant.Outline) Modifier.border(1.dp, cs.outline, PillShape) else Modifier)
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = contentDescription ?: text, onClick = onClick)
            .padding(horizontal = when {
                size == BtnSize.Icon -> 0.dp
                size == BtnSize.Sm -> 12.dp
                variant == BtnVariant.Ghost || variant == BtnVariant.DestructiveGhost -> 12.dp
                else -> 20.dp
            }),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = if (text == null) contentDescription else null, tint = fg, modifier = Modifier.size(18.dp))
            if (text != null) Spacer(Modifier.width(8.dp))
        }
        if (text != null) {
            Text(text, color = fg, fontSize = fontSize, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

enum class BadgeVariant { Default, Secondary, Outline, Destructive }

@Composable
fun TBadge(text: String, modifier: Modifier = Modifier, variant: BadgeVariant = BadgeVariant.Secondary, color: Color? = null, background: Color? = null, mono: Boolean = false) {
    val c = T.c
    val cs = MaterialTheme.colorScheme
    val (bg, fg) = when (variant) {
        BadgeVariant.Default -> cs.primary to cs.onPrimary
        BadgeVariant.Secondary -> cs.secondaryContainer to cs.onSecondaryContainer
        BadgeVariant.Outline -> Color.Transparent to cs.onSurfaceVariant
        BadgeVariant.Destructive -> cs.errorContainer to cs.onErrorContainer
    }
    Text(
        text,
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(background ?: bg)
            .then(if (variant == BadgeVariant.Outline) Modifier.border(1.dp, c.border, RoundedCornerShape(8.dp)) else Modifier)
            .padding(horizontal = 8.dp, vertical = 2.dp),
        color = color ?: fg,
        fontSize = 12.sp,
        fontWeight = FontWeight.SemiBold,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        style = if (mono) co.bitterlemon.trackify.ui.theme.MonoDigits else TextStyle.Default,
    )
}

@Composable
fun TInput(
    value: String,
    onValueChange: (String) -> Unit,
    modifier: Modifier = Modifier,
    placeholder: String? = null,
    label: String? = null,
    password: Boolean = false,
    keyboardType: KeyboardType = KeyboardType.Text,
    imeAction: ImeAction = ImeAction.Done,
    onIme: (() -> Unit)? = null,
    singleLine: Boolean = true,
    enabled: Boolean = true,
    minLines: Int = 1,
    trailing: @Composable (() -> Unit)? = null,
    suffix: String? = null,
    autoFocus: Boolean = false,
) {
    var focused by remember { mutableStateOf(false) }
    val requester = remember { androidx.compose.ui.focus.FocusRequester() }
    if (autoFocus) androidx.compose.runtime.LaunchedEffect(Unit) { kotlinx.coroutines.delay(150); runCatching { requester.requestFocus() } }
    Column(modifier) {
        if (label != null) {
            Text(label, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = T.c.mutedForeground)
            Spacer(Modifier.height(6.dp))
        }
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth().then(if (autoFocus) Modifier.focusRequester(requester) else Modifier).onFocusChanged { focused = it.isFocused },
            singleLine = singleLine,
            minLines = minLines,
            maxLines = if (singleLine) 1 else 8,
            enabled = enabled,
            textStyle = TextStyle(fontSize = 16.sp, color = T.c.foreground),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboardType, imeAction = imeAction),
            keyboardActions = KeyboardActions(onAny = { onIme?.invoke() }),
            decorationBox = { inner ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 52.dp)
                        .clip(ControlShape)
                        .background(MaterialTheme.colorScheme.surfaceContainerHighest)
                        .border(if (focused) 2.dp else 0.dp, if (focused) MaterialTheme.colorScheme.primary else Color.Transparent, ControlShape)
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = if (singleLine) Alignment.CenterVertically else Alignment.Top,
                ) {
                    Box(Modifier.weight(1f)) {
                        if (value.isEmpty() && placeholder != null) {
                            Text(placeholder, color = T.c.mutedForeground, fontSize = 16.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        }
                        inner()
                    }
                    if (suffix != null) {
                        Spacer(Modifier.width(6.dp)); Text(suffix, color = T.c.mutedForeground, fontSize = 14.sp)
                    }
                    if (trailing != null) trailing()
                }
            },
        )
    }
}

@Composable
fun PageHeader(title: String, subtitle: String?, modifier: Modifier = Modifier, actions: @Composable RowScope.() -> Unit = {}) {
    androidx.compose.foundation.layout.BoxWithConstraints(modifier.fillMaxWidth()) {
        val fontScale = androidx.compose.ui.platform.LocalDensity.current.fontScale
        // Large text or narrow widths: stack the action under the title instead of squeezing it.
        val stacked = fontScale > 1.25f || maxWidth < 340.dp
        if (stacked) {
            Column(Modifier.fillMaxWidth()) {
                Text(title, style = androidx.compose.material3.MaterialTheme.typography.headlineSmall, color = T.c.foreground)
                if (subtitle != null) Text(subtitle, fontSize = 14.sp, color = T.c.mutedForeground)
                Row(Modifier.padding(top = 10.dp), content = actions)
            }
        } else {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text(title, style = androidx.compose.material3.MaterialTheme.typography.headlineSmall, color = T.c.foreground)
                    if (subtitle != null) Text(subtitle, fontSize = 14.sp, color = T.c.mutedForeground)
                }
                actions()
            }
        }
    }
}

/** Caps text scaling for fixed chrome (bars, rails) so labels never wrap at 200 % font size. */
@Composable
fun CappedFontScale(max: Float = 1.3f, content: @Composable () -> Unit) {
    val d = androidx.compose.ui.platform.LocalDensity.current
    androidx.compose.runtime.CompositionLocalProvider(
        androidx.compose.ui.platform.LocalDensity provides androidx.compose.ui.unit.Density(d.density, minOf(d.fontScale, max)),
        content = content,
    )
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier = modifier, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
}

@Composable
fun Muted(text: String, modifier: Modifier = Modifier, size: Int = 13, maxLines: Int = Int.MAX_VALUE) {
    Text(text, modifier = modifier, fontSize = size.sp, color = T.c.mutedForeground, maxLines = maxLines, overflow = TextOverflow.Ellipsis)
}

/** Single-choice Material 3 segmented button row. */
@Composable
fun <K> Segmented(options: List<Pair<K, String>>, selected: K, onSelect: (K) -> Unit, modifier: Modifier = Modifier, compact: Boolean = false) {
    androidx.compose.material3.SingleChoiceSegmentedButtonRow(modifier) {
        options.forEachIndexed { i, (key, label) ->
            val sel = key == selected
            SegmentedButton(
                selected = sel,
                onClick = { onSelect(key) },
                shape = androidx.compose.material3.SegmentedButtonDefaults.itemShape(i, options.size),
                // The check mark only fits when there are few segments.
                icon = { if (options.size <= 3 && !compact) androidx.compose.material3.SegmentedButtonDefaults.Icon(sel) },
                contentPadding = PaddingValues(horizontal = if (options.size > 3 || compact) 4.dp else 12.dp),
                modifier = if (compact) Modifier.heightIn(min = 36.dp) else Modifier,
            ) {
                Text(label, fontSize = if (compact) 13.sp else 14.sp, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis)
            }
        }
    }
}

/** Pill chips row (range selectors). */
@Composable
fun Chip(label: String, selected: Boolean, onClick: () -> Unit, modifier: Modifier = Modifier) {
    Text(
        label,
        modifier = modifier
            .clip(RoundedCornerShape(8.dp))
            .background(if (selected) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent)
            .border(1.dp, if (selected) Color.Transparent else MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(8.dp))
            .clickable(role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 7.dp),
        fontSize = 14.sp,
        fontWeight = FontWeight.Medium,
        color = if (selected) MaterialTheme.colorScheme.onSecondaryContainer else MaterialTheme.colorScheme.onSurfaceVariant,
    )
}

@Composable
fun Skeleton(modifier: Modifier = Modifier) {
    val t = rememberInfiniteTransition(label = "sk")
    val a by t.animateFloat(0.10f, 0.05f, infiniteRepeatable(tween(900), RepeatMode.Reverse), label = "a")
    Box(modifier.clip(ControlShape).background(T.c.foreground.copy(alpha = a)))
}

@Composable
fun ErrorAlert(title: String, message: String?, onDismiss: (() -> Unit)? = null, modifier: Modifier = Modifier) {
    Row(
        modifier
            .fillMaxWidth()
            .clip(ControlShape)
            .background(MaterialTheme.colorScheme.errorContainer)
            .padding(14.dp),
        verticalAlignment = Alignment.Top,
    ) {
        val onErr = MaterialTheme.colorScheme.onErrorContainer
        Icon(Icons.Outlined.ErrorOutline, null, tint = onErr, modifier = Modifier.size(20.dp))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = onErr, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            if (!message.isNullOrBlank()) Text(message, color = onErr, fontSize = 14.sp)
        }
        if (onDismiss != null) {
            IconButton(onClick = onDismiss, modifier = Modifier.size(24.dp)) {
                Icon(Icons.Outlined.Close, "Dismiss", tint = onErr, modifier = Modifier.size(18.dp))
            }
        }
    }
}

@Composable
fun EmptyState(text: String, modifier: Modifier = Modifier) {
    Box(modifier.fillMaxWidth().padding(vertical = 24.dp), contentAlignment = Alignment.Center) {
        Text(text, color = T.c.mutedForeground, fontSize = 14.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

@Composable
fun AccentDot(color: Color, size: Dp = 8.dp, modifier: Modifier = Modifier) {
    Box(modifier.size(size).clip(CircleShape).background(color))
}

/** Group pill on task cards: accent border α .92, accent text, 10 px. */
@Composable
fun GroupPill(name: String, accent: Color, modifier: Modifier = Modifier) {
    Text(
        name,
        modifier = modifier
            .clip(RoundedCornerShape(12.dp))
            .border(1.dp, accent.copy(alpha = 0.92f), RoundedCornerShape(12.dp))
            .padding(horizontal = 7.dp, vertical = 1.dp),
        color = accent,
        fontSize = 10.sp,
        fontWeight = FontWeight.Medium,
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
    )
}

/** Detail/billing badge: accent text on accent @ 20 %. */
@Composable
fun AccentBadge(name: String, accent: Color, modifier: Modifier = Modifier) {
    TBadge(name, modifier, color = accent, background = accent.copy(alpha = 0.2f))
}

@Composable
fun Pulsing(active: Boolean, content: @Composable (Float) -> Unit) {
    if (!active) {
        content(1f); return
    }
    val t = rememberInfiniteTransition(label = "pending")
    val a by t.animateFloat(1f, 0.4f, infiniteRepeatable(tween(750), RepeatMode.Reverse), label = "pa")
    content(a)
}

@Composable
fun SurfaceBlock(modifier: Modifier = Modifier, content: @Composable () -> Unit) {
    Surface(modifier, color = MaterialTheme.colorScheme.surfaceContainer, shape = CardShape, content = content)
}

/** Plain top bar for every screen: optional back arrow, title, trailing actions. No subtitle, no hero. */
@Composable
fun ScreenBar(
    title: String?,
    onBack: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
) {
    CappedFontScale {
        Row(
            modifier.fillMaxWidth().height(64.dp).padding(start = if (onBack != null) 4.dp else 16.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (onBack != null) {
                IconButton(onClick = onBack) {
                    Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back", tint = T.c.foreground)
                }
                Spacer(Modifier.width(4.dp))
            }
            Text(
                title ?: "", fontSize = if (onBack != null) 22.sp else 24.sp, fontWeight = FontWeight.Normal, color = T.c.foreground,
                maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f),
            )
            actions()
        }
    }
}

/** Full-width list row (≥ 56 dp): optional leading icon, title + optional subtitle, optional trailing content. */
@Composable
fun ListRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    icon: ImageVector? = null,
    destructive: Boolean = false,
    onClick: (() -> Unit)? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null,
) {
    val color = if (destructive) T.c.destructive else T.c.foreground
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 56.dp)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, null, tint = if (destructive) T.c.destructive else T.c.mutedForeground, modifier = Modifier.size(24.dp))
            Spacer(Modifier.width(16.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 16.sp, color = color, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, fontSize = 13.sp, color = T.c.mutedForeground, maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        if (trailing != null) {
            Spacer(Modifier.width(12.dp))
            trailing()
        }
    }
}

/** Small section label above a group of rows. */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(
        text, modifier = modifier.fillMaxWidth().padding(start = 16.dp, end = 16.dp, top = 24.dp, bottom = 8.dp),
        fontSize = 14.sp, fontWeight = FontWeight.Medium, color = MaterialTheme.colorScheme.primary,
    )
}

/** Hairline between rows/sections. */
@Composable
fun RowDivider(modifier: Modifier = Modifier, inset: Dp = 0.dp) {
    androidx.compose.material3.HorizontalDivider(modifier.padding(start = inset), color = T.c.border)
}

/** Tonal number tile (Material 3 filled card): a label and a large tabular value. */
@Composable
fun StatTile(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier
            .clip(RoundedCornerShape(20.dp))
            .background(MaterialTheme.colorScheme.surfaceContainer)
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Text(label, fontSize = 14.sp, color = T.c.mutedForeground, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(4.dp))
        Text(
            value, fontSize = 26.sp, fontWeight = FontWeight.Medium, color = T.c.foreground, maxLines = 1,
            overflow = TextOverflow.Ellipsis, style = co.bitterlemon.trackify.ui.theme.Tabular,
        )
    }
}
