"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useTasks } from "@/hooks/use-tasks";
import { useGroups } from "@/hooks/use-groups";
import type { TaskGroup } from "@/hooks/use-groups";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import {
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  format,
  parseISO,
} from "date-fns";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  CartesianGrid,
  useIsTooltipActive,
  useActiveTooltipCoordinate,
  useActiveTooltipDataPoints,
  useXAxisScale,
  useYAxisScale,
  usePlotArea,
  type TooltipContentProps,
} from "recharts";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  Pencil,
  Trash2,
  Plus,
  Check,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TaskEvent {
  id: string;
  from: string;
  to: string;
  taskId: string;
}

interface Task {
  id: string;
  name: string;
  hidden: boolean;
  events: TaskEvent[];
}

type RangeType = "today" | "week" | "month" | "alltime" | "custom";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function eventOverlapMs(event: TaskEvent, from: Date | null, to: Date | null): number {
  const eFrom = parseISO(event.from).getTime();
  const eTo = parseISO(event.to).getTime();
  const rFrom = from ? from.getTime() : 0;
  const rTo = to ? to.getTime() : Number.MAX_SAFE_INTEGER;
  return Math.max(0, Math.min(eTo, rTo) - Math.max(eFrom, rFrom));
}

function taskMs(task: Task, from: Date | null, to: Date | null): number {
  return task.events.reduce((s, e) => s + eventOverlapMs(e, from, to), 0);
}

function fmtMs(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  if (m > 0 && s > 0) return `${m}m ${s}s`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

/** Same order as Time Spent / `time-chart.tsx` so colors match the main dashboard */
const TASK_CHART_HEX = [
  "#3b82f6",
  "#f97316",
  "#10b981",
  "#8b5cf6",
  "#ec4899",
  "#14b8a6",
] as const;
const TASK_CHART_OTHER_HEX = "#6b7280";

/** Shared corner radius for stats bars/progress (avoids pill vs sharp stack mismatch) */
const STATS_BAR_RADIUS = 3;

/** Soften solid hex fills for calmer stacked columns (still reads as the same hue) */
function hexToRgba(hex: string, alpha: number): string {
  let x = hex.replace("#", "").trim();
  if (x.length === 3) {
    x = x
      .split("")
      .map((c) => c + c)
      .join("");
  }
  if (x.length !== 6) return hex;
  const n = parseInt(x, 16);
  if (Number.isNaN(n)) return hex;
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

interface TrendRow {
  date: string;
  dateDetail: string;
  /** Numeric calendar date, e.g. `4.5.2026` (same style as Time Spent hover on the main page) */
  dateNumeric: string;
  totalHours: number;
  h__other: number;
  [sliceKey: string]: string | number;
}

/** Estimated popup size used only for clamping — content is `w-fit` so it can be narrower. */
const DAILY_BREAKDOWN_TOOLTIP_EST_HEIGHT = 320;
const DAILY_BREAKDOWN_TOOLTIP_EST_WIDTH  = 260;

function DailyBreakdownChartTooltip() {
  const active = useIsTooltipActive();
  const coord   = useActiveTooltipCoordinate();
  const xScale  = useXAxisScale(0);
  const yScale  = useYAxisScale(0);
  const plot    = usePlotArea();
  const points  = useActiveTooltipDataPoints<TrendRow>();

  // Keep wrapper visible for 200 ms after active→false so the fade-out plays.
  const [shouldRender, setShouldRender] = useState(false);
  useEffect(() => {
    if (active) {
      setShouldRender(true);
    } else {
      const t = window.setTimeout(() => setShouldRender(false), 220);
      return () => clearTimeout(t);
    }
  }, [active]);

  // Compute the CSS transform string for the popup.
  const computedTransform = useMemo(() => {
    if (!yScale || !plot || !points?.length) return null;
    const row = points[0];
    const totalHours = Number(row.totalHours ?? 0);
    const yTop = yScale(totalHours);
    if (yTop == null || !Number.isFinite(yTop)) return null;

    const dateKey = row.date;
    const bandCenter = dateKey != null && xScale
      ? xScale(dateKey, { position: "middle" })
      : undefined;
    const cx =
      bandCenter != null && Number.isFinite(bandCenter) ? bandCenter
      : coord?.x != null && Number.isFinite(coord.x) ? coord.x
      : null;
    if (cx == null) return null;

    const estH = DAILY_BREAKDOWN_TOOLTIP_EST_HEIGHT;
    const estW = DAILY_BREAKDOWN_TOOLTIP_EST_WIDTH;
    const gap  = 10;

    // Vertical: popup vertically centred on the bar peak.
    const idealTop = yTop - estH / 2;
    const minTop   = plot.y + gap;
    const maxTop   = plot.y + plot.height - estH - gap;
    const ty = maxTop >= minTop
      ? Math.min(maxTop, Math.max(minTop, idealTop))
      : plot.y + gap;

    // Horizontal: popup horizontally centred on the category band.
    const idealLeft = cx - estW / 2;
    const minLeft   = plot.x + gap;
    const maxLeft   = plot.x + plot.width - estW - gap;
    const tx = maxLeft >= minLeft
      ? Math.min(maxLeft, Math.max(minLeft, idealLeft))
      : plot.x + gap;

    return `translate(${tx}px, ${ty}px)`;
  }, [coord?.x, xScale, yScale, plot, points]);

  // Persist the last valid transform so the exit animation doesn't jump to (0,0).
  const lastTransformRef = useRef<string | null>(null);
  if (computedTransform) lastTransformRef.current = computedTransform;
  const effectiveTransform = computedTransform ?? lastTransformRef.current;

  return (
    <RechartsTooltip
      content={DailyBreakdownTooltipContent}
      allowEscapeViewBox={{ x: true, y: true }}
      shared
      trigger="hover"
      isAnimationActive={false}
      animationDuration={0}
      offset={0}
      cursor={false}
      wrapperStyle={{
        outline: "none",
        pointerEvents: "auto",
        zIndex: 500,
        // Override both visibility and transform — wrapperStyle merges last so it wins.
        visibility: shouldRender ? "visible" : "hidden",
        ...(effectiveTransform ? { transform: effectiveTransform } : {}),
      }}
    />
  );
}

function DailyBreakdownTooltipContent({ active, payload }: TooltipContentProps) {
  const [copied, setCopied] = useState(false);
  // Keep last known payload so exit animation renders correct content.
  const lastPayloadRef = useRef<TooltipContentProps["payload"] | null>(null);
  useEffect(() => {
    if (active && payload && payload.length > 0) {
      lastPayloadRef.current = payload;
    }
  }, [active, payload]);

  const displayPayload = (active && payload?.length) ? payload : lastPayloadRef.current;
  if (!displayPayload?.length) return null;

  const dataRow = displayPayload[0].payload as TrendRow;
  const dateDetail = dataRow?.dateDetail;
  const dateNumeric = dataRow?.dateNumeric;
  if (!dateDetail || !dateNumeric) return null;
  const totalHours = Number(dataRow.totalHours ?? 0);
  const totalMs = Math.max(0, totalHours * 3600000);

  const rows = [...displayPayload]
    .filter((p) => Number(p.value) > 0)
    .sort((a, b) => Number(b.value) - Number(a.value));

  const plainLines = [
    dateDetail,
    dateNumeric,
    `Day total · ${fmtMs(totalMs)}`,
    "",
    ...rows.map((p) => {
      const v = Number(p.value);
      const ms = v * 3600000;
      const pct = totalHours > 0 ? Math.round((v / totalHours) * 1000) / 10 : 0;
      const label = String(p.name ?? "Task");
      return `${label} — ${pct}% · ${fmtMs(ms)}`;
    }),
  ];
  const plain = plainLines.join("\n");

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(plain);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div
      className={cn(
        "group relative w-fit min-w-[12rem] max-w-[20rem] select-text rounded-lg border border-border bg-popover px-3 py-2.5 pr-9 text-left shadow-lg z-[300] pointer-events-auto motion-reduce:transition-none",
        active
          ? "translate-y-0 opacity-100 transition-[opacity,transform] duration-200 ease-out"
          : "translate-y-1 opacity-0 transition-[opacity,transform] duration-200 ease-out"
      )}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onMouseMove={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn(
          "absolute right-1 top-1 z-10 h-8 w-8 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100",
          copied && "opacity-100"
        )}
        aria-label="Copy details"
        onClick={(e) => {
          e.stopPropagation();
          void handleCopy();
        }}
      >
        {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
      </Button>
      <p className="text-xs font-medium leading-snug text-foreground">{dateDetail}</p>
      <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground tabular-nums">{dateNumeric}</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground tabular-nums">
        Day total · {fmtMs(totalMs)}
      </p>
      <ul className="mt-2 max-h-[min(280px,50vh)] space-y-2 overflow-y-auto overscroll-contain border-t border-border pt-2 pr-0.5">
        {rows.map((p, i) => {
          const v = Number(p.value);
          const ms = v * 3600000;
          const pct = totalHours > 0 ? Math.round((v / totalHours) * 1000) / 10 : 0;
          const label = String(p.name ?? "Task");
          return (
            <li key={i} className="flex items-start gap-2 text-xs">
              <span
                className="mt-0.5 h-2.5 w-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: p.color }}
              />
              <div className="min-w-0 flex-1">
                <div className="font-medium leading-snug text-foreground">{label}</div>
                <div className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 text-[11px] text-muted-foreground">
                  <span className="tabular-nums">{pct}%</span>
                  <span className="text-muted-foreground/70">·</span>
                  <span className="tabular-nums text-foreground/90">{fmtMs(ms)}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const DOT_COLORS = [
  "bg-blue-500", "bg-orange-500", "bg-emerald-500",
  "bg-violet-500", "bg-pink-500", "bg-teal-500",
  "bg-yellow-500", "bg-red-500",
];

const BAR_COLORS = [
  "bg-blue-500/80", "bg-orange-500/80", "bg-emerald-500/80",
  "bg-violet-500/80", "bg-pink-500/80", "bg-teal-500/80",
  "bg-yellow-500/80", "bg-red-500/80",
];

// ─── Main component ───────────────────────────────────────────────────────────

export function StatsPageClient() {
  const { tasks, isLoading: tasksLoading } = useTasks();
  const { groups, isLoading: groupsLoading, createGroup, updateGroup, deleteGroup } = useGroups();

  const visibleTasks = useMemo(
    () => tasks.filter((t) => !t.hidden),
    [tasks]
  );

  // Date range
  const [rangeType, setRangeType] = useState<RangeType>("week");
  const [customFrom, setCustomFrom] = useState<string>(
    () => format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd")
  );
  const [customTo, setCustomTo] = useState<string>(
    () => format(endOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd")
  );

  // Group UI state
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTaskIds, setEditTaskIds] = useState<Set<string>>(new Set());

  // Quick select
  const [quickOpen, setQuickOpen] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [savingGroup, setSavingGroup] = useState(false);
  const [saveName, setSaveName] = useState("");

  // ─── Computed date range ──────────────────────────────────────────────────

  const { from, to, label } = useMemo(() => {
    const now = new Date();
    switch (rangeType) {
      case "today":
        return {
          from: startOfDay(now),
          to: endOfDay(now),
          label: format(now, "MMM d, yyyy"),
        };
      case "week": {
        const s = startOfWeek(now, { weekStartsOn: 1 });
        const e = endOfWeek(now, { weekStartsOn: 1 });
        return {
          from: s,
          to: e,
          label: `${format(s, "MMM d")} – ${format(e, "MMM d, yyyy")}`,
        };
      }
      case "month": {
        const s = startOfMonth(now);
        const e = endOfMonth(now);
        return { from: s, to: e, label: format(now, "MMMM yyyy") };
      }
      case "alltime":
        return { from: null, to: null, label: "All time" };
      case "custom": {
        const s = customFrom
          ? startOfDay(parseISO(customFrom))
          : startOfDay(now);
        const e = customTo ? endOfDay(parseISO(customTo)) : endOfDay(now);
        return {
          from: s,
          to: e,
          label: `${format(s, "MMM d")} – ${format(e, "MMM d, yyyy")}`,
        };
      }
    }
  }, [rangeType, customFrom, customTo]);

  // ─── Computed stats ───────────────────────────────────────────────────────

  const taskTotals = useMemo(
    () => visibleTasks.map((t) => ({ task: t, ms: taskMs(t, from, to) })),
    [visibleTasks, from, to]
  );

  const totalMs = useMemo(
    () => taskTotals.reduce((s, t) => s + t.ms, 0),
    [taskTotals]
  );

  const dailyAvgMs = useMemo(() => {
    if (totalMs === 0) return 0;
    const activeDays = new Set<string>();
    for (const { task } of taskTotals) {
      for (const event of task.events) {
        if (eventOverlapMs(event, from, to) > 0) {
          activeDays.add(format(parseISO(event.from), "yyyy-MM-dd"));
        }
      }
    }
    return activeDays.size > 0 ? Math.round(totalMs / activeDays.size) : totalMs;
  }, [taskTotals, totalMs, from, to]);

  const topTasks = useMemo(
    () =>
      [...taskTotals]
        .filter((t) => t.ms > 0)
        .sort((a, b) => b.ms - a.ms)
        .slice(0, 5),
    [taskTotals]
  );

  const breakdownSeries = useMemo(() => {
    const series: { dataKey: string; name: string; fill: string }[] = [];
    topTasks.forEach(({ task }, i) => {
      series.push({
        dataKey: `h_${task.id}`,
        name: task.name,
        fill: TASK_CHART_HEX[i % TASK_CHART_HEX.length],
      });
    });
    series.push({
      dataKey: "h__other",
      name: "Other",
      fill: TASK_CHART_OTHER_HEX,
    });
    return series;
  }, [topTasks]);

  // Trend chart: per-day (or week) stacked hours by top tasks + other (matches dashboard colors)
  const trendData = useMemo(() => {
    const topIds = topTasks.map(({ task }) => task.id);
    const topIdSet = new Set(topIds);

    const emptySlices = (): Record<string, number> => {
      const s: Record<string, number> = {};
      for (const id of topIds) s[`h_${id}`] = 0;
      return s;
    };

    const buildRow = (
      date: string,
      dateDetail: string,
      dateNumeric: string,
      slices: Record<string, number>,
      otherMs: number
    ): TrendRow => {
      let totalMs = otherMs;
      const row: TrendRow = {
        date,
        dateDetail,
        dateNumeric,
        totalHours: 0,
        h__other: otherMs / 3600000,
      };
      for (const id of topIds) {
        const k = `h_${id}`;
        const ms = slices[k] ?? 0;
        totalMs += ms;
        row[k] = ms / 3600000;
      }
      row.totalHours = totalMs / 3600000;
      return row;
    };

    const addDayToSlices = (
      slices: Record<string, number>,
      day: Date
    ): number => {
      const dFrom = startOfDay(day);
      const dTo = endOfDay(day);
      let otherMs = 0;
      for (const task of visibleTasks) {
        let ms = 0;
        for (const e of task.events) {
          ms += eventOverlapMs(e, dFrom, dTo);
        }
        if (ms <= 0) continue;
        if (topIdSet.has(task.id)) {
          const k = `h_${task.id}`;
          slices[k] = (slices[k] ?? 0) + ms;
        } else {
          otherMs += ms;
        }
      }
      return otherMs;
    };

    let chartFrom: Date;
    let chartTo: Date;

    if (from && to) {
      chartFrom = from;
      chartTo = to;
    } else {
      let earliest: Date | null = null;
      for (const task of visibleTasks) {
        for (const event of task.events) {
          const d = parseISO(event.from);
          if (!earliest || d < earliest) earliest = d;
        }
      }
      chartFrom = earliest
        ? startOfDay(earliest)
        : startOfDay(new Date(Date.now() - 29 * 86400000));
      chartTo = endOfDay(new Date());
    }

    const allDays = eachDayOfInterval({ start: chartFrom, end: chartTo });

    if (allDays.length <= 42) {
      return allDays.map((day) => {
        const slices = emptySlices();
        const otherMs = addDayToSlices(slices, day);
        return buildRow(
          format(day, "MMM d"),
          format(day, "EEEE, MMM d, yyyy"),
          format(day, "d.M.yyyy"),
          slices,
          otherMs
        );
      });
    }

    const weekMap = new Map<
      string,
      {
        date: string;
        dateDetail: string;
        dateNumeric: string;
        slices: Record<string, number>;
        otherMs: number;
      }
    >();

    for (const day of allDays) {
      const ws = startOfWeek(day, { weekStartsOn: 1 });
      const key = format(ws, "yyyy-MM-dd");
      if (!weekMap.has(key)) {
        weekMap.set(key, {
          date: format(ws, "MMM d"),
          dateDetail: `Week of ${format(ws, "MMMM d, yyyy")}`,
          dateNumeric: format(ws, "d.M.yyyy"),
          slices: emptySlices(),
          otherMs: 0,
        });
      }
      const bucket = weekMap.get(key)!;
      const daySlices = emptySlices();
      const other = addDayToSlices(daySlices, day);
      for (const id of topIds) {
        const k = `h_${id}`;
        bucket.slices[k] += daySlices[k] ?? 0;
      }
      bucket.otherMs += other;
    }

    return Array.from(weekMap.values()).map((b) =>
      buildRow(b.date, b.dateDetail, b.dateNumeric, b.slices, b.otherMs)
    );
  }, [visibleTasks, from, to, topTasks]);

  // ─── Group data ───────────────────────────────────────────────────────────

  const groupData = useMemo(
    () =>
      groups.map((g) => {
        const groupTasks = tasks.filter((t) => g.taskIds.includes(t.id));
        const ms = groupTasks.reduce((s, t) => s + taskMs(t, from, to), 0);
        const perTask = groupTasks
          .map((t) => ({ task: t, ms: taskMs(t, from, to) }))
          .filter((t) => t.ms > 0)
          .sort((a, b) => b.ms - a.ms);
        return { group: g, ms, perTask };
      }),
    [groups, tasks, from, to]
  );

  const comparisonTotal = groupData.reduce((s, g) => s + g.ms, 0);

  // ─── Actions ──────────────────────────────────────────────────────────────

  const buildGroupText = useCallback(
    (idx: number) => {
      const { group, ms, perTask } = groupData[idx];
      const lines = [
        `${group.name} — ${fmtMs(ms)} (${label})`,
        ...perTask.map((t) => `  ${t.task.name}: ${fmtMs(t.ms)}`),
      ];
      return lines.join("\n");
    },
    [groupData, label]
  );

  const copyGroup = useCallback(
    (idx: number) => navigator.clipboard.writeText(buildGroupText(idx)).catch(() => {}),
    [buildGroupText]
  );

  const copyAll = useCallback(() => {
    const text = groupData
      .map((_, i) => buildGroupText(i))
      .join("\n\n");
    navigator.clipboard.writeText(text).catch(() => {});
  }, [groupData, buildGroupText]);

  const startEdit = useCallback((group: TaskGroup) => {
    setEditingGroupId(group.id);
    setEditName(group.name);
    setEditTaskIds(new Set(group.taskIds));
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingGroupId) return;
    await updateGroup.mutateAsync({
      id: editingGroupId,
      name: editName,
      taskIds: Array.from(editTaskIds),
    });
    setEditingGroupId(null);
  }, [editingGroupId, editName, editTaskIds, updateGroup]);

  const saveQuickGroup = useCallback(async () => {
    if (!saveName.trim() || selectedTaskIds.size === 0) return;
    await createGroup.mutateAsync({
      name: saveName.trim(),
      taskIds: Array.from(selectedTaskIds),
    });
    setSaveName("");
    setSelectedTaskIds(new Set());
    setSavingGroup(false);
  }, [saveName, selectedTaskIds, createGroup]);

  const quickSelectMs = useMemo(
    () =>
      tasks
        .filter((t) => selectedTaskIds.has(t.id))
        .reduce((s, t) => s + taskMs(t, from, to), 0),
    [tasks, selectedTaskIds, from, to]
  );

  const toggleExpanded = useCallback((id: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // ─── Loading ──────────────────────────────────────────────────────────────

  if (tasksLoading || groupsLoading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-9 w-full" />
        <div className="grid grid-cols-2 gap-4">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-44" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  const RANGES: { value: RangeType; label: string }[] = [
    { value: "today", label: "Today" },
    { value: "week", label: "Week" },
    { value: "month", label: "Month" },
    { value: "alltime", label: "All Time" },
    { value: "custom", label: "Custom" },
  ];

  return (
    <div className="space-y-6">

      {/* ── Date range filter ────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <Button
            key={r.value}
            variant={rangeType === r.value ? "default" : "outline"}
            size="sm"
            onClick={() => setRangeType(r.value)}
          >
            {r.label}
          </Button>
        ))}
        {rangeType === "custom" && (
          <div className="flex items-center gap-2 w-full mt-1 flex-wrap">
            <Input
              type="date"
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
              className="h-8 text-sm w-36"
            />
            <span className="text-muted-foreground text-sm">to</span>
            <Input
              type="date"
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
              className="h-8 text-sm w-36"
            />
          </div>
        )}
      </div>

      {/* ── Headline numbers ─────────────────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Tracked</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{fmtMs(totalMs)}</p>
            <p className="text-xs text-muted-foreground mt-1 truncate">{label}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">Daily Average</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold tabular-nums">{fmtMs(dailyAvgMs)}</p>
            <p className="text-xs text-muted-foreground mt-1">per active day</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Trend chart ──────────────────────────────────────────────────── */}
      {trendData.some((d) => d.totalHours > 0) && (
        <Card className="rounded-xl border-border/80 shadow-sm overflow-visible">
          <CardHeader className="space-y-0.5 pb-2">
            <CardTitle className="text-sm font-medium">Daily breakdown</CardTitle>
            <CardDescription className="text-xs leading-relaxed text-muted-foreground">
              Stacked bars match the top tasks for this period (plus &quot;Other&quot; for the rest).
              Colors align with the Time Spent chart on the main page.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-2 pb-5 pt-0 sm:px-4 overflow-visible">
            <div
              className="recharts-no-focus-ring rounded-lg border border-border/60 bg-muted/20 p-2 sm:p-3 overflow-visible"
              onMouseDownCapture={(e) => {
                const t = e.target;
                if (!(t instanceof Element)) return;
                if (t.closest(".recharts-tooltip-wrapper")) return;
                if (t instanceof SVGElement || t.closest("svg.recharts-surface")) {
                  e.preventDefault();
                }
              }}
            >
              <ResponsiveContainer width="100%" height={208} className="[&_.recharts-wrapper]:overflow-visible">
                <BarChart
                  data={trendData}
                  margin={{ top: 10, right: 6, left: 0, bottom: 2 }}
                  barCategoryGap="26%"
                  accessibilityLayer={false}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke="hsl(var(--border))"
                    strokeOpacity={0.55}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                    tickMargin={8}
                  />
                  <YAxis
                    width={40}
                    tick={{ fontSize: 11, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${v}h`}
                    tickMargin={4}
                  />
                  <DailyBreakdownChartTooltip />
                  {breakdownSeries.map((s) => (
                    <Bar
                      key={s.dataKey}
                      name={s.name}
                      dataKey={s.dataKey}
                      stackId="stats-day"
                      fill={
                        s.dataKey === "h__other"
                          ? hexToRgba(s.fill, 0.72)
                          : hexToRgba(s.fill, 0.84)
                      }
                      stroke="hsl(var(--background))"
                      strokeWidth={1.5}
                      radius={2}
                      maxBarSize={21}
                    />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Top tasks ────────────────────────────────────────────────────── */}
      {topTasks.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Top tasks</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {topTasks.map(({ task, ms }, i) => (
              <div key={task.id} className="flex items-center gap-3">
                <span className="text-xs text-muted-foreground w-4 shrink-0 text-right">
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-baseline mb-1">
                    <span className="text-sm truncate pr-2">{task.name}</span>
                    <span className="text-sm font-medium tabular-nums shrink-0">
                      {fmtMs(ms)}
                    </span>
                  </div>
                  <div
                    className="h-1.5 bg-muted overflow-hidden"
                    style={{ borderRadius: STATS_BAR_RADIUS }}
                  >
                    <div
                      className="h-full transition-[width] duration-200"
                      style={{
                        borderRadius: STATS_BAR_RADIUS,
                        width: `${totalMs > 0 ? (ms / totalMs) * 100 : 0}%`,
                        backgroundColor: hexToRgba(TASK_CHART_HEX[i % TASK_CHART_HEX.length], 0.88),
                      }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Saved groups ─────────────────────────────────────────────────── */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Saved Groups</h2>
          {groups.length >= 2 && (
            <Button
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={copyAll}
            >
              <Copy className="h-4 w-4" />
              Copy all
            </Button>
          )}
        </div>

        {/* Group comparison bar */}
        {groupData.filter((g) => g.ms > 0).length >= 2 && (
          <Card>
            <CardContent className="px-4 py-4">
              <p className="text-xs text-muted-foreground mb-3 uppercase tracking-wider font-semibold">Comparison</p>
              <div
                className="flex h-3 overflow-hidden gap-px"
                style={{ borderRadius: STATS_BAR_RADIUS }}
              >
                {groupData
                  .filter((g) => g.ms > 0)
                  .map(({ group, ms }, i) => (
                    <div
                      key={group.id}
                      className={cn("h-full", DOT_COLORS[i % DOT_COLORS.length])}
                      style={{
                        width: `${comparisonTotal > 0 ? (ms / comparisonTotal) * 100 : 0}%`,
                      }}
                      title={`${group.name}: ${fmtMs(ms)}`}
                    />
                  ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-2 mt-4">
                {groupData
                  .filter((g) => g.ms > 0)
                  .map(({ group, ms }, i) => (
                    <div key={group.id} className="flex items-center gap-2">
                      <div
                        className={cn(
                          "h-2.5 w-2.5 rounded-full shrink-0",
                          DOT_COLORS[i % DOT_COLORS.length]
                        )}
                      />
                      <span className="text-sm">
                        {group.name}{" "}
                        <span className="font-medium tabular-nums ml-1">
                          {fmtMs(ms)}
                        </span>
                      </span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        )}

        {groups.length === 0 && (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground text-sm">
              No saved groups yet. Use quick select below to create one.
            </CardContent>
          </Card>
        )}

        {groupData.map(({ group, ms, perTask }, i) => {
          const isExpanded = expandedGroups.has(group.id);
          const isEditing = editingGroupId === group.id;

          return (
            <Card key={group.id}>
              <CardHeader className="pb-3 pt-4 px-4">
                {isEditing ? (
                  <div className="space-y-4">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Group name"
                      className="h-9"
                      autoFocus
                    />
                    <p className="text-sm font-medium">
                      Tasks in this group:
                    </p>
                    <div className="space-y-3 max-h-48 overflow-y-auto">
                      {tasks.map((t) => (
                        <label
                          key={t.id}
                          className="flex items-center gap-3 cursor-pointer"
                        >
                          <Checkbox
                            checked={editTaskIds.has(t.id)}
                            onCheckedChange={(checked) => {
                              setEditTaskIds((prev) => {
                                const next = new Set(prev);
                                if (checked) next.add(t.id);
                                else next.delete(t.id);
                                return next;
                              });
                            }}
                          />
                          <span className="text-sm">{t.name}</span>
                        </label>
                      ))}
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button
                        size="sm"
                        className="gap-2"
                        onClick={saveEdit}
                        disabled={updateGroup.isPending || !editName.trim()}
                      >
                        <Check className="h-4 w-4" />
                        Save
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-2"
                        onClick={() => setEditingGroupId(null)}
                      >
                        <X className="h-4 w-4" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "h-3 w-3 rounded-full shrink-0",
                        DOT_COLORS[i % DOT_COLORS.length]
                      )}
                    />
                    <span className="font-semibold text-base flex-1 min-w-0 truncate">
                      {group.name}
                    </span>
                    <span className="text-base font-bold tabular-nums shrink-0 mr-2">
                      {fmtMs(ms)}
                    </span>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => copyGroup(i)}
                        title="Copy to clipboard"
                      >
                        <Copy className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => startEdit(group)}
                        title="Edit group"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-destructive hover:text-destructive"
                        onClick={() => deleteGroup.mutate(group.id)}
                        title="Delete group"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => toggleExpanded(group.id)}
                        title={isExpanded ? "Collapse" : "Expand"}
                      >
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  </div>
                )}
              </CardHeader>

              {isExpanded && !isEditing && (
                <CardContent className="px-4 pb-4 pt-1">
                  {perTask.length === 0 ? (
                    <p className="text-sm text-muted-foreground pt-2">
                      No time tracked in this period.
                    </p>
                  ) : (
                    <div className="space-y-4 pt-2">
                      {perTask.map(({ task, ms: tMs }) => (
                        <div key={task.id}>
                          <div className="flex justify-between items-baseline mb-1.5">
                            <span className="text-sm truncate pr-2">
                              {task.name}
                            </span>
                            <span className="text-sm font-medium tabular-nums shrink-0">
                              {fmtMs(tMs)}
                            </span>
                          </div>
                          <div
                            className="h-1.5 bg-muted overflow-hidden"
                            style={{ borderRadius: STATS_BAR_RADIUS }}
                          >
                            <div
                              className={cn("h-full transition-all", BAR_COLORS[i % BAR_COLORS.length])}
                              style={{
                                borderRadius: STATS_BAR_RADIUS,
                                width: `${ms > 0 ? (tMs / ms) * 100 : 0}%`,
                              }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          );
        })}
      </div>

      {/* ── Quick select ─────────────────────────────────────────────────── */}
      <div className="pt-2">
        <button
          className="flex items-center justify-between w-full p-4 rounded-lg border bg-card hover:bg-accent hover:text-accent-foreground transition-colors"
          onClick={() => setQuickOpen((o) => !o)}
        >
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm">Quick Select</span>
            <span className="text-sm font-normal text-muted-foreground">
              — pick tasks to see combined time
            </span>
          </div>
          {quickOpen ? (
            <ChevronUp className="h-5 w-5 text-muted-foreground" />
          ) : (
            <ChevronDown className="h-5 w-5 text-muted-foreground" />
          )}
        </button>

        {quickOpen && (
          <Card className="mt-3">
            <CardContent className="p-4 space-y-2">
              {visibleTasks.length === 0 && (
                <p className="text-sm text-muted-foreground py-2 text-center">
                  No tasks yet.
                </p>
              )}
              {visibleTasks.map((task) => {
                const tMs = taskMs(task, from, to);
                return (
                  <label
                    key={task.id}
                    className="flex items-center justify-between gap-3 cursor-pointer py-2 px-2 rounded-md hover:bg-muted/50"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <Checkbox
                        checked={selectedTaskIds.has(task.id)}
                        onCheckedChange={(checked) => {
                          setSelectedTaskIds((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(task.id);
                            else next.delete(task.id);
                            return next;
                          });
                        }}
                      />
                      <span className="text-sm font-medium truncate">{task.name}</span>
                    </div>
                    <span className="text-sm text-muted-foreground tabular-nums shrink-0">
                      {fmtMs(tMs)}
                    </span>
                  </label>
                );
              })}
            </CardContent>
          </Card>
        )}
      </div>

      {/* ── Sticky quick-select summary bar ──────────────────────────────── */}
      {selectedTaskIds.size > 0 && (
        <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom,0px))] md:bottom-8 left-4 right-4 md:left-auto md:right-8 md:w-[400px] z-40">
          <Card className="shadow-lg border-2">
            <CardContent className="px-4 py-4 flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">
                  {selectedTaskIds.size} task
                  {selectedTaskIds.size !== 1 ? "s" : ""} selected
                </p>
                <p className="text-2xl font-bold tabular-nums">
                  {fmtMs(quickSelectMs)}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {savingGroup ? (
                  <>
                    <Input
                      value={saveName}
                      onChange={(e) => setSaveName(e.target.value)}
                      placeholder="Group name"
                      className="h-9 text-sm w-32"
                      autoFocus
                      onKeyDown={(e) => e.key === "Enter" && saveQuickGroup()}
                    />
                    <Button
                      size="sm"
                      className="px-3"
                      onClick={saveQuickGroup}
                      disabled={createGroup.isPending || !saveName.trim()}
                    >
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="px-2"
                      onClick={() => {
                        setSavingGroup(false);
                        setSaveName("");
                      }}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-2"
                      onClick={() => setSavingGroup(true)}
                    >
                      <Plus className="h-4 w-4" />
                      Save group
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="px-2"
                      onClick={() => setSelectedTaskIds(new Set())}
                      title="Clear selection"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
