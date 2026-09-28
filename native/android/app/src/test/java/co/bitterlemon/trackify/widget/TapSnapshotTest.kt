package co.bitterlemon.trackify.widget

import co.bitterlemon.trackify.timer.Running
import co.bitterlemon.trackify.util.Time
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TapSnapshotTest {
    private val today = Time.today().toString()
    private val prev = WidgetSnapshotData(
        signedIn = true, userId = "u1", day = today, version = 7,
        tasks = listOf(SnapshotTask("A", "Alpha", "#ff0000", 0, 0), SnapshotTask("B", "Beta", "#00ff00", 0, 0)),
        lastTaskId = "A",
    )

    @Test fun tapOnColdProcessMovesOnlyTheTimerAndBumpsTheVersion() {
        val now = System.currentTimeMillis()
        val s = WidgetSnapshot.build(true, "", "u1", Running("B", now), true, null, "system", prev)
        assertEquals("Beta", s.running?.taskName)
        assertEquals(prev.tasks, s.tasks)
        assertTrue(s.version > prev.version)
        assertEquals(WidgetSnapshot.newest(prev, s), s)
    }

    @Test fun teamRowFollowsTheTap() {
        val now = System.currentTimeMillis()
        val start = maxOf(now - 10 * 60_000, Time.startOfDay(Time.today()))
        val team = TeamSnapshotData(day = today, fetchedAt = now, myId = "u1", members = listOf(TeamMember("u1", "Me", 60_000, start, "Alpha")))
        val live = team.members[0].todayLive(now)
        // Stop: the run becomes completed time, the row stops being live.
        val stopped = TeamSnapshot.withLocalTimer(team, prev.copy(running = null), now)!!
        assertNull(stopped.members[0].startTime)
        assertEquals(live, stopped.members[0].todayMs)
        // Switch to Beta now: same total, live again on the new task.
        val switched = TeamSnapshot.withLocalTimer(team, prev.copy(running = SnapshotRunning("B", "Beta", "#00ff00", now)), now)!!
        assertEquals("Beta", switched.members[0].taskName)
        assertEquals(live, switched.members[0].todayLive(now))
    }
}
