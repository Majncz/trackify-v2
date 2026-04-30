"use client";

import { useState, useMemo, useCallback } from "react";
import { useTasks } from "@/hooks/use-tasks";
import { useGroups } from "@/hooks/use-groups";
import type { TaskGroup } from "@/hooks/use-groups";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
    () => tasks.map((t) => ({ task: t, ms: taskMs(t, from, to) })),
    [tasks, from, to]
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

  // Trend chart data
  const trendData = useMemo(() => {
    let chartFrom: Date;
    let chartTo: Date;

    if (from && to) {
      chartFrom = from;
      chartTo = to;
    } else {
      let earliest: Date | null = null;
      for (const task of tasks) {
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
        const dFrom = startOfDay(day);
        const dTo = endOfDay(day);
        let ms = 0;
        for (const task of tasks) {
          for (const event of task.events) {
            ms += eventOverlapMs(event, dFrom, dTo);
          }
        }
        return { date: format(day, "MMM d"), hours: parseFloat((ms / 3600000).toFixed(2)) };
      });
    }

    // Weekly buckets for longer ranges
    const weekMap = new Map<string, { date: string; ms: number }>();
    for (const day of allDays) {
      const ws = startOfWeek(day, { weekStartsOn: 1 });
      const key = format(ws, "yyyy-MM-dd");
      if (!weekMap.has(key)) weekMap.set(key, { date: format(ws, "MMM d"), ms: 0 });
      const dFrom = startOfDay(day);
      const dTo = endOfDay(day);
      for (const task of tasks) {
        for (const event of task.events) {
          weekMap.get(key)!.ms += eventOverlapMs(event, dFrom, dTo);
        }
      }
    }
    return Array.from(weekMap.values()).map(({ date, ms }) => ({
      date,
      hours: parseFloat((ms / 3600000).toFixed(2)),
    }));
  }, [tasks, from, to]);

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
        <div className="grid grid-cols-2 gap-3">
          <Skeleton className="h-24" />
          <Skeleton className="h-24" />
        </div>
        <Skeleton className="h-44" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Date range filter ────────────────────────────────────────────── */}
      <div className="flex flex-wrap gap-2">
        {(["today", "week", "month", "alltime", "custom"] as RangeType[]).map(
          (r) => (
            <Button
              key={r}
              variant={rangeType === r ? "default" : "outline"}
              size="sm"
              onClick={() => setRangeType(r)}
            >
              {r === "alltime"
                ? "All Time"
                : r.charAt(0).toUpperCase() + r.slice(1)}
            </Button>
          )
        )}
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
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Total Tracked
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-bold tabular-nums">{fmtMs(totalMs)}</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">{label}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-1 pt-4 px-4">
            <CardTitle className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Daily Average
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4">
            <p className="text-2xl font-bold tabular-nums">{fmtMs(dailyAvgMs)}</p>
            <p className="text-xs text-muted-foreground mt-0.5">per active day</p>
          </CardContent>
        </Card>
      </div>

      {/* ── Trend chart ──────────────────────────────────────────────────── */}
      {trendData.some((d) => d.hours > 0) && (
        <Card>
          <CardHeader className="pb-0 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Daily Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="px-1 pb-4 pt-2">
            <ResponsiveContainer width="100%" height={150}>
              <BarChart
                data={trendData}
                margin={{ top: 4, right: 8, left: -24, bottom: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 3"
                  className="stroke-border"
                  vertical={false}
                />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(v: number) => `${v}h`}
                />
                <RechartsTooltip
                  formatter={(value) => [fmtMs((value as number) * 3600000), "Time"]}
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                    fontSize: 12,
                  }}
                  cursor={{ fill: "hsl(var(--muted))" }}
                />
                <Bar
                  dataKey="hours"
                  fill="hsl(var(--primary))"
                  radius={[3, 3, 0, 0]}
                  maxBarSize={28}
                />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {/* ── Top tasks ────────────────────────────────────────────────────── */}
      {topTasks.length > 0 && (
        <Card>
          <CardHeader className="pb-2 pt-4 px-4">
            <CardTitle className="text-sm font-medium">Top Tasks</CardTitle>
          </CardHeader>
          <CardContent className="px-4 pb-4 space-y-3">
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
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{
                        width: `${totalMs > 0 ? (ms / totalMs) * 100 : 0}%`,
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
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Saved Groups</h2>
          {groups.length >= 2 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7 gap-1"
              onClick={copyAll}
            >
              <Copy className="h-3 w-3" />
              Copy all
            </Button>
          )}
        </div>

        {/* Group comparison bar */}
        {groupData.filter((g) => g.ms > 0).length >= 2 && (
          <Card>
            <CardContent className="px-4 py-3">
              <p className="text-xs text-muted-foreground mb-2">Comparison</p>
              <div className="flex h-3 rounded-full overflow-hidden gap-px">
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
              <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2">
                {groupData
                  .filter((g) => g.ms > 0)
                  .map(({ group, ms }, i) => (
                    <div key={group.id} className="flex items-center gap-1.5">
                      <div
                        className={cn(
                          "h-2 w-2 rounded-full shrink-0",
                          DOT_COLORS[i % DOT_COLORS.length]
                        )}
                      />
                      <span className="text-xs">
                        {group.name}{" "}
                        <span className="font-medium tabular-nums">
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
          <p className="text-sm text-muted-foreground">
            No saved groups yet. Use quick select below to create one.
          </p>
        )}

        {groupData.map(({ group, ms, perTask }, i) => {
          const isExpanded = expandedGroups.has(group.id);
          const isEditing = editingGroupId === group.id;

          return (
            <Card key={group.id}>
              <CardHeader className="pb-2 pt-3 px-4">
                {isEditing ? (
                  <div className="space-y-3">
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="Group name"
                      className="h-8 text-sm"
                      autoFocus
                    />
                    <p className="text-xs text-muted-foreground font-medium">
                      Tasks in this group:
                    </p>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {tasks.map((t) => (
                        <label
                          key={t.id}
                          className="flex items-center gap-2 cursor-pointer"
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
                    <div
                      className={cn(
                        "h-2.5 w-2.5 rounded-full shrink-0",
                        DOT_COLORS[i % DOT_COLORS.length]
                      )}
                    />
                    <span className="font-medium text-sm flex-1 min-w-0 truncate">
                      {group.name}
                    </span>
                    <span className="text-sm font-bold tabular-nums shrink-0">
                      {fmtMs(ms)}
                    </span>
                    <div className="flex items-center gap-0 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => copyGroup(i)}
                        title="Copy to clipboard"
                      >
                        <Copy className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => startEdit(group)}
                        title="Edit group"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        onClick={() => deleteGroup.mutate(group.id)}
                        title="Delete group"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => toggleExpanded(group.id)}
                        title={isExpanded ? "Collapse" : "Expand"}
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
              </CardHeader>

              {isExpanded && !isEditing && (
                <CardContent className="px-4 pb-3 pt-0">
                  {perTask.length === 0 ? (
                    <p className="text-xs text-muted-foreground">
                      No time tracked in this period.
                    </p>
                  ) : (
                    <div className="space-y-2.5">
                      {perTask.map(({ task, ms: tMs }) => (
                        <div key={task.id}>
                          <div className="flex justify-between items-baseline mb-1">
                            <span className="text-xs truncate pr-2">
                              {task.name}
                            </span>
                            <span className="text-xs font-medium tabular-nums shrink-0">
                              {fmtMs(tMs)}
                            </span>
                          </div>
                          <div className="h-1 bg-muted rounded-full overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all",
                                BAR_COLORS[i % BAR_COLORS.length]
                              )}
                              style={{
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
      <div>
        <button
          className="flex items-center gap-2 text-sm font-semibold mb-3 w-full text-left"
          onClick={() => setQuickOpen((o) => !o)}
        >
          {quickOpen ? (
            <ChevronUp className="h-4 w-4" />
          ) : (
            <ChevronDown className="h-4 w-4" />
          )}
          Quick Select
          <span className="text-xs font-normal text-muted-foreground ml-1">
            — pick tasks to see combined time
          </span>
        </button>

        {quickOpen && (
          <Card>
            <CardContent className="px-4 py-3 space-y-1.5">
              {tasks.length === 0 && (
                <p className="text-sm text-muted-foreground py-2">
                  No tasks yet.
                </p>
              )}
              {tasks.map((task) => {
                const tMs = taskMs(task, from, to);
                return (
                  <label
                    key={task.id}
                    className="flex items-center justify-between gap-2 cursor-pointer py-1"
                  >
                    <div className="flex items-center gap-2 min-w-0">
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
                      <span className="text-sm truncate">{task.name}</span>
                    </div>
                    <span className="text-xs text-muted-foreground tabular-nums shrink-0">
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
          <Card className="shadow-xl border-primary/30">
            <CardContent className="px-4 py-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">
                  {selectedTaskIds.size} task
                  {selectedTaskIds.size !== 1 ? "s" : ""} selected
                </p>
                <p className="text-xl font-bold tabular-nums">
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
                      onClick={() => {
                        setSavingGroup(false);
                        setSaveName("");
                      }}
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs gap-1"
                      onClick={() => setSavingGroup(true)}
                    >
                      <Plus className="h-3 w-3" />
                      Save group
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2"
                      onClick={() => setSelectedTaskIds(new Set())}
                      title="Clear selection"
                    >
                      <X className="h-3.5 w-3.5" />
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
