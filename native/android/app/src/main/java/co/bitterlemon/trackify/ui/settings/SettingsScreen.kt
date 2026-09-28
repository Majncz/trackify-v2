package co.bitterlemon.trackify.ui.settings

import androidx.compose.foundation.layout.heightIn
import androidx.compose.material.icons.outlined.UnfoldMore
import androidx.compose.material.icons.outlined.Check
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import co.bitterlemon.trackify.ui.components.Section
import co.bitterlemon.trackify.ui.components.SectionDivider
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
                    val themes = listOf("system" to "System", "light" to "Light", "dark" to "Dark")
                    Section(header = "Account", footer = "Your display name is shown to your team while you track.") {
                        ListRow("Email", value = profile?.email?.ifEmpty { null } ?: session?.email ?: "")
                        SectionDivider()
                        DisplayNameRow(profile?.displayName ?: "")
                    }

                    Section(
                        header = "Appearance",
                        footer = if (android.os.Build.VERSION.SDK_INT >= 31) "Widgets on System follow dark mode and use your wallpaper colours." else "Widgets on System follow dark mode.",
                    ) {
                        PickerRow("App", themes, theme) { v -> scope.launch { graph.session.setTheme(v) } }
                        SectionDivider()
                        PickerRow("Widgets", themes, widgetTheme) { v -> scope.launch { graph.session.setWidgetTheme(v); graph.syncSurfacesNow() } }
                    }

                    Section(header = "Notifications", footer = "Shows the running timer with Stop and Switch.") {
                        ListRow(
                            "Timer notification", value = if (notifAllowed) "On" else "Off",
                            onClick = {
                                runCatching {
                                    context.startActivity(Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
                                }
                            },
                            trailing = { Icon(Icons.AutoMirrored.Outlined.OpenInNew, "Open system settings", tint = T.c.mutedForeground, modifier = Modifier.size(18.dp)) },
                        )
                    }

                    if (!securityUnsupported) {
                        Section(header = "Security") {
                            ListRow("Change password", onClick = { pwOpen = true }, chevron = true)
                            SectionDivider()
                            ListRow("Delete account…", destructive = true, onClick = { deleteOpen = true })
                        }
                    }

                    Section(header = "Server", footer = "To use another server, sign out and open Advanced on the login screen.") {
                        Text(
                            server, fontSize = 15.sp, color = T.c.mutedForeground, fontFamily = co.bitterlemon.trackify.ui.theme.Mono,
                            modifier = Modifier.fillMaxWidth().padding(16.dp),
                        )
                    }

                    Section {
                        ListRow(
                            if (signingOut) "Signing out…" else "Sign out", destructive = true,
                            onClick = { if (!signingOut) confirmSignOut = true },
                        )
                    }
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

/** iOS-style picker row: title on the left, the current choice and ⌃⌄ on the right; tap for a menu. */
@Composable
private fun PickerRow(title: String, options: List<Pair<String, String>>, selected: String, onSelect: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        ListRow(
            title, value = options.firstOrNull { it.first == selected }?.second ?: selected, onClick = { open = true },
            trailing = { Icon(Icons.Outlined.UnfoldMore, null, tint = T.c.mutedForeground, modifier = Modifier.size(20.dp)) },
        )
        androidx.compose.material3.DropdownMenu(
            expanded = open, onDismissRequest = { open = false },
            offset = androidx.compose.ui.unit.DpOffset(x = 1000.dp, y = 0.dp),
            shape = androidx.compose.foundation.shape.RoundedCornerShape(14.dp),
            containerColor = T.c.cell,
        ) {
            options.forEach { (k, label) ->
                androidx.compose.material3.DropdownMenuItem(
                    text = { Text(label, fontSize = 17.sp, color = T.c.foreground) },
                    leadingIcon = {
                        if (k == selected) Icon(Icons.Outlined.Check, null, tint = T.c.foreground) else Spacer(Modifier.size(24.dp))
                    },
                    onClick = { open = false; onSelect(k) },
                )
            }
        }
    }
}

/** Display name edited in place (iOS: a text field in the Account section); Save appears once it changed. */
@Composable
private fun DisplayNameRow(initial: String) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    var name by remember(initial) { mutableStateOf(initial) }
    var status by remember { mutableStateOf("idle") }
    var error by remember { mutableStateOf<String?>(null) }
    val trimmed = name.trim()
    val dirty = trimmed != initial.trim()
    fun save() {
        if (!dirty || trimmed.isEmpty() || status == "saving") return
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
    }
    Column {
        Row(Modifier.fillMaxWidth().heightIn(min = 52.dp).padding(start = 16.dp, end = 10.dp), verticalAlignment = Alignment.CenterVertically) {
            androidx.compose.foundation.text.BasicTextField(
                name, { name = it.take(40); status = "idle"; error = null },
                singleLine = true,
                textStyle = androidx.compose.ui.text.TextStyle(fontSize = 17.sp, color = T.c.foreground),
                cursorBrush = androidx.compose.ui.graphics.SolidColor(T.c.foreground),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(imeAction = androidx.compose.ui.text.input.ImeAction.Done),
                keyboardActions = androidx.compose.foundation.text.KeyboardActions(onDone = { save() }),
                modifier = Modifier.weight(1f).padding(vertical = 14.dp).semantics { contentDescription = "Display name" },
                decorationBox = { inner ->
                    Box {
                        if (name.isEmpty()) Text("Display name", fontSize = 17.sp, color = T.c.mutedForeground)
                        inner()
                    }
                },
            )
            when {
                dirty && trimmed.isNotEmpty() -> TButton(if (status == "saving") "Saving…" else "Save", { save() }, size = BtnSize.Sm, enabled = status != "saving")
                status == "saved" -> Text("Saved", fontSize = 15.sp, color = T.c.mutedForeground, modifier = Modifier.padding(end = 6.dp))
            }
        }
        error?.let { Text(it, fontSize = 14.sp, color = T.c.destructive, modifier = Modifier.padding(start = 16.dp, bottom = 10.dp)) }
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
