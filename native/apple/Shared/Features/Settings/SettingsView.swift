#if os(macOS)
import SwiftUI
import WidgetKit
import TrackifyKit
import ServiceManagement

/// Mac Settings: a native grouped form — account, appearance, menu bar, notifications, hidden tasks,
/// security, server, sign out. (iPhone/iPad: `PhoneSettingsView`.)
struct SettingsView: View {
    @Environment(AppModel.self) private var model
    @AppStorage(SharedKeys.appAppearance, store: AppGroup.defaults) private var appAppearance = AppearanceChoice.system.rawValue
    @AppStorage(SharedKeys.widgetAppearance, store: AppGroup.defaults) private var widgetAppearance = AppearanceChoice.system.rawValue
    @State private var name = ""
    @State private var savedName = ""
    @State private var nameStatus: String?
    @State private var nameError: String?
    @State private var savingName = false
    @State private var reminderHours = Reminder.hours
    @State private var showSeconds = AppGroup.defaults.bool(forKey: SharedKeys.menuBarShowSeconds)
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @State private var restoring: String?
    @State private var confirmSignOut = false
    @State private var showPassword = false
    @State private var showDelete = false

    private var nameChanged: Bool {
        let n = name.trimmingCharacters(in: .whitespaces)
        return !n.isEmpty && n != savedName.trimmingCharacters(in: .whitespaces)
    }

    var body: some View {
        Form {
            Section {
                LabeledContent("Email", value: model.profile?.email ?? model.session?.email ?? "")
                LabeledContent("Display name") {
                    HStack(spacing: 8) {
                        TextField("Display name", text: $name, prompt: Text("How others see you"))
                            .labelsHidden()
                            .multilineTextAlignment(.trailing)
                            .onSubmit(saveName)
                            .onChange(of: name) { _, v in
                                if v.count > 40 { name = String(v.prefix(40)) }
                                nameStatus = nil
                            }
                            .accessibilityIdentifier("displayName")
                        if nameChanged || savingName {
                            Button(savingName ? "Saving…" : "Save", action: saveName).disabled(savingName)
                        }
                    }
                }
            } header: {
                Text("Account")
            } footer: {
                footer(nameError.map { Text($0).foregroundStyle(.red) }
                       ?? Text(nameStatus ?? "Your display name is shown to your team while you track."))
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
                Toggle("Launch at login", isOn: $launchAtLogin)
                Toggle("Show seconds in the menu bar", isOn: $showSeconds)
                LabeledContent("Menu bar panel shortcut", value: "⌃⌥T")
            } header: {
                Text("General")
            }

            Section {
                Picker("“Still tracking?” reminder", selection: $reminderHours) {
                    Text("Off").tag(0)
                    ForEach([1, 2, 3, 4, 6, 8, 10], id: \.self) { Text("After \($0) h").tag($0) }
                }
            } header: {
                Text("Notifications")
            } footer: {
                footer(Text("Get a notification when a timer has been running this long."))
            }

            Section {
                if !model.hiddenLoaded {
                    ProgressView().controlSize(.small)
                } else if model.hiddenTasks.isEmpty {
                    Text("No hidden tasks").foregroundStyle(.secondary)
                } else {
                    ForEach(model.hiddenTasks) { t in
                        LabeledContent {
                            Button(restoring == t.id ? "Restoring…" : "Restore") {
                                restoring = t.id
                                Task { try? await model.restore(t.id); restoring = nil }
                            }
                            .disabled(restoring != nil)
                        } label: {
                            Text(t.name)
                            Text(Fmt.durationWords(t.totalMs)).tabular()
                        }
                    }
                }
            } header: {
                Text("Hidden tasks")
            } footer: {
                footer(Text("Hidden tasks keep their time. Restore one to show it in Timer again."))
            }

            if model.canChangePassword || model.canDeleteAccount {
                Section("Security") {
                    if model.canChangePassword {
                        LabeledContent("Password") {
                            Button("Change Password…") { showPassword = true }
                        }
                    }
                    if model.canDeleteAccount {
                        LabeledContent {
                            Button("Delete Account…", role: .destructive) { showDelete = true }
                        } label: {
                            Text("Delete account")
                            Text("Deletes your tasks, time entries and billing history for good.")
                        }
                    }
                }
            }

            Section {
                LabeledContent("Server") {
                    Text(model.session?.server ?? model.serverString).font(.callout.monospaced()).textSelection(.enabled)
                }
                LabeledContent("Version", value: Self.version)
            } header: {
                Text("About")
            } footer: {
                footer(Text("To use another server, sign out and open “Advanced” on the sign-in screen."))
            }

            Section {
                LabeledContent {
                    Button("Sign Out…") { confirmSignOut = true }
                        .accessibilityIdentifier("signOut")
                } label: {
                    Text("Signed in as \(model.session?.email ?? "")")
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
        .navigationSubtitle(model.session?.email ?? "")
        .confirmationDialog("Sign out of Trackify?", isPresented: $confirmSignOut) {
            Button("Sign Out", role: .destructive) { Task { await model.signOut() } }
        }
        .sheet(isPresented: $showPassword) { ChangePasswordSheet() }
        .sheet(isPresented: $showDelete) { DeleteAccountSheet() }
        .onChange(of: appAppearance) { _, _ in AppearanceChoice.applyToMacApp() }
        .onChange(of: widgetAppearance) { _, _ in WidgetCenter.shared.reloadAllTimelines() }
        .onChange(of: showSeconds) { _, v in AppGroup.defaults.set(v, forKey: SharedKeys.menuBarShowSeconds) }
        .onChange(of: launchAtLogin) { _, on in
            do { if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() } }
            catch { launchAtLogin = SMAppService.mainApp.status == .enabled }
        }
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
        .task {
            await model.refreshProfile()
            await model.refreshHidden()
        }
    }

    private func footer(_ text: Text) -> some View {
        text.font(.callout).foregroundStyle(.secondary).frame(maxWidth: .infinity, alignment: .leading)
    }

    static var version: String {
        let v = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
        let b = Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1"
        return "\(v) (\(b))"
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
                nameStatus = "Saved."
            } catch let e as APIError { nameError = e.message.isEmpty ? "Could not save name" : e.message }
            catch { nameError = "Could not save name" }
            savingName = false
        }
    }
}

private struct ChangePasswordSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var current = ""
    @State private var new = ""
    @State private var confirm = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Form {
                Section {
                    SecureField("Current password", text: $current)
                } header: {
                    Text("Change password").font(.headline)
                }
                Section {
                    SecureField("New password", text: $new)
                    SecureField("Confirm new password", text: $confirm)
                } footer: {
                    Text(error ?? "At least 6 characters.")
                        .font(.callout)
                        .foregroundStyle(error == nil ? Color.secondary : Color.red)
                }
            }
            .formStyle(.grouped)
            .scrollDisabled(true)
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button(busy ? "Saving…" : "Change Password", action: save)
                    .keyboardShortcut(.defaultAction)
                    .disabled(busy || current.isEmpty || new.isEmpty)
            }
            .padding([.horizontal, .bottom], 20)
        }
        .frame(width: 420)
    }

    private func save() {
        error = nil
        guard new == confirm else { error = "Passwords do not match."; return }
        guard new.count >= 6 else { error = "Password must be at least 6 characters."; return }
        busy = true
        Task {
            do {
                try await model.changePassword(current: current, new: new)
                dismiss()
            } catch let e as APIError { error = e.status == 403 || e.status == 401 ? "Current password is incorrect." : e.message }
            catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}

private struct DeleteAccountSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var password = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Delete your account?").font(.headline)
            Text("Enter your password to confirm. Your account, tasks, time entries and billing history are deleted for good.")
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            SecureField("Password", text: $password)
                .textFieldStyle(.roundedBorder)
            if let error { Text(error).foregroundStyle(.red) }
            HStack {
                Spacer()
                Button("Cancel") { dismiss() }.keyboardShortcut(.cancelAction)
                Button("Delete Account", role: .destructive, action: delete)
                    .keyboardShortcut(.defaultAction)
                    .disabled(password.isEmpty || busy)
            }
        }
        .padding(20)
        .frame(width: 420)
    }

    private func delete() {
        error = nil
        busy = true
        Task {
            do { try await model.deleteAccount(password: password); dismiss() }
            catch let e as APIError { error = e.status == 403 ? "Incorrect password." : e.message }
            catch { self.error = error.localizedDescription }
            busy = false
        }
    }
}
#endif
