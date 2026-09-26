import SwiftUI
import TrackifyKit

/// Leaderboard (WEB_AUDIT §1.9): Daily/Weekly/Monthly, prev/next, calendar, live rows.
struct LeaderboardCard: View {
    @Environment(AppModel.self) private var model
    @Environment(\.scenePhase) private var scenePhase
    @State private var day = DayCalc.current.dayKey(Date())
    @State private var range: LeaderboardRange = .day
    @State private var data: PresenceResponse?
    @State private var loading = true
    @State private var loadError = false
    @State private var pickerOpen = false
    @State private var pickedDate = Date()

    private var calc: DayCalc { .current }
    private var today: String { calc.dayKey(Date()) }
    private var isCurrent: Bool { Leaderboard.isCurrent(range, day: day, today: today) }

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { ctx in
            content(now: ctx.date.ms)
        }
        .card()
        .task(id: "\(day)|\(range.rawValue)|\(model.presenceTick)|\(model.dataTick)") { await load() }
        .task(id: "\(day)|\(range.rawValue)|poll") {
            // Poll every 15 s while the period is current.
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 15_000_000_000)
                if isCurrent && scenePhase == .active { await load() }
            }
        }
        .accessibilityIdentifier("leaderboard")
    }

    @ViewBuilder
    private func content(now: Int64) -> some View {
        let rows = Leaderboard.rows(data?.leaderboard ?? [], range: range, day: day, isCurrent: isCurrent, me: model.session?.userId, now: now)
        let anyoneLive = isCurrent && rows.contains { $0.isLive }
        VStack(alignment: .leading, spacing: 12) {
            header(anyoneLive: anyoneLive)
            if loading && data == nil {
                VStack(spacing: 8) { Skeleton(height: 20); Skeleton(height: 20); Skeleton(height: 20) }
            } else if rows.isEmpty {
                Text(loadError ? "Couldn't load the leaderboard." : "Nobody logged time that \(Leaderboard.noun(range)).")
                    .font(.scaled(14)).foregroundStyle(Theme.mutedForeground)
            } else {
                VStack(spacing: 6) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { i, row in
                        LeaderboardRow(row: row, index: i)
                    }
                }
            }
            footer(rows: rows, now: now)
        }
    }

    private func header(anyoneLive: Bool) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .top) {
                titles(anyoneLive: anyoneLive)
                Spacer(minLength: 8)
                controls
            }
            VStack(alignment: .leading, spacing: 10) {
                titles(anyoneLive: anyoneLive)
                controls
            }
        }
    }

    private func titles(anyoneLive: Bool) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(Leaderboard.title(range, isCurrent: isCurrent)).font(.cardTitle)
            Text(Leaderboard.subtitle(range, isCurrent: isCurrent, anyoneLive: anyoneLive))
                .font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
        }
    }

    private var controls: some View {
        HStack(spacing: 4) {
            Button { step(-1) } label: { Image(systemName: "chevron.left").frame(width: 32, height: 32).contentShape(Rectangle()) }
                .buttonStyle(.plain)
                .accessibilityLabel("Previous \(Leaderboard.noun(range))")
            HStack(spacing: 0) {
                Button {
                    pickedDate = calc.date(fromKey: day) ?? Date()
                    pickerOpen = true
                } label: {
                    Image(systemName: "calendar").font(.scaled(13)).foregroundStyle(Theme.mutedForeground)
                        .frame(width: 32, height: 30).contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Leaderboard.periodLabel(range, day: day, isCurrent: isCurrent))
                .help(Leaderboard.periodLabel(range, day: day, isCurrent: isCurrent))
                .popover(isPresented: $pickerOpen) { datePicker }
                Rectangle().fill(Theme.border).frame(width: 1, height: 30)
                HStack(spacing: 0) {
                    ForEach(LeaderboardRange.allCases, id: \.self) { r in
                        Button { range = r } label: {
                            Text(r.label).font(.scaled(12, weight: .medium)).lineLimit(1).fixedSize()
                                .foregroundStyle(range == r ? Theme.foreground : Theme.mutedForeground)
                                .padding(.horizontal, 8).frame(height: 26)
                                .background(range == r ? Theme.muted : .clear, in: RoundedRectangle(cornerRadius: 4))
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .accessibilityAddTraits(range == r ? .isSelected : [])
                    }
                }
                .padding(2)
            }
            .background(Theme.background, in: RoundedRectangle(cornerRadius: 6))
            .overlay(RoundedRectangle(cornerRadius: 6).strokeBorder(Theme.border))
            Button { step(1) } label: { Image(systemName: "chevron.right").frame(width: 32, height: 32).contentShape(Rectangle()) }
                .buttonStyle(.plain)
                .disabled(isCurrent)
                .opacity(isCurrent ? 0.35 : 1)
                .accessibilityLabel("Next \(Leaderboard.noun(range))")
        }
        .foregroundStyle(Theme.foreground)
    }

    private var datePicker: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(Leaderboard.periodLabel(range, day: day, isCurrent: isCurrent)).font(.scaled(13, weight: .semibold))
            DatePicker("Day", selection: $pickedDate, in: (calc.date(fromKey: "2018-01-01") ?? Date.distantPast)...Date(), displayedComponents: .date)
                .datePickerStyle(.graphical)
                .labelsHidden()
                .onChange(of: pickedDate) { _, d in
                    day = Leaderboard.pick(calc.dayKey(d), today: today)
                    pickerOpen = false
                }
        }
        .padding(12)
        .frame(minWidth: 300)
        #if os(iOS)
        .presentationCompactAdaptation(.popover)
        #endif
    }

    private func footer(rows: [Leaderboard.Row], now: Int64) -> some View {
        let b = Leaderboard.bounds(range, day: day)
        let running = model.running
        let liveYou = isCurrent && running != nil ? liveRangeMs(startTime: running!.startTime, now: now, rangeStart: b.start, rangeEnd: b.end) : 0
        let liveAll = isCurrent && running != nil ? max(0, now - running!.startTime) : 0
        let yourRow = rows.first { $0.isYou }
        let yourTotal = (range == .day && isCurrent) ? (model.stats?.todayTotal ?? 0) + liveYou : (yourRow?.entry.todayMs ?? 0) + liveYou
        let allTime = (model.stats?.grandTotal ?? 0) + liveAll
        return VStack(spacing: 0) {
            Hairline().padding(.bottom, 12)
            HStack(alignment: .bottom) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(Leaderboard.yourLabel(range, isCurrent: isCurrent)).font(.scaled(12, weight: .medium)).foregroundStyle(Theme.mutedForeground)
                    Text(Fmt.durationWords(yourTotal)).font(.scaled(18, weight: .bold)).tabular()
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 2) {
                    Text("All time").font(.scaled(12, weight: .medium)).foregroundStyle(Theme.mutedForeground)
                    Text(model.stats == nil ? "—" : Fmt.durationWords(allTime)).font(.scaled(18, weight: .bold)).tabular()
                }
            }
        }
    }

    private func step(_ dir: Int) {
        day = Leaderboard.pick(Leaderboard.step(range, day: day, direction: dir), today: today)
    }

    private func load() async {
        do {
            let r = try await model.api.presence(day: day, range: range)
            data = r
            loadError = false
        } catch {
            if data == nil { loadError = true }
        }
        loading = false
    }
}

struct LeaderboardRow: View {
    let row: Leaderboard.Row
    let index: Int
    @State private var ping = false

    var body: some View {
        HStack(spacing: 10) {
            Text("\(index + 1)")
                .font(.scaled(14, weight: .bold)).tabular()
                .foregroundStyle(Theme.rank(index) ?? Theme.foreground)
                .frame(width: 20, alignment: .leading)
            VStack(alignment: .leading, spacing: 1) {
                HStack(spacing: 6) {
                    if row.isLive {
                        ZStack {
                            Circle().fill(Color(rgb: 0x34D399)).frame(width: 8, height: 8)
                                .scaleEffect(ping ? 2 : 1).opacity(ping ? 0 : 0.7)
                                .animation(.easeOut(duration: 1).repeatForever(autoreverses: false), value: ping)
                            Circle().fill(Theme.emerald).frame(width: 8, height: 8)
                        }
                        .onAppear { ping = Motion.ambient }
                    }
                    Text(row.entry.name + (row.isYou ? " · you" : "")).font(.scaled(14, weight: .medium)).lineLimit(1)
                }
                if row.isLive, let t = row.entry.taskName {
                    Text("Live · \(t)" + (row.sessionMs > 0 ? " · \(Fmt.durationWords(row.sessionMs)) this stretch" : ""))
                        .font(.scaled(12, weight: .medium)).foregroundStyle(Theme.emeraldText).lineLimit(1)
                }
            }
            Spacer(minLength: 8)
            Text(Fmt.durationWords(row.totalMs)).font(.scaled(14, weight: .semibold)).tabular()
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 6)
        .background {
            if row.isLive {
                RoundedRectangle(cornerRadius: 8).fill(Theme.emerald.opacity(0.1))
                    .overlay(RoundedRectangle(cornerRadius: 8).strokeBorder(Theme.emerald.opacity(0.25)))
            } else if row.isYou {
                RoundedRectangle(cornerRadius: 8).fill(Theme.primary.opacity(0.05))
            }
        }
        .accessibilityElement(children: .combine)
    }
}
