"use client";

import { useMemo, useState, useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  startOfWeek,
  endOfWeek,
  startOfMonth,
  endOfMonth,
  subMonths,
  endOfDay,
  format,
} from "date-fns";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { focusControl } from "@/lib/focus-style";
import { SummaryBar } from "./summary-bar";
import {
  BillingFilters,
  type BillingRangePreset,
  type BillingStatusFilter,
  type BillingGroupBy,
} from "./billing-filters";
import { SessionLedger } from "./session-ledger";
import { MarkPaidDialog } from "./mark-paid-dialog";
import { PaymentHistory } from "./payment-history";
import { TaskEnrollmentSheet } from "./task-enrollment-sheet";
import { CalendarHeatmap } from "./calendar-heatmap";
import { BillingGuide } from "./billing-guide";
import { AiToolsTab } from "./ai-tools-tab";
import type { BillingSessionRow } from "@/lib/billing";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";

type BillingTaskMeta = {
  id: string;
  taskId: string;
  task: {
    id: string;
    name: string;
    hidden: boolean;
    taskGroup: { id: string; name: string; color: string | null } | null;
  };
};

async function fetchBillingTasksMeta(): Promise<BillingTaskMeta[]> {
  const res = await fetch("/api/billing/tasks");
  if (!res.ok) throw new Error("Failed to load billing tasks");
  return res.json();
}

async function fetchSessions(params: URLSearchParams): Promise<{
  sessions: BillingSessionRow[];
}> {
  const res = await fetch(`/api/billing/sessions?${params.toString()}`);
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || "Failed to load sessions");
  }
  return res.json();
}

function useBillingDateRange(
  preset: BillingRangePreset,
  customFrom: string,
  customTo: string
) {
  return useMemo(() => {
    const now = new Date();
    if (preset === "this_week") {
      const from = startOfWeek(now, { weekStartsOn: 1 });
      const to = endOfWeek(now, { weekStartsOn: 1 });
      return { from: from.toISOString(), to: to.toISOString() };
    }
    if (preset === "this_month") {
      const from = startOfMonth(now);
      const to = endOfMonth(now);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    if (preset === "last_month") {
      const base = subMonths(now, 1);
      const from = startOfMonth(base);
      const to = endOfMonth(base);
      return { from: from.toISOString(), to: to.toISOString() };
    }
    if (preset === "all_time") {
      return { from: null as string | null, to: null as string | null };
    }
    if (!customFrom || !customTo) {
      return { from: null as string | null, to: null as string | null };
    }
    const from = new Date(`${customFrom}T00:00:00`);
    const to = new Date(`${customTo}T23:59:59.999`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
      return { from: null, to: null };
    }
    return { from: from.toISOString(), to: to.toISOString() };
  }, [preset, customFrom, customTo]);
}

const BILLING_TAB_IDS = ["ledger", "history", "tasks", "ai_tools"] as const;
type BillingTabId = (typeof BILLING_TAB_IDS)[number];

export function BillingPage() {
  const qc = useQueryClient();
  const [preset, setPreset] = useState<BillingRangePreset>("this_month");
  const [customFrom, setCustomFrom] = useState(() =>
    format(new Date(), "yyyy-MM-dd")
  );
  const [customTo, setCustomTo] = useState(() =>
    format(new Date(), "yyyy-MM-dd")
  );
  const [taskGroupId, setTaskGroupId] = useState<string | "all" | "ungrouped">(
    "all"
  );
  const [taskId, setTaskId] = useState<string | "all">("all");
  const [status, setStatus] = useState<BillingStatusFilter>("unpaid");
  const [groupBy, setGroupBy] = useState<BillingGroupBy>("day");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [markOpen, setMarkOpen] = useState(false);
  const [tab, setTab] = useState<BillingTabId>("ledger");

  const goToTab = useCallback((next: string) => {
    const nextId = next as BillingTabId;
    if (!BILLING_TAB_IDS.includes(nextId)) return;
    if (nextId === tab) return;
    setTab(nextId);
  }, [tab]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.location.hash === "#ai-tools") {
      setTab("ai_tools");
    }
  }, []);

  const range = useBillingDateRange(preset, customFrom, customTo);

  const heatmapCalendarEnd = useMemo(() => {
    if (preset === "all_time" || !range.to) return undefined;
    const d = new Date(range.to);
    if (Number.isNaN(d.getTime())) return undefined;
    return endOfDay(d);
  }, [preset, range.to]);

  const { data: billingMeta } = useQuery({
    queryKey: ["billing-tasks"],
    queryFn: fetchBillingTasksMeta,
  });

  const taskGroups = useMemo(() => {
    const byId = new Map<
      string,
      { id: string; name: string; color: string | null }
    >();
    for (const b of billingMeta ?? []) {
      const g = b.task.taskGroup;
      if (g) byId.set(g.id, g);
    }
    return Array.from(byId.values()).sort((a, b) =>
      a.name.localeCompare(b.name)
    );
  }, [billingMeta]);

  const hasUngroupedTasks = useMemo(
    () => (billingMeta ?? []).some((b) => !b.task.taskGroup),
    [billingMeta]
  );

  const enrolledTasks = useMemo(() => {
    return (billingMeta ?? [])
      .filter((b) => {
        if (taskGroupId === "all") return true;
        if (taskGroupId === "ungrouped") return !b.task.taskGroup;
        return b.task.taskGroup?.id === taskGroupId;
      })
      .map((b) => ({
        taskId: b.taskId,
        name: b.task.name,
      }));
  }, [billingMeta, taskGroupId]);

  useEffect(() => {
    if (taskId === "all") return;
    if (!enrolledTasks.some((t) => t.taskId === taskId)) {
      setTaskId("all");
    }
  }, [enrolledTasks, taskId]);

  const sessionsQuery = useQuery({
    queryKey: [
      "billing-sessions",
      preset,
      range.from,
      range.to,
      taskGroupId,
      taskId,
      status,
    ],
    queryFn: async () => {
      const p = new URLSearchParams();
      if (range.from) p.set("from", range.from);
      if (range.to) p.set("to", range.to);
      p.set("status", status);
      if (taskGroupId !== "all") p.set("taskGroupId", taskGroupId);
      if (taskId !== "all") p.set("taskId", taskId);
      return fetchSessions(p);
    },
    enabled: preset === "all_time" || Boolean(range.from && range.to),
  });

  const sessions = useMemo(
    () => sessionsQuery.data?.sessions ?? [],
    [sessionsQuery.data]
  );

  const toggleSelected = useCallback((id: string, next: boolean) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (next) n.add(id);
      else n.delete(id);
      return n;
    });
  }, []);

  const onSelectGroup = useCallback((ids: string[], select: boolean) => {
    setSelectedIds((prev) => {
      const n = new Set(prev);
      for (const id of ids) {
        if (select) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  }, []);

  const selectedSessions = useMemo(() => {
    return sessions.filter((s) => selectedIds.has(s.id) && !s.isPaid);
  }, [sessions, selectedIds]);

  const onSelectAllUnpaidInView = useCallback(() => {
    const unpaidIds = sessions.filter((s) => !s.isPaid).map((s) => s.id);
    if (unpaidIds.length === 0) return;

    const allUnpaidSelected =
      unpaidIds.every((id) => selectedIds.has(id));

    if (allUnpaidSelected) {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        for (const id of unpaidIds) n.delete(id);
        return n;
      });
    } else {
      setSelectedIds(new Set(unpaidIds));
    }
  }, [sessions, selectedIds]);

  const onMarkSuccess = useCallback(() => {
    setSelectedIds(new Set());
    qc.invalidateQueries({ queryKey: ["billing-sessions"] });
    qc.invalidateQueries({ queryKey: ["billing-summary"] });
    qc.invalidateQueries({ queryKey: ["billing-payments"] });
  }, [qc]);

  const onHeatmapDay = useCallback(
    (localDayKey: string) => {
      setPreset("custom");
      setCustomFrom(localDayKey);
      setCustomTo(localDayKey);
      goToTab("ledger");
      setStatus("all");
    },
    [goToTab]
  );

  const hasEnrolledTasks = (billingMeta ?? []).length > 0;

  return (
    <div className="space-y-6 sm:space-y-8">
      <SummaryBar />

      {!hasEnrolledTasks ? (
        <Card className="border-primary/25 bg-primary/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Set up billing first</CardTitle>
            <CardDescription>
              Pick which tasks get a rate. After that, your tracked time can be
              paid out from the Sessions tab.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button type="button" onClick={() => goToTab("tasks")}>
              Billable tasks
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <BillingGuide onOpenTasksTab={() => goToTab("tasks")} />

      <div className="w-full min-w-0">
        <Tabs
          value={tab}
          onValueChange={goToTab}
          className="w-full min-w-0 space-y-4"
        >
          <TabsList className="grid h-auto w-full min-w-0 grid-cols-4 rounded-lg p-1">
            <TabsTrigger value="ledger" className="text-xs sm:text-sm">
              Sessions
            </TabsTrigger>
            <TabsTrigger value="history" className="text-xs sm:text-sm">
              History
            </TabsTrigger>
            <TabsTrigger value="tasks" className="text-xs sm:text-sm">
              Rates
            </TabsTrigger>
            <TabsTrigger value="ai_tools" className="text-xs sm:text-sm">
              AI tools
            </TabsTrigger>
          </TabsList>

          <div
            id="billing-tab-panel"
            role="tabpanel"
            aria-label={
              tab === "ledger"
                ? "Sessions"
                : tab === "history"
                  ? "Payment history"
                  : tab === "tasks"
                    ? "Rates and billable tasks"
                    : "AI subscriptions"
            }
            className={cn(
              "mt-0 w-full min-w-0 rounded-lg outline-none isolate",
              "min-h-[min(68vh,540px)] overflow-hidden",
              focusControl,
            )}
          >
            <div
              className={cn(
                "flex w-[400%] will-change-transform transition-transform duration-500 ease-billing-carousel",
                "motion-reduce:transition-none"
              )}
              style={{
                transform: `translate3d(calc(-${BILLING_TAB_IDS.indexOf(tab)} * 100% / 4), 0, 0)`,
              }}
            >
              <div
                className={cn(
                  "min-w-0 shrink-0 overflow-hidden flex-[0_0_calc(100%/4)]",
                  tab === "ledger"
                    ? "pointer-events-auto"
                    : "pointer-events-none"
                )}
                aria-hidden={tab !== "ledger"}
              >
                <div className="space-y-6">
                  {hasEnrolledTasks ? (
                    <>
                <Card>
                  <CardHeader className="space-y-1 pb-2">
                    <CardTitle
                      id="billing-tab-ledger-label"
                      className="text-base"
                    >
                      Sessions
                    </CardTitle>
                    <CardDescription className="text-xs leading-snug">
                      Billable time (rates below). List is the focus — use the
                      compact bar to select payouts.
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3 pt-0">
                    <BillingFilters
                      preset={preset}
                      onPresetChange={setPreset}
                      customFrom={customFrom}
                      customTo={customTo}
                      onCustomFromChange={setCustomFrom}
                      onCustomToChange={setCustomTo}
                      taskGroupId={taskGroupId}
                      onTaskGroupIdChange={(v) => {
                        setTaskGroupId(v);
                        setTaskId("all");
                      }}
                      taskId={taskId}
                      onTaskIdChange={setTaskId}
                      status={status}
                      onStatusChange={setStatus}
                      groupBy={groupBy}
                      onGroupByChange={setGroupBy}
                      enrolledTasks={enrolledTasks}
                      taskGroups={taskGroups}
                      hasUngroupedTasks={hasUngroupedTasks}
                    />
                    {sessionsQuery.isLoading && (
                      <Skeleton className="h-40 w-full rounded-lg" />
                    )}
                    {sessionsQuery.isError && (
                      <p className="text-sm text-destructive">
                        {(sessionsQuery.error as Error)?.message ??
                          "Failed to load"}
                      </p>
                    )}
                    {!sessionsQuery.isLoading &&
                      !sessionsQuery.isError && (
                        <SessionLedger
                          sessions={sessions}
                          groupBy={groupBy}
                          statusFilter={status}
                          selectedIds={selectedIds}
                          onToggleSelected={toggleSelected}
                          onSelectGroup={onSelectGroup}
                          onSelectAllUnpaidInView={onSelectAllUnpaidInView}
                          onMarkPaidClick={() => setMarkOpen(true)}
                        />
                      )}
                  </CardContent>
                </Card>

                      <details className="group rounded-xl border bg-muted/20 open:bg-card open:shadow-sm transition-colors">
                        <summary className="cursor-pointer list-none px-4 py-3 text-left [&::-webkit-details-marker]:hidden">
                          <div className="flex flex-col gap-0.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                            <span className="text-sm font-medium">
                              Activity calendar
                              <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                                (optional)
                              </span>
                            </span>
                            <span className="text-xs text-muted-foreground">
                              Same yearly heatmap as home · open when you want
                              the overview
                            </span>
                          </div>
                        </summary>
                        <div className="border-t border-border/60 px-2 pb-4 pt-3">
                          <CalendarHeatmap
                            sessions={sessions}
                            calendarEndDay={heatmapCalendarEnd}
                            isLoading={sessionsQuery.isLoading}
                            onDayClick={onHeatmapDay}
                            onManageTasks={() => goToTab("tasks")}
                          />
                        </div>
                      </details>
                    </>
                  ) : (
                    <Card className="border-dashed">
                      <CardHeader>
                        <CardTitle
                          id="billing-tab-ledger-label"
                          className="text-base"
                        >
                          No billable tasks yet
                        </CardTitle>
                        <CardDescription>
                          Add at least one task with a rate on the Rates tab,
                          then come back here.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="pt-0">
                        <Button type="button" onClick={() => goToTab("tasks")}>
                          Go to Rates
                        </Button>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>

              <div
                className={cn(
                  "min-w-0 shrink-0 overflow-hidden flex-[0_0_calc(100%/4)]",
                  tab === "history"
                    ? "pointer-events-auto"
                    : "pointer-events-none"
                )}
                aria-hidden={tab !== "history"}
              >
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h2
                      id="billing-tab-history-label"
                      className="text-base font-semibold tracking-tight"
                    >
                      Payment history
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Each batch shows amount, date, sessions, and per-line
                      payouts from when you marked them paid.
                    </p>
                  </div>
                  <PaymentHistory />
                </div>
              </div>

              <div
                className={cn(
                  "min-w-0 shrink-0 overflow-hidden flex-[0_0_calc(100%/4)]",
                  tab === "tasks"
                    ? "pointer-events-auto"
                    : "pointer-events-none"
                )}
                aria-hidden={tab !== "tasks"}
              >
                <div className="space-y-4">
                  <div className="space-y-1">
                    <h2
                      id="billing-tab-tasks-label"
                      className="text-base font-semibold tracking-tight"
                    >
                      Billable tasks &amp; rates
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      Choose which tasks bill hourly and set rate and currency.
                      Only these tasks show up under Sessions.
                    </p>
                  </div>
                  <TaskEnrollmentSheet />
                </div>
              </div>

              <div
                className={cn(
                  "min-w-0 shrink-0 overflow-hidden flex-[0_0_calc(100%/4)]",
                  tab === "ai_tools"
                    ? "pointer-events-auto"
                    : "pointer-events-none"
                )}
                aria-hidden={tab !== "ai_tools"}
              >
                <AiToolsTab />
              </div>
            </div>
          </div>
        </Tabs>
      </div>

      <MarkPaidDialog
        open={markOpen}
        onOpenChange={setMarkOpen}
        sessions={selectedSessions}
        onSuccess={onMarkSuccess}
      />
    </div>
  );
}
