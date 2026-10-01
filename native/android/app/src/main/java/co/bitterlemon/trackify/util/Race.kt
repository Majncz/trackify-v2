package co.bitterlemon.trackify.util

import co.bitterlemon.trackify.data.RaceEvent
import co.bitterlemon.trackify.data.RaceUser

data class RaceRow(val id: String, val name: String, val color: String, val ms: Long)

/** Bar race helpers (web `lib/bar-race.ts`). */
object Race {
    fun mergeIntervals(events: List<RaceEvent>): List<RaceEvent> =
        events.groupBy { it.userId }.flatMap { (uid, list) ->
            val sorted = list.sortedWith(compareBy({ it.from }, { it.to }))
            val out = ArrayList<RaceEvent>()
            var cur = RaceEvent(uid, sorted[0].from, sorted[0].to)
            for (e in sorted.drop(1)) {
                cur = if (e.from <= cur.to) cur.copy(to = maxOf(cur.to, e.to)) else {
                    out.add(cur); RaceEvent(uid, e.from, e.to)
                }
            }
            out.add(cur)
            out
        }

    fun totalsAt(byUser: Map<String, List<RaceEvent>>, users: List<RaceUser>, rangeStart: Long, at: Long): List<RaceRow> =
        users.map { u ->
            val ms = byUser[u.id]?.sumOf { Time.liveOverlapMs(it.from, it.to, rangeStart, at) } ?: 0L
            RaceRow(u.id, u.name, u.color ?: Accents.colorForId(u.id), ms)
        }.sortedWith(compareByDescending<RaceRow> { it.ms }.thenBy { it.name })
}
