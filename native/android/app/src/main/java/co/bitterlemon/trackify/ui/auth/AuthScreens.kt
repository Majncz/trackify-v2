package co.bitterlemon.trackify.ui.auth

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.systemBarsPadding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import co.bitterlemon.trackify.AppGraph
import co.bitterlemon.trackify.data.ApiException
import co.bitterlemon.trackify.data.NetworkException
import co.bitterlemon.trackify.data.SessionStore
import co.bitterlemon.trackify.ui.components.BtnSize
import co.bitterlemon.trackify.ui.components.ErrorAlert
import co.bitterlemon.trackify.ui.components.TButton
import co.bitterlemon.trackify.ui.components.TCard
import co.bitterlemon.trackify.ui.components.TInput
import co.bitterlemon.trackify.ui.components.Wordmark
import co.bitterlemon.trackify.ui.theme.T
import kotlinx.coroutines.launch

private enum class AuthPage { Login, Register, Forgot }

fun friendlyError(e: Throwable, fallback: String): String = when (e) {
    is ApiException -> e.message ?: fallback
    is NetworkException -> "Can't reach the server. Check your connection."
    else -> e.message ?: fallback
}

@Composable
fun AuthFlow() {
    var page by rememberSaveable { mutableStateOf(AuthPage.Login) }
    val graph = AppGraph.get(LocalContext.current)
    var email by rememberSaveable { mutableStateOf(graph.session.lastEmail.value) }
    Box(
        Modifier.fillMaxSize().background(T.c.background).systemBarsPadding().imePadding(),
        contentAlignment = Alignment.Center,
    ) {
        Column(
            Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Wordmark(30)
            Spacer(Modifier.height(4.dp))
            Text("Track your time efficiently", color = T.c.mutedForeground, fontSize = 14.sp)
            Spacer(Modifier.height(24.dp))
            Box(Modifier.widthIn(max = 448.dp).fillMaxWidth()) {
                when (page) {
                    AuthPage.Login -> LoginCard(email, { email = it }, { page = AuthPage.Register }, { page = AuthPage.Forgot })
                    AuthPage.Register -> RegisterCard(email, { email = it }) { page = AuthPage.Login }
                    AuthPage.Forgot -> ForgotCard(email, { email = it }) { page = AuthPage.Login }
                }
            }
        }
    }
}

@Composable
private fun CardHeader(title: String, description: String) {
    Text(title, fontSize = 24.sp, fontWeight = FontWeight.Bold, color = T.c.foreground, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    Spacer(Modifier.height(4.dp))
    Text(description, fontSize = 14.sp, color = T.c.mutedForeground, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth())
    Spacer(Modifier.height(20.dp))
}

@Composable
private fun FooterLink(prefix: String, link: String, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().padding(top = 16.dp), horizontalArrangement = Arrangement.Center) {
        Text("$prefix ", fontSize = 14.sp, color = T.c.mutedForeground)
        Text(link, fontSize = 14.sp, color = T.c.foreground, fontWeight = FontWeight.Medium, modifier = Modifier.clickable(onClick = onClick))
    }
}

@Composable
private fun LoginCard(email: String, onEmail: (String) -> Unit, onRegister: () -> Unit, onForgot: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    val expired by graph.sessionExpired.collectAsState()
    val server by graph.session.server.collectAsState()
    var password by rememberSaveable { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var advanced by rememberSaveable { mutableStateOf(server != SessionStore.DEFAULT_SERVER) }
    var serverField by rememberSaveable { mutableStateOf(server) }

    fun submit() {
        if (loading) return
        if (email.isBlank() || password.isEmpty()) {
            error = "Please enter your email and password"; return
        }
        loading = true
        error = null
        scope.launch {
            val target = SessionStore.normalizeServer(serverField)
            if (target != graph.session.server.value) graph.session.setServer(target)
            graph.signIn(email, password).onFailure { e ->
                error = when {
                    e is ApiException && e.status == 401 -> "Invalid email or password"
                    else -> friendlyError(e, "Invalid credentials")
                }
            }
            loading = false
        }
    }

    TCard(padding = androidx.compose.foundation.layout.PaddingValues(24.dp)) {
        CardHeader("Login", "Enter your credentials to access Trackify")
        if (expired && error == null) {
            ErrorAlert("Session expired", "Please sign in again.")
            Spacer(Modifier.height(16.dp))
        }
        error?.let {
            ErrorAlert(it, null)
            Spacer(Modifier.height(16.dp))
        }
        TInput(email, onEmail, label = "Email", placeholder = "you@example.com", keyboardType = KeyboardType.Email, imeAction = ImeAction.Next)
        Spacer(Modifier.height(16.dp))
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Password", fontSize = 14.sp, fontWeight = FontWeight.Medium, color = T.c.foreground, modifier = Modifier.weight(1f))
            Text("Forgot password?", fontSize = 14.sp, color = T.c.foreground, modifier = Modifier.clickable(onClick = onForgot).padding(4.dp))
        }
        Spacer(Modifier.height(6.dp))
        TInput(password, { password = it }, placeholder = "Enter your password", password = true, imeAction = ImeAction.Go, onIme = { submit() })
        Spacer(Modifier.height(12.dp))
        Row(
            Modifier.fillMaxWidth().clickable { advanced = !advanced }.padding(vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text("Advanced", fontSize = 13.sp, color = T.c.mutedForeground, modifier = Modifier.weight(1f))
            Icon(if (advanced) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore, null, tint = T.c.mutedForeground, modifier = Modifier.size(18.dp))
        }
        AnimatedVisibility(advanced) {
            Column {
                Spacer(Modifier.height(6.dp))
                TInput(serverField, { serverField = it }, label = "Server", placeholder = SessionStore.DEFAULT_SERVER, keyboardType = KeyboardType.Uri)
                Spacer(Modifier.height(4.dp))
                Text("Leave as is to use ${SessionStore.DEFAULT_SERVER}", fontSize = 12.sp, color = T.c.mutedForeground)
            }
        }
        Spacer(Modifier.height(16.dp))
        TButton(if (loading) "Signing in..." else "Sign In", { submit() }, Modifier.fillMaxWidth(), size = BtnSize.Lg, enabled = !loading)
        FooterLink("Don't have an account?", "Register", onRegister)
    }
}

@Composable
private fun RegisterCard(email: String, onEmail: (String) -> Unit, onLogin: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    var password by rememberSaveable { mutableStateOf("") }
    var confirm by rememberSaveable { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    fun submit() {
        error = null
        if (password != confirm) {
            error = "Passwords do not match"; return
        }
        if (password.length < 6) {
            error = "Password must be at least 6 characters"; return
        }
        loading = true
        scope.launch {
            try {
                graph.api.register(email.trim(), password)
                graph.signIn(email.trim(), password).onFailure { onLogin() }
            } catch (e: Exception) {
                error = friendlyError(e, "Registration failed")
            }
            loading = false
        }
    }

    TCard(padding = androidx.compose.foundation.layout.PaddingValues(24.dp)) {
        CardHeader("Create Account", "Enter your details to create a new account")
        error?.let {
            ErrorAlert(it, null)
            Spacer(Modifier.height(16.dp))
        }
        TInput(email, onEmail, label = "Email", placeholder = "you@example.com", keyboardType = KeyboardType.Email, imeAction = ImeAction.Next)
        Spacer(Modifier.height(16.dp))
        TInput(password, { password = it }, label = "Password", placeholder = "At least 6 characters", password = true, imeAction = ImeAction.Next)
        Spacer(Modifier.height(16.dp))
        TInput(confirm, { confirm = it }, label = "Confirm Password", placeholder = "Confirm your password", password = true, imeAction = ImeAction.Go, onIme = { submit() })
        Spacer(Modifier.height(20.dp))
        TButton(if (loading) "Creating account..." else "Create Account", { submit() }, Modifier.fillMaxWidth(), size = BtnSize.Lg, enabled = !loading)
        FooterLink("Already have an account?", "Sign in", onLogin)
    }
}

@Composable
private fun ForgotCard(email: String, onEmail: (String) -> Unit, onLogin: () -> Unit) {
    val graph = AppGraph.get(LocalContext.current)
    val scope = rememberCoroutineScope()
    var status by remember { mutableStateOf("idle") }
    var message by remember { mutableStateOf("") }

    TCard(padding = androidx.compose.foundation.layout.PaddingValues(24.dp)) {
        CardHeader("Reset Password", "Enter your email to receive a reset link")
        if (status == "success") {
            Text(
                message,
                fontSize = 14.sp,
                color = T.c.foreground,
                modifier = Modifier.fillMaxWidth().background(T.c.muted, co.bitterlemon.trackify.ui.components.ControlShape).padding(12.dp),
            )
        } else {
            if (status == "error") {
                ErrorAlert(message, null)
                Spacer(Modifier.height(16.dp))
            }
            TInput(email, onEmail, label = "Email", placeholder = "you@example.com", keyboardType = KeyboardType.Email)
            Spacer(Modifier.height(20.dp))
            TButton(
                if (status == "loading") "Sending..." else "Send Reset Link",
                {
                    status = "loading"
                    scope.launch {
                        try {
                            graph.api.forgotPassword(email.trim())
                            status = "success"; message = "Check your email for a reset link"
                        } catch (e: Exception) {
                            status = "error"; message = friendlyError(e, "Something went wrong")
                        }
                    }
                },
                Modifier.fillMaxWidth(), size = BtnSize.Lg, enabled = status != "loading" && email.isNotBlank(),
            )
        }
        FooterLink("Remember your password?", "Login", onLogin)
    }
}
