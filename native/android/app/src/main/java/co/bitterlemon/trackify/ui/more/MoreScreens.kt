package co.bitterlemon.trackify.ui.more

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

@Composable
private fun Chevron() = Icon(Icons.AutoMirrored.Outlined.KeyboardArrowRight, null, tint = T.c.mutedForeground)

/** More tab: everything that isn't Timer, Stats or Team. Each row opens a full screen with Back. */
@Composable
fun MoreScreen(onOpen: (String) -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val session by graph.session.session.collectAsState()
    val profile by graph.repo.profile.collectAsState()
    Column(Modifier.fillMaxSize()) {
        ScreenBar("More")
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            item {
                // Account card (Google-app style): who is signed in; tap for Settings.
                val name = profile?.displayName?.ifBlank { null } ?: session?.email ?: ""
                androidx.compose.foundation.layout.Row(
                    Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)
                        .clip(androidx.compose.foundation.shape.RoundedCornerShape(28.dp))
                        .background(androidx.compose.material3.MaterialTheme.colorScheme.surfaceContainer)
                        .clickable { onOpen("settings") }
                        .padding(16.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    androidx.compose.foundation.layout.Box(
                        Modifier.size(48.dp).clip(androidx.compose.foundation.shape.CircleShape)
                            .background(androidx.compose.material3.MaterialTheme.colorScheme.primaryContainer),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            name.trim().firstOrNull()?.uppercase() ?: "?", fontSize = 20.sp,
                            color = androidx.compose.material3.MaterialTheme.colorScheme.onPrimaryContainer,
                        )
                    }
                    androidx.compose.foundation.layout.Spacer(Modifier.width(16.dp))
                    Column(Modifier.weight(1f)) {
                        Text(name, fontSize = 18.sp, color = T.c.foreground, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis)
                        session?.email?.let { if (it != name) Text(it, fontSize = 14.sp, color = T.c.mutedForeground, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) }
                    }
                }
            }
            item {
                Column(Modifier.widthIn(max = 720.dp).fillMaxWidth().padding(top = 8.dp)) {
                    val rows = listOf(
                        Triple("billing", "Billing", Icons.Outlined.AttachMoney),
                        Triple("chat", "AI chat", Icons.AutoMirrored.Outlined.Chat),
                        Triple("settings", "Settings", Icons.Outlined.Settings),
                        Triple("hidden", "Hidden tasks", Icons.Outlined.VisibilityOff),
                        Triple("widgets", "Widgets & tile", Icons.Outlined.Widgets),
                        Triple("about", "About", Icons.Outlined.Info),
                    )
                    rows.forEach { (route, label, icon) ->
                        ListRow(label, icon = icon, onClick = { onOpen(route) }, trailing = { Chevron() })
                    }
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
                    Column(Modifier.widthIn(max = 720.dp).fillMaxWidth()) {
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
                                    }, variant = BtnVariant.Outline, size = BtnSize.Default, icon = Icons.Outlined.RestartAlt, enabled = restoring != t.id,
                                )
                            },
                        )
                        RowDivider(inset = 20.dp)
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
                    Text(
                        "Start and stop without opening the app.", fontSize = 15.sp, color = T.c.mutedForeground,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 4.dp),
                    )
                    SectionLabel("Home screen")
                    ListRow(
                        "Timer", subtitle = "The running timer with Stop, or resume your last task in one tap",
                        icon = Icons.Outlined.SmartDisplay, onClick = { pinWidget(context, co.bitterlemon.trackify.widget.SmallTimerWidgetReceiver::class.java) },
                        trailing = { AddChip() },
                    )
                    ListRow(
                        "Timer and tasks", subtitle = "The running timer and your recent tasks: tap one to switch",
                        icon = Icons.Outlined.ViewAgenda, onClick = { pinWidget(context, co.bitterlemon.trackify.widget.LargeTimerWidgetReceiver::class.java) },
                        trailing = { AddChip() },
                    )
                    if (android.os.Build.VERSION.SDK_INT >= 33) {
                        SectionLabel("Quick Settings")
                        ListRow(
                            "Trackify tile", subtitle = "Tap to stop, or start your last task",
                            icon = Icons.Outlined.Tune, onClick = { requestTile(context) },
                            trailing = { AddChip() },
                        )
                    }
                    Text(
                        "Widgets use your wallpaper colours. Force light or dark in Settings → Appearance.", fontSize = 13.sp, color = T.c.mutedForeground,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 16.dp),
                    )
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
                    Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) {
                        Wordmark(28)
                        Text("Version ${BuildConfig.VERSION_NAME}", fontSize = 16.sp, color = T.c.foreground, modifier = Modifier.padding(top = 4.dp))
                    }
                    RowDivider()
                    AboutRow("App version", BuildConfig.VERSION_NAME)
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

@Composable
private fun AboutRow(k: String, v: String) {
    ListRow(k, trailing = { Text(v, fontSize = 15.sp, color = T.c.mutedForeground, maxLines = 1) })
    RowDivider(inset = 20.dp)
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
        "Add", fontSize = 14.sp, color = androidx.compose.material3.MaterialTheme.colorScheme.onSecondaryContainer,
        modifier = Modifier.clip(androidx.compose.foundation.shape.RoundedCornerShape(50))
            .background(androidx.compose.material3.MaterialTheme.colorScheme.secondaryContainer)
            .padding(horizontal = 16.dp, vertical = 8.dp),
    )
}
