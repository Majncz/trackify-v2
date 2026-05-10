"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney, formatDurationMinutes } from "@/lib/format-money";
import type { BillingSessionRow } from "@/lib/billing";
import {
  resolveGroupAccent,
  taskAccentHex,
  groupAccentSoftBg,
} from "@/lib/group-accent";

type PaymentListItem = {
  id: string;
  paidAt: string;
  note: string | null;
  totalAmount: number;
  totalMinutes: number;
  currency: string;
  createdAt: string;
  sessions: BillingSessionRow[];
};

function PaymentSessionLine({
  taskName,
  groupName,
  subtitle,
  accent,
  trailing,
}: {
  taskName: string;
  groupName: string | null;
  subtitle: string;
  accent: string;
  trailing?: ReactNode;
}) {
  return (
    <div
      className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 rounded-md bg-muted/20 px-2.5 py-1.5 text-sm border-l-[3px] border-solid"
      style={{
        borderLeftColor: accent,
        backgroundColor: groupAccentSoftBg(accent, 0.08),
      }}
    >
      <div className="min-w-0 flex-1">
        <p className="font-medium leading-tight">
          {taskName}
          {groupName ? (
            <>
              <span className="font-normal text-muted-foreground"> · </span>
              <span className="font-medium text-muted-foreground">
                {groupName}
              </span>
            </>
          ) : null}
        </p>
        <p className="text-xs text-muted-foreground tabular-nums">{subtitle}</p>
      </div>
      {trailing != null ? (
        <div className="shrink-0 tabular-nums text-xs font-semibold sm:text-sm">
          {trailing}
        </div>
      ) : null}
    </div>
  );
}

async function fetchPayments(): Promise<PaymentListItem[]> {
  const res = await fetch("/api/billing/payments");
  if (!res.ok) throw new Error("Failed to load payments");
  const raw: PaymentListItem[] = await res.json();
  return raw.map((r) => ({
    ...r,
    sessions: r.sessions ?? [],
  }));
}

export function PaymentHistory() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["billing-payments"],
    queryFn: fetchPayments,
  });

  const reopen = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/billing/payments/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Failed to reopen");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["billing-payments"] });
      qc.invalidateQueries({ queryKey: ["billing-sessions"] });
      qc.invalidateQueries({ queryKey: ["billing-summary"] });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-6 text-sm text-destructive">
        Could not load payment history.
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/10 px-4 py-10 text-center text-sm text-muted-foreground">
        No payments recorded yet. Mark sessions as paid from the Ledger tab.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((p) => {
        const n = p.sessions.length;

        return (
          <div
            key={p.id}
            className="rounded-lg border overflow-hidden bg-card shadow-sm"
          >
            <div className="flex flex-wrap items-start gap-3 p-3 sm:p-4">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-lg font-semibold tabular-nums tracking-tight">
                    {formatMoney(p.totalAmount, p.currency)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {format(new Date(p.paidAt), "MMM d, yyyy")}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="font-normal">
                    {n} session{n !== 1 ? "s" : ""}
                  </Badge>
                  <span className="tabular-nums">
                    {formatDurationMinutes(p.totalMinutes)} billable
                  </span>
                </div>
                {p.note ? (
                  <p className="text-xs text-muted-foreground pt-0.5 border-t border-border/50 mt-2">
                    {p.note}
                  </p>
                ) : null}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0 h-9 w-9 text-destructive"
                title="Reopen payment"
                disabled={reopen.isPending}
                onClick={() => {
                  if (
                    typeof window !== "undefined" &&
                    window.confirm(
                      "Reopen this payment? Sessions will become unpaid again."
                    )
                  ) {
                    reopen.mutate(p.id);
                  }
                }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            <div className="border-t border-border/60 px-3 pb-3 pt-2 sm:px-4 space-y-1.5">
              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground mb-2">
                Sessions in this payment
              </p>
              {n === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No line items could be computed for this payment (e.g. billing
                  settings changed). Totals above still reflect what was paid.
                </p>
              ) : (
                p.sessions.map((s) => {
                  const accent = s.taskGroup
                    ? resolveGroupAccent(s.taskGroup)
                    : taskAccentHex(s.taskId);
                  return (
                    <PaymentSessionLine
                      key={s.id}
                      taskName={s.taskName}
                      groupName={s.taskGroup?.name ?? null}
                      subtitle={`${format(new Date(s.from), "MMM d · HH:mm")} · ${formatDurationMinutes(s.durationMinutes)}`}
                      accent={accent}
                      trailing={formatMoney(s.earnings, s.currency)}
                    />
                  );
                })
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
