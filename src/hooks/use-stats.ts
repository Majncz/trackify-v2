"use client";

import { useQuery } from "@tanstack/react-query";

interface TaskStats {
  taskId: string;
  taskName: string;
  totalTime: number;
  todayTime: number;
}

interface Stats {
  tasks: TaskStats[];
  grandTotal: number;
  todayTotal: number;
}

function getUserTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export function useStats() {
  return useQuery<Stats>({
    queryKey: ["stats"],
    queryFn: async () => {
      const timezone = getUserTimezone();
      const res = await fetch(`/api/stats?timezone=${encodeURIComponent(timezone)}`);
      if (!res.ok) throw new Error("Failed to fetch stats");
      return res.json();
    },
    refetchInterval: 60000, // Refetch every minute
  });
}
