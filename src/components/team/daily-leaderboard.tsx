"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { addDays, format } from "date-fns";
import { Calendar, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePresence } from "@/hooks/use-presence";
import { useStats } from "@/hooks/use-stats";
import { useLiveTimer } from "@/hooks/use-timer";
import { formatDurationWords } from "@/lib/utils";
import { liveTodayMs } from "@/lib/live-timer";
import { cn } from "@/lib/utils";

const MEDALS = ["1", "2", "3"] as const;
const MAX_LOOKBACK_DAYS = 400;

function parseDayKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function DailyLeaderboard() {
  const { data: session } = useSession();
  const [day, setDay] = useState(() => localDayKey());
  const today = localDayKey();
  const isToday = day === today;
  const { leaderboard, isLoading: presenceLoading } = usePresence(day);
  const { data: stats, isLoading: statsLoading } = useStats();
  const { running, startTime } = useLiveTimer();
  const [now, setNow] = useState(() => Date.now());

  const rows = leaderboard.filter((row) => row.todayMs > 0 || (isToday && row.startTime));
  const anyoneLive = isToday && rows.some((row) => row.startTime);
  const liveClock = isToday && (anyoneLive || (running && Boolean(startTime)));

  useEffect(() => {
    if (!liveClock) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [liveClock]);

  const liveAll = isToday && running && startTime ? Math.max(0, now - startTime) : 0;
  const liveToday = isToday && running && startTime ? liveTodayMs(startTime, now) : 0;
  const yourRow = rows.find((row) => row.userId === session?.user?.id);
  const dayTotal = isToday
    ? (stats?.todayTotal ?? 0) + liveToday
    : yourRow?.todayMs ?? 0;
  const allTimeTotal = (stats?.grandTotal ?? 0) + liveAll;

  const label = useMemo(() => {
    if (isToday) return "Today";
    return format(parseDayKey(day), "EEE d MMM");
  }, [day, isToday]);

  const earliest = localDayKey(addDays(parseDayKey(today), -MAX_LOOKBACK_DAYS));

  if (presenceLoading && statsLoading && isToday) {
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
            <p className="text-base font-semibold">
              {isToday ? "Today’s leaderboard" : "Leaderboard"}
            </p>
            <p className="text-xs text-muted-foreground">
              {isToday
                ? anyoneLive
                  ? "Live times, updating as people track"
                  : "Who’s grinding the most today"
                : "How the grind looked that day"}
            </p>
            <div className="mt-2 inline-flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                aria-label="Previous day"
                disabled={day <= earliest}
                onClick={() => setDay(localDayKey(addDays(parseDayKey(day), -1)))}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <div className="inline-flex min-w-[8.5rem] items-center justify-center gap-1.5 rounded-md border border-input bg-background px-2.5 py-1 text-sm font-medium tabular-nums">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                {label}
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 w-8 p-0"
                aria-label="Next day"
                disabled={isToday}
                onClick={() => setDay(localDayKey(addDays(parseDayKey(day), 1)))}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <div className="flex shrink-0 gap-6 sm:text-right">
            <div>
              <p className="text-xs font-medium text-muted-foreground">{isToday ? "Today" : "That day"}</p>
              <p className="text-lg font-bold tabular-nums leading-tight">
                {formatDurationWords(dayTotal)}
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
        {rows.length > 0 ? (
          <ol className="space-y-2">
            {rows.map((row, index) => {
              const isLive = isToday && Boolean(row.startTime);
              const live = isLive && row.startTime ? liveTodayMs(row.startTime, now) : 0;
              const sessionMs = isLive && row.startTime ? Math.max(0, now - row.startTime) : 0;
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
        ) : (
          !presenceLoading && (
            <p className="text-sm text-muted-foreground">Nobody logged time that day.</p>
          )
        )}
      </CardContent>
    </Card>
  );
}
