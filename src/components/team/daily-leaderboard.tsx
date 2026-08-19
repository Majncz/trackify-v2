"use client";

import { useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { Card, CardContent } from "@/components/ui/card";
import { usePresence } from "@/hooks/use-presence";
import { formatDurationWords } from "@/lib/utils";
import { liveTodayMs } from "@/lib/live-timer";
import { cn } from "@/lib/utils";

const MEDALS = ["1", "2", "3"] as const;

export function DailyLeaderboard() {
  const { data: session } = useSession();
  const { leaderboard, isLoading } = usePresence();
  const [now, setNow] = useState(() => Date.now());

  const rows = leaderboard.filter((row) => row.todayMs > 0 || row.startTime);
  const anyoneLive = rows.some((row) => row.startTime);

  useEffect(() => {
    if (!anyoneLive) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anyoneLive]);

  if (isLoading || rows.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div>
          <p className="text-base font-semibold">Today’s leaderboard</p>
          <p className="text-xs text-muted-foreground">
            {anyoneLive ? "Live times, updating as people track" : "Who’s grinding the most today"}
          </p>
        </div>
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
      </CardContent>
    </Card>
  );
}
