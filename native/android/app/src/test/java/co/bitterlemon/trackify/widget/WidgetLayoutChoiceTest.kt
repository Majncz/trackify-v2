package co.bitterlemon.trackify.widget

import co.bitterlemon.trackify.data.Event
import co.bitterlemon.trackify.data.Task
import co.bitterlemon.trackify.widget.WidgetLayoutChoice.Kind
import co.bitterlemon.trackify.widget.WidgetLayoutChoice.Layout
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.ZoneId

class WidgetLayoutChoiceTest {
    private fun pick(k: Kind, w: Float, h: Float, signedIn: Boolean = true, tasks: Boolean = true) =
        WidgetLayoutChoice.choose(k, signedIn, tasks, w, h)

    @Test fun largeNeverBecomesTheTeamLayout() {
        for (w in listOf(110f, 180f, 250f, 300f, 340f, 420f)) for (h in listOf(40f, 110f, 200f, 300f, 400f, 520f, 640f))
            assertTrue("$w x $h", pick(Kind.LARGE, w, h) != Layout.TEAM)
    }

    @Test fun onlyTheTeamWidgetShowsTeam() {
        assertEquals(Layout.TEAM, pick(Kind.TEAM, 340f, 400f))
        assertEquals(Layout.LARGE, pick(Kind.LARGE, 340f, 400f))
        assertEquals(Layout.LARGE, pick(Kind.SMALL, 340f, 400f))
    }

    @Test fun boundaries() {
        assertEquals(Layout.BAR_NARROW, pick(Kind.LARGE, 110f, 129f))
        assertEquals(Layout.BAR_WIDE, pick(Kind.LARGE, 250f, 129f))
        assertEquals(Layout.SQUARE, pick(Kind.LARGE, 249f, 130f))
        assertEquals(Layout.MEDIUM, pick(Kind.LARGE, 250f, 299f))
        assertEquals(Layout.LARGE, pick(Kind.LARGE, 250f, 300f))
    }

    @Test fun signedOutAndEmptyShowAMessage() {
        assertEquals(Layout.MESSAGE, pick(Kind.LARGE, 340f, 400f, signedIn = false))
        assertEquals(Layout.MESSAGE, pick(Kind.LARGE, 340f, 400f, tasks = false))
    }

    @Test fun teamBlockGoesFirstThenHeatMap() {
        val tall = WidgetLayoutChoice.largeBlocks(640f, 1f, true, true)
        assertTrue(tall.heat && tall.team)
        val mid = WidgetLayoutChoice.largeBlocks(470f, 1f, true, true)
        assertTrue(mid.heat); assertFalse(mid.team)
        val short = WidgetLayoutChoice.largeBlocks(320f, 1f, true, true)
        assertFalse(short.heat); assertFalse(short.team)
    }

    @Test fun activityMinutesPerDayAndLevels() {
        val zone = ZoneId.of("UTC")
        val end = LocalDate.of(2026, 9, 29) // Tuesday
        fun ms(d: LocalDate, h: Int, m: Int = 0) = d.atTime(h, m).atZone(zone).toInstant().toString()
        val t = Task("a", "A", events = listOf(
            Event("1", ms(end, 9), ms(end, 11)),
            Event("2", ms(end.minusDays(1), 23), ms(end, 1)), // crosses midnight
        ))
        val days = ActivityMath.minutesPerDay(listOf(t), end, zone)
        assertEquals(ActivityMath.DAYS, days.size)
        assertEquals(120 + 60, days.last())
        assertEquals(60, days[days.size - 2])
        assertEquals(0, ActivityMath.level(0)); assertEquals(1, ActivityMath.level(30)); assertEquals(2, ActivityMath.level(60))
        assertEquals(3, ActivityMath.level(200)); assertEquals(4, ActivityMath.level(400))
        val grid = ActivityMath.grid(days, 4, end)
        assertEquals(4, grid.size)
        assertEquals(180, grid.last()[1]) // Tuesday row of the current week
        assertEquals(-1, grid.last()[2])  // Wednesday hasn't happened
        assertEquals(240, ActivityMath.totalMinutes(days, 4, end))
    }

    @Test fun paging() {
        assertEquals(1, Paging.pages(0, 4)); assertEquals(3, Paging.pages(10, 4)); assertEquals(2, Paging.pages(8, 4))
        assertEquals(0, Paging.pageOf(3, 3)); assertEquals(2, Paging.pageOf(-1, 3)); assertEquals(1, Paging.pageOf(1, 3))
        assertEquals(8..9, Paging.range(2, 4, 10))
        assertEquals(0..3, Paging.range(0, 4, 10))
    }
}
