package co.bitterlemon.trackify.util

import kotlin.math.abs
import kotlin.math.ceil
import kotlin.math.max
import kotlin.math.min

/** Accent / palette algorithms ported exactly from the web (WEB_AUDIT §5.3, §1.5.1). */
object Accents {
    val GROUP_COLOR_PRESETS = listOf(
        "#c62828", "#ef6c00", "#f9a825", "#558b2f", "#00796b",
        "#0277bd", "#ad1457", "#4527a0", "#4e342e", "#37474f",
    )

    /** Chart task palette (Home Time Spent + Stats). */
    val TASK_COLORS = listOf("#3b82f6", "#f97316", "#10b981", "#8b5cf6", "#ec4899", "#14b8a6")
    const val OTHER_COLOR = "#6b7280"

    val RACE_PALETTE = listOf(
        "#2563eb", "#ea580c", "#059669", "#7c3aed", "#db2777",
        "#0891b2", "#ca8a04", "#dc2626", "#4f46e5", "#65a30d",
    )

    val YEARLY_HEAT_COLORS = listOf("#e8eee9", "#86efac", "#22c55e", "#15803d", "#052e16")

    /** Default preview for "Auto" colour when creating a group. */
    const val AUTO_CREATE_PREVIEW = "#94a3b8"

    private val HEX_RE = Regex("^#[0-9A-Fa-f]{6}$")

    /** JS: `h = Math.imul(31, h) + id.charCodeAt(i)`; `Math.abs(h)`. The add is not wrapped. */
    fun hashGroupId(id: String): Long {
        var h = 0L
        for (c in id) {
            val h32 = h.toInt() // ToInt32 (truncating)
            h = (h32 * 31).toLong() + c.code.toLong()
        }
        return abs(h)
    }

    fun groupAccentHex(groupId: String): String = GROUP_COLOR_PRESETS[(hashGroupId(groupId) % GROUP_COLOR_PRESETS.size).toInt()]
    fun taskAccentHex(taskId: String): String = GROUP_COLOR_PRESETS[(hashGroupId(taskId) % GROUP_COLOR_PRESETS.size).toInt()]

    fun isValidHex(color: String?): Boolean = color != null && HEX_RE.matches(color.trim())

    fun resolveGroupAccent(id: String, color: String?): String {
        val c = color?.trim()
        return if (c != null && HEX_RE.matches(c)) c else groupAccentHex(id)
    }

    /** `(hash * 31 + c) >>> 0` as UInt32. */
    fun raceHash(id: String): Long {
        var hash = 0L
        for (c in id) {
            hash = (hash * 31 + c.code) and 0xFFFFFFFFL
        }
        return hash
    }

    fun colorForId(id: String): String = RACE_PALETTE[(raceHash(id) % RACE_PALETTE.size).toInt()]

    fun initials(name: String): String {
        val parts = name.trim().split(Regex("\\s+")).filter { it.isNotEmpty() }
        if (parts.isEmpty()) return "?"
        if (parts.size == 1) return parts[0].take(2).uppercase()
        return "${parts.first().first()}${parts.last().first()}".uppercase()
    }

    // ---- Yearly heat colour ----

    fun workingDayMinutes(values: Iterable<Double>): List<Double> = values.filter { it > 0 }.sorted()

    private fun percentile(sorted: List<Double>, p: Double): Double {
        if (sorted.isEmpty()) return 0.0
        val index = min(sorted.size - 1, max(0, ceil(p * sorted.size).toInt() - 1))
        return sorted[index]
    }

    fun yearlyHeatLevel(minutes: Double, workingSorted: List<Double>): Int {
        if (minutes <= 0) return 0
        var level = 1
        if (minutes >= 3 * 60) level = 2
        if (minutes >= 5.5 * 60) level = 3
        if (minutes >= 8 * 60) level = 4
        if (workingSorted.size >= 8) {
            val p75 = percentile(workingSorted, 0.75)
            val p90 = percentile(workingSorted, 0.9)
            if (minutes >= p90 && p90 > 0) level = 4
            else if (minutes >= p75 && p75 > 0) level = if (level < 3) 3 else level
        }
        return level
    }

    fun yearlyHeatColor(minutes: Double, workingSorted: List<Double>): String =
        YEARLY_HEAT_COLORS[yearlyHeatLevel(minutes, workingSorted)]

    /** Leaderboard rank colours: amber-600, zinc-500, amber-800; null = plain. */
    fun rankColor(rank: Int): String? = when (rank) {
        1 -> "#d97706"
        2 -> "#71717a"
        3 -> "#92400e"
        else -> null
    }

    /** Weekly heat opacity: `0.2 + (min/maxMin)^0.4 × 0.8`. */
    fun weeklyOpacity(minutes: Double, maxMinutes: Double): Double =
        if (minutes <= 0 || maxMinutes <= 0) 0.7 else 0.2 + Math.pow(minutes / maxMinutes, 0.4) * 0.8

    fun parseHex(hex: String): Int? {
        val m = Regex("^#?([0-9a-fA-F]{6})$").find(hex.trim()) ?: return null
        return m.groupValues[1].toInt(16)
    }
}
