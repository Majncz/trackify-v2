package co.bitterlemon.trackify.timer

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class TimerLogicTest {
    private val t0 = 1_000_000_000L
    private val min = 60_000L

    @Test fun startQueuesSwitchAndIsOptimistic() {
        val r = TimerLogic.start(TimerPersisted(), "A", t0, id = "1")
        assertTrue(r.changed)
        assertEquals(Running("A", t0), r.state.running)
        assertEquals(listOf(TimerOp.Switch("1", "A", t0, null, null)), r.state.queue)
    }

    @Test fun startingRunningTaskIsNoOp() {
        val s = TimerPersisted(running = Running("A", t0))
        val r = TimerLogic.start(s, "A", t0 + min)
        assertFalse(r.changed)
        assertEquals(s, r.state)
    }

    @Test fun switchCarriesPreviousRunForLegacyFallback() {
        val s = TimerPersisted(running = Running("A", t0))
        val r = TimerLogic.start(s, "B", t0 + 5 * min, id = "2")
        assertEquals(Running("B", t0 + 5 * min), r.state.running)
        assertEquals(TimerOp.Switch("2", "B", t0 + 5 * min, "A", t0), r.state.queue.single())
    }

    @Test fun stopQueuesStopWithStart() {
        val s = TimerPersisted(running = Running("A", t0))
        val r = TimerLogic.stop(s, t0 + 10 * min, id = "3")
        assertNull(r.state.running)
        assertEquals(TimerOp.Stop("3", "A", t0 + 10 * min, t0, null), r.state.queue.single())
    }

    @Test fun stopInThePastWithFixedStart() {
        val s = TimerPersisted(running = Running("A", t0))
        val r = TimerLogic.stop(s, now = t0 + 60 * min, at = t0 + 30 * min, startOverride = t0 - 5 * min, id = "4")
        assertEquals(TimerOp.Stop("4", "A", t0 + 30 * min, t0, t0 - 5 * min), r.state.queue.single())
    }

    @Test fun stopClampsEndToNow() {
        val s = TimerPersisted(running = Running("A", t0))
        val r = TimerLogic.stop(s, now = t0 + min, at = t0 + 10 * min, id = "5")
        assertEquals(t0 + min, (r.state.queue.single() as TimerOp.Stop).at)
    }

    @Test fun quickStartStopWhileQueuedCollapses() {
        val started = TimerLogic.start(TimerPersisted(), "A", t0, id = "1").state
        val r = TimerLogic.stop(started, t0 + 20_000, id = "2")
        assertNull(r.state.running)
        assertTrue(r.state.queue.isEmpty())
    }

    @Test fun quickSwitchThenStopStillSavesPrevious() {
        val s = TimerPersisted(running = Running("A", t0))
        val switched = TimerLogic.start(s, "B", t0 + 10 * min, id = "1").state
        val r = TimerLogic.stop(switched, t0 + 10 * min + 5_000, id = "2")
        assertEquals(listOf(TimerOp.Stop("2", "A", t0 + 10 * min, t0)), r.state.queue)
    }

    @Test fun inFlightSwitchIsNeverRewritten() {
        val started = TimerLogic.start(TimerPersisted(), "A", t0, id = "1").state
        val r = TimerLogic.stop(started, t0 + 20_000, inFlightId = "1", id = "2")
        assertEquals(2, r.state.queue.size)
    }

    @Test fun longStretchIsNotCollapsed() {
        val started = TimerLogic.start(TimerPersisted(), "A", t0, id = "1").state
        val r = TimerLogic.stop(started, t0 + 2 * min, id = "2")
        assertEquals(2, r.state.queue.size)
    }

    @Test fun adjustStartIsOptimisticAndQueued() {
        val s = TimerPersisted(running = Running("A", t0))
        val r = TimerLogic.adjustStart(s, t0 - 30 * min, t0 + min, id = "6")
        assertEquals(Running("A", t0 - 30 * min), r.state.running)
        assertEquals(TimerOp.AdjustStart("6", "A", t0 - 30 * min), r.state.queue.single())
    }

    @Test fun completeRemovesOnlyThatOp() {
        val s = TimerPersisted(queue = listOf(TimerOp.Stop("a", "A", 1, 0), TimerOp.Switch("b", "B", 1)))
        assertEquals(listOf(TimerOp.Switch("b", "B", 1)), TimerLogic.complete(s, "a", 2).queue)
    }

    @Test fun truthIsIgnoredWhileWorkIsPending() {
        val pending = TimerPersisted(running = Running("B", t0), queue = listOf(TimerOp.Switch("1", "B", t0)))
        assertEquals(pending, TimerLogic.adoptTruth(pending, null, t0 + 1))
        assertEquals(pending, TimerLogic.onRemoteStopped(pending, "B", t0 + 1))
        val idle = TimerPersisted(running = Running("B", t0))
        assertNull(TimerLogic.adoptTruth(idle, null, t0 + 1).running)
        assertEquals(Running("C", t0 + 5), TimerLogic.adoptTruth(idle, Running("C", t0 + 5), t0 + 6).running)
    }

    @Test fun remoteStopOnlyAffectsSameTask() {
        val s = TimerPersisted(running = Running("A", t0))
        assertEquals(s, TimerLogic.onRemoteStopped(s, "B", t0 + 1))
        assertNull(TimerLogic.onRemoteStopped(s, "A", t0 + 1).running)
        assertEquals(t0 - 5, TimerLogic.onRemoteStartUpdated(s, "A", t0 - 5, t0 + 1).running!!.startTime)
    }

    @Test fun classification() {
        assertEquals(OpOutcome.Done, TimerLogic.classify(200))
        assertEquals(OpOutcome.Unauthorized, TimerLogic.classify(401))
        assertEquals(OpOutcome.Retry, TimerLogic.classify(408))
        assertEquals(OpOutcome.Retry, TimerLogic.classify(429))
        assertEquals(OpOutcome.Retry, TimerLogic.classify(503))
        assertTrue(TimerLogic.classify(409) is OpOutcome.Rejected)
        assertTrue(TimerLogic.classify(404) is OpOutcome.Rejected)
        assertTrue(TimerLogic.classify(400) is OpOutcome.Rejected)
    }

    @Test fun backoffGrowsAndCaps() {
        assertEquals(600L, TimerLogic.backoffMs(0))
        assertEquals(960L, TimerLogic.backoffMs(1))
        assertEquals(1536L, TimerLogic.backoffMs(2))
        assertEquals(8000L, TimerLogic.backoffMs(10))
    }

    @Test fun legacyHelpers() {
        assertTrue(TimerLogic.shouldSave(0, 60_000))
        assertFalse(TimerLogic.shouldSave(0, 59_999))
        assertTrue(TimerLogic.matchesExisting(1000, 70_000, listOf(2500L to 71_500L)))
        assertFalse(TimerLogic.matchesExisting(1000, 70_000, listOf(4000L to 70_000L)))
    }

    @Test fun persistedStateRoundTrips() {
        val s = TimerPersisted(
            userId = "u", running = Running("A", t0),
            queue = listOf(TimerOp.Switch("1", "A", t0, "Z", t0 - 1), TimerOp.Stop("2", "A", t0 + 1, t0, 5), TimerOp.AdjustStart("3", "A", 7)),
            legacyServer = "https://x",
        )
        val json = co.bitterlemon.trackify.data.AppJson.encodeToString(TimerPersisted.serializer(), s)
        assertEquals(s, co.bitterlemon.trackify.data.AppJson.decodeFromString(TimerPersisted.serializer(), json))
    }
}
