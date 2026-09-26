"use client";

import { useEffect, useMemo, useState } from "react";
import { useSession } from "next-auth/react";
import { format } from "date-fns";
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import {
  isCurrentPeriod,
  periodBounds,
  stepPeriod,
  usePresence,
  type LeaderboardRange,
} from "@/hooks/use-presence";
import { useStats } from "@/hooks/use-stats";
import { useLiveTimer } from "@/hooks/use-timer";
import { formatDurationWords } from "@/lib/utils";
import { liveRangeMs } from "@/lib/live-timer";
import { cn } from "@/lib/utils";

const MEDALS = ["1", "2", "3"] as const;
const RANGES: { id: LeaderboardRange; label: string }[] = [
  { id: "day", label: "Daily" },
  { id: "week", label: "Weekly" },
  { id: "month", label: "Monthly" },
];

function parseDayKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function localDayKey(date = new Date()) {
  return format(date, "yyyy-MM-dd");
}

function rangeNoun(range: LeaderboardRange) {
  if (range === "week") return "week";
  if (range === "month") return "month";
  return "day";
}

function yourPeriodLabel(range: LeaderboardRange, isCurrent: boolean) {
  if (range === "week") return isCurrent ? "Your week" : "You that week";
  if (range === "month") return isCurrent ? "Your month" : "You that month";
  return isCurrent ? "Your today" : "You that day";
}

export function DailyLeaderboard() {
  const { data: session } = useSession();
  const [day, setDay] = useState(() => localDayKey());
  const [range, setRange] = useState<LeaderboardRange>("day");
  const [pickerOpen, setPickerOpen] = useState(false);
  const today = localDayKey();
  const isCurrent = isCurrentPeriod(range, day, today);
  const { leaderboard, isLoading: presenceLoading } = usePresence(day, range);
  const { data: stats, isLoading: statsLoading } = useStats();
  const { running, startTime } = useLiveTimer();
  const [now, setNow] = useState(() => Date.now());
  const bounds = periodBounds(range, day);

  const rows = leaderboard.filter((row) => row.todayMs > 0 || (isCurrent && row.startTime));
  const anyoneLive = isCurrent && rows.some((row) => row.startTime);
  const liveClock = isCurrent && (anyoneLive || (running && Boolean(startTime)));

  useEffect(() => {
    if (!liveClock) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [liveClock]);

  const liveAll = isCurrent && running && startTime ? Math.max(0, now - startTime) : 0;
  const liveYou =
    isCurrent && running && startTime ? liveRangeMs(startTime, now, bounds.start, bounds.end) : 0;
  const yourRow = rows.find((row) => row.userId === session?.user?.id);
  const yourTotal =
    range === "day" && isCurrent
      ? (stats?.todayTotal ?? 0) + liveYou
      : (yourRow?.todayMs ?? 0) + liveYou;
  const allTimeTotal = (stats?.grandTotal ?? 0) + liveAll;

  const label = useMemo(() => {
    const selected = parseDayKey(day);
    if (range === "week") {
      if (isCurrent) return "This week";
      const { start, end } = periodBounds("week", day);
      if (start.getMonth() === end.getMonth()) {
        return `${format(start, "d")}–${format(end, "d MMM")}`;
      }
      return `${format(start, "d MMM")} – ${format(end, "d MMM")}`;
    }
    if (range === "month") {
      return isCurrent ? "This month" : format(selected, "MMM yyyy");
    }
    if (isCurrent) return "Today";
    return format(selected, "EEE d MMM");
  }, [day, isCurrent, range]);

  const title = isCurrent
    ? range === "week"
      ? "This week’s leaderboard"
      : range === "month"
        ? "This month’s leaderboard"
        : "Today’s leaderboard"
    : "Leaderboard";

  const subtitle = isCurrent
    ? anyoneLive
      ? "Live times, updating as people track"
      : range === "day"
        ? "Who’s grinding the most today"
        : `Who’s grinding the most this ${rangeNoun(range)}`
    : `How the grind looked that ${rangeNoun(range)}`;

  const pickDay = (next: string) => {
    if (!next) return;
    setDay(next > today ? today : next);
  };

  if (presenceLoading && statsLoading && isCurrent && range === "day") {
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
            <p className="text-base font-semibold">{title}</p>
            <p className="text-xs text-muted-foreground">{subtitle}</p>
          </div>
          <div className="inline-flex shrink-0 items-center gap-1 self-start">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              aria-label={`Previous ${rangeNoun(range)}`}
              onClick={() => pickDay(stepPeriod(range, day, -1))}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="inline-flex h-8 items-center rounded-md border border-input bg-background shadow-sm">
              <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    className="flex h-8 w-8 items-center justify-center border-r border-input text-muted-foreground hover:text-foreground"
                    aria-label={label}
                    title={label}
                  >
                    <CalendarIcon className="h-3.5 w-3.5" />
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="end">
                  <Calendar
                    mode="single"
                    selected={parseDayKey(day)}
                    onSelect={(date) => {
                      if (!date) return;
                      pickDay(localDayKey(date));
                      setPickerOpen(false);
                    }}
                    disabled={{ after: new Date() }}
                    captionLayout="dropdown"
                    startMonth={new Date(2018, 0)}
                    endMonth={new Date()}
                  />
                </PopoverContent>
              </Popover>
              <div
                className="inline-flex items-center p-0.5"
                role="tablist"
                aria-label="Leaderboard range"
              >
                {RANGES.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="tab"
                    aria-selected={range === item.id}
                    className={cn(
                      "h-7 rounded-sm px-2 text-xs font-medium transition-colors",
                      range === item.id
                        ? "bg-muted text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                    onClick={() => setRange(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              aria-label={`Next ${rangeNoun(range)}`}
              disabled={isCurrent}
              onClick={() => pickDay(stepPeriod(range, day, 1))}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
        {rows.length > 0 ? (
          <ol className="space-y-2">
            {rows.map((row, index) => {
              const isLive = isCurrent && Boolean(row.startTime);
              const live =
                isLive && row.startTime
                  ? liveRangeMs(row.startTime, now, bounds.start, bounds.end)
                  : 0;
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
            <p className="text-sm text-muted-foreground">
              Nobody logged time that {rangeNoun(range)}.
            </p>
          )
        )}
        <div className="flex items-end justify-between gap-4 border-t pt-3">
          <div>
            <p className="text-xs font-medium text-muted-foreground">
              {yourPeriodLabel(range, isCurrent)}
            </p>
            <p className="text-lg font-bold tabular-nums leading-tight">
              {formatDurationWords(yourTotal)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-medium text-muted-foreground">All time</p>
            <p className="text-lg font-bold tabular-nums leading-tight">
              {statsLoading ? "—" : formatDurationWords(allTimeTotal)}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
