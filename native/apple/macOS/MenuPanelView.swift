import SwiftUI
import AppKit
import TrackifyKit

// The menu-bar panel (NATIVE_SPEC §5 macOS), drawn like the home-screen / desktop widgets
// (`Shared/Design/WidgetViews.swift`): system type, the task colour only as a small dot, a rounded clock and a soft
// red Stop pill, on the popover material. Each part is its own small view so that a tick, a keystroke or a hover only
// re-renders that part: the clock ticks by itself (`Text(timerInterval:)`), rows are equatable and keep their own hover
// state, and the sorted rows / totals / heat map / team come precomputed from `PanelModel`.

enum PanelMetrics {
    static let width: CGFloat = 372
    static let height: CGFloat = 600
    static let inset: CGFloat = 16
    /// Rows draw their hover highlight a little wider than the text column (like menu items).
    static let rowInset: CGFloat = 8
    static let rowHeight: CGFloat = 30
    static var contentWidth: CGFloat { width - 2 * inset }
}

struct MenuPanelView: View {
    @Environment(AppModel.self) private var model
    @Environment(PanelModel.self) private var panel
    var close: () -> Void
    var openDashboard: (AppScreen?) -> Void

    @State private var fixing: RunningTimer?
    @State private var loggingPast: TrackifyTask?
    @State private var showNewTask = false
    @FocusState private var searchFocused: Bool

    var body: some View {
        content
            .frame(width: PanelMetrics.width, height: PanelMetrics.height)
            .background(PanelMaterial())
            .background(shortcuts)
            .sheet(item: $fixing) { r in FixSessionSheet(running: r).environment(model) }
            .sheet(item: $loggingPast) { t in LogPastSheet(task: t).environment(model) }
            .sheet(isPresented: $showNewTask) { NewTaskSheet(startAfterCreate: true).environment(model) }
            .onReceive(NotificationCenter.default.publisher(for: .trackifyPanelOpened)) { _ in
                panel.query = ""
                panel.createError = nil
                searchFocused = true
            }
            .onReceive(NotificationCenter.default.publisher(for: .trackifyBenchQuery)) { n in panel.query = n.object as? String ?? "" }
    }

    @ViewBuilder private var content: some View {
        if model.phase == .signedOut {
            VStack(spacing: 0) {
                PanelSignedOut(openDashboard: openDashboard)
                Divider()
                PanelFooter(openDashboard: openDashboard)
            }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                PanelHero(onFix: { fixing = $0 })
                    .padding(.horizontal, PanelMetrics.inset)
                    .padding(.top, 14)
                PanelSaveError()
                PanelSearchField(focused: $searchFocused, onSubmit: submitSearch)
                    .padding(.horizontal, PanelMetrics.inset - 4)
                    .padding(.top, 12)
                    .padding(.bottom, 6)
                PanelScrollArea(onCreate: createAndStart,
                                onLogPast: { loggingPast = $0 },
                                openDashboard: openDashboard)
                Divider()
                PanelFooter(openDashboard: openDashboard)
            }
        }
    }

    // MARK: Search actions

    private func filtered() -> [PanelModel.Row] {
        PanelFilter.rows(panel.rows, query: panel.query)
    }

    private func submitSearch() {
        let q = panel.query.trimmingCharacters(in: .whitespaces)
        if let first = filtered().first {
            model.start(first.id)
            panel.query = ""
        } else if !q.isEmpty {
            createAndStart(q)
        }
    }

    private func createAndStart(_ name: String) {
        panel.createError = nil
        Task {
            do { try await model.createAndStart(name: name); panel.query = "" }
            catch let e as APIError { panel.createError = e.message } catch {}
        }
    }

    // MARK: Keyboard shortcuts

    private var shortcuts: some View {
        ZStack {
            ForEach(0..<9, id: \.self) { i in
                Button("") {
                    let rows = filtered()
                    if i < rows.count { model.start(rows[i].id) }
                }
                .keyboardShortcut(KeyEquivalent(Character("\(i + 1)")), modifiers: .command)
            }
            Button("") { model.stop() }.keyboardShortcut(".", modifiers: .command)
            Button("") { searchFocused = true }.keyboardShortcut("f", modifiers: .command)
            Button("") { showNewTask = true }.keyboardShortcut("n", modifiers: .command)
            Button("") { openDashboard(nil) }.keyboardShortcut("d", modifiers: .command)
            Button("") { openDashboard(.settings) }.keyboardShortcut(",", modifiers: .command)
            Button("") { NSApp.terminate(nil) }.keyboardShortcut("q", modifiers: .command)
            Button("") { if let r = model.running { fixing = r } }.keyboardShortcut("e", modifiers: .command)
            Button("") { close() }.keyboardShortcut(.escape, modifiers: [])
        }
        .opacity(0)
        .frame(width: 0, height: 0)
        .accessibilityHidden(true)
    }
}

enum PanelFilter {
    static func rows(_ rows: [PanelModel.Row], query: String) -> [PanelModel.Row] {
        let q = query.trimmingCharacters(in: .whitespaces)
        guard !q.isEmpty else { return rows }
        return rows.filter { $0.name.localizedCaseInsensitiveContains(q) }
    }
}

// MARK: - Material

/// The popover material behind the whole panel (vibrancy, follows light / dark and the app's appearance setting).
struct PanelMaterial: View {
    var body: some View {
        if PanelBench.shotRequested {
            // Off-screen review shots have no desktop to blur (the material falls back to flat grey): draw the
            // material's usual look over a plain desktop instead.
            Color(light: 0xF0F0F0, dark: 0x2A2A2C)
        } else {
            PanelEffectView()
        }
    }
}

struct PanelEffectView: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let v = NSVisualEffectView()
        v.material = .popover
        v.blendingMode = .behindWindow
        v.state = .active
        return v
    }
    func updateNSView(_ nsView: NSVisualEffectView, context: Context) {}
}

/// Hover / press highlight shared by the panel's rows and sections.
struct PanelRowButtonStyle: ButtonStyle {
    var hovered: Bool
    var radius: CGFloat = 7
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(
                RoundedRectangle(cornerRadius: radius, style: .continuous)
                    .fill(Color.primary.opacity(configuration.isPressed ? 0.11 : hovered ? 0.065 : 0))
            )
    }
}

// MARK: - Hero

/// Running: ● task · ● Since 11:42 · big clock (click to fix) · Stop. Idle: "Not tracking" + today's total.
struct PanelHero: View {
    @Environment(AppModel.self) private var model
    @Environment(PanelModel.self) private var panel
    var onFix: (RunningTimer) -> Void

    var body: some View {
        Group {
            if let r = model.running {
                let task = model.task(r.taskId)
                PanelRunningHero(running: r, name: task?.name ?? panel.cachedRunningName ?? "…",
                                 accentHex: task?.accentHex ?? Accent.taskAccentHex(r.taskId),
                                 stopping: model.stopQueued, live: panel.visible,
                                 onFix: { onFix(r) }, onStop: { model.stop() })
                    .equatable()
                    .transition(.opacity)
            } else {
                PanelIdleHero()
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 76, alignment: .topLeading)
        .animation(.easeOut(duration: 0.18), value: model.running?.taskId)
    }
}

struct PanelRunningHero: View, Equatable {
    let running: RunningTimer
    let name: String
    let accentHex: String
    let stopping: Bool
    /// The clock only ticks while the panel is on screen.
    let live: Bool
    var onFix: () -> Void
    var onStop: () -> Void
    @State private var clockHover = false
    @State private var stopHover = false

    static func == (a: Self, b: Self) -> Bool {
        a.running == b.running && a.name == b.name && a.accentHex == b.accentHex && a.stopping == b.stopping && a.live == b.live
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Title + since use the full width; the clock and Stop share the row below.
            HStack(alignment: .firstTextBaseline, spacing: 7) {
                WidgetTaskDot(hex: accentHex, size: 8).alignmentGuide(.firstTextBaseline) { $0[.bottom] - 1 }
                Text(name).font(.system(size: 15, weight: .semibold)).lineLimit(1)
            }
            HStack(spacing: 3) {
                if running.pending {
                    Circle().fill(Color.orange).frame(width: 5, height: 5).frame(width: 10, height: 10)
                    Text(stopping ? "Saving…" : "Syncing…")
                } else {
                    WidgetLiveDot(size: 5)
                    Text(verbatim: "Since \(DayCalc.current.format(Date(ms: running.startTime), "HH:mm"))")
                }
            }
            .font(.system(size: 11.5)).foregroundStyle(.secondary)
            .padding(.leading, -1)
            HStack(alignment: .center, spacing: 8) {
                Button(action: onFix) {
                    HStack(alignment: .center, spacing: 6) {
                        clock
                        Image(systemName: "pencil")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(.secondary)
                            .opacity(clockHover ? 1 : 0)
                    }
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.primary.opacity(clockHover ? 0.06 : 0)))
                    .padding(.horizontal, -6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .onHover { clockHover = $0 }
                .help("Fix this session (⌘E)")
                .accessibilityLabel("Elapsed time. Fix this session")
                Spacer(minLength: 8)
                Button(action: onStop) {
                    StopPillLabel(title: stopping ? "Saving…" : "Stop", full: false, height: 34, emphasis: stopHover ? 0.06 : 0)
                }
                .buttonStyle(.plain)
                .onHover { stopHover = $0 }
                .help("Stop (⌘.)")
            }
        }
    }

    private var clock: some View {
        PanelClock(start: running.startTime, live: live).fixedSize()
    }
}

/// The ticking clock. It's a small AppKit view that redraws its own text once a second, so the tick never touches the
/// SwiftUI graph (no view update, layout or display-list pass for the rest of the panel). Same look and format as the
/// widget's `Text(timerInterval:)`: rounded 36 pt, monospaced digits, 33:29 / 1:03:26. Static while the panel is closed.
struct PanelClock: NSViewRepresentable {
    let start: Int64
    let live: Bool

    func makeNSView(context: Context) -> PanelClockView { PanelClockView() }

    func updateNSView(_ v: PanelClockView, context: Context) {
        v.configure(start: start, live: live)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView: PanelClockView, context: Context) -> CGSize? {
        nsView.intrinsicContentSize
    }

    static func format(_ ms: Int64) -> String {
        let s = Int(ms / 1000)
        return s >= 3600 ? String(format: "%d:%02d:%02d", s / 3600, s / 60 % 60, s % 60) : String(format: "%d:%02d", s / 60, s % 60)
    }
}

final class PanelClockView: NSView {
    private var start: Int64 = 0
    private var live = false
    private var text = ""
    private var timer: Timer?
    private var size = NSSize.zero

    static let font: NSFont = {
        let base = NSFont.systemFont(ofSize: 36, weight: .medium)
        var d = base.fontDescriptor.withDesign(.rounded) ?? base.fontDescriptor
        d = d.addingAttributes([.featureSettings: [[NSFontDescriptor.FeatureKey.typeIdentifier: kNumberSpacingType,
                                                     NSFontDescriptor.FeatureKey.selectorIdentifier: kMonospacedNumbersSelector]]])
        return NSFont(descriptor: d, size: 36) ?? base
    }()

    override init(frame: NSRect) {
        super.init(frame: frame)
        setAccessibilityElement(true)
        setAccessibilityRole(.staticText)
    }
    required init?(coder: NSCoder) { fatalError() }

    func configure(start: Int64, live: Bool) {
        let changed = start != self.start || live != self.live
        self.start = start
        self.live = live
        if changed || text.isEmpty { tick() }
    }

    override var isFlipped: Bool { true }
    override var intrinsicContentSize: NSSize { size }
    override func viewDidChangeEffectiveAppearance() { needsDisplay = true }
    override func viewDidMoveToWindow() { if window == nil { timer?.invalidate(); timer = nil } else { tick() } }

    private func tick() {
        let now = Date().ms
        let elapsed = max(0, now - start)
        let t = PanelClock.format(elapsed)
        if t != text {
            text = t
            let s = (t as NSString).size(withAttributes: [.font: Self.font])
            let newSize = NSSize(width: ceil(s.width), height: ceil(s.height))
            if newSize != size {
                size = newSize
                invalidateIntrinsicContentSize()   // only when the width class changes (59:59 → 1:00:00)
            }
            needsDisplay = true
            setAccessibilityValue(Fmt.durationWords(elapsed))
        }
        timer?.invalidate()
        timer = nil
        guard live, window != nil else { return }
        // Next whole second of the elapsed time.
        let wait = Double(1000 - elapsed % 1000) / 1000 + 0.005
        let tm = Timer(timeInterval: wait, repeats: false) { [weak self] _ in self?.tick() }
        tm.tolerance = 0.02
        RunLoop.main.add(tm, forMode: .common)
        timer = tm
    }

    override func draw(_ dirtyRect: NSRect) {
        (text as NSString).draw(at: .zero, withAttributes: [.font: Self.font, .foregroundColor: NSColor.labelColor])
    }
}

struct PanelIdleHero: View {
    @Environment(PanelModel.self) private var panel
    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text("Not tracking").font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
            Text(widgetDuration(panel.todayTotal(at: panel.now)))
                .font(.system(size: 36, weight: .semibold, design: .rounded))
                .monospacedDigit()
                .lineLimit(1)
                .contentTransition(.numericText())
            Text("today").font(.system(size: 11.5)).foregroundStyle(.secondary)
        }
    }
}

struct PanelSaveError: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        if let err = model.saveError {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(.red)
                Text(err).foregroundStyle(.primary).lineLimit(2)
                Spacer(minLength: 4)
                Button { model.saveError = nil } label: { Image(systemName: "xmark").foregroundStyle(.secondary) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Dismiss")
            }
            .font(.system(size: 12))
            .padding(.horizontal, 10).padding(.vertical, 7)
            .background(Color.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
            .padding(.horizontal, PanelMetrics.inset - 4)
            .padding(.top, 10)
        }
    }
}

// MARK: - Search

struct PanelSearchField: View {
    @Environment(PanelModel.self) private var panel
    var focused: FocusState<Bool>.Binding
    var onSubmit: () -> Void

    var body: some View {
        @Bindable var search = panel
        HStack(spacing: 7) {
            Image(systemName: "magnifyingglass").font(.system(size: 12.5, weight: .medium)).foregroundStyle(.secondary)
            TextField("Start a task…", text: $search.query)
                .textFieldStyle(.plain)
                .font(.system(size: 13.5))
                .focused(focused)
                .onSubmit(onSubmit)
            if !panel.query.isEmpty {
                Button { panel.query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary) }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear")
            } else {
                Text("⌘F").font(.system(size: 11)).foregroundStyle(.quaternary)
            }
        }
        .padding(.horizontal, 10)
        .frame(height: 32)
        .background(Color.primary.opacity(0.06), in: RoundedRectangle(cornerRadius: 9, style: .continuous))
    }
}

// MARK: - Scroll area: tasks, heat map, team

struct PanelScrollArea: View {
    @Environment(AppModel.self) private var model
    @Environment(PanelModel.self) private var panel
    var onCreate: (String) -> Void
    var onLogPast: (TrackifyTask) -> Void
    var openDashboard: (AppScreen?) -> Void

    var body: some View {
        let searching = !panel.query.trimmingCharacters(in: .whitespaces).isEmpty
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    PanelTasksHeader(searching: searching)
                        .padding(.horizontal, PanelMetrics.inset)
                        .id("top")
                    PanelTaskList(onCreate: onCreate, onLogPast: onLogPast,
                                  openDashboard: openDashboard)
                    // Kept alive while searching, just collapsed.
                    VStack(alignment: .leading, spacing: 0) {
                        PanelHeatSection(openDashboard: openDashboard)
                        PanelTeamSection(openDashboard: openDashboard)
                    }
                    .frame(height: searching ? 0 : nil, alignment: .top)
                    .clipped()
                    .opacity(searching ? 0 : 1)
                    .allowsHitTesting(!searching)
                    .accessibilityHidden(searching)
                }
                .padding(.bottom, 10)
            }
            .scrollIndicators(.automatic)
            .onReceive(NotificationCenter.default.publisher(for: .trackifyPanelOpened)) { _ in proxy.scrollTo("top", anchor: .top) }
            .onChange(of: searching) { proxy.scrollTo("top", anchor: .top) }
        }
    }
}

struct PanelTasksHeader: View {
    @Environment(PanelModel.self) private var panel
    @Environment(AppModel.self) private var model
    let searching: Bool
    var body: some View {
        WidgetListHeader(title: searching ? "Results" : (model.running == nil ? "Start" : "Tasks"),
                         trailing: "Today \(widgetDuration(panel.todayTotal(at: panel.now)))")
            .padding(.top, 4)
    }
}

struct PanelTaskList: View {
    @Environment(AppModel.self) private var model
    @Environment(PanelModel.self) private var panel
    var onCreate: (String) -> Void
    var onLogPast: (TrackifyTask) -> Void
    var openDashboard: (AppScreen?) -> Void

    var body: some View {
        let rows = PanelFilter.rows(panel.rows, query: panel.query)
        let q = panel.query.trimmingCharacters(in: .whitespaces)
        let runningId = model.running?.taskId
        let actions = PanelRowActions(model: model, onLogPast: onLogPast, openDashboard: openDashboard)
        // A few dozen rows: built once and kept (scrolling is then pure compositing). Long lists go lazy.
        if rows.count > 120 {
            LazyVStack(alignment: .leading, spacing: 0) { list(rows, q: q, runningId: runningId, actions: actions) }
                .padding(.horizontal, PanelMetrics.inset - PanelMetrics.rowInset)
        } else {
            VStack(alignment: .leading, spacing: 0) { list(rows, q: q, runningId: runningId, actions: actions) }
                .padding(.horizontal, PanelMetrics.inset - PanelMetrics.rowInset)
        }
    }

    @ViewBuilder
    private func list(_ rows: [PanelModel.Row], q: String, runningId: String?, actions: PanelRowActions) -> some View {
            if !model.tasksLoaded {
                ForEach(0..<5, id: \.self) { _ in
                    RoundedRectangle(cornerRadius: 5).fill(Color.primary.opacity(0.07)).frame(height: 12)
                        .padding(.vertical, 9).padding(.horizontal, PanelMetrics.inset)
                }
            } else if rows.isEmpty && q.isEmpty {
                Text("No tasks yet. Type a name above to create one.")
                    .font(.system(size: 12.5)).foregroundStyle(.secondary)
                    .padding(.horizontal, PanelMetrics.inset).padding(.vertical, 8)
            } else {
                // Every row stays in the tree; a search only collapses the ones that don't match (re-creating rows
                // on each keystroke is what made typing slow).
                let shown = Dictionary(uniqueKeysWithValues: rows.enumerated().map { ($1.id, $0) })
                ForEach(panel.rows) { row in
                    let i = shown[row.id]
                    PanelTaskRow(row: row, index: i ?? 0, running: row.id == runningId, isDefault: i == 0 && !q.isEmpty, actions: actions)
                        .equatable()
                        .frame(height: i == nil ? 0 : PanelMetrics.rowHeight, alignment: .top)
                        .clipped()
                        .opacity(i == nil ? 0 : 1)
                        .allowsHitTesting(i != nil)
                        .accessibilityHidden(i == nil)
                }
            }
            if !q.isEmpty, !rows.contains(where: { $0.name.compare(q, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }) {
                PanelCreateRow(name: q, isDefault: rows.isEmpty, onCreate: onCreate)
            }
            if let createError = panel.createError {
                Text(createError).font(.system(size: 12)).foregroundStyle(.red)
                    .padding(.horizontal, PanelMetrics.inset).padding(.top, 4)
            }
    }
}

/// What a row can do; a reference so rows stay equatable on their data alone.
final class PanelRowActions {
    let model: AppModel
    let onLogPast: (TrackifyTask) -> Void
    let openDashboard: (AppScreen?) -> Void
    init(model: AppModel, onLogPast: @escaping (TrackifyTask) -> Void, openDashboard: @escaping (AppScreen?) -> Void) {
        self.model = model; self.onLogPast = onLogPast; self.openDashboard = openDashboard
    }
}

/// dot · name · today · ▶ on hover (■ disc when running) · faint ⌘N.
struct PanelTaskRow: View, Equatable {
    let row: PanelModel.Row
    let index: Int
    let running: Bool
    /// First search result: return starts it.
    let isDefault: Bool
    let actions: PanelRowActions
    @State private var hovered = false

    static func == (a: Self, b: Self) -> Bool {
        a.row == b.row && a.index == b.index && a.running == b.running && a.isDefault == b.isDefault
    }

    var body: some View {
        Button { actions.model.toggle(row.id) } label: {
            HStack(spacing: 8) {
                WidgetTaskDot(hex: row.accentHex, size: 7)
                Text(row.name)
                    .font(.system(size: 13, weight: running ? .semibold : .regular))
                    .lineLimit(1)
                Spacer(minLength: 6)
                PanelRowToday(row: row, running: running)
                // Both stay in place; hover only flips opacities (no views created or removed).
                ZStack(alignment: .trailing) {
                    Group {
                        if isDefault {
                            Text(verbatim: "↩").font(.system(size: 12)).foregroundStyle(.tertiary)
                        } else if index < 9 {
                            PanelShortcutHint(index: index)
                        }
                    }
                    .opacity(running || hovered ? 0 : 1)
                    TaskRowGlyph(running: running, size: 19)
                        .opacity(running || hovered ? 1 : 0)
                }
                .frame(width: 24, alignment: .trailing)
            }
            .padding(.horizontal, PanelMetrics.rowInset)
            .frame(height: PanelMetrics.rowHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(PanelRowButtonStyle(hovered: hovered || isDefault))
        .onHover { h in if h != hovered { hovered = h } }
        .contextMenu {
            Button(running ? "Stop" : "Start") { actions.model.toggle(row.id) }
            Button("Log past time…") { if let t = actions.model.task(row.id) { actions.onLogPast(t) } }
            Button("Details") { NavigationState.shared.open(.task(row.id)); actions.openDashboard(.home) }
            Divider()
            Button("Hide") { Task { try? await actions.model.hide(row.id) } }
        }
        .accessibilityLabel("\(row.name)\(running ? ", running" : "")")
    }
}

/// Today's time; the running row adds the live stretch and follows the panel's minute tick.
struct PanelRowToday: View {
    let row: PanelModel.Row
    let running: Bool
    var body: some View {
        if running {
            PanelRunningRowToday(row: row)
        } else if row.todayMs >= MINUTE_MS {
            Text(widgetDuration(row.todayMs)).font(.system(size: 12)).monospacedDigit().foregroundStyle(.secondary)
        }
    }
}

struct PanelRunningRowToday: View {
    @Environment(AppModel.self) private var model
    @Environment(PanelModel.self) private var panel
    let row: PanelModel.Row
    var body: some View {
        let now = panel.now
        let calc = DayCalc.current
        let live = model.running.map { liveRangeMs(startTime: $0.startTime, now: now.ms, rangeStart: calc.startOfDay(now), rangeEnd: calc.endOfDay(now)) } ?? 0
        Text(widgetDuration(row.todayMs + live)).font(.system(size: 12)).monospacedDigit().foregroundStyle(.secondary)
            .contentTransition(.numericText())
    }
}

struct PanelShortcutHint: View {
    @Environment(PanelModel.self) private var panel
    let index: Int
    var body: some View {
        Text(verbatim: "⌘\(index + 1)")
            .font(.system(size: 10.5, weight: .medium, design: .rounded))
            .foregroundStyle(panel.commandHeld ? AnyShapeStyle(.secondary) : AnyShapeStyle(.quaternary))
    }
}

struct PanelCreateRow: View {
    let name: String
    let isDefault: Bool
    var onCreate: (String) -> Void
    @State private var hovered = false
    var body: some View {
        Button { onCreate(name) } label: {
            HStack(spacing: 8) {
                Image(systemName: "plus.circle.fill").font(.system(size: 14)).foregroundStyle(.green)
                Text(verbatim: "Create “\(name)” and start").font(.system(size: 13)).lineLimit(1)
                Spacer(minLength: 6)
                if isDefault { Text("↩").font(.system(size: 12)).foregroundStyle(.tertiary) }
            }
            .padding(.horizontal, PanelMetrics.rowInset)
            .frame(height: PanelMetrics.rowHeight)
            .contentShape(Rectangle())
        }
        .buttonStyle(PanelRowButtonStyle(hovered: hovered || isDefault))
        .onHover { hovered = $0 }
    }
}

// MARK: - Heat map + team

struct PanelHeatSection: View {
    @Environment(PanelModel.self) private var panel
    var openDashboard: (AppScreen?) -> Void
    @State private var hovered = false
    var body: some View {
        if let heat = panel.heat, heat.heatDays != nil {
            WidgetSectionDivider().padding(.horizontal, PanelMetrics.inset)
            Button { openDashboard(.stats) } label: {
                WidgetHeatMap(s: heat, now: panel.now, width: PanelMetrics.contentWidth)
                    .padding(.horizontal, PanelMetrics.rowInset)
                    .padding(.vertical, 4)
                    .contentShape(Rectangle())
            }
            .buttonStyle(PanelRowButtonStyle(hovered: hovered, radius: 9))
            .onHover { hovered = $0 }
            .padding(.horizontal, PanelMetrics.inset - PanelMetrics.rowInset)
            .help("Open Stats")
        }
    }
}

struct PanelTeamSection: View {
    @Environment(PanelModel.self) private var panel
    var openDashboard: (AppScreen?) -> Void
    @State private var hovered = false
    var body: some View {
        let team = panel.team
        if team.loaded {
            WidgetSectionDivider().padding(.horizontal, PanelMetrics.inset)
            Button { openDashboard(.team) } label: {
                Group {
                    if team.rows(now: panel.now).isEmpty {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Team today").font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
                                .frame(height: WidgetLayout.teamHeader)
                            Text("Nobody has tracked time today.").font(.system(size: 12)).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    } else {
                        WidgetTeamSection(team: team, now: panel.now, maxRows: 12)
                    }
                }
                .padding(.horizontal, PanelMetrics.rowInset)
                .padding(.vertical, 4)
                .contentShape(Rectangle())
            }
            .buttonStyle(PanelRowButtonStyle(hovered: hovered, radius: 9))
            .onHover { hovered = $0 }
            .padding(.horizontal, PanelMetrics.inset - PanelMetrics.rowInset)
            .help("Open Team")
        }
    }
}

// MARK: - Footer

struct PanelFooter: View {
    @Environment(AppModel.self) private var model
    @Environment(PanelModel.self) private var panel
    var openDashboard: (AppScreen?) -> Void

    var body: some View {
        HStack(spacing: 2) {
            PanelFooterButton(title: "Open Dashboard", symbol: "macwindow", shortcut: "⌘D") { openDashboard(nil) }
            Spacer(minLength: 4)
            if model.phase == .signedIn, model.connectionLook != .connected {
                HStack(spacing: 5) {
                    Circle().fill(model.connectionLook.color).frame(width: 6, height: 6)
                    Text(model.connectionLook.label).font(.system(size: 11.5)).foregroundStyle(.secondary)
                }
                .padding(.trailing, 6)
                .help("Changes are saved and sync when the connection is back")
            }
            PanelFooterButton(title: nil, symbol: "gearshape", shortcut: "⌘,") { openDashboard(.settings) }
                .help("Settings (⌘,)")
            Menu {
                Button("Open Dashboard") { openDashboard(nil) }.keyboardShortcut("d")
                Button("Settings…") { openDashboard(.settings) }.keyboardShortcut(",")
                Toggle("Launch at Login", isOn: Binding(get: { panel.launchAtLogin }, set: { panel.setLaunchAtLogin($0) }))
                Divider()
                if model.phase == .signedIn {
                    Button("Sign Out") { Task { await model.signOut() } }
                }
                Button("Quit Trackify") { NSApp.terminate(nil) }.keyboardShortcut("q")
            } label: {
                Image(systemName: "ellipsis.circle").font(.system(size: 14))
            }
            .menuStyle(.borderlessButton)
            .menuIndicator(.hidden)
            .fixedSize()
            .frame(width: 30, height: 26)
            .accessibilityLabel("More")
        }
        .padding(.horizontal, 8)
        .frame(height: 38)
    }
}

struct PanelFooterButton: View {
    let title: String?
    let symbol: String
    let shortcut: String
    var action: () -> Void
    @State private var hovered = false
    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: symbol).font(.system(size: 13))
                if let title { Text(title).font(.system(size: 12.5)) }
            }
            .foregroundStyle(hovered ? .primary : .secondary)
            .padding(.horizontal, 8)
            .frame(height: 26)
            .contentShape(Rectangle())
        }
        .buttonStyle(PanelRowButtonStyle(hovered: hovered, radius: 6))
        .onHover { hovered = $0 }
        .accessibilityLabel(title ?? "Settings")
    }
}

// MARK: - Signed out

struct PanelSignedOut: View {
    var openDashboard: (AppScreen?) -> Void
    var body: some View {
        VStack(spacing: 12) {
            Spacer()
            AppGlyph(size: 48)
            Text("Sign in to start tracking").font(.system(size: 15, weight: .semibold))
            Button("Open Trackify") { openDashboard(.home) }
                .buttonStyle(.borderedProminent)
                .controlSize(.large)
            Spacer()
        }
        .frame(maxWidth: .infinity)
    }
}

