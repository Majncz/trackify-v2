"use client";

import { useEffect, useState } from "react";
import { useStats } from "@/hooks/use-stats";
import { useLiveTimer } from "@/hooks/use-timer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDurationWords } from "@/lib/utils";
import { liveTodayMs } from "@/lib/live-timer";

export function StatsSummary() {
  const { data: stats, isLoading } = useStats();
  const { running, startTime } = useLiveTimer();
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!running || !startTime) return;
    const tick = () => setNow(Date.now());
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [running, startTime]);

  const liveAll = running && startTime ? Math.max(0, now - startTime) : 0;
  const liveToday = running && startTime ? liveTodayMs(startTime, now) : 0;

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-16" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-32" />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <Skeleton className="h-4 w-16" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-8 w-32" />
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">Today</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">
            {formatDurationWords((stats?.todayTotal ?? 0) + liveToday, {
              seconds: liveToday > 0,
            })}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-muted-foreground">All Time</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-2xl font-bold">
            {formatDurationWords((stats?.grandTotal ?? 0) + liveAll, {
              seconds: liveAll > 0,
            })}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
