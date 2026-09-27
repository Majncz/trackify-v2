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
import co.bitterlemon.trackify.ui.components.ConfirmDialog
import co.bitterlemon.trackify.ui.components.ListRow
import co.bitterlemon.trackify.ui.components.RowDivider
import co.bitterlemon.trackify.ui.components.ScreenBar
import co.bitterlemon.trackify.ui.components.SectionLabel
import androidx.compose.foundation.layout.Box
import androidx.compose.material.icons.automirrored.outlined.OpenInNew
import androidx.compose.material.icons.outlined.DeleteForever
import co.bitterlemon.trackify.ui.components.Segmented
import co.bitterlemon.trackify.ui.components.TButton
import co.bitterlemon.trackify.ui.components.TCard
import co.bitterlemon.trackify.ui.components.TDialog
import co.bitterlemon.trackify.ui.components.TInput
import co.bitterlemon.trackify.ui.theme.T
import co.bitterlemon.trackify.util.Format
import kotlinx.coroutines.launch

@Composable
fun SettingsScreen(onBack: () -> Unit) {
    val context = LocalContext.current
    val graph = AppGraph.get(context)
    val scope = rememberCoroutineScope()
    val session by graph.session.session.collectAsState()
    val profile by graph.repo.profile.collectAsState()
    val server by graph.session.server.collectAsState()
    val theme by graph.session.theme.collectAsState()
    val widgetTheme by graph.session.widgetTheme.collectAsState()
    var signingOut by remember { mutableStateOf(false) }
    var confirmSignOut by remember { mutableStateOf(false) }
    var pwOpen by remember { mutableStateOf(false) }
    var deleteOpen by remember { mutableStateOf(false) }
    var notifAllowed by remember { mutableStateOf(graph.notifier.canPost()) }
    var securityUnsupported by remember { mutableStateOf(false) }

    LaunchedEffect(Unit) { graph.repo.refreshProfile() }
    LifecycleResumeEffect(Unit) {
        notifAllowed = graph.notifier.canPost()
        onPauseOrDispose { }
    }

    Column(Modifier.fillMaxSize()) {
        ScreenBar("Settings", onBack = onBack)
        LazyColumn(
            Modifier.fillMaxSize(),
            contentPadding = PaddingValues(bottom = 32.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            item {
                Column(Modifier.widthIn(max = 720.dp).fillMaxWidth()) {
                    SectionLabel("Account")
                    ListRow(profile?.email?.ifEmpty { null } ?: session?.email ?: "", subtitle = "Email", icon = Icons.Outlined.Mail)
                    Box(Modifier.padding(horizontal = 16.dp, vertical = 8.dp)) { DisplayNameForm(profile?.displayName ?: "") }

                    SectionLabel("Appearance")
                    Column(Modifier.padding(horizontal = 16.dp)) {
                        Text("App", fontSize = 16.sp, color = T.c.foreground)
                        Spacer(Modifier.height(8.dp))
                        Segmented(listOf("system" to "System", "light" to "Light", "dark" to "Dark"), theme, { v -> scope.launch { graph.session.setTheme(v) } }, Modifier.fillMaxWidth())
                        Spacer(Modifier.height(20.dp))
                        Text("Home-screen widgets", fontSize = 16.sp, color = T.c.foreground)
                        Text(
                            if (android.os.Build.VERSION.SDK_INT >= 31) "System follows dark mode and uses your wallpaper colours" else "System follows dark mode",
                            fontSize = 14.sp, color = T.c.mutedForeground,
                        )
                        Spacer(Modifier.height(8.dp))
                        Segmented(
                            listOf("system" to "System", "light" to "Light", "dark" to "Dark"), widgetTheme,
                            { v -> scope.launch { graph.session.setWidgetTheme(v); graph.syncSurfacesNow() } },
                            Modifier.fillMaxWidth(),
                        )
                    }

                    SectionLabel("Notifications")
                    ListRow(
                        "Timer notification",
                        subtitle = if (notifAllowed) "On · shows the running timer with Stop and Switch" else "Off · tap to allow in system settings",
                        icon = Icons.Outlined.Notifications,
                        onClick = {
                            runCatching {
                                context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                            }
                        },
                        trailing = { Icon(Icons.AutoMirrored.Outlined.OpenInNew, null, tint = T.c.mutedForeground, modifier = Modifier.size(18.dp)) },
                    )

                    if (!securityUnsupported) {
                        SectionLabel("Security")
                        ListRow("Change password", icon = Icons.Outlined.Lock, onClick = { pwOpen = true })
                        ListRow("Delete account", icon = Icons.Outlined.DeleteForever, destructive = true, onClick = { deleteOpen = true })
                    }

                    SectionLabel("Server")
                    ListRow(server, subtitle = "To use another server, sign out and open Advanced on the login screen.", icon = Icons.Outlined.Dns)

                    Spacer(Modifier.height(12.dp))
                    RowDivider()
                    ListRow(
                        if (signingOut) "Signing out…" else "Sign out", icon = Icons.AutoMirrored.Outlined.Logout, destructive = true,
                        onClick = { if (!signingOut) confirmSignOut = true },
                    )
                    RowDivider()
                }
            }
        }
    }

    if (confirmSignOut) {
        ConfirmDialog(
            "Sign out?", "Your data stays on the server. Widgets and the notification stop until you sign in again.", "Sign out",
            onConfirm = { signingOut = true; scope.launch { graph.signOut() } },
            onDismiss = { confirmSignOut = false },
        )
    }
    if (pwOpen) ChangePasswordDialog(onDismiss = { pwOpen = false }, onUnsupported = { securityUnsupported = true; pwOpen = false })
    if (deleteOpen) DeleteAccountDialog(onDismiss = { deleteOpen = false }, onUnsupported = { securityUnsupported = true; deleteOpen = false })
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
            TButton(if (status == "saving") "Saving…" else "Save", {
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
