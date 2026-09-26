"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  addMonths,
  endOfDay,
  endOfMonth,
  endOfWeek,
  format,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { useSocket } from "./use-socket";
import type { LeaderboardRange } from "@/lib/period-window";

function localDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDayKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function isCurrentPeriod(range: LeaderboardRange, day: string, today = localDayKey()) {
  const selected = parseDayKey(day);
  const now = parseDayKey(today);
  if (range === "week") {
    return (
      format(startOfWeek(selected, { weekStartsOn: 1 }), "yyyy-MM-dd") ===
      format(startOfWeek(now, { weekStartsOn: 1 }), "yyyy-MM-dd")
    );
  }
  if (range === "month") {
    return format(startOfMonth(selected), "yyyy-MM") === format(startOfMonth(now), "yyyy-MM");
  }
  return day === today;
}

export function periodBounds(range: LeaderboardRange, day: string) {
  const selected = parseDayKey(day);
  if (range === "week") {
    return {
      start: startOfWeek(selected, { weekStartsOn: 1 }),
      end: endOfWeek(selected, { weekStartsOn: 1 }),
    };
  }
  if (range === "month") {
    return { start: startOfMonth(selected), end: endOfMonth(selected) };
  }
  return { start: startOfDay(selected), end: endOfDay(selected) };
}

export function stepPeriod(range: LeaderboardRange, day: string, direction: -1 | 1) {
  const selected = parseDayKey(day);
  if (range === "week") {
    selected.setDate(selected.getDate() + 7 * direction);
    return localDayKey(selected);
  }
  if (range === "month") {
    return localDayKey(addMonths(selected, direction));
  }
  selected.setDate(selected.getDate() + direction);
  return localDayKey(selected);
}

export type PresenceEntry = {
  userId: string;
  name: string;
  taskName: string;
  startTime: number;
  todayMs: number;
};

export type LeaderboardEntry = {
  userId: string;
  name: string;
  todayMs: number;
  startTime: number | null;
  taskName: string | null;
};

export function usePresence(day: string, range: LeaderboardRange = "day") {
  const queryClient = useQueryClient();
  const { on } = useSocket();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const current = isCurrentPeriod(range, day);

  const query = useQuery<{
    tracking: PresenceEntry[];
    leaderboard: LeaderboardEntry[];
    day: string;
    range: LeaderboardRange;
    isToday: boolean;
    isCurrent: boolean;
  }>({
    queryKey: ["presence", range, day],
    queryFn: async () => {
      const res = await fetch(
        `/api/presence?timezone=${encodeURIComponent(timezone)}&day=${encodeURIComponent(day)}&range=${encodeURIComponent(range)}`
      );
      if (!res.ok) throw new Error("Failed to load who's tracking");
      return res.json();
    },
    refetchInterval: current ? 15_000 : false,
    refetchIntervalInBackground: true,
    staleTime: 0,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
    placeholderData: keepPreviousData,
  });

  useEffect(() => {
    return on("presence:changed", () => {
      queryClient.invalidateQueries({ queryKey: ["presence"] });
    });
  }, [on, queryClient]);

  return {
    tracking: query.data?.tracking ?? [],
    leaderboard: query.data?.leaderboard ?? [],
    isToday: query.data?.isToday ?? current,
    isCurrent: query.data?.isCurrent ?? current,
    isLoading: query.isLoading,
  };
}

export type { LeaderboardRange };
