"use client";

import { DailyLeaderboard } from "./daily-leaderboard";
import { NowTracking } from "./now-tracking";

export function TeamPulse() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <NowTracking />
      <DailyLeaderboard />
    </div>
  );
}
