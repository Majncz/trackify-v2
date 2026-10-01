import SwiftUI
import TrackifyKit

// MARK: - Yearly contribution calendar (WEB_AUDIT §1.5.1)

struct YearlyCalendarView: View {
    let data: YearlyCalendarData
    var taskColors: [String: String] = [:]
    /// Custom detail body (billing); default shows minutes per task.
    var detail: ((Date, Double, String, [String: Double]) -> AnyView)? = nil
    /// Tap on a non-future day (billing filter). When set, taps call this instead of only selecting.
    var onDayTap: ((String, Date) -> Void)? = nil

    @State private var selected: (col: Int, row: Int)?
    private let cell: CGFloat = 12
    private let gap: CGFloat = 2
    private var colW: CGFloat { cell + gap }
    private let dayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

    var body: some View {
        let calc = DayCalc.current
        // Drop a month label that would collide with the next one (partial first month).
        let allMonths = data.monthLabels(calc: calc)
        let months = allMonths.enumerated().filter { i, m in
            i + 1 >= allMonths.count || allMonths[i + 1].index - m.index >= 3
        }.map(\.element)
        let todayKey = calc.dayKey(Date())
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 4) {
                VStack(alignment: .trailing, spacing: gap) {
                    Color.clear.frame(height: 14)
                    ForEach(0..<7, id: \.self) { r in
                        Text(r % 2 == 0 ? dayLabels[r] : "").font(.system(size: 9)).foregroundStyle(Theme.mutedForeground)
                            .frame(height: cell)
                    }
                }
                .frame(width: 24)
                ScrollViewReader { proxy in
                    ScrollView(.horizontal, showsIndicators: false) {
                        VStack(alignment: .leading, spacing: 2) {
                            ZStack(alignment: .topLeading) {
                                ForEach(months, id: \.index) { m in
                                    Text(m.label).font(.system(size: 9)).foregroundStyle(Theme.mutedForeground)
                                        .fixedSize()
                                        .offset(x: CGFloat(m.index) * colW)
                                }
                            }
                            .frame(width: CGFloat(data.weeks.count) * colW, height: 12, alignment: .topLeading)
                            Canvas { ctx, _ in
                                for c in 0..<data.weeks.count {
                                    for r in 0..<7 {
                                        let rect = CGRect(x: CGFloat(c) * colW, y: CGFloat(r) * colW, width: cell, height: cell)
                                        let m = data.grid[r][c]
                                        let lvl = HeatScale.level(m, working: data.working)
                                        ctx.fill(Path(roundedRect: rect, cornerRadius: 2), with: .color(Theme.heat(lvl)))
                                        if let s = selected, s.col == c, s.row == r {
                                            ctx.stroke(Path(roundedRect: rect.insetBy(dx: -1, dy: -1), cornerRadius: 3), with: .color(Theme.foreground), lineWidth: 1.5)
                                        }
                                    }
                                }
                            }
                            .frame(width: CGFloat(data.weeks.count) * colW, height: 7 * colW)
                            .contentShape(Rectangle())
                            .onTapGesture { loc in
                                let c = Int(loc.x / colW), r = Int(loc.y / colW)
                                guard c >= 0, c < data.weeks.count, r >= 0, r < 7 else { return }
                                let day = data.weeks[c][r]
                                let key = calc.dayKey(day)
                                if let onDayTap, key <= todayKey { onDayTap(key, day) }
                                withAnimation(.easeOut(duration: 0.15)) {
                                    if let s = selected, s.col == c, s.row == r { selected = nil } else { selected = (c, r) }
                                }
                            }
                            Color.clear.frame(width: 1, height: 1).id("end")
                        }
                        .padding(.trailing, 4)
                    }
                    .onAppear { proxy.scrollTo("end", anchor: .trailing) }
                    .onChange(of: data.weeks.count) { _, _ in proxy.scrollTo("end", anchor: .trailing) }
                }
            }
            if let s = selected, s.col < data.weeks.count {
                let day = data.weeks[s.col][s.row]
                let key = calc.dayKey(day)
                let minutes = data.grid[s.row][s.col]
                let tm = data.dayTaskMinutes[key] ?? [:]
                Group {
                    if let detail { detail(day, minutes, key, tm) } else { defaultDetail(day: day, minutes: minutes, taskMinutes: tm) }
                }
                .padding(12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Theme.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
                .transition(.opacity)
            }
            HStack(spacing: 5) {
                Spacer()
                Text("Less").font(.scaled(10)).foregroundStyle(Theme.mutedForeground)
                ForEach(0..<5, id: \.self) { i in RoundedRectangle(cornerRadius: 2).fill(Theme.heat(i)).frame(width: 10, height: 10) }
                Text("More").font(.scaled(10)).foregroundStyle(Theme.mutedForeground)
            }
        }
    }

    private func defaultDetail(day: Date, minutes: Double, taskMinutes: [String: Double]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            VStack(alignment: .leading, spacing: 2) {
                Text(DayCalc.current.format(day, "EEEE, MMMM d, yyyy")).font(.scaled(14, weight: .semibold))
                Text("Total for this calendar day").font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
            }
            Hairline()
            Text("\(Fmt.heatMinutes(minutes)) total").font(.scaled(12, weight: .medium))
            ForEach(taskMinutes.sorted { $0.value > $1.value }, id: \.key) { name, mins in
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    RoundedRectangle(cornerRadius: 2).fill(Color(hex: taskColors[name] ?? Accent.otherHex)).frame(width: 8, height: 8)
                    (Text(name).fontWeight(.medium) + Text(" · \(Fmt.heatMinutes(mins))").foregroundColor(Theme.mutedForeground))
                        .font(.scaled(12))
                }
            }
        }
    }
}

// MARK: - Weekly day × hour heat grid (WEB_AUDIT §1.4)

struct WeeklyHeatGridView: View {
    let grid: WeeklyHeatGrid
    let taskColors: [String: String]
    let legendOrder: [String]
    let hasOther: Bool

    @State private var width: CGFloat = 340
    @State private var selection: Selection?
    @State private var topRow: Int?

    struct Selection: Equatable { var row: Int; var segment: HeatSegment }

    private let labelW: CGFloat = 52
    private let gap: CGFloat = 2
    private let viewport: CGFloat = 240

    var body: some View {
        let m = WeeklyHeatGrid.metrics(availableWidth: max(0, width - labelW - gap))
        let sph = m.squaresPerHour, size = CGFloat(m.cellSize)
        let hourW = size * CGFloat(sph) + CGFloat(sph - 1) * gap
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 0) {
                Color.clear.frame(width: labelW + gap, height: 10)
                ForEach(0..<24, id: \.self) { h in
                    Text(h % 6 == 0 ? "\(h)" : "").font(.system(size: 9)).lineLimit(1).fixedSize().foregroundStyle(Theme.mutedForeground)
                        .frame(width: hourW + (h < 23 ? gap : 0), alignment: .leading)
                }
            }
            ScrollViewReader { proxy in
                ScrollView(.vertical) {
                    LazyVStack(alignment: .leading, spacing: gap) {
                        ForEach(0..<grid.days.count, id: \.self) { i in
                            row(i, sph: sph, size: size)
                                .id(i)
                        }
                    }
                }
                .frame(height: viewport)
                .onAppear { proxy.scrollTo(grid.days.count - 1, anchor: .bottom) }
                .onChange(of: topRow) { _, r in if let r { withAnimation { proxy.scrollTo(r, anchor: .top) } } }
            }
            if let sel = selection { detail(sel, sph: sph) }
            FlowLayout(spacing: 12) {
                ForEach(legendOrder, id: \.self) { n in LegendItem(hex: taskColors[n] ?? Accent.otherHex, name: n) }
                if hasOther { LegendItem(hex: Accent.otherHex, name: "Other") }
            }
            .frame(maxWidth: .infinity)
        }
        .background(GeometryReader { g in Color.clear.onAppear { width = g.size.width }.onChange(of: g.size.width) { _, w in width = w } })
    }

    private func row(_ i: Int, sph: Int, size: CGFloat) -> some View {
        let day = grid.days[i]
        let cells = grid.grid[i]
        let segments = WeeklyHeatGrid.segments(hourCells: cells, squaresPerHour: sph)
        let total = 24 * sph
        return HStack(spacing: gap) {
            Text(DayCalc.current.format(day, "MMM d")).font(.system(size: 11)).tabular().foregroundStyle(Theme.mutedForeground)
                .lineLimit(1).frame(width: labelW - 6, alignment: .trailing).padding(.trailing, 6)
            Canvas { ctx, _ in
                for flat in 0..<total {
                    let hour = flat / sph
                    let cell = cells[hour]
                    let seg = segments.first { flat >= $0.startFlat && flat <= $0.endFlat }
                    let fill = seg?.taskName ?? cell.dominantTask
                    let color: Color = fill.map { Color(hex: taskColors[$0] ?? Accent.otherHex) } ?? Theme.muted
                    let hasTime = cell.totalMinutes > 0
                    let op = hasTime ? WeeklyHeatGrid.opacity(cell.totalMinutes, max: grid.maxMinutes) : (seg != nil ? 0.42 : 0.7)
                    let rect = CGRect(x: CGFloat(flat) * (size + gap), y: 0, width: size, height: size)
                    ctx.fill(Path(roundedRect: rect, cornerRadius: 2), with: .color(color.opacity(op)))
                    if let s = selection, s.row == i, flat >= s.segment.startFlat, flat <= s.segment.endFlat {
                        ctx.stroke(Path(roundedRect: rect, cornerRadius: 2), with: .color(Theme.foreground.opacity(0.6)), lineWidth: 1)
                    }
                }
            }
            .frame(width: CGFloat(total) * (size + gap) - gap, height: size)
            .contentShape(Rectangle())
            .onTapGesture { loc in
                let flat = Int(loc.x / (size + gap))
                if let seg = segments.first(where: { flat >= $0.startFlat && flat <= $0.endFlat }) {
                    withAnimation(.easeOut(duration: 0.15)) {
                        selection = selection == Selection(row: i, segment: seg) ? nil : Selection(row: i, segment: seg)
                    }
                } else {
                    selection = nil
                }
            }
        }
        .frame(height: size)
    }

    private func detail(_ sel: Selection, sph: Int) -> some View {
        let calc = DayCalc.current
        let day = grid.days[sel.row]
        let rs = WeeklyHeatGrid.slotRange(day: day, flat: sel.segment.startFlat, squaresPerHour: sph).start
        let re = WeeklyHeatGrid.slotRange(day: day, flat: sel.segment.endFlat, squaresPerHour: sph).end
        let evs = grid.eventsByDay[calc.dayKey(day)] ?? []
        let precise = WeeklyHeatGrid.preciseWindow(events: evs, start: rs, end: re, task: sel.segment.taskName)
        let mins = WeeklyHeatGrid.minutes(events: evs, task: sel.segment.taskName, start: rs, end: re)
        let fmt = { (ms: Int64) in calc.format(Date(ms: ms), "HH:mm:ss") }
        let timeLine = precise.map { "\(fmt($0.0)) → \(fmt($0.1))" } ?? "\(fmt(rs)) → \(fmt(re)) (grid)"
        let gapMin = Double(sel.segment.bridgedEmptySlots) * (60.0 / Double(sph))
        return HStack(alignment: .top) {
            VStack(alignment: .leading, spacing: 4) {
                Text(calc.format(day, "EEEE, MMMM d, yyyy")).font(.scaled(14, weight: .semibold))
                Text(calc.format(day, "d.M.yyyy")).font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
                Text(timeLine).font(.scaled(12, weight: .medium)).tabular()
                Hairline().padding(.vertical, 2)
                HStack(alignment: .top, spacing: 8) {
                    RoundedRectangle(cornerRadius: 2).fill(Color(hex: taskColors[sel.segment.taskName] ?? Accent.otherHex))
                        .frame(width: 10, height: 10).padding(.top, 4)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(sel.segment.taskName).font(.scaled(14, weight: .medium)).lineLimit(2)
                        Text(Fmt.heatMinutes(mins)).font(.scaled(16, weight: .semibold)).tabular()
                    }
                }
                if sel.segment.bridgedEmptySlots > 0 {
                    Text("Short gap in this streak: \(Fmt.heatMinutes(gapMin)) with no logged time")
                        .font(.scaled(12)).foregroundStyle(Theme.mutedForeground).padding(.leading, 18)
                }
            }
            Spacer()
            CopyButton(text: {
                WeeklyHeatGrid.tooltipPlainText(day: day, task: sel.segment.taskName, minutes: mins, timeLine: timeLine,
                                                bridged: sel.segment.bridgedEmptySlots, squaresPerHour: sph)
            }, label: "Copy details")
        }
        .padding(12)
        .background(Theme.muted.opacity(0.5), in: RoundedRectangle(cornerRadius: 8))
    }
}

// MARK: - Home "Time Spent" card

struct TimeSpentCard: View {
    @Environment(AppModel.self) private var model
    enum Mode: String { case weekly, yearly }
    @State private var mode: Mode = .weekly
    @State private var weekly: WeeklyHeatGrid?
    @State private var yearly: YearlyCalendarData?
    @State private var colors: (weekly: [String: String], order: [String], hasOther: Bool, yearly: [String: String]) = ([:], [], false, [:])
    @State private var liveTick = 0

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Time Spent").font(.cardTitle)
                    Text(subtitle).font(.scaled(12)).foregroundStyle(Theme.mutedForeground)
                }
                Spacer()
                Segmented(items: [(Mode.weekly, "Weekly"), (Mode.yearly, "Yearly")], selection: $mode, compact: true)
                    .fixedSize()
            }
            Group {
                switch mode {
                case .weekly:
                    if let w = weekly {
                        if w.hasData {
                            WeeklyHeatGridView(grid: w, taskColors: colors.weekly, legendOrder: colors.order, hasOther: colors.hasOther)
                        } else { EmptyState(text: "No data for this period") }
                    } else { Skeleton(height: 240) }
                case .yearly:
                    if let y = yearly {
                        YearlyCalendarView(data: y, taskColors: colors.yearly)
                    } else { Skeleton(height: 120) }
                }
            }
        }
        .card()
        .task(id: "\(model.dataTick)|\(model.tasks.count)|\(model.running?.id ?? "-")|\(liveTick)") { await rebuild() }
        .task(id: model.running?.id) {
            // Live timer is included as a synthetic event, refreshed every 10 s.
            guard model.running != nil else { return }
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 10_000_000_000)
                liveTick += 1
            }
        }
    }

    private var subtitle: String {
        guard let w = weekly, let f = w.days.first, let l = w.days.last, mode == .weekly else { return "Yearly Calendar" }
        let c = DayCalc.current
        return "\(c.format(f, "MMM d")) - \(c.format(l, "MMM d, yyyy"))"
    }

    private func rebuild() async {
        let tasks = model.liveTasks()
        let liveId = model.running?.taskId
        let result = await Task.detached(priority: .userInitiated) { () -> (WeeklyHeatGrid, YearlyCalendarData, [String: String], [String], Bool, [String: String]) in
            let w = WeeklyHeatGrid.build(tasks: tasks)
            let y = YearlyCalendarData.fromTasks(tasks)
            let wc = Analytics.weeklyTaskColors(tasks: tasks, liveTaskId: liveId)
            let yc = Analytics.yearlyTaskColors(tasks: tasks)
            return (w, y, wc.colors, wc.order, wc.hasOther, yc)
        }.value
        weekly = result.0
        yearly = result.1
        colors = (result.2, result.3, result.4, result.5)
    }
}
