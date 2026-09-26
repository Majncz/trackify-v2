package co.bitterlemon.trackify.ui

import androidx.compose.animation.Crossfade
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.windowInsetsPadding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.Chat
import androidx.compose.material.icons.outlined.AttachMoney
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Home
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.ui.auth.AuthFlow
import co.bitterlemon.trackify.ui.billing.BillingScreen
import co.bitterlemon.trackify.ui.chat.ChatScreen
import co.bitterlemon.trackify.ui.components.ConnectionDot
import co.bitterlemon.trackify.ui.components.Wordmark
import co.bitterlemon.trackify.ui.home.HomeScreen
import co.bitterlemon.trackify.ui.settings.SettingsScreen
import co.bitterlemon.trackify.ui.stats.StatsScreen
import co.bitterlemon.trackify.ui.task.TaskDetailScreen
import co.bitterlemon.trackify.ui.team.TeamScreen
import co.bitterlemon.trackify.ui.theme.T

private data class Tab(val route: String, val label: String, val icon: ImageVector)

private val tabs = listOf(
    Tab("home", "Home", Icons.Outlined.Home),
    Tab("stats", "Stats", Icons.Outlined.BarChart),
    Tab("team", "Team", Icons.Outlined.Groups),
    Tab("billing", "Billing", Icons.Outlined.AttachMoney),
    Tab("chat", "Chat", Icons.AutoMirrored.Outlined.Chat),
)

@Composable
fun AppRoot(pendingRoute: MutableState<String?>) {
    val graph = AppGraph.get(LocalContext.current)
    val session by graph.session.session.collectAsState()
    Crossfade(session != null, label = "auth") { signedIn ->
        if (signedIn) MainShell(pendingRoute) else AuthFlow()
    }
}

@Composable
private fun MainShell(pendingRoute: MutableState<String?>) {
    val graph = AppGraph.get(LocalContext.current)
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val route = entry?.destination?.route
    val status by graph.socket.status.collectAsState()
    val snackbar = remember { SnackbarHostState() }

    LaunchedEffect(Unit) {
        graph.engine.errors.collect { snackbar.showSnackbar("Couldn't save: $it") }
    }
    LaunchedEffect(pendingRoute.value) {
        pendingRoute.value?.let { nav.navigate(it); pendingRoute.value = null }
    }

    val isTab = tabs.any { it.route == route }
    Scaffold(
        containerColor = T.c.background,
        snackbarHost = { SnackbarHost(snackbar) },
        topBar = {
            Column(Modifier.background(T.c.background).windowInsetsPadding(WindowInsets.statusBars)) {
                Row(
                    Modifier.fillMaxWidth().height(56.dp).padding(start = 16.dp, end = 4.dp),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Wordmark(19)
                    Spacer(Modifier.width(8.dp))
                    ConnectionDot(status)
                    Spacer(Modifier.weight(1f))
                    IconButton(onClick = {
                        if (route != "settings") nav.navigate("settings") { launchSingleTop = true }
                    }) {
                        Icon(
                            Icons.Outlined.Settings, "Settings",
                            tint = if (route == "settings") T.c.foreground else T.c.mutedForeground,
                        )
                    }
                }
                HorizontalDivider(color = T.c.border)
            }
        },
        bottomBar = {
            Column {
                HorizontalDivider(color = T.c.border)
                NavigationBar(containerColor = T.c.card, tonalElevation = 0.dp) {
                    tabs.forEach { tab ->
                        val selected = route == tab.route || (tab.route == "home" && route?.startsWith("task/") == true && false)
                        NavigationBarItem(
                            selected = selected,
                            onClick = {
                                nav.navigate(tab.route) {
                                    popUpTo(nav.graph.findStartDestination().id) { saveState = true }
                                    launchSingleTop = true
                                    restoreState = true
                                }
                            },
                            icon = { Icon(tab.icon, null, modifier = Modifier.size(22.dp)) },
                            label = { Text(tab.label, fontSize = 12.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium) },
                            colors = NavigationBarItemDefaults.colors(
                                selectedIconColor = T.c.foreground,
                                selectedTextColor = T.c.foreground,
                                unselectedIconColor = T.c.mutedForeground,
                                unselectedTextColor = T.c.mutedForeground,
                                indicatorColor = T.c.muted,
                            ),
                        )
                    }
                }
            }
        },
    ) { pad ->
        Box(Modifier.fillMaxSize().padding(pad)) {
            NavHost(nav, startDestination = "home") {
                composable("home") { HomeScreen(onOpenTask = { nav.navigate("task/$it") }) }
                composable("stats") { StatsScreen() }
                composable("team") { TeamScreen() }
                composable("billing") { BillingScreen() }
                composable("chat") { ChatScreen() }
                composable("settings") { SettingsScreen(onBack = { nav.popBackStack() }) }
                composable("task/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) { e ->
                    TaskDetailScreen(e.arguments?.getString("id") ?: "", onBack = { nav.popBackStack() })
                }
            }
        }
    }
    @Suppress("UNUSED_VARIABLE") val unused = isTab
}
