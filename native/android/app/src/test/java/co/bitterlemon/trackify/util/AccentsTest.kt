package co.bitterlemon.trackify.util

import org.junit.Assert.assertEquals
import org.junit.Test

class AccentsTest {
    // WEB_AUDIT §5.3 test vectors: id, hash, group preset, race hash, race colour
    private val vectors = listOf(
        listOf("00000000-0000-0000-0000-000000000000", 1428967488L, "#4e342e", 1428967488L, "#4f46e5"),
        listOf("3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c", 182518781L, "#ef6c00", 182518781L, "#ea580c"),
        listOf("a", 97L, "#4527a0", 97L, "#dc2626"),
        listOf("abc", 96354L, "#00796b", 96354L, "#db2777"),
    )

    @Test fun hashGroupIdMatchesWeb() = vectors.forEach { v ->
        assertEquals(v[0] as String, v[1], Accents.hashGroupId(v[0] as String))
        assertEquals(v[2], Accents.groupAccentHex(v[0] as String))
        assertEquals(v[2], Accents.taskAccentHex(v[0] as String))
    }

    @Test fun raceColourMatchesWeb() = vectors.forEach { v ->
        assertEquals(v[3], Accents.raceHash(v[0] as String))
        assertEquals(v[4], Accents.colorForId(v[0] as String))
    }

    @Test fun resolveGroupAccentPrefersValidColour() {
        assertEquals("#123abc", Accents.resolveGroupAccent("a", "#123abc"))
        assertEquals("#4527a0", Accents.resolveGroupAccent("a", null))
        assertEquals("#4527a0", Accents.resolveGroupAccent("a", "red"))
        assertEquals("#4527a0", Accents.resolveGroupAccent("a", "#12345"))
    }

    @Test fun initials() {
        assertEquals("?", Accents.initials("   "))
        assertEquals("NI", Accents.initials("nina"))
        assertEquals("JR", Accents.initials("Jakub Rana"))
        assertEquals("AM", Accents.initials("Adam Rana (king of mankind)"))
    }

    @Test fun yearlyHeatFloorsWithoutPercentiles() {
        val few = listOf(10.0, 20.0)
        assertEquals(0, Accents.yearlyHeatLevel(0.0, few))
        assertEquals(1, Accents.yearlyHeatLevel(30.0, few))
        assertEquals(2, Accents.yearlyHeatLevel(180.0, few))
        assertEquals(3, Accents.yearlyHeatLevel(330.0, few))
        assertEquals(4, Accents.yearlyHeatLevel(480.0, few))
        assertEquals("#e8eee9", Accents.yearlyHeatColor(0.0, few))
        assertEquals("#052e16", Accents.yearlyHeatColor(500.0, few))
    }

    @Test fun yearlyHeatPercentiles() {
        // 10 working days: 10..100 minutes
        val sorted = Accents.workingDayMinutes((1..10).map { it * 10.0 } + listOf(0.0, 0.0))
        assertEquals(10, sorted.size)
        // p75 = sorted[ceil(7.5)-1 = 7] = 80 ; p90 = sorted[ceil(9)-1 = 8] = 90
        assertEquals(1, Accents.yearlyHeatLevel(70.0, sorted))
        assertEquals(3, Accents.yearlyHeatLevel(80.0, sorted))
        assertEquals(4, Accents.yearlyHeatLevel(90.0, sorted))
        assertEquals(4, Accents.yearlyHeatLevel(100.0, sorted))
    }

    @Test fun weeklyOpacity() {
        assertEquals(0.7, Accents.weeklyOpacity(0.0, 60.0), 1e-9)
        assertEquals(1.0, Accents.weeklyOpacity(60.0, 60.0), 1e-9)
        assertEquals(0.2 + Math.pow(0.5, 0.4) * 0.8, Accents.weeklyOpacity(30.0, 60.0), 1e-9)
    }

    @Test fun rankColours() {
        assertEquals("#d97706", Accents.rankColor(1))
        assertEquals("#71717a", Accents.rankColor(2))
        assertEquals("#92400e", Accents.rankColor(3))
        assertEquals(null, Accents.rankColor(4))
    }
}
