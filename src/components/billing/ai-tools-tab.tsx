"use client";

import { useCallback, useEffect, useState } from "react";
import { endOfDay, format, startOfDay } from "date-fns";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { CurrencySelect } from "@/components/billing/currency-select";
import { billingSurface } from "@/lib/billing-ui";
import { formatMoney } from "@/lib/format-money";
import { DEFAULT_BILLING_CURRENCY } from "@/lib/billing-currencies";
import {
  AI_BILLING_KIND_PURCHASE,
  AI_BILLING_KIND_RECURRING_MONTHLY,
  normalizeAiBillingKind,
  type AiBillingKindValue,
} from "@/lib/ai-subscription-metrics";
import {
  AI_BILLING_CADENCE_DEFAULT,
  AI_BILLING_CADENCE_VALUES,
  aiBillingCadenceLabel,
  coveragePeriodEndYmd,
  normalizeAiBillingCadence,
  type AiBillingCadenceValue,
} from "@/lib/ai-subscription-cadence";
import {
  FormSelect,
  FORM_SELECT_NONE,
  SelectSingleScope,
  type FormSelectOption,
} from "@/components/ui/form-select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CalendarDays,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Pencil,
  Plus,
  Receipt,
  Trash2,
} from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Cell,
} from "recharts";

type AiPreset = {
  id: string;
  name: string;
  providerKey: string | null;
  isBuiltIn: boolean;
  sortOrder: number;
};

type PeriodMetrics = {
  tasksWithTrackedTime: number;
  trackedHours: number;
  eventsInWindow: number;
  durationDays: number;
  isActive: boolean;
};

type EnrichedPeriod = {
  id: string;
  name: string;
  price: number;
  currency: string;
  startsAt: string;
  endsAt: string | null;
  depletedAt: string | null;
  billingKind: string;
  billingCadence?: string;
  billingEmail: string | null;
  billingProviderUrl: string | null;
  note: string | null;
  presetId: string | null;
  priceApproxCzk: number | null;
  metrics: PeriodMetrics;
  paidEarningsByCurrency: Record<string, number>;
};

type AnalyticsResponse = {
  viewCurrency: string;
  fxMissingCurrencies: string[];
  summary: {
    lifetimeSpendInView: number;
    currentMonthOverlapSpendInView: number;
    activeSubscriptions: number;
    periodCount: number;
  };
  cumulativeByMonth: { month: string; totalInView: number }[];
  spendByMonth: { month: string; totalInView: number }[];
  rankings: {
    mostTrackedHours: { id: string; name: string; trackedHours: number }[];
  };
  periods: EnrichedPeriod[];
};

async function fetchAnalytics(viewCurrency: string): Promise<AnalyticsResponse> {
  const p = new URLSearchParams({ viewCurrency });
  const res = await fetch(`/api/ai-subscriptions/analytics?${p}`);
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || "Failed to load AI analytics");
  }
  return res.json();
}

async function fetchPresets(): Promise<AiPreset[]> {
  const res = await fetch("/api/ai-subscriptions/presets");
  if (!res.ok) throw new Error("Failed to load presets");
  return res.json();
}

const recurringBillingCycleOptions: FormSelectOption[] =
  AI_BILLING_CADENCE_VALUES.map((v) => ({
    value: v,
    label: aiBillingCadenceLabel(v),
  }));

function isoToLocalDateString(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return format(new Date(), "yyyy-MM-dd");
  }
  return format(d, "yyyy-MM-dd");
}

type PeriodState = "running" | "depleted" | "ended";

function getPeriodState(p: EnrichedPeriod): PeriodState {
  if (p.depletedAt) return "depleted";
  if (p.metrics.isActive) return "running";
  return "ended";
}

const PERIOD_STATE_STYLES: Record<
  PeriodState,
  { cardBorder: string; badge: string; badgeLabel: string }
> = {
  running: {
    cardBorder: "border-l-[3px] border-l-green-500",
    badge:
      "border-green-600/40 bg-green-500/10 text-green-800 dark:text-green-300",
    badgeLabel: "Running",
  },
  depleted: {
    cardBorder: "border-l-[3px] border-l-amber-500",
    badge:
      "border-amber-600/50 bg-amber-500/10 text-amber-900 dark:text-amber-200",
    badgeLabel: "Depleted",
  },
  ended: {
    cardBorder: "border-l-[3px] border-l-border",
    badge: "border-border text-muted-foreground",
    badgeLabel: "Ended",
  },
};

function providerUrlLinkLabel(raw: string): string {
  try {
    const u = new URL(raw);
    return u.hostname.replace(/^www\./i, "") || raw;
  } catch {
    return "Open link";
  }
}

function deriveHasEndDate(editing: EnrichedPeriod): boolean {
  return (
    normalizeAiBillingKind(editing.billingKind) ===
      AI_BILLING_KIND_RECURRING_MONTHLY && Boolean(editing.endsAt)
  );
}

function derivePurchaseUsesComputedEnd(editing: EnrichedPeriod): boolean {
  if (
    normalizeAiBillingKind(editing.billingKind) !== AI_BILLING_KIND_PURCHASE
  ) {
    return true;
  }
  if (!editing.endsAt) return true;
  const cadence = normalizeAiBillingCadence(editing.billingCadence);
  const startYmd = isoToLocalDateString(editing.startsAt);
  const computedEnd = coveragePeriodEndYmd(startYmd, cadence);
  const storedEnd = isoToLocalDateString(editing.endsAt);
  return storedEnd === computedEnd;
}

/** Parse `yyyy-MM-dd` as a calendar date in local time (no UTC shift). */
function parseLocalYmd(dateStr: string): Date | null {
  const trimmed = dateStr.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  if (
    dt.getFullYear() !== y ||
    dt.getMonth() !== mo - 1 ||
    dt.getDate() !== d
  ) {
    return null;
  }
  return dt;
}

function localYmdToStartOfDay(dateStr: string): Date {
  const dt = parseLocalYmd(dateStr);
  if (!dt) return new Date(NaN);
  return startOfDay(dt);
}

function localYmdToEndOfDay(dateStr: string): Date {
  const dt = parseLocalYmd(dateStr);
  if (!dt) return new Date(NaN);
  return endOfDay(dt);
}

/** Latest instant credits were usable (min of now, calendar end, token depletion). */
function usageWindowEndLabel(
  endsAt: string | null,
  depletedAt: string | null
): string {
  const now = Date.now();
  let t = now;
  if (endsAt) t = Math.min(t, new Date(endsAt).getTime());
  if (depletedAt) t = Math.min(t, new Date(depletedAt).getTime());
  return new Date(t).toLocaleDateString();
}

export function AiToolsTab() {
  const qc = useQueryClient();
  const [viewCurrency, setViewCurrency] = useState(DEFAULT_BILLING_CURRENCY);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EnrichedPeriod | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(false);
  const [chartView, setChartView] = useState<"cumulative" | "monthly">("monthly");

  const analyticsQuery = useQuery({
    queryKey: ["ai-subscriptions-analytics", viewCurrency],
    queryFn: () => fetchAnalytics(viewCurrency),
  });

  const presetsQuery = useQuery({
    queryKey: ["ai-subscriptions-presets"],
    queryFn: fetchPresets,
  });

  const deletePeriod = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/ai-subscriptions/periods/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Could not delete");
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-subscriptions-analytics"] });
      qc.invalidateQueries({ queryKey: ["ai-subscriptions-periods-list"] });
      setDeleteId(null);
    },
  });

  const patchPeriod = useMutation({
    mutationFn: async (args: { id: string; body: Record<string, unknown> }) => {
      const res = await fetch(`/api/ai-subscriptions/periods/${args.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(args.body),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Could not update entry");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-subscriptions-analytics"] });
      qc.invalidateQueries({ queryKey: ["ai-subscriptions-periods-list"] });
    },
  });

  const chartPreventFocusSteal = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const t = e.target as HTMLElement;
      if (t.closest(".recharts-tooltip-wrapper")) return;
      if (t instanceof SVGElement || t.closest("svg.recharts-surface")) {
        e.preventDefault();
      }
    },
    []
  );

  const data = analyticsQuery.data;
  const periods = data?.periods ?? [];
  const activePeriods = periods.filter((p) => p.metrics.isActive);
  const pastPeriods = periods.filter((p) => !p.metrics.isActive);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <h2
            id="billing-tab-ai-label"
            className="text-base font-semibold tracking-tight"
          >
            AI billing
          </h2>
          <p className="text-sm text-muted-foreground max-w-prose">
            Each row is a budget line — lifetime totals add up simply (100 + 150 = 250). Timer
            overlap is split automatically when billing windows overlap: the earliest-start row
            wins each slice. Active days counts whole calendar days from the row start through
            today, the end date, or depletion — whichever comes first.{" "}
            Use <strong className="font-medium text-foreground">Mark depleted</strong> to cap
            the window when credits run out before the calendar end.
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-end gap-3 sm:justify-end">
          <div className="w-full min-w-0 space-y-1 sm:w-56">
            <Label htmlFor="ai-view-currency">View totals in</Label>
            <CurrencySelect
              id="ai-view-currency"
              value={viewCurrency}
              onChange={setViewCurrency}
            />
          </div>
          <Button
            type="button"
            onClick={() => {
              setEditing(null);
              setDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4 mr-2" />
            Add AI billing
          </Button>
        </div>
      </div>

      {data?.fxMissingCurrencies && data.fxMissingCurrencies.length > 0 ? (
        <Alert variant="default" className="border-amber-500/50 bg-amber-500/10">
          <AlertTitle>Exchange rate unavailable</AlertTitle>
          <AlertDescription>
            Could not load rates for: {data.fxMissingCurrencies.join(", ")}.
            Lifetime and chart totals in {viewCurrency} may be incomplete; native
            prices on each card are still shown.
          </AlertDescription>
        </Alert>
      ) : null}

      {analyticsQuery.isLoading ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-24 rounded-lg" />
          ))}
        </div>
      ) : analyticsQuery.isError ? (
        <p className="text-sm text-destructive">
          {(analyticsQuery.error as Error).message}
        </p>
      ) : data ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Card className="border-primary/40 bg-primary/5">
            <CardContent className="p-3 pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                Lifetime AI billing ({data.viewCurrency})
              </p>
              <p className="text-lg font-semibold tabular-nums sm:text-xl">
                {formatMoney(data.summary.lifetimeSpendInView, data.viewCurrency)}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                Overlap this month ({data.viewCurrency})
              </p>
              <p className="text-lg font-semibold tabular-nums sm:text-xl">
                {formatMoney(
                  data.summary.currentMonthOverlapSpendInView,
                  data.viewCurrency
                )}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                Active entries
              </p>
              <p className="text-lg font-semibold tabular-nums sm:text-xl">
                {data.summary.activeSubscriptions}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                Total entries
              </p>
              <p className="text-lg font-semibold tabular-nums sm:text-xl">
                {data.summary.periodCount}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {data && data.cumulativeByMonth.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <CardTitle className="text-base">
                  {chartView === "monthly" ? "Spend per month" : "Cumulative spend"}
                </CardTitle>
                <CardDescription>
                  {chartView === "monthly"
                    ? `Monthly AI billing total in ${data.viewCurrency}`
                    : `Running total in ${data.viewCurrency} over time`}
                </CardDescription>
              </div>
              <div className="flex rounded-md border border-border overflow-hidden text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setChartView("monthly")}
                  className={cn(
                    "px-3 py-1.5 transition-colors",
                    chartView === "monthly"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setChartView("cumulative")}
                  className={cn(
                    "px-3 py-1.5 transition-colors border-l border-border",
                    chartView === "cumulative"
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                  )}
                >
                  Cumulative
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div
              className="recharts-no-focus-ring rounded-lg border border-border/60 bg-muted/20 p-2 h-[220px]"
              onMouseDown={chartPreventFocusSteal}
            >
              <ResponsiveContainer width="100%" height="100%">
                {chartView === "monthly" ? (
                  <BarChart data={data.spendByMonth} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={48} />
                    <Tooltip
                      formatter={(v) => [formatMoney(Number(v), data.viewCurrency), "Spend"]}
                      cursor={{ fill: "hsl(var(--muted))", opacity: 0.5 }}
                    />
                    <Bar dataKey="totalInView" radius={[3, 3, 0, 0]}>
                      {data.spendByMonth.map((entry, i) => {
                        const isCurrentMonth =
                          entry.month === format(new Date(), "yyyy-MM");
                        return (
                          <Cell
                            key={i}
                            fill={
                              isCurrentMonth
                                ? "hsl(var(--primary))"
                                : "hsl(var(--primary) / 0.45)"
                            }
                          />
                        );
                      })}
                    </Bar>
                  </BarChart>
                ) : (
                  <LineChart data={data.cumulativeByMonth}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} width={48} />
                    <Tooltip
                      formatter={(v) => [formatMoney(Number(v), data.viewCurrency), "Total"]}
                    />
                    <Line
                      type="monotone"
                      dataKey="totalInView"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={false}
                    />
                  </LineChart>
                )}
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {data && data.rankings.mostTrackedHours.length > 0 ? (
        <div className="max-w-xl">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Most tracked hours credited</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {data.rankings.mostTrackedHours.map((r) => (
                  <li
                    key={r.id}
                    className="flex justify-between gap-2 border-b border-border/50 pb-2 last:border-0"
                  >
                    <span className="truncate">{r.name}</span>
                    <span className="tabular-nums shrink-0">
                      {r.trackedHours}h
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Entries</h3>
        {patchPeriod.isError ? (
          <p className="text-sm text-destructive">
            {(patchPeriod.error as Error).message}
          </p>
        ) : null}
        {analyticsQuery.isLoading ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : periods.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No AI billing entries yet. Use Add AI billing to start tracking.
            </CardContent>
          </Card>
        ) : (
          <>
            {activePeriods.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active entries.</p>
            ) : (
              <ul className="space-y-3">
                {activePeriods.map((p) => (
                  <li key={p.id}>
                    <PeriodCard
                      p={p}
                      viewCurrency={viewCurrency}
                      patchPending={patchPeriod.isPending}
                      onPatch={(body) => patchPeriod.mutate({ id: p.id, body })}
                      onEdit={() => { setEditing(p); setDialogOpen(true); }}
                      onDelete={() => setDeleteId(p.id)}
                    />
                  </li>
                ))}
              </ul>
            )}

            {pastPeriods.length > 0 ? (
              <div className="space-y-2">
                <button
                  type="button"
                  onClick={() => setShowPast((s) => !s)}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPast ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  Past entries ({pastPeriods.length})
                </button>
                {showPast ? (
                  <ul className="space-y-3">
                    {pastPeriods.map((p) => (
                      <li key={p.id}>
                        <PeriodCard
                          p={p}
                          viewCurrency={viewCurrency}
                          patchPending={patchPeriod.isPending}
                          onPatch={(body) => patchPeriod.mutate({ id: p.id, body })}
                          onEdit={() => { setEditing(p); setDialogOpen(true); }}
                          onDelete={() => setDeleteId(p.id)}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </div>

      <PeriodFormDialog
        open={dialogOpen}
        onOpenChange={(o) => {
          setDialogOpen(o);
          if (!o) setEditing(null);
        }}
        presets={presetsQuery.data ?? []}
        editing={editing}
        onSaved={() => {
          qc.invalidateQueries({ queryKey: ["ai-subscriptions-analytics"] });
          qc.invalidateQueries({ queryKey: ["ai-subscriptions-presets"] });
          qc.invalidateQueries({ queryKey: ["ai-subscriptions-periods-list"] });
        }}
      />

      <Dialog open={Boolean(deleteId)} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this AI billing entry?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This removes only the billing line and analytics tied to it. Cannot be undone.
          </p>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button type="button" variant="outline" onClick={() => setDeleteId(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deletePeriod.isPending}
              onClick={() => deleteId && deletePeriod.mutate(deleteId)}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type PeriodCardProps = {
  p: EnrichedPeriod;
  viewCurrency: string;
  patchPending: boolean;
  onPatch: (body: Record<string, unknown>) => void;
  onEdit: () => void;
  onDelete: () => void;
};

function PeriodCard({
  p,
  viewCurrency,
  patchPending,
  onPatch,
  onEdit,
  onDelete,
}: PeriodCardProps) {
  const state = getPeriodState(p);
  const stateStyle = PERIOD_STATE_STYLES[state];

  return (
    <Card className={cn("overflow-hidden", stateStyle.cardBorder)}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            <CardTitle className="text-base flex flex-wrap items-center gap-2">
              <span className="truncate">{p.name}</span>
              <Badge variant="outline" className={stateStyle.badge}>
                {stateStyle.badgeLabel}
              </Badge>
              <Badge variant="outline" className="text-muted-foreground">
                {aiBillingCadenceLabel(normalizeAiBillingCadence(p.billingCadence))}
              </Badge>
            </CardTitle>
            <CardDescription className="text-xs space-y-0.5">
              <div>
                {new Date(p.startsAt).toLocaleDateString()} →{" "}
                {p.endsAt
                  ? new Date(p.endsAt).toLocaleDateString()
                  : "open-ended"}
              </div>
              {p.depletedAt ? (
                <div className="text-amber-900/80 dark:text-amber-200/80">
                  Depleted {new Date(p.depletedAt).toLocaleDateString()}
                </div>
              ) : (
                <div>
                  Window closes:{" "}
                  {usageWindowEndLabel(p.endsAt, p.depletedAt)}
                </div>
              )}
            </CardDescription>
          </div>
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
            {p.depletedAt ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 text-xs"
                disabled={patchPending}
                onClick={() => onPatch({ depletedAt: null })}
              >
                Clear depletion
              </Button>
            ) : p.metrics.isActive ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                disabled={patchPending}
                title="When tokens or subscription credits ran out"
                onClick={() => onPatch({ depletedAt: new Date().toISOString() })}
              >
                Mark depleted
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Edit AI billing entry"
              onClick={onEdit}
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="text-destructive"
              aria-label="Delete AI billing entry"
              onClick={onDelete}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pt-0 text-sm">
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {p.billingEmail ? (
            <span className="min-w-0 basis-full sm:basis-auto">
              <span className="text-muted-foreground">Account email: </span>
              <strong className="break-all">{p.billingEmail}</strong>
            </span>
          ) : null}
          {p.billingProviderUrl ? (
            <span className="min-w-0 basis-full sm:basis-auto">
              <span className="text-muted-foreground">Provider: </span>
              <a
                href={p.billingProviderUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-primary underline underline-offset-2 hover:no-underline"
              >
                {providerUrlLinkLabel(p.billingProviderUrl)}
                <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
              </a>
            </span>
          ) : null}
          <span>
            <span className="text-muted-foreground">
              {p.billingKind === AI_BILLING_KIND_RECURRING_MONTHLY
                ? "Monthly price: "
                : "One-time price: "}
            </span>
            <strong>{formatMoney(p.price, p.currency)}</strong>
            {viewCurrency !== p.currency &&
            p.priceApproxCzk != null &&
            viewCurrency === DEFAULT_BILLING_CURRENCY ? (
              <span className="text-muted-foreground text-xs ml-1">
                (~{formatMoney(p.priceApproxCzk, DEFAULT_BILLING_CURRENCY)} CZK)
              </span>
            ) : null}
          </span>
          <span>
            <span className="text-muted-foreground">
              Overlap hours ({p.metrics.tasksWithTrackedTime} tasks):{" "}
            </span>
            <strong>{p.metrics.trackedHours}h</strong>
          </span>
          <span>
            <span className="text-muted-foreground">Active days: </span>
            <strong className="tabular-nums">{p.metrics.durationDays}</strong>
          </span>
          {Object.keys(p.paidEarningsByCurrency).length > 0 ? (
            <span className="min-w-0 basis-full sm:basis-auto">
              <span className="text-muted-foreground">Paid billable earnings: </span>
              {Object.entries(p.paidEarningsByCurrency).map(([cur, amt]) => (
                <strong key={cur} className="tabular-nums mr-2">
                  {formatMoney(amt, cur)}
                </strong>
              ))}
            </span>
          ) : null}
        </div>
        <p className="text-[11px] text-muted-foreground leading-snug border-t border-border/60 pt-2">
          Overlap hours: timer time credited to this row (earliest-start wins across concurrent
          windows). Paid billable earnings: paid billing sessions in this window — final once
          ended or depleted.
        </p>
        {p.note ? (
          <p className="text-xs text-muted-foreground italic">{p.note}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

const aiBillingModalSectionKicker =
  "text-[11px] font-medium uppercase tracking-wide text-muted-foreground";
const aiBillingModalFieldLabel = "text-xs font-medium text-foreground";

type PeriodFormDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  presets: AiPreset[];
  editing: EnrichedPeriod | null;
  onSaved: () => void;
};

function PeriodFormDialog({
  open,
  onOpenChange,
  presets,
  editing,
  onSaved,
}: PeriodFormDialogProps) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [currency, setCurrency] = useState(DEFAULT_BILLING_CURRENCY);
  const [billingKind, setBillingKind] = useState<AiBillingKindValue>(
    AI_BILLING_KIND_PURCHASE
  );
  const [billingCadence, setBillingCadence] = useState<AiBillingCadenceValue>(
    AI_BILLING_CADENCE_DEFAULT
  );
  const [hasEndDate, setHasEndDate] = useState(false);
  const [purchaseUsesComputedEnd, setPurchaseUsesComputedEnd] =
    useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [billingEmail, setBillingEmail] = useState("");
  const [billingProviderUrl, setBillingProviderUrl] = useState("");
  const [note, setNote] = useState("");
  const [presetId, setPresetId] = useState<string>("");
  const [saveAsPresetName, setSaveAsPresetName] = useState("");
  const [saveAsPreset, setSaveAsPreset] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setPrice(String(editing.price));
      setCurrency(editing.currency);
      setBillingKind(
        editing.billingKind === AI_BILLING_KIND_RECURRING_MONTHLY
          ? AI_BILLING_KIND_RECURRING_MONTHLY
          : AI_BILLING_KIND_PURCHASE
      );
      setBillingCadence(normalizeAiBillingCadence(editing.billingCadence));
      setStartDate(isoToLocalDateString(editing.startsAt));

      if (
        normalizeAiBillingKind(editing.billingKind) === AI_BILLING_KIND_PURCHASE
      ) {
        const autoEnd = derivePurchaseUsesComputedEnd(editing);
        setPurchaseUsesComputedEnd(autoEnd);
        setHasEndDate(false);
        setEndDate(
          !autoEnd && editing.endsAt
            ? isoToLocalDateString(editing.endsAt)
            : ""
        );
      } else {
        const showEnd = deriveHasEndDate(editing);
        setHasEndDate(showEnd);
        setPurchaseUsesComputedEnd(true);
        setEndDate(
          showEnd && editing.endsAt
            ? isoToLocalDateString(editing.endsAt)
            : ""
        );
      }
      setBillingEmail(editing.billingEmail ?? "");
      setBillingProviderUrl(editing.billingProviderUrl ?? "");
      setNote(editing.note ?? "");
      setPresetId(editing.presetId ?? "");
      setSaveAsPreset(false);
      setSaveAsPresetName("");
    } else {
      setName("");
      setPrice("");
      setCurrency(DEFAULT_BILLING_CURRENCY);
      setBillingKind(AI_BILLING_KIND_PURCHASE);
      setBillingCadence(AI_BILLING_CADENCE_DEFAULT);
      setHasEndDate(false);
      setPurchaseUsesComputedEnd(true);
      const today = format(new Date(), "yyyy-MM-dd");
      setStartDate(today);
      setEndDate("");
      setBillingEmail("");
      setBillingProviderUrl("");
      setNote("");
      setPresetId("");
      setSaveAsPreset(false);
      setSaveAsPresetName("");
    }
  }, [open, editing]);

  const save = useMutation({
    mutationFn: async () => {
      const p = Number.parseFloat(price);
      if (!name.trim() || Number.isNaN(p) || p <= 0) {
        throw new Error("Name and positive price required");
      }
      const s = localYmdToStartOfDay(startDate);
      if (Number.isNaN(s.getTime())) {
        throw new Error("Invalid start date");
      }
      let endsAtIso: string | null = null;

      if (billingKind === AI_BILLING_KIND_PURCHASE) {
        if (purchaseUsesComputedEnd) {
          const endYmd = coveragePeriodEndYmd(startDate, billingCadence);
          const endDt = localYmdToEndOfDay(endYmd);
          if (Number.isNaN(endDt.getTime())) {
            throw new Error("Invalid start date or billing period");
          }
          endsAtIso = endDt.toISOString();
        } else {
          if (!endDate.trim()) {
            throw new Error(
              'Choose an end date, or turn off "Use a different end date".'
            );
          }
          const endDt = localYmdToEndOfDay(endDate);
          if (Number.isNaN(endDt.getTime())) {
            throw new Error("Invalid end date");
          }
          if (endDt.getTime() < s.getTime()) {
            throw new Error("End day must be on or after start day");
          }
          endsAtIso = endDt.toISOString();
        }
      } else if (hasEndDate) {
        if (!endDate.trim()) {
          throw new Error(
            'Choose an end date, or turn off "Ended / ends on a date".'
          );
        }
        const endDt = localYmdToEndOfDay(endDate);
        if (Number.isNaN(endDt.getTime())) {
          throw new Error("Invalid end date");
        }
        if (endDt.getTime() < s.getTime()) {
          throw new Error("End day must be on or after start day");
        }
        endsAtIso = endDt.toISOString();
      }

      const body: Record<string, unknown> = {
        name: name.trim(),
        price: p,
        currency,
        startsAt: s.toISOString(),
        endsAt: endsAtIso,
        billingKind,
        billingCadence: normalizeAiBillingCadence(billingCadence),
        billingEmail: billingEmail.trim() || null,
        billingProviderUrl: billingProviderUrl.trim() || null,
        note: note.trim() || null,
        presetId: presetId || null,
      };

      if (!editing && saveAsPreset && saveAsPresetName.trim()) {
        body.saveAsPreset = { name: saveAsPresetName.trim() };
      }

      if (editing) {
        const res = await fetch(`/api/ai-subscriptions/periods/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || "Save failed");
        }
      } else {
        const res = await fetch("/api/ai-subscriptions/periods", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error || "Save failed");
        }
      }
    },
    onSuccess: () => {
      onSaved();
      onOpenChange(false);
    },
  });

  const purchaseAutoEndLabel =
    billingKind === AI_BILLING_KIND_PURCHASE &&
    purchaseUsesComputedEnd &&
    startDate.trim()
      ? (() => {
          const endDt = localYmdToEndOfDay(
            coveragePeriodEndYmd(startDate, billingCadence)
          );
          return Number.isNaN(endDt.getTime())
            ? null
            : endDt.toLocaleDateString();
        })()
      : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          // Block layout (not flex-col): flex + max-h breaks overflow scrolling because
          // column flex items default to min-height:auto and refuse to shrink below content.
          "block w-[calc(100%-1.5rem)] max-w-2xl gap-0 overflow-y-auto overscroll-y-contain p-4 max-h-[96dvh] [scrollbar-gutter:stable] sm:p-5",
          "duration-300 data-[state=open]:duration-300 data-[state=closed]:duration-200"
        )}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader className="space-y-2 pr-8 text-left">
          <div className="flex items-start gap-2.5">
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary shadow-sm"
              aria-hidden
            >
              <Receipt className="h-4 w-4" strokeWidth={2} />
            </div>
            <div className="min-w-0 space-y-0.5">
              <DialogTitle className="text-lg font-semibold tracking-tight">
                {editing ? "Edit AI billing" : "New AI billing"}
              </DialogTitle>
              <DialogDescription className="text-xs leading-snug text-muted-foreground sm:text-[13px]">
                Same layout as Mark as paid: fill details below, then save.
                Depletion is set from the entry card after credits run out.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div
          className={cn(
            billingSurface.inset,
            "mt-2 px-2.5 py-2 text-sm tabular-nums"
          )}
        >
          <span className="font-semibold text-foreground">
            {billingKind === AI_BILLING_KIND_RECURRING_MONTHLY
              ? `Recurring · ${aiBillingCadenceLabel(billingCadence)}`
              : `One-time · ${aiBillingCadenceLabel(billingCadence)}`}
          </span>
          <span className="text-muted-foreground" aria-hidden>
            {" "}
            ·{" "}
          </span>
          <span className="text-foreground">{currency}</span>
          <span className="text-muted-foreground" aria-hidden>
            {" "}
            ·{" "}
          </span>
          <span className="min-w-0 truncate font-medium text-foreground">
            {name.trim() || "Untitled"}
          </span>
        </div>

        <SelectSingleScope key={open ? "period-form-open" : "period-form-idle"}>
          <div
            className={cn(
              billingSurface.section,
              "mt-2 flex flex-col"
            )}
          >
            <div
              className={cn(
                billingSurface.sectionHeader,
                "flex flex-wrap items-center gap-2 py-1.5"
              )}
            >
              <p className="text-xs font-semibold leading-none sm:text-sm">
                Entry details
              </p>
            </div>
            <div className="bg-muted/20 px-1.5 py-1.5 sm:px-2 sm:py-2">
              <div className="space-y-4">
                  <div className="space-y-1">
                    <Label
                      htmlFor="ai-preset"
                      className={aiBillingModalFieldLabel}
                    >
                      Preset{" "}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                    </Label>
                    <FormSelect
                      id="ai-preset"
                      className="w-full min-w-0"
                      value={presetId === "" ? FORM_SELECT_NONE : presetId}
                      disabled={Boolean(editing)}
                      onValueChange={(v) => {
                        const id = v === FORM_SELECT_NONE ? "" : v;
                        setPresetId(id);
                        const pr = presets.find((x) => x.id === id);
                        if (pr && !editing) setName(pr.name);
                      }}
                      options={[
                        { value: FORM_SELECT_NONE, label: "— none —" },
                        ...presets.map(
                          (pr): FormSelectOption => ({
                            value: pr.id,
                            label: pr.name,
                          }),
                        ),
                      ]}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="ai-name" className={aiBillingModalFieldLabel}>
                      Display name
                    </Label>
                    <Input
                      id="ai-name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                    />
                  </div>

                  <div className="space-y-1">
                    <Label
                      htmlFor="ai-billing-email"
                      className={aiBillingModalFieldLabel}
                    >
                      Account email{" "}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      id="ai-billing-email"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      placeholder="you@example.com"
                      value={billingEmail}
                      onChange={(e) => setBillingEmail(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground leading-snug">
                      Mailbox or login this subscription is purchased on.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <Label
                      htmlFor="ai-billing-provider-url"
                      className={aiBillingModalFieldLabel}
                    >
                      Link to subscription provider{" "}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      id="ai-billing-provider-url"
                      type="url"
                      inputMode="url"
                      autoComplete="url"
                      placeholder="https://billing.example.com"
                      value={billingProviderUrl}
                      onChange={(e) => setBillingProviderUrl(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground leading-snug">
                      Billing portal, plans page, or customer login.
                    </p>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="space-y-1">
                      <Label htmlFor="ai-price" className={aiBillingModalFieldLabel}>
                        {billingKind === AI_BILLING_KIND_RECURRING_MONTHLY
                          ? "Monthly price"
                          : "Amount paid"}
                      </Label>
                      <Input
                        id="ai-price"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        step={0.01}
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label
                        htmlFor="ai-currency"
                        className={aiBillingModalFieldLabel}
                      >
                        Currency
                      </Label>
                      <CurrencySelect
                        id="ai-currency"
                        value={currency}
                        onChange={setCurrency}
                      />
                    </div>
                  </div>

                  <div className="space-y-1">
                    <Label
                      htmlFor="ai-billing-kind"
                      className={aiBillingModalFieldLabel}
                    >
                      How you pay
                    </Label>
                    <FormSelect
                      id="ai-billing-kind"
                      className="w-full min-w-0"
                      value={billingKind}
                      onValueChange={(v) => {
                        const next =
                          v === AI_BILLING_KIND_RECURRING_MONTHLY
                            ? AI_BILLING_KIND_RECURRING_MONTHLY
                            : AI_BILLING_KIND_PURCHASE;
                        setBillingKind(next);
                        setBillingCadence(AI_BILLING_CADENCE_DEFAULT);
                        setHasEndDate(false);
                        setEndDate("");
                        setPurchaseUsesComputedEnd(true);
                      }}
                      options={[
                        {
                          value: AI_BILLING_KIND_PURCHASE,
                          label: "One-time subscription",
                        },
                        {
                          value: AI_BILLING_KIND_RECURRING_MONTHLY,
                          label: "Recurring subscription",
                        },
                      ]}
                    />
                    <p className="text-xs text-muted-foreground leading-snug">
                      {billingKind === AI_BILLING_KIND_RECURRING_MONTHLY
                        ? "Each calendar month in your window adds one charge in totals (cadence is stored). Charts still use month buckets for now."
                        : "One-time: coverage always closes at the end of the calendar period you pick below (week / month / quarter / year). You can override with a custom end date."}{" "}
                      Credits can run out earlier — Mark depleted on the entry
                      card.
                    </p>
                  </div>

                  <div className="space-y-1">
                    <Label
                      htmlFor="ai-billing-cycle"
                      className={aiBillingModalFieldLabel}
                    >
                      {billingKind === AI_BILLING_KIND_RECURRING_MONTHLY
                        ? "Billing cycle"
                        : "Paid coverage period"}
                    </Label>
                    <FormSelect
                      id="ai-billing-cycle"
                      className="w-full min-w-0"
                      value={billingCadence}
                      onValueChange={(v) =>
                        setBillingCadence(normalizeAiBillingCadence(v))
                      }
                      options={recurringBillingCycleOptions}
                    />
                    <p className="text-xs text-muted-foreground leading-snug">
                      {billingKind === AI_BILLING_KIND_RECURRING_MONTHLY
                        ? "Charts still attribute recurring spend by calendar month regardless of cycle."
                        : "Weekly = Monday–Sunday block containing the start date; monthly / quarterly / yearly = through the last day of that calendar bucket."}
                    </p>
                  </div>

                  <div className="rounded-lg border border-border bg-muted/30 px-2 py-3 sm:px-3">
                    <p className={aiBillingModalSectionKicker}>
                      Subscription period
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground leading-snug">
                      Billing uses whole calendar days (start at the beginning
                      of the start date; the last day runs through the end of
                      that day).
                      {billingKind === AI_BILLING_KIND_RECURRING_MONTHLY
                        ? " Use the checkbox below only if this subscription has ended or ends on a known date."
                        : " One-time entries close at the end of the paid coverage period you chose above, unless you pick a custom end date."}
                    </p>

                    <div className="mt-3 space-y-1">
                      <Label
                        htmlFor="ai-start-date"
                        className={aiBillingModalFieldLabel}
                      >
                        <span className="inline-flex items-center gap-1.5">
                          <CalendarDays
                            className="h-3.5 w-3.5 text-muted-foreground"
                            aria-hidden
                          />
                          Starts on
                        </span>
                      </Label>
                      <Input
                        id="ai-start-date"
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                      />
                    </div>

                    {billingKind === AI_BILLING_KIND_PURCHASE ? (
                      <>
                        {purchaseAutoEndLabel ? (
                          <p className="mt-3 rounded-md border border-border bg-background px-2 py-2 text-xs text-muted-foreground leading-snug">
                            Coverage ends after period:{" "}
                            <strong className="text-foreground">
                              {purchaseAutoEndLabel}
                            </strong>
                            <span className="text-muted-foreground">
                              {" "}
                              (end of{" "}
                              {aiBillingCadenceLabel(
                                billingCadence
                              ).toLowerCase()}{" "}
                              period)
                            </span>
                          </p>
                        ) : null}
                        <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={!purchaseUsesComputedEnd}
                            onChange={(e) => {
                              const custom = e.target.checked;
                              setPurchaseUsesComputedEnd(!custom);
                              if (!custom) {
                                setEndDate("");
                              } else if (!endDate.trim()) {
                                setEndDate(
                                  coveragePeriodEndYmd(
                                    startDate,
                                    billingCadence
                                  )
                                );
                              }
                            }}
                          />
                          <span className="min-w-0 space-y-0.5 leading-snug">
                            <span className={aiBillingModalFieldLabel}>
                              Use a different end date
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              Leave unchecked to end exactly at the last day of
                              the period (for example month-end for Monthly).
                            </span>
                          </span>
                        </label>
                        {!purchaseUsesComputedEnd ? (
                          <div className="mt-3 space-y-1">
                            <Label
                              htmlFor="ai-end-date"
                              className={aiBillingModalFieldLabel}
                            >
                              <span className="inline-flex items-center gap-1.5">
                                <CalendarDays
                                  className="h-3.5 w-3.5 text-muted-foreground"
                                  aria-hidden
                                />
                                Ends on
                              </span>
                            </Label>
                            <Input
                              id="ai-end-date"
                              type="date"
                              value={endDate}
                              onChange={(e) => setEndDate(e.target.value)}
                            />
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <>
                        <label className="mt-4 flex cursor-pointer items-start gap-2 text-sm">
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            checked={hasEndDate}
                            onChange={(e) => {
                              const c = e.target.checked;
                              setHasEndDate(c);
                              if (!c) {
                                setEndDate("");
                              } else if (!endDate.trim()) {
                                setEndDate(startDate);
                              }
                            }}
                          />
                          <span className="min-w-0 space-y-0.5 leading-snug">
                            <span className={aiBillingModalFieldLabel}>
                              Ended / ends on a date
                            </span>
                            <span className="block text-xs text-muted-foreground">
                              Unchecked means still active (open-ended).
                              Checked reveals an end date.
                            </span>
                          </span>
                        </label>

                        {hasEndDate ? (
                          <div className="mt-3 space-y-1">
                            <Label
                              htmlFor="ai-end-date-rec"
                              className={aiBillingModalFieldLabel}
                            >
                              <span className="inline-flex items-center gap-1.5">
                                <CalendarDays
                                  className="h-3.5 w-3.5 text-muted-foreground"
                                  aria-hidden
                                />
                                Ends on
                              </span>
                            </Label>
                            <Input
                              id="ai-end-date-rec"
                              type="date"
                              value={endDate}
                              onChange={(e) => setEndDate(e.target.value)}
                            />
                          </div>
                        ) : null}
                      </>
                    )}
                  </div>

                  <div className="space-y-1">
                    <Label htmlFor="ai-note" className={aiBillingModalFieldLabel}>
                      Note{" "}
                      <span className="font-normal text-muted-foreground">
                        (optional)
                      </span>
                    </Label>
                    <Input
                      id="ai-note"
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Invoice ref, plan tier…"
                      maxLength={2000}
                    />
                  </div>

                  {!editing ? (
                    <div
                      className={cn(
                        billingSurface.inset,
                        "space-y-2 py-2.5 shadow-none"
                      )}
                    >
                      <label className="flex items-center gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={saveAsPreset}
                          onChange={(e) => setSaveAsPreset(e.target.checked)}
                        />
                        <span className={aiBillingModalFieldLabel}>
                          Save as new preset for next time
                        </span>
                      </label>
                      {saveAsPreset ? (
                        <Input
                          placeholder="Preset name"
                          value={saveAsPresetName}
                          onChange={(e) => setSaveAsPresetName(e.target.value)}
                        />
                      ) : null}
                    </div>
                  ) : null}
                </div>
            </div>
          </div>
        </SelectSingleScope>

        <div className="space-y-2 border-t border-border pt-3">
          {save.error ? (
            <p
              className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-1.5 text-xs font-medium text-destructive"
              role="alert"
            >
              {(save.error as Error).message}
            </p>
          ) : null}

          <div className="flex flex-wrap items-end justify-end gap-2">
            <DialogFooter className="w-full gap-2 pt-0 sm:w-auto sm:justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="min-w-[9rem] font-semibold"
                disabled={save.isPending}
                onClick={() => save.mutate()}
              >
                {save.isPending ? "Saving…" : editing ? "Save entry" : "Create entry"}
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
