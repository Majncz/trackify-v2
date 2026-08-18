"use client";

import { useState, useEffect, useLayoutEffect, useMemo, useCallback, useRef } from "react";
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
const INSET = 18;
const MIN_WINDOW = 20 * MINUTE;
const MAX_WINDOW = 12 * HOUR;
const MIN_SESSION_PX = 88;
const LABEL_GAP = 56;

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

function viewSpan(start: number, end: number, width: number) {
  const duration = Math.max(end - start, 15 * 1000);
  const usable = Math.max(width - INSET * 2, 160);
  const zoomed = duration * (usable / MIN_SESSION_PX);
  return clamp(Math.max(zoomed, duration + 12 * MINUTE), MIN_WINDOW, MAX_WINDOW);
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
  const [viewStart, setViewStart] = useState<number | null>(null);

  useEffect(() => {
    onClearErrorRef.current = onClearError;
  }, [onClearError]);

  useEffect(() => {
    if (!open) return;
    const freshNow = Date.now();
    setNow(freshNow);
    setStartTime(currentStartTime);
    setEndTime(null);
    setViewStart(null);
    onClearErrorRef.current?.();
  }, [open, currentStartTime]);

  useLayoutEffect(() => {
    if (!open) {
      setWidth(0);
      return;
    }
    let observer: ResizeObserver | null = null;
    let frame = 0;
    const attach = () => {
      const node = trackRef.current;
      if (!node) {
        frame = requestAnimationFrame(attach);
        return;
      }
      const measure = () => {
        const next = node.clientWidth;
        if (next > 0) setWidth(next);
      };
      measure();
      observer = new ResizeObserver(measure);
      observer.observe(node);
    };
    attach();
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
    };
  }, [open]);

  useEffect(() => {
    if (!open || dragging) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open, dragging]);

  const effectiveEnd = endTime ?? now;
  const stillRunning = endTime == null;
  const durationMs = Math.max(0, effectiveEnd - startTime);
  const computedSpan = viewSpan(startTime, effectiveEnd, width || 360);
  const from = viewStart ?? effectiveEnd - computedSpan;
  const span = Math.max(1, now - from);

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
    (time: number) => {
      if (width <= 0) return INSET;
      const usable = Math.max(1, width - INSET * 2);
      return Math.round(INSET + ((time - from) / span) * usable);
    },
    [from, span, width]
  );

  const applyDrag = useCallback(
    (kind: DragKind, clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || !kind) return;
      const usable = Math.max(1, rect.width - INSET * 2);
      const ratio = clamp((clientX - rect.left - INSET) / usable, 0, 1);
      const at = snapMinute(from + ratio * span);

      if (kind === "start") {
        const min = minStartForEnd(effectiveEnd, busy, from);
        const max = effectiveEnd - MIN_DURATION;
        const next = clamp(at, min, max);
        setStartTime(next);
        if (next <= from + span * 0.08) {
          setViewStart(Math.max(now - MAX_WINDOW, from - 15 * MINUTE));
        }
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
    [busy, effectiveEnd, from, now, span, startTime]
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
    if (isSaving || width <= 0) return;
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
  const thumbsClose = endX - startX < LABEL_GAP;
  const ready = width > 40;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg overflow-x-hidden">
        <DialogTitle>Fix this session</DialogTitle>
        <DialogDescription className="hidden">
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
              className="relative h-[4.5rem] touch-none select-none px-0"
              onPointerDown={onTrackDown}
            >
              <div
                className="absolute top-[34px] h-1.5 rounded-full bg-muted"
                style={{ left: INSET, right: INSET }}
              />
              {ready &&
                busy.map((block) => {
                  const left = xFor(Math.max(block.from, from));
                  const right = xFor(Math.min(block.to, now));
                  if (block.to <= from || block.from >= now || right - left < 2) return null;
                  return (
                    <div
                      key={`${block.from}-${block.to}-${block.name}`}
                      title={block.name}
                      className="absolute top-[34px] h-1.5 rounded-full bg-neutral-400/70"
                      style={{ left, width: Math.max(3, right - left) }}
                    />
                  );
                })}
              {ready && (
                <div
                  className="absolute top-[34px] h-1.5 rounded-full bg-foreground"
                  style={{
                    left: startX,
                    width: Math.max(THUMB, endX - startX),
                  }}
                />
              )}
              {ready && (
                <>
                  <Thumb
                    x={startX}
                    timeLabel={clock(startTime)}
                    labelSide={thumbsClose ? "left" : "center"}
                    active={dragging === "start"}
                    stacked={thumbsClose && dragging !== "start"}
                    ariaLabel="Start"
                    onPointerDown={onThumbDown("start")}
                  />
                  <Thumb
                    x={endX}
                    timeLabel={stillRunning ? "Now" : clock(effectiveEnd)}
                    labelSide={thumbsClose ? "right" : "center"}
                    active={dragging === "end"}
                    stacked={thumbsClose && dragging === "start"}
                    ariaLabel={stillRunning ? "Now" : "Stop"}
                    onPointerDown={onThumbDown("end")}
                  />
                </>
              )}
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
  labelSide,
  active,
  stacked,
  ariaLabel,
  onPointerDown,
}: {
  x: number;
  timeLabel: string;
  labelSide: "left" | "center" | "right";
  active: boolean;
  stacked: boolean;
  ariaLabel: string;
  onPointerDown: (event: React.PointerEvent) => void;
}) {
  const labelLeft =
    labelSide === "left" ? x - 70 : labelSide === "right" ? x + 6 : x - 28;

  return (
    <>
      <p
        className="pointer-events-none absolute top-0 w-[56px] font-mono text-xs tabular-nums leading-none text-foreground"
        style={{
          left: Math.round(labelLeft),
          textAlign: labelSide === "right" ? "left" : labelSide === "left" ? "right" : "center",
        }}
      >
        {timeLabel}
      </p>
      <button
        type="button"
        aria-label={ariaLabel}
        className="absolute top-[27px] h-7 w-7 rounded-full bg-white"
        style={{
          left: Math.round(x - THUMB / 2),
          zIndex: active ? 3 : stacked ? 1 : 2,
          boxShadow: active
            ? "0 2px 8px rgba(0,0,0,0.22), 0 0 0 5px rgba(0,0,0,0.08)"
            : "0 1px 3px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.08)",
        }}
        onPointerDown={onPointerDown}
      />
    </>
  );
}
