package co.bitterlemon.trackify.widget

import android.appwidget.AppWidgetManager
import android.content.Context
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.unit.DpSize
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.glance.GlanceId
import androidx.glance.GlanceModifier
import androidx.glance.LocalSize
import androidx.glance.action.clickable
import androidx.glance.appwidget.GlanceAppWidget
import androidx.glance.appwidget.GlanceAppWidgetReceiver
import androidx.glance.appwidget.SizeMode
import androidx.glance.appwidget.provideContent
import androidx.glance.layout.Alignment
import androidx.glance.layout.Box
import androidx.glance.layout.Column
import androidx.glance.layout.Row
import androidx.glance.layout.Spacer
import androidx.glance.layout.fillMaxSize
import androidx.glance.layout.fillMaxWidth
import androidx.glance.layout.height
import androidx.glance.layout.width
import androidx.glance.text.FontWeight
import androidx.glance.text.Text
import androidx.glance.text.TextAlign
import androidx.glance.text.TextStyle
import androidx.glance.unit.ColorProvider
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.util.Accents
import kotlinx.coroutines.launch
import kotlin.math.floor
import kotlin.math.min

/*
 * The team's day (the Team tab's daily leaderboard): "Team · today" with the team total, then one row per
 * member sorted by hours — a colour initial, the name, today's time, and a green dot with the current task while
 * they track. Shown in its own "Team today" widget and under the tasks on a tall "Timer and tasks".
 * Tapping opens the Team tab.
 */

private const val TEAM_ROUTE = "tab_team"

internal fun openTeam(context: Context) = openApp(context, TEAM_ROUTE)

@Composable
private fun Avatar(m: TeamMember, size: Int = 24) {
    Box(
        GlanceModifier.circle(ColorProvider(accent(Accents.colorForId(m.userId))), size.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            Accents.initials(m.name).take(1),
            style = TextStyle(color = ColorProvider(androidx.compose.ui.graphics.Color.White), fontSize = (size * 0.45f).sp, fontWeight = FontWeight.Medium, textAlign = TextAlign.Center),
        )
    }
}

@Composable
private fun MemberRow(m: TeamMember, me: Boolean, height: Int, now: Long, short: Boolean = false) {
    Row(GlanceModifier.fillMaxWidth().height(height.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(m)
        Spacer(GlanceModifier.width(10.dp))
        Column(GlanceModifier.defaultWeight()) {
            Txt(if (short) firstName(m.name) else m.name, P.fg, 14, if (me) FontWeight.Bold else FontWeight.Normal)
            if (m.live) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    DotP(P.live, 6.dp)
                    Spacer(GlanceModifier.width(5.dp))
                    Txt(m.taskName ?: "Tracking", P.muted, 12)
                }
            }
        }
        Spacer(GlanceModifier.width(8.dp))
        Txt(hm(m.todayLive(now)), if (m.live) P.fg else P.muted, 13, if (m.live) FontWeight.Medium else FontWeight.Normal)
    }
}

/** "Nina" for narrow widgets (full names don't fit next to the hours). */
private fun firstName(name: String): String = name.trim().substringBefore(' ').ifEmpty { name }

/** One line: initial · name · green dot while tracking · hours (4×1). */
@Composable
private fun CompactMemberRow(m: TeamMember, me: Boolean, now: Long) {
    Row(GlanceModifier.fillMaxWidth().height(34.dp), verticalAlignment = Alignment.CenterVertically) {
        Avatar(m, 20)
        Spacer(GlanceModifier.width(8.dp))
        Txt(m.name, P.fg, 14, if (me) FontWeight.Bold else FontWeight.Normal, modifier = GlanceModifier.defaultWeight())
        if (m.live) {
            Spacer(GlanceModifier.width(6.dp)); DotP(P.live, 7.dp)
        }
        Spacer(GlanceModifier.width(8.dp))
        Txt(hm(m.todayLive(now)), if (m.live) P.fg else P.muted, 13)
    }
}

/** Header + up to [rows] member rows (the large timer widget and the Team widget share it). */
@Composable
internal fun TeamSection(context: Context, team: TeamSnapshotData, members: List<TeamMember>, rows: Int, rowH: Int, now: Long) {
    Column(GlanceModifier.fillMaxWidth().clickable(openTeam(context))) {
        Header("Team · today", if (members.isEmpty()) null else hm(team.totalMs(now)))
        Spacer(GlanceModifier.height(4.dp))
        if (members.isEmpty()) {
            Row(GlanceModifier.fillMaxWidth().height(rowH.dp), verticalAlignment = Alignment.CenterVertically) {
                Txt("Nobody has tracked time today yet", P.muted, 13, maxLines = 2)
            }
        } else {
            Column(GlanceModifier.fillMaxWidth()) {
                members.take(min(rows, 10)).forEach { MemberRow(it, it.userId == team.myId, rowH, now) }
            }
        }
    }
}

@Composable
internal fun TeamContent(context: Context, snap: WidgetSnapshotData, team: TeamSnapshotData) {
    if (!snap.signedIn) return Message(context, "Not signed in", "Open Trackify to sign in")
    val size = LocalSize.current
    val now = System.currentTimeMillis()
    val members = team.rows(now)
    val live = members.count { it.live }
    val fs = fontScale(context)
    val h = size.height.value
    Card(GlanceModifier.clickable(openTeam(context)), padding = if (h < BAR) 14.dp else 16.dp) {
        Column(GlanceModifier.fillMaxSize()) {
            when {
                !team.loaded -> {
                    Txt("Team · today", P.muted, 13, FontWeight.Medium)
                    Spacer(GlanceModifier.defaultWeight())
                    Txt("Loading…", P.muted, 13)
                }
                h < BAR && size.width.value < WIDE -> {
                    // 2×1: the total and how many are tracking now.
                    Column(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                        Txt("Team · today", P.muted, 12, FontWeight.Medium)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Txt(hm(team.totalMs(now)), P.fg, 22, FontWeight.Medium)
                            if (live > 0) {
                                Spacer(GlanceModifier.width(10.dp))
                                DotP(P.live, 7.dp); Spacer(GlanceModifier.width(5.dp))
                                Txt("$live", P.muted, 13)
                            }
                        }
                    }
                }
                h < BAR -> {
                    // 4×1: the total on the left, the top members on the right (like the 4×1 timer).
                    val rows = floor((h - 28) / 34f).toInt().coerceIn(1, 2)
                    Row(GlanceModifier.fillMaxSize(), verticalAlignment = Alignment.CenterVertically) {
                        Column(GlanceModifier.width(112.dp)) {
                            Txt("Team · today", P.muted, 12, FontWeight.Medium)
                            Txt(hm(team.totalMs(now)), P.fg, 24, FontWeight.Medium)
                        }
                        Spacer(GlanceModifier.width(8.dp))
                        Column(GlanceModifier.defaultWeight(), verticalAlignment = Alignment.CenterVertically) {
                            if (members.isEmpty()) Txt("Nobody has tracked time today yet", P.muted, 13, maxLines = 2)
                            members.take(rows).forEach { CompactMemberRow(it, it.userId == team.myId, now) }
                        }
                    }
                }
                else -> {
                    val rowH = if (fs > 1.15f) 46 else 42
                    // Big total on top (Mac "Not tracking" style), then the members.
                    Row(GlanceModifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Txt("Team · today", P.muted, 13, FontWeight.Medium, modifier = GlanceModifier.defaultWeight())
                        if (live > 0) {
                            DotP(P.live, 7.dp); Spacer(GlanceModifier.width(5.dp))
                            Txt(if (size.width.value >= WIDE) "$live tracking" else "$live", P.muted, 12)
                        }
                    }
                    Txt(hm(team.totalMs(now)), P.fg, 28, FontWeight.Medium)
                    Divider(8.dp)
                    val top = (18 + 38) * fs + 17
                    val rows = floor((h - 32 - top) / rowH).toInt().coerceAtLeast(1)
                    if (members.isEmpty()) Txt("Nobody has tracked time today yet", P.muted, 13, maxLines = 2)
                    else Column(GlanceModifier.fillMaxWidth()) {
                        // (Glance allows at most 10 children per Column.)
                        members.take(min(rows, 10)).forEach { MemberRow(it, it.userId == team.myId, rowH, now, short = size.width.value < WIDE) }
                    }
                }
            }
        }
    }
}

class TeamWidget : GlanceAppWidget() {
    override val sizeMode: SizeMode = SizeMode.Exact
    override val previewSizeMode = SizeMode.Responsive(setOf(DpSize(320.dp, 220.dp)))

    override suspend fun provideGlance(context: Context, id: GlanceId) {
        val flow = WidgetSnapshot.flow(context)
        val teamFlow = TeamSnapshot.flow(context)
        provideContent {
            val snap by flow.collectAsState()
            val team by teamFlow.collectAsState()
            val data = snap ?: WidgetSnapshot.read(context)
            Themed(context, data.theme) { TeamContent(context, data, team ?: TeamSnapshotData()) }
        }
    }

    override suspend fun providePreview(context: Context, widgetCategory: Int) {
        provideContent { Themed(context, "system") { TeamContent(context, PreviewData.running, PreviewData.team) } }
    }
}

/** Receivers of widgets that show the team: keep the team data fresh while one is placed. */
abstract class TeamAwareReceiver : GlanceAppWidgetReceiver() {
    override fun onUpdate(context: Context, appWidgetManager: AppWidgetManager, appWidgetIds: IntArray) {
        super.onUpdate(context, appWidgetManager, appWidgetIds)
        val g = AppGraph.get(context)
        g.scope.launch {
            TeamRefreshWorker.ensure(context)
            TeamSnapshot.refresh(context, minGapMs = 60_000)
        }
    }

    override fun onDisabled(context: Context) {
        super.onDisabled(context)
        val g = AppGraph.get(context)
        g.scope.launch { if (!TeamSnapshot.anyTeamWidget(context)) TeamRefreshWorker.cancel(context) }
    }
}

class TeamWidgetReceiver : TeamAwareReceiver() {
    override val glanceAppWidget: GlanceAppWidget = TeamWidget()
}
