"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CurrencySelect } from "@/components/billing/currency-select";
import { billingSurface } from "@/lib/billing-ui";
import { eventToBillingSession } from "@/lib/billing";
import { formatMoney, formatDurationMinutes } from "@/lib/format-money";
import { DEFAULT_BILLING_CURRENCY } from "@/lib/billing-currencies";
import {
  resolveGroupAccent,
  taskAccentHex,
  groupAccentSoftBg,
} from "@/lib/group-accent";
import { cn } from "@/lib/utils";
import type { Task } from "@/hooks/use-tasks";
import { CircleDollarSign, ExternalLink, Trash2 } from "lucide-react";

type BillingTaskRow = {
  id: string;
  taskId: string;
  hourlyRate: number;
  currency: string;
  roundingMins: number;
};

async function fetchBillingTasks(): Promise<BillingTaskRow[]> {
  const res = await fetch("/api/billing/tasks");
  if (!res.ok) throw new Error("Failed to load billing settings");
  return res.json();
}

const fieldLabelClass =
  "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";

const rateInputClass = "h-10 tabular-nums bg-background shadow-sm";

export function TaskBillingPanel({ task }: { task: Task }) {
  const qc = useQueryClient();
  const { data: billingRows, isLoading, isError } = useQuery({
    queryKey: ["billing-tasks"],
    queryFn: fetchBillingTasks,
  });

  const billing = useMemo(
    () => (billingRows ?? []).find((b) => b.taskId === task.id) ?? null,
    [billingRows, task.id]
  );

  const accent = task.taskGroup
    ? resolveGroupAccent(task.taskGroup)
    : taskAccentHex(task.id);

  const [draftRate, setDraftRate] = useState("50");
  const [draftCurrency, setDraftCurrency] = useState(DEFAULT_BILLING_CURRENCY);

  const invalidate = useCallback(() => {
    qc.invalidateQueries({ queryKey: ["billing-tasks"] });
    qc.invalidateQueries({ queryKey: ["billing-summary"] });
    qc.invalidateQueries({ queryKey: ["billing-sessions"] });
  }, [qc]);

  const enroll = useMutation({
    mutationFn: async (vars: {
      hourlyRate: number;
      currency?: string;
    }) => {
      const res = await fetch("/api/billing/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: task.id,
          hourlyRate: vars.hourlyRate,
          currency: vars.currency ?? DEFAULT_BILLING_CURRENCY,
          roundingMins: 0,
        }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Could not add to billing");
      }
    },
    onSuccess: invalidate,
  });

  const patch = useMutation({
    mutationFn: async (vars: {
      id: string;
      body: { hourlyRate?: number; currency?: string };
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
        throw new Error(j.error || "Could not remove from billing");
      }
    },
    onSuccess: invalidate,
  });

  const trackedMinutes = useMemo(() => {
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

  const estimatedEarnings = useMemo(() => {
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
  }, [billing, task.events, task.id, task.name]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  if (isError) {
    return (
      <Card>
        <CardContent className="py-6 text-sm text-destructive">
          Could not load billing settings for this task.
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="border-l-[3px]"
      style={{
        borderLeftColor: accent,
        backgroundColor: groupAccentSoftBg(accent, billing ? 0.04 : 0.06),
      }}
    >
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <CardTitle className="flex items-center gap-2 text-base">
              <CircleDollarSign className="h-4 w-4 text-primary" />
              Billing &amp; rates
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm">
              Same settings as Billing → Rates. Changes apply to unpaid sessions
              on the Sessions tab.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 gap-1.5 text-xs text-muted-foreground"
            asChild
          >
            <Link href="/billing">
              Open Billing
              <ExternalLink className="h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          {task.taskGroup ? (
            <Badge
              variant="outline"
              className="border-0 text-[11px] font-normal"
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
              className="text-[11px] font-normal"
            >
              Ungrouped
            </Badge>
          )}
          {billing ? (
            <Badge className="text-[11px] font-normal">Billing on</Badge>
          ) : (
            <Badge
              variant="outline"
              className="text-[11px] font-normal text-muted-foreground"
            >
              Not billing
            </Badge>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="text-sm text-muted-foreground mb-1">Tracked time</p>
            <p className="text-lg font-semibold tabular-nums">
              {formatDurationMinutes(trackedMinutes)}
            </p>
          </div>
          <div>
            <p className="text-sm text-muted-foreground mb-1">
              Est. at current rate
            </p>
            <p className="text-lg font-semibold tabular-nums">
              {billing && estimatedEarnings != null
                ? formatMoney(estimatedEarnings, billing.currency)
                : "—"}
            </p>
          </div>
        </div>

        {!billing ? (
          <div className={cn(billingSurface.inset, "space-y-3")}>
            <p className="text-sm text-muted-foreground">
              Add an hourly rate to include this task in Billing sessions and
              payment history.
            </p>
            <div className="grid gap-3 sm:grid-cols-[minmax(6.5rem,8.5rem)_minmax(10.5rem,1fr)_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor={`task-enroll-rate-${task.id}`} className={fieldLabelClass}>
                  Hourly rate
                </Label>
                <Input
                  id={`task-enroll-rate-${task.id}`}
                  type="number"
                  min={0}
                  step={0.01}
                  inputMode="decimal"
                  className={cn(rateInputClass, "w-full")}
                  value={draftRate}
                  onChange={(e) => setDraftRate(e.target.value)}
                  placeholder="50"
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor={`task-enroll-cur-${task.id}`} className={fieldLabelClass}>
                  Currency
                </Label>
                <CurrencySelect
                  id={`task-enroll-cur-${task.id}`}
                  value={draftCurrency}
                  onChange={setDraftCurrency}
                />
              </div>
              <Button
                type="button"
                className="h-10 w-full shrink-0 px-4 sm:w-auto"
                disabled={enroll.isPending}
                onClick={() => {
                  const n = Number.parseFloat(draftRate);
                  enroll.mutate({
                    hourlyRate: Number.isFinite(n) ? Math.max(0, n) : 0,
                    currency: draftCurrency,
                  });
                }}
              >
                {enroll.isPending ? "Adding…" : "Add to billing"}
              </Button>
            </div>
            {enroll.isError ? (
              <p className="text-xs text-destructive" role="alert">
                {enroll.error instanceof Error
                  ? enroll.error.message
                  : "Could not add to billing"}
              </p>
            ) : null}
          </div>
        ) : (
          <div className={cn(billingSurface.inset, "space-y-3")}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className={fieldLabelClass}>Rate &amp; rules</p>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-destructive"
                title="Remove from billing"
                disabled={remove.isPending}
                onClick={() => {
                  if (
                    typeof window !== "undefined" &&
                    window.confirm(
                      "Remove this task from billing? Paid history stays linked to past sessions."
                    )
                  ) {
                    remove.mutate(billing.id);
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="min-w-0 space-y-1.5">
                <Label
                  htmlFor={`task-rate-edit-${billing.id}`}
                  className={fieldLabelClass}
                >
                  Hourly rate
                </Label>
                <Input
                  id={`task-rate-edit-${billing.id}`}
                  type="number"
                  min={0}
                  step={0.01}
                  inputMode="decimal"
                  className={cn(rateInputClass, "w-full")}
                  defaultValue={billing.hourlyRate}
                  key={`rate-${billing.id}-${billing.hourlyRate}`}
                  onBlur={(e) => {
                    const n = Number.parseFloat(e.target.value);
                    if (!Number.isFinite(n) || n < 0) return;
                    if (n === billing.hourlyRate) return;
                    patch.mutate({
                      id: billing.id,
                      body: { hourlyRate: n },
                    });
                  }}
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <Label
                  htmlFor={`task-cur-edit-${billing.id}`}
                  className={fieldLabelClass}
                >
                  Currency
                </Label>
                <CurrencySelect
                  id={`task-cur-edit-${billing.id}`}
                  value={billing.currency}
                  onChange={(c) => {
                    if (c === billing.currency) return;
                    patch.mutate({
                      id: billing.id,
                      body: { currency: c },
                    });
                  }}
                />
              </div>
            </div>
            {(patch.isError || remove.isError) && (
              <p className="text-xs text-destructive" role="alert">
                {(patch.error ?? remove.error) instanceof Error
                  ? ((patch.error ?? remove.error) as Error).message
                  : "Update failed"}
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
