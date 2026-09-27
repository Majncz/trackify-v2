import SwiftUI
import WidgetKit
import TrackifyKit

/// More tab: a plain list; every row opens a full screen with Back.
struct MoreView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            Section {
                row(.billing)
                row(.chat)
            }
            Section {
                row(.settings)
                row(.hidden)
                row(.widgets)
            }
            Section {
                row(.about)
            } footer: {
                Text(model.session?.email ?? "")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("More")
        .navigationBarTitleDisplayMode(.inline)
    }

    private func row(_ item: MoreItem) -> some View {
        NavigationLink(value: item) { Label(item.title, systemImage: item.icon) }
            .accessibilityIdentifier("more-\(item.rawValue)")
    }
}

// MARK: - Hidden tasks

struct HiddenTasksView: View {
    @Environment(AppModel.self) private var model
    @State private var restoring: String?

    var body: some View {
        List {
            if !model.hiddenLoaded {
                ForEach(0..<3, id: \.self) { _ in Skeleton(height: 18).padding(.vertical, 8) }
            } else if model.hiddenTasks.isEmpty {
                Text("No hidden tasks").foregroundStyle(Theme.mutedForeground)
            } else {
                Section {
                    ForEach(model.hiddenTasks) { t in
                        HStack {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(t.name)
                                Text(Fmt.durationWords(t.totalMs)).font(.footnote).tabular().foregroundStyle(Theme.mutedForeground)
                            }
                            Spacer()
                            Button(restoring == t.id ? "Restoring…" : "Restore") {
                                restoring = t.id
                                Task { try? await model.restore(t.id); restoring = nil }
                            }
                            .buttonStyle(.bordered)
                            .buttonBorderShape(.capsule)
                            .disabled(restoring != nil)
                        }
                    }
                } footer: {
                    Text("Hidden tasks keep their time. Restore one to show it on the Timer tab again.")
                }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Hidden tasks")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.refreshHidden() }
        .refreshable { await model.refreshHidden() }
    }
}

// MARK: - Widgets

struct WidgetsInfoView: View {
    @AppStorage(SharedKeys.widgetAppearance, store: AppGroup.defaults) private var widgets = AppearanceChoice.system.rawValue

    var body: some View {
        List {
            Section {
                tip("square.grid.2x2", "Home Screen",
                    "Touch and hold the Home Screen, tap Edit → Add Widget, then pick Trackify. Small, medium and large widgets start and stop tasks right there.")
                tip("lock", "Lock Screen",
                    "Customize the Lock Screen and add the Trackify widget to see the running timer at a glance.")
                tip("livephoto", "Live Activity",
                    "While a timer runs it shows on the Lock Screen and in the Dynamic Island, with a Stop button.")
                tip("switch.2", "Control Center",
                    "Edit Control Center and add the Trackify control to start or stop without opening the app.")
                tip("waveform", "Siri & Shortcuts",
                    "Say “Start <task> in Trackify” or “Stop Trackify”, or use the Start Task, Stop Timer and Current Timer actions in Shortcuts and on the Action button.")
            }
            Section {
                Picker("Widget appearance", selection: $widgets) {
                    ForEach(AppearanceChoice.allCases) { Text($0.label).tag($0.rawValue) }
                }
                .accessibilityIdentifier("appearance-widgets")
                Button("Refresh widgets") { WidgetCenter.shared.reloadAllTimelines() }
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("Widgets")
        .navigationBarTitleDisplayMode(.inline)
        .onChange(of: widgets) { _, _ in WidgetCenter.shared.reloadAllTimelines() }
    }

    private func tip(_ icon: String, _ title: String, _ text: String) -> some View {
        Label {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.body.weight(.medium))
                Text(text).font(.footnote).foregroundStyle(Theme.mutedForeground).fixedSize(horizontal: false, vertical: true)
            }
            .padding(.vertical, 2)
        } icon: { Image(systemName: icon) }
    }
}

// MARK: - About

enum AppVersion {
    static var marketing: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.1.0" }
    static var build: String { Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "1" }
    static var display: String { "\(marketing) (\(build))" }
}

struct AboutView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        List {
            Section {
                VStack(spacing: 10) {
                    AppGlyph(size: 72)
                    Wordmark(size: 24)
                    Text("Version \(AppVersion.display)").font(.subheadline).foregroundStyle(Theme.mutedForeground)
                        .accessibilityIdentifier("appVersion")
                }
                .frame(maxWidth: .infinity)
                .padding(.vertical, 12)
            }
            Section {
                LabeledContent("Version", value: AppVersion.marketing)
                LabeledContent("Build", value: AppVersion.build)
                LabeledContent("Server") {
                    Text(model.session?.server ?? model.serverString).font(.footnote.monospaced()).textSelection(.enabled)
                }
            } footer: {
                Text("What am I working on right now, and how much have I done? — © Bitter Lemon")
            }
        }
        .listStyle(.insetGrouped)
        .navigationTitle("About")
        .navigationBarTitleDisplayMode(.inline)
    }
}
