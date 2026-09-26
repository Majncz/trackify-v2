package co.bitterlemon.trackify.util

import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.ZoneOffset

class SessionRangeTest {
    private val now = 100 * HOUR

    @Test fun typicalDurationIsMedianWithinBounds() {
        assertEquals(25 * MINUTE, SessionRange.typicalDurationMs(emptyList()))
        val ev = listOf(0L to 10 * MINUTE, 0L to 20 * MINUTE, 0L to 30 * MINUTE, 0L to 30 * SECOND, 0L to 9 * HOUR)
        assertEquals(20 * MINUTE, SessionRange.typicalDurationMs(ev))
    }

    @Test fun suggestTakesLatestGapEndingAtItsEnd() {
        // busy [now-60m, now-30m]; latest gap [now-30m, now] holds 25m → ends at now
        val r = SessionRange.suggestPastRange(now, listOf((now - 60 * MINUTE) to (now - 30 * MINUTE)), null, 25 * MINUTE)
        assertEquals((now - 25 * MINUTE) to now, r)
    }

    @Test fun suggestUsesWholeSmallGapWhenPreferredDoesNotFit() {
        val busy = listOf((now - 3 * HOUR) to (now - 20 * MINUTE))
        // running timer blocks [now-10m, now]; gap [now-20m, now-10m] is 10m (< 25m)
        val r = SessionRange.suggestPastRange(now, busy, now - 10 * MINUTE, 25 * MINUTE)
        assertEquals((now - 20 * MINUTE) to (now - 10 * MINUTE), r)
    }

    @Test fun suggestFallsBackWhenNoGap() {
        val r = SessionRange.suggestPastRange(now, listOf((now - 41 * HOUR) to now), null, 25 * MINUTE)
        assertEquals((now - 25 * MINUTE) to now, r)
    }

    @Test fun gapsIgnoreSubMinute() {
        val gaps = SessionRange.listGaps(0, 10 * MINUTE, listOf(Span(30 * SECOND, 5 * MINUTE)))
        assertEquals(listOf(Span(5 * MINUTE, 10 * MINUTE)), gaps)
    }

    @Test fun clampingRules() {
        val busy = listOf(Span(10 * MINUTE, 20 * MINUTE), Span(40 * MINUTE, 50 * MINUTE))
        assertEquals(20 * MINUTE, SessionRange.minStartForEnd(30 * MINUTE, busy, 0))
        assertEquals(40 * MINUTE, SessionRange.maxEndForStart(25 * MINUTE, busy, 60 * MINUTE))
        assertEquals(20 * MINUTE, SessionRange.clampTypedStart(5 * MINUTE, 30 * MINUTE, busy, 0))
        assertEquals(40 * MINUTE, SessionRange.clampTypedEnd(55 * MINUTE, 25 * MINUTE, busy, 60 * MINUTE))
    }

    @Test fun relocateIntoNearestGap() {
        val busy = listOf(Span(10 * MINUTE, 20 * MINUTE))
        val r = SessionRange.relocateToTime(15 * MINUTE, 5 * MINUTE, false, 0, 60 * MINUTE, busy)
        // anchor inside busy block: nearest gap is [0,10] (distance 5) vs [20,60] (distance 5) → first wins
        assertEquals((5 * MINUTE) to (10 * MINUTE), r)
    }

    @Test fun viewAroundCentresAndClamps() {
        val (f, t) = SessionRange.viewAround(now - 30 * MINUTE, now, now - 40 * HOUR, now)
        assertEquals(now, t)
        assertEquals(now - 90 * MINUTE, f)
    }

    @Test fun initialViewFrom() {
        assertEquals(now - 90 * MINUTE, SessionRange.initialViewFrom(now - 10 * MINUTE, now))
        assertEquals(now - 3 * HOUR - 20 * MINUTE, SessionRange.initialViewFrom(now - 3 * HOUR, now))
    }

    @Test fun resolveClockPicksNearestDay() {
        val z = ZoneOffset.UTC
        val base = 48 * HOUR + 1 * HOUR // day 2, 01:00 UTC
        // 23:30 should resolve to the previous day (closest to base) within bounds
        val r = SessionRange.resolveClock(base, 23, 30, base - 40 * HOUR, base, z)
        assertEquals(48 * HOUR - 30 * MINUTE, r)
    }
}
