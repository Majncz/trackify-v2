import SwiftUI
import WidgetKit
import TrackifyKit

/// Settings (iPhone/iPad): account, appearance, notifications, security, server, sign out.
struct PhoneSettingsView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(SharedKeys.appAppearance, store: AppGroup.defaults) private var appAppearance = AppearanceChoice.system.rawValue
    @AppStorage(SharedKeys.widgetAppearance, store: AppGroup.defaults) private var widgetAppearance = AppearanceChoice.system.rawValue
    @State private var name = ""
    @State private var savedName = ""
    @State private var nameStatus: String?
    @State private var nameError: String?
    @State private var savingName = false
    @State private var reminderHours = Reminder.hours
    @State private var confirmSignOut = false
    @State private var showDelete = false

    private var nameChanged: Bool {
        let n = name.trimmingCharacters(in: .whitespaces)
        return !n.isEmpty && n != savedName.trimmingCharacters(in: .whitespaces)
    }

    var body: some View {
        Form {
            Section {
                LabeledContent("Email", value: model.profile?.email ?? model.session?.email ?? "")
                TextField("Display name", text: $name)
                    .textContentType(.name)
                    .submitLabel(.done)
                    .onSubmit(saveName)
                    .onChange(of: name) { _, v in
                        if v.count > 40 { name = String(v.prefix(40)) }
                        nameStatus = nil
                    }
                    .accessibilityIdentifier("displayName")
                if nameChanged || savingName {
                    Button(savingName ? "Saving…" : "Save name", action: saveName).disabled(savingName)
                }
            } header: {
                Text("Account")
            } footer: {
                if let nameError { Text(nameError).foregroundStyle(Theme.destructive) }
                else { Text(nameStatus ?? "Your display name is shown to your team while you track.") }
            }

            Section("Appearance") {
                Picker("App", selection: $appAppearance) {
                    ForEach(AppearanceChoice.allCases) { Text($0.label).tag($0.rawValue) }
                }
                .accessibilityIdentifier("appearance-app")
                Picker("Widgets", selection: $widgetAppearance) {
                    ForEach(AppearanceChoice.allCases) { Text($0.label).tag($0.rawValue) }
                }
                .accessibilityIdentifier("appearance-widgets")
            }

            Section {
                Picker("“Still tracking?” reminder", selection: $reminderHours) {
                    Text("Off").tag(0)
                    ForEach([1, 2, 3, 4, 6, 8, 10], id: \.self) { Text("After \($0) h").tag($0) }
                }
            } header: {
                Text("Notifications")
            } footer: {
                Text("Get a notification when a timer has been running this long.")
            }

            if model.canChangePassword || model.canDeleteAccount {
                Section("Security") {
                    if model.canChangePassword {
                        NavigationLink("Change password") { ChangePasswordView() }
                    }
                    if model.canDeleteAccount {
                        Button("Delete account…", role: .destructive) { showDelete = true }
                    }
                }
            }

            Section {
                Text(model.session?.server ?? model.serverString).font(.footnote.monospaced()).textSelection(.enabled)
            } header: {
                Text("Server")
            } footer: {
                Text("To use another server, sign out and open “Advanced” on the sign-in screen.")
            }

            Section {
                Button("Sign out", role: .destructive) { confirmSignOut = true }
                    .frame(maxWidth: .infinity)
                    .accessibilityIdentifier("signOut")
            } footer: {
                Text("Trackify \(AppVersion.display)").frame(maxWidth: .infinity)
            }
        }
        .navigationTitle("Settings")
        .navigationBarTitleDisplayMode(.inline)
        .confirmationDialog("Sign out of Trackify?", isPresented: $confirmSignOut, titleVisibility: .visible) {
            Button("Sign out", role: .destructive) { Task { await model.signOut() } }
        }
        .sheet(isPresented: $showDelete) { DeleteAccountSheet().trackifySheet() }
        .onChange(of: widgetAppearance) { _, _ in WidgetCenter.shared.reloadAllTimelines() }
        .onChange(of: reminderHours) { _, h in
            Reminder.hours = h
            Task {
                if h > 0 { _ = await Reminder.requestPermission() }
                Reminder.schedule(model.running, model: model)
            }
        }
        .onAppear { if let p = model.profile, savedName.isEmpty { name = p.displayName; savedName = p.displayName } }
        .onChange(of: model.profile) { _, p in
            if let p, !savingName, name == savedName { name = p.displayName; savedName = p.displayName }
        }
        .task { await model.refreshProfile() }
    }

    private func saveName() {
        guard nameChanged, !savingName else { return }
        savingName = true
        nameError = nil
        Task {
            do {
                try await model.updateDisplayName(name)
                savedName = model.profile?.displayName ?? name
                name = savedName
                nameStatus = "Saved"
            } catch let e as APIError { nameError = e.message.isEmpty ? "Could not save name" : e.message }
            catch { nameError = "Could not save name" }
            savingName = false
        }
    }
}

struct ChangePasswordView: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var current = ""
    @State private var new = ""
    @State private var confirm = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        Form {
            Section {
                SecureField("Current password", text: $current).textContentType(.password)
            }
            Section {
                SecureField("New password", text: $new).textContentType(.newPassword)
                SecureField("Confirm new password", text: $confirm).textContentType(.newPassword)
            } footer: {
                if let error { Text(error).foregroundStyle(Theme.destructive) } else { Text("At least 6 characters.") }
            }
        }
        .navigationTitle("Change password")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(busy ? "Saving…" : "Save", action: save).disabled(busy || current.isEmpty || new.isEmpty)
            }
        }
    }

    private func save() {
        error = nil
        guard new == confirm else { error = "Passwords do not match"; return }
        guard new.count >= 6 else { error = "Password must be at least 6 characters"; return }
        busy = true
        Task {
            do {
                try await model.changePassword(current: current, new: new)
                dismiss()
            } catch let e as APIError { error = e.status == 403 || e.status == 401 ? "Current password is incorrect" : e.message }
            catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}

struct DeleteAccountSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var error: String?

    var body: some View {
        SheetScaffold(title: "Delete your account?", onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 14) {
                Text("Enter your password to confirm. Your account, tasks, time entries and billing history are deleted for good.")
                    .font(.subheadline).foregroundStyle(Theme.mutedForeground)
                TField(placeholder: "Password", text: $password, secure: true)
                InlineError(text: error)
                Button("Delete account", role: .destructive, action: delete)
                    .buttonStyle(.t(.destructive, .lg, full: true))
                    .disabled(password.isEmpty)
            }
        }
    }

    private func delete() {
        error = nil
        Task {
            do { try await model.deleteAccount(password: password); dismiss() }
            catch let e as APIError { error = e.status == 403 ? "Incorrect password" : e.message }
            catch { self.error = error.localizedDescription }
        }
    }
}
