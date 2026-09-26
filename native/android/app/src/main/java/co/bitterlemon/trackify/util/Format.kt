package co.bitterlemon.trackify.util

import java.math.BigDecimal
import java.math.RoundingMode
import java.text.NumberFormat
import java.util.Currency
import java.util.Locale
import kotlin.math.floor
import kotlin.math.max

/** Formatting helpers ported 1:1 from the web (WEB_AUDIT §5.4). */
object Format {
    private fun pad2(n: Long) = n.toString().padStart(2, '0')

    /** `HH:MM:SS`, hours unbounded — running clock. */
    fun duration(ms: Long): String {
        val seconds = floorDiv(ms, 1000)
        val minutes = floorDiv(seconds, 60)
        val hours = floorDiv(minutes, 60)
        return "${pad2(hours)}:${pad2(minutes % 60)}:${pad2(seconds % 60)}"
    }

    /** "0s", "Ns", "Nm" (seconds dropped), "Nh", "Nh Nm"; with [seconds] adds seconds. */
    fun durationWords(ms: Long, seconds: Boolean = false): String {
        if (ms == 0L) return "0s"
        val totalSeconds = floorDiv(ms, 1000)
        val s = totalSeconds % 60
        val m = floorDiv(totalSeconds, 60) % 60
        val h = floorDiv(totalSeconds, 3600)
        if (seconds) {
            if (h == 0L && m == 0L) return "${s}s"
            if (h == 0L) return "${m}m ${s}s"
            if (m == 0L) return "${h}h ${s}s"
            return "${h}h ${m}m ${s}s"
        }
        if (h == 0L && m == 0L) return "${s}s"
        if (h == 0L) return "${m}m"
        if (m == 0L) return "${h}h"
        return "${h}h ${m}m"
    }

    /** Stats page `fmtMs`. */
    fun fmtMs(ms: Long): String {
        if (ms <= 0) return "0s"
        val totalSec = ms / 1000
        val h = totalSec / 3600
        val m = (totalSec % 3600) / 60
        val s = totalSec % 60
        if (h > 0 && m > 0) return "${h}h ${m}m"
        if (h > 0) return "${h}h"
        if (m > 0 && s > 0) return "${m}m ${s}s"
        if (m > 0) return "${m}m"
        return "${s}s"
    }

    /** Heat tooltip minutes: "Hh Mm Ss", "Mm Ss", "Ss", fractional seconds below 1 s. */
    fun heatMinutes(totalMinutes: Double): String {
        if (!totalMinutes.isFinite() || totalMinutes <= 0) return "0s"
        val secExact = totalMinutes * 60
        val roundedWhole = jsRound(secExact)
        if (roundedWhole == 0L && secExact > 0) {
            val digits = if (secExact >= 0.1) 2 else if (secExact >= 0.01) 3 else 4
            val v = BigDecimal(secExact).setScale(digits, RoundingMode.HALF_UP).stripTrailingZeros()
            return "${v.toPlainString()}s"
        }
        if (roundedWhole == 0L) return "0s"
        val h = roundedWhole / 3600
        val m = (roundedWhole % 3600) / 60
        val s = roundedWhole % 60
        if (h > 0) return "${h}h ${m}m ${s}s"
        if (m > 0) return "${m}m ${s}s"
        return "${s}s"
    }

    /** Billing minutes: "Xh Ym", "Xh", "Ym". */
    fun durationMinutes(totalMinutes: Double): String {
        val m = max(0L, jsRound(totalMinutes))
        val h = m / 60
        val mm = m % 60
        if (h <= 0) return "${mm}m"
        if (mm == 0L) return "${h}h"
        return "${h}h ${mm}m"
    }

    /** Race bar labels: "0m", "Ns", "Hh Mm". */
    fun raceDuration(ms: Long): String {
        if (ms <= 0) return "0m"
        if (ms < 60_000) return "${ms / 1000}s"
        val totalMinutes = ms / 60_000
        val hours = totalMinutes / 60
        val minutes = totalMinutes % 60
        if (hours == 0L) return "${minutes}m"
        if (minutes == 0L) return "${hours}h"
        return "${hours}h ${minutes}m"
    }

    /** "m:ss" for the race playback clock. */
    fun playClock(ms: Long): String {
        val total = max(0L, ms / 1000)
        return "${total / 60}:${(total % 60).toString().padStart(2, '0')}"
    }

    /** "now", "N min ago", "1 hour ago", "N hours ago", "Nh Mm ago". */
    fun agoLabel(ms: Long, now: Long): String {
        val mins = max(0L, jsRound((now - ms) / 60_000.0))
        if (mins <= 0) return "now"
        if (mins < 60) return "$mins min ago"
        val hours = mins / 60
        val rest = mins % 60
        if (rest == 0L) return if (hours == 1L) "1 hour ago" else "$hours hours ago"
        return "${hours}h ${rest}m ago"
    }

    /** Money like `Intl.NumberFormat` — `cs-CZ` for CZK, device locale otherwise. */
    fun money(amount: Double, currency: String?, deviceLocale: Locale = Locale.getDefault()): String {
        val raw = normalizeCurrency(currency)
        val locale = if (raw == "CZK") Locale.forLanguageTag("cs-CZ") else deviceLocale
        return try {
            val cur = Currency.getInstance(raw)
            val nf = NumberFormat.getCurrencyInstance(locale)
            nf.currency = cur
            nf.minimumFractionDigits = cur.defaultFractionDigits.coerceAtLeast(0)
            nf.maximumFractionDigits = cur.defaultFractionDigits.coerceAtLeast(0)
            // Java uses narrow no-break spaces in cs-CZ; the web shows plain NBSP. Keep NBSP.
            nf.format(amount).replace(' ', ' ')
        } catch (_: Exception) {
            "${"%.2f".format(Locale.US, amount)} ${currency ?: "CZK"}"
        }
    }

    fun currencyUnitLabel(currency: String?, deviceLocale: Locale = Locale.getDefault()): String {
        val raw = normalizeCurrency(currency)
        val locale = if (raw == "CZK") Locale.forLanguageTag("cs-CZ") else deviceLocale
        return try {
            Currency.getInstance(raw).getSymbol(locale)
        } catch (_: Exception) {
            raw
        }
    }

    fun normalizeCurrency(currency: String?): String =
        if (currency != null && currency.length >= 3) currency.substring(0, 3).uppercase() else "CZK"

    /** JavaScript `Math.round` (half rounds toward +∞). */
    fun jsRound(v: Double): Long = floor(v + 0.5).toLong()

    fun round2(v: Double): Double = jsRound(v * 100) / 100.0

    private fun floorDiv(a: Long, b: Long) = Math.floorDiv(a, b)
}
