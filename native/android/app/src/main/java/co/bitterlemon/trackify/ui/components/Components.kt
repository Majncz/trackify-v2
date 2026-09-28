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
import androidx.compose.foundation.layout.widthIn
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
import androidx.compose.ui.semantics.heading
import androidx.compose.foundation.selection.selectable
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
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

val CardShape = RoundedCornerShape(22.dp)
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
    // iOS grouped section: a white (dark: grey) rounded block on the grouped background, no hairline, no shadow.
    val bg = background ?: T.c.cell
    Column(
        modifier
            .clip(CardShape)
            .background(T.c.cell)
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
    // iOS-like capsule buttons: prominent (label colour), grey bordered, plain text.
    val cs = MaterialTheme.colorScheme
    val (bg, fg) = when (variant) {
        BtnVariant.Default -> cs.primary to cs.onPrimary
        BtnVariant.Destructive -> T.c.stop to Color.White
        BtnVariant.Outline -> T.c.fill to cs.onSurface
        BtnVariant.Secondary -> T.c.fill to cs.onSurface
        BtnVariant.Ghost -> Color.Transparent to cs.onSurface
        BtnVariant.DestructiveGhost -> Color.Transparent to cs.error
    }
    val height = when (size) {
        BtnSize.Sm -> 32.dp
        BtnSize.Lg -> 48.dp
        BtnSize.Icon -> 40.dp
        BtnSize.Default -> 40.dp
    }
    val fontSize = if (size == BtnSize.Sm) 14.sp else 15.sp
    Row(
        modifier
            .heightIn(min = height)
            .then(if (size == BtnSize.Icon) Modifier.width(height) else Modifier)
            .alpha(if (enabled) 1f else 0.38f)
            .clip(PillShape)
            .background(bg)
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
            Text(text, color = fg, fontSize = fontSize, fontWeight = FontWeight.SemiBold, maxLines = 1, overflow = TextOverflow.Ellipsis)
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
        BadgeVariant.Secondary -> T.c.fill to cs.onSurface
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
            textStyle = TextStyle(fontSize = 17.sp, color = T.c.foreground),
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
                        .background(T.c.fill)
                        .border(if (focused) 1.5.dp else 0.dp, if (focused) MaterialTheme.colorScheme.outline else Color.Transparent, ControlShape)
                        .padding(horizontal = 16.dp, vertical = 12.dp),
                    verticalAlignment = if (singleLine) Alignment.CenterVertically else Alignment.Top,
                ) {
                    Box(Modifier.weight(1f)) {
                        if (value.isEmpty() && placeholder != null) {
                            Text(placeholder, color = T.c.mutedForeground, fontSize = 17.sp, maxLines = 1, overflow = TextOverflow.Ellipsis)
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

/** iOS-style segmented control: a grey capsule track with a raised white (dark: grey) thumb on the selection. */
@Composable
fun <K> Segmented(options: List<Pair<K, String>>, selected: K, onSelect: (K) -> Unit, modifier: Modifier = Modifier, compact: Boolean = false) {
    val c = T.c
    val thumb = if (c.dark) Color(0xFF636366) else Color.White
    Row(
        modifier
            .heightIn(min = if (compact) 34.dp else 38.dp)
            .clip(PillShape)
            .background(if (c.dark) Color(0xFF2C2C2E) else Color(0xFFE9E9EE))
            .padding(3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        options.forEach { (key, label) ->
            val sel = key == selected
            Box(
                Modifier
                    .weight(1f)
                    .heightIn(min = if (compact) 28.dp else 32.dp)
                    .then(if (sel) Modifier.shadow(if (c.dark) 0.dp else 2.dp, PillShape, clip = false) else Modifier)
                    .clip(PillShape)
                    .background(if (sel) thumb else Color.Transparent)
                    .selectable(sel, role = Role.Tab, onClick = { onSelect(key) })
                    .padding(horizontal = 6.dp),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    label, fontSize = if (compact) 14.sp else 15.sp, fontWeight = if (sel) FontWeight.SemiBold else FontWeight.Medium,
                    color = c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis,
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
            .clip(PillShape)
            .background(if (selected) T.c.foreground else T.c.fill)
            .clickable(role = Role.RadioButton, onClick = onClick)
            .padding(horizontal = 14.dp, vertical = 7.dp),
        fontSize = 15.sp,
        fontWeight = FontWeight.Medium,
        color = if (selected) T.c.plain else T.c.foreground,
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
    Surface(modifier, color = T.c.cell, shape = CardShape, content = content)
}

/**
 * Top bar for every screen, iOS-like: the title centred in 17 sp semibold, the Android back arrow on the left and
 * trailing actions on the right. The title stays centred on the screen while it fits between the two sides.
 */
@Composable
fun ScreenBar(
    title: String?,
    onBack: (() -> Unit)? = null,
    modifier: Modifier = Modifier,
    actions: @Composable RowScope.() -> Unit = {},
) {
    CappedFontScale {
        androidx.compose.ui.layout.Layout(
            content = {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    if (onBack != null) {
                        IconButton(onClick = onBack) {
                            Icon(Icons.AutoMirrored.Outlined.ArrowBack, "Back", tint = T.c.foreground)
                        }
                    }
                }
                Text(
                    title ?: "", fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground,
                    maxLines = 1, overflow = TextOverflow.Ellipsis, textAlign = androidx.compose.ui.text.style.TextAlign.Center,
                    modifier = Modifier.semantics { heading() },
                )
                Row(verticalAlignment = Alignment.CenterVertically, content = actions)
            },
            modifier = modifier.fillMaxWidth().height(56.dp).padding(horizontal = 4.dp),
        ) { m, cons ->
            val w = cons.maxWidth
            val h = cons.maxHeight
            val loose = cons.copy(minWidth = 0, minHeight = 0)
            val lead = m[0].measure(loose)
            val trail = m[2].measure(loose.copy(maxWidth = (w - lead.width).coerceAtLeast(0)))
            val gap = 8.dp.roundToPx()
            val side = maxOf(lead.width, trail.width, 12.dp.roundToPx())
            val centredWidth = w - 2 * side - 2 * gap
            val titleCentred = centredWidth > 48.dp.roundToPx()
            val titleMax = if (titleCentred) centredWidth else (w - lead.width - trail.width - 2 * gap).coerceAtLeast(0)
            val tp = m[1].measure(loose.copy(maxWidth = titleMax))
            layout(w, h) {
                lead.place(0, (h - lead.height) / 2)
                trail.place(w - trail.width, (h - trail.height) / 2)
                val tx = if (titleCentred) (w - tp.width) / 2 else lead.width + gap
                tp.place(tx, (h - tp.height) / 2)
            }
        }
    }
}

/**
 * Grouped-list row (iOS `insetGrouped` cell): optional leading icon, title + optional subtitle, then an optional
 * muted [value], custom [trailing] content and a [chevron]. Put it inside a [Section].
 */
@Composable
fun ListRow(
    title: String,
    modifier: Modifier = Modifier,
    subtitle: String? = null,
    icon: ImageVector? = null,
    destructive: Boolean = false,
    value: String? = null,
    chevron: Boolean = false,
    onClick: (() -> Unit)? = null,
    trailing: (@Composable RowScope.() -> Unit)? = null,
) {
    val color = if (destructive) T.c.destructive else T.c.foreground
    Row(
        modifier
            .fillMaxWidth()
            .heightIn(min = 52.dp)
            .then(if (onClick != null) Modifier.clickable(role = Role.Button, onClick = onClick) else Modifier)
            .padding(horizontal = 16.dp, vertical = 11.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        if (icon != null) {
            Icon(icon, null, tint = if (destructive) T.c.destructive else T.c.foreground, modifier = Modifier.size(24.dp))
            Spacer(Modifier.width(16.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(title, fontSize = 17.sp, color = color, maxLines = 2, overflow = TextOverflow.Ellipsis)
            if (subtitle != null) Text(subtitle, fontSize = 14.sp, color = T.c.mutedForeground, maxLines = 3, overflow = TextOverflow.Ellipsis)
        }
        if (value != null) {
            Spacer(Modifier.width(12.dp))
            Text(
                value, fontSize = 17.sp, color = T.c.mutedForeground, maxLines = 1, overflow = TextOverflow.Ellipsis,
                style = co.bitterlemon.trackify.ui.theme.Tabular, modifier = Modifier.widthIn(max = 230.dp),
                textAlign = androidx.compose.ui.text.style.TextAlign.End,
            )
        }
        if (trailing != null) {
            Spacer(Modifier.width(12.dp))
            trailing()
        }
        if (chevron) {
            Spacer(Modifier.width(6.dp))
            Chevron()
        }
    }
}

/** Trailing disclosure chevron (iOS `>`), quiet grey. */
@Composable
fun Chevron() {
    Icon(
        Icons.AutoMirrored.Outlined.KeyboardArrowRight, null,
        tint = if (T.c.dark) Color(0xFF5A5A5F) else Color(0xFFBDBDC2), modifier = Modifier.size(24.dp),
    )
}

/** Grey section header above a grouped section (iOS 26 style: sentence case, semibold, secondary label). */
@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier, trailing: String? = null) {
    Row(
        modifier.fillMaxWidth().padding(start = 32.dp, end = 32.dp, top = 22.dp, bottom = 8.dp),
        verticalAlignment = Alignment.Bottom,
    ) {
        Text(
            text, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = T.c.mutedForeground,
            modifier = Modifier.weight(1f).semantics { heading() }, maxLines = 2, overflow = TextOverflow.Ellipsis,
        )
        if (trailing != null) {
            Text(trailing, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, color = T.c.mutedForeground, style = co.bitterlemon.trackify.ui.theme.Tabular)
        }
    }
}

/** Small grey note under a grouped section. */
@Composable
fun SectionFooter(text: String, modifier: Modifier = Modifier) {
    Text(
        text, modifier = modifier.fillMaxWidth().padding(start = 32.dp, end = 32.dp, top = 8.dp),
        fontSize = 14.sp, color = T.c.mutedForeground,
    )
}

/**
 * iOS `insetGrouped` section: optional grey [header], a rounded white (dark: grey) block 16 dp from the edges with
 * the [content] rows, optional [footer]. Separate rows with [SectionDivider].
 */
@Composable
fun Section(
    modifier: Modifier = Modifier,
    header: String? = null,
    headerTrailing: String? = null,
    footer: String? = null,
    topGap: Dp = 20.dp,
    content: @Composable ColumnScope.() -> Unit,
) {
    Column(modifier.fillMaxWidth()) {
        if (header != null) SectionLabel(header, trailing = headerTrailing) else Spacer(Modifier.height(topGap))
        Column(
            Modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(CardShape).background(T.c.cell),
            content = content,
        )
        if (footer != null) SectionFooter(footer)
    }
}

/** Inset hairline between rows of a [Section]: 16 dp for text rows, 56 dp after a leading icon. */
@Composable
fun SectionDivider(icon: Boolean = false) {
    androidx.compose.material3.HorizontalDivider(
        Modifier.padding(start = if (icon) 56.dp else 16.dp, end = 16.dp), thickness = 0.8.dp, color = T.c.separator,
    )
}

/**
 * One row of a grouped section inside a lazy list: 16 dp from the edges, the cell colour, rounded outer corners on
 * the [first] and [last] rows and an inset hairline above every row but the first.
 */
@Composable
fun GroupedItem(
    first: Boolean,
    last: Boolean,
    modifier: Modifier = Modifier,
    dividerInset: Dp = 16.dp,
    background: Color? = null,
    content: @Composable ColumnScope.() -> Unit,
) {
    val r = 22.dp
    val shape = RoundedCornerShape(
        topStart = if (first) r else 0.dp, topEnd = if (first) r else 0.dp,
        bottomStart = if (last) r else 0.dp, bottomEnd = if (last) r else 0.dp,
    )
    Column(modifier.fillMaxWidth().padding(horizontal = 16.dp).clip(shape).background(T.c.cell).background(background ?: Color.Transparent)) {
        if (!first) androidx.compose.material3.HorizontalDivider(
            Modifier.padding(start = dividerInset, end = 16.dp), thickness = 0.8.dp, color = T.c.separator,
        )
        content()
    }
}

/** Hairline between rows/sections. */
@Composable
fun RowDivider(modifier: Modifier = Modifier, inset: Dp = 0.dp) {
    androidx.compose.material3.HorizontalDivider(modifier.padding(start = inset), thickness = 0.8.dp, color = T.c.separator)
}

/** Tonal number tile (Material 3 filled card): a label and a large tabular value. */
@Composable
fun StatTile(label: String, value: String, modifier: Modifier = Modifier) {
    Column(
        modifier
            .clip(CardShape)
            .background(T.c.cell)
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Text(label, fontSize = 15.sp, color = T.c.mutedForeground, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Spacer(Modifier.height(2.dp))
        Text(
            value, fontSize = 26.sp, fontWeight = FontWeight.Bold, color = T.c.foreground, maxLines = 1,
            overflow = TextOverflow.Ellipsis, style = co.bitterlemon.trackify.ui.theme.Tabular,
        )
    }
}
