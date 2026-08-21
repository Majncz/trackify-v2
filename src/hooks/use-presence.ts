"use client";

import { useEffect } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import { useSocket } from "./use-socket";

function localDayKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

export function usePresence(day: string) {
  const queryClient = useQueryClient();
  const { on } = useSocket();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  const query = useQuery<{
    tracking: PresenceEntry[];
    leaderboard: LeaderboardEntry[];
    day: string;
    isToday: boolean;
  }>({
    queryKey: ["presence", day],
    queryFn: async () => {
      const res = await fetch(
        `/api/presence?timezone=${encodeURIComponent(timezone)}&day=${encodeURIComponent(day)}`
      );
      if (!res.ok) throw new Error("Failed to load who's tracking");
      return res.json();
    },
    refetchInterval: day === localDayKey() ? 15_000 : false,
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
    isToday: query.data?.isToday ?? true,
    isLoading: query.isLoading,
  };
}
