package co.bitterlemon.trackify.timer

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.PlayArrow
import androidx.compose.material.icons.outlined.Stop
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.TaskSort
import co.bitterlemon.trackify.ui.components.AccentDot
import co.bitterlemon.trackify.ui.components.TInput
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.ui.theme.Tabular
import co.bitterlemon.trackify.ui.theme.TrackifyTheme
import co.bitterlemon.trackify.ui.theme.hexColor
import co.bitterlemon.trackify.util.Format
import co.bitterlemon.trackify.util.Time

/** "Switch…" from the notification: a compact task picker that switches (or stops) and closes. */
class QuickPickerActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val graph = AppGraph.get(this)
        if (graph.session.session.value == null) {
            finish(); return
        }
        setContent {
            val theme by graph.session.theme.collectAsState()
            TrackifyTheme(theme) {
                val tasks by graph.repo.tasks.collectAsState()
                val timer by graph.engine.ui.collectAsState()
                var query by remember { mutableStateOf("") }
                val sorted = TaskSort.home(tasks ?: emptyList(), timer.running?.taskId)
                    .filter { query.isBlank() || it.name.contains(query.trim(), ignoreCase = true) }
                val today = Time.today()
                Box(
                    Modifier.fillMaxSize().clickable(indication = null, interactionSource = null) { finish() }.systemBarsPadding().imePadding().padding(16.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Column(
                        Modifier.widthIn(max = 420.dp).fillMaxWidth().heightIn(max = 560.dp)
                            .shadow(16.dp, RoundedCornerShape(14.dp)).clip(RoundedCornerShape(14.dp)).background(T.c.card)
                            .border(1.dp, T.c.border, RoundedCornerShape(14.dp))
                            .clickable(indication = null, interactionSource = null) {}
                            .padding(16.dp),
                    ) {
                        Text("Switch task", fontSize = 18.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
                        Spacer(Modifier.size(10.dp))
                        TInput(query, { query = it }, placeholder = "Filter tasks…")
                        Spacer(Modifier.size(8.dp))
                        LazyColumn(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            items(sorted, key = { it.id }) { t ->
                                val running = t.id == timer.running?.taskId
                                val todayMs = t.events.sumOf { Time.overlap(it.fromMs, it.toMs, Time.startOfDay(today), Time.endOfDay(today) + 1) }
                                Row(
                                    Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp))
                                        .background(if (running) T.c.emerald.copy(alpha = 0.1f) else T.c.card)
                                        .clickable {
                                            TimerTap.tap(this@QuickPickerActivity, if (running) TimerTap.Op.STOP else TimerTap.Op.START, t.id, "picker")
                                            finish()
                                        }
                                        .padding(horizontal = 10.dp, vertical = 12.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    AccentDot(hexColor(t.accent))
                                    Spacer(Modifier.width(10.dp))
                                    Text(t.name, fontSize = 15.sp, color = T.c.foreground, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                    if (todayMs > 0) Text(Format.durationWords(todayMs), fontSize = 12.sp, color = T.c.mutedForeground, style = Tabular)
                                    Spacer(Modifier.width(8.dp))
                                    Icon(if (running) Icons.Outlined.Stop else Icons.Outlined.PlayArrow, if (running) "Stop" else "Start", tint = if (running) T.c.destructive else T.c.foreground, modifier = Modifier.size(18.dp))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
