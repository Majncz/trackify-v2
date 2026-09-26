import SwiftUI
import TrackifyKit

/// Create / Edit group dialog (WEB_AUDIT §1.5).
struct GroupEditorSheet: View {
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    let mode: GroupSheetMode
    let range: Analytics.Range

    @State private var name = ""
    @State private var auto = false
    @State private var color = Accent.groupColorPresets[0]
    @State private var selected = Set<String>()
    @State private var filter = ""
    @State private var error: String?
    @State private var busy = false
    @State private var seeded = false

    private var editing: TaskGroup? { if case .edit(let g) = mode { return g }; return nil }
    private var isCreate: Bool { editing == nil }

    private var allTasks: [TrackifyTask] {
        (model.tasks + model.hiddenTasks.map { var t = $0; t.hidden = true; return t })
            .sorted { $0.name.localizedStandardCompare($1.name) == .orderedAscending }
    }

    private var filtered: [TrackifyTask] {
        let q = filter.trimmingCharacters(in: .whitespaces)
        return q.isEmpty ? allTasks : allTasks.filter { $0.name.localizedCaseInsensitiveContains(q) }
    }

    /// A task already in another group is disabled (server enforces one group per task).
    private func allowed(_ t: TrackifyTask) -> Bool {
        guard let gid = groupId(of: t) else { return true }
        return gid == editing?.id
    }

    private func groupId(of t: TrackifyTask) -> String? {
        t.taskGroupId ?? model.groups.first { $0.taskIds.contains(t.id) }?.id
    }

    private func groupName(of t: TrackifyTask) -> String? {
        guard let gid = groupId(of: t) else { return nil }
        return model.groups.first { $0.id == gid }?.name ?? t.taskGroup?.name
    }

    var body: some View {
        SheetScaffold(title: isCreate ? "Create a group from tasks" : "Edit group", onClose: { dismiss() }) {
            VStack(alignment: .leading, spacing: 14) {
                InlineError(text: error)
                TField(placeholder: "Group name", text: $name).accessibilityIdentifier("groupName")
                colourPicker
                TField(placeholder: "Filter tasks…", text: $filter)
                if isCreate {
                    HStack(spacing: 8) {
                        Button("Select all in list") {
                            for t in filtered where allowed(t) { selected.insert(t.id) }
                        }
                        .buttonStyle(.t(.outline, .sm)).disabled(filtered.isEmpty)
                        Button("Clear selection") { selected.removeAll() }.buttonStyle(.t(.ghost, .sm))
                        Spacer()
                        if !filter.trimmingCharacters(in: .whitespaces).isEmpty {
                            Text("\(filtered.count) match\(filtered.count == 1 ? "" : "es")").font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
                        }
                    }
                }
                ScrollView {
                    LazyVStack(spacing: 2) {
                        if filtered.isEmpty {
                            Text(allTasks.isEmpty ? "No tasks yet." : "No tasks match.").font(.scaled(14)).foregroundStyle(Theme.mutedForeground).padding(.vertical, 24)
                        }
                        ForEach(filtered) { t in row(t) }
                    }
                }
                .frame(minHeight: 180, maxHeight: 360)
                .background(Theme.muted.opacity(0.3), in: RoundedRectangle(cornerRadius: 8))
                if isCreate {
                    let total = selected.compactMap { id in allTasks.first { $0.id == id } }.reduce(Int64(0)) { $0 + Analytics.taskMs($1, from: range.from, to: range.to) }
                    Text("\(selected.count) task\(selected.count == 1 ? "" : "s") selected · \(Fmt.fmtMs(total))")
                        .font(.scaled(13)).foregroundStyle(Theme.mutedForeground).tabular()
                }
                HStack(spacing: 8) {
                    Spacer()
                    Button("Cancel") { dismiss() }.buttonStyle(.t(.outline))
                    Button(busy ? "Saving…" : (isCreate ? "Create group" : "Save"), action: save)
                        .buttonStyle(.t(.primary))
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty || (isCreate && selected.isEmpty))
                        .keyboardShortcut(.defaultAction)
                }
            }
        }
        .onAppear(perform: seed)
        .task { if !model.hiddenLoaded { await model.refreshHidden() } }
    }

    private var colourPicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("Group colour").font(.scaled(12, weight: .medium))
                Spacer()
                Segmented(items: [(false, "Custom"), (true, "Auto")], selection: $auto, compact: true).frame(width: 150)
            }
            let preview = auto ? (editing.map { Accent.groupAccentHex($0.id) } ?? Accent.autoPreviewHex) : color
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 8), count: 10), spacing: 8) {
                ForEach(Array(Accent.groupColorPresets.enumerated()), id: \.offset) { i, hex in
                    Button {
                        auto = false
                        color = hex
                    } label: {
                        Circle().fill(Color(hex: hex)).frame(width: 26, height: 26)
                            .overlay(Circle().strokeBorder(Theme.foreground, lineWidth: !auto && color == hex ? 2 : 0).padding(-3))
                            .frame(width: 34, height: 34)
                            .contentShape(Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(Accent.groupColorPresetNames[i])
                    .accessibilityAddTraits(!auto && color == hex ? .isSelected : [])
                }
            }
            .opacity(auto ? 0.4 : 1)
            if auto {
                HStack(spacing: 6) {
                    Circle().fill(Color(hex: preview)).frame(width: 10, height: 10)
                    Text(isCreate ? "Color will follow the automatic palette from the group id after you save."
                                  : "Uses the automatic palette from the group id. Choose Custom to pick a preset.")
                        .font(.scaled(11)).foregroundStyle(Theme.mutedForeground)
                }
            }
        }
    }

    private func row(_ t: TrackifyTask) -> some View {
        let ok = allowed(t)
        let on = selected.contains(t.id)
        return Button {
            guard ok else { return }
            if on { selected.remove(t.id) } else { selected.insert(t.id) }
        } label: {
            HStack(spacing: 10) {
                Image(systemName: on ? "checkmark.square.fill" : "square")
                    .foregroundStyle(ok ? Theme.foreground : Theme.mutedForeground)
                Text(t.name).font(.scaled(14)).lineLimit(1)
                if let gn = groupName(of: t), !ok || editing == nil {
                    Text(gn).font(.scaled(10, weight: .medium)).foregroundStyle(Theme.mutedForeground).lineLimit(1)
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .background(Theme.muted, in: Capsule())
                }
                if t.hidden {
                    Text("Hidden").font(.scaled(10, weight: .medium)).foregroundStyle(Theme.mutedForeground)
                        .padding(.horizontal, 6).padding(.vertical, 1)
                        .overlay(Capsule().strokeBorder(Theme.border))
                }
                Spacer()
                Text(Fmt.fmtMs(Analytics.taskMs(t, from: range.from, to: range.to))).font(.scaled(12)).tabular().foregroundStyle(Theme.mutedForeground)
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 36)
            .opacity(ok ? 1 : 0.5)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(!ok)
    }

    private func seed() {
        guard !seeded else { return }
        seeded = true
        if let g = editing {
            name = g.name
            selected = Set(g.taskIds)
            auto = g.color == nil
            color = g.color ?? Accent.groupAccentHex(g.id)
        } else {
            auto = false
            color = Accent.groupColorPresets.randomElement() ?? Accent.groupColorPresets[0]
        }
    }

    private func save() {
        let n = name.trimmingCharacters(in: .whitespaces)
        guard !n.isEmpty else { return }
        if isCreate && selected.isEmpty { return }
        if !auto && !Accent.isValidHex(color) { error = "Pick a preset color or switch to Auto."; return }
        busy = true
        error = nil
        Task {
            do {
                try await model.saveGroup(id: editing?.id, name: n, taskIds: Array(selected), color: auto ? nil : color)
                dismiss()
            } catch let e as APIError {
                error = e.message
            } catch { self.error = isCreate ? "Could not create group" : "Could not save group" }
            busy = false
        }
    }
}
