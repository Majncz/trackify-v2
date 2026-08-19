"use client";

import { Input } from "@/components/ui/input";
import {
  MIN_DURATION,
  agoLabel,
  clamp,
  maxEndForStart,
  minStartForEnd,
  snapMinute,
  type BusySpan,
} from "@/components/timer/session-range-slider";

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function dateValue(ms: number) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeValue(ms: number) {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromParts(date: string, time: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time.split(":").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
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
  const apply = (date: string, time: string) => {
    if (!date || !time) return;
    const raw = snapMinute(fromParts(date, time));
    if (Number.isNaN(raw)) return;
    onChange(clamp(raw, min, max));
  };

  return (
    <div className={align === "right" ? "text-right" : undefined}>
      <p className="text-muted-foreground">{label}</p>
      <div className={align === "right" ? "flex flex-col items-end gap-1" : "flex flex-col gap-1"}>
        <Input
          type="date"
          value={dateValue(value)}
          onChange={(e) => apply(e.target.value, timeValue(value))}
          className="h-9 w-[10.5rem] font-mono text-sm"
        />
        <Input
          type="time"
          value={timeValue(value)}
          onChange={(e) => apply(dateValue(value), e.target.value)}
          className="h-9 w-[10.5rem] font-mono text-sm"
        />
      </div>
      <p className="mt-1 text-muted-foreground">{agoLabel(value, now)}</p>
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
