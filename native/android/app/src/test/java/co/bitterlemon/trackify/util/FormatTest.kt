package co.bitterlemon.trackify.util

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Locale

class FormatTest {
    private val s = 1000L
    private val m = 60 * s
    private val h = 60 * m

    @Test fun duration() {
        assertEquals("00:00:00", Format.duration(0))
        assertEquals("00:00:59", Format.duration(59_999))
        assertEquals("01:02:03", Format.duration(h + 2 * m + 3 * s))
        assertEquals("123:00:00", Format.duration(123 * h))
    }

    @Test fun durationWords() {
        assertEquals("0s", Format.durationWords(0))
        assertEquals("45s", Format.durationWords(45 * s))
        assertEquals("5m", Format.durationWords(5 * m + 30 * s))
        assertEquals("2h", Format.durationWords(2 * h + 20 * s))
        assertEquals("2h 5m", Format.durationWords(2 * h + 5 * m))
        assertEquals("5m 30s", Format.durationWords(5 * m + 30 * s, seconds = true))
        assertEquals("2h 20s", Format.durationWords(2 * h + 20 * s, seconds = true))
        assertEquals("1h 1m 1s", Format.durationWords(h + m + s, seconds = true))
    }

    @Test fun fmtMs() {
        assertEquals("0s", Format.fmtMs(0))
        assertEquals("0s", Format.fmtMs(-5))
        assertEquals("1h 30m", Format.fmtMs(h + 30 * m + 10 * s))
        assertEquals("2h", Format.fmtMs(2 * h + 10 * s))
        assertEquals("3m 5s", Format.fmtMs(3 * m + 5 * s))
        assertEquals("3m", Format.fmtMs(3 * m))
        assertEquals("42s", Format.fmtMs(42 * s))
    }

    @Test fun heatMinutes() {
        assertEquals("0s", Format.heatMinutes(0.0))
        assertEquals("0s", Format.heatMinutes(-1.0))
        assertEquals("1h 2m 3s", Format.heatMinutes(62.05))
        assertEquals("2m 30s", Format.heatMinutes(2.5))
        assertEquals("30s", Format.heatMinutes(0.5))
        assertEquals("0.3s", Format.heatMinutes(0.005))   // 0.3 s
        assertEquals("0.06s", Format.heatMinutes(0.001))  // 0.06 s
        assertEquals("0.006s", Format.heatMinutes(0.0001)) // 0.006 s
    }

    @Test fun durationMinutes() {
        assertEquals("0m", Format.durationMinutes(0.0))
        assertEquals("45m", Format.durationMinutes(45.0))
        assertEquals("2h", Format.durationMinutes(120.0))
        assertEquals("2h 5m", Format.durationMinutes(125.0))
        assertEquals("0m", Format.durationMinutes(-3.0))
    }

    @Test fun raceDurationAndClock() {
        assertEquals("0m", Format.raceDuration(0))
        assertEquals("59s", Format.raceDuration(59_999))
        assertEquals("5m", Format.raceDuration(5 * m))
        assertEquals("3h", Format.raceDuration(3 * h))
        assertEquals("3h 7m", Format.raceDuration(3 * h + 7 * m))
        assertEquals("0:00", Format.playClock(0))
        assertEquals("1:05", Format.playClock(65 * s))
    }

    @Test fun agoLabel() {
        val now = 10 * h
        assertEquals("now", Format.agoLabel(now, now))
        assertEquals("now", Format.agoLabel(now - 20 * s, now))
        assertEquals("12 min ago", Format.agoLabel(now - 12 * m, now))
        assertEquals("1 hour ago", Format.agoLabel(now - h, now))
        assertEquals("3 hours ago", Format.agoLabel(now - 3 * h, now))
        assertEquals("1h 5m ago", Format.agoLabel(now - h - 5 * m, now))
    }

    @Test fun moneyCzechAndOthers() {
        assertEquals("1 234,50 Kč", Format.money(1234.5, "CZK"))
        assertEquals("€5,956.50", Format.money(5956.5, "EUR", Locale.US))
        assertEquals("$20.00", Format.money(20.0, "USD", Locale.US))
        assertEquals("Kč", Format.currencyUnitLabel("CZK"))
        assertEquals("€", Format.currencyUnitLabel("EUR", Locale.US))
    }

    @Test fun jsRoundHalfUp() {
        assertEquals(3L, Format.jsRound(2.5))
        assertEquals(-2L, Format.jsRound(-2.5))
        assertEquals(1.01, Format.round2(1.005 + 1e-9), 1e-9)
    }
}
