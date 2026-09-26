import SwiftUI
import TrackifyKit

/// Login / Register / Forgot password (WEB_AUDIT §1.1) with a collapsed "Advanced" server field.
struct AuthFlowView: View {
    @Environment(AppModel.self) private var model
    enum Screen { case login, register, forgot }
    @State private var screen: Screen = .login
    @State private var registeredBanner = false

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                VStack(spacing: 6) {
                    AppGlyph(size: 56)
                    Wordmark(size: 26)
                    Text("Track your time efficiently").font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
                }
                .padding(.top, 36)

                Group {
                    switch screen {
                    case .login: LoginForm(screen: $screen, registered: $registeredBanner)
                    case .register: RegisterForm(screen: $screen, registered: $registeredBanner)
                    case .forgot: ForgotForm(screen: $screen)
                    }
                }
                .frame(maxWidth: 448)
                .transition(.opacity)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
            .frame(maxWidth: .infinity)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(Theme.background.ignoresSafeArea())
        .animation(.easeOut(duration: 0.18), value: screen)
    }
}

/// The app icon glyph (black rounded square, white "T", green dot).
struct AppGlyph: View {
    var size: CGFloat = 48
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: size * 0.2237, style: .continuous).fill(Color(rgb: 0x0A0A0A))
            Text("T").font(.system(size: size * 0.62, weight: .heavy)).foregroundStyle(.white).offset(x: -size * 0.03, y: -size * 0.01)
            Circle().fill(Theme.green).frame(width: size * 0.17, height: size * 0.17)
                .offset(x: size * 0.22, y: size * 0.2)
        }
        .frame(width: size, height: size)
        .overlay(RoundedRectangle(cornerRadius: size * 0.2237, style: .continuous).strokeBorder(Color.white.opacity(0.08)))
        .accessibilityHidden(true)
    }
}

private struct ServerField: View {
    @Environment(AppModel.self) private var model
    @State private var expanded = false

    var body: some View {
        @Bindable var model = model
        VStack(alignment: .leading, spacing: 8) {
            Button {
                withAnimation(.easeOut(duration: 0.18)) { expanded.toggle() }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: "chevron.right").font(.system(size: 11, weight: .semibold)).rotationEffect(.degrees(expanded ? 90 : 0))
                    Text("Advanced").font(.system(size: 13, weight: .medium))
                    if !expanded && model.serverString != APIClient.liveServer.absoluteString {
                        Text("· \(URL(string: model.serverString)?.host ?? model.serverString)").font(.system(size: 13)).lineLimit(1)
                    }
                }
                .foregroundStyle(Theme.mutedForeground)
                .frame(minHeight: 32)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("advanced")
            if expanded {
                FieldLabel(text: "Server")
                TField(placeholder: APIClient.liveServer.absoluteString, text: $model.serverString)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.URL)
                    #endif
                    .accessibilityIdentifier("server")
                HStack {
                    Text("Default: \(APIClient.liveServer.host ?? "")").font(.caption12).foregroundStyle(Theme.mutedForeground)
                    Spacer()
                    if model.serverString != APIClient.liveServer.absoluteString {
                        Button("Reset") { model.serverString = APIClient.liveServer.absoluteString }
                            .font(.caption12).buttonStyle(.plain).foregroundStyle(Theme.foreground)
                    }
                }
            }
        }
    }
}

private struct LoginForm: View {
    @Environment(AppModel.self) private var model
    @Binding var screen: AuthFlowView.Screen
    @Binding var registered: Bool
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false
    @FocusState private var focus: Field?
    enum Field { case email, password }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Sign in").font(.system(size: 22, weight: .bold))
                Text("Enter your email and password").font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
            }
            if registered {
                Text("Account created. You can sign in now.")
                    .font(.system(size: 13)).foregroundStyle(Theme.emeraldText)
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.emerald.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            }
            if let reason = model.signedOutReason {
                Text(reason).font(.system(size: 13)).foregroundStyle(Theme.mutedForeground)
            }
            VStack(alignment: .leading, spacing: 6) {
                FieldLabel(text: "Email")
                TField(placeholder: "you@example.com", text: $email)
                    .focused($focus, equals: .email)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                    .textContentType(.username)
                    #endif
                    .submitLabel(.next)
                    .onSubmit { focus = .password }
                    .accessibilityIdentifier("email")
            }
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    FieldLabel(text: "Password")
                    Spacer()
                    Button("Forgot password?") { screen = .forgot }
                        .font(.system(size: 13)).buttonStyle(.plain).foregroundStyle(Theme.mutedForeground)
                }
                TField(placeholder: "", text: $password, secure: true)
                    .focused($focus, equals: .password)
                    #if os(iOS)
                    .textContentType(.password)
                    #endif
                    .submitLabel(.go)
                    .onSubmit(submit)
                    .accessibilityIdentifier("password")
            }
            InlineError(text: error)
            Button(action: submit) {
                Text(busy ? "Signing in..." : "Sign in").frame(maxWidth: .infinity)
            }
            .buttonStyle(.t(.primary, .lg, full: true))
            .disabled(busy || email.isEmpty || password.isEmpty)
            .keyboardShortcut(.defaultAction)
            .accessibilityIdentifier("signIn")
            ServerField()
            HStack(spacing: 4) {
                Text("Don't have an account?").foregroundStyle(Theme.mutedForeground)
                Button("Register") { screen = .register }.buttonStyle(.plain).fontWeight(.semibold)
            }
            .font(.system(size: 14))
            .frame(maxWidth: .infinity)
        }
        .card(padding: 24)
        .onAppear { if email.isEmpty { email = model.lastEmail } }
    }

    private func submit() {
        guard !busy, !email.isEmpty, !password.isEmpty else { return }
        busy = true
        error = nil
        Task {
            do { try await model.signIn(email: email, password: password, server: model.serverString) }
            catch let e as APIError {
                error = e.kind == .network ? "Can't reach \(URL(string: model.serverString)?.host ?? "the server"). Check your connection." :
                    (e.status == 401 ? "Invalid email or password" : e.message)
            } catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}

private struct RegisterForm: View {
    @Environment(AppModel.self) private var model
    @Binding var screen: AuthFlowView.Screen
    @Binding var registered: Bool
    @State private var email = ""
    @State private var password = ""
    @State private var confirm = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Create an account").font(.system(size: 22, weight: .bold))
                Text("Enter your details to register").font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
            }
            VStack(alignment: .leading, spacing: 6) {
                FieldLabel(text: "Email")
                TField(placeholder: "you@example.com", text: $email)
                    .autocorrectionDisabled()
                    #if os(iOS)
                    .textInputAutocapitalization(.never)
                    .keyboardType(.emailAddress)
                    #endif
            }
            VStack(alignment: .leading, spacing: 6) {
                FieldLabel(text: "Password")
                TField(placeholder: "", text: $password, secure: true)
            }
            VStack(alignment: .leading, spacing: 6) {
                FieldLabel(text: "Confirm Password")
                TField(placeholder: "", text: $confirm, secure: true)
            }
            InlineError(text: error)
            Button(action: submit) { Text(busy ? "Creating account..." : "Register").frame(maxWidth: .infinity) }
                .buttonStyle(.t(.primary, .lg, full: true))
                .disabled(busy || email.isEmpty || password.isEmpty)
            ServerField()
            HStack(spacing: 4) {
                Text("Already have an account?").foregroundStyle(Theme.mutedForeground)
                Button("Sign in") { screen = .login }.buttonStyle(.plain).fontWeight(.semibold)
            }
            .font(.system(size: 14)).frame(maxWidth: .infinity)
        }
        .card(padding: 24)
    }

    private func submit() {
        error = nil
        guard password == confirm else { error = "Passwords do not match"; return }
        guard password.count >= 6 else { error = "Password must be at least 6 characters"; return }
        busy = true
        Task {
            do {
                try await model.register(email: email, password: password, server: model.serverString)
                model.lastEmail = email
                registered = true
                screen = .login
            } catch let e as APIError { error = e.message } catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}

private struct ForgotForm: View {
    @Environment(AppModel.self) private var model
    @Binding var screen: AuthFlowView.Screen
    @State private var email = ""
    @State private var sent = false
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 4) {
                Text("Forgot password").font(.system(size: 22, weight: .bold))
                Text("We'll email you a link to reset it").font(.system(size: 14)).foregroundStyle(Theme.mutedForeground)
            }
            if sent {
                HStack(spacing: 8) {
                    Image(systemName: "envelope").foregroundStyle(Theme.emerald)
                    Text("Check your email for a reset link").font(.system(size: 14))
                }
                .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.emerald.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            } else {
                VStack(alignment: .leading, spacing: 6) {
                    FieldLabel(text: "Email")
                    TField(placeholder: "you@example.com", text: $email)
                        .autocorrectionDisabled()
                        #if os(iOS)
                        .textInputAutocapitalization(.never)
                        .keyboardType(.emailAddress)
                        #endif
                }
                InlineError(text: error)
                Button(action: submit) { Text(busy ? "Sending..." : "Send reset link").frame(maxWidth: .infinity) }
                    .buttonStyle(.t(.primary, .lg, full: true))
                    .disabled(busy || email.isEmpty)
            }
            Button("Back to sign in") { screen = .login }
                .buttonStyle(.plain).font(.system(size: 14, weight: .semibold)).frame(maxWidth: .infinity)
        }
        .card(padding: 24)
        .onAppear { email = model.lastEmail }
    }

    private func submit() {
        busy = true
        error = nil
        Task {
            do { try await model.forgotPassword(email: email, server: model.serverString); sent = true }
            catch let e as APIError { error = e.message } catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}
