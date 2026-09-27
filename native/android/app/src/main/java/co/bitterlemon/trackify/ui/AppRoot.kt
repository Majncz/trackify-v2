package co.bitterlemon.trackify.ui

import androidx.compose.animation.EnterTransition
import androidx.compose.animation.ExitTransition
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.BarChart
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Timer
import androidx.compose.material.icons.outlined.BarChart
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Menu
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.NavigationRail
import androidx.compose.material3.NavigationRailItem
import androidx.compose.material3.NavigationRailItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.MutableState
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.navigation.NavBackStackEntry
import androidx.navigation.NavDestination.Companion.hierarchy
import androidx.navigation.NavGraph.Companion.findStartDestination
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.currentBackStackEntryAsState
import androidx.navigation.compose.navigation
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.ui.auth.AuthFlow
import co.bitterlemon.trackify.ui.billing.AiSubscriptionsScreen
import co.bitterlemon.trackify.ui.billing.BillingRoutes
import co.bitterlemon.trackify.ui.billing.BillingScreen
import co.bitterlemon.trackify.ui.billing.PaymentDetailScreen
import co.bitterlemon.trackify.ui.billing.PaymentsScreen
import co.bitterlemon.trackify.ui.billing.RatesScreen
import co.bitterlemon.trackify.ui.billing.SessionsScreen
import co.bitterlemon.trackify.ui.chat.ChatScreen
import co.bitterlemon.trackify.ui.components.CappedFontScale
import co.bitterlemon.trackify.ui.home.HomeScreen
import co.bitterlemon.trackify.ui.more.AboutScreen
import co.bitterlemon.trackify.ui.more.HiddenTasksScreen
import co.bitterlemon.trackify.ui.more.MoreScreen
import co.bitterlemon.trackify.ui.more.WidgetsScreen
import co.bitterlemon.trackify.ui.settings.SettingsScreen
import co.bitterlemon.trackify.ui.stats.StatsScreen
import co.bitterlemon.trackify.ui.task.TaskDetailScreen
import co.bitterlemon.trackify.ui.team.RaceScreen
import co.bitterlemon.trackify.ui.team.TeamScreen
import co.bitterlemon.trackify.ui.theme.T

/** A bottom tab: its own nested graph ([graph]) with a root screen ([root]) and its own back stack. */
private data class Tab(val graph: String, val root: String, val label: String, val icon: ImageVector, val selectedIcon: ImageVector)

private val tabs = listOf(
    Tab("tab_timer", "timer", "Timer", Icons.Outlined.Timer, Icons.Filled.Timer),
    Tab("tab_stats", "stats", "Stats", Icons.Outlined.BarChart, Icons.Filled.BarChart),
    Tab("tab_team", "team", "Team", Icons.Outlined.Groups, Icons.Filled.Groups),
    Tab("tab_more", "more", "More", Icons.Outlined.Menu, Icons.Filled.Menu),
)

@Composable
fun AppRoot(pendingRoute: MutableState<String?>) {
    val graph = AppGraph.get(LocalContext.current)
    val session by graph.session.session.collectAsState()
    if (session != null) MainShell(pendingRoute) else AuthFlow()
}

private fun NavBackStackEntry.tabGraph(): String? = destination.hierarchy.firstOrNull { d -> tabs.any { it.graph == d.route } }?.route

/**
 * Tab switch that never traps: tapping the active tab pops it to its root; any other tab is shown with its own
 * saved stack (Navigation multiple back stacks).
 */
private fun NavHostController.selectTab(tab: Tab) {
    val current = currentBackStackEntry?.tabGraph()
    if (current == tab.graph) {
        popBackStack(tab.root, inclusive = false)
        return
    }
    navigate(tab.graph) {
        popUpTo(graph.findStartDestination().id) { saveState = true }
        launchSingleTop = true
        restoreState = true
    }
}

@Composable
private fun MainShell(pendingRoute: MutableState<String?>) {
    val graph = AppGraph.get(LocalContext.current)
    val nav = rememberNavController()
    val entry by nav.currentBackStackEntryAsState()
    val currentTab = entry?.tabGraph()
    val snackbar = remember { SnackbarHostState() }

    val tabNow by rememberUpdatedState(currentTab)
    LaunchedEffect(Unit) {
        // Timer shows its own slim banner; elsewhere a snackbar.
        graph.engine.errors.collect { if (tabNow != "tab_timer") snackbar.showSnackbar("Couldn't save: $it") }
    }
    LaunchedEffect(pendingRoute.value) {
        val r = pendingRoute.value ?: return@LaunchedEffect
        pendingRoute.value = null
        // Deep links (notification, widget, shortcut) land in the Timer tab.
        nav.selectTab(tabs[0])
        if (r != "timer" && r != "home") nav.navigate(r)
    }

    fun openInMore(route: String) {
        nav.selectTab(tabs[3])
        nav.navigate(route) { launchSingleTop = true }
    }

    BoxWithConstraints(Modifier.fillMaxSize()) {
        val wide = maxWidth >= 600.dp
        Scaffold(
            containerColor = T.c.background,
            snackbarHost = { SnackbarHost(snackbar) },
            bottomBar = {
                if (!wide) CappedFontScale {
                    Column {
                        HorizontalDivider(color = T.c.border)
                        NavigationBar(containerColor = T.c.background, tonalElevation = 0.dp) {
                            tabs.forEach { tab ->
                                val selected = currentTab == tab.graph
                                NavigationBarItem(
                                    selected = selected,
                                    onClick = { nav.selectTab(tab) },
                                    icon = { Icon(if (selected) tab.selectedIcon else tab.icon, null, modifier = Modifier.size(24.dp)) },
                                    label = { Text(tab.label, fontSize = 12.sp, maxLines = 1, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium) },
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
                }
            },
        ) { pad ->
            Row(Modifier.fillMaxSize().padding(pad).consumeWindowInsets(pad)) {
                if (wide) CappedFontScale {
                    NavigationRail(containerColor = T.c.background, windowInsets = WindowInsets.navigationBars) {
                        Spacer(Modifier.height(8.dp))
                        tabs.forEach { tab ->
                            val selected = currentTab == tab.graph
                            NavigationRailItem(
                                selected = selected,
                                onClick = { nav.selectTab(tab) },
                                icon = { Icon(if (selected) tab.selectedIcon else tab.icon, null, modifier = Modifier.size(24.dp)) },
                                label = { Text(tab.label, fontSize = 12.sp, fontWeight = if (selected) FontWeight.SemiBold else FontWeight.Medium) },
                                colors = NavigationRailItemDefaults.colors(
                                    selectedIconColor = T.c.foreground, selectedTextColor = T.c.foreground,
                                    unselectedIconColor = T.c.mutedForeground, unselectedTextColor = T.c.mutedForeground,
                                    indicatorColor = T.c.muted,
                                ),
                            )
                        }
                    }
                }
                if (wide) VerticalDivider(color = T.c.border)
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    AppNavHost(nav, onOpenBilling = { openInMore("billing") })
                }
            }
        }
    }
}

private fun sameTab(a: NavBackStackEntry, b: NavBackStackEntry) = a.tabGraph() == b.tabGraph()

@Composable
private fun AppNavHost(nav: NavHostController, onOpenBilling: () -> Unit) {
    val back: () -> Unit = { nav.popBackStack() }
    // Tab switches are instant (no animation). Only a push inside one tab gets the short standard slide.
    NavHost(
        nav,
        startDestination = "tab_timer",
        enterTransition = { if (sameTab(initialState, targetState)) slideInHorizontally(tween(220)) { it / 6 } + fadeIn(tween(220)) else EnterTransition.None },
        exitTransition = { if (sameTab(initialState, targetState)) fadeOut(tween(120)) else ExitTransition.None },
        popEnterTransition = { if (sameTab(initialState, targetState)) fadeIn(tween(180)) else EnterTransition.None },
        popExitTransition = { if (sameTab(initialState, targetState)) slideOutHorizontally(tween(200)) { it / 6 } + fadeOut(tween(200)) else ExitTransition.None },
    ) {
        navigation(startDestination = "timer", route = "tab_timer") {
            composable("timer") { HomeScreen(onOpenTask = { nav.navigate("task/$it") }) }
            composable("task/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) { e ->
                TaskDetailScreen(e.arguments?.getString("id") ?: "", onBack = back, onOpenBilling = onOpenBilling)
            }
        }
        navigation(startDestination = "stats", route = "tab_stats") {
            composable("stats") { StatsScreen() }
        }
        navigation(startDestination = "team", route = "tab_team") {
            composable("team") { TeamScreen(onOpenRace = { nav.navigate("race") }) }
            composable("race") { RaceScreen(onBack = back) }
        }
        navigation(startDestination = "more", route = "tab_more") {
            composable("more") { MoreScreen(onOpen = { nav.navigate(it) }) }
            composable("billing") { BillingScreen(onBack = back, onOpen = { nav.navigate(it) }) }
            composable(BillingRoutes.SESSIONS) { SessionsScreen(onBack = back, onOpenRates = { nav.navigate(BillingRoutes.RATES) }) }
            composable(BillingRoutes.PAYMENTS) { PaymentsScreen(onBack = back, onOpen = { nav.navigate("${BillingRoutes.PAYMENT}/$it") }) }
            composable("${BillingRoutes.PAYMENT}/{id}", arguments = listOf(navArgument("id") { type = NavType.StringType })) { e ->
                PaymentDetailScreen(e.arguments?.getString("id") ?: "", onBack = back)
            }
            composable(BillingRoutes.RATES) { RatesScreen(onBack = back) }
            composable(BillingRoutes.AI) { AiSubscriptionsScreen(onBack = back) }
            composable("chat") { ChatScreen(onBack = back) }
            composable("settings") { SettingsScreen(onBack = back) }
            composable("hidden") { HiddenTasksScreen(onBack = back) }
            composable("widgets") { WidgetsScreen(onBack = back) }
            composable("about") { AboutScreen(onBack = back) }
        }
    }
}
