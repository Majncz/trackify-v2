import SwiftUI
import TrackifyKit

/// iOS "Team" tab: the leaderboard, then a row that opens the bar-race player.
struct TeamView: View {
    @Environment(AppModel.self) private var model
    var body: some View {
        List {
            Section { LeaderboardCard().padding(.vertical, 4) }
            #if os(iOS)
            Section {
                NavigationLink(value: TeamRoute.race) {
                    Label {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Race")
                            Text("Play the team's hours back").font(.footnote).foregroundStyle(Theme.mutedForeground)
                        }
                    } icon: { Image(systemName: "chart.bar.xaxis") }
                }
                .accessibilityIdentifier("openRace")
            }
            #endif
        }
        #if os(iOS)
        .listStyle(.insetGrouped)
        .navigationBarTitleDisplayMode(.inline)
        #endif
        .navigationTitle("Team")
        .refreshable { await model.refreshAll() }
    }
}

/// `/visualizations` (WEB_AUDIT §1.10).
struct VisualizationsView: View {
    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                #if os(iOS)
                PageHeader("Race")
                #else
                PageHeader("Visualizations", subtitle: "Play the hours back and watch the team race")
                #endif
                RaceSection(showTitle: false)
            }
            .padding(16)
            .frame(maxWidth: 896)
            .frame(maxWidth: .infinity)
        }
        .background(Theme.background)
    }
}

/// Range chips, playback controls and the bar race stage.
struct RaceSection: View {
    @Environment(AppModel.self) private var model
    var showTitle = true

    @State private var preset: Race.Preset = .pastWeek
    @State private var customFrom = DayCalc.current.addDays(Date(), -6)
    @State private var customTo = Date()
    @State private var data: RaceResponse?
    @State private var merged: [String: [RaceResponse.Event]] = [:]
    @State private var loading = true
    @State private var failed = false
    @State private var durationMs: Int64 = 60_000
    @State private var playing = false
    @State private var playhead: Double = 0
    @State private var playTask: Task<Void, Never>?

    private var keys: (String, String) { Race.keys(preset, customFrom: customFrom, customTo: customTo) }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            if showTitle {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Visualizations").font(.cardTitle)
                    Text("Play the hours back and watch the team race").font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
                }
            }
            ChipRow(items: Race.Preset.allCases.map { ($0, $0.label) }, selection: $preset)
            if preset == .custom {
                HStack(spacing: 12) {
                    DatePicker("From", selection: $customFrom, in: ...customTo, displayedComponents: .date)
                    DatePicker("To", selection: $customTo, in: customFrom...Date(), displayedComponents: .date)
                }
                .font(.scaled(14))
            }
            controls
            stage
        }
        .task(id: "\(keys.0)|\(keys.1)|\(model.dataTick / 3)") { await load() }
        .onDisappear { playTask?.cancel(); playing = false }
        .background(spaceShortcut)
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button(action: togglePlay) {
                    Label(playing ? "Pause" : (playhead >= 1 ? "Play again" : "Play"), systemImage: playing ? "pause.fill" : "play.fill")
                }
                .buttonStyle(.t(.primary))
                .fixedSize()
                .disabled(data?.users.isEmpty ?? true)
                .accessibilityIdentifier("racePlay")
                Button { restart() } label: { Image(systemName: "arrow.counterclockwise") }
                    .buttonStyle(.t(.outline, .icon))
                    .accessibilityLabel("Restart")
                Text("\(Fmt.playClock(Int64(playhead * Double(durationMs)))) / \(Fmt.playClock(durationMs))")
                    .font(.mono(13)).foregroundStyle(Theme.mutedForeground)
                Spacer(minLength: 0)
                Menu {
                    ForEach(Race.speeds, id: \.ms) { s in
                        Button { durationMs = s.ms } label: {
                            if s.ms == durationMs { Label(s.label, systemImage: "checkmark") } else { Text(s.label) }
                        }
                    }
                } label: {
                    HStack(spacing: 4) {
                        Image(systemName: "timer")
                        Text(Race.speeds.first { $0.ms == durationMs }?.label ?? "1 min")
                    }
                    .font(.scaled(13, weight: .medium))
                    .padding(.horizontal, 10).frame(height: 32)
                    .background(Theme.muted, in: RoundedRectangle(cornerRadius: 6))
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .accessibilityLabel("Playback length")
            }
            Slider(value: Binding(get: { playhead }, set: { playhead = $0; pause() }), in: 0...1)
                .accessibilityLabel("Scrub visualization")
                .tint(Theme.foreground)
        }
    }

    @ViewBuilder private var stage: some View {
        if loading && data == nil {
            Skeleton(height: 320)
        } else if failed && data == nil {
            Text("Couldn’t load the race. Try another range.").font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
        } else if let d = data, d.users.isEmpty || d.events.isEmpty {
            Text("Nobody logged time in this range.").font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
        } else if let d = data {
            BarRaceStage(data: d, merged: merged, playhead: playhead)
        }
    }

    private var spaceShortcut: some View {
        Button("") { togglePlay() }
            .keyboardShortcut(.space, modifiers: [])
            .opacity(0).frame(width: 0, height: 0).accessibilityHidden(true)
    }

    private func load() async {
        pause()
        playhead = 0
        do {
            let r = try await model.api.race(from: keys.0, to: keys.1)
            let m = Race.mergeIntervals(r.events)
            data = r
            merged = m
            failed = false
            // Start at the end so the full result is visible; Play replays from the start.
            playhead = 1
        } catch {
            failed = true
        }
        loading = false
    }

    private func togglePlay() {
        if playing { pause(); return }
        if playhead >= 1 { playhead = 0 }
        playing = true
        playTask?.cancel()
        playTask = Task { @MainActor in
            var last = Date()
            while !Task.isCancelled && playing {
                try? await Task.sleep(nanoseconds: 33_000_000)
                let now = Date()
                let dt = now.timeIntervalSince(last)
                last = now
                playhead = min(1, playhead + dt * 1000 / Double(durationMs))
                if playhead >= 1 { playing = false }
            }
        }
    }

    private func pause() {
        playing = false
        playTask?.cancel()
    }

    private func restart() {
        playhead = 0
        playing = false
        togglePlay()
    }
}

/// The "HOURS WORKED" stage: rows sorted by cumulative time at the playhead, animated.
struct BarRaceStage: View {
    let data: RaceResponse
    let merged: [String: [RaceResponse.Event]]
    let playhead: Double
    private let rowH: CGFloat = 64

    var body: some View {
        let span = max(1, data.rangeEnd - data.rangeStart)
        let at = data.rangeStart + Int64(Double(span) * playhead)
        let rows = Race.totalsAt(merged, users: data.users, rangeStart: data.rangeStart, at: at)
        let maxMs = max(rows.first?.ms ?? 0, 1)
        let clockDate = Date(ms: at)
        let calc = DayCalc.current
        VStack(alignment: .leading, spacing: 16) {
            Text("HOURS WORKED").font(.scaled(11, weight: .semibold)).tracking(2.2).foregroundStyle(Theme.stageMuted)
            GeometryReader { g in
                let nameW: CGFloat = g.size.width < 480 ? 76 : 160
                let trackW = max(40, g.size.width - 28 - nameW - 16)
                ZStack(alignment: .topLeading) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        raceRow(row, index: index, maxMs: maxMs, nameW: nameW, trackW: trackW)
                            .frame(height: rowH)
                            .offset(y: CGFloat(index) * rowH)
                            .zIndex(Double(rows.count - index))
                            .animation(.timingCurve(0.22, 1, 0.36, 1, duration: 0.7), value: index)
                    }
                }
            }
            .frame(height: CGFloat(max(rows.count, 1)) * rowH)
            HStack {
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text(calc.format(clockDate, "EEEE")).font(.scaled(15, weight: .medium)).foregroundStyle(Theme.stageMuted)
                    Text(calc.format(clockDate, "d MMM")).font(.scaled(44, weight: .bold)).tabular().foregroundStyle(Theme.stageInk)
                        .tracking(-1)
                    Text(calc.format(clockDate, "HH:mm")).font(.scaled(24, weight: .medium)).tabular().foregroundStyle(Theme.stageMuted)
                    Text("TRACKIFY").font(.scaled(10, weight: .semibold)).tracking(2.4).foregroundStyle(Theme.stageMuted).padding(.top, 4)
                }
            }
        }
        .padding(20)
        .background(Theme.stage, in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous).strokeBorder(Theme.border))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("raceStage")
    }

    private func raceRow(_ row: Race.Row, index: Int, maxMs: Int64, nameW: CGFloat, trackW: CGFloat) -> some View {
        let color = Color(hex: row.color)
        // Leave room after the bar for the badge overhang + duration label.
        let barMax = max(20, trackW - 104)
        let pct = row.ms <= 0 ? 0 : max(0.03, Double(row.ms) / Double(maxMs))
        let barW = CGFloat(pct) * barMax
        return HStack(spacing: 8) {
            Text("\(index + 1)").font(.scaled(14, weight: .bold)).tabular()
                .foregroundStyle(Theme.rank(index) ?? Theme.stageMuted)
                .frame(width: 20, alignment: .trailing)
            Text(row.name).font(.scaled(13, weight: .semibold)).foregroundStyle(Theme.stageInk).lineLimit(1)
                .frame(width: nameW, alignment: .leading)
            ZStack(alignment: .leading) {
                RoundedRectangle(cornerRadius: 3).fill(Theme.stageTrack).frame(width: barMax, height: 20)
                RoundedRectangle(cornerRadius: 3).fill(color)
                    .frame(width: barW, height: 20)
                    .shadow(color: color.opacity(0.5), radius: 9, y: 8)
                if row.ms > 0 {
                    Text(Accent.initials(row.name))
                        .font(.scaled(11, weight: .bold)).foregroundStyle(.white)
                        .frame(width: 36, height: 36)
                        .background(color, in: RoundedRectangle(cornerRadius: 6))
                        .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(.white, lineWidth: 3))
                        .shadow(color: .black.opacity(0.15), radius: 3, y: 2)
                        .offset(x: max(0, barW - 18))
                }
                Text(Fmt.raceDuration(row.ms)).font(.scaled(16, weight: .semibold)).tabular().foregroundStyle(Theme.stageInk)
                    .fixedSize()
                    .offset(x: max(barW, 18) + (row.ms > 0 ? 26 : 4))
            }
            .frame(width: trackW, alignment: .leading)
        }
        .animation(.linear(duration: 0.05), value: row.ms)
    }
}
