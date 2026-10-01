package co.bitterlemon.trackify.util

import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.temporal.TemporalAdjusters
import java.util.Locale

const val SECOND = 1000L
const val MINUTE = 60 * SECOND
const val HOUR = 60 * MINUTE
const val DAY = 24 * HOUR

/** Minimum saved stretch (web `MIN_EVENT_MS`). */
const val MIN_EVENT_MS = 60_000L

/** 40 h lookback for starts / log-past (web `MAX_LOOKBACK`). */
const val MAX_LOOKBACK = 40 * HOUR

object Time {
    private val ISO_OUT: DateTimeFormatter =
        DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'").withZone(ZoneOffset.UTC)

    fun zone(): ZoneId = ZoneId.systemDefault()
    fun timezoneId(): String = ZoneId.systemDefault().id

    /** ISO 8601 with `Z` and millis — what zod `.datetime()` accepts. */
    fun iso(ms: Long): String = ISO_OUT.format(Instant.ofEpochMilli(ms))

    fun parse(iso: String?): Long {
        if (iso.isNullOrBlank()) return 0L
        return try {
            Instant.parse(iso).toEpochMilli()
        } catch (_: Exception) {
            try {
                ZonedDateTime.parse(iso).toInstant().toEpochMilli()
            } catch (_: Exception) {
                0L
            }
        }
    }

    fun snapMinute(ms: Long): Long = Format.jsRound(ms.toDouble() / MINUTE) * MINUTE

    fun localDate(ms: Long, zone: ZoneId = zone()): LocalDate = Instant.ofEpochMilli(ms).atZone(zone).toLocalDate()
    fun localDateTime(ms: Long, zone: ZoneId = zone()): LocalDateTime = Instant.ofEpochMilli(ms).atZone(zone).toLocalDateTime()

    fun startOfDay(date: LocalDate, zone: ZoneId = zone()): Long = date.atStartOfDay(zone).toInstant().toEpochMilli()
    /** date-fns `endOfDay` (23:59:59.999). */
    fun endOfDay(date: LocalDate, zone: ZoneId = zone()): Long = startOfDay(date.plusDays(1), zone) - 1

    fun mondayOf(date: LocalDate): LocalDate = date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY))
    fun sundayOf(date: LocalDate): LocalDate = date.with(TemporalAdjusters.nextOrSame(DayOfWeek.SUNDAY))

    fun today(): LocalDate = LocalDate.now(zone())

    private val fmtCache = HashMap<String, DateTimeFormatter>()
    fun fmt(pattern: String): DateTimeFormatter = synchronized(fmtCache) {
        fmtCache.getOrPut(pattern) { DateTimeFormatter.ofPattern(pattern, Locale.ENGLISH) }
    }

    fun format(ms: Long, pattern: String, zone: ZoneId = zone()): String =
        fmt(pattern).format(Instant.ofEpochMilli(ms).atZone(zone))

    fun format(date: LocalDate, pattern: String): String = fmt(pattern).format(date)

    /** 24 h "HH:mm". */
    fun clock(ms: Long): String = format(ms, "HH:mm")

    fun dayKey(date: LocalDate): String = date.toString()

    fun overlap(from: Long, to: Long, rangeFrom: Long?, rangeTo: Long?): Long {
        val a = if (rangeFrom != null) maxOf(from, rangeFrom) else from
        val b = if (rangeTo != null) minOf(to, rangeTo) else to
        return (b - a).coerceAtLeast(0)
    }

    /** web `liveOverlapMs`. */
    fun liveOverlapMs(startTime: Long, now: Long, rangeStart: Long, rangeEnd: Long): Long {
        if (now <= rangeStart || startTime >= rangeEnd) return 0
        return maxOf(0, minOf(now, rangeEnd) - maxOf(startTime, rangeStart))
    }

    /** web `liveRangeMs` (rangeEnd is an inclusive endOfDay, hence +1). */
    fun liveRangeMs(startTime: Long, now: Long, rangeStart: Long, rangeEndInclusive: Long): Long =
        liveOverlapMs(startTime, now, rangeStart, rangeEndInclusive + 1)
}
