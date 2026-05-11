"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { billingSurface } from "@/lib/billing-ui";
import { FormSelect, type FormSelectOption } from "@/components/ui/form-select";

export type BillingRangePreset =
  | "this_week"
  | "this_month"
  | "last_month"
  | "all_time"
  | "custom";
export type BillingStatusFilter = "all" | "unpaid" | "paid";
export type BillingGroupBy = "day" | "week" | "month";

const periodOptions: FormSelectOption[] = [
  { value: "this_week", label: "This week" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "all_time", label: "All time" },
  { value: "custom", label: "Custom…" },
];

const statusOptions: FormSelectOption[] = [
  { value: "unpaid", label: "Unpaid" },
  { value: "all", label: "All" },
  { value: "paid", label: "Paid" },
];

const labelClass = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

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
  const groupOptions: FormSelectOption[] = [
    { value: "all", label: "All groups" },
    ...(hasUngroupedTasks
      ? [{ value: "ungrouped" as const, label: "Ungrouped" }]
      : []),
    ...taskGroups.map((g) => ({ value: g.id, label: g.name })),
  ];

  const taskOptions: FormSelectOption[] = [
    { value: "all", label: "All enrolled" },
    ...enrolledTasks.map((t) => ({ value: t.taskId, label: t.name })),
  ];

  return (
    <div
      className={cn(
        billingSurface.toolbar,
        "px-2 py-2 sm:px-3 sm:py-2.5 space-y-2.5",
        className
      )}
    >
      <div className="grid grid-cols-2 gap-x-2 gap-y-2 lg:grid-cols-4 lg:gap-x-3">
        <div className="space-y-1">
          <Label htmlFor="billing-period" className={labelClass}>
            Period
          </Label>
          <FormSelect
            id="billing-period"
            size="sm"
            className="w-full min-w-0"
            value={preset}
            onValueChange={(v) => onPresetChange(v as BillingRangePreset)}
            options={periodOptions}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="billing-task-group" className={labelClass}>
            Group
          </Label>
          <FormSelect
            id="billing-task-group"
            size="sm"
            className="w-full min-w-0"
            value={taskGroupId}
            onValueChange={(v) =>
              onTaskGroupIdChange(v as "all" | "ungrouped" | string)
            }
            options={groupOptions}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="billing-task" className={labelClass}>
            Task
          </Label>
          <FormSelect
            id="billing-task"
            size="sm"
            className="w-full min-w-0"
            value={taskId}
            onValueChange={(v) => onTaskIdChange(v === "all" ? "all" : v)}
            options={taskOptions}
          />
        </div>

        <div className="space-y-1">
          <Label htmlFor="billing-status" className={labelClass}>
            Status
          </Label>
          <FormSelect
            id="billing-status"
            size="sm"
            className="w-full min-w-0"
            value={status}
            onValueChange={(v) => onStatusChange(v as BillingStatusFilter)}
            options={statusOptions}
          />
        </div>
      </div>

      {preset === "custom" && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end rounded-lg border-2 border-dashed border-border bg-muted/30 px-2 py-2 shadow-inner">
          <div className="space-y-0.5 flex-1 min-w-0">
            <Label htmlFor="billing-from" className={labelClass}>
              From
            </Label>
            <Input
              id="billing-from"
              type="date"
              className="h-8 text-xs"
              value={customFrom}
              onChange={(e) => onCustomFromChange(e.target.value)}
            />
          </div>
          <div className="space-y-0.5 flex-1 min-w-0">
            <Label htmlFor="billing-to" className={labelClass}>
              To
            </Label>
            <Input
              id="billing-to"
              type="date"
              className="h-8 text-xs"
              value={customTo}
              onChange={(e) => onCustomToChange(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5 border-t-2 border-border pt-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <span id="billing-group-by-label" className={cn(labelClass, "shrink-0")}>
          Group list by
        </span>
        <div
          className="flex flex-wrap gap-1"
          role="group"
          aria-labelledby="billing-group-by-label"
        >
          {(
            [
              ["day", "Day"],
              ["week", "Week"],
              ["month", "Month"],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={groupBy === key ? "secondary" : "outline"}
              className="h-7 px-2.5 text-xs"
              onClick={() => onGroupByChange(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
