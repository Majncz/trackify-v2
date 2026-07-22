"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, useCallback } from "react";
import { useTasks, type Task } from "@/hooks/use-tasks";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { eventToBillingSession } from "@/lib/billing";
import { formatMoney, formatDurationMinutes } from "@/lib/format-money";
import { DEFAULT_BILLING_CURRENCY } from "@/lib/billing-currencies";
import { CurrencySelect } from "@/components/billing/currency-select";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { billingSurface } from "@/lib/billing-ui";
import {
  resolveGroupAccent,
  taskAccentHex,
  groupAccentSoftBg,
} from "@/lib/group-accent";
import { Trash2 } from "lucide-react";

type BillingTaskRow = {
  id: string;
  taskId: string;
  hourlyRate: number;
  currency: string;
  roundingMins: number;
  task: {
    id: string;
    name: string;
    hidden: boolean;
    taskGroup: { id: string; name: string; color: string | null } | null;
  };
};

async function fetchBillingTasks(): Promise<BillingTaskRow[]> {
  const res = await fetch("/api/billing/tasks");
  if (!res.ok) throw new Error("Failed to load billing tasks");
  return res.json();
}

function rateRowAccent(task: Task): string {
  return task.taskGroup
    ? resolveGroupAccent(task.taskGroup)
    : taskAccentHex(task.id);
}

const ratesFieldLabelClass =
  "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

const rateInputClass = "h-10 tabular-nums bg-background shadow-sm";

export function TaskEnrollmentSheet() {
  const qc = useQueryClient();
  const { tasks, isLoading: tasksLoading } = useTasks();
  const { data: billingRows, isLoading: billingLoading } = useQuery({
    queryKey: ["billing-tasks"],
    queryFn: fetchBillingTasks,
  });

  const byTaskId = useMemo(
    () => new Map((billingRows ?? []).map((b) => [b.taskId, b])),
    [billingRows]
  );

  const [draftRate, setDraftRate] = useState<Record<string, string>>({});
  const [draftCurrency, setDraftCurrency] = useState<Record<string, string>>(
    {}
  );

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["billing-tasks"] });
    qc.invalidateQueries({ queryKey: ["billing-summary"] });
    qc.invalidateQueries({ queryKey: ["billing-sessions"] });
  }, [qc]);

  const enroll = useMutation({
    mutationFn: async (vars: {
      taskId: string;
      hourlyRate: number;
      currency?: string;
    }) => {
      const res = await fetch("/api/billing/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: vars.taskId,
          hourlyRate: vars.hourlyRate,
          currency: vars.currency ?? DEFAULT_BILLING_CURRENCY,
          roundingMins: 0,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Could not enroll task");
      }
    },
    onSuccess: invalidate,
  });

  const patch = useMutation({
    mutationFn: async (vars: {
      id: string;
      body: {
        hourlyRate?: number;
        currency?: string;
        roundingMins?: number;
      };
    }) => {
      const res = await fetch(`/api/billing/tasks/${vars.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(vars.body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Update failed");
      }
    },
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/billing/tasks/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Could not remove");
      }
    },
    onSuccess: invalidate,
  });

  const visibleTasks = useMemo(() => {
    const list = tasks.filter((t: Task) => !t.hidden);
    return [...list].sort((a: Task, b: Task) => {
      const aOn = byTaskId.has(a.id);
      const bOn = byTaskId.has(b.id);
      if (aOn !== bOn) return aOn ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [tasks, byTaskId]);

  if (tasksLoading || billingLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-10 w-full max-w-xl rounded-md" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-4 pb-2">
      <div
        className={cn(
          "rounded-lg border-2 border-dashed border-border bg-muted/25 px-3 py-2.5 text-sm text-muted-foreground leading-relaxed shadow-inner"
        )}
      >
        <span className="font-medium text-foreground">How this list works.</span>{" "}
        Rows use a light tint from your{" "}
        <span className="text-foreground">group color</span> when the task is in
        a group, or a stable{" "}
        <span className="text-foreground">task color</span> when it is
        ungrouped—matching Sessions. Badges spell out group vs ungrouped
        explicitly.
      </div>
      <div className="space-y-3">
      {visibleTasks.map((task: Task) => {
          const b = byTaskId.get(task.id);
          const rowAccent = rateRowAccent(task);

          return (
            <div
              key={task.id}
              className={billingSurface.section}
              style={{
                backgroundColor: groupAccentSoftBg(rowAccent, b ? 0.05 : 0.08),
              }}
            >
              <div className="p-3 sm:p-4 space-y-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2 gap-y-1">
                      <p className="text-sm font-semibold leading-tight">
                        {task.name}
                      </p>
                      {task.taskGroup ? (
                        <Badge
                          variant="outline"
                          className="text-[10px] font-normal px-1.5 py-0 h-5 border-0"
                          style={{
                            color: resolveGroupAccent(task.taskGroup),
                            backgroundColor: groupAccentSoftBg(
                              resolveGroupAccent(task.taskGroup),
                              0.2
                            ),
                          }}
                        >
                          {task.taskGroup.name}
                        </Badge>
                      ) : (
                        <Badge
                          variant="secondary"
                          className="text-[10px] font-normal px-1.5 py-0 h-5"
                        >
                          Ungrouped
                        </Badge>
                      )}
                      {b ? (
                        <Badge className="text-[10px] h-5 px-1.5 py-0 font-normal">
                          Billing on
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="text-[10px] h-5 px-1.5 py-0 font-normal text-muted-foreground"
                        >
                          Not billing
                        </Badge>
                      )}
                    </div>
                    <TaskTotals task={task} billing={b ?? null} />
                  </div>

                  <div className="flex shrink-0 items-start gap-2">
                    {!b ? (
                      <div className="grid w-full max-w-lg grid-cols-1 gap-3 sm:max-w-none sm:grid-cols-[minmax(6.5rem,8.5rem)_minmax(10.5rem,1fr)_auto] sm:items-end">
                        <div className="space-y-1.5">
                          <Label
                            htmlFor={`enroll-rate-${task.id}`}
                            className={ratesFieldLabelClass}
                          >
                            Hourly rate
                          </Label>
                          <Input
                            id={`enroll-rate-${task.id}`}
                            type="number"
                            min={0}
                            step={0.01}
                            inputMode="decimal"
                            className={cn(rateInputClass, "w-full")}
                            value={draftRate[task.id] ?? "50"}
                            onChange={(e) =>
                              setDraftRate((m) => ({
                                ...m,
                                [task.id]: e.target.value,
                              }))
                            }
                            placeholder="50"
                          />
                        </div>
                        <div className="min-w-0 space-y-1.5">
                          <Label
                            htmlFor={`enroll-cur-${task.id}`}
                            className={ratesFieldLabelClass}
                          >
                            Currency
                          </Label>
                          <CurrencySelect
                            id={`enroll-cur-${task.id}`}
                            value={
                              draftCurrency[task.id] ??
                              DEFAULT_BILLING_CURRENCY
                            }
                            onChange={(c) =>
                              setDraftCurrency((m) => ({
                                ...m,
                                [task.id]: c,
                              }))
                            }
                          />
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="h-10 w-full shrink-0 px-4 sm:w-auto"
                          disabled={enroll.isPending}
                          onClick={() => {
                            const raw = draftRate[task.id] ?? "50";
                            const n = Number.parseFloat(raw);
                            enroll.mutate({
                              taskId: task.id,
                              hourlyRate: Number.isFinite(n)
                                ? Math.max(0, n)
                                : 0,
                              currency:
                                draftCurrency[task.id] ??
                                DEFAULT_BILLING_CURRENCY,
                            });
                          }}
                        >
                          Add to billing
                        </Button>
                      </div>
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="text-destructive shrink-0"
                        title="Remove from billing"
                        disabled={remove.isPending}
                        onClick={() => {
                          if (
                            typeof window !== "undefined" &&
                            window.confirm(
                              "Remove this task from billing? Paid history stays linked to past sessions."
                            )
                          ) {
                            remove.mutate(b.id);
                          }
                        }}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>

                {b ? (
                  <div className={cn(billingSurface.inset, "space-y-3")}>
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Rate &amp; rules
                    </p>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="min-w-0 space-y-1.5">
                        <Label
                          htmlFor={`rate-edit-${b.id}`}
                          className={ratesFieldLabelClass}
                        >
                          Hourly rate
                        </Label>
                        <Input
                          id={`rate-edit-${b.id}`}
                          type="number"
                          min={0}
                          step={0.01}
                          inputMode="decimal"
                          className={cn(rateInputClass, "w-full")}
                          defaultValue={b.hourlyRate}
                          key={`rate-${b.id}-${b.hourlyRate}`}
                          onBlur={(e) => {
                            const n = Number.parseFloat(e.target.value);
                            if (!Number.isFinite(n) || n < 0) return;
                            if (n === b.hourlyRate) return;
                            patch.mutate({
                              id: b.id,
                              body: { hourlyRate: n },
                            });
                          }}
                        />
                      </div>
                      <div className="min-w-0 space-y-1.5">
                        <Label
                          htmlFor={`cur-${b.id}`}
                          className={ratesFieldLabelClass}
                        >
                          Currency
                        </Label>
                        <CurrencySelect
                          id={`cur-${b.id}`}
                          value={b.currency}
                          onChange={(c) => {
                            patch.mutate({
                              id: b.id,
                              body: { currency: c },
                            });
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          );
      })}
      {visibleTasks.length === 0 && (
        <p className="text-sm text-muted-foreground py-8 text-center">
          No visible tasks.
        </p>
      )}
      </div>
    </div>
  );
}

function TaskTotals({
  task,
  billing,
}: {
  task: {
    id: string;
    name: string;
    events: { id: string; from: string; to: string; name?: string }[];
  };
  billing: BillingTaskRow | null;
}) {
  const rawMin = useMemo(() => {
    let m = 0;
    for (const e of task.events) {
      m += Math.max(
        0,
        Math.floor(
          (new Date(e.to).getTime() - new Date(e.from).getTime()) / 60_000
        )
      );
    }
    return m;
  }, [task.events]);

  const estimated = useMemo(() => {
    if (!billing) return null;
    let earn = 0;
    for (const ev of task.events) {
      const row = eventToBillingSession(
        {
          id: ev.id,
          from: new Date(ev.from),
          to: new Date(ev.to),
          name: ev.name ?? "Time entry",
          taskId: task.id,
          paymentRecordId: null,
        },
        task.name,
        {
          hourlyRate: billing.hourlyRate,
          roundingMins: billing.roundingMins,
          currency: billing.currency,
        },
        null
      );
      earn += row.earnings;
    }
    return earn;
  }, [task.events, task.id, task.name, billing]);

  return (
    <p className="text-xs text-muted-foreground mt-1">
      Tracked {formatDurationMinutes(rawMin)}
      {billing && estimated != null && (
        <>
          {" "}
          · Est. {formatMoney(estimated, billing.currency)} at current rate
        </>
      )}
    </p>
  );
}
