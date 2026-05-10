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
  minSessionMins: number;
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

const ROUNDING = [
  { value: 0, label: "None (exact minutes)" },
  { value: 15, label: "15 min" },
  { value: 30, label: "30 min" },
  { value: 60, label: "1 hour" },
] as const;

function rateRowStripeAccent(task: Task): string {
  return task.taskGroup
    ? resolveGroupAccent(task.taskGroup)
    : taskAccentHex(task.id);
}

const selectClass = cn(
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors",
  "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
);

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
          minSessionMins: 0,
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
        minSessionMins?: number;
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

  const visibleTasks = useMemo(
    () =>
      tasks.filter((t: Task) => !t.hidden).sort((a: Task, b: Task) => a.name.localeCompare(b.name)),
    [tasks]
  );

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
      <div className="rounded-lg border border-dashed border-border/70 bg-muted/15 px-3 py-2.5 text-sm text-muted-foreground leading-relaxed">
        <span className="font-medium text-foreground">How this list works.</span>{" "}
        The left edge uses your{" "}
        <span className="text-foreground">group color</span> when the task is in
        a group, or a stable{" "}
        <span className="text-foreground">task color</span> when it is
        ungrouped—matching Sessions. Badges spell out group vs ungrouped
        explicitly.
      </div>
      <div className="space-y-3">
      {visibleTasks.map((task: Task) => {
          const b = byTaskId.get(task.id);
          const stripe = rateRowStripeAccent(task);

          return (
            <div
              key={task.id}
              className="rounded-lg border border-border/70 bg-card text-card-foreground overflow-hidden shadow-sm"
              style={{
                borderLeftWidth: 3,
                borderLeftColor: stripe,
                backgroundColor: groupAccentSoftBg(stripe, 0.06),
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
                      <div className="flex flex-wrap items-end justify-end gap-2 sm:gap-3">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">
                            Hourly rate
                          </Label>
                          <Input
                            type="number"
                            min={0}
                            step={0.01}
                            className="w-28 h-9"
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
                        <div className="space-y-1 min-w-[11rem]">
                          <Label className="text-xs text-muted-foreground">
                            Currency
                          </Label>
                          <CurrencySelect
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
                          size="sm"
                          className="mt-5 sm:mt-0 sm:self-end"
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
                  <div className="rounded-md border border-border/60 bg-background/90 p-3 shadow-sm space-y-3">
                    <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                      Rate &amp; rules
                    </p>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <Label className="text-xs">Hourly rate</Label>
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
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
                      <div className="space-y-1">
                        <Label htmlFor={`cur-${b.id}`} className="text-xs">
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
                      <div className="space-y-1">
                        <Label className="text-xs">Round duration to</Label>
                        <select
                          className={selectClass}
                          defaultValue={String(b.roundingMins)}
                          key={`rnd-${b.id}-${b.roundingMins}`}
                          onChange={(e) => {
                            patch.mutate({
                              id: b.id,
                              body: {
                                roundingMins: Number(e.target.value),
                              },
                            });
                          }}
                        >
                          {ROUNDING.map((r) => (
                            <option key={r.value} value={r.value}>
                              {r.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">
                          Ignore sessions under (minutes)
                        </Label>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          defaultValue={b.minSessionMins}
                          key={`min-${b.id}-${b.minSessionMins}`}
                          onBlur={(e) => {
                            const n = Number.parseInt(e.target.value, 10);
                            if (!Number.isFinite(n) || n < 0) return;
                            if (n === b.minSessionMins) return;
                            patch.mutate({
                              id: b.id,
                              body: { minSessionMins: n },
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
          minSessionMins: billing.minSessionMins,
          currency: billing.currency,
        },
        null
      );
      if (row) earn += row.earnings;
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
