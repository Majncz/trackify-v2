"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDurationWords } from "@/lib/utils";
import { useTasks } from "@/hooks/use-tasks";
import { cn } from "@/lib/utils";

interface AdjustTimerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentStartTime: number;
  onSave: (session: { startTime: number; endTime: number | null }) => Promise<void>;
  onClearError?: () => void;
  isSaving?: boolean;
  error?: string | null;
}

type DragKind = "start" | "end" | null;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const MIN_DURATION = MINUTE;
const NOW_MAGNET = 75 * 1000;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function snapMinute(ms: number) {
  return Math.round(ms / MINUTE) * MINUTE;
}

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function agoLabel(ms: number, now: number) {
  const mins = Math.max(0, Math.round((now - ms) / MINUTE));
  if (mins <= 0) return "now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (rest === 0) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  return `${hours}h ${rest}m ago`;
}

function rangeStartFor(start: number, now: number) {
  const earliest = now - 12 * HOUR;
  const padded = Math.min(start - HOUR, now - 3 * HOUR);
  return Math.max(earliest, padded);
}

function pct(time: number, from: number, to: number) {
  return clamp(((time - from) / Math.max(1, to - from)) * 100, 0, 100);
}

export function AdjustTimerDialog({
  open,
  onOpenChange,
  currentStartTime,
  onSave,
  onClearError,
  isSaving = false,
  error,
}: AdjustTimerDialogProps) {
  const { tasks } = useTasks();
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragKind>(null);
  const onClearErrorRef = useRef(onClearError);
  const [now, setNow] = useState(() => Date.now());
  const [startTime, setStartTime] = useState(currentStartTime);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [dragging, setDragging] = useState<DragKind>(null);

  useEffect(() => {
    onClearErrorRef.current = onClearError;
  }, [onClearError]);

  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    setStartTime(currentStartTime);
    setEndTime(null);
    onClearErrorRef.current?.();
  }, [open, currentStartTime]);

  useEffect(() => {
    if (!open || dragging) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open, dragging]);

  const from = rangeStartFor(Math.min(currentStartTime, startTime), now);
  const effectiveEnd = endTime ?? now;
  const stillRunning = endTime == null;
  const durationMs = Math.max(0, effectiveEnd - startTime);
  const startPct = pct(startTime, from, now);
  const endPct = pct(effectiveEnd, from, now);

  const overlapName = useMemo(() => {
    for (const task of tasks) {
      for (const event of task.events) {
        const eventStart = new Date(event.from).getTime();
        const eventEnd = new Date(event.to).getTime();
        if (startTime < eventEnd && eventStart < effectiveEnd) {
          return `${task.name}: ${event.name}`;
        }
      }
    }
    return null;
  }, [tasks, startTime, effectiveEnd]);

  const applyDrag = useCallback(
    (kind: DragKind, clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || !kind) return;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      const at = snapMinute(from + ratio * (now - from));

      if (kind === "start") {
        setStartTime(clamp(at, from, effectiveEnd - MIN_DURATION));
        return;
      }

      if (at >= now - NOW_MAGNET) {
        setEndTime(null);
        return;
      }
      setEndTime(clamp(at, startTime + MIN_DURATION, now));
    },
    [effectiveEnd, from, now, startTime]
  );

  const onThumbDown = (kind: DragKind) => (event: React.PointerEvent) => {
    if (isSaving) return;
    event.preventDefault();
    event.stopPropagation();
    dragRef.current = kind;
    setDragging(kind);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => applyDrag(dragRef.current, event.clientX);
    const up = () => {
      dragRef.current = null;
      setDragging(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [applyDrag, dragging]);

  const onTrackDown = (event: React.PointerEvent) => {
    if (isSaving) return;
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const ratio = clamp((event.clientX - rect.left) / rect.width, 0, 1);
    const startDist = Math.abs(ratio * 100 - startPct);
    const endDist = Math.abs(ratio * 100 - endPct);
    const kind: DragKind = startDist <= endDist ? "start" : "end";
    dragRef.current = kind;
    setDragging(kind);
    applyDrag(kind, event.clientX);
  };

  const handleSave = async () => {
    try {
      await onSave({ startTime, endTime });
      onOpenChange(false);
    } catch {
      // Parent shows the error
    }
  };

  const outcome = stillRunning
    ? `Keep running. It will look like you started at ${clock(startTime)}.`
    : `Stop the timer as if you finished ${agoLabel(effectiveEnd, now)} (${clock(effectiveEnd)}).`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Fix this session</DialogTitle>
        <DialogDescription>
          Left knob is when you started. Right knob is when you stopped. Leave the
          right one on Now if you are still working.
        </DialogDescription>

        <div className="space-y-6 pt-2">
          <div>
            <p className="font-mono text-4xl font-semibold tabular-nums tracking-tight">
              {formatDurationWords(durationMs)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {stillRunning
                ? `Started ${clock(startTime)} · still running`
                : `Started ${clock(startTime)} · stopped ${clock(effectiveEnd)}`}
            </p>
          </div>

          <div className="space-y-3">
            <div
              ref={trackRef}
              className="relative h-12 touch-none select-none"
              onPointerDown={onTrackDown}
            >
              <div className="absolute top-1/2 right-0 left-0 h-2 -translate-y-1/2 rounded-full bg-muted" />
              <div
                className={cn(
                  "absolute top-1/2 h-2 -translate-y-1/2 rounded-full",
                  overlapName ? "bg-destructive" : "bg-primary"
                )}
                style={{ left: `${startPct}%`, width: `${Math.max(1, endPct - startPct)}%` }}
              />
              <Thumb
                pct={startPct}
                active={dragging === "start"}
                label="Start"
                onPointerDown={onThumbDown("start")}
              />
              <Thumb
                pct={endPct}
                active={dragging === "end"}
                label={stillRunning ? "Now" : "Stop"}
                emphasis={stillRunning}
                onPointerDown={onThumbDown("end")}
              />
            </div>

            <div className="flex items-start justify-between gap-4 text-sm">
              <div>
                <p className="font-medium">Started</p>
                <p className="font-mono tabular-nums">{clock(startTime)}</p>
                <p className="text-muted-foreground">{agoLabel(startTime, now)}</p>
              </div>
              <div className="text-right">
                <p className="font-medium">{stillRunning ? "Still running" : "Stopped"}</p>
                <p className="font-mono tabular-nums">
                  {stillRunning ? "Now" : clock(effectiveEnd)}
                </p>
                <p className="text-muted-foreground">
                  {stillRunning ? "Drag left to stop earlier" : agoLabel(effectiveEnd, now)}
                </p>
              </div>
            </div>
          </div>

          <p className="rounded-lg bg-muted px-3 py-2 text-sm">{outcome}</p>

          {(error || overlapName) && (
            <p className="text-sm text-destructive">
              {error || `This overlaps “${overlapName}”. Move a knob off that time.`}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving || Boolean(overlapName)}>
              {isSaving ? "Saving…" : stillRunning ? "Save start time" : `Stop ${agoLabel(effectiveEnd, now)}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Thumb({
  pct: position,
  active,
  label,
  emphasis = false,
  onPointerDown,
}: {
  pct: number;
  active: boolean;
  label: string;
  emphasis?: boolean;
  onPointerDown: (event: React.PointerEvent) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className={cn(
        "absolute top-1/2 z-10 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 bg-background shadow-md",
        emphasis ? "border-rose-500 text-rose-600" : "border-primary",
        active && "scale-110"
      )}
      style={{ left: `${position}%` }}
      onPointerDown={onPointerDown}
    >
      <span className="text-[10px] font-bold leading-none">{label}</span>
    </button>
  );
}
