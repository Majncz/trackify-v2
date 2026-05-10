"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

export type BillingRangePreset =
  | "this_week"
  | "this_month"
  | "last_month"
  | "all_time"
  | "custom";
export type BillingStatusFilter = "all" | "unpaid" | "paid";
export type BillingGroupBy = "day" | "week" | "month";

const selectClass = cn(
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
);

export type BillingFiltersProps = {
  preset: BillingRangePreset;
  onPresetChange: (p: BillingRangePreset) => void;
  customFrom: string;
  customTo: string;
  onCustomFromChange: (v: string) => void;
  onCustomToChange: (v: string) => void;
  taskGroupId: string | "all" | "ungrouped";
  onTaskGroupIdChange: (v: string | "all" | "ungrouped") => void;
  taskId: string | "all";
  onTaskIdChange: (v: string | "all") => void;
  status: BillingStatusFilter;
  onStatusChange: (s: BillingStatusFilter) => void;
  groupBy: BillingGroupBy;
  onGroupByChange: (g: BillingGroupBy) => void;
  enrolledTasks: { taskId: string; name: string }[];
  taskGroups: { id: string; name: string; color: string | null }[];
  hasUngroupedTasks: boolean;
  className?: string;
};

export function BillingFilters({
  preset,
  onPresetChange,
  customFrom,
  customTo,
  onCustomFromChange,
  onCustomToChange,
  taskGroupId,
  onTaskGroupIdChange,
  taskId,
  onTaskIdChange,
  status,
  onStatusChange,
  groupBy,
  onGroupByChange,
  enrolledTasks,
  taskGroups,
  hasUngroupedTasks,
  className,
}: BillingFiltersProps) {
  return (
    <Card className={cn("overflow-hidden", className)}>
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Filters</CardTitle>
        <CardDescription>
          One place to scope the numbers above, the list below, and the activity
          calendar. Filter by task group to match how you organize work.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5 pt-0">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2 sm:col-span-1 lg:col-span-1">
            <Label htmlFor="billing-period">Time period</Label>
            <select
              id="billing-period"
              className={selectClass}
              value={preset}
              onChange={(e) =>
                onPresetChange(e.target.value as BillingRangePreset)
              }
            >
              <option value="this_week">This week</option>
              <option value="this_month">This month</option>
              <option value="last_month">Last month</option>
              <option value="all_time">All time</option>
              <option value="custom">Custom range…</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="billing-task-group">Task group</Label>
            <select
              id="billing-task-group"
              className={selectClass}
              value={taskGroupId}
              onChange={(e) => {
                const v = e.target.value;
                if (v === "all" || v === "ungrouped") {
                  onTaskGroupIdChange(v);
                  return;
                }
                onTaskGroupIdChange(v);
              }}
            >
              <option value="all">All groups</option>
              {hasUngroupedTasks ? (
                <option value="ungrouped">Ungrouped only</option>
              ) : null}
              {taskGroups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="billing-task">Task</Label>
            <select
              id="billing-task"
              className={selectClass}
              value={taskId}
              onChange={(e) => {
                const v = e.target.value;
                onTaskIdChange(v === "all" ? "all" : v);
              }}
            >
              <option value="all">All enrolled tasks</option>
              {enrolledTasks.map((t) => (
                <option key={t.taskId} value={t.taskId}>
                  {t.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="billing-status">Payment status</Label>
            <select
              id="billing-status"
              className={selectClass}
              value={status}
              onChange={(e) =>
                onStatusChange(e.target.value as BillingStatusFilter)
              }
            >
              <option value="unpaid">Unpaid (ready to pay)</option>
              <option value="all">All (unpaid + paid)</option>
              <option value="paid">Paid only (read-only)</option>
            </select>
          </div>
        </div>

        {preset === "custom" && (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end rounded-md border border-dashed bg-muted/20 p-3">
            <div className="space-y-1 flex-1">
              <Label htmlFor="billing-from">From</Label>
              <Input
                id="billing-from"
                type="date"
                value={customFrom}
                onChange={(e) => onCustomFromChange(e.target.value)}
              />
            </div>
            <div className="space-y-1 flex-1">
              <Label htmlFor="billing-to">To</Label>
              <Input
                id="billing-to"
                type="date"
                value={customTo}
                onChange={(e) => onCustomToChange(e.target.value)}
              />
            </div>
          </div>
        )}

        <details className="rounded-lg border bg-muted/15">
          <summary className="cursor-pointer px-3 py-2.5 text-sm font-medium text-foreground list-none flex items-center justify-between gap-2 [&::-webkit-details-marker]:hidden">
            <span>View options</span>
            <span className="text-xs font-normal text-muted-foreground">
              Group sessions by day, week, or month
            </span>
          </summary>
          <div className="border-t px-3 py-3 flex flex-wrap gap-2">
            {(
              [
                ["day", "By day"],
                ["week", "By week"],
                ["month", "By month"],
              ] as const
            ).map(([key, label]) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={groupBy === key ? "secondary" : "outline"}
                onClick={() => onGroupByChange(key)}
              >
                {label}
              </Button>
            ))}
          </div>
        </details>
      </CardContent>
    </Card>
  );
}
