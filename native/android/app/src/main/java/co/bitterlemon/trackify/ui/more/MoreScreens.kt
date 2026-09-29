package co.bitterlemon.trackify.ui.more

import androidx.compose.material.icons.outlined.MonetizationOn
import co.bitterlemon.trackify.ui.components.Section
import co.bitterlemon.trackify.ui.components.SectionDivider
import co.bitterlemon.trackify.ui.components.SectionFooter
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.ui.draw.clip
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.automirrored.outlined.KeyboardArrowRight
import androidx.compose.material.icons.outlined.AttachMoney
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.SmartDisplay
import androidx.compose.material.icons.outlined.Tune
import androidx.compose.material.icons.outlined.ViewAgenda
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material.icons.outlined.Widgets
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.BuildConfig
import co.bitterlemon.trackify.data.ModelInfo
import co.bitterlemon.trackify.data.Task
import co.bitterlemon.trackify.ui.components.BtnSize
import co.bitterlemon.trackify.ui.components.BtnVariant
import co.bitterlemon.trackify.ui.components.ListRow
import co.bitterlemon.trackify.ui.components.RowDivider
import co.bitterlemon.trackify.ui.components.ScreenBar
import co.bitterlemon.trackify.ui.components.SectionLabel
import co.bitterlemon.trackify.ui.components.TButton
import co.bitterlemon.trackify.ui.components.Wordmark
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.util.Format
import kotlinx.coroutines.launch

/** More tab (iOS): grouped sections of rows with a leading icon and a chevron; the account email underneath. */
@Composable
fun MoreScreen(onOpen: (String) -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val session by graph.session.session.collectAsState()
    Column(Modifier.fillMaxSize()) {
        ScreenBar("More")
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            item {
                Column(Modifier.widthIn(max = 720.dp).fillMaxWidth()) {
                    val groups = listOf(
                        listOf(
                            Triple("billing", "Billing", Icons.Outlined.MonetizationOn),
                            Triple("chat", "AI chat", Icons.AutoMirrored.Outlined.Chat),
                        ),
                        listOf(
                            Triple("settings", "Settings", Icons.Outlined.Settings),
                            Triple("hidden", "Hidden tasks", Icons.Outlined.VisibilityOff),
                            Triple("widgets", "Widgets & tile", Icons.Outlined.Widgets),
                        ),
                        listOf(Triple("about", "About", Icons.Outlined.Info)),
                    )
                    groups.forEachIndexed { gi, rows ->
                        Section(topGap = if (gi == 0) 8.dp else 20.dp) {
                            rows.forEachIndexed { i, (route, label, icon) ->
                                if (i > 0) SectionDivider(icon = true)
                                ListRow(label, icon = icon, onClick = { onOpen(route) }, chevron = true)
                            }
                        }
                    }
                    session?.email?.let { SectionFooter(it) }
                }
            }
        }
    }
}

@Composable
fun HiddenTasksScreen(onBack: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    var hidden by remember { mutableStateOf<List<Task>?>(null) }
    var tick by remember { mutableIntStateOf(0) }
    var restoring by remember { mutableStateOf<String?>(null) }
    var failed by remember { mutableStateOf(false) }
    LaunchedEffect(tick) {
        runCatching { graph.api.tasks(hidden = true) }
            .onSuccess { list -> hidden = list.sortedByDescending { it.updatedAt ?: "" }; failed = false }
            .onFailure { failed = hidden == null }
    }
    Column(Modifier.fillMaxSize()) {
        ScreenBar("Hidden tasks", onBack = onBack)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            val list = hidden
            when {
                failed -> item { Text("Couldn't load hidden tasks.", fontSize = 15.sp, color = T.c.destructive, modifier = Modifier.padding(20.dp)) }
                list == null -> item { Text("Loading…", fontSize = 15.sp, color = T.c.mutedForeground, modifier = Modifier.padding(20.dp)) }
                list.isEmpty() -> item {
                    Text("No hidden tasks. Tasks you hide from the Timer list show up here.", fontSize = 15.sp, color = T.c.mutedForeground, modifier = Modifier.widthIn(max = 720.dp).padding(20.dp))
                }
                else -> items(list, key = { it.id }) { t ->
                    Column(
                        Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(horizontal = 16.dp)
                            .then(
                                when (t.id) {
                                    list.first().id -> Modifier.padding(top = 8.dp).clip(androidx.compose.foundation.shape.RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp, bottomStart = if (list.size == 1) 22.dp else 0.dp, bottomEnd = if (list.size == 1) 22.dp else 0.dp))
                                    list.last().id -> Modifier.clip(androidx.compose.foundation.shape.RoundedCornerShape(bottomStart = 22.dp, bottomEnd = 22.dp))
                                    else -> Modifier
                                },
                            )
                            .background(T.c.cell),
                    ) {
                        if (t.id != list.first().id) SectionDivider()
                        ListRow(
                            t.name, subtitle = Format.durationWords(t.events.sumOf { it.toMs - it.fromMs }) + " total",
                            trailing = {
                                TButton(
                                    if (restoring == t.id) "Restoring…" else "Restore", {
                                        restoring = t.id
                                        scope.launch {
                                            runCatching { graph.repo.restoreTask(t.id) }
                                            restoring = null; tick++
                                        }
                                    }, variant = BtnVariant.Outline, size = BtnSize.Sm, enabled = restoring != t.id,
                                )
                            },
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun WidgetsScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    Column(Modifier.fillMaxSize()) {
        ScreenBar("Widgets & tile", onBack = onBack)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            item {
                Column(Modifier.widthIn(max = 720.dp).fillMaxWidth()) {
                    Section(header = "Home screen", footer = "Start and stop without opening the app.") {
                        ListRow(
                            "Timer", subtitle = "The running timer with Stop, or resume your last task in one tap",
                            icon = Icons.Outlined.SmartDisplay, onClick = { pinWidget(context, co.bitterlemon.trackify.widget.SmallTimerWidgetReceiver::class.java) },
                            trailing = { AddChip() },
                        )
                        SectionDivider(icon = true)
                        ListRow(
                            "Timer and tasks", subtitle = "Timer, tasks (tap one to switch), a work heat map and the team's day",
                            icon = Icons.Outlined.ViewAgenda, onClick = { pinWidget(context, co.bitterlemon.trackify.widget.LargeTimerWidgetReceiver::class.java) },
                            trailing = { AddChip() },
                        )
                        SectionDivider(icon = true)
                        ListRow(
                            "Team today", subtitle = "Who's tracking and the team's hours today",
                            icon = Icons.Outlined.Groups, onClick = { pinWidget(context, co.bitterlemon.trackify.widget.TeamWidgetReceiver::class.java) },
                            trailing = { AddChip() },
                        )
                    }
                    if (android.os.Build.VERSION.SDK_INT >= 33) {
                        Section(header = "Quick Settings", footer = "Widgets follow your phone's light or dark mode. Force one in Settings → Appearance.") {
                            ListRow(
                                "Trackify tile", subtitle = "Tap to stop, or start your last task",
                                icon = Icons.Outlined.Tune, onClick = { requestTile(context) },
                                trailing = { AddChip() },
                            )
                        }
                    } else {
                        SectionFooter("Widgets follow your phone's light or dark mode. Force one in Settings → Appearance.")
                    }
                }
            }
        }
    }
}

@Composable
fun AboutScreen(onBack: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val session by graph.session.session.collectAsState()
    val server by graph.session.server.collectAsState()
    var model by remember { mutableStateOf<ModelInfo?>(null) }
    LaunchedEffect(Unit) { runCatching { graph.api.model() }.onSuccess { model = it } }
    Column(Modifier.fillMaxSize()) {
        ScreenBar("About", onBack = onBack)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            item {
                Column(Modifier.widthIn(max = 720.dp).fillMaxWidth()) {
                    Column(Modifier.fillMaxWidth().padding(top = 16.dp, bottom = 4.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Wordmark(30)
                        Text("Version ${BuildConfig.VERSION_NAME}", fontSize = 15.sp, color = T.c.mutedForeground, modifier = Modifier.padding(top = 4.dp))
                    }
                    Section {
                        AboutRow("App version", BuildConfig.VERSION_NAME, first = true)
                        AboutRow("Build", BuildConfig.VERSION_CODE.toString())
                        model?.gitShaShort?.let { AboutRow("Server build", it) }
                        model?.model?.let { AboutRow("AI model", it) }
                        AboutRow("Server", server)
                        AboutRow("Signed in as", session?.email ?: "")
                    }
                }
            }
        }
    }
}

@Composable
private fun AboutRow(k: String, v: String, first: Boolean = false) {
    if (!first) SectionDivider()
    ListRow(k, value = v)
}

private fun pinWidget(context: android.content.Context, receiver: Class<*>) {
    val mgr = android.appwidget.AppWidgetManager.getInstance(context)
    if (mgr.isRequestPinAppWidgetSupported) {
        mgr.requestPinAppWidget(android.content.ComponentName(context, receiver), null, null)
    } else {
        android.widget.Toast.makeText(context, "Long-press your home screen and pick Widgets → Trackify.", android.widget.Toast.LENGTH_LONG).show()
    }
}

private fun requestTile(context: android.content.Context) {
    if (android.os.Build.VERSION.SDK_INT < 33) return
    val sbm = context.getSystemService(android.app.StatusBarManager::class.java) ?: return
    sbm.requestAddTileService(
        android.content.ComponentName(context, co.bitterlemon.trackify.tile.TimerTileService::class.java),
        "Trackify",
        android.graphics.drawable.Icon.createWithResource(context, co.bitterlemon.trackify.R.drawable.ic_stat_timer),
        context.mainExecutor,
    ) { }
}

@Composable
private fun AddChip() {
    Text(
        "Add", fontSize = 15.sp, fontWeight = androidx.compose.ui.text.font.FontWeight.SemiBold, color = T.c.foreground,
        modifier = Modifier.clip(androidx.compose.foundation.shape.RoundedCornerShape(50))
            .background(T.c.fill)
            .padding(horizontal = 16.dp, vertical = 7.dp),
    )
}
