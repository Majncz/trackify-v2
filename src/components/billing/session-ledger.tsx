"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SessionRow } from "./session-row";
import { formatMoney, formatDurationMinutes } from "@/lib/format-money";
import type { BillingSessionRow } from "@/lib/billing";
import type { BillingGroupBy, BillingStatusFilter } from "./billing-filters";
import { ChevronDown, ChevronRight } from "lucide-react";

type SessionLedgerProps = {
  sessions: BillingSessionRow[];
  groupBy: BillingGroupBy;
  statusFilter: BillingStatusFilter;
  selectedIds: Set<string>;
  onToggleSelected: (id: string, next: boolean) => void;
  onSelectGroup: (ids: string[], select: boolean) => void;
  onSelectAllUnpaidInView: () => void;
  onMarkPaidClick: () => void;
};

function groupKeyFor(s: BillingSessionRow, groupBy: BillingGroupBy): string {
  if (groupBy === "week") return s.groupWeek;
  if (groupBy === "month") return s.groupMonth;
  return s.groupDay;
}

export function SessionLedger({
  sessions,
  groupBy,
  statusFilter,
  selectedIds,
  onToggleSelected,
  onSelectGroup,
  onSelectAllUnpaidInView,
  onMarkPaidClick,
}: SessionLedgerProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const groups = useMemo(() => {
    const map = new Map<
      string,
      { label: string; sessions: BillingSessionRow[] }
    >();
    const order: string[] = [];

    for (const s of sessions) {
      const key = groupKeyFor(s, groupBy);
      if (!map.has(key)) {
        map.set(key, { label: key, sessions: [] });
        order.push(key);
      }
      map.get(key)!.sessions.push(s);
    }

    return order.map((k) => {
      const g = map.get(k)!;
      const mins = g.sessions.reduce((a, x) => a + x.durationMinutes, 0);
      const unpaidEarnings = g.sessions.filter((x) => !x.isPaid);
      const currencies = Array.from(
        new Set(unpaidEarnings.map((x) => x.currency))
      );
      const earningsByCur = unpaidEarnings.reduce<Record<string, number>>(
        (acc, x) => {
          acc[x.currency] = (acc[x.currency] ?? 0) + x.earnings;
          return acc;
        },
        {}
      );
      return {
        key: k,
        label: k,
        sessions: g.sessions,
        totalMinutes: mins,
        earningsByCur,
        currencies,
        unpaidSelectableIds: g.sessions
          .filter((x) => !x.isPaid)
          .map((x) => x.id),
      };
    });
  }, [sessions, groupBy]);

  const selectedUnpaid = useMemo(
    () =>
      sessions.filter((s) => selectedIds.has(s.id) && !s.isPaid),
    [sessions, selectedIds]
  );

  const selectionTotals = useMemo(() => {
    const byCur = selectedUnpaid.reduce<Record<string, number>>((acc, s) => {
      acc[s.currency] = (acc[s.currency] ?? 0) + s.earnings;
      return acc;
    }, {});
    const mins = selectedUnpaid.reduce((a, s) => a + s.durationMinutes, 0);
    return { byCur, mins, count: selectedUnpaid.length };
  }, [selectedUnpaid]);

  const allSelectablePaidReady =
    selectionTotals.count > 0 &&
    Object.keys(selectionTotals.byCur).length === 1;

  const unpaidInView = useMemo(
    () => sessions.filter((s) => !s.isPaid).length,
    [sessions]
  );

  const paymentHint =
    statusFilter === "paid"
      ? "Switch payment status to Unpaid or All to select open amounts."
      : statusFilter === "unpaid"
        ? "Tap unpaid rows (or checkboxes), or Select all unpaid—one currency per batch."
        : "Click any unpaid row (or its checkbox) to select; paid rows are read-only.";

  if (sessions.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border/70 bg-muted/10 px-4 py-10 text-center">
        <p className="text-sm text-muted-foreground">
          No sessions in this range. Try another filter or enroll a task.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="sticky top-2 z-30 rounded-lg border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 shadow-sm px-3 py-3 sm:px-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-1 min-w-0">
            <p className="text-sm font-medium">Pay selected sessions</p>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {paymentHint}
            </p>
            {unpaidInView > 0 ? (
              <p className="text-xs text-muted-foreground tabular-nums pt-0.5">
                {unpaidInView} unpaid session{unpaidInView !== 1 ? "s" : ""} in
                this list.
              </p>
            ) : null}
          </div>
          {unpaidInView > 0 && statusFilter !== "paid" ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="shrink-0 w-full sm:w-auto"
              onClick={onSelectAllUnpaidInView}
            >
              Select all unpaid ({unpaidInView})
            </Button>
          ) : null}
        </div>
        <div className="mt-3 flex min-h-[5.75rem] flex-col gap-2 border-t border-border/60 pt-3 sm:min-h-[4.5rem] sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm min-w-0 flex-1">
            {selectionTotals.count > 0 ? (
              <>
                <span className="font-medium">{selectionTotals.count}</span>{" "}
                selected · {formatDurationMinutes(selectionTotals.mins)}
                <div className="mt-1 space-x-2">
                  {Object.entries(selectionTotals.byCur).map(([cur, amt]) => (
                    <span key={cur} className="font-semibold tabular-nums">
                      {formatMoney(amt, cur)}
                    </span>
                  ))}
                </div>
                {!allSelectablePaidReady ? (
                  <p className="text-xs text-destructive mt-1">
                    Selected sessions use more than one currency. Narrow the
                    selection (or filter by task) so one batch is a single
                    currency, then try again.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-xs text-muted-foreground leading-relaxed sm:text-sm">
                No sessions selected. Select unpaid rows or use &quot;Select
                all unpaid&quot; to mark a batch paid.
              </p>
            )}
          </div>
          <Button
            type="button"
            disabled={!allSelectablePaidReady}
            onClick={onMarkPaidClick}
            className="w-full sm:w-auto shrink-0"
          >
            Mark as paid…
          </Button>
        </div>
      </div>

      <div className="space-y-3">
        {groups.map((g) => {
          const collapsedThis = collapsed[g.key];
          const selInGroup = g.unpaidSelectableIds.filter((id) =>
            selectedIds.has(id)
          );
          const allInGroupSelected =
            g.unpaidSelectableIds.length > 0 &&
            selInGroup.length === g.unpaidSelectableIds.length;

          return (
            <div key={g.key} className="rounded-lg border overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 bg-muted/40 px-3 py-2">
                <button
                  type="button"
                  className="flex items-center gap-1 text-sm font-medium"
                  onClick={() =>
                    setCollapsed((c) => ({ ...c, [g.key]: !c[g.key] }))
                  }
                >
                  {collapsedThis ? (
                    <ChevronRight className="h-4 w-4" />
                  ) : (
                    <ChevronDown className="h-4 w-4" />
                  )}
                  {g.label}
                </button>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {formatDurationMinutes(g.totalMinutes)} total
                </span>
                {g.currencies.map((c) => (
                  <span
                    key={c}
                    className="text-xs font-medium tabular-nums text-muted-foreground"
                  >
                    {formatMoney(g.earningsByCur[c] ?? 0, c)} unpaid
                  </span>
                ))}
                <div className="ml-auto flex items-center gap-2">
                  <Checkbox
                    id={`grp-${g.key}`}
                    checked={allInGroupSelected}
                    disabled={g.unpaidSelectableIds.length === 0}
                    onCheckedChange={(v) =>
                      onSelectGroup(g.unpaidSelectableIds, Boolean(v))
                    }
                  />
                  <label
                    htmlFor={`grp-${g.key}`}
                    className="text-xs text-muted-foreground cursor-pointer select-none"
                  >
                    Select unpaid in group
                  </label>
                </div>
              </div>
              {!collapsedThis && (
                <div className="space-y-2 p-2">
                  {g.sessions.map((s) => (
                    <SessionRow
                      key={s.id}
                      session={s}
                      selected={selectedIds.has(s.id)}
                      onToggleSelected={onToggleSelected}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
