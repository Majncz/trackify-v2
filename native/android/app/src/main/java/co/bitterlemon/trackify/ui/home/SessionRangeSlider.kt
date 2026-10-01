package co.bitterlemon.trackify.ui.home

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameNanos
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.ui.theme.Mono
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.util.HOUR
import co.bitterlemon.trackify.util.MINUTE
import co.bitterlemon.trackify.util.SessionRange
import co.bitterlemon.trackify.util.Span
import co.bitterlemon.trackify.util.Time
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

private enum class Drag { Start, End, Pan, Arm }

/**
 * Two-knob timeline slider (web `SessionRangeSlider`): busy blocks, minute snapping on release,
 * edge auto-scroll, and (placeInGaps) tap-to-relocate / drag-to-pan.
 */
@Composable
fun SessionRangeSlider(
    startTime: Long,
    endTime: Long,
    busy: List<Span>,
    viewFrom: Long,
    viewTo: Long,
    earliest: Long,
    onViewFrom: (Long) -> Unit,
    onStartTime: (Long) -> Unit,
    onEndTime: (Long?) -> Unit,
    modifier: Modifier = Modifier,
    endIsLive: Boolean = false,
    allowLiveEnd: Boolean = false,
    placeInGaps: Boolean = false,
    horizon: Long? = null,
    onViewTo: ((Long) -> Unit)? = null,
    enabled: Boolean = true,
) {
    val density = LocalDensity.current
    val hit = with(density) { 44.dp.toPx() }
    val inset = with(density) { 18.dp.toPx() }
    val knob = with(density) { 14.dp.toPx() }
    val trackH = with(density) { 6.dp.toPx() }
    val trackCenter = with(density) { 40.dp.toPx() }
    val closeThreshold = with(density) { 64.dp.toPx() }
    val armSlop = with(density) { 10.dp.toPx() }

    // Latest values for gesture handlers.
    val s by rememberUpdatedState(startTime)
    val e by rememberUpdatedState(endTime)
    val b by rememberUpdatedState(busy)
    val vf by rememberUpdatedState(viewFrom)
    val vt by rememberUpdatedState(viewTo)
    val earliestS by rememberUpdatedState(earliest)
    val hz by rememberUpdatedState(horizon ?: viewTo)
    val liveOk by rememberUpdatedState(allowLiveEnd)
    val setVF by rememberUpdatedState(onViewFrom)
    val setVT by rememberUpdatedState(onViewTo)
    val setS by rememberUpdatedState(onStartTime)
    val setE by rememberUpdatedState(onEndTime)

    var width by remember { mutableFloatStateOf(0f) }
    var dragging by remember { mutableStateOf<Drag?>(null) }
    var lastX by remember { mutableFloatStateOf(0f) }
    // Mutable view refs so a drag sees its own panning immediately.
    val viewRef = remember { longArrayOf(viewFrom, viewTo) }
    viewRef[0] = viewFrom; viewRef[1] = viewTo

    fun usable() = max(1f, width - inset * 2)

    fun applyDrag(kind: Drag, x: Float, snap: Boolean, panStartX: Float = 0f, panFrom: Long = 0, panTo: Long = 0) {
        if (kind == Drag.Arm) return
        if (kind == Drag.Pan) {
            val spanMs = panTo - panFrom
            val shift = (-((x - panStartX) / usable()) * spanMs).toLong()
            var nf = panFrom + shift
            var nt = panTo + shift
            if (nf < earliestS) {
                nf = earliestS; nt = nf + spanMs
            }
            if (nt > hz) {
                nt = hz; nf = nt - spanMs
            }
            viewRef[0] = nf; viewRef[1] = nt
            setVF(nf); setVT?.invoke(nt)
            return
        }
        val from = viewRef[0]
        val span = max(1L, viewRef[1] - from)
        val ratio = ((x - inset) / usable()).coerceIn(0f, 1f)
        var at = from + (ratio * span).toLong()
        if (snap) at = Time.snapMinute(at)
        if (kind == Drag.Start) {
            val lo = SessionRange.minStartForEnd(e, b, earliestS)
            val hi = e - SessionRange.MIN_DURATION
            setS(SessionRange.clampSafe(at, lo, hi))
            return
        }
        val lo = s + SessionRange.MIN_DURATION
        val hi = SessionRange.maxEndForStart(s, b, hz)
        if (liveOk && at >= viewRef[1] - MINUTE / 2) {
            setE(null); return
        }
        setE(SessionRange.clampSafe(at, lo, hi))
    }

    fun placeAt(at: Long) {
        val placed = SessionRange.relocateToTime(
            Time.snapMinute(at), max(SessionRange.MIN_DURATION, e - s), false, earliestS, hz, b,
        ) ?: return
        setS(placed.first)
        setE(placed.second)
        if (setVT != null) {
            val w = SessionRange.viewAround(placed.first, placed.second, earliestS, hz)
            viewRef[0] = w.first; viewRef[1] = w.second
            setVF(w.first); setVT?.invoke(w.second)
        }
    }

    // Edge auto-scroll while a knob is held near the edge (6 h/s).
    LaunchedEffect(dragging) {
        val kind = dragging
        if (kind != Drag.Start && kind != Drag.End) return@LaunchedEffect
        var last = withFrameNanos { it }
        while (true) {
            val now = withFrameNanos { it }
            val dt = min(0.05, (now - last) / 1e9)
            last = now
            val ratio = ((lastX - inset) / usable()).coerceIn(0f, 1f)
            val step = (6 * HOUR * dt).toLong()
            if (kind == Drag.Start && ratio <= 0.07f) {
                val from = viewRef[0]
                val lo = SessionRange.minStartForEnd(e, b, earliestS)
                if (from > lo) {
                    val nf = max(max(lo, earliestS), from - step)
                    if (nf < from) {
                        viewRef[0] = nf; setVF(nf); setS(nf)
                    }
                }
            } else if (kind == Drag.End && ratio >= 0.93f) {
                val to = viewRef[1]
                val hi = SessionRange.maxEndForStart(s, b, hz)
                if (to < hi) {
                    val nt = min(min(hi, hz), to + step)
                    if (nt > to) {
                        viewRef[1] = nt; setVT?.invoke(nt); setE(nt)
                    }
                }
            }
        }
    }

    val c = T.c
    val measurer = rememberTextMeasurer()
    val labelStyle = TextStyle(fontSize = 12.sp, color = c.foreground, fontFeatureSettings = "tnum", fontWeight = androidx.compose.ui.text.font.FontWeight.Medium)

    Canvas(
        modifier
            .fillMaxWidth()
            .height(64.dp)
            .semantics { contentDescription = "Session range ${Time.clock(startTime)} to ${if (endIsLive) "now" else Time.clock(endTime)}" }
            .pointerInput(enabled, placeInGaps) {
                if (!enabled) return@pointerInput
                awaitEachGesture {
                    val down = awaitFirstDown(requireUnconsumed = false)
                    down.consume()
                    val x = down.position.x
                    lastX = x
                    fun xFor(t: Long) = inset + ((t - viewRef[0]).toFloat() / max(1L, viewRef[1] - viewRef[0])) * usable()
                    val dStart = abs(x - xFor(s))
                    val dEnd = abs(x - xFor(e))
                    var kind = when {
                        dStart <= hit && dStart <= dEnd -> Drag.Start
                        dEnd <= hit -> Drag.End
                        placeInGaps -> Drag.Arm
                        else -> if (dStart <= dEnd) Drag.Start else Drag.End
                    }
                    val armAt = viewRef[0] + (((x - inset) / usable()).coerceIn(0f, 1f) * (viewRef[1] - viewRef[0])).toLong()
                    var panX = x
                    var panFrom = viewRef[0]
                    var panTo = viewRef[1]
                    dragging = kind
                    if (kind == Drag.Start || kind == Drag.End) applyDrag(kind, x, false)
                    var upX = x
                    while (true) {
                        val ev = awaitPointerEvent()
                        val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                        ch.consume()
                        lastX = ch.position.x
                        upX = ch.position.x
                        if (!ch.pressed) break
                        if (kind == Drag.Arm) {
                            if (abs(ch.position.x - x) < armSlop) continue
                            kind = Drag.Pan
                            dragging = kind
                            panX = x; panFrom = viewRef[0]; panTo = viewRef[1]
                        }
                        applyDrag(kind, ch.position.x, false, panX, panFrom, panTo)
                    }
                    if (kind == Drag.Arm) {
                        val onBusy = b.any { armAt >= it.from && armAt < it.to }
                        if (!onBusy) placeAt(armAt)
                    } else {
                        applyDrag(kind, upX, true, panX, panFrom, panTo)
                    }
                    dragging = null
                }
            }
    ) {
        width = size.width
        val span = max(1L, viewTo - viewFrom).toFloat()
        val usable = max(1f, size.width - inset * 2)
        fun xFor(t: Long) = inset + ((t - viewFrom) / span) * usable
        val top = trackCenter - trackH / 2
        val r = CornerRadius(trackH / 2, trackH / 2)
        drawRoundRect(c.muted, Offset(inset, top), Size(usable, trackH), r)
        if (size.width <= 40f) return@Canvas
        for (blk in busy) {
            if (blk.to <= viewFrom || blk.from >= viewTo) continue
            val l = xFor(max(blk.from, viewFrom))
            val rr = xFor(min(blk.to, viewTo))
            drawRoundRect(c.busy, Offset(l, top), Size(max(3f, rr - l), trackH), r)
        }
        val sx = xFor(startTime)
        val ex = xFor(endTime)
        drawRoundRect(c.foreground, Offset(sx, top), Size(max(2f, ex - sx), trackH), r)
        val close = ex - sx < closeThreshold
        fun knobAt(x: Float, active: Boolean) {
            val center = Offset(x, trackCenter)
            if (active) drawCircle(Color.Black.copy(alpha = 0.08f), knob + 5.dp.toPx(), center)
            drawCircle(Color.Black.copy(alpha = if (active) 0.16f else 0.12f), knob + 1.5f, center.copy(y = center.y + (if (active) 2f else 1f)))
            drawCircle(Color.Black.copy(alpha = 0.10f), knob + 1f, center)
            drawCircle(Color.White, knob, center)
        }
        fun label(x: Float, text: String, side: Int) {
            val m = measurer.measure(text, labelStyle)
            val lx = when (side) {
                -1 -> x - m.size.width - 8.dp.toPx()
                1 -> x + 8.dp.toPx()
                else -> x - m.size.width / 2f
            }.coerceIn(0f, size.width - m.size.width)
            drawText(m, topLeft = Offset(lx, 0f))
        }
        label(sx, Time.clock(startTime), if (close) -1 else 0)
        label(ex, if (endIsLive) "Now" else Time.clock(endTime), if (close) 1 else 0)
        knobAt(sx, dragging == Drag.Start)
        knobAt(ex, dragging == Drag.End)
    }
}
