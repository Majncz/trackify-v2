"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { usePresence } from "@/hooks/use-presence";
import { useStats } from "@/hooks/use-stats";
import { useLiveTimer } from "@/hooks/use-timer";
import { formatDurationWords } from "@/lib/utils";
import { liveTodayMs } from "@/lib/live-timer";
import { cn } from "@/lib/utils";

const MEDALS = ["1", "2", "3"] as const;

export function DailyLeaderboard() {
  const { data: session } = useSession();
  const { leaderboard, isLoading: presenceLoading } = usePresence();
  const { data: stats, isLoading: statsLoading } = useStats();
  const { running, startTime } = useLiveTimer();
  const [now, setNow] = useState(() => Date.now());

  const rows = leaderboard.filter((row) => row.todayMs > 0 || row.startTime);
  const anyoneLive = rows.some((row) => row.startTime);
  const liveClock = anyoneLive || (running && Boolean(startTime));

  useEffect(() => {
    if (!liveClock) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [liveClock]);

  const liveAll = running && startTime ? Math.max(0, now - startTime) : 0;
  const liveToday = running && startTime ? liveTodayMs(startTime, now) : 0;
  const todayTotal = (stats?.todayTotal ?? 0) + liveToday;
  const allTimeTotal = (stats?.grandTotal ?? 0) + liveAll;

  if (presenceLoading && statsLoading) {
    return (
      <Card>
        <CardContent className="py-4 space-y-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <p className="text-base font-semibold">Today’s leaderboard</p>
            <p className="text-xs text-muted-foreground">
              {anyoneLive ? "Live times, updating as people track" : "Who’s grinding the most today"}
            </p>
          </div>
          <div className="flex shrink-0 gap-6 sm:text-right">
            <div>
              <p className="text-xs font-medium text-muted-foreground">Today</p>
              <p className="text-lg font-bold tabular-nums leading-tight">
                {statsLoading ? "—" : formatDurationWords(todayTotal)}
              </p>
            </div>
            <div>
              <p className="text-xs font-medium text-muted-foreground">All time</p>
              <p className="text-lg font-bold tabular-nums leading-tight">
                {statsLoading ? "—" : formatDurationWords(allTimeTotal)}
              </p>
            </div>
          </div>
        </div>
        {rows.length > 0 && (
          <ol className="space-y-2">
            {rows.map((row, index) => {
              const isLive = Boolean(row.startTime);
              const live = row.startTime ? liveTodayMs(row.startTime, now) : 0;
              const sessionMs = row.startTime ? Math.max(0, now - row.startTime) : 0;
              const total = row.todayMs + live;
              const isYou = row.userId === session?.user?.id;
              return (
                <li
                  key={row.userId}
                  className={cn(
                    "flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 min-w-0",
                    isLive && "bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/25",
                    !isLive && isYou && "bg-primary/5"
                  )}
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span
                      className={cn(
                        "w-5 shrink-0 text-sm font-bold tabular-nums",
                        index === 0 && "text-amber-600",
                        index === 1 && "text-zinc-500",
                        index === 2 && "text-amber-800"
                      )}
                    >
                      {MEDALS[index] ?? index + 1}
                    </span>
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm font-medium min-w-0">
                        {isLive && (
                          <span className="relative flex h-2 w-2 shrink-0">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-70" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                          </span>
                        )}
                        <span className="truncate">
                          {row.name}
                          {isYou ? " · you" : ""}
                        </span>
                      </p>
                      {isLive && row.taskName && (
                        <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400 truncate">
                          Live · {row.taskName}
                          {sessionMs > 0 ? ` · ${formatDurationWords(sessionMs)} this stretch` : ""}
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="text-sm font-semibold tabular-nums shrink-0">
                    {formatDurationWords(total)}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
