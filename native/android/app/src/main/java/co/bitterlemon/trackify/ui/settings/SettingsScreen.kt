package co.bitterlemon.trackify.ui.settings

import android.content.Intent
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowBack
import androidx.compose.material.icons.automirrored.outlined.Logout
import androidx.compose.material.icons.outlined.DarkMode
import androidx.compose.material.icons.outlined.Dns
import androidx.compose.material.icons.outlined.Info
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Mail
import androidx.compose.material.icons.outlined.Notifications
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.RestartAlt
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.material.icons.outlined.Widgets
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.LifecycleResumeEffect
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.BuildConfig
import co.bitterlemon.trackify.data.ApiException
import co.bitterlemon.trackify.data.ModelInfo
import co.bitterlemon.trackify.data.Task
import co.bitterlemon.trackify.ui.auth.friendlyError
import co.bitterlemon.trackify.ui.components.BtnSize
import co.bitterlemon.trackify.ui.components.BtnVariant
import co.bitterlemon.trackify.ui.components.ErrorAlert
import co.bitterlemon.trackify.ui.components.PageHeader
import co.bitterlemon.trackify.ui.components.Segmented
import co.bitterlemon.trackify.ui.components.TButton
import co.bitterlemon.trackify.ui.components.TCard
import co.bitterlemon.trackify.ui.components.TDialog
import co.bitterlemon.trackify.ui.components.TInput
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.util.Format
import kotlinx.coroutines.launch

@Composable
private fun CardTitle(icon: ImageVector, title: String, description: String? = null) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, tint = T.c.foreground, modifier = Modifier.size(16.dp))
        Spacer(Modifier.width(8.dp))
        Text(title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, color = T.c.foreground)
    }
    if (description != null) Text(description, fontSize = 14.sp, color = T.c.mutedForeground, modifier = Modifier.padding(top = 2.dp))
    Spacer(Modifier.height(14.dp))
}

@Composable
fun SettingsScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val graph = AppGraph.get(context)
    val scope = rememberCoroutineScope()
    val session by graph.session.session.collectAsState()
    val profile by graph.repo.profile.collectAsState()
    val server by graph.session.server.collectAsState()
    val theme by graph.session.theme.collectAsState()
    var hidden by remember { mutableStateOf<List<Task>?>(null) }
    var hiddenTick by remember { mutableStateOf(0) }
    var restoring by remember { mutableStateOf<String?>(null) }
    var signingOut by remember { mutableStateOf(false) }
    var pwOpen by remember { mutableStateOf(false) }
    var deleteOpen by remember { mutableStateOf(false) }
    var model by remember { mutableStateOf<ModelInfo?>(null) }
    var notifAllowed by remember { mutableStateOf(graph.notifier.canPost()) }
    var securityUnsupported by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { graph.repo.refreshProfile(); runCatching { graph.api.model() }.onSuccess { model = it } }
    LaunchedEffect(hiddenTick) {
        runCatching { graph.api.tasks(hidden = true) }.onSuccess { list -> hidden = list.sortedByDescending { it.updatedAt ?: "" } }
    }
    LifecycleResumeEffect(Unit) {
        notifAllowed = graph.notifier.canPost()
        onPauseOrDispose { }
    }

    LazyColumn(
        Modifier.fillMaxSize(),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        item {
            Row(Modifier.widthIn(max = 896.dp).fillMaxWidth()) { TButton("Back", onBack, variant = BtnVariant.Ghost, icon = Icons.AutoMirrored.Outlined.ArrowBack) }
        }
        item { PageHeader("Settings", "Manage your account", Modifier.widthIn(max = 896.dp)) }
        item {
            TCard(Modifier.widthIn(max = 896.dp).fillMaxWidth()) {
                CardTitle(Icons.Outlined.Person, "Account", "Your account information")
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(T.c.muted.copy(alpha = 0.5f)).padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Icon(Icons.Outlined.Mail, null, tint = T.c.mutedForeground, modifier = Modifier.size(20.dp))
                    Spacer(Modifier.width(12.dp))
                    Column {
                        Text("Email", fontSize = 14.sp, color = T.c.mutedForeground)
                        Text(profile?.email?.ifEmpty { null } ?: session?.email ?: "", fontSize = 15.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
                    }
                }
                Spacer(Modifier.height(16.dp))
                DisplayNameForm(profile?.displayName ?: "")
                Spacer(Modifier.height(16.dp))
                TButton(if (signingOut) "Signing out..." else "Sign out", {
                    signingOut = true
                    scope.launch { graph.signOut() }
                }, variant = BtnVariant.Destructive, icon = Icons.AutoMirrored.Outlined.Logout, enabled = !signingOut)
            }
        }
        item {
            TCard(Modifier.widthIn(max = 896.dp).fillMaxWidth()) {
                CardTitle(Icons.Outlined.VisibilityOff, "Hidden Tasks", "Tasks you've hidden. Restore them to see them on your dashboard again.")
                val list = hidden
                when {
                    list == null -> Text("Loading...", fontSize = 14.sp, color = T.c.mutedForeground)
                    list.isEmpty() -> Text("No hidden tasks", fontSize = 14.sp, color = T.c.mutedForeground)
                    else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        list.forEach { t ->
                            Row(
                                Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(T.c.muted.copy(alpha = 0.5f)).padding(12.dp),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                Column(Modifier.weight(1f)) {
                                    Text(t.name, fontSize = 15.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
                                    Text(Format.durationWords(t.events.sumOf { it.toMs - it.fromMs }), fontSize = 14.sp, color = T.c.mutedForeground)
                                }
                                TButton(if (restoring == t.id) "Restoring..." else "Restore", {
                                    restoring = t.id
                                    scope.launch {
                                        runCatching { graph.repo.restoreTask(t.id) }
                                        restoring = null; hiddenTick++
                                    }
                                }, variant = BtnVariant.Outline, size = BtnSize.Sm, icon = Icons.Outlined.RestartAlt, enabled = restoring != t.id)
                            }
                        }
                    }
                }
            }
        }
        item {
            TCard(Modifier.widthIn(max = 896.dp).fillMaxWidth()) {
                CardTitle(Icons.Outlined.DarkMode, "Appearance", "Follow the system, or pick a theme for Trackify.")
                Segmented(listOf("system" to "System", "light" to "Light", "dark" to "Dark"), theme, { v -> scope.launch { graph.session.setTheme(v) } }, Modifier.fillMaxWidth())
            }
        }
        item {
            TCard(Modifier.widthIn(max = 896.dp).fillMaxWidth()) {
                CardTitle(Icons.Outlined.Notifications, "Notifications", "A silent, ongoing notification shows the running timer with Stop and Switch.")
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(if (notifAllowed) "Allowed" else "Turned off", fontSize = 14.sp, color = if (notifAllowed) T.c.foreground else T.c.mutedForeground, modifier = Modifier.weight(1f))
                    TButton("Open system settings", {
                        runCatching {
                            context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                        }
                    }, variant = BtnVariant.Outline, size = BtnSize.Sm)
                }
            }
        }
        item {
            TCard(Modifier.widthIn(max = 896.dp).fillMaxWidth()) {
                CardTitle(Icons.Outlined.Widgets, "Widgets & Quick Settings", "Start and stop without opening the app.")
                androidx.compose.foundation.layout.FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    TButton("Add timer widget", { pinWidget(context, co.bitterlemon.trackify.widget.SmallTimerWidgetReceiver::class.java) }, variant = BtnVariant.Outline, size = BtnSize.Sm)
                    TButton("Add tasks widget", { pinWidget(context, co.bitterlemon.trackify.widget.LargeTimerWidgetReceiver::class.java) }, variant = BtnVariant.Outline, size = BtnSize.Sm)
                    if (android.os.Build.VERSION.SDK_INT >= 33) {
                        TButton("Add Quick Settings tile", { requestTile(context) }, variant = BtnVariant.Outline, size = BtnSize.Sm)
                    }
                }
            }
        }
        if (!securityUnsupported) {
            item {
                TCard(Modifier.widthIn(max = 896.dp).fillMaxWidth()) {
                    CardTitle(Icons.Outlined.Lock, "Security")
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        TButton("Change password", { pwOpen = true }, variant = BtnVariant.Outline)
                        TButton("Delete account", { deleteOpen = true }, variant = BtnVariant.DestructiveGhost)
                    }
                }
            }
        }
        item {
            TCard(Modifier.widthIn(max = 896.dp).fillMaxWidth()) {
                CardTitle(Icons.Outlined.Dns, "Server", "Trackify syncs with this server. To use another one, sign out and open Advanced on the login screen.")
                Text(server, fontSize = 14.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
            }
        }
        item {
            TCard(Modifier.widthIn(max = 896.dp).fillMaxWidth()) {
                CardTitle(Icons.Outlined.Info, "About")
                AboutRow("App version", "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})")
                model?.let { m ->
                    m.gitShaShort?.let { AboutRow("Server build", it) }
                    m.model?.let { AboutRow("AI model", it) }
                }
                AboutRow("Signed in as", session?.email ?: "")
            }
        }
    }

    if (pwOpen) ChangePasswordDialog(onDismiss = { pwOpen = false }, onUnsupported = { securityUnsupported = true; pwOpen = false })
    if (deleteOpen) DeleteAccountDialog(onDismiss = { deleteOpen = false }, onUnsupported = { securityUnsupported = true; deleteOpen = false })
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
private fun AboutRow(k: String, v: String) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp)) {
        Text(k, fontSize = 14.sp, color = T.c.mutedForeground, modifier = Modifier.weight(1f))
        Text(v, fontSize = 14.sp, color = T.c.foreground)
    }
}

@Composable
private fun DisplayNameForm(initial: String) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    var name by remember(initial) { mutableStateOf(initial) }
    var status by remember { mutableStateOf("idle") }
    var error by remember { mutableStateOf<String?>(null) }
    val trimmed = name.trim()
    val dirty = trimmed != initial.trim()
    Column {
        Text("Display name", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = T.c.foreground)
        Spacer(Modifier.height(6.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            TInput(name, { name = it.take(40); status = "idle"; error = null }, Modifier.weight(1f), placeholder = "How others see you")
            Spacer(Modifier.width(8.dp))
            TButton(if (status == "saving") "Saving..." else "Save name", {
                status = "saving"
                scope.launch {
                    try {
                        val p = graph.api.setDisplayName(trimmed)
                        graph.repo.setProfile(graph.repo.profile.value?.copy(displayName = p.displayName) ?: p)
                        graph.repo.signalPresence()
                        status = "saved"
                    } catch (e: Exception) {
                        status = "error"; error = friendlyError(e, "Could not save name")
                    }
                }
            }, enabled = dirty && trimmed.isNotEmpty() && status != "saving")
        }
        Spacer(Modifier.height(6.dp))
        Text("Shown when you are tracking a task.", fontSize = 13.sp, color = T.c.mutedForeground)
        if (status == "saved") Text("Saved", fontSize = 14.sp, color = T.c.mutedForeground)
        error?.let { Text(it, fontSize = 14.sp, color = T.c.destructive) }
    }
}

@Composable
private fun ChangePasswordDialog(onDismiss: () -> Unit, onUnsupported: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    var current by remember { mutableStateOf("") }
    var new by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var done by remember { mutableStateOf(false) }
    TDialog(
        "Change password", onDismiss,
        footer = {
            TButton(if (done) "Close" else "Cancel", onDismiss, variant = BtnVariant.Outline)
            if (!done) TButton(if (busy) "Saving..." else "Change password", {
                error = null
                when {
                    new != confirm -> error = "Passwords do not match"
                    new.length < 6 -> error = "Password must be at least 6 characters"
                    else -> {
                        busy = true
                        scope.launch {
                            try {
                                graph.api.changePassword(current, new); done = true
                            } catch (e: ApiException) {
                                if (e.isRouteMissing) onUnsupported() else error = e.message
                            } catch (e: Exception) {
                                error = friendlyError(e, "Failed to change password")
                            }
                            busy = false
                        }
                    }
                }
            }, enabled = !busy && current.isNotEmpty() && new.isNotEmpty())
        },
    ) {
        if (done) {
            Text("Your password was changed.", fontSize = 14.sp, color = T.c.foreground)
        } else {
            TInput(current, { current = it }, label = "Current password", password = true)
            Spacer(Modifier.height(12.dp))
            TInput(new, { new = it }, label = "New password", placeholder = "At least 6 characters", password = true)
            Spacer(Modifier.height(12.dp))
            TInput(confirm, { confirm = it }, label = "Confirm new password", password = true)
            error?.let { Spacer(Modifier.height(10.dp)); Text(it, color = T.c.destructive, fontSize = 14.sp) }
        }
    }
}

@Composable
private fun DeleteAccountDialog(onDismiss: () -> Unit, onUnsupported: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    TDialog(
        "Delete account", onDismiss,
        footer = {
            TButton("Cancel", onDismiss, variant = BtnVariant.Outline)
            TButton(if (busy) "Deleting..." else "Delete account", {
                busy = true; error = null
                scope.launch {
                    try {
                        graph.api.deleteAccount(password)
                        graph.signOut()
                    } catch (e: ApiException) {
                        if (e.isRouteMissing) onUnsupported() else error = if (e.status == 403) "Incorrect password" else e.message
                    } catch (e: Exception) {
                        error = friendlyError(e, "Failed to delete account")
                    }
                    busy = false
                }
            }, variant = BtnVariant.Destructive, enabled = !busy && password.isNotEmpty())
        },
    ) {
        ErrorAlert("This can't be undone", "Your tasks, time entries, groups, billing and chats are deleted permanently.")
        Spacer(Modifier.height(12.dp))
        TInput(password, { password = it }, label = "Password", placeholder = "Enter your password to confirm", password = true)
        error?.let { Spacer(Modifier.height(10.dp)); Text(it, color = T.c.destructive, fontSize = 14.sp) }
    }
}
