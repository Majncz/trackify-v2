"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { Calendar as CalendarIcon, Pause, Play, RotateCcw } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { BarRace } from "@/components/visualizations/bar-race";
import { useRaceData } from "@/hooks/use-race-data";
import { formatPlayClock } from "@/lib/bar-race";
import { cn } from "@/lib/utils";

type Preset = "past-week" | "this-week" | "this-month" | "past-month" | "custom";

const PRESETS: { id: Preset; label: string }[] = [
  { id: "past-week", label: "Past week" },
  { id: "this-week", label: "This week" },
  { id: "this-month", label: "This month" },
  { id: "past-month", label: "Last month" },
  { id: "custom", label: "Custom" },
];

const DURATIONS = [
  { ms: 30_000, label: "30s" },
  { ms: 60_000, label: "1 min" },
  { ms: 120_000, label: "2 min" },
];

function dayKey(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function parseDayKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function rangeForPreset(preset: Preset, customFrom: string, customTo: string) {
  const now = new Date();
  if (preset === "this-week") {
    return { from: dayKey(startOfWeek(now, { weekStartsOn: 1 })), to: dayKey(now) };
  }
  if (preset === "this-month") {
    return { from: dayKey(startOfMonth(now)), to: dayKey(now) };
  }
  if (preset === "past-month") {
    const last = addMonths(startOfMonth(now), -1);
    return { from: dayKey(last), to: dayKey(endOfMonth(last)) };
  }
  if (preset === "custom") {
    return { from: customFrom, to: customTo };
  }
  return { from: dayKey(addDays(now, -6)), to: dayKey(now) };
}

export function VisualizationsClient() {
  const today = dayKey(new Date());
  const [preset, setPreset] = useState<Preset>("past-week");
  const [customFrom, setCustomFrom] = useState(() => dayKey(addDays(new Date(), -6)));
  const [customTo, setCustomTo] = useState(today);
  const [fromOpen, setFromOpen] = useState(false);
  const [toOpen, setToOpen] = useState(false);
  const [durationMs, setDurationMs] = useState(60_000);
  const [playing, setPlaying] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const playheadRef = useRef(0);

  const range = useMemo(
    () => rangeForPreset(preset, customFrom, customTo),
    [customFrom, customTo, preset]
  );
  const { data, isLoading, isError } = useRaceData(range.from, range.to);

  useEffect(() => {
    playheadRef.current = 0;
    setPlayhead(0);
    setPlaying(false);
  }, [range.from, range.to]);

  useEffect(() => {
    playheadRef.current = playhead;
  }, [playhead]);

  useEffect(() => {
    if (!playing) return;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const next = Math.min(1, playheadRef.current + (now - last) / durationMs);
      last = now;
      playheadRef.current = next;
      setPlayhead(next);
      if (next >= 1) {
        setPlaying(false);
        return;
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [durationMs, playing]);

  const togglePlay = () => {
    if (playheadRef.current >= 1) {
      playheadRef.current = 0;
      setPlayhead(0);
    }
    setPlaying((value) => !value);
  };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.code !== "Space") return;
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(target.tagName)) return;
      event.preventDefault();
      if (playheadRef.current >= 1) {
        playheadRef.current = 0;
        setPlayhead(0);
      }
      setPlaying((value) => !value);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const restart = () => {
    playheadRef.current = 0;
    setPlayhead(0);
    setPlaying(true);
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-4 py-4">
          <div
            className="flex flex-wrap gap-1.5"
            role="tablist"
            aria-label="Date range"
          >
            {PRESETS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-selected={preset === item.id}
                className={cn(
                  "h-8 rounded-md px-2.5 text-xs font-medium transition-colors",
                  preset === item.id
                    ? "bg-zinc-900 text-white"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                )}
                onClick={() => setPreset(item.id)}
              >
                {item.label}
              </button>
            ))}
          </div>
          {preset === "custom" && (
            <div className="flex flex-wrap items-center gap-2">
              <DateButton
                open={fromOpen}
                onOpenChange={setFromOpen}
                value={customFrom}
                max={customTo}
                onChange={setCustomFrom}
                label="From"
              />
              <span className="text-xs text-muted-foreground">to</span>
              <DateButton
                open={toOpen}
                onOpenChange={setToOpen}
                value={customTo}
                min={customFrom}
                max={today}
                onChange={setCustomTo}
                label="To"
              />
            </div>
          )}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={togglePlay}
                disabled={isLoading || isError}
                aria-pressed={playing}
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {playing ? "Pause" : playhead >= 1 ? "Play again" : "Play"}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={restart}
                disabled={isLoading || isError}
                aria-label="Restart"
              >
                <RotateCcw className="h-4 w-4" />
              </Button>
              <span className="text-xs font-medium tabular-nums text-muted-foreground">
                {formatPlayClock(playhead * durationMs)} / {formatPlayClock(durationMs)}
              </span>
            </div>
            <div className="inline-flex h-8 items-center rounded-md bg-muted p-0.5">
              {DURATIONS.map((item) => (
                <button
                  key={item.ms}
                  type="button"
                  className={cn(
                    "h-7 rounded-sm px-2.5 text-xs font-medium",
                    durationMs === item.ms
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setDurationMs(item.ms)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(playhead * 1000)}
            onChange={(event) => {
              const next = Number(event.target.value) / 1000;
              playheadRef.current = next;
              setPlayhead(next);
              setPlaying(false);
            }}
            className="w-full accent-zinc-900"
            aria-label="Scrub visualization"
            disabled={isLoading || isError}
          />
        </CardContent>
      </Card>

      {isLoading ? (
        <Skeleton className="h-[28rem] w-full rounded-xl" />
      ) : isError || !data ? (
        <p className="text-sm text-muted-foreground">Couldn’t load the race. Try another range.</p>
      ) : data.events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody logged time in this range.</p>
      ) : (
        <BarRace
          users={data.users}
          events={data.events}
          rangeStart={data.rangeStart}
          rangeEnd={data.rangeEnd}
          playhead={playhead}
        />
      )}
    </div>
  );
}

function DateButton({
  open,
  onOpenChange,
  value,
  min,
  max,
  onChange,
  label,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: string;
  min?: string;
  max?: string;
  onChange: (next: string) => void;
  label: string;
}) {
  const selected = parseDayKey(value);
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="gap-1.5 font-medium">
          <CalendarIcon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{label}</span>
          {format(selected, "d MMM")}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="single"
          selected={selected}
          onSelect={(date) => {
            if (!date) return;
            onChange(dayKey(date));
            onOpenChange(false);
          }}
          disabled={[
            ...(min ? [{ before: parseDayKey(min) }] : []),
            ...(max ? [{ after: parseDayKey(max) }] : []),
          ]}
          captionLayout="dropdown"
          startMonth={new Date(2018, 0)}
          endMonth={new Date()}
        />
      </PopoverContent>
    </Popover>
  );
}
