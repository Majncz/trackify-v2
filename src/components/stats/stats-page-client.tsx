"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useTasks } from "@/hooks/use-tasks";
import { useGroups } from "@/hooks/use-groups";
import type { TaskGroup } from "@/hooks/use-groups";
import { groupAccentHex, resolveGroupAccent } from "@/lib/group-accent";
import { GROUP_COLOR_PRESETS } from "@/lib/group-color-presets";
import { focusControl } from "@/lib/focus-style";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Copy,
  Pencil,
  Trash2,
  Plus,
  Check,
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
  taskGroup?: { id: string; name: string; color?: string | null } | null;
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

function taskAllowedInGroupPicker(
  task: Task,
  editingGroupId: string | null
): boolean {
  if (!task.taskGroup) return true;
  if (editingGroupId && task.taskGroup.id === editingGroupId) return true;
  return false;
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

    const gap = 10;
    // Bottom of the tooltip sits `gap` px above the bar top; horizontally centered on the band.
    // Percentages are relative to the tooltip box; avoids a fixed height guess (320px sat too high).
    return `translateX(calc(${cx}px - 50%)) translateY(calc(${yTop - gap}px - 100%))`;
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

function GroupColorPresetGrid({
  value,
  dimmed,
  onPick,
}: {
  value: string;
  /** Softer look in Auto mode; swatches stay clickable to pick a custom color */
  dimmed?: boolean;
  onPick: (hex: string) => void;
}) {
  return (
    <div
      className="flex flex-wrap gap-2 pt-0.5"
      role="listbox"
      aria-label="Group color presets"
    >
      {GROUP_COLOR_PRESETS.map((hex) => {
        const selected = value.toLowerCase() === hex.toLowerCase();
        return (
          <button
            key={hex}
            type="button"
            role="option"
            aria-selected={selected}
            title={hex}
            className={cn(
              "h-9 w-9 shrink-0 rounded-md border-2 transition-[transform,box-shadow] outline-none",
              focusControl,
              selected
                ? "border-foreground shadow-md scale-105"
                : "border-border/80 hover:scale-105 hover:border-foreground/50",
              dimmed && "opacity-70 saturate-75"
            )}
            style={{ backgroundColor: hex }}
            onClick={() => onPick(hex)}
          />
        );
      })}
    </div>
  );
}

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
  const [editDialogGroup, setEditDialogGroup] = useState<TaskGroup | null>(null);
  const [editName, setEditName] = useState("");
  const [editTaskIds, setEditTaskIds] = useState<Set<string>>(new Set());
  const [editTaskFilter, setEditTaskFilter] = useState("");
  const [groupDialogError, setGroupDialogError] = useState("");
  const [editColorMode, setEditColorMode] = useState<"auto" | "custom">("custom");
  const [editColor, setEditColor] = useState(GROUP_COLOR_PRESETS[0]!);
  const [createColorMode, setCreateColorMode] = useState<"auto" | "custom">("custom");
  const [createGroupColor, setCreateGroupColor] = useState(GROUP_COLOR_PRESETS[0]!);

  // New group dialog (replaces inline expand + floating bar — no page reflow)
  const [createGroupOpen, setCreateGroupOpen] = useState(false);
  const [createGroupFilter, setCreateGroupFilter] = useState("");
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [saveName, setSaveName] = useState("");

  // ─── Computed date range ──────────────────────────────────────────────────

  const { from, to } = useMemo(() => {
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

  const groupData = useMemo(() => {
    const taskMap = new Map(tasks.map((t) => [t.id, t]));
    return groups.map((g) => {
      const orphanIds: string[] = [];
      let ms = 0;
      const byIdMs = new Map<string, number>();

      for (const id of g.taskIds) {
        const task = taskMap.get(id);
        if (!task) {
          orphanIds.push(id);
          continue;
        }
        const tMs = taskMs(task, null, null);
        byIdMs.set(id, tMs);
        ms += tMs;
      }

      const membersSorted = g.taskIds
        .flatMap((id) => {
          const task = taskMap.get(id);
          if (!task) return [];
          const tMs = byIdMs.get(id) ?? 0;
          return [{ task, ms: tMs }];
        })
        .sort((a, b) => b.ms - a.ms);

      return { group: g, ms, membersSorted, orphanIds };
    });
  }, [groups, tasks]);

  const groupsWithTime = useMemo(
    () => groupData.filter((g) => g.ms > 0),
    [groupData]
  );
  const maxGroupMs = useMemo(
    () => groupsWithTime.reduce((m, g) => Math.max(m, g.ms), 0),
    [groupsWithTime]
  );

  // ─── Actions ──────────────────────────────────────────────────────────────

  const buildGroupText = useCallback(
    (idx: number) => {
      const { group, ms, membersSorted, orphanIds } = groupData[idx];
      const lines = [
        `${group.name} — ${fmtMs(ms)}`,
        ...membersSorted.map((t) => `  · ${t.task.name}: ${fmtMs(t.ms)}`),
      ];
      if (orphanIds.length > 0) {
        lines.push(`  · ${orphanIds.length} removed task(s) (no longer in app)`);
      }
      return lines.join("\n");
    },
    [groupData]
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
    setGroupDialogError("");
    setEditDialogGroup(group);
    setEditName(group.name);
    setEditTaskIds(new Set(group.taskIds));
    setEditTaskFilter("");
    setEditColorMode(group.color ? "custom" : "auto");
    setEditColor(group.color ?? groupAccentHex(group.id));
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editDialogGroup) return;
    if (editColorMode === "custom" && !/^#[0-9A-Fa-f]{6}$/.test(editColor)) {
      setGroupDialogError("Pick a preset color or switch to Auto.");
      return;
    }
    setGroupDialogError("");
    try {
      await updateGroup.mutateAsync({
        id: editDialogGroup.id,
        name: editName,
        taskIds: Array.from(editTaskIds),
        color: editColorMode === "auto" ? null : editColor,
      });
      setEditDialogGroup(null);
    } catch (e) {
      setGroupDialogError(e instanceof Error ? e.message : "Could not save group");
    }
  }, [editDialogGroup, editName, editTaskIds, editColorMode, editColor, updateGroup]);

  const closeCreateGroupDialog = useCallback(() => {
    setCreateGroupOpen(false);
    setCreateGroupFilter("");
    setSelectedTaskIds(new Set());
    setSaveName("");
    setGroupDialogError("");
    setCreateColorMode("custom");
    setCreateGroupColor(GROUP_COLOR_PRESETS[0]!);
  }, []);

  const openCreateGroupDialog = useCallback(() => {
    setGroupDialogError("");
    setCreateGroupFilter("");
    setSelectedTaskIds(new Set());
    setSaveName("");
    setCreateColorMode("custom");
    setCreateGroupColor(
      GROUP_COLOR_PRESETS[Math.floor(Math.random() * GROUP_COLOR_PRESETS.length)]!
    );
    setCreateGroupOpen(true);
  }, []);

  const saveQuickGroup = useCallback(async () => {
    if (!saveName.trim() || selectedTaskIds.size === 0) return;
    if (createColorMode === "custom" && !/^#[0-9A-Fa-f]{6}$/.test(createGroupColor)) {
      setGroupDialogError("Pick a preset color or switch to Auto.");
      return;
    }
    setGroupDialogError("");
    try {
      await createGroup.mutateAsync({
        name: saveName.trim(),
        taskIds: Array.from(selectedTaskIds),
        color: createColorMode === "auto" ? null : createGroupColor,
      });
      closeCreateGroupDialog();
    } catch (e) {
      setGroupDialogError(e instanceof Error ? e.message : "Could not create group");
    }
  }, [
    saveName,
    selectedTaskIds,
    createColorMode,
    createGroupColor,
    createGroup,
    closeCreateGroupDialog,
  ]);

  const quickSelectMs = useMemo(
    () =>
      tasks
        .filter((t) => selectedTaskIds.has(t.id))
        .reduce((s, t) => s + taskMs(t, from, to), 0),
    [tasks, selectedTaskIds, from, to]
  );

  const tasksSortedForPicker = useMemo(
    () => [...tasks].sort((a, b) => taskMs(b, from, to) - taskMs(a, from, to)),
    [tasks, from, to]
  );

  const createGroupFilteredTasks = useMemo(() => {
    const q = createGroupFilter.trim().toLowerCase();
    if (!q) return tasksSortedForPicker;
    return tasksSortedForPicker.filter((t) => t.name.toLowerCase().includes(q));
  }, [tasksSortedForPicker, createGroupFilter]);

  const selectAllFilteredTasks = useCallback(() => {
    setSelectedTaskIds((prev) => {
      const next = new Set(prev);
      for (const t of createGroupFilteredTasks) {
        if (taskAllowedInGroupPicker(t, null)) next.add(t.id);
      }
      return next;
    });
  }, [createGroupFilteredTasks]);

  const clearSelectedTasks = useCallback(() => {
    setSelectedTaskIds(new Set());
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
      <Card className="overflow-visible">
        <CardHeader className="pb-2">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-1 min-w-0">
              <CardTitle className="text-base">Saved groups</CardTitle>
            </div>
            {groups.length >= 2 && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2 shrink-0 self-start sm:self-auto"
                onClick={copyAll}
              >
                <Copy className="h-4 w-4" />
                Copy all
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {groupsWithTime.length >= 2 && maxGroupMs > 0 && (
            <div className="rounded-lg border border-border/80 bg-muted/20 px-3 py-3">
              <ul className="space-y-2.5">
                {[...groupsWithTime]
                  .sort((a, b) => b.ms - a.ms)
                  .map(({ group, ms }) => {
                    const gHex = resolveGroupAccent({ id: group.id, color: group.color });
                    return (
                    <li key={group.id}>
                      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3">
                        <span className="text-sm font-medium sm:w-[38%] min-w-0 truncate">
                          {group.name}
                        </span>
                        <div className="flex flex-1 items-center gap-2 min-w-0">
                          <div className="h-2 flex-1 max-w-md rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full rounded-full transition-[width]"
                              style={{
                                width: `${(ms / maxGroupMs) * 100}%`,
                                backgroundColor: hexToRgba(gHex, 0.85),
                              }}
                            />
                          </div>
                          <span className="text-sm tabular-nums text-foreground font-medium shrink-0 w-[4.75rem] text-right">
                            {fmtMs(ms)}
                          </span>
                        </div>
                      </div>
                    </li>
                  );})}
              </ul>
            </div>
          )}

          {groups.length === 0 ? (
            <div className="flex flex-col items-center gap-4 py-10 px-4 text-center">
              <p className="text-sm text-muted-foreground">No saved groups yet.</p>
              <Button
                type="button"
                className="gap-2"
                onClick={openCreateGroupDialog}
              >
                <Plus className="h-4 w-4" />
                Create a group from tasks
              </Button>
            </div>
          ) : (
            <div className="rounded-lg border border-border/80 overflow-x-auto">
              <table className="w-full text-sm min-w-[32rem]">
                <thead>
                  <tr className="border-b border-border/80 bg-muted/35 text-left text-xs font-medium text-muted-foreground">
                    <th className="py-2.5 pl-3 pr-2 sm:pl-4 w-[min(12rem,28vw)]">Group</th>
                    <th className="py-2.5 px-2 min-w-[14rem]">Tasks</th>
                    <th className="py-2.5 px-2 text-right whitespace-nowrap w-[5.5rem]">Total</th>
                    <th className="py-2.5 pr-3 pl-2 sm:pr-4 w-[7rem] text-right">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {groupData.map(({ group, ms, membersSorted, orphanIds }) => {
                    return (
                    <tr
                      key={group.id}
                      className="border-b border-border/50 last:border-0 bg-card hover:bg-muted/25 transition-colors"
                    >
                      <td className="py-3 pl-3 pr-2 sm:pl-4 min-w-0 align-middle">
                        <span className="font-semibold leading-snug line-clamp-2 break-words">{group.name}</span>
                      </td>
                      <td className="py-3 px-2 min-w-0 align-top">
                        {group.taskIds.length === 0 ? (
                          <span className="text-muted-foreground">—</span>
                        ) : membersSorted.length === 0 && orphanIds.length > 0 ? (
                          <span className="text-amber-700 dark:text-amber-400 text-xs">
                            {orphanIds.length} missing task
                            {orphanIds.length !== 1 ? "s" : ""}
                          </span>
                        ) : (
                          <div className="max-h-44 overflow-y-auto overscroll-contain space-y-1.5 pr-0.5">
                            {membersSorted.map(({ task: t, ms: tMs }, mi) => {
                              const pct = ms > 0 ? (tMs / ms) * 100 : 0;
                              const hex = TASK_CHART_HEX[mi % TASK_CHART_HEX.length];
                              return (
                                <div
                                  key={t.id}
                                  className="grid w-full min-w-0 grid-cols-[10rem_minmax(0,1fr)_4.25rem] items-center gap-2 sm:grid-cols-[13.5rem_minmax(0,1fr)_4.25rem] sm:gap-3"
                                >
                                  <span className="min-w-0 truncate text-sm font-medium text-foreground">
                                    {t.name}
                                    {t.hidden ? (
                                      <span className="text-muted-foreground font-normal">
                                        {" "}
                                        (hidden)
                                      </span>
                                    ) : null}
                                  </span>
                                  <div className="min-w-0 h-1.5 w-full overflow-hidden rounded-sm bg-muted">
                                    <div
                                      className="h-full rounded-sm"
                                      style={{
                                        width: `${Math.min(100, Math.max(0, pct))}%`,
                                        backgroundColor: hexToRgba(hex, 0.85),
                                      }}
                                    />
                                  </div>
                                  <span className="min-w-[4.25rem] text-right text-xs tabular-nums text-muted-foreground">
                                    {fmtMs(tMs)}
                                  </span>
                                </div>
                              );
                            })}
                            {orphanIds.map((oid) => (
                              <div
                                key={oid}
                                className="text-xs text-amber-800 dark:text-amber-300 tabular-nums"
                              >
                                Removed · <code className="opacity-80">{oid.slice(0, 8)}…</code>
                              </div>
                            ))}
                          </div>
                        )}
                        {membersSorted.length > 0 && ms === 0 && (
                          <p className="text-[11px] text-muted-foreground mt-1">No tracked time</p>
                        )}
                      </td>
                      <td className="py-3 px-2 text-right tabular-nums font-semibold whitespace-nowrap align-middle">
                        {fmtMs(ms)}
                      </td>
                      <td className="py-3 pr-3 pl-2 sm:pr-4 align-middle">
                        <div className="flex justify-end gap-0.5">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => {
                              const idx = groupData.findIndex((r) => r.group.id === group.id);
                              if (idx >= 0) void copyGroup(idx);
                            }}
                            title="Copy"
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => startEdit(group)}
                            title="Edit"
                          >
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => deleteGroup.mutate(group.id)}
                            title="Delete"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-end">
        <Button
          type="button"
          className="w-full sm:w-auto gap-2 shadow-sm"
          onClick={openCreateGroupDialog}
        >
          <Plus className="h-4 w-4 shrink-0" />
          Create a group from tasks
        </Button>
      </div>

      <Dialog
        open={editDialogGroup != null}
        onOpenChange={(open) => {
          if (!open) {
            setGroupDialogError("");
            setEditDialogGroup(null);
          }
        }}
      >
        <DialogContent className="flex h-[min(92dvh,56rem)] max-h-[92dvh] flex-col gap-0 overflow-hidden p-6 sm:max-w-xl duration-300 data-[state=open]:duration-300 data-[state=closed]:duration-200">
          <DialogHeader className="shrink-0">
            <DialogTitle>Edit group</DialogTitle>
          </DialogHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-3 py-4">
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Group name"
              className="h-10 shrink-0"
            />
            <div className="space-y-2 shrink-0">
              <Label className="text-xs font-medium">Group color</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={editColorMode === "auto" ? "secondary" : "outline"}
                  onClick={() => {
                    setEditColorMode("auto");
                    if (editDialogGroup) {
                      setEditColor(groupAccentHex(editDialogGroup.id));
                    }
                  }}
                >
                  Auto
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={editColorMode === "custom" ? "secondary" : "outline"}
                  onClick={() => setEditColorMode("custom")}
                >
                  Custom
                </Button>
              </div>
              <GroupColorPresetGrid
                value={
                  editColorMode === "auto" && editDialogGroup
                    ? groupAccentHex(editDialogGroup.id)
                    : editColor
                }
                dimmed={editColorMode === "auto"}
                onPick={(hex) => {
                  setEditColorMode("custom");
                  setEditColor(hex);
                }}
              />
              {editColorMode === "auto" ? (
                <p className="text-[11px] text-muted-foreground">
                  Uses the automatic palette from the group id. Choose Custom to pick a preset.
                </p>
              ) : null}
            </div>
            <Input
              value={editTaskFilter}
              onChange={(e) => setEditTaskFilter(e.target.value)}
              placeholder="Filter tasks…"
              className="h-9 shrink-0 text-sm"
            />
            <Separator className="shrink-0" />
            {groupDialogError ? (
              <p className="shrink-0 text-sm text-destructive">{groupDialogError}</p>
            ) : null}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1 [-webkit-overflow-scrolling:touch]">
                <div className="space-y-1 pr-1 -mr-1">
                  {tasks
                .filter((t) =>
                  editTaskFilter.trim()
                    ? t.name.toLowerCase().includes(editTaskFilter.trim().toLowerCase())
                    : true
                )
                .map((t) => {
                  const tMs = taskMs(t, from, to);
                  const allowed = taskAllowedInGroupPicker(
                    t,
                    editDialogGroup?.id ?? null
                  );
                  return (
                    <label
                      key={t.id}
                      className={cn(
                        "flex items-center justify-between gap-3 rounded-md py-2 px-2",
                        allowed ? "cursor-pointer hover:bg-muted/60" : "opacity-60 cursor-not-allowed"
                      )}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Checkbox
                          checked={editTaskIds.has(t.id)}
                          disabled={!allowed}
                          onCheckedChange={(checked) => {
                            if (!allowed) return;
                            setEditTaskIds((prev) => {
                              const next = new Set(prev);
                              if (checked) next.add(t.id);
                              else next.delete(t.id);
                              return next;
                            });
                          }}
                        />
                        <span className="text-sm truncate">{t.name}</span>
                        {t.taskGroup && !allowed ? (
                          <span className="text-[10px] text-muted-foreground truncate shrink-0 max-w-[7rem]">
                            {t.taskGroup.name}
                          </span>
                        ) : null}
                        {t.hidden && (
                          <Badge variant="outline" className="text-[10px] shrink-0 px-1.5 py-0">
                            Hidden
                          </Badge>
                        )}
                      </div>
                      <span className="text-xs text-muted-foreground tabular-nums shrink-0">
                        {fmtMs(tMs)}
                      </span>
                    </label>
                  );
                })}
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="shrink-0">
            <Button variant="outline" onClick={() => setEditDialogGroup(null)}>
              Cancel
            </Button>
            <Button
              onClick={() => void saveEdit()}
              disabled={updateGroup.isPending || !editName.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={createGroupOpen}
        onOpenChange={(open) => {
          if (!open) closeCreateGroupDialog();
        }}
      >
        <DialogContent className="flex h-[min(92dvh,56rem)] max-h-[92dvh] flex-col gap-0 overflow-hidden p-6 sm:max-w-xl duration-300 data-[state=open]:duration-300 data-[state=closed]:duration-200">
          <DialogHeader className="shrink-0">
            <DialogTitle>Create a group from tasks</DialogTitle>
          </DialogHeader>

          <div className="flex min-h-0 flex-1 flex-col gap-3 py-4">
            {groupDialogError ? (
              <p className="shrink-0 text-sm text-destructive">{groupDialogError}</p>
            ) : null}
            <Input
              id="new-group-name"
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              placeholder="Group name"
              className="h-10 shrink-0"
              autoComplete="off"
              onKeyDown={(e) => {
                if (e.key === "Enter") void saveQuickGroup();
              }}
            />

            <div className="space-y-2 shrink-0">
              <Label className="text-xs font-medium">Group color</Label>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={createColorMode === "auto" ? "secondary" : "outline"}
                  onClick={() => setCreateColorMode("auto")}
                >
                  Auto
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={createColorMode === "custom" ? "secondary" : "outline"}
                  onClick={() => setCreateColorMode("custom")}
                >
                  Custom
                </Button>
              </div>
              <GroupColorPresetGrid
                value={createColorMode === "auto" ? "#94a3b8" : createGroupColor}
                dimmed={createColorMode === "auto"}
                onPick={(hex) => {
                  setCreateColorMode("custom");
                  setCreateGroupColor(hex);
                }}
              />
              {createColorMode === "auto" ? (
                <p className="text-[11px] text-muted-foreground">
                  Color will follow the automatic palette from the group id after you save.
                </p>
              ) : null}
            </div>

            <Input
              id="new-group-filter"
              value={createGroupFilter}
              onChange={(e) => setCreateGroupFilter(e.target.value)}
              placeholder="Filter tasks…"
              className="h-9 shrink-0 text-sm"
            />
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                className="h-8 text-xs"
                onClick={selectAllFilteredTasks}
                disabled={createGroupFilteredTasks.length === 0}
              >
                Select all in list
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                onClick={clearSelectedTasks}
                disabled={selectedTaskIds.size === 0}
              >
                Clear selection
              </Button>
              {createGroupFilter.trim() ? (
                <span className="text-xs text-muted-foreground">
                  {createGroupFilteredTasks.length} match
                  {createGroupFilteredTasks.length !== 1 ? "es" : ""}
                </span>
              ) : null}
            </div>
            <Separator className="shrink-0" />

            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1 [-webkit-overflow-scrolling:touch]">
                <div className="space-y-1 pr-1 -mr-1">
                  {tasks.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No tasks yet.
                    </p>
                  ) : createGroupFilteredTasks.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      No tasks match this search.
                    </p>
                  ) : (
                    createGroupFilteredTasks.map((task) => {
                      const tMs = taskMs(task, from, to);
                      const selected = selectedTaskIds.has(task.id);
                      const allowed = taskAllowedInGroupPicker(task, null);
                      return (
                        <label
                          key={task.id}
                          className={cn(
                            "flex items-center justify-between gap-3 rounded-md px-2 py-2",
                            !allowed
                              ? "cursor-not-allowed opacity-60"
                              : "cursor-pointer hover:bg-muted/60"
                          )}
                        >
                          <div className="flex min-w-0 items-center gap-3">
                            <Checkbox
                              checked={selected}
                              disabled={!allowed}
                              onCheckedChange={(checked) => {
                                if (!allowed) return;
                                setSelectedTaskIds((prev) => {
                                  const next = new Set(prev);
                                  if (checked) next.add(task.id);
                                  else next.delete(task.id);
                                  return next;
                                });
                              }}
                            />
                            <span className="truncate text-sm">{task.name}</span>
                            {task.taskGroup ? (
                              <Badge
                                variant="secondary"
                                className="max-w-[7rem] shrink-0 truncate px-1.5 py-0 text-[10px] font-normal"
                                title={task.taskGroup.name}
                              >
                                {task.taskGroup.name}
                              </Badge>
                            ) : null}
                            {task.hidden ? (
                              <Badge
                                variant="outline"
                                className="shrink-0 px-1.5 py-0 text-[10px]"
                              >
                                Hidden
                              </Badge>
                            ) : null}
                          </div>
                          <span className="shrink-0 tabular-nums text-xs text-muted-foreground">
                            {fmtMs(tMs)}
                          </span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="shrink-0 space-y-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm text-muted-foreground">
              <span>
                <span className="font-semibold text-foreground tabular-nums">
                  {selectedTaskIds.size}
                </span>{" "}
                task{selectedTaskIds.size !== 1 ? "s" : ""} selected
              </span>
              <span className="font-semibold tabular-nums text-foreground">
                {fmtMs(quickSelectMs)}
              </span>
            </div>
            <DialogFooter className="gap-2 sm:gap-0 sm:justify-end">
              <Button type="button" variant="outline" onClick={closeCreateGroupDialog}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={() => void saveQuickGroup()}
                disabled={
                  createGroup.isPending ||
                  selectedTaskIds.size === 0 ||
                  !saveName.trim()
                }
              >
                {createGroup.isPending ? "Saving…" : "Save group"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
