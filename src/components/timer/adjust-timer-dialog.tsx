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

interface BusySpan {
  from: number;
  to: number;
  name: string;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const MIN_DURATION = MINUTE;
const NOW_MAGNET = 75 * 1000;
const THUMB = 28;

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

function minStartForEnd(end: number, busy: BusySpan[], windowStart: number) {
  let min = windowStart;
  for (const span of busy) {
    if (span.from < end) min = Math.max(min, span.to);
  }
  return min;
}

function maxEndForStart(start: number, busy: BusySpan[], now: number) {
  let max = now;
  for (const span of busy) {
    if (span.to > start) max = Math.min(max, span.from);
  }
  return max;
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
  const [width, setWidth] = useState(0);
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
    if (!open) return;
    const node = trackRef.current;
    if (!node) return;
    const measure = () => setWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [open]);

  useEffect(() => {
    if (!open || dragging) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open, dragging]);

  const from = rangeStartFor(Math.min(currentStartTime, startTime), now);
  const span = Math.max(1, now - from);
  const effectiveEnd = endTime ?? now;
  const stillRunning = endTime == null;
  const durationMs = Math.max(0, effectiveEnd - startTime);

  const busy = useMemo<BusySpan[]>(() => {
    return tasks.flatMap((task) =>
      task.events.map((event) => ({
        from: new Date(event.from).getTime(),
        to: new Date(event.to).getTime(),
        name: `${task.name}: ${event.name}`,
      }))
    );
  }, [tasks]);

  const xFor = useCallback(
    (time: number) => Math.round(((time - from) / span) * width),
    [from, span, width]
  );

  const applyDrag = useCallback(
    (kind: DragKind, clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || !kind) return;
      const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
      const at = snapMinute(from + ratio * (now - from));

      if (kind === "start") {
        const min = minStartForEnd(effectiveEnd, busy, from);
        const max = effectiveEnd - MIN_DURATION;
        setStartTime(clamp(at, min, max));
        return;
      }

      const min = startTime + MIN_DURATION;
      const max = maxEndForStart(startTime, busy, now);
      if (at >= now - NOW_MAGNET && max >= now - NOW_MAGNET) {
        setEndTime(null);
        return;
      }
      setEndTime(clamp(at, min, max));
    },
    [busy, effectiveEnd, from, now, startTime]
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
    if (isSaving || !width) return;
    const startX = xFor(startTime);
    const endX = xFor(effectiveEnd);
    const localX = event.clientX - event.currentTarget.getBoundingClientRect().left;
    const kind: DragKind = Math.abs(localX - startX) <= Math.abs(localX - endX) ? "start" : "end";
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

  const startX = xFor(startTime);
  const endX = xFor(effectiveEnd);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Fix this session</DialogTitle>
        <DialogDescription className="sr-only">
          Drag the start or end of this session.
        </DialogDescription>

        <div className="space-y-5 pt-1">
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

          <div className="space-y-4">
            <div
              ref={trackRef}
              className="relative h-16 touch-none select-none"
              onPointerDown={onTrackDown}
            >
              <div className="absolute right-0 left-0 top-[30px] h-1.5 rounded-full bg-muted" />
              {width > 0 &&
                busy.map((block) => {
                  const left = xFor(block.from);
                  const right = xFor(block.to);
                  if (right < 0 || left > width) return null;
                  return (
                    <div
                      key={`${block.from}-${block.to}-${block.name}`}
                      title={block.name}
                      className="absolute top-[30px] h-1.5 rounded-full bg-neutral-400/70"
                      style={{
                        left: clamp(left, 0, width),
                        width: Math.max(3, clamp(right, 0, width) - clamp(left, 0, width)),
                      }}
                    />
                  );
                })}
              {width > 0 && (
                <div
                  className="absolute top-[30px] h-1.5 rounded-full bg-foreground"
                  style={{
                    left: startX,
                    width: Math.max(4, endX - startX),
                  }}
                />
              )}
              <Thumb
                x={startX}
                timeLabel={clock(startTime)}
                active={dragging === "start"}
                ariaLabel="Start"
                onPointerDown={onThumbDown("start")}
              />
              <Thumb
                x={endX}
                timeLabel={stillRunning ? "Now" : clock(effectiveEnd)}
                active={dragging === "end"}
                ariaLabel={stillRunning ? "Now" : "Stop"}
                onPointerDown={onThumbDown("end")}
              />
            </div>

            <div className="flex items-start justify-between gap-4 text-sm">
              <div>
                <p className="text-muted-foreground">Started</p>
                <p className="font-mono text-base tabular-nums">{clock(startTime)}</p>
                <p className="text-muted-foreground">{agoLabel(startTime, now)}</p>
              </div>
              <div className="text-right">
                <p className="text-muted-foreground">{stillRunning ? "Still running" : "Stopped"}</p>
                <p className="font-mono text-base tabular-nums">
                  {stillRunning ? "Now" : clock(effectiveEnd)}
                </p>
                {!stillRunning && (
                  <p className="text-muted-foreground">{agoLabel(effectiveEnd, now)}</p>
                )}
              </div>
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving…" : stillRunning ? "Save start time" : `Stop ${agoLabel(effectiveEnd, now)}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Thumb({
  x,
  timeLabel,
  active,
  ariaLabel,
  onPointerDown,
}: {
  x: number;
  timeLabel: string;
  active: boolean;
  ariaLabel: string;
  onPointerDown: (event: React.PointerEvent) => void;
}) {
  return (
    <div
      className="absolute top-0"
      style={{ left: Math.round(x - THUMB / 2), width: THUMB }}
    >
      <p className="mb-1 text-center font-mono text-xs tabular-nums leading-none text-foreground">
        {timeLabel}
      </p>
      <button
        type="button"
        aria-label={ariaLabel}
        className="block h-7 w-7 rounded-full bg-white"
        style={{
          boxShadow: active
            ? "0 2px 8px rgba(0,0,0,0.22), 0 0 0 5px rgba(0,0,0,0.08)"
            : "0 1px 3px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.08)",
        }}
        onPointerDown={onPointerDown}
      />
    </div>
  );
}
