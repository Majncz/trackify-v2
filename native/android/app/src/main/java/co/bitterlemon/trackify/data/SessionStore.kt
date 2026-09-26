package co.bitterlemon.trackify.data

import android.content.Context
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking

val Context.prefs by preferencesDataStore(name = "trackify")

data class Session(val token: String, val userId: String, val email: String)

/** Server URL + signed-in session, persisted in DataStore (token encrypted with the Keystore). */
class SessionStore(private val context: Context) {
    companion object {
        const val DEFAULT_SERVER = "https://trackify.ranajakub.com"
        private val K_SERVER = stringPreferencesKey("server")
        private val K_TOKEN = stringPreferencesKey("token_enc")
        private val K_USER = stringPreferencesKey("user_id")
        private val K_EMAIL = stringPreferencesKey("email")
        private val K_LAST_EMAIL = stringPreferencesKey("last_email")
        private val K_THEME = stringPreferencesKey("theme")

        fun normalizeServer(raw: String): String {
            var s = raw.trim().trimEnd('/')
            if (s.isEmpty()) return DEFAULT_SERVER
            if (!s.startsWith("http://") && !s.startsWith("https://")) s = "https://$s"
            return s
        }
    }

    private val _server = MutableStateFlow(DEFAULT_SERVER)
    val server: StateFlow<String> = _server.asStateFlow()

    private val _session = MutableStateFlow<Session?>(null)
    val session: StateFlow<Session?> = _session.asStateFlow()

    private val _lastEmail = MutableStateFlow("")
    val lastEmail: StateFlow<String> = _lastEmail.asStateFlow()

    /** "system" | "light" | "dark" */
    private val _theme = MutableStateFlow("system")
    val theme: StateFlow<String> = _theme.asStateFlow()

    fun loadBlocking() = runBlocking {
        val p: Preferences = context.prefs.data.first()
        _server.value = p[K_SERVER] ?: DEFAULT_SERVER
        _lastEmail.value = p[K_LAST_EMAIL] ?: ""
        _theme.value = p[K_THEME] ?: "system"
        val token = p[K_TOKEN]?.let { SecureBox.decrypt(it) }
        val user = p[K_USER]
        val email = p[K_EMAIL]
        _session.value = if (token != null && user != null) Session(token, user, email ?: "") else null
    }

    suspend fun setServer(url: String) {
        val n = normalizeServer(url)
        _server.value = n
        context.prefs.edit { it[K_SERVER] = n }
    }

    suspend fun signIn(session: Session) {
        _session.value = session
        _lastEmail.value = session.email
        val enc = SecureBox.encrypt(session.token)
        context.prefs.edit {
            if (enc != null) it[K_TOKEN] = enc
            it[K_USER] = session.userId
            it[K_EMAIL] = session.email
            it[K_LAST_EMAIL] = session.email
        }
    }

    suspend fun updateUserId(id: String) {
        val s = _session.value ?: return
        if (s.userId == id) return
        _session.value = s.copy(userId = id)
        context.prefs.edit { it[K_USER] = id }
    }

    suspend fun signOut() {
        _session.value = null
        context.prefs.edit {
            it.remove(K_TOKEN)
            it.remove(K_USER)
            it.remove(K_EMAIL)
        }
    }

    suspend fun setTheme(value: String) {
        _theme.value = value
        context.prefs.edit { it[K_THEME] = value }
    }
}
