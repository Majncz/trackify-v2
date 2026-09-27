import SwiftUI
import WidgetKit
import TrackifyKit
#if canImport(ServiceManagement)
import ServiceManagement
#endif

/// Settings (WEB_AUDIT §1.12) + native extras: password, account deletion, server, reminders, menu bar options.
struct SettingsView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                PageHeader("Settings", subtitle: "Manage your account")
                AccountCard()
                HiddenTasksCard()
                AppearanceCard()
                PreferencesCard()
                SecurityCard()
                AboutCard()
            }
            .padding(16)
            .frame(maxWidth: 720)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
        #if os(iOS)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .task {
            await model.refreshProfile()
            await model.refreshHidden()
        }
    }
}

private struct CardTitle: View {
    var icon: String
    var title: String
    var subtitle: String?
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(title, systemImage: icon).font(.cardTitle)
            if let subtitle { Text(subtitle).font(.scaled(13)).foregroundStyle(Theme.mutedForeground) }
        }
    }
}

private struct AccountCard: View {
    @Environment(AppModel.self) private var model
    @State private var name = ""
    @State private var saved = ""
    @State private var status: Status = .idle
    @State private var error: String?
    @State private var confirmSignOut = false
    enum Status { case idle, saving, saved }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            CardTitle(icon: "person", title: "Account", subtitle: "Your account information")
            HStack(spacing: 12) {
                Image(systemName: "envelope").foregroundStyle(Theme.mutedForeground)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Email").font(.scaled(13)).foregroundStyle(Theme.mutedForeground)
                    Text(model.profile?.email ?? model.session?.email ?? "").font(.scaled(15, weight: .medium))
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))

            VStack(alignment: .leading, spacing: 6) {
                FieldLabel(text: "Display name")
                TField(placeholder: "How others see you", text: $name)
                    .onChange(of: name) { _, v in
                        if v.count > 40 { name = String(v.prefix(40)) }
                        status = .idle
                    }
                    .accessibilityIdentifier("displayName")
                Text("Shown when you are tracking a task.").font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
                HStack(spacing: 12) {
                    Button(status == .saving ? "Saving..." : "Save name", action: save)
                        .buttonStyle(.t(.primary))
                        .disabled(name.trimmingCharacters(in: .whitespaces) == saved.trimmingCharacters(in: .whitespaces) || status == .saving || name.trimmingCharacters(in: .whitespaces).isEmpty)
                    if status == .saved { Text("Saved").font(.scaled(14)).foregroundStyle(Theme.mutedForeground) }
                    InlineError(text: error)
                }
            }

            Button(role: .destructive) { confirmSignOut = true } label: { Label("Sign out", systemImage: "rectangle.portrait.and.arrow.right") }
                .buttonStyle(.t(.destructive))
                .accessibilityIdentifier("signOut")
        }
        .card(padding: 20)
        .onAppear { if let p = model.profile { name = p.displayName; saved = p.displayName } }
        .onChange(of: model.profile) { _, p in
            if let p, status != .saving, name == saved { name = p.displayName; saved = p.displayName }
        }
        .confirmationDialog("Sign out of Trackify?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await model.signOut() } }
        }
    }

    private func save() {
        status = .saving
        error = nil
        Task {
            do {
                try await model.updateDisplayName(name)
                saved = model.profile?.displayName ?? name
                name = saved
                status = .saved
            } catch let e as APIError { status = .idle; error = e.message.isEmpty ? "Could not save name" : e.message }
            catch { status = .idle; self.error = "Could not save name" }
        }
    }
}

private struct HiddenTasksCard: View {
    @Environment(AppModel.self) private var model
    @State private var restoring: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardTitle(icon: "eye.slash", title: "Hidden Tasks", subtitle: "Tasks you've hidden from your dashboard")
            if !model.hiddenLoaded {
                Skeleton(height: 44)
            } else if model.hiddenTasks.isEmpty {
                Text("No hidden tasks").font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
            } else {
                ForEach(model.hiddenTasks) { t in
                    HStack {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(t.name).font(.scaled(15, weight: .medium))
                            Text(Fmt.durationWords(t.totalMs)).font(.scaled(13)).foregroundStyle(Theme.mutedForeground).tabular()
                        }
                        Spacer()
                        Button {
                            restoring = t.id
                            Task { try? await model.restore(t.id); restoring = nil }
                        } label: { Label(restoring == t.id ? "Restoring..." : "Restore", systemImage: "arrow.uturn.backward") }
                            .buttonStyle(.t(.outline, .sm))
                            .disabled(restoring != nil)
                    }
                    .padding(12)
                    .background(Theme.muted.opacity(0.4), in: RoundedRectangle(cornerRadius: 8))
                }
            }
        }
        .card(padding: 20)
    }
}

private struct AppearanceCard: View {
    @AppStorage(SharedKeys.appAppearance, store: AppGroup.defaults) private var app = AppearanceChoice.system.rawValue
    @AppStorage(SharedKeys.widgetAppearance, store: AppGroup.defaults) private var widgets = AppearanceChoice.system.rawValue

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            CardTitle(icon: "circle.lefthalf.filled", title: "Appearance", subtitle: "Follow the system, or pick light or dark.")
            row("App", $app)
            row("Widgets", $widgets)
        }
        .card(padding: 20)
        .onChange(of: app) { _, _ in
            #if os(macOS)
            AppearanceChoice.applyToMacApp()
            #endif
        }
        .onChange(of: widgets) { _, _ in WidgetCenter.shared.reloadAllTimelines() }
    }

    private func row(_ title: String, _ value: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.scaled(13, weight: .medium)).foregroundStyle(Theme.mutedForeground)
            Picker(title, selection: value) {
                ForEach(AppearanceChoice.allCases) { Text($0.label).tag($0.rawValue) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .accessibilityIdentifier("appearance-\(title.lowercased())")
        }
    }
}

private struct PreferencesCard: View {
    @Environment(AppModel.self) private var model
    @State private var reminderHours = Reminder.hours
    #if os(macOS)
    @State private var showSeconds = AppGroup.defaults.bool(forKey: SharedKeys.menuBarShowSeconds)
    @State private var hideName = AppGroup.defaults.bool(forKey: SharedKeys.menuBarHideName)
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    #endif

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            CardTitle(icon: "slider.horizontal.3", title: "Preferences")
            #if os(macOS)
            Toggle("Launch at login", isOn: $launchAtLogin)
                .onChange(of: launchAtLogin) { _, on in
                    do { if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() } }
                    catch { launchAtLogin = SMAppService.mainApp.status == .enabled }
                }
            Toggle("Show seconds in the menu bar", isOn: $showSeconds)
                .onChange(of: showSeconds) { _, v in AppGroup.defaults.set(v, forKey: SharedKeys.menuBarShowSeconds) }
            Toggle("Hide the task name in the menu bar", isOn: $hideName)
                .onChange(of: hideName) { _, v in AppGroup.defaults.set(v, forKey: SharedKeys.menuBarHideName) }
            Text("Toggle the menu-bar panel from anywhere with ⌃⌥T.").font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
            Hairline()
            #endif
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("“Still tracking?” reminder").font(.scaled(14))
                    Text("Get a notification when a timer runs this long.").font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
                }
                Spacer()
                Picker("Reminder", selection: $reminderHours) {
                    Text("Off").tag(0)
                    ForEach([1, 2, 3, 4, 6, 8, 10], id: \.self) { Text("After \($0) h").tag($0) }
                }
                .labelsHidden()
                .fixedSize()
                .onChange(of: reminderHours) { _, h in
                    Reminder.hours = h
                    Task {
                        if h > 0 { _ = await Reminder.requestPermission() }
                        Reminder.schedule(model.running, model: model)
                    }
                }
            }
        }
        .toggleStyle(.switch)
        .card(padding: 20)
    }
}

private struct SecurityCard: View {
    @Environment(AppModel.self) private var model
    @State private var current = ""
    @State private var new = ""
    @State private var confirm = ""
    @State private var pwStatus: String?
    @State private var pwError: String?
    @State private var busy = false
    @State private var deletePassword = ""
    @State private var showDelete = false
    @State private var deleteError: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            CardTitle(icon: "lock", title: "Security")
            if model.canChangePassword {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Change password").font(.scaled(14, weight: .semibold))
                    TField(placeholder: "Current password", text: $current, secure: true)
                    TField(placeholder: "New password (min. 6 characters)", text: $new, secure: true)
                    TField(placeholder: "Confirm new password", text: $confirm, secure: true)
                    HStack(spacing: 12) {
                        Button(busy ? "Saving..." : "Change password", action: changePassword)
                            .buttonStyle(.t(.outline))
                            .disabled(busy || current.isEmpty || new.isEmpty)
                        if let pwStatus { Text(pwStatus).font(.scaled(14)).foregroundStyle(Theme.mutedForeground) }
                    }
                    InlineError(text: pwError)
                }
            }
            if model.canDeleteAccount {
                Hairline()
                VStack(alignment: .leading, spacing: 8) {
                    Text("Delete account").font(.scaled(14, weight: .semibold))
                    Text("Permanently deletes your account, tasks, time entries and billing history. This can't be undone.")
                        .font(.scaled(13)).foregroundStyle(Theme.mutedForeground)
                    Button("Delete account…") { deletePassword = ""; deleteError = nil; showDelete = true }
                        .buttonStyle(.t(.outline))
                        .foregroundStyle(Theme.destructive)
                }
            }
        }
        .card(padding: 20)
        .sheet(isPresented: $showDelete) {
            SheetScaffold(title: "Delete your account?", onClose: { showDelete = false }) {
                VStack(alignment: .leading, spacing: 14) {
                    Text("Enter your password to confirm. Everything in your Trackify account is deleted for good.")
                        .font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
                    TField(placeholder: "Password", text: $deletePassword, secure: true)
                    InlineError(text: deleteError)
                    HStack {
                        Spacer()
                        Button("Cancel") { showDelete = false }.buttonStyle(.t(.outline))
                        Button("Delete account", action: deleteAccount).buttonStyle(.t(.destructive)).disabled(deletePassword.isEmpty)
                    }
                }
            }
            .trackifySheet()
        }
    }

    private func changePassword() {
        pwError = nil; pwStatus = nil
        guard new == confirm else { pwError = "Passwords do not match"; return }
        guard new.count >= 6 else { pwError = "Password must be at least 6 characters"; return }
        busy = true
        Task {
            do {
                try await model.changePassword(current: current, new: new)
                pwStatus = "Password changed"
                current = ""; new = ""; confirm = ""
            } catch let e as APIError { pwError = e.status == 403 || e.status == 401 ? "Current password is incorrect" : e.message }
            catch { pwError = error.localizedDescription }
            busy = false
        }
    }

    private func deleteAccount() {
        deleteError = nil
        Task {
            do { try await model.deleteAccount(password: deletePassword); showDelete = false }
            catch let e as APIError { deleteError = e.status == 403 ? "Incorrect password" : e.message }
            catch { deleteError = error.localizedDescription }
        }
    }
}

private struct AboutCard: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            CardTitle(icon: "server.rack", title: "Server")
            Text(model.session?.server ?? model.serverString).font(.mono(13)).textSelection(.enabled)
            Text("To use another server, sign out and open “Advanced” on the sign-in screen.")
                .font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
            Hairline()
            let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
            let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
            HStack(spacing: 8) {
                AppGlyph(size: 22)
                Text("Trackify \(v) (\(b))").font(.scaled(13)).foregroundStyle(Theme.mutedForeground)
            }
        }
        .card(padding: 20)
    }
}
