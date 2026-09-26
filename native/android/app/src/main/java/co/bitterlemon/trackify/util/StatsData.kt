package co.bitterlemon.trackify.util

import co.bitterlemon.trackify.data.Group
import co.bitterlemon.trackify.data.Task
import java.time.LocalDate
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min
import kotlin.math.pow

/** A task with its events as (from, to) ms pairs (live timer included as a synthetic event). */
class TaskSpans(val task: Task, val spans: List<Pair<Long, Long>>)

class TrendRow(
    val label: String,
    val detail: String,
    val numeric: String,
    /** ms per series, index-aligned with [StatsResult.series]; last = Other. */
    val values: LongArray,
) {
    val total: Long get() = values.sum()
}

class Series(val name: String, val hex: String, val alpha: Float)

class GroupRow(val group: Group, val ms: Long, val members: List<Pair<Task, Long>>, val orphanIds: List<String>)

class StatsResult(
    val totalMs: Long,
    val dailyAvgMs: Long,
    val top: List<Pair<Task, Long>>,
    val series: List<Series>,
    val trend: List<TrendRow>,
    val groups: List<GroupRow>,
    val taskMsInRange: Map<String, Long>,
)

/** Stats page algorithms (web `stats-page-client.tsx`). */
object StatsData {
    fun overlap(from: Long, to: Long, rFrom: Long?, rTo: Long?): Long {
        val a = max(from, rFrom ?: 0L)
        val b = min(to, rTo ?: Long.MAX_VALUE)
        return max(0L, b - a)
    }

    fun taskMs(t: TaskSpans, rFrom: Long?, rTo: Long?): Long = t.spans.sumOf { overlap(it.first, it.second, rFrom, rTo) }

    fun compute(tasks: List<TaskSpans>, groups: List<Group>, rFrom: Long?, rTo: Long?, today: LocalDate = Time.today()): StatsResult {
        val totals = tasks.map { it to taskMs(it, rFrom, rTo) }
        val totalMs = totals.sumOf { it.second }
        val activeDays = HashSet<LocalDate>()
        if (totalMs > 0) for ((t, _) in totals) for ((f, to) in t.spans) if (overlap(f, to, rFrom, rTo) > 0) activeDays.add(Time.localDate(f))
        val dailyAvg = if (totalMs == 0L) 0L else if (activeDays.isNotEmpty()) Format.jsRound(totalMs.toDouble() / activeDays.size) else totalMs
        val top = totals.filter { it.second > 0 }.sortedByDescending { it.second }.take(5)
        val series = top.mapIndexed { i, (t, _) -> Series(t.task.name, Accents.TASK_COLORS[i % Accents.TASK_COLORS.size], 0.84f) } +
            Series("Other", Accents.OTHER_COLOR, 0.72f)
        val topIds = top.map { it.first.task.id }

        val (chartFrom, chartTo) = if (rFrom != null && rTo != null) Time.localDate(rFrom) to Time.localDate(rTo) else {
            val earliest = tasks.flatMap { it.spans }.minOfOrNull { it.first }
            (if (earliest != null) Time.localDate(earliest) else today.minusDays(29)) to today
        }
        val days = generateSequence(chartFrom) { it.plusDays(1) }.takeWhile { !it.isAfter(chartTo) }.toList()
        fun daySlices(day: LocalDate): LongArray {
            val arr = LongArray(topIds.size + 1)
            val ds = Time.startOfDay(day)
            val de = Time.endOfDay(day)
            for (t in tasks) {
                val ms = t.spans.sumOf { overlap(it.first, it.second, ds, de) }
                if (ms <= 0) continue
                val idx = topIds.indexOf(t.task.id)
                if (idx >= 0) arr[idx] += ms else arr[topIds.size] += ms
            }
            return arr
        }
        val trend = if (days.size <= 42) {
            days.map { d -> TrendRow(Time.format(d, "MMM d"), Time.format(d, "EEEE, MMM d, yyyy"), Time.format(d, "d.M.yyyy"), daySlices(d)) }
        } else {
            val weeks = LinkedHashMap<LocalDate, LongArray>()
            for (d in days) {
                val ws = Time.mondayOf(d)
                val acc = weeks.getOrPut(ws) { LongArray(topIds.size + 1) }
                val s = daySlices(d)
                for (i in s.indices) acc[i] += s[i]
            }
            weeks.map { (ws, v) -> TrendRow(Time.format(ws, "MMM d"), "Week of ${Time.format(ws, "MMMM d, yyyy")}", Time.format(ws, "d.M.yyyy"), v) }
        }

        // Group totals are ALL-TIME regardless of range.
        val byId = tasks.associateBy { it.task.id }
        val groupRows = groups.map { g ->
            val orphan = ArrayList<String>()
            var ms = 0L
            val members = ArrayList<Pair<Task, Long>>()
            for (id in g.taskIds) {
                val t = byId[id]
                if (t == null) {
                    orphan.add(id); continue
                }
                val tm = taskMs(t, null, null)
                ms += tm
                members.add(t.task to tm)
            }
            GroupRow(g, ms, members.sortedByDescending { it.second }, orphan)
        }
        return StatsResult(totalMs, dailyAvg, top.map { it.first.task to it.second }, series, trend, groupRows, totals.associate { it.first.task.id to it.second })
    }

    fun groupText(r: GroupRow): String {
        val lines = mutableListOf("${r.group.name} — ${Format.fmtMs(r.ms)}")
        r.members.forEach { (t, ms) -> lines.add("  · ${t.name}: ${Format.fmtMs(ms)}") }
        if (r.orphanIds.isNotEmpty()) lines.add("  · ${r.orphanIds.size} removed task(s) (no longer in app)")
        return lines.joinToString("\n")
    }

    /** "Nice" axis maximum and step for an hours axis with ~4 ticks. */
    fun niceAxis(maxHours: Double): Pair<Double, Double> {
        if (maxHours <= 0) return 1.0 to 0.25
        val raw = maxHours / 4
        val mag = 10.0.pow(kotlin.math.floor(kotlin.math.log10(raw)))
        val step = listOf(1.0, 2.0, 2.5, 5.0, 10.0).map { it * mag }.first { it >= raw }
        return ceil(maxHours / step) * step to step
    }

    /** Tooltip rows: (seriesIndex, pct with 1 decimal, ms) sorted by value desc. */
    fun tooltipRows(row: TrendRow): List<Triple<Int, Double, Long>> {
        val total = row.total.toDouble()
        return row.values.withIndex().filter { it.value > 0 }.sortedByDescending { it.value }
            .map { Triple(it.index, if (total > 0) Format.jsRound(it.value / total * 1000) / 10.0 else 0.0, it.value) }
    }
}
