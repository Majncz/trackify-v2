package co.bitterlemon.trackify.billing

import co.bitterlemon.trackify.data.AiMetrics
import co.bitterlemon.trackify.data.AiPeriod
import co.bitterlemon.trackify.ui.billing.AiCadence
import co.bitterlemon.trackify.ui.billing.BillingLedger
import co.bitterlemon.trackify.ui.billing.BillingPeriod
import co.bitterlemon.trackify.ui.billing.amountText
import co.bitterlemon.trackify.ui.billing.billingRange
import co.bitterlemon.trackify.ui.billing.monthLabel
import co.bitterlemon.trackify.ui.billing.parseLineAmount
import co.bitterlemon.trackify.util.Time
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.time.LocalDate
import java.util.Locale

class BillingLogicTest {
    private val today = LocalDate.of(2026, 9, 27) // Sunday

    @Before fun locale() { Locale.setDefault(Locale.US) }

    @Test fun periodRanges() {
        val (wf, wt) = billingRange(BillingPeriod.ThisWeek, today, today, today)
        assertEquals(Time.startOfDay(LocalDate.of(2026, 9, 21)), wf)
        assertEquals(Time.endOfDay(LocalDate.of(2026, 9, 27)), wt)
        val (mf, mt) = billingRange(BillingPeriod.ThisMonth, today, today, today)
        assertEquals(Time.startOfDay(LocalDate.of(2026, 9, 1)), mf)
        assertEquals(Time.endOfDay(LocalDate.of(2026, 9, 30)), mt)
        val (lf, lt) = billingRange(BillingPeriod.LastMonth, today, today, today)
        assertEquals(Time.startOfDay(LocalDate.of(2026, 8, 1)), lf)
        assertEquals(Time.endOfDay(LocalDate.of(2026, 8, 31)), lt)
        assertEquals(null to null, billingRange(BillingPeriod.AllTime, today, today, today))
        val d = LocalDate.of(2026, 9, 3)
        assertEquals(Time.startOfDay(d) to Time.endOfDay(d), billingRange(BillingPeriod.Custom, d, d, today))
    }

    @Test fun sectionKeys() {
        assertEquals("2026-09-26", BillingLedger.key("2026-09-26", "2026-W39", "2026-09", "day"))
        assertEquals("2026-W39", BillingLedger.key("2026-09-26", "2026-W39", "2026-09", "week"))
        assertEquals("2026-09", BillingLedger.key("2026-09-26", "2026-W39", "2026-09", "month"))
    }

    @Test fun sectionLabels() {
        assertEquals("Today", BillingLedger.label("2026-09-27", "day", today))
        assertEquals("Yesterday", BillingLedger.label("2026-09-26", "day", today))
        assertEquals("Fri, Sep 25", BillingLedger.label("2026-09-25", "day", today))
        assertEquals("Wed, Dec 31, 2025", BillingLedger.label("2025-12-31", "day", today))
        assertEquals("This week · Sep 21 – Sep 27", BillingLedger.label("2026-W39", "week", today))
        assertEquals("Week 38 · Sep 14 – Sep 20", BillingLedger.label("2026-W38", "week", today))
        assertEquals("September", BillingLedger.label("2026-09", "month", today, Locale.US))
        assertEquals("December 2025", BillingLedger.label("2025-12", "month", today, Locale.US))
        assertEquals("garbage", BillingLedger.label("garbage", "day", today))
    }

    @Test fun selectionSummary() {
        val one = BillingLedger.selection(listOf(Triple(60, "CZK", 100.0), Triple(30, "CZK", 50.005)))
        assertEquals(2, one.count)
        assertEquals(90, one.minutes)
        assertEquals(150.01, one.byCurrency["CZK"]!!, 0.0001)
        assertTrue(one.ready)
        val mixed = BillingLedger.selection(listOf(Triple(60, "CZK", 100.0), Triple(30, "EUR", 5.0)))
        assertTrue(mixed.multiCurrency)
        assertFalse(mixed.ready)
        assertFalse(BillingLedger.selection(emptyList()).ready)
    }

    @Test fun lineAmounts() {
        assertEquals(12.5, parseLineAmount("12,5")!!, 0.0)
        assertEquals(12.35, parseLineAmount(" 12.345 ")!!, 0.0)
        assertEquals(0.0, parseLineAmount("0")!!, 0.0)
        assertNull(parseLineAmount("-1"))
        assertNull(parseLineAmount("abc"))
        assertNull(parseLineAmount(""))
        assertEquals("1340", amountText(1340.0))
        assertEquals("12.5", amountText(12.5))
    }

    @Test fun coverageEnd() {
        val start = LocalDate.of(2026, 8, 12) // Wednesday
        assertEquals(LocalDate.of(2026, 8, 16), AiCadence.coverageEnd(start, "weekly"))
        assertEquals(LocalDate.of(2026, 8, 31), AiCadence.coverageEnd(start, "monthly"))
        assertEquals(LocalDate.of(2026, 9, 30), AiCadence.coverageEnd(start, "quarterly"))
        assertEquals(LocalDate.of(2026, 12, 31), AiCadence.coverageEnd(start, "yearly"))
        assertEquals(LocalDate.of(2026, 8, 31), AiCadence.coverageEnd(start, "bogus"))
    }

    @Test fun periodState() {
        fun p(depleted: String?, active: Boolean) = AiPeriod(id = "1", name = "x", startsAt = "2026-01-01T00:00:00.000Z", depletedAt = depleted, metrics = AiMetrics(isActive = active))
        assertEquals("Running", AiCadence.state(p(null, true)))
        assertEquals("Depleted", AiCadence.state(p("2026-02-01T00:00:00.000Z", false)))
        assertEquals("Ended", AiCadence.state(p(null, false)))
    }

    @Test fun monthLabels() {
        assertEquals("Sep", monthLabel("2026-09"))
        assertEquals("Jan 26", monthLabel("2026-01"))
        assertEquals("September 2026", monthLabel("2026-09", full = true))
        assertEquals("oops", monthLabel("oops"))
    }
}
