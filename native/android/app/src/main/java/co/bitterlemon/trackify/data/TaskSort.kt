package co.bitterlemon.trackify.data

/** Web Home order: running task first, then tasks with no events, then by most recent event start (desc). */
object TaskSort {
    fun home(tasks: List<Task>, runningTaskId: String?): List<Task> {
        return tasks.sortedWith { a, b ->
            val ar = a.id == runningTaskId
            val br = b.id == runningTaskId
            if (ar != br) return@sortedWith if (ar) -1 else 1
            val ae = a.events.isEmpty()
            val be = b.events.isEmpty()
            if (ae != be) return@sortedWith if (ae) -1 else 1
            if (ae && be) return@sortedWith 0
            val al = a.events.maxOf { it.fromMs }
            val bl = b.events.maxOf { it.fromMs }
            bl.compareTo(al)
        }
    }

    /** Most recently used task (by last event start), for "start last task". */
    fun lastUsed(tasks: List<Task>): Task? = tasks.filter { it.events.isNotEmpty() }.maxByOrNull { t -> t.events.maxOf { it.fromMs } }
}
