package co.bitterlemon.trackify.util

import co.bitterlemon.trackify.data.Task
import java.time.LocalDate
import java.time.ZoneId
import kotlin.math.abs
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.min

data class DayEvent(val taskName: String, val from: Long, val to: Long)

class HourCell(var totalMinutes: Double = 0.0, val taskMinutes: LinkedHashMap<String, Double> = LinkedHashMap()) {
    /** Task with the most minutes (first wins ties, like a stable JS sort). */
    fun dominant(): String? {
        if (totalMinutes <= 0) return null
        var best: String? = null
        var bv = -1.0
        for ((k, v) in taskMinutes) if (v > bv) {
            best = k; bv = v
        }
        return best
    }
}

data class WeeklySegment(val startFlat: Int, val endFlat: Int, val taskName: String, val bridgedEmptySlots: Int)

class WeekGrid(val days: List<LocalDate>, val grid: List<List<HourCell>>, val maxMinutes: Double, val hasData: Boolean)

class YearlyData(
    /** Monday of each column. */
    val weeks: List<LocalDate>,
    /** grid[row 0..6 Mon..Sun][week] = minutes. */
    val grid: List<DoubleArray>,
    val maxMinutes: Double,
    val dayTaskMinutes: Map<LocalDate, Map<String, Double>>,
    val workingSorted: List<Double>,
    val dayEarnings: Map<LocalDate, Double>? = null,
    val dayCurrency: Map<LocalDate, String>? = null,
) {
    fun dayAt(row: Int, week: Int): LocalDate = weeks[week].plusDays(row.toLong())
}

/** Home "Time Spent" + yearly contribution algorithms (web `time-chart.tsx`, `yearly-contribution-data.ts`). */
object ChartData {
    const val DAYS_TO_LOAD = 1000
    const val MAX_TASKS = 5

    fun overlap(from: Long, to: Long, s: Long, e: Long): Long {
        if (to <= s || from >= e) return 0
        return max(0L, min(to, e) - max(from, s))
    }

    /** Tasks plus the live timer as a synthetic event `[start, now]`. */
    fun withLive(tasks: List<Task>, liveTaskId: String?, liveStart: Long?, now: Long): List<Pair<Task, List<Pair<Long, Long>>>> =
        tasks.map { t ->
            val ev = t.events.map { it.fromMs to it.toMs }
            if (t.id == liveTaskId && liveStart != null) t to (ev + (liveStart to now)) else t to ev
        }

    fun eventsByDate(tasks: List<Pair<String, List<Pair<Long, Long>>>>, zone: ZoneId = Time.zone()): Map<LocalDate, List<DayEvent>> {
        val index = HashMap<LocalDate, MutableList<DayEvent>>()
        for ((name, events) in tasks) {
            for ((from, to) in events) {
                var d = Time.localDate(from, zone)
                // web: add to each day from startOfDay(from) stepping 24h while <= to
                var cursor = Time.startOfDay(d, zone)
                while (cursor <= to) {
                    index.getOrPut(d) { ArrayList() }.add(DayEvent(name, from, to))
                    d = d.plusDays(1)
                    cursor = Time.startOfDay(d, zone)
                }
            }
        }
        return index
    }

    /** Colour mapping for the weekly grid: top 5 tasks in the 10-day window; the live task keeps its yearly colour. */
    fun weeklyTaskColors(
        tasks: List<Pair<Task, List<Pair<Long, Long>>>>,
        visibleOrder: List<Task>,
        liveTaskId: String?,
        today: LocalDate = Time.today(),
    ): Pair<LinkedHashMap<String, String>, Boolean> {
        val rangeEnd = Time.endOfDay(today)
        val rangeStart = Time.startOfDay(today.minusDays(9))
        val totals = tasks.map { (t, ev) -> t to ev.sumOf { overlap(it.first, it.second, rangeStart, rangeEnd) } }
            .filter { it.second > 0 }
            .sortedByDescending { it.second }
        val top = totals.take(MAX_TASKS)
        val hasOther = totals.size > MAX_TASKS
        val colors = LinkedHashMap<String, String>()
        top.forEachIndexed { i, (t, _) -> colors[t.name] = Accents.TASK_COLORS[i % Accents.TASK_COLORS.size] }
        if (hasOther) colors["Other"] = Accents.OTHER_COLOR
        if (liveTaskId != null) {
            val live = visibleOrder.firstOrNull { it.id == liveTaskId }
            if (live != null && !colors.containsKey(live.name)) {
                colors[live.name] = yearlyTaskColors(visibleOrder)[live.name] ?: Accents.TASK_COLORS[0]
            }
        }
        return colors to hasOther
    }

    /** Yearly: visible tasks in API order (by name); index i → TASK_COLORS[i % 6]. */
    fun yearlyTaskColors(visible: List<Task>): Map<String, String> {
        val m = LinkedHashMap<String, String>()
        visible.forEachIndexed { i, t -> m[t.name] = Accents.TASK_COLORS[i % Accents.TASK_COLORS.size] }
        return m
    }

    fun buildWeekGrid(eventsByDate: Map<LocalDate, List<DayEvent>>, today: LocalDate = Time.today(), days: Int = DAYS_TO_LOAD, zone: ZoneId = Time.zone()): WeekGrid {
        val list = (0 until days).map { today.minusDays((days - 1 - it).toLong()) }
        var maxMin = 0.0
        var has = false
        val grid = list.map { day ->
            val evs = eventsByDate[day] ?: emptyList()
            val dayStart = day.atStartOfDay(zone)
            (0 until 24).map { h ->
                val hs = dayStart.plusHours(h.toLong()).toInstant().toEpochMilli()
                val he = dayStart.plusHours(h + 1L).toInstant().toEpochMilli()
                val cell = HourCell()
                for (e in evs) {
                    val o = overlap(e.from, e.to, hs, he)
                    if (o > 0) {
                        val m = o / 60000.0
                        cell.totalMinutes += m
                        cell.taskMinutes[e.taskName] = (cell.taskMinutes[e.taskName] ?: 0.0) + m
                    }
                }
                if (cell.totalMinutes > 0) {
                    has = true; maxMin = max(maxMin, cell.totalMinutes)
                }
                cell
            }
        }
        return WeekGrid(list, grid, if (maxMin == 0.0) 1.0 else maxMin, has)
    }

    fun buildDaySegments(hourCells: List<HourCell>, sph: Int, maxBridge: Int): List<WeeklySegment> {
        val n = 24 * sph
        fun hourAt(f: Int) = f / sph
        val segs = ArrayList<WeeklySegment>()
        var i = 0
        while (i < n) {
            val task = hourCells[hourAt(i)].dominant()
            if (task == null) {
                i++; continue
            }
            var j = i + 1
            var bridged = 0
            while (j < n) {
                val tj = hourCells[hourAt(j)].dominant()
                if (tj == task) {
                    j++; continue
                }
                if (tj != null) break
                val gapStart = j
                var k = j
                while (k < n && hourCells[hourAt(k)].dominant() == null) k++
                val gapLen = k - gapStart
                if (gapLen > maxBridge) break
                if (k >= n) break
                if (hourCells[hourAt(k)].dominant() != task) break
                bridged += gapLen
                j = k + 1
            }
            segs.add(WeeklySegment(i, j - 1, task, bridged))
            i = j
        }
        return segs
    }

    /** Square count per hour so squares are closest to 12 px (min 10, gap 2). */
    fun weeklyGridMetrics(available: Float, gap: Float = 2f, minSq: Float = 10f, target: Float = 12f): Pair<Int, Float> {
        if (available <= 0) return 1 to target
        var best = 1 to minSq
        var bestDist = Float.MAX_VALUE
        for (sph in 1..6) {
            val n = 24 * sph
            val size = floor((available - (n - 1) * gap) / n)
            if (size < minSq) continue
            val d = abs(size - target)
            if (d < bestDist) {
                best = sph to size; bestDist = d
            }
        }
        if (bestDist == Float.MAX_VALUE) return 1 to max(8f, floor((available - 23 * gap) / 24))
        return best
    }

    fun slotRange(day: LocalDate, flat: Int, sph: Int, zone: ZoneId = Time.zone()): Pair<Long, Long> {
        val hour = flat / sph
        val sq = flat % sph
        val base = day.atStartOfDay(zone).plusHours(hour.toLong())
        val slice = 60.0 / sph
        val s = base.toInstant().toEpochMilli() + (sq * slice * 60000).toLong()
        val e = base.toInstant().toEpochMilli() + ((sq + 1) * slice * 60000).toLong()
        return s to e
    }

    fun preciseWindow(dayEvents: List<DayEvent>, rs: Long, re: Long, task: String): Pair<Long, Long>? {
        val rel = dayEvents.filter { it.taskName == task && it.to > rs && it.from < re }
        if (rel.isEmpty()) return null
        val s = max(rs, rel.minOf { it.from })
        val e = min(re, rel.maxOf { it.to })
        return if (e <= s) null else s to e
    }

    fun minutesForTask(dayEvents: List<DayEvent>, task: String, rs: Long, re: Long): Double =
        dayEvents.filter { it.taskName == task }.sumOf { overlap(it.from, it.to, rs, re) / 60000.0 }

    fun buildYearly(eventsByDate: Map<LocalDate, List<DayEvent>>, calendarEndDay: LocalDate? = null, zone: ZoneId = Time.zone()): YearlyData? {
        var minT = Long.MAX_VALUE
        var any = false
        for (l in eventsByDate.values) for (e in l) {
            any = true; minT = min(minT, min(e.from, e.to))
        }
        if (!any) return null
        val startDate = Time.mondayOf(Time.localDate(minT, zone))
        val endDate = Time.sundayOf(calendarEndDay ?: Time.today())
        return fill(startDate, endDate, eventsByDate, zone)
    }

    fun buildEmptyYearly(calendarEndDay: LocalDate): YearlyData {
        val startDate = Time.mondayOf(LocalDate.of(calendarEndDay.year, 1, 1))
        return fill(startDate, Time.sundayOf(calendarEndDay), emptyMap(), Time.zone())
    }

    private fun fill(startDate: LocalDate, endDate: LocalDate, eventsByDate: Map<LocalDate, List<DayEvent>>, zone: ZoneId): YearlyData {
        val weeks = ArrayList<LocalDate>()
        var w = startDate
        while (!w.isAfter(endDate)) {
            weeks.add(w); w = w.plusDays(7)
        }
        val grid = List(7) { DoubleArray(weeks.size) }
        val dayTask = HashMap<LocalDate, Map<String, Double>>()
        var maxM = 0.0
        weeks.forEachIndexed { wi, monday ->
            for (r in 0 until 7) {
                val day = monday.plusDays(r.toLong())
                val evs = eventsByDate[day] ?: emptyList()
                val ds = Time.startOfDay(day, zone)
                val de = Time.endOfDay(day, zone)
                val byTask = LinkedHashMap<String, Double>()
                var total = 0.0
                for (e in evs) {
                    val m = overlap(e.from, e.to, ds, de) / 60000.0
                    total += m
                    byTask[e.taskName] = (byTask[e.taskName] ?: 0.0) + m
                }
                grid[r][wi] = total
                dayTask[day] = byTask
                maxM = max(maxM, total)
            }
        }
        val working = Accents.workingDayMinutes(grid.flatMap { it.toList() })
        return YearlyData(weeks, grid, if (maxM == 0.0) 1.0 else maxM, dayTask, working)
    }

    /** Billing heatmap: each day's value = overlap/sessionLength × billed minutes. */
    fun buildYearlyFromBilling(sessions: List<co.bitterlemon.trackify.data.BillingSession>, calendarEndDay: LocalDate?, zone: ZoneId = Time.zone()): YearlyData {
        val byDate = HashMap<LocalDate, MutableList<DayEvent>>()
        val earnings = HashMap<LocalDate, Double>()
        val currency = HashMap<LocalDate, String>()
        for (s in sessions) {
            val from = s.fromMs
            val to = s.toMs
            val totalMs = max(1L, to - from)
            var d = Time.localDate(from, zone)
            val last = Time.localDate(to, zone)
            while (!d.isAfter(last)) {
                val ds = Time.startOfDay(d, zone)
                val de = Time.endOfDay(d, zone)
                val o = overlap(from, to, ds, de)
                if (o > 0) {
                    val billable = (o.toDouble() / totalMs) * s.durationMinutes * 60_000
                    val clipTo = min(de, ds + billable.toLong())
                    if (ds < clipTo) byDate.getOrPut(d) { ArrayList() }.add(DayEvent(s.taskName, ds, clipTo))
                    earnings[d] = (earnings[d] ?: 0.0) + (o.toDouble() / totalMs) * s.earnings
                    currency[d] = s.currency
                }
                d = d.plusDays(1)
            }
        }
        val base = buildYearly(byDate, calendarEndDay, zone) ?: buildEmptyYearly(calendarEndDay ?: Time.today())
        return YearlyData(base.weeks, base.grid, base.maxMinutes, base.dayTaskMinutes, base.workingSorted, earnings, currency)
    }
}
