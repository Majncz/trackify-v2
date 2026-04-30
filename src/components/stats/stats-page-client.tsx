"use client";

import { useState, useMemo, useCallback } from "react";
import { useTasks } from "@/hooks/use-tasks";
import { useGroups } from "@/hooks/use-groups";
import type { TaskGroup } from "@/hooks/use-groups";
import { Card, CardContent } from "@/components/ui/card";
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
  Cell,
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
  Clock,
  TrendingUp,
  Layers,
  ListChecks,
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

// ─── Design tokens ───────────────────────────────────────────────────────────

/** Hex values used for inline styles (borders, chart cells) where Tailwind can't be dynamic */
const GROUP_HEX = [
  "#3b82f6", // blue
  "#f97316", // orange
  "#10b981", // emerald
  "#8b5cf6", // violet
  "#ec4899", // pink
  "#14b8a6", // teal
  "#eab308", // yellow
  "#ef4444", // red
];

const GROUP_BG_OPACITY = [
  "bg-blue-500/8",
  "bg-orange-500/8",
  "bg-emerald-500/8",
  "bg-violet-500/8",
  "bg-pink-500/8",
  "bg-teal-500/8",
  "bg-yellow-500/8",
  "bg-red-500/8",
];

const RANK_STYLE: Record<number, string> = {
  0: "bg-amber-400/20 text-amber-600 dark:text-amber-400 ring-1 ring-amber-400/30",
  1: "bg-slate-400/20 text-slate-500 dark:text-slate-400 ring-1 ring-slate-400/30",
  2: "bg-orange-400/20 text-orange-600 dark:text-orange-400 ring-1 ring-orange-400/30",
};

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

// ─── Subcomponents ───────────────────────────────────────────────────────────

function SectionHeader({
  icon: Icon,
  title,
  action,
}: {
  icon: React.ElementType;
  title: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2">
        <div className="p-1.5 rounded-md bg-muted">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        </div>
        <h2 className="text-sm font-semibold">{title}</h2>
      </div>
      {action}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function StatsPageClient() {
  const { tasks, isLoading: tasksLoading } = useTasks();
  const { groups, isLoading: groupsLoading, createGroup, updateGroup, deleteGroup } = useGroups();

  // Date range
  const [rangeType, setRangeType] = useState<RangeType>("week");
  const [customFrom, setCustomFrom] = useState<string>(
    () => format(startOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd")
  );
  const [customTo, setCustomTo] = useState<string>(
    () => format(endOfWeek(new Date(), { weekStartsOn: 1 }), "yyyy-MM-dd")
  );

  // Group UI
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTaskIds, setEditTaskIds] = useState<Set<string>>(new Set());

  // Quick select
  const [quickOpen, setQuickOpen] = useState(false);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());
  const [savingGroup, setSavingGroup] = useState(false);
  const [saveName, setSaveName] = useState("");

  // ─── Date range computation ───────────────────────────────────────────────

  const { from, to, label } = useMemo(() => {
    const now = new Date();
    switch (rangeType) {
      case "today":
        return { from: startOfDay(now), to: endOfDay(now), label: format(now, "MMM d, yyyy") };
      case "week": {
        const s = startOfWeek(now, { weekStartsOn: 1 });
        const e = endOfWeek(now, { weekStartsOn: 1 });
        return { from: s, to: e, label: `${format(s, "MMM d")} – ${format(e, "MMM d, yyyy")}` };
      }
      case "month": {
        const s = startOfMonth(now);
        const e = endOfMonth(now);
        return { from: s, to: e, label: format(now, "MMMM yyyy") };
      }
      case "alltime":
        return { from: null, to: null, label: "All time" };
      case "custom": {
        const s = customFrom ? startOfDay(parseISO(customFrom)) : startOfDay(now);
        const e = customTo ? endOfDay(parseISO(customTo)) : endOfDay(now);
        return { from: s, to: e, label: `${format(s, "MMM d")} – ${format(e, "MMM d, yyyy")}` };
      }
    }
  }, [rangeType, customFrom, customTo]);

  // ─── Stats ────────────────────────────────────────────────────────────────

  const taskTotals = useMemo(
    () => tasks.map((t) => ({ task: t, ms: taskMs(t, from, to) })),
    [tasks, from, to]
  );

  const totalMs = useMemo(() => taskTotals.reduce((s, t) => s + t.ms, 0), [taskTotals]);

  const dailyAvgMs = useMemo(() => {
    if (totalMs === 0) return 0;
    const days = new Set<string>();
    for (const { task } of taskTotals)
      for (const e of task.events)
        if (eventOverlapMs(e, from, to) > 0) days.add(format(parseISO(e.from), "yyyy-MM-dd"));
    return days.size > 0 ? Math.round(totalMs / days.size) : totalMs;
  }, [taskTotals, totalMs, from, to]);

  const topTasks = useMemo(
    () => [...taskTotals].filter((t) => t.ms > 0).sort((a, b) => b.ms - a.ms).slice(0, 5),
    [taskTotals]
  );

  const trendData = useMemo(() => {
    let chartFrom: Date, chartTo: Date;
    if (from && to) {
      chartFrom = from;
      chartTo = to;
    } else {
      let earliest: Date | null = null;
      for (const task of tasks)
        for (const e of task.events) {
          const d = parseISO(e.from);
          if (!earliest || d < earliest) earliest = d;
        }
      chartFrom = earliest
        ? startOfDay(earliest)
        : startOfDay(new Date(Date.now() - 29 * 86400000));
      chartTo = endOfDay(new Date());
    }

    const allDays = eachDayOfInterval({ start: chartFrom, end: chartTo });

    if (allDays.length <= 42) {
      return allDays.map((day) => {
        const dFrom = startOfDay(day);
        const dTo = endOfDay(day);
        let ms = 0;
        for (const task of tasks)
          for (const e of task.events) ms += eventOverlapMs(e, dFrom, dTo);
        return { date: format(day, "MMM d"), hours: parseFloat((ms / 3600000).toFixed(2)), ms };
      });
    }

    // Weekly buckets
    const wm = new Map<string, { date: string; ms: number }>();
    for (const day of allDays) {
      const ws = startOfWeek(day, { weekStartsOn: 1 });
      const key = format(ws, "yyyy-MM-dd");
      if (!wm.has(key)) wm.set(key, { date: format(ws, "MMM d"), ms: 0 });
      const dFrom = startOfDay(day);
      const dTo = endOfDay(day);
      for (const task of tasks)
        for (const e of task.events) wm.get(key)!.ms += eventOverlapMs(e, dFrom, dTo);
    }
    return Array.from(wm.values()).map(({ date, ms }) => ({
      date,
      hours: parseFloat((ms / 3600000).toFixed(2)),
      ms,
    }));
  }, [tasks, from, to]);

  // ─── Group data ───────────────────────────────────────────────────────────

  const groupData = useMemo(
    () =>
      groups.map((g) => {
        const gt = tasks.filter((t) => g.taskIds.includes(t.id));
        const ms = gt.reduce((s, t) => s + taskMs(t, from, to), 0);
        const perTask = gt
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
      return [
        `${group.name} — ${fmtMs(ms)} (${label})`,
        ...perTask.map((t) => `  ${t.task.name}: ${fmtMs(t.ms)}`),
      ].join("\n");
    },
    [groupData, label]
  );

  const copyGroup = useCallback(
    (idx: number) => navigator.clipboard.writeText(buildGroupText(idx)).catch(() => {}),
    [buildGroupText]
  );

  const copyAll = useCallback(() => {
    navigator.clipboard
      .writeText(groupData.map((_, i) => buildGroupText(i)).join("\n\n"))
      .catch(() => {});
  }, [groupData, buildGroupText]);

  const startEdit = useCallback((group: TaskGroup) => {
    setEditingGroupId(group.id);
    setEditName(group.name);
    setEditTaskIds(new Set(group.taskIds));
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editingGroupId) return;
    await updateGroup.mutateAsync({ id: editingGroupId, name: editName, taskIds: Array.from(editTaskIds) });
    setEditingGroupId(null);
  }, [editingGroupId, editName, editTaskIds, updateGroup]);

  const saveQuickGroup = useCallback(async () => {
    if (!saveName.trim() || selectedTaskIds.size === 0) return;
    await createGroup.mutateAsync({ name: saveName.trim(), taskIds: Array.from(selectedTaskIds) });
    setSaveName("");
    setSelectedTaskIds(new Set());
    setSavingGroup(false);
  }, [saveName, selectedTaskIds, createGroup]);

  const quickSelectMs = useMemo(
    () => tasks.filter((t) => selectedTaskIds.has(t.id)).reduce((s, t) => s + taskMs(t, from, to), 0),
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
        <Skeleton className="h-10 w-full rounded-xl" />
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
        </div>
        <Skeleton className="h-44 rounded-xl" />
        <Skeleton className="h-36 rounded-xl" />
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
    <div className="space-y-7">

      {/* ── Date range segmented control ─────────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex bg-muted rounded-xl p-1 gap-1">
          {RANGES.map((r) => (
            <button
              key={r.value}
              onClick={() => setRangeType(r.value)}
              className={cn(
                "flex-1 min-w-0 px-2 py-1.5 text-xs sm:text-sm rounded-lg font-medium transition-all duration-150 truncate",
                rangeType === r.value
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {r.label}
            </button>
          ))}
        </div>
        {rangeType === "custom" && (
          <div className="flex items-center gap-2 flex-wrap px-1">
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

      {/* ── Headline metric cards ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3">
        {/* Total tracked — blue */}
        <div className="relative rounded-xl overflow-hidden border bg-gradient-to-br from-blue-500/10 via-blue-400/5 to-transparent">
          <div className="absolute inset-y-0 left-0 w-[3px] bg-blue-500 rounded-r-full" />
          <div className="px-4 py-4 pl-5">
            <p className="text-[10px] font-semibold text-blue-600/70 dark:text-blue-400/70 uppercase tracking-widest mb-1">
              Total
            </p>
            <p className="text-2xl font-bold tabular-nums text-blue-700 dark:text-blue-300 leading-none">
              {fmtMs(totalMs)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1.5 truncate">{label}</p>
          </div>
        </div>

        {/* Daily average — emerald */}
        <div className="relative rounded-xl overflow-hidden border bg-gradient-to-br from-emerald-500/10 via-emerald-400/5 to-transparent">
          <div className="absolute inset-y-0 left-0 w-[3px] bg-emerald-500 rounded-r-full" />
          <div className="px-4 py-4 pl-5">
            <p className="text-[10px] font-semibold text-emerald-600/70 dark:text-emerald-400/70 uppercase tracking-widest mb-1">
              Daily Avg
            </p>
            <p className="text-2xl font-bold tabular-nums text-emerald-700 dark:text-emerald-300 leading-none">
              {fmtMs(dailyAvgMs)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-1.5">per active day</p>
          </div>
        </div>
      </div>

      {/* ── Trend chart ──────────────────────────────────────────────────── */}
      {trendData.some((d) => d.hours > 0) && (
        <div>
          <SectionHeader icon={TrendingUp} title="Daily Breakdown" />
          <Card>
            <CardContent className="px-1 pb-4 pt-3">
              <ResponsiveContainer width="100%" height={148}>
                <BarChart data={trendData} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
                  <defs>
                    <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.9} />
                      <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.7} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid
                    strokeDasharray="3 3"
                    className="stroke-border"
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${v}h`}
                  />
                  <RechartsTooltip
                    formatter={(value) => [fmtMs((value as number) * 3600000), "Time"]}
                    contentStyle={{
                      background: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "10px",
                      fontSize: 12,
                      boxShadow: "0 4px 12px rgba(0,0,0,0.08)",
                    }}
                    cursor={{ fill: "hsl(var(--muted))", radius: 4 }}
                  />
                  <Bar dataKey="hours" fill="url(#trendGrad)" radius={[4, 4, 0, 0]} maxBarSize={28}>
                    {trendData.map((entry, i) => (
                      <Cell
                        key={i}
                        fill={entry.hours > 0 ? "url(#trendGrad)" : "hsl(var(--muted))"}
                        fillOpacity={entry.hours > 0 ? 1 : 0.4}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Top tasks ────────────────────────────────────────────────────── */}
      {topTasks.length > 0 && (
        <div>
          <SectionHeader icon={Clock} title="Top Tasks" />
          <Card>
            <CardContent className="px-4 py-4 space-y-4">
              {topTasks.map(({ task, ms }, i) => (
                <div key={task.id} className="flex items-center gap-3">
                  <span
                    className={cn(
                      "h-6 w-6 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0",
                      RANK_STYLE[i] ?? "bg-muted text-muted-foreground text-xs"
                    )}
                  >
                    {i + 1}
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="flex justify-between items-baseline mb-1.5">
                      <span className="text-sm truncate pr-2">{task.name}</span>
                      <span className="text-sm font-semibold tabular-nums shrink-0 text-foreground/80">
                        {fmtMs(ms)}
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{
                          width: `${totalMs > 0 ? (ms / totalMs) * 100 : 0}%`,
                          background: "linear-gradient(90deg, #3b82f6, #8b5cf6)",
                        }}
                      />
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {/* ── Saved groups ─────────────────────────────────────────────────── */}
      <div>
        <SectionHeader
          icon={Layers}
          title="Saved Groups"
          action={
            groups.length >= 2 ? (
              <Button variant="ghost" size="sm" className="text-xs h-7 gap-1.5" onClick={copyAll}>
                <Copy className="h-3 w-3" />
                Copy all
              </Button>
            ) : undefined
          }
        />

        {/* Comparison bar */}
        {groupData.filter((g) => g.ms > 0).length >= 2 && (
          <Card className="mb-3">
            <CardContent className="px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                Comparison
              </p>
              <div className="flex h-3 rounded-full overflow-hidden gap-px">
                {groupData
                  .filter((g) => g.ms > 0)
                  .map(({ group, ms }, i) => (
                    <div
                      key={group.id}
                      className="h-full transition-all"
                      style={{
                        width: `${comparisonTotal > 0 ? (ms / comparisonTotal) * 100 : 0}%`,
                        backgroundColor: GROUP_HEX[i % GROUP_HEX.length],
                      }}
                      title={`${group.name}: ${fmtMs(ms)}`}
                    />
                  ))}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3">
                {groupData
                  .filter((g) => g.ms > 0)
                  .map(({ group, ms }, i) => (
                    <div key={group.id} className="flex items-center gap-1.5">
                      <div
                        className="h-2 w-2 rounded-full shrink-0"
                        style={{ backgroundColor: GROUP_HEX[i % GROUP_HEX.length] }}
                      />
                      <span className="text-xs text-muted-foreground">
                        {group.name}{" "}
                        <span className="font-semibold tabular-nums text-foreground">
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
          <p className="text-sm text-muted-foreground py-2">
            No saved groups yet. Use quick select below to create one.
          </p>
        )}

        <div className="space-y-2.5">
          {groupData.map(({ group, ms, perTask }, i) => {
            const isExpanded = expandedGroups.has(group.id);
            const isEditing = editingGroupId === group.id;
            const color = GROUP_HEX[i % GROUP_HEX.length];

            return (
              <div
                key={group.id}
                className={cn(
                  "rounded-xl border overflow-hidden",
                  GROUP_BG_OPACITY[i % GROUP_BG_OPACITY.length]
                )}
                style={{ borderLeftColor: color, borderLeftWidth: 3 }}
              >
                <div className="px-4 py-3">
                  {isEditing ? (
                    <div className="space-y-3">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        placeholder="Group name"
                        className="h-8 text-sm"
                        autoFocus
                      />
                      <p className="text-xs font-medium text-muted-foreground">
                        Tasks in this group:
                      </p>
                      <div className="space-y-2 max-h-48 overflow-y-auto">
                        {tasks.map((t) => (
                          <label key={t.id} className="flex items-center gap-2 cursor-pointer">
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
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          className="h-7 gap-1"
                          onClick={saveEdit}
                          disabled={updateGroup.isPending || !editName.trim()}
                        >
                          <Check className="h-3 w-3" />
                          Save
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 gap-1"
                          onClick={() => setEditingGroupId(null)}
                        >
                          <X className="h-3 w-3" />
                          Cancel
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm flex-1 min-w-0 truncate">
                        {group.name}
                      </span>
                      <span
                        className="text-sm font-bold tabular-nums shrink-0 mr-1"
                        style={{ color }}
                      >
                        {fmtMs(ms)}
                      </span>
                      <div className="flex items-center gap-0 shrink-0">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => copyGroup(i)}
                          title="Copy"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => startEdit(group)}
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-destructive/70 hover:text-destructive"
                          onClick={() => deleteGroup.mutate(group.id)}
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => toggleExpanded(group.id)}
                        >
                          {isExpanded ? (
                            <ChevronUp className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronDown className="h-3.5 w-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>

                {isExpanded && !isEditing && (
                  <div className="px-4 pb-3 border-t border-border/40">
                    <div className="pt-3">
                      {perTask.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No time tracked in this period.
                        </p>
                      ) : (
                        <div className="space-y-3">
                          {perTask.map(({ task, ms: tMs }) => (
                            <div key={task.id}>
                              <div className="flex justify-between items-baseline mb-1">
                                <span className="text-xs truncate pr-2">{task.name}</span>
                                <span className="text-xs font-semibold tabular-nums shrink-0">
                                  {fmtMs(tMs)}
                                </span>
                              </div>
                              <div className="h-1 bg-black/8 dark:bg-white/8 rounded-full overflow-hidden">
                                <div
                                  className="h-full rounded-full transition-all duration-500"
                                  style={{
                                    width: `${ms > 0 ? (tMs / ms) * 100 : 0}%`,
                                    backgroundColor: color,
                                    opacity: 0.75,
                                  }}
                                />
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Quick select ─────────────────────────────────────────────────── */}
      <div>
        <button
          className="flex items-center gap-2 w-full text-left mb-3 group"
          onClick={() => setQuickOpen((o) => !o)}
        >
          <div className="p-1.5 rounded-md bg-muted group-hover:bg-muted/70 transition-colors">
            <ListChecks className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
          <span className="text-sm font-semibold">Quick Select</span>
          <span className="text-xs font-normal text-muted-foreground">
            — pick tasks to see combined time
          </span>
          <div className="ml-auto">
            {quickOpen ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </button>

        {quickOpen && (
          <Card>
            <CardContent className="px-4 py-2 divide-y divide-border/50">
              {tasks.length === 0 && (
                <p className="text-sm text-muted-foreground py-3">No tasks yet.</p>
              )}
              {tasks.map((task) => {
                const tMs = taskMs(task, from, to);
                const isSelected = selectedTaskIds.has(task.id);
                return (
                  <label
                    key={task.id}
                    className={cn(
                      "flex items-center justify-between gap-3 py-2.5 cursor-pointer transition-colors",
                      isSelected && "text-foreground"
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={(checked) => {
                          setSelectedTaskIds((prev) => {
                            const next = new Set(prev);
                            if (checked) next.add(task.id);
                            else next.delete(task.id);
                            return next;
                          });
                        }}
                      />
                      <span className="text-sm truncate">{task.name}</span>
                    </div>
                    <span
                      className={cn(
                        "text-xs tabular-nums shrink-0 font-medium",
                        tMs > 0 ? "text-foreground/70" : "text-muted-foreground"
                      )}
                    >
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
        <div className="fixed bottom-[calc(3.5rem+env(safe-area-inset-bottom,0px))] md:bottom-6 left-3 right-3 md:left-auto md:right-8 md:w-96 z-40">
          <div className="rounded-xl border bg-card/95 backdrop-blur-md shadow-2xl shadow-black/10 overflow-hidden">
            <div
              className="h-[3px] w-full"
              style={{ background: "linear-gradient(90deg, #3b82f6, #8b5cf6, #ec4899)" }}
            />
            <div className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  {selectedTaskIds.size} task{selectedTaskIds.size !== 1 ? "s" : ""} selected
                </p>
                <p className="text-xl font-bold tabular-nums">{fmtMs(quickSelectMs)}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {savingGroup ? (
                  <>
                    <Input
                      value={saveName}
                      onChange={(e) => setSaveName(e.target.value)}
                      placeholder="Group name"
                      className="h-8 text-sm w-28"
                      autoFocus
                      onKeyDown={(e) => e.key === "Enter" && saveQuickGroup()}
                    />
                    <Button
                      size="sm"
                      className="h-8 px-2"
                      onClick={saveQuickGroup}
                      disabled={createGroup.isPending || !saveName.trim()}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2"
                      onClick={() => { setSavingGroup(false); setSaveName(""); }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1.5"
                      onClick={() => setSavingGroup(true)}
                    >
                      <Plus className="h-3 w-3" />
                      Save group
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-muted-foreground"
                      onClick={() => setSelectedTaskIds(new Set())}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
