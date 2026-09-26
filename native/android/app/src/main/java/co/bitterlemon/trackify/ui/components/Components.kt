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
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ErrorOutline
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
import co.bitterlemon.trackify.data.ConnectionStatus
import co.bitterlemon.trackify.ui.theme.T

val CardShape = RoundedCornerShape(12.dp)
val ControlShape = RoundedCornerShape(8.dp)

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
    val bg = background ?: T.c.card
    val shadowMod = if (!T.c.dark) Modifier.shadow(1.dp, CardShape, ambientColor = Color(0x1A000000), spotColor = Color(0x1A000000)) else Modifier
    Column(
        modifier
            .then(shadowMod)
            .clip(CardShape)
            .background(T.c.card)
            .background(bg)
            .border(borderWidth, border ?: T.c.border, CardShape)
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
    val c = T.c
    val (bg, fg) = when (variant) {
        BtnVariant.Default -> c.primary to c.onPrimary
        BtnVariant.Destructive -> c.destructive to c.onDestructive
        BtnVariant.Outline -> c.background to c.foreground
        BtnVariant.Secondary -> c.muted to c.foreground
        BtnVariant.Ghost -> Color.Transparent to c.foreground
        BtnVariant.DestructiveGhost -> Color.Transparent to c.destructive
    }
    val height = when (size) {
        BtnSize.Sm -> 32.dp
        BtnSize.Lg -> 44.dp
        BtnSize.Icon -> 36.dp
        BtnSize.Default -> 40.dp
    }
    val fontSize = if (size == BtnSize.Sm) 12.sp else 14.sp
    Row(
        modifier
            .heightIn(min = height)
            .then(if (size == BtnSize.Icon) Modifier.width(height) else Modifier)
            .alpha(if (enabled) 1f else 0.5f)
            .clip(ControlShape)
            .background(bg)
            .then(if (variant == BtnVariant.Outline) Modifier.border(1.dp, c.border, ControlShape) else Modifier)
            .clickable(enabled = enabled, role = Role.Button, onClickLabel = contentDescription ?: text, onClick = onClick)
            .padding(horizontal = if (size == BtnSize.Icon) 0.dp else if (size == BtnSize.Sm) 10.dp else 14.dp),
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, contentDescription = if (text == null) contentDescription else null, tint = fg, modifier = Modifier.size(16.dp))
            if (text != null) Spacer(Modifier.width(6.dp))
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
    val (bg, fg) = when (variant) {
        BadgeVariant.Default -> c.primary to c.onPrimary
        BadgeVariant.Secondary -> c.muted to c.foreground
        BadgeVariant.Outline -> Color.Transparent to c.foreground
        BadgeVariant.Destructive -> c.destructive to c.onDestructive
    }
    Text(
        text,
        modifier = modifier
            .clip(RoundedCornerShape(6.dp))
            .background(background ?: bg)
            .then(if (variant == BadgeVariant.Outline) Modifier.border(1.dp, c.border, RoundedCornerShape(6.dp)) else Modifier)
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
) {
    var focused by remember { mutableStateOf(false) }
    Column(modifier) {
        if (label != null) {
            Text(label, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
            Spacer(Modifier.height(6.dp))
        }
        BasicTextField(
            value = value,
            onValueChange = onValueChange,
            modifier = Modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused },
            singleLine = singleLine,
            minLines = minLines,
            maxLines = if (singleLine) 1 else 8,
            enabled = enabled,
            textStyle = TextStyle(fontSize = 15.sp, color = T.c.foreground),
            cursorBrush = SolidColor(T.c.foreground),
            visualTransformation = if (password) PasswordVisualTransformation() else VisualTransformation.None,
            keyboardOptions = KeyboardOptions(keyboardType = if (password) KeyboardType.Password else keyboardType, imeAction = imeAction),
            keyboardActions = KeyboardActions(onAny = { onIme?.invoke() }),
            decorationBox = { inner ->
                Row(
                    Modifier
                        .fillMaxWidth()
                        .heightIn(min = 44.dp)
                        .clip(ControlShape)
                        .background(T.c.background)
                        .border(1.dp, if (focused) T.c.foreground.copy(alpha = 0.35f) else T.c.border, ControlShape)
                        .padding(horizontal = 12.dp, vertical = 10.dp),
                    verticalAlignment = if (singleLine) Alignment.CenterVertically else Alignment.Top,
                ) {
                    Box(Modifier.weight(1f)) {
                        if (value.isEmpty() && placeholder != null) {
                            Text(placeholder, color = T.c.mutedForeground, fontSize = 15.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
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

/** Segmented control (web `Tabs`/toggle groups). */
@Composable
fun <K> Segmented(options: List<Pair<K, String>>, selected: K, onSelect: (K) -> Unit, modifier: Modifier = Modifier, compact: Boolean = false) {
    Row(
        modifier
            .clip(ControlShape)
            .background(T.c.muted)
            .padding(3.dp),
    ) {
        options.forEach { (key, label) ->
            val sel = key == selected
            Box(
                Modifier
                    .weight(1f)
                    .clip(RoundedCornerShape(6.dp))
                    .background(if (sel) T.c.card else Color.Transparent)
                    .then(if (sel && !T.c.dark) Modifier.border(0.5.dp, T.c.border, RoundedCornerShape(6.dp)) else Modifier)
                    .clickable(role = Role.Tab) { onSelect(key) }
                    .padding(vertical = if (compact) 5.dp else 7.dp, horizontal = 6.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label,
                    fontSize = if (compact) 12.sp else 13.sp,
                    fontWeight = if (sel) FontWeight.SemiBold else FontWeight.Medium,
                    color = if (sel) T.c.foreground else T.c.mutedForeground,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
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
            .clip(RoundedCornerShape(50))
            .background(if (selected) T.c.primary else T.c.card)
            .border(1.dp, if (selected) T.c.primary else T.c.border, RoundedCornerShape(50))
            .clickable(role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 12.dp, vertical = 6.dp),
        fontSize = 13.sp,
        fontWeight = FontWeight.Medium,
        color = if (selected) T.c.onPrimary else T.c.foreground,
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
            .border(1.dp, T.c.destructive.copy(alpha = 0.5f), ControlShape)
            .background(T.c.destructive.copy(alpha = 0.06f))
            .padding(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        Icon(Icons.Outlined.ErrorOutline, null, tint = T.c.destructive, modifier = Modifier.size(18.dp))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            Text(title, color = T.c.destructive, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
            if (!message.isNullOrBlank()) Text(message, color = T.c.destructive, fontSize = 13.sp)
        }
        if (onDismiss != null) {
            IconButton(onClick = onDismiss, modifier = Modifier.size(24.dp)) {
                Icon(Icons.Outlined.Close, "Dismiss", tint = T.c.destructive, modifier = Modifier.size(16.dp))
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
    Surface(modifier, color = T.c.card, shape = CardShape, border = BorderStroke(1.dp, T.c.border), content = content)
}
