"use client";

import { useQuery } from "@tanstack/react-query";
import type { RaceEvent, RaceUser } from "@/lib/bar-race";

export type RaceData = {
  from: string;
  to: string;
  rangeStart: number;
  rangeEnd: number;
  users: RaceUser[];
  events: RaceEvent[];
};

export function useRaceData(from: string, to: string) {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  return useQuery<RaceData>({
    queryKey: ["viz-race", from, to, timezone],
    queryFn: async () => {
      const res = await fetch(
        `/api/visualizations/race?timezone=${encodeURIComponent(timezone)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`
      );
      if (!res.ok) throw new Error("Failed to load visualization");
      return res.json();
    },
    staleTime: 30_000,
  });
}
