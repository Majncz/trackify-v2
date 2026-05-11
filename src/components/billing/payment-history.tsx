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
import { billingSurface, BILLING_SESSION_ACCENT_WASH_ALPHA } from "@/lib/billing-ui";
import { cn } from "@/lib/utils";

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

function formatSessionWhen(fromIso: string, toIso: string): string {
  const from = new Date(fromIso);
  const to = new Date(toIso);
  const sameDay = format(from, "yyyy-MM-dd") === format(to, "yyyy-MM-dd");
  if (sameDay) {
    return `${format(from, "MMM d, yyyy")} · ${format(from, "HH:mm")}–${format(
      to,
      "HH:mm"
    )}`;
  }
  return `${format(from, "MMM d, yyyy HH:mm")} → ${format(
    to,
    "MMM d, yyyy HH:mm"
  )}`;
}

function PaymentSessionLine({
  taskName,
  groupName,
  sessionFrom,
  sessionTo,
  markedPaidAt,
  billedDurationMinutes,
  accent,
  trailing,
}: {
  taskName: string;
  groupName: string | null;
  sessionFrom: string;
  sessionTo: string;
  markedPaidAt: string;
  billedDurationMinutes: number;
  accent: string;
  trailing?: ReactNode;
}) {
  const sessionWhen = formatSessionWhen(sessionFrom, sessionTo);
  const paidWhen = format(new Date(markedPaidAt), "MMM d, yyyy · HH:mm");
  const durationLabel = formatDurationMinutes(billedDurationMinutes);

  const metaLineClass =
    "flex flex-wrap gap-x-1.5 gap-y-0.5 text-xs tabular-nums leading-snug";
  const labelClass = "shrink-0 font-medium text-muted-foreground";

  return (
    <div
      className={cn(
        "flex w-full min-w-0 flex-row flex-wrap items-start justify-between gap-x-3 gap-y-2 border-l-[3px] px-2.5 py-2",
        billingSurface.row({ interactive: false }),
        "text-sm"
      )}
      style={{
        borderLeftColor: accent,
        backgroundColor: groupAccentSoftBg(
          accent,
          BILLING_SESSION_ACCENT_WASH_ALPHA
        ),
      }}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-2 gap-y-1">
          <p className="text-sm font-medium leading-tight text-foreground">
            {taskName}
          </p>
          {groupName ? (
            <Badge
              variant="outline"
              className="text-[10px] font-normal px-1.5 py-0 h-5 border-0"
              style={{
                color: accent,
                backgroundColor: groupAccentSoftBg(accent, 0.18),
              }}
            >
              {groupName}
            </Badge>
          ) : null}
        </div>
        <div className="space-y-1 text-muted-foreground">
          <p className={metaLineClass}>
            <span className={labelClass}>Session</span>
            <span className="min-w-0 text-foreground/90">{sessionWhen}</span>
          </p>
          <p className={metaLineClass}>
            <span className={labelClass}>Marked paid</span>
            <span className="min-w-0 text-foreground/90">{paidWhen}</span>
          </p>
          <p className={metaLineClass}>
            <span className={labelClass}>Duration</span>
            <span className="min-w-0 text-foreground/90">{durationLabel}</span>
          </p>
        </div>
      </div>
      {trailing != null ? (
        <div className="shrink-0 self-start tabular-nums text-xs font-semibold sm:text-sm sm:pt-0.5">
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
      <div className="rounded-xl border-2 border-destructive/40 bg-destructive/5 px-4 py-6 text-sm text-destructive">
        Could not load payment history.
      </div>
    );
  }

  if (data.length === 0) {
    return (
      <div className="rounded-xl border-2 border-dashed border-border bg-muted/25 px-4 py-10 text-center text-sm text-muted-foreground shadow-inner">
        No payments recorded yet. Mark sessions as paid from the Ledger tab.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {data.map((p) => {
        const n = p.sessions.length;

        return (
          <div key={p.id} className={billingSurface.section}>
            <div className="flex flex-wrap items-start gap-3 p-3 sm:p-4">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-lg font-semibold tabular-nums tracking-tight">
                    {formatMoney(p.totalAmount, p.currency)}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {format(new Date(p.paidAt), "MMM d, yyyy · HH:mm")}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <Badge variant="secondary" className="font-normal">
                    {n} session{n !== 1 ? "s" : ""}
                  </Badge>
                  <span className="tabular-nums">
                    {formatDurationMinutes(p.totalMinutes)}
                  </span>
                </div>
                {p.note ? (
                  <p className="text-xs text-muted-foreground pt-0.5 border-t-2 border-border mt-2">
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

            <div className="space-y-2 border-t-2 border-border bg-muted/20 px-3 pb-3 pt-3 sm:px-4">
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
                      sessionFrom={s.from}
                      sessionTo={s.to}
                      markedPaidAt={s.paymentPaidAt ?? p.paidAt}
                      billedDurationMinutes={s.durationMinutes}
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
