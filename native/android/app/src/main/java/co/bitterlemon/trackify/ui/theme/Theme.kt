package co.bitterlemon.trackify.ui.theme

import android.app.Activity
import android.content.Context
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import android.os.Build
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.dynamicDarkColorScheme
import androidx.compose.material3.dynamicLightColorScheme
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
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

/** Trackify tokens, derived from the Material 3 scheme (see [tokensFor]). */
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
    /** iOS-style roles: plain screen background (Timer), grouped cell, grey fill (search field, idle play circle). */
    val plain: Color = background,
    val cell: Color = card,
    val fill: Color = muted,
    val separator: Color = border,
    /** Soft green behind the running row. */
    val runningRow: Color = Color(0xFFE8F6EF),
    val stop: Color = Color(0xFFEF4444),
)

val LocalTColors = staticCompositionLocalOf { tokensFor(BrandLight, false) }

object T {
    val c: TColors @Composable get() = LocalTColors.current
}

/** Monospaced digits (web: font-mono + tabular-nums). */
val Mono = FontFamily.Monospace

fun hexColor(hex: String?, fallback: Color = Color(0xFF6B7280)): Color {
    val v = hex?.let { Accents.parseHex(it) } ?: return fallback
    return Color(0xFF000000.toInt() or v)
}

/**
 * Fallback Material 3 scheme (Android 8–11, where there is no wallpaper colour): tonal palette generated from the
 * Trackify green. On Android 12+ the app uses the wallpaper's dynamic scheme instead.
 */
val BrandLight = lightColorScheme(
    primary = Color(0xFF386A20), onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFB8F397), onPrimaryContainer = Color(0xFF042100),
    secondary = Color(0xFF55624C), onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFD9E7CB), onSecondaryContainer = Color(0xFF131F0D),
    tertiary = Color(0xFF386666), onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFBBEBEB), onTertiaryContainer = Color(0xFF002020),
    error = Color(0xFFBA1A1A), onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFFDAD6), onErrorContainer = Color(0xFF410002),
    background = Color(0xFFF9FAF1), onBackground = Color(0xFF1A1C18),
    surface = Color(0xFFF9FAF1), onSurface = Color(0xFF1A1C18),
    surfaceVariant = Color(0xFFDFE4D7), onSurfaceVariant = Color(0xFF43483E),
    outline = Color(0xFF73796D), outlineVariant = Color(0xFFC3C8BB),
    inverseSurface = Color(0xFF2F312D), inverseOnSurface = Color(0xFFF1F1EA), inversePrimary = Color(0xFF9DD67D),
    surfaceDim = Color(0xFFD9DBD2), surfaceBright = Color(0xFFF9FAF1),
    surfaceContainerLowest = Color(0xFFFFFFFF), surfaceContainerLow = Color(0xFFF3F4EC),
    surfaceContainer = Color(0xFFEDEFE6), surfaceContainerHigh = Color(0xFFE7E9E0), surfaceContainerHighest = Color(0xFFE1E3DA),
)

val BrandDark = darkColorScheme(
    primary = Color(0xFF9DD67D), onPrimary = Color(0xFF0C3900),
    primaryContainer = Color(0xFF205107), onPrimaryContainer = Color(0xFFB8F397),
    secondary = Color(0xFFBDCBAF), onSecondary = Color(0xFF283420),
    secondaryContainer = Color(0xFF3E4A35), onSecondaryContainer = Color(0xFFD9E7CB),
    tertiary = Color(0xFFA0CFCF), onTertiary = Color(0xFF003737),
    tertiaryContainer = Color(0xFF1E4E4E), onTertiaryContainer = Color(0xFFBBEBEB),
    error = Color(0xFFFFB4AB), onError = Color(0xFF690005),
    errorContainer = Color(0xFF93000A), onErrorContainer = Color(0xFFFFDAD6),
    background = Color(0xFF11140F), onBackground = Color(0xFFE1E4D9),
    surface = Color(0xFF11140F), onSurface = Color(0xFFE1E4D9),
    surfaceVariant = Color(0xFF43483E), onSurfaceVariant = Color(0xFFC3C8BB),
    outline = Color(0xFF8D9286), outlineVariant = Color(0xFF43483E),
    inverseSurface = Color(0xFFE1E4D9), inverseOnSurface = Color(0xFF2F312D), inversePrimary = Color(0xFF386A20),
    surfaceDim = Color(0xFF11140F), surfaceBright = Color(0xFF373A34),
    surfaceContainerLowest = Color(0xFF0C0F0A), surfaceContainerLow = Color(0xFF191D17),
    surfaceContainer = Color(0xFF1D211B), surfaceContainerHigh = Color(0xFF282B25), surfaceContainerHighest = Color(0xFF33362F),
)

/**
 * The app's own scheme: neutral and calm like the iOS app (system grouped grey with white sections in light mode,
 * true black with dark grey sections in dark mode). Colour comes only from task colours, the green running
 * highlight and the red Stop. No wallpaper colours in the app (widgets keep [trackifyColorScheme]).
 */
val AppLight = lightColorScheme(
    primary = Color(0xFF111111), onPrimary = Color(0xFFFFFFFF),
    primaryContainer = Color(0xFFEDEDF0), onPrimaryContainer = Color(0xFF111111),
    secondary = Color(0xFF6E6E73), onSecondary = Color(0xFFFFFFFF),
    secondaryContainer = Color(0xFFE5E5EA), onSecondaryContainer = Color(0xFF111111),
    tertiary = Color(0xFF16A34A), onTertiary = Color(0xFFFFFFFF),
    tertiaryContainer = Color(0xFFE8F6EF), onTertiaryContainer = Color(0xFF14532D),
    error = Color(0xFFE5383B), onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFFFDECEC), onErrorContainer = Color(0xFFB42318),
    background = Color(0xFFF2F2F7), onBackground = Color(0xFF000000),
    surface = Color(0xFFF2F2F7), onSurface = Color(0xFF000000),
    surfaceVariant = Color(0xFFE5E5EA), onSurfaceVariant = Color(0xFF76767B),
    surfaceTint = Color.Transparent,
    outline = Color(0xFFC7C7CC), outlineVariant = Color(0xFFDCDCE0),
    inverseSurface = Color(0xFF1C1C1E), inverseOnSurface = Color(0xFFFFFFFF), inversePrimary = Color(0xFFFFFFFF),
    surfaceDim = Color(0xFFE5E5EA), surfaceBright = Color(0xFFFFFFFF),
    surfaceContainerLowest = Color(0xFFFFFFFF), surfaceContainerLow = Color(0xFFFFFFFF),
    surfaceContainer = Color(0xFFFFFFFF), surfaceContainerHigh = Color(0xFFFFFFFF), surfaceContainerHighest = Color(0xFFEFEFF2),
    scrim = Color(0xFF000000),
)

val AppDark = darkColorScheme(
    primary = Color(0xFFFFFFFF), onPrimary = Color(0xFF000000),
    primaryContainer = Color(0xFF2C2C2E), onPrimaryContainer = Color(0xFFFFFFFF),
    secondary = Color(0xFF98989F), onSecondary = Color(0xFF000000),
    secondaryContainer = Color(0xFF3A3A3C), onSecondaryContainer = Color(0xFFFFFFFF),
    tertiary = Color(0xFF4ADE80), onTertiary = Color(0xFF000000),
    tertiaryContainer = Color(0xFF12291C), onTertiaryContainer = Color(0xFFBBF7D0),
    error = Color(0xFFFF5A52), onError = Color(0xFFFFFFFF),
    errorContainer = Color(0xFF3A1614), onErrorContainer = Color(0xFFFFB4AB),
    background = Color(0xFF000000), onBackground = Color(0xFFFFFFFF),
    surface = Color(0xFF000000), onSurface = Color(0xFFFFFFFF),
    surfaceVariant = Color(0xFF2C2C2E), onSurfaceVariant = Color(0xFF9D9DA3),
    surfaceTint = Color.Transparent,
    outline = Color(0xFF545458), outlineVariant = Color(0xFF38383A),
    inverseSurface = Color(0xFFF2F2F7), inverseOnSurface = Color(0xFF000000), inversePrimary = Color(0xFF111111),
    surfaceDim = Color(0xFF000000), surfaceBright = Color(0xFF2C2C2E),
    surfaceContainerLowest = Color(0xFF000000), surfaceContainerLow = Color(0xFF1C1C1E),
    surfaceContainer = Color(0xFF1C1C1E), surfaceContainerHigh = Color(0xFF2C2C2E), surfaceContainerHighest = Color(0xFF2C2C2E),
    scrim = Color(0xFF000000),
)

/** The widgets' colour scheme: wallpaper colours on Android 12+, the Trackify green palette before that. */
fun trackifyColorScheme(context: Context, dark: Boolean): ColorScheme = when {
    Build.VERSION.SDK_INT >= 31 -> if (dark) dynamicDarkColorScheme(context) else dynamicLightColorScheme(context)
    else -> if (dark) BrandDark else BrandLight
}

/** Legacy token names used across the screens, mapped onto Material 3 roles. */
fun tokensFor(s: ColorScheme, dark: Boolean) = TColors(
    dark = dark,
    background = s.surface,
    foreground = s.onSurface,
    card = s.surfaceContainer,
    primary = s.primary,
    onPrimary = s.onPrimary,
    muted = s.surfaceContainerHighest,
    mutedForeground = s.onSurfaceVariant,
    border = s.outlineVariant,
    destructive = s.error,
    onDestructive = s.onError,
    raceStage = s.surfaceContainer,
    plain = if (dark) Color(0xFF000000) else Color(0xFFFFFFFF),
    cell = s.surfaceContainer,
    fill = if (dark) Color(0xFF2A2A2C) else Color(0xFFF2F2F4),
    separator = s.outlineVariant,
    runningRow = if (dark) Color(0xFF0A2219) else Color(0xFFE7F8F1),
    stop = Color(0xFFEF4444),
)

/** Type scale close to the iOS text styles (body 17, subheadline 15, footnote 13, title 3 20, large title 34). */
private val AppTypography = Typography().let { t ->
    t.copy(
        headlineSmall = t.headlineSmall.copy(fontWeight = FontWeight.Bold, fontSize = 24.sp),
        titleLarge = t.titleLarge.copy(fontWeight = FontWeight.SemiBold, fontSize = 20.sp),
        titleMedium = t.titleMedium.copy(fontWeight = FontWeight.SemiBold, fontSize = 17.sp),
        bodyLarge = t.bodyLarge.copy(fontSize = 17.sp, letterSpacing = 0.sp),
        bodyMedium = t.bodyMedium.copy(fontSize = 15.sp, letterSpacing = 0.sp),
        labelLarge = t.labelLarge.copy(fontSize = 15.sp, fontWeight = FontWeight.SemiBold, letterSpacing = 0.sp),
    )
}

@Composable
fun isAppDark(themePref: String): Boolean = when (themePref) {
    "dark" -> true
    "light" -> false
    else -> isSystemInDarkTheme()
}

@Composable
fun TrackifyTheme(themePref: String = "system", content: @Composable () -> Unit) {
    val dark = isAppDark(themePref)
    val scheme = if (dark) AppDark else AppLight
    val c = remember(dark) { tokensFor(scheme, dark) }
    // Status/navigation bar icons follow the app's own appearance, not the system's: with the app in Light on a
    // dark phone (or the reverse) the clock and battery would otherwise vanish (white on white).
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as? Activity)?.window ?: return@SideEffect
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !dark
                isAppearanceLightNavigationBars = !dark
            }
        }
    }
    CompositionLocalProvider(LocalTColors provides c) {
        MaterialTheme(colorScheme = scheme, typography = AppTypography, content = content)
    }
}

val MonoDigits = TextStyle(fontFeatureSettings = "tnum")
val Tabular = TextStyle(fontFeatureSettings = "tnum")
