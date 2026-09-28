package co.bitterlemon.trackify.util

import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors

/**
 * Small state files written off the caller's thread, in order, latest value wins per file. A widget tap updates
 * memory at once and must not wait for JSON encoding + disk on the main thread (the first encode in a fresh
 * process is slow). Callers keep the in-memory copy as the source of truth.
 */
object Persist {
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "trackify-persist").apply { isDaemon = true } }
    private val pending = ConcurrentHashMap<String, () -> Unit>()

    fun write(key: String, block: () -> Unit) {
        if (pending.put(key, block) != null) return // a write for this file is already queued: it takes the new block
        io.execute { pending.remove(key)?.invoke() }
    }
}
