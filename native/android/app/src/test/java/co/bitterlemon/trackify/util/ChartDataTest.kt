package co.bitterlemon.trackify.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneOffset

class ChartDataTest {
    private val z = ZoneOffset.UTC
    private val today = LocalDate.of(2026, 9, 26)
    private fun at(day: LocalDate, h: Int, m: Int = 0) = day.atStartOfDay(z).plusHours(h.toLong()).plusMinutes(m.toLong()).toInstant().toEpochMilli()

    @Test fun liveRowsMatchFullRebuild() {
        val tasks = listOf(
            "A" to listOf(at(today, 9) to at(today, 10, 30), at(today.minusDays(1), 22) to at(today, 1)),
            "B" to listOf(at(today.minusDays(3), 14) to at(today.minusDays(3), 15)),
        )
        val base = ChartData.eventsByDate(tasks, z)
        val grid = ChartData.buildWeekGrid(base, today, 30, z)
        val live = DayEvent("B", at(today, 11), at(today, 12, 15))
        val (inc, _) = ChartData.withLiveRows(grid, base, live, z)
        val full = ChartData.buildWeekGrid(ChartData.eventsByDate(tasks.map { if (it.first == "B") it.first to it.second + (live.from to live.to) else it }, z), today, 30, z)
        assertEquals(full.maxMinutes, inc.maxMinutes, 1e-9)
        for (i in full.grid.indices) for (h in 0 until 24) {
            assertEquals(full.grid[i][h].totalMinutes, inc.grid[i][h].totalMinutes, 1e-9)
        }
    }

    @Test fun eventsCrossingMidnightLandOnBothDays() {
        val ebd = ChartData.eventsByDate(listOf("A" to listOf(at(today.minusDays(1), 23) to at(today, 1))), z)
        assertTrue(ebd.containsKey(today) && ebd.containsKey(today.minusDays(1)))
        val grid = ChartData.buildWeekGrid(ebd, today, 2, z)
        assertEquals(60.0, grid.grid[0][23].totalMinutes, 1e-9)
        assertEquals(60.0, grid.grid[1][0].totalMinutes, 1e-9)
    }

    @Test fun segmentsBridgeShortGapsOfSameTask() {
        fun cell(task: String?) = HourCell().apply { if (task != null) { totalMinutes = 30.0; taskMinutes[task] = 30.0 } }
        val cells = (0 until 24).map { h -> when (h) { 9 -> cell("A"); 10 -> cell(null); 11 -> cell("A"); 13 -> cell("B"); else -> cell(null) } }
        val segs = ChartData.buildDaySegments(cells, 1, 2)
        assertEquals(listOf(WeeklySegment(9, 11, "A", 1), WeeklySegment(13, 13, "B", 0)), segs)
    }

    @Test fun weeklyMetricsPickSquaresClosestTo12() {
        // 24*sph squares + gaps: for ~330 px sph=1 gives 12px squares
        assertEquals(1, ChartData.weeklyGridMetrics(330f).first)
        val (sph, size) = ChartData.weeklyGridMetrics(700f)
        assertEquals(2, sph); assertEquals(12f, size)
    }

    @Test fun yearlyStartsOnMondayOfFirstEvent() {
        val ebd = ChartData.eventsByDate(listOf("A" to listOf(at(LocalDate.of(2026, 9, 2), 9) to at(LocalDate.of(2026, 9, 2), 10))), z)
        val y = ChartData.buildYearly(ebd, today, z)!!
        assertEquals(LocalDate.of(2026, 8, 31), y.weeks.first())
        assertEquals(LocalDate.of(2026, 9, 21), y.weeks.last())
        assertEquals(60.0, y.grid[2][0], 1e-9) // Wednesday row
    }
}
