package co.bitterlemon.trackify.timer

import android.content.ContextWrapper
import co.bitterlemon.trackify.data.ApiClient
import co.bitterlemon.trackify.data.AppJson
import com.sun.net.httpserver.HttpServer
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File
import java.net.InetSocketAddress
import java.util.Collections

/**
 * A server without the new timer routes (the live server today): POST /api/timer/stop and /switch answer with the
 * app's HTML 404 page, and every answer is slow. A tap must change the local state at once — the legacy fallback
 * runs later, in the background — and the queue must still end up saved the web way.
 */
class TimerEngineFallbackTest {
    private lateinit var server: HttpServer
    private lateinit var dir: File
    private val calls = Collections.synchronizedList(mutableListOf<String>())

    private val context = object : ContextWrapper(null) {
        override fun getFilesDir(): File = dir
    }

    @Before fun setUp() {
        dir = kotlin.io.path.createTempDirectory("timer").toFile()
        server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { ex ->
            val key = "${ex.requestMethod} ${ex.requestURI.path}"
            calls += key
            Thread.sleep(700) // a slow phone network
            val (code, type, body) = when (key) {
                "POST /api/timer/stop", "POST /api/timer/switch" -> Triple(404, "text/html", "<!DOCTYPE html><html>404</html>")
                "POST /api/events" -> Triple(201, "application/json", "{}")
                "DELETE /api/timer" -> Triple(200, "application/json", "{}")
                "POST /api/timer" -> Triple(200, "application/json", "{\"running\":true}")
                "GET /api/timer" -> Triple(200, "application/json", "{\"running\":false}")
                else -> Triple(500, "application/json", "{}")
            }
            ex.responseHeaders.add("Content-Type", type)
            val bytes = body.toByteArray()
            ex.sendResponseHeaders(code, bytes.size.toLong())
            ex.responseBody.use { it.write(bytes) }
        }
        server.start()
    }

    @After fun tearDown() {
        server.stop(0)
        dir.deleteRecursively()
    }

    private fun engine(): TimerEngine {
        val url = "http://127.0.0.1:${server.address.port}"
        val api = ApiClient(serverUrl = { url }, token = { "t" }, onUnauthorized = {})
        return TimerEngine(context, api, { url }, { "u1" }, {}, {}, {})
    }

    private fun waitFor(ms: Long, cond: () -> Boolean) {
        val until = System.currentTimeMillis() + ms
        while (!cond() && System.currentTimeMillis() < until) Thread.sleep(20)
    }

    @Test fun stopIsLocalAtOnceAndFallsBackToTheWebFlow() {
        val start = System.currentTimeMillis() - 5 * 60_000
        File(dir, "timer_state.json").writeText(
            AppJson.encodeToString(TimerPersisted.serializer(), TimerPersisted(userId = "u1", running = Running("A", start))),
        )
        val e = engine()
        val t0 = System.nanoTime()
        e.stop()
        val tookMs = (System.nanoTime() - t0) / 1_000_000
        assertNull("stopped locally right away", e.persisted.value.running)
        assertTrue("stop() returned in $tookMs ms (must not wait for the server)", tookMs < 100)
        assertEquals(1, e.persisted.value.queue.size)

        waitFor(15_000) { e.persisted.value.queue.isEmpty() }
        assertTrue("queue drained", e.persisted.value.queue.isEmpty())
        assertEquals(listOf("POST /api/timer/stop", "POST /api/events", "DELETE /api/timer"), calls.take(3))
        assertEquals("http://127.0.0.1:${server.address.port}", e.persisted.value.legacyServer)
    }

    @Test fun startIsLocalAtOnceAndFallsBackToTheWebFlow() {
        val e = engine()
        val t0 = System.nanoTime()
        e.start("B")
        val tookMs = (System.nanoTime() - t0) / 1_000_000
        assertEquals("B", e.persisted.value.running?.taskId)
        assertTrue("start() returned in $tookMs ms", tookMs < 100)
        waitFor(15_000) { e.persisted.value.queue.isEmpty() }
        assertTrue(e.persisted.value.queue.isEmpty())
        assertEquals(listOf("POST /api/timer/switch", "POST /api/timer"), calls.take(2))
    }
}
