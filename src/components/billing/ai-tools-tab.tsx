"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
import { formatMoney } from "@/lib/format-money";
import { DEFAULT_BILLING_CURRENCY } from "@/lib/billing-currencies";
import {
  FormSelect,
  FORM_SELECT_NONE,
  type FormSelectOption,
} from "@/components/ui/form-select";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ScatterChart,
  Scatter,
  ZAxis,
} from "recharts";

type AiPreset = {
  id: string;
  name: string;
  providerKey: string | null;
  isBuiltIn: boolean;
  sortOrder: number;
};

type PeriodMetrics = {
  linkedTaskCount: number;
  trackedHours: number;
  eventsInWindow: number;
  costPerHour: number | null;
  costPerLinkedTask: number | null;
  burnPerDayNative: number;
  durationDays: number;
  hoursPer100Czk: number | null;
  effectivenessPercent: number | null;
  isActive: boolean;
};

type EnrichedPeriod = {
  id: string;
  name: string;
  price: number;
  currency: string;
  startsAt: string;
  endsAt: string | null;
  note: string | null;
  presetId: string | null;
  linkedTaskIds: string[];
  priceApproxCzk: number | null;
  metrics: PeriodMetrics;
  billablePaidShare: number | null;
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
  rankings: {
    mostTrackedHours: { id: string; name: string; trackedHours: number }[];
    lowestCostPerHour: {
      id: string;
      name: string;
      costPerHour: number | null;
      currency: string;
    }[];
  };
  correlation: {
    id: string;
    name: string;
    durationDays: number;
    billablePaidShare: number | null;
  }[];
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

async function fetchSettings(): Promise<{
  aiTargetHoursPer100Czk: number | null;
}> {
  const res = await fetch("/api/ai-subscriptions/settings");
  if (!res.ok) throw new Error("Failed to load settings");
  return res.json();
}

function toDatetimeLocalValue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function AiToolsTab() {
  const qc = useQueryClient();
  const [viewCurrency, setViewCurrency] = useState(DEFAULT_BILLING_CURRENCY);
  const [targetInput, setTargetInput] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EnrichedPeriod | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const analyticsQuery = useQuery({
    queryKey: ["ai-subscriptions-analytics", viewCurrency],
    queryFn: () => fetchAnalytics(viewCurrency),
  });

  const presetsQuery = useQuery({
    queryKey: ["ai-subscriptions-presets"],
    queryFn: fetchPresets,
  });

  const settingsQuery = useQuery({
    queryKey: ["ai-subscriptions-settings"],
    queryFn: fetchSettings,
  });

  useEffect(() => {
    const t = settingsQuery.data?.aiTargetHoursPer100Czk;
    if (t != null && !Number.isNaN(t)) setTargetInput(String(t));
    else if (settingsQuery.isSuccess && t == null) setTargetInput("");
  }, [settingsQuery.data, settingsQuery.isSuccess]);

  const saveSettings = useMutation({
    mutationFn: async (aiTargetHoursPer100Czk: number | null) => {
      const res = await fetch("/api/ai-subscriptions/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ aiTargetHoursPer100Czk }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || "Could not save");
      }
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["ai-subscriptions-settings"] });
      qc.invalidateQueries({ queryKey: ["ai-subscriptions-analytics"] });
    },
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
      setDeleteId(null);
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

  const scatterData = useMemo(() => {
    return (data?.correlation ?? [])
      .filter((c) => c.billablePaidShare != null)
      .map((c) => ({
        name: c.name,
        x: Math.round(c.durationDays * 10) / 10,
        y: Math.round((c.billablePaidShare ?? 0) * 1000) / 10,
      }));
  }, [data?.correlation]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2
            id="billing-tab-ai-label"
            className="text-base font-semibold tracking-tight"
          >
            AI subscriptions
          </h2>
          <p className="text-sm text-muted-foreground max-w-prose">
            Log each paid period, link tasks that used the tool, and compare
            tracked hours to what you paid. Totals can be converted for display;
            each period keeps its native price and currency.
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 min-w-[10rem]">
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
            Add period
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
                Lifetime AI spend ({data.viewCurrency})
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
                Active periods
              </p>
              <p className="text-lg font-semibold tabular-nums sm:text-xl">
                {data.summary.activeSubscriptions}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-3 pt-3">
              <p className="text-xs font-medium text-muted-foreground">
                Total periods
              </p>
              <p className="text-lg font-semibold tabular-nums sm:text-xl">
                {data.summary.periodCount}
              </p>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Effectiveness target</CardTitle>
          <CardDescription>
            Hours of tracked work per 100&nbsp;CZK (approx.) of subscription
            spend. Leave empty to compare each period to your historical median.
            Target is applied using CZK-equivalent spend (FX via Frankfurter
            where available).
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-wrap items-end gap-3">
          <div className="space-y-1 flex-1 min-w-[12rem] max-w-xs">
            <Label htmlFor="ai-target">Hours per 100 CZK</Label>
            <Input
              id="ai-target"
              type="number"
              min={0}
              step={0.1}
              placeholder="e.g. 2.5"
              value={targetInput}
              onChange={(e) => setTargetInput(e.target.value)}
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            disabled={saveSettings.isPending}
            onClick={() => {
              const v = targetInput.trim();
              if (!v) {
                saveSettings.mutate(null);
                return;
              }
              const n = Number.parseFloat(v);
              if (Number.isNaN(n) || n <= 0) return;
              saveSettings.mutate(n);
            }}
          >
            Save target
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={saveSettings.isPending}
            onClick={() => {
              setTargetInput("");
              saveSettings.mutate(null);
            }}
          >
            Use median only
          </Button>
        </CardContent>
      </Card>

      {data && data.cumulativeByMonth.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">Cumulative spend</CardTitle>
            <CardDescription>
              Running total in {data.viewCurrency} by first month of each period
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="recharts-no-focus-ring rounded-lg border border-border/60 bg-muted/20 p-2 h-[220px]"
              onMouseDown={chartPreventFocusSteal}
            >
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data.cumulativeByMonth}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="month" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip
                    formatter={(v) =>
                      formatMoney(Number(v), data.viewCurrency)
                    }
                  />
                  <Line
                    type="monotone"
                    dataKey="totalInView"
                    stroke="hsl(var(--primary))"
                    strokeWidth={2}
                    dot={false}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {scatterData.length > 0 ? (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-base">
              Subscription length vs billable paid share
            </CardTitle>
            <CardDescription>
              Each point is one period: duration (days) and share of{" "}
              <strong>billable</strong> earnings that are already marked paid,
              for tasks linked to that period (proxy for billing progress).
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div
              className="recharts-no-focus-ring rounded-lg border border-border/60 bg-muted/20 p-2 h-[260px]"
              onMouseDown={chartPreventFocusSteal}
            >
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart margin={{ top: 8, right: 8, bottom: 8, left: 8 }}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name="Days"
                    tick={{ fontSize: 11 }}
                    label={{ value: "Duration (days)", position: "bottom", offset: 0 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name="Paid %"
                    tick={{ fontSize: 11 }}
                    label={{
                      value: "Billable paid share (%)",
                      angle: -90,
                      position: "insideLeft",
                    }}
                  />
                  <ZAxis range={[60, 60]} />
                  <Tooltip
                    cursor={{ strokeDasharray: "3 3" }}
                    formatter={(v, name) => {
                      const num = typeof v === "number" ? v : Number(v);
                      const n = String(name);
                      if (n === "y" || n === "Paid share")
                        return [`${num}%`, "Paid share"];
                      return [num, "Days"];
                    }}
                    labelFormatter={(_, payload) =>
                      (payload?.[0]?.payload as { name?: string })?.name ??
                      ""
                    }
                  />
                  <Scatter
                    name="Periods"
                    data={scatterData}
                    fill="hsl(var(--primary))"
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {data && (data.rankings.mostTrackedHours.length > 0 ||
        data.rankings.lowestCostPerHour.length > 0) ? (
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Most tracked hours</CardTitle>
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
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Lowest cost / tracked hour</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2 text-sm">
                {data.rankings.lowestCostPerHour.map((r) => (
                  <li
                    key={r.id}
                    className="flex justify-between gap-2 border-b border-border/50 pb-2 last:border-0"
                  >
                    <span className="truncate">{r.name}</span>
                    <span className="tabular-nums shrink-0">
                      {r.costPerHour != null
                        ? formatMoney(r.costPerHour, r.currency)
                        : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <div className="space-y-3">
        <h3 className="text-sm font-semibold">Periods</h3>
        {analyticsQuery.isLoading ? (
          <Skeleton className="h-40 w-full rounded-lg" />
        ) : periods.length === 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              No subscription periods yet. Add one to start tracking.
            </CardContent>
          </Card>
        ) : (
          <ul className="space-y-3">
            {periods.map((p) => (
              <li key={p.id}>
                <Card>
                  <CardHeader className="pb-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0 space-y-1">
                        <CardTitle className="text-base flex flex-wrap items-center gap-2">
                          <span className="truncate">{p.name}</span>
                          {p.metrics.isActive ? (
                            <Badge variant="secondary">Active</Badge>
                          ) : (
                            <Badge variant="outline">Ended</Badge>
                          )}
                        </CardTitle>
                        <CardDescription className="text-xs">
                          {new Date(p.startsAt).toLocaleString()} →{" "}
                          {p.endsAt
                            ? new Date(p.endsAt).toLocaleString()
                            : "open-ended"}
                        </CardDescription>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Edit period"
                          onClick={() => {
                            setEditing(p);
                            setDialogOpen(true);
                          }}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="text-destructive"
                          aria-label="Delete period"
                          onClick={() => setDeleteId(p.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0 text-sm">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      <span>
                        <span className="text-muted-foreground">Price: </span>
                        <strong>{formatMoney(p.price, p.currency)}</strong>
                        {viewCurrency !== p.currency &&
                        p.priceApproxCzk != null &&
                        viewCurrency === DEFAULT_BILLING_CURRENCY ? (
                          <span className="text-muted-foreground text-xs ml-1">
                            (~{formatMoney(p.priceApproxCzk, DEFAULT_BILLING_CURRENCY)}{" "}
                            CZK)
                          </span>
                        ) : null}
                      </span>
                      <span>
                        <span className="text-muted-foreground">Tracked: </span>
                        <strong>{p.metrics.trackedHours}h</strong>
                      </span>
                      <span>
                        <span className="text-muted-foreground">Linked tasks: </span>
                        <strong>{p.metrics.linkedTaskCount}</strong>
                      </span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 text-xs">
                      <div>
                        <p className="text-muted-foreground">Cost / hour</p>
                        <p className="font-medium tabular-nums">
                          {p.metrics.costPerHour != null
                            ? formatMoney(p.metrics.costPerHour, p.currency)
                            : "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Burn / day</p>
                        <p className="font-medium tabular-nums">
                          {formatMoney(p.metrics.burnPerDayNative, p.currency)}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Hours / 100 CZK</p>
                        <p className="font-medium tabular-nums">
                          {p.metrics.hoursPer100Czk ?? "—"}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Effectiveness</p>
                        <p className="font-medium tabular-nums">
                          {p.metrics.effectivenessPercent != null
                            ? `${p.metrics.effectivenessPercent}%`
                            : "—"}
                        </p>
                      </div>
                    </div>
                    {p.note ? (
                      <p className="text-xs text-muted-foreground">{p.note}</p>
                    ) : null}
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
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
        }}
      />

      <Dialog open={Boolean(deleteId)} onOpenChange={() => setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete subscription period?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            Task links and metrics for this period will be removed. This cannot
            be undone.
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
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [endsOpen, setEndsOpen] = useState(false);
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
      setStartsAt(toDatetimeLocalValue(editing.startsAt));
      if (editing.endsAt) {
        setEndsOpen(true);
        setEndsAt(toDatetimeLocalValue(editing.endsAt));
      } else {
        setEndsOpen(false);
        setEndsAt("");
      }
      setNote(editing.note ?? "");
      setPresetId(editing.presetId ?? "");
      setSaveAsPreset(false);
      setSaveAsPresetName("");
    } else {
      setName("");
      setPrice("");
      setCurrency(DEFAULT_BILLING_CURRENCY);
      setStartsAt(toDatetimeLocalValue(new Date().toISOString()));
      setEndsOpen(false);
      setEndsAt("");
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
      const s = new Date(startsAt);
      if (Number.isNaN(s.getTime())) throw new Error("Invalid start date");
      let e: Date | null = null;
      if (endsOpen && endsAt.trim()) {
        e = new Date(endsAt);
        if (Number.isNaN(e.getTime())) throw new Error("Invalid end date");
        if (e.getTime() < s.getTime()) {
          throw new Error("End must be after start");
        }
      }

      const body: Record<string, unknown> = {
        name: name.trim(),
        price: p,
        currency,
        startsAt: s.toISOString(),
        endsAt: endsOpen && e ? e.toISOString() : null,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {editing ? "Edit subscription period" : "New subscription period"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="space-y-1">
            <Label htmlFor="ai-preset">Preset (optional)</Label>
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
            <Label htmlFor="ai-name">Display name</Label>
            <Input
              id="ai-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="ai-price">Price</Label>
              <Input
                id="ai-price"
                type="number"
                min={0}
                step={0.01}
                value={price}
                onChange={(e) => setPrice(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ai-currency">Currency</Label>
              <CurrencySelect
                id="ai-currency"
                value={currency}
                onChange={setCurrency}
              />
            </div>
          </div>
          <div className="space-y-1">
            <Label htmlFor="ai-start">Starts</Label>
            <Input
              id="ai-start"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={endsOpen}
                onChange={(e) => setEndsOpen(e.target.checked)}
              />
              Period has an end date
            </label>
            {endsOpen ? (
              <Input
                type="datetime-local"
                value={endsAt}
                onChange={(e) => setEndsAt(e.target.value)}
              />
            ) : null}
          </div>
          <div className="space-y-1">
            <Label htmlFor="ai-note">Note</Label>
            <Input
              id="ai-note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
            />
          </div>
          {!editing ? (
            <div className="space-y-2 rounded-lg border p-3">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={saveAsPreset}
                  onChange={(e) => setSaveAsPreset(e.target.checked)}
                />
                Save as new preset for next time
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
          {save.error ? (
            <p className="text-sm text-destructive">
              {(save.error as Error).message}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Saving…" : editing ? "Save" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
