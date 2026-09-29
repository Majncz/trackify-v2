package co.bitterlemon.trackify.widget

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.RectF
import android.graphics.Typeface
import co.bitterlemon.trackify.data.Task
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.ChronoUnit

/**
 * Work heat map for the large widget: minutes tracked per local day, oldest first, ending on [end] (today).
 * Built from the same tasks as the snapshot; the running stretch of today is added at render time.
 */
object ActivityMath {
    const val DAYS = 26 * 7 + 6

    /** Minutes per day for the [DAYS] days up to [end] (inclusive). */
    fun minutesPerDay(tasks: List<Task>, end: LocalDate, zone: ZoneId): List<Int> {
        val start = end.minusDays(DAYS - 1L)
        val startMs = start.atStartOfDay(zone).toInstant().toEpochMilli()
        val ms = LongArray(DAYS)
        for (t in tasks) for (e in t.events) {
            if (e.toMs <= startMs || e.toMs <= e.fromMs) continue
            var from = maxOf(e.fromMs, startMs)
            while (from < e.toMs) {
                val d = java.time.Instant.ofEpochMilli(from).atZone(zone).toLocalDate()
                val idx = ChronoUnit.DAYS.between(start, d).toInt()
                if (idx !in 0 until DAYS) break
                val dayEnd = d.plusDays(1).atStartOfDay(zone).toInstant().toEpochMilli()
                val to = minOf(e.toMs, dayEnd)
                ms[idx] += to - from
                from = to
            }
        }
        return ms.map { (it / 60_000L).toInt() }
    }

    /** 0 = nothing, 1..4 by hours tracked that day. */
    fun level(minutes: Int): Int = when {
        minutes <= 0 -> 0
        minutes < 60 -> 1
        minutes < 180 -> 2
        minutes < 360 -> 3
        else -> 4
    }

    /** Weeks (columns, Monday first) that fit [availDp] with cells of about [cellDp]; 8..26. */
    fun weeksFor(availDp: Float, cellDp: Float = 11f, gapDp: Float = 2f): Int =
        ((availDp + gapDp) / (cellDp + gapDp)).toInt().coerceIn(8, 26)

    /** Total minutes in the last [weeks] weeks (columns), today included. */
    fun totalMinutes(days: List<Int>, weeks: Int, end: LocalDate): Int {
        val cols = grid(days, weeks, end)
        return cols.sumOf { c -> c.sumOf { it.coerceAtLeast(0) } }
    }

    /**
     * grid[week][row Mon..Sun] = minutes, or -1 for days after [end]. The last column is the week of [end].
     */
    fun grid(days: List<Int>, weeks: Int, end: LocalDate): List<IntArray> {
        val lastMonday = end.with(DayOfWeek.MONDAY)
        val firstMonday = lastMonday.minusWeeks(weeks - 1L)
        val start = end.minusDays(days.size - 1L)
        return (0 until weeks).map { w ->
            IntArray(7) { r ->
                val d = firstMonday.plusWeeks(w.toLong()).plusDays(r.toLong())
                when {
                    d.isAfter(end) -> -1
                    else -> days.getOrNull(ChronoUnit.DAYS.between(start, d).toInt()) ?: 0
                }
            }
        }
    }
}

/** Which layout a widget kind shows at a size. Pure, so the choice is unit-tested. */
object WidgetLayoutChoice {
    enum class Kind { SMALL, LARGE, TEAM }
    enum class Layout { MESSAGE, BAR_NARROW, BAR_WIDE, SQUARE, MEDIUM, LARGE, TEAM }

    const val WIDE = 250
    const val BAR = 130

    fun choose(kind: Kind, signedIn: Boolean, hasTasksOrRunning: Boolean, widthDp: Float, heightDp: Float): Layout = when {
        !signedIn -> Layout.MESSAGE
        kind == Kind.TEAM -> Layout.TEAM
        !hasTasksOrRunning -> Layout.MESSAGE
        heightDp < BAR && widthDp < WIDE -> Layout.BAR_NARROW
        heightDp < BAR -> Layout.BAR_WIDE
        widthDp < WIDE -> Layout.SQUARE
        heightDp < 300 -> Layout.MEDIUM
        else -> Layout.LARGE
    }

    /** Which optional blocks of the large layout fit; the list keeps at least three rows, the team goes first. */
    class Blocks(val heat: Boolean, val team: Boolean)

    fun largeBlocks(heightDp: Float, fontScale: Float, running: Boolean, teamLoaded: Boolean): Blocks {
        val hero = if (running) (22 + 17) * fontScale + 52 else (18 + 42) * fontScale
        val fixed = 32 + hero + 21 + 26 + 3 * (if (fontScale > 1.15f) 40 else 36)
        val heatH = (21 + HEAT_H).toFloat()
        val teamH = (21 + 26 + teamRowHeight(fontScale)).toFloat()
        val heat = heightDp - fixed >= heatH
        val team = teamLoaded && heightDp - fixed - (if (heat) heatH else 0f) >= teamH
        return Blocks(heat, team)
    }

    const val HEAT_H = 140
}

/**
 * Draws the heat map into three transparent, single-channel bitmaps (alpha encodes the level) that the widget
 * tints with theme colours — so Light/Dark/System apply through resource colours without re-rendering.
 */
object HeatBitmaps {
    class Set(val empty: Bitmap, val levels: Bitmap, val labels: Bitmap, val widthDp: Int, val heightDp: Int)

    private val cache = object : android.util.LruCache<String, Set>(6) {}

    fun get(context: Context, days: List<Int>, liveTodayMin: Int, end: LocalDate, widthDp: Int, weeks: Int): Set {
        val d = context.resources.displayMetrics.density.coerceAtMost(3f)
        val key = "${days.hashCode()}:${liveTodayMin / 10}:$end:$widthDp:$weeks:$d"
        synchronized(cache) { cache.get(key)?.let { return it } }
        val s = render(days, liveTodayMin, end, widthDp, weeks, d)
        synchronized(cache) { cache.put(key, s) }
        return s
    }

    private const val MONTH_H = 14
    private const val GAP = 2f

    private fun render(daysIn: List<Int>, liveTodayMin: Int, end: LocalDate, widthDp: Int, weeks: Int, d: Float): Set {
        val days = daysIn.toMutableList().also { if (it.isNotEmpty()) it[it.lastIndex] = it.last() + liveTodayMin }
        val grid = ActivityMath.grid(days, weeks, end)
        val cell = ((widthDp - (weeks - 1) * GAP) / weeks).coerceAtMost(14f)
        val gridW = weeks * cell + (weeks - 1) * GAP
        val h = MONTH_H + 7 * cell + 6 * GAP
        val wPx = (widthDp * d).toInt().coerceIn(1, 1400)
        val hPx = (h * d).toInt().coerceIn(1, 500)
        fun bmp() = Bitmap.createBitmap(wPx, hPx, Bitmap.Config.ARGB_8888)
        val empty = bmp(); val levels = bmp(); val labels = bmp()
        val ce = Canvas(empty); val cl = Canvas(levels); val cb = Canvas(labels)
        val p = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFFFFFFF.toInt() }
        val r = cell * 0.24f * d
        val x0 = (widthDp - gridW) / 2f
        val alphas = intArrayOf(0, 90, 150, 210, 255)
        for (w in 0 until weeks) for (row in 0 until 7) {
            val m = grid[w][row]
            if (m < 0) continue
            val rect = RectF((x0 + w * (cell + GAP)) * d, (MONTH_H + row * (cell + GAP)) * d, (x0 + w * (cell + GAP) + cell) * d, (MONTH_H + row * (cell + GAP) + cell) * d)
            if (m == 0) { p.alpha = 255; ce.drawRoundRect(rect, r, r, p) }
            else { p.alpha = alphas[ActivityMath.level(m)]; cl.drawRoundRect(rect, r, r, p) }
        }
        // Today: a ring on the empty layer's neighbour (labels layer, tinted foreground).
        val lastMonday = end.with(DayOfWeek.MONDAY)
        val todayRow = end.dayOfWeek.value - 1
        val ring = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFFFFFFF.toInt(); style = Paint.Style.STROKE; strokeWidth = 1.4f * d }
        val tx = x0 + (weeks - 1) * (cell + GAP); val ty = MONTH_H + todayRow * (cell + GAP)
        cb.drawRoundRect(RectF((tx - 1) * d, (ty - 1) * d, (tx + cell + 1) * d, (ty + cell + 1) * d), r + d, r + d, ring)
        // Month names above the first column of each month.
        val tp = Paint(Paint.ANTI_ALIAS_FLAG).apply { color = 0xFFFFFFFF.toInt(); textSize = 10f * d; typeface = Typeface.create("sans-serif", Typeface.NORMAL) }
        val firstMonday = lastMonday.minusWeeks(weeks - 1L)
        var lastMonth = -1; var lastX = -100f
        for (w in 0 until weeks) {
            val mon = firstMonday.plusWeeks(w.toLong())
            val month = mon.plusDays(3).monthValue
            if (month != lastMonth) {
                val x = x0 + w * (cell + GAP)
                val name = mon.plusDays(3).month.getDisplayName(java.time.format.TextStyle.SHORT, java.util.Locale.getDefault())
                if (x - lastX >= 26 && x + 22 <= widthDp + 8) { cb.drawText(name, x * d, 10.5f * d, tp); lastX = x }
                lastMonth = month
            }
        }
        return Set(empty, levels, labels, widthDp, ((h) + 0.5f).toInt())
    }
}

/** Paging of the large widget's task list (RemoteViews can't scroll a list that animates; pages flip with a fade). */
object Paging {
    fun pages(total: Int, perPage: Int): Int = if (total <= 0 || perPage <= 0) 1 else (total + perPage - 1) / perPage

    /** [raw] page number wrapped into 0 until pages (past the last page comes the first again). */
    fun pageOf(raw: Int, pages: Int): Int = Math.floorMod(raw, pages.coerceAtLeast(1))

    /** Index range shown on [page]. */
    fun range(page: Int, perPage: Int, total: Int): IntRange = (page * perPage) until minOf(total, (page + 1) * perPage)

    private fun prefs(c: Context) = c.getSharedPreferences("widget_pager", Context.MODE_PRIVATE)
    fun raw(c: Context): Int = prefs(c).getInt("page", 0)
    fun move(c: Context, dir: Int) = prefs(c).edit().putInt("page", raw(c) + dir).apply()
    fun reset(c: Context) { if (raw(c) != 0) prefs(c).edit().putInt("page", 0).apply() }
}
