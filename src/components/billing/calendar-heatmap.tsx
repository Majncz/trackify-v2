"use client";

import { useMemo, useRef, useCallback } from "react";
import { format } from "date-fns";
import type { BillingSessionRow } from "@/lib/billing";
import { buildYearlyContributionFromBillingSessions } from "@/lib/yearly-contribution-data";
import { YearlyContributionCalendar } from "@/components/stats/yearly-contribution-calendar";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { formatHeatMinutes } from "@/lib/format-heat-minutes";
import { formatMoney } from "@/lib/format-money";
import { resolveGroupAccent, taskAccentHex } from "@/lib/group-accent";
import { ChevronLeft, ChevronRight } from "lucide-react";

const OTHER_COLOR = "#6b7280";

function taskColorsFromSessions(sessions: BillingSessionRow[]) {
  const nameToFirst = new Map<string, BillingSessionRow>();
  for (const s of sessions) {
    if (!nameToFirst.has(s.taskName)) nameToFirst.set(s.taskName, s);
  }
  const m: Record<string, string> = {};
  for (const [name, s] of Array.from(nameToFirst.entries())) {
    m[name] = s.taskGroup
      ? resolveGroupAccent(s.taskGroup)
      : taskAccentHex(s.taskId);
  }
  return m;
}

type BillingContributionHeatmapProps = {
  sessions: BillingSessionRow[];
  /** Last calendar day included in the ledger filter (omit for All time → ends today). */
  calendarEndDay?: Date;
  isLoading?: boolean;
  onDayClick: (localDayKey: string) => void;
  onManageTasks?: () => void;
};

export function BillingContributionHeatmap({
  sessions,
  calendarEndDay,
  isLoading,
  onDayClick,
  onManageTasks,
}: BillingContributionHeatmapProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const yearlyData = useMemo(
    () =>
      buildYearlyContributionFromBillingSessions(sessions, {
        calendarEndDay,
      }),
    [sessions, calendarEndDay]
  );
  const taskColors = useMemo(
    () => taskColorsFromSessions(sessions),
    [sessions]
  );

  const yearlyTooltip = useCallback(
    ({
      day,
      minutes,
      dayKey,
      taskMinutes,
    }: {
      day: Date;
      minutes: number;
      dayKey: string;
      taskMinutes: Record<string, number>;
    }) => {
      const earn = yearlyData.billingDayEarnings?.get(dayKey) ?? 0;
      const cur = yearlyData.billingDayCurrency?.get(dayKey) ?? "CZK";
      const dateStr = format(day, "EEEE, MMMM d, yyyy");
      const entries = Object.entries(taskMinutes).sort((a, b) => b[1] - a[1]);

      return (
        <div className="space-y-2 max-w-[260px] text-left">
          <div>
            <p className="text-sm font-semibold leading-tight">{dateStr}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Billable time (same filters as the ledger)
            </p>
          </div>
          <div className="border-t border-border pt-2 space-y-1.5">
            <p className="text-xs font-medium text-foreground">
              {formatHeatMinutes(minutes)} · {formatMoney(earn, cur)}
            </p>
            {entries.length > 0 && (
              <ul className="space-y-1">
                {entries.map(([name, mins]) => (
                  <li key={name} className="flex items-start gap-2 text-xs">
                    <span
                      className="mt-1 h-2 w-2 shrink-0 rounded-[2px]"
                      style={{
                        backgroundColor: taskColors[name] ?? OTHER_COLOR,
                      }}
                    />
                    <span className="min-w-0 leading-snug">
                      <span className="font-medium text-foreground">{name}</span>
                      <span className="text-muted-foreground">
                        {" "}
                        · {formatHeatMinutes(mins)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground">
            Click to filter the ledger to this day
          </p>
        </div>
      );
    },
    [yearlyData, taskColors]
  );

  if (isLoading) {
    return (
    <Card className="w-full border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Billable activity</CardTitle>
        <CardDescription>Loading…</CardDescription>
      </CardHeader>
        <CardContent>
          <Skeleton className="h-52 w-full rounded-md" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full border-dashed">
      <CardHeader className="flex flex-col gap-3 space-y-0 sm:flex-row sm:items-center sm:justify-between pb-2">
        <div className="space-y-1">
          <CardTitle className="text-base">Billable activity</CardTitle>
          <CardDescription>
            Yearly heatmap like the home dashboard—scoped by your filters. Click
            a day to jump the list there.
            {calendarEndDay
              ? ` Shown through ${format(calendarEndDay, "MMM d, yyyy")}.`
              : " Through today for All time."}
          </CardDescription>
        </div>
        {onManageTasks ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="shrink-0 w-full sm:w-auto"
            onClick={onManageTasks}
          >
            Set up billable tasks
          </Button>
        ) : null}
      </CardHeader>
      <CardContent className="pt-0 space-y-2">
        <div className="flex items-center justify-between mb-1">
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() =>
              scrollRef.current?.scrollBy({ left: -120, behavior: "smooth" })
            }
            aria-label="Scroll calendar left"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">Yearly Calendar</span>
          <Button
            variant="ghost"
            size="sm"
            type="button"
            onClick={() =>
              scrollRef.current?.scrollBy({ left: 120, behavior: "smooth" })
            }
            aria-label="Scroll calendar right"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <YearlyContributionCalendar
          data={yearlyData}
          scrollRef={scrollRef}
          taskColors={taskColors}
          renderTooltip={yearlyTooltip}
          onDayClick={(dayKey) => onDayClick(dayKey)}
        />
      </CardContent>
    </Card>
  );
}

export const CalendarHeatmap = BillingContributionHeatmap;
