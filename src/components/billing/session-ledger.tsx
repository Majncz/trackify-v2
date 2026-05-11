"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { SessionRow } from "./session-row";
import { formatMoney, formatDurationMinutes } from "@/lib/format-money";
import type { BillingSessionRow } from "@/lib/billing";
import type { BillingGroupBy, BillingStatusFilter } from "./billing-filters";
import { ChevronDown, ChevronRight, HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { billingSurface } from "@/lib/billing-ui";

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
    () => sessions.filter((s) => selectedIds.has(s.id) && !s.isPaid),
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

  const allUnpaidInViewSelected = useMemo(() => {
    const unpaid = sessions.filter((s) => !s.isPaid);
    if (unpaid.length === 0) return false;
    return unpaid.every((s) => selectedIds.has(s.id));
  }, [sessions, selectedIds]);

  const paymentHintLong =
    statusFilter === "paid"
      ? "Switch status to Unpaid or All to select open amounts."
      : statusFilter === "unpaid"
        ? "Tap unpaid rows or checkboxes. Select all selects every unpaid row in this list (tap again to clear). Mark as paid: one currency per batch."
        : "Select unpaid rows only; paid rows are read-only. Mark as paid uses one currency per batch.";

  if (sessions.length === 0) {
    return (
      <div
        className={cn(
          "rounded-xl border-2 border-dashed border-border bg-muted/25 px-4 py-10 text-center shadow-inner"
        )}
      >
        <p className="text-sm text-muted-foreground">
          No sessions in this range. Try another filter or enroll a task.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div
        className={cn(
          billingSurface.toolbar,
          "sticky z-20 -mx-0.5 flex flex-col gap-2 px-2 py-2",
          "sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-x-3 sm:gap-y-1",
          "top-[calc(3.5rem+env(safe-area-inset-top,0px))]"
        )}
      >
        <div className="flex min-w-0 flex-1 items-start gap-1.5 sm:items-center">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="mt-0.5 shrink-0 rounded-md text-muted-foreground hover:text-foreground sm:mt-0"
                aria-label="How selection works"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </TooltipTrigger>
            <TooltipContent
              side="bottom"
              align="start"
              className="max-w-[min(18rem,calc(100vw-2rem))] text-xs leading-snug"
            >
              {paymentHintLong}
            </TooltipContent>
          </Tooltip>
          <div className="min-w-0 flex-1 text-xs leading-snug text-muted-foreground">
            {selectionTotals.count > 0 ? (
              <div className="text-foreground">
                <span className="font-semibold tabular-nums">
                  {selectionTotals.count}
                </span>
                <span className="text-muted-foreground"> · </span>
                <span className="tabular-nums">
                  {formatDurationMinutes(selectionTotals.mins)}
                </span>
                {Object.entries(selectionTotals.byCur).map(([cur, amt]) => (
                  <span key={cur} className="tabular-nums font-semibold">
                    <span className="text-muted-foreground"> · </span>
                    {formatMoney(amt, cur)}
                  </span>
                ))}
              </div>
            ) : statusFilter === "paid" ? (
              <span>Paid-only view — selection disabled.</span>
            ) : (
              <span>
                Nothing selected
                {unpaidInView > 0
                  ? ` · ${unpaidInView} unpaid in list`
                  : null}
                .
              </span>
            )}
            {!allSelectablePaidReady && selectionTotals.count > 0 ? (
              <p className="mt-1 text-[11px] text-destructive">
                Multiple currencies — narrow selection to one currency.
              </p>
            ) : null}
          </div>
        </div>
        <div className="flex shrink-0 items-center justify-end gap-2 sm:justify-start">
          {unpaidInView > 0 && statusFilter !== "paid" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 px-2.5 text-xs"
              onClick={onSelectAllUnpaidInView}
            >
              {allUnpaidInViewSelected ? "Clear all" : `All unpaid (${unpaidInView})`}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            className="h-8 px-3 text-xs"
            disabled={!allSelectablePaidReady}
            onClick={onMarkPaidClick}
          >
            Mark as paid…
          </Button>
        </div>
      </div>

      <div className="space-y-2 pt-1">
        {groups.map((g) => {
          const collapsedThis = collapsed[g.key];
          const selInGroup = g.unpaidSelectableIds.filter((id) =>
            selectedIds.has(id)
          );
          const allInGroupSelected =
            g.unpaidSelectableIds.length > 0 &&
            selInGroup.length === g.unpaidSelectableIds.length;

          return (
            <div key={g.key} className={billingSurface.section}>
              <div
                className={cn(
                  billingSurface.sectionHeader,
                  "flex flex-wrap items-center gap-2 px-2 py-1.5 sm:px-3"
                )}
              >
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
                    className="text-[11px] text-muted-foreground cursor-pointer select-none"
                  >
                    Group
                  </label>
                </div>
              </div>
              {!collapsedThis && (
                <div className="space-y-2 border-t-2 border-border bg-muted/20 p-2 sm:p-3">
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
