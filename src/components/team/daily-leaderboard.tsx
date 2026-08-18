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

  const anyoneLive = leaderboard.some((row) => row.startTime);

  useEffect(() => {
    if (!anyoneLive) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [anyoneLive]);

  if (isLoading || leaderboard.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardContent className="py-4 space-y-3">
        <div>
          <p className="text-base font-semibold">Today’s leaderboard</p>
          <p className="text-xs text-muted-foreground">Who’s grinding the most today</p>
        </div>
        <ol className="space-y-2">
          {leaderboard.map((row, index) => {
            const live = row.startTime ? liveTodayMs(row.startTime, now) : 0;
            const total = row.todayMs + live;
            const isYou = row.userId === session?.user?.id;
            return (
              <li
                key={row.userId}
                className={cn(
                  "flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 min-w-0",
                  isYou && "bg-primary/5"
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
                    <p className="text-sm font-medium truncate">
                      {row.name}
                      {isYou ? " · you" : ""}
                    </p>
                    {row.taskName && (
                      <p className="text-xs text-muted-foreground truncate">
                        Live on {row.taskName}
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
