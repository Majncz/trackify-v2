"use client";

import { useEffect, useRef, useState } from "react";
import { Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { focusControl } from "@/lib/focus-style";
import {
  MIN_DURATION,
  agoLabel,
  clamp,
  maxEndForStart,
  minStartForEnd,
  snapMinute,
  type BusySpan,
} from "@/components/timer/session-range-slider";

const HOURS = Array.from({ length: 24 }, (_, i) => i);
const MINUTES = Array.from({ length: 60 }, (_, i) => i);

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function timeValue(ms: number) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function clockOnDay(base: number, hours: number, minutes: number, dayOffset: number) {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hours, minutes, 0, 0);
  return snapMinute(d.getTime());
}

function resolveClock(base: number, hours: number, minutes: number, min: number, max: number) {
  const candidates = [0, -1, 1, -2]
    .map((offset) => clockOnDay(base, hours, minutes, offset))
    .filter((stamp) => stamp >= min && stamp <= max);
  if (candidates.length === 0) {
    return clamp(clockOnDay(base, hours, minutes, 0), min, max);
  }
  candidates.sort((a, b) => Math.abs(a - base) - Math.abs(b - base));
  return candidates[0];
}

function Wheel({
  values,
  selected,
  onPick,
}: {
  values: number[];
  selected: number;
  onPick: (n: number) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = listRef.current;
    if (!root) return;
    const active = root.querySelector<HTMLElement>("[data-active='true']");
    active?.scrollIntoView({ block: "center" });
  }, [selected]);

  return (
    <div ref={listRef} className="h-40 w-14 overflow-y-auto overscroll-contain py-1">
      {values.map((n) => {
        const active = n === selected;
        return (
          <button
            key={n}
            type="button"
            data-active={active}
            className={cn(
              "flex h-8 w-full items-center justify-center font-mono text-sm tabular-nums",
              active
                ? "bg-primary text-primary-foreground"
                : "text-foreground hover:bg-muted"
            )}
            onClick={() => onPick(n)}
          >
            {pad(n)}
          </button>
        );
      })}
    </div>
  );
}

export function SessionStampField({
  label,
  value,
  min,
  max,
  align = "left",
  now,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  align?: "left" | "right";
  now: number;
  onChange: (next: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [blocked, setBlocked] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<{ hour: number; minute: number } | null>(null);
  const hour = new Date(value).getHours();
  const minute = new Date(value).getMinutes();

  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    const landed = new Date(value);
    setBlocked(landed.getHours() !== pending.hour || landed.getMinutes() !== pending.minute);
  }, [value]);

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  const pick = (nextHour: number, nextMinute: number) => {
    pendingRef.current = { hour: nextHour, minute: nextMinute };
    const next = resolveClock(value, nextHour, nextMinute, min, max);
    onChange(next);
    if (next === value) {
      pendingRef.current = null;
      const landed = new Date(value);
      setBlocked(landed.getHours() !== nextHour || landed.getMinutes() !== nextMinute);
    }
  };

  return (
    <div ref={rootRef} className={cn("relative", align === "right" && "text-right")}>
      <p className="text-muted-foreground">{label}</p>
      <button
        type="button"
        className={cn(
          "mt-1 inline-flex h-9 w-[7.5rem] items-center justify-between rounded-md border border-input bg-background px-3 font-mono text-sm tabular-nums shadow-sm",
          focusControl
        )}
        aria-label={`${label} time`}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {timeValue(value)}
        <Clock className="h-3.5 w-3.5 text-muted-foreground" />
      </button>
      {open && (
        <div
          className={cn(
            "absolute z-[60] mb-1 flex overflow-hidden rounded-md border bg-popover shadow-md",
            align === "right" ? "right-0 bottom-full" : "left-0 bottom-full"
          )}
        >
          <Wheel values={HOURS} selected={hour} onPick={(h) => pick(h, minute)} />
          <div className="w-px bg-border" />
          <Wheel values={MINUTES} selected={minute} onPick={(m) => pick(hour, m)} />
        </div>
      )}
      <p className="mt-1 text-muted-foreground">
        {blocked ? "That time overlaps other work" : agoLabel(value, now)}
      </p>
    </div>
  );
}

export function clampTypedStart(
  next: number,
  end: number,
  busy: BusySpan[],
  earliest: number
) {
  return clamp(next, minStartForEnd(end, busy, earliest), end - MIN_DURATION);
}

export function clampTypedEnd(
  next: number,
  start: number,
  busy: BusySpan[],
  latest: number
) {
  return clamp(next, start + MIN_DURATION, maxEndForStart(start, busy, latest));
}
