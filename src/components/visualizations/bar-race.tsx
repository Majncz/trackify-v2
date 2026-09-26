"use client";

import { useMemo } from "react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  formatRaceDuration,
  indexEvents,
  initials,
  totalsAt,
  type RaceEvent,
  type RaceUser,
} from "@/lib/bar-race";

const ROW_HEIGHT = 64;
const BAR_MAX_PCT = 78;

export function BarRace({
  users,
  events,
  rangeStart,
  rangeEnd,
  playhead,
}: {
  users: RaceUser[];
  events: RaceEvent[];
  rangeStart: number;
  rangeEnd: number;
  playhead: number;
}) {
  const eventsByUser = useMemo(() => indexEvents(events), [events]);
  const span = Math.max(1, rangeEnd - rangeStart);
  const at = rangeStart + span * playhead;
  const rows = useMemo(
    () => totalsAt(eventsByUser, users, rangeStart, at),
    [at, eventsByUser, rangeStart, users]
  );
  const maxMs = Math.max(rows[0]?.ms ?? 0, 1);
  const clock = new Date(at);
  const stageHeight = Math.max(rows.length, 1) * ROW_HEIGHT;

  return (
    <div className="relative overflow-hidden rounded-xl border bg-[#f7f7f5]">
      <div
        className="relative px-3 pb-36 pt-5 sm:px-6 sm:pt-6"
        style={{ minHeight: stageHeight + 168 }}
      >
        <p className="mb-4 text-[11px] font-semibold uppercase tracking-[0.2em] text-zinc-400">
          Hours worked
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Waiting for the first minutes to land…</p>
        ) : (
          <div className="relative" style={{ height: stageHeight }}>
            {rows.map((row, index) => {
              const width = row.ms <= 0 ? 0 : Math.max(3, (row.ms / maxMs) * BAR_MAX_PCT);
              return (
                <div
                  key={row.id}
                  className="absolute inset-x-0 flex items-center gap-2 will-change-transform motion-reduce:transition-none sm:gap-3"
                  style={{
                    height: ROW_HEIGHT,
                    transform: `translateY(${index * ROW_HEIGHT}px)`,
                    transition: "transform 0.7s cubic-bezier(0.22, 1, 0.36, 1)",
                    zIndex: rows.length - index,
                  }}
                >
                  <span
                    className={cn(
                      "w-5 shrink-0 text-right text-sm font-bold tabular-nums",
                      index === 0 && "text-amber-600",
                      index === 1 && "text-zinc-500",
                      index === 2 && "text-amber-800",
                      index > 2 && "text-zinc-400"
                    )}
                  >
                    {index + 1}
                  </span>
                  <span
                    className="w-[4.75rem] shrink-0 truncate text-[13px] font-semibold text-zinc-800 sm:w-40 sm:text-sm"
                    title={row.name}
                  >
                    {row.name}
                  </span>
                  <div className="relative min-h-10 min-w-0 flex-1">
                    <div
                      className="absolute inset-y-[10px] left-0 right-[4.5rem] rounded-sm bg-zinc-200/50"
                      aria-hidden
                    />
                    <div
                      className="absolute inset-y-[10px] left-0 rounded-sm"
                      style={{
                        width: `${width}%`,
                        background: row.color,
                        boxShadow: `0 8px 18px -12px ${row.color}`,
                      }}
                    >
                      <span
                        className="absolute right-0 top-1/2 flex h-9 w-9 -translate-y-1/2 translate-x-1/2 items-center justify-center rounded-md border-[3px] border-white text-[11px] font-bold text-white shadow-md"
                        style={{ backgroundColor: row.color }}
                        aria-hidden
                      >
                        {initials(row.name)}
                      </span>
                    </div>
                    <span
                      className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[15px] font-semibold tabular-nums text-zinc-900 sm:text-lg"
                      style={{ left: `calc(${width}% + 1.85rem)` }}
                    >
                      {formatRaceDuration(row.ms)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <div className="pointer-events-none absolute bottom-5 right-5 text-right sm:bottom-6 sm:right-7">
          <p className="text-sm font-medium text-zinc-400 sm:text-base">
            {format(clock, "EEEE")}
          </p>
          <p className="text-4xl font-bold tabular-nums leading-none tracking-tight text-zinc-800 sm:text-6xl">
            {format(clock, "d MMM")}
          </p>
          <p className="mt-1 text-xl font-medium tabular-nums text-zinc-400 sm:text-3xl">
            {format(clock, "HH:mm")}
          </p>
          <p className="mt-2 text-[10px] font-semibold uppercase tracking-[0.24em] text-zinc-400">
            Trackify
          </p>
        </div>
      </div>
    </div>
  );
}
