package co.bitterlemon.trackify.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.util.Accents

/** Trackify neutral tokens (NATIVE_SPEC §4). */
@Immutable
data class TColors(
    val dark: Boolean,
    val background: Color,
    val foreground: Color,
    val card: Color,
    val primary: Color,
    val onPrimary: Color,
    val muted: Color,
    val mutedForeground: Color,
    val border: Color,
    val destructive: Color,
    val onDestructive: Color,
    val emerald: Color = Color(0xFF10B981),
    val green: Color = Color(0xFF22C55E),
    val amber: Color = Color(0xFFF59E0B),
    val amber400: Color = Color(0xFFFBBF24),
    val red: Color = Color(0xFFEF4444),
    val blue: Color = Color(0xFF3B82F6),
    val yellowRing: Color = Color(0xFFEAB308),
    /** Busy blocks on the session slider (neutral-400 @ 70 %). */
    val busy: Color = Color(0xB3A3A3A3),
    val raceStage: Color,
)

val LightColors = TColors(
    dark = false,
    background = Color(0xFFFFFFFF),
    foreground = Color(0xFF0A0A0A),
    card = Color(0xFFFFFFFF),
    primary = Color(0xFF171717),
    onPrimary = Color(0xFFFAFAFA),
    muted = Color(0xFFF5F5F5),
    mutedForeground = Color(0xFF737373),
    border = Color(0xFFE5E5E5),
    destructive = Color(0xFFEF4444),
    onDestructive = Color(0xFFFAFAFA),
    raceStage = Color(0xFFF7F7F5),
)

val DarkColors = TColors(
    dark = true,
    background = Color(0xFF0A0A0A),
    foreground = Color(0xFFFAFAFA),
    card = Color(0xFF111111),
    primary = Color(0xFFFAFAFA),
    onPrimary = Color(0xFF171717),
    muted = Color(0xFF262626),
    mutedForeground = Color(0xFFA3A3A3),
    border = Color(0xFF262626),
    destructive = Color(0xFFEF4444),
    onDestructive = Color(0xFFFAFAFA),
    raceStage = Color(0xFF161616),
)

val LocalTColors = staticCompositionLocalOf { LightColors }

object T {
    val c: TColors @Composable get() = LocalTColors.current
}

/** Monospaced digits (web: font-mono + tabular-nums). */
val Mono = FontFamily.Monospace

fun hexColor(hex: String?, fallback: Color = Color(0xFF6B7280)): Color {
    val v = hex?.let { Accents.parseHex(it) } ?: return fallback
    return Color(0xFF000000.toInt() or v)
}

@Composable
fun TrackifyTheme(themePref: String = "system", content: @Composable () -> Unit) {
    val dark = when (themePref) {
        "dark" -> true
        "light" -> false
        else -> isSystemInDarkTheme()
    }
    val c = if (dark) DarkColors else LightColors
    val scheme = if (dark) darkColorScheme(
        primary = c.primary, onPrimary = c.onPrimary,
        secondary = c.muted, onSecondary = c.foreground,
        background = c.background, onBackground = c.foreground,
        surface = c.card, onSurface = c.foreground,
        surfaceVariant = c.muted, onSurfaceVariant = c.mutedForeground,
        surfaceContainer = c.card, surfaceContainerHigh = Color(0xFF171717), surfaceContainerHighest = c.muted,
        surfaceContainerLow = c.card, surfaceContainerLowest = c.background,
        outline = c.border, outlineVariant = c.border,
        error = c.destructive, onError = c.onDestructive,
        primaryContainer = c.muted, onPrimaryContainer = c.foreground,
        secondaryContainer = c.muted, onSecondaryContainer = c.foreground,
        inverseSurface = c.foreground, inverseOnSurface = c.background,
        surfaceTint = Color.Transparent,
    ) else lightColorScheme(
        primary = c.primary, onPrimary = c.onPrimary,
        secondary = c.muted, onSecondary = c.foreground,
        background = c.background, onBackground = c.foreground,
        surface = c.card, onSurface = c.foreground,
        surfaceVariant = c.muted, onSurfaceVariant = c.mutedForeground,
        surfaceContainer = c.card, surfaceContainerHigh = c.card, surfaceContainerHighest = c.muted,
        surfaceContainerLow = c.card, surfaceContainerLowest = c.background,
        outline = c.border, outlineVariant = c.border,
        error = c.destructive, onError = c.onDestructive,
        primaryContainer = c.muted, onPrimaryContainer = c.foreground,
        secondaryContainer = c.muted, onSecondaryContainer = c.foreground,
        inverseSurface = c.foreground, inverseOnSurface = c.background,
        surfaceTint = Color.Transparent,
    )
    val base = Typography()
    val typography = Typography(
        headlineSmall = base.headlineSmall.copy(fontWeight = FontWeight.Bold, fontSize = 24.sp, letterSpacing = (-0.3).sp),
        titleLarge = base.titleLarge.copy(fontWeight = FontWeight.Bold, fontSize = 22.sp, letterSpacing = (-0.3).sp),
        titleMedium = base.titleMedium.copy(fontWeight = FontWeight.SemiBold, fontSize = 16.sp),
        titleSmall = base.titleSmall.copy(fontWeight = FontWeight.Medium, fontSize = 14.sp),
        bodyLarge = base.bodyLarge.copy(fontSize = 16.sp),
        bodyMedium = base.bodyMedium.copy(fontSize = 14.sp),
        bodySmall = base.bodySmall.copy(fontSize = 12.sp),
        labelLarge = base.labelLarge.copy(fontSize = 14.sp, fontWeight = FontWeight.Medium),
        labelMedium = base.labelMedium.copy(fontSize = 12.sp, fontWeight = FontWeight.Medium),
        labelSmall = base.labelSmall.copy(fontSize = 11.sp),
    )
    CompositionLocalProvider(LocalTColors provides c) {
        MaterialTheme(colorScheme = scheme, typography = typography, content = content)
    }
}

val MonoDigits = TextStyle(fontFeatureSettings = "tnum")
val Tabular = TextStyle(fontFeatureSettings = "tnum")
