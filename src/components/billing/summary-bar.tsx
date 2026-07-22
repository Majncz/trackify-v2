"use client";

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMoney } from "@/lib/format-money";

export type BillingSummaryResponse = {
  byCurrency: Record<
    string,
    {
      unpaidTotal: number;
      thisWeekTotal: number;
      thisMonthTotal: number;
      allTimeTotal: number;
      allTimePaidTotal: number;
    }
  >;
};

async function fetchSummary(): Promise<BillingSummaryResponse> {
  const res = await fetch("/api/billing/summary");
  if (!res.ok) {
    throw new Error("Failed to load billing summary");
  }
  return res.json();
}

export function SummaryBar() {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["billing-summary"],
    queryFn: fetchSummary,
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-24 rounded-lg" />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <p className="text-sm text-destructive">Could not load billing summary.</p>
    );
  }

  const entries = Object.entries(data.byCurrency).sort(([a], [b]) =>
    a.localeCompare(b)
  );

  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        Enroll tasks in billing to see earnings summary.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {entries.map(([currency, t]) => (
        <div
          key={currency}
          className="grid grid-cols-2 gap-2 sm:grid-cols-2 lg:grid-cols-4"
        >
          <Card className="border-primary/40 bg-primary/5">
            <CardContent className="p-3 pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                Unpaid ({currency})
              </p>
              <p className="text-lg font-semibold tabular-nums sm:text-xl">
                {formatMoney(t.unpaidTotal, currency)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                This week
              </p>
              <p className="text-lg font-semibold tabular-nums sm:text-xl">
                {formatMoney(t.thisWeekTotal, currency)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                This month
              </p>
              <p className="text-lg font-semibold tabular-nums sm:text-xl">
                {formatMoney(t.thisMonthTotal, currency)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                All time paid
              </p>
              <p className="text-lg font-semibold tabular-nums sm:text-xl">
                {formatMoney(t.allTimePaidTotal, currency)}
              </p>
            </CardContent>
          </Card>
        </div>
      ))}
    </div>
  );
}
