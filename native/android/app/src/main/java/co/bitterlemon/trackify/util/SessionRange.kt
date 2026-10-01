package co.bitterlemon.trackify.util

import java.time.Instant
import java.time.ZoneId
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

data class Span(val from: Long, val to: Long, val name: String = "")

/** Session range algorithms (web `suggest-past-range.ts`, `session-range-slider.tsx`, `session-stamp-field.tsx`). */
object SessionRange {
    const val MIN_DURATION = MINUTE
    const val FIRST_VIEW = 90 * MINUTE
    const val VIEW_WINDOW = 90 * MINUTE
    const val DEFAULT_MS = 25 * MINUTE

    fun clamp(n: Long, lo: Long, hi: Long): Long = min(hi, max(lo, n))

    /** Median of event durations within [1 min, 8 h]; default 25 min. */
    fun typicalDurationMs(events: List<Pair<Long, Long>>): Long {
        val d = events.map { it.second - it.first }.filter { it in MINUTE..(8 * HOUR) }.sorted()
        if (d.isEmpty()) return DEFAULT_MS
        return d[d.size / 2]
    }

    fun mergeBusy(spans: List<Span>, earliest: Long, latest: Long): List<Span> {
        val busy = spans.filter { it.to > earliest && it.from < latest }.sortedBy { it.from }
        val merged = ArrayList<Span>()
        for (s in busy) {
            val last = merged.lastOrNull()
            if (last == null || s.from > last.to) merged.add(s.copy())
            else merged[merged.size - 1] = last.copy(to = max(last.to, s.to))
        }
        return merged
    }

    fun listGaps(earliest: Long, latest: Long, busy: List<Span>): List<Span> {
        val merged = mergeBusy(busy, earliest, latest)
        val gaps = ArrayList<Span>()
        var cursor = earliest
        for (s in merged) {
            if (s.from > cursor) gaps.add(Span(cursor, s.from))
            cursor = max(cursor, s.to)
        }
        if (cursor < latest) gaps.add(Span(cursor, latest))
        return gaps.filter { it.to - it.from >= MINUTE }
    }

    private fun gapDistance(anchor: Long, gap: Span): Long = when {
        anchor in gap.from..gap.to -> 0
        anchor < gap.from -> gap.from - anchor
        else -> anchor - gap.to
    }

    private fun fitInGap(gap: Span, duration: Long, anchor: Long, asEnd: Boolean): Pair<Long, Long> {
        val room = gap.to - gap.from
        val dur = min(max(MINUTE, duration), room)
        if (asEnd) {
            val end = min(gap.to, max(gap.from + dur, anchor))
            return (end - dur) to end
        }
        val start = max(gap.from, min(gap.to - dur, anchor))
        return start to (start + dur)
    }

    fun relocateToTime(anchor: Long, duration: Long, asEnd: Boolean, earliest: Long, latest: Long, busy: List<Span>): Pair<Long, Long>? {
        val gaps = listGaps(earliest, latest, busy)
        if (gaps.isEmpty()) return null
        var best = gaps[0]
        var bestDist = gapDistance(anchor, best)
        for (g in gaps) {
            val d = gapDistance(anchor, g)
            if (d < bestDist) {
                best = g; bestDist = d
            }
        }
        return fitInGap(best, duration, anchor, asEnd)
    }

    fun viewAround(start: Long, end: Long, earliest: Long, latest: Long, windowMs: Long = VIEW_WINDOW): Pair<Long, Long> {
        val span = max(windowMs, end - start + 20 * MINUTE).toDouble()
        var from = (start + end) / 2.0 - span / 2
        var to = from + span
        if (to > latest) {
            to = latest.toDouble(); from = to - span
        }
        if (from < earliest) {
            from = earliest.toDouble(); to = min(latest.toDouble(), from + span)
        }
        if (start < from) from = max(earliest, start - 10 * MINUTE).toDouble()
        if (end > to) to = min(latest, end + 10 * MINUTE).toDouble()
        return from.toLong() to to.toLong()
    }

    /** Initial Log-past suggestion: the latest free gap that holds the preferred length (or a whole smaller gap). */
    fun suggestPastRange(now: Long, events: List<Pair<Long, Long>>, runningStart: Long?, preferredMs: Long?): Pair<Long, Long> {
        val preferred = max(MINUTE, preferredMs ?: DEFAULT_MS)
        val earliest = now - MAX_LOOKBACK
        val busy = events.map { Span(it.first, it.second) }.toMutableList()
        if (runningStart != null && runningStart > 0) busy.add(Span(runningStart, now))
        val gaps = listGaps(earliest, now, busy)
        for (i in gaps.indices.reversed()) {
            val g = gaps[i]
            val room = g.to - g.from
            if (room >= preferred) return (g.to - preferred) to g.to
            if (room >= MINUTE) return g.from to g.to
        }
        return (now - preferred) to now
    }

    fun initialViewFrom(start: Long, openedAt: Long): Long {
        val earliest = openedAt - MAX_LOOKBACK
        val duration = max(openedAt - start, MINUTE)
        return if (duration >= FIRST_VIEW) max(earliest, start - 20 * MINUTE) else max(earliest, openedAt - FIRST_VIEW)
    }

    fun minStartForEnd(end: Long, busy: List<Span>, earliest: Long): Long {
        var m = earliest
        for (s in busy) if (s.from < end) m = max(m, s.to)
        return m
    }

    fun maxEndForStart(start: Long, busy: List<Span>, latest: Long): Long {
        var m = latest
        for (s in busy) if (s.to > start) m = min(m, s.from)
        return m
    }

    fun clampTypedStart(next: Long, end: Long, busy: List<Span>, earliest: Long): Long =
        clampSafe(next, minStartForEnd(end, busy, earliest), end - MIN_DURATION)

    fun clampTypedEnd(next: Long, start: Long, busy: List<Span>, latest: Long): Long =
        clampSafe(next, start + MIN_DURATION, maxEndForStart(start, busy, latest))

    /** JS `Math.min(max, Math.max(min, n))` — when min > max, max wins. */
    fun clampSafe(n: Long, lo: Long, hi: Long): Long = min(hi, max(lo, n))

    private fun clockOnDay(base: Long, hours: Int, minutes: Int, dayOffset: Int, zone: ZoneId): Long {
        val d = Instant.ofEpochMilli(base).atZone(zone).plusDays(dayOffset.toLong())
            .withHour(hours).withMinute(minutes).withSecond(0).withNano(0)
        return Time.snapMinute(d.toInstant().toEpochMilli())
    }

    /** A picked HH:mm resolves to the nearest of day offsets [0,-1,+1,-2] inside [min,max], else clamped. */
    fun resolveClock(base: Long, hours: Int, minutes: Int, lo: Long, hi: Long, zone: ZoneId = Time.zone()): Long {
        val c = listOf(0, -1, 1, -2).map { clockOnDay(base, hours, minutes, it, zone) }.filter { it in lo..hi }
        if (c.isEmpty()) return clampSafe(clockOnDay(base, hours, minutes, 0, zone), lo, hi)
        return c.minBy { abs(it - base) }
    }
}
