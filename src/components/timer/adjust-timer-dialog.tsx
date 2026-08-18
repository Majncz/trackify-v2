"use client";

import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
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

type DragKind = "start" | "end" | "body" | null;

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const MIN_DURATION = MINUTE;
const PAD = 28;
const NOW_MAGNET = 90 * 1000;

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

function snapTime(ms: number) {
  const five = Math.round(ms / (5 * MINUTE)) * 5 * MINUTE;
  if (Math.abs(ms - five) < 50 * 1000) return five;
  return Math.round(ms / MINUTE) * MINUTE;
}

function clock(ms: number) {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function dayHint(ms: number, now: number) {
  const a = new Date(ms);
  const b = new Date(now);
  if (a.getDate() === b.getDate() && a.getMonth() === b.getMonth()) return null;
  return a.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function timeToX(time: number, width: number, winStart: number, winEnd: number) {
  const span = Math.max(1, winEnd - winStart);
  return PAD + ((time - winStart) / span) * (width - PAD * 2);
}

function xToTime(clientX: number, rect: DOMRect, winStart: number, winEnd: number) {
  const span = Math.max(1, winEnd - winStart);
  const t = clamp((clientX - rect.left - PAD) / (rect.width - PAD * 2), 0, 1);
  return winStart + t * span;
}

function ticksFor(winStart: number, winEnd: number) {
  const span = winEnd - winStart;
  const step = span <= 2 * HOUR ? 15 * MINUTE : span <= 6 * HOUR ? 30 * MINUTE : HOUR;
  const first = Math.ceil(winStart / step) * step;
  const ticks: number[] = [];
  for (let t = first; t <= winEnd; t += step) ticks.push(t);
  return ticks;
}

function initialWindow(start: number, now: number) {
  const duration = Math.max(now - start, MINUTE);
  const leftPad = clamp(duration * 0.35, 45 * MINUTE, 3 * HOUR);
  let winStart = start - leftPad;
  const earliest = now - 18 * HOUR;
  winStart = Math.max(winStart, earliest);
  if (now - winStart < 90 * MINUTE) winStart = now - 90 * MINUTE;
  return winStart;
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
  const dragRef = useRef<{
    kind: DragKind;
    grabOffset: number;
    lastX: number;
  }>({ kind: null, grabOffset: 0, lastX: 0 });
  const onClearErrorRef = useRef(onClearError);
  const [width, setWidth] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [startTime, setStartTime] = useState(currentStartTime);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [winStart, setWinStart] = useState(() => initialWindow(currentStartTime, Date.now()));
  const [dragging, setDragging] = useState<DragKind>(null);
  const [slide, setSlide] = useState(0);
  const [slideArmed, setSlideArmed] = useState(false);
  const slideTrackRef = useRef<HTMLDivElement>(null);
  const slideDrag = useRef(false);

  useEffect(() => {
    onClearErrorRef.current = onClearError;
  }, [onClearError]);

  useEffect(() => {
    if (!open) return;
    const freshNow = Date.now();
    setNow(freshNow);
    setStartTime(currentStartTime);
    setEndTime(null);
    setWinStart(initialWindow(currentStartTime, freshNow));
    setSlide(0);
    setSlideArmed(false);
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

  const allEvents = useMemo(() => {
    return tasks.flatMap((task) =>
      task.events.map((event) => ({
        from: new Date(event.from).getTime(),
        to: new Date(event.to).getTime(),
        name: `${task.name}: ${event.name}`,
      }))
    );
  }, [tasks]);

  const effectiveEnd = endTime ?? now;
  const stillRunning = endTime == null;
  const durationMs = Math.max(0, effectiveEnd - startTime);
  const changed = startTime !== currentStartTime || !stillRunning;
  const winEnd = now;

  const overlaps = useMemo(() => {
    return allEvents.filter((event) => startTime < event.to && event.from < effectiveEnd);
  }, [allEvents, startTime, effectiveEnd]);

  const startX = width ? timeToX(startTime, width, winStart, winEnd) : 0;
  const endX = width ? timeToX(effectiveEnd, width, winStart, winEnd) : 0;

  const commit = useCallback(async () => {
    if (isSaving || overlaps.length) return;
    if (!changed) {
      onOpenChange(false);
      return;
    }
    await onSave({ startTime, endTime });
    onOpenChange(false);
  }, [changed, endTime, isSaving, onOpenChange, onSave, overlaps.length, startTime]);

  const applyDrag = useCallback(
    (kind: DragKind, clientX: number) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || !kind) return;
      const raw = xToTime(clientX, rect, winStart, winEnd);
      const grabbed = snapTime(raw);

      if (kind === "start") {
        const next = clamp(grabbed, winStart, effectiveEnd - MIN_DURATION);
        setStartTime(next);
        if (next < winStart + (winEnd - winStart) * 0.06) {
          setWinStart((prev) => Math.max(now - 18 * HOUR, prev - 20 * MINUTE));
        }
        return;
      }

      if (kind === "end") {
        if (grabbed >= now - NOW_MAGNET) {
          setEndTime(null);
          return;
        }
        setEndTime(clamp(grabbed, startTime + MIN_DURATION, now));
        return;
      }

      const span = effectiveEnd - startTime;
      let nextStart = snapTime(raw - dragRef.current.grabOffset);
      nextStart = clamp(nextStart, winStart, now - span);
      const nextEnd = nextStart + span;
      setStartTime(nextStart);
      if (nextEnd >= now - NOW_MAGNET) setEndTime(null);
      else setEndTime(Math.min(nextEnd, now));
    },
    [effectiveEnd, now, startTime, winEnd, winStart]
  );

  const onPointerDown = (kind: DragKind) => (event: React.PointerEvent) => {
    if (isSaving) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = trackRef.current?.getBoundingClientRect();
    const at = rect ? xToTime(event.clientX, rect, winStart, winEnd) : startTime;
    dragRef.current = {
      kind,
      grabOffset: kind === "body" ? at - startTime : 0,
      lastX: event.clientX,
    };
    setDragging(kind);
    if (kind === "end" && stillRunning) {
      setEndTime(now);
    }
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => {
      applyDrag(dragRef.current.kind, event.clientX);
    };
    const up = (event: PointerEvent) => {
      if (dragRef.current.kind === "end") {
        const rect = trackRef.current?.getBoundingClientRect();
        if (rect) {
          const at = xToTime(event.clientX, rect, winStart, winEnd);
          if (at >= Date.now() - NOW_MAGNET) setEndTime(null);
        }
      }
      dragRef.current.kind = null;
      setDragging(null);
      try {
        navigator.vibrate?.(10);
      } catch {
        // ignore
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [applyDrag, dragging, winEnd, winStart]);

  useEffect(() => {
    const node = trackRef.current;
    if (!open || !node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const delta = event.deltaY > 0 ? 20 * MINUTE : -20 * MINUTE;
      setWinStart((prev) => clamp(prev + delta, Date.now() - 18 * HOUR, startTime - 15 * MINUTE));
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [open, startTime]);

  const onSlidePointerDown = (event: React.PointerEvent) => {
    if (isSaving || !changed || overlaps.length) return;
    slideDrag.current = true;
    event.preventDefault();
  };

  useEffect(() => {
    if (!open) return;
    const move = (event: PointerEvent) => {
      if (!slideDrag.current || !slideTrackRef.current) return;
      const rect = slideTrackRef.current.getBoundingClientRect();
      const max = rect.width - 56;
      setSlide(clamp(event.clientX - rect.left - 28, 0, max));
    };
    const up = () => {
      if (!slideDrag.current || !slideTrackRef.current) return;
      slideDrag.current = false;
      const max = slideTrackRef.current.clientWidth - 56;
      setSlide((current) => {
        if (current > max * 0.82) {
          setSlideArmed(true);
          void commit().catch(() => {
            setSlideArmed(false);
            setSlide(0);
          });
          return max;
        }
        return 0;
      });
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, [commit, open]);

  const ticks = useMemo(() => ticksFor(winStart, winEnd), [winStart, winEnd]);
  const slideLabel = stillRunning
    ? "Slide to keep it running"
    : `Slide to stop at ${clock(effectiveEnd)}`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          "sm:max-w-2xl gap-0 border-0 bg-[#0e0f12] p-0 text-white overflow-hidden",
          "[&>button]:text-white/60 [&>button]:hover:text-white"
        )}
      >
        <DialogTitle className="sr-only">Edit this session</DialogTitle>
        <DialogDescription className="sr-only">
          Drag the start or end of the clip on the timeline. Leave the end on now to
          keep tracking, or pull it left to stop earlier.
        </DialogDescription>

        <div className="px-5 pt-6 pb-2 pr-12">
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-white/40">
            This session
          </p>
          <div className="mt-3 flex items-end justify-between gap-4">
            <p className="font-mono text-5xl font-semibold tabular-nums leading-none tracking-tight">
              {formatDurationWords(durationMs)}
            </p>
            <p className="text-right text-sm text-white/55">
              <span className="font-mono tabular-nums">{clock(startTime)}</span>
              {dayHint(startTime, now) ? (
                <span className="text-white/35"> {dayHint(startTime, now)}</span>
              ) : null}
              <span className="mx-1.5 text-white/25">→</span>
              {stillRunning ? (
                <span className="text-rose-400">now</span>
              ) : (
                <span className="font-mono tabular-nums">{clock(effectiveEnd)}</span>
              )}
            </p>
          </div>
        </div>

        <div className="px-3 pb-2 pt-4">
          <div
            ref={trackRef}
            className="relative h-36 touch-none select-none overflow-hidden rounded-2xl bg-[#18191d]"
          >
            {width > 0 &&
              ticks.map((tick) => {
                const x = timeToX(tick, width, winStart, winEnd);
                const labelHour = new Date(tick).getMinutes() === 0;
                return (
                  <div
                    key={tick}
                    className="absolute top-0 bottom-0"
                    style={{ left: x }}
                  >
                    <div
                      className={cn(
                        "w-px",
                        labelHour ? "h-full bg-white/15" : "h-8 bg-white/8"
                      )}
                    />
                    <span className="absolute top-2 left-1.5 text-[10px] tabular-nums text-white/35">
                      {clock(tick)}
                    </span>
                  </div>
                );
              })}

            {width > 0 &&
              allEvents.map((event) => {
                const left = timeToX(event.from, width, winStart, winEnd);
                const right = timeToX(event.to, width, winStart, winEnd);
                if (right < PAD || left > width - PAD) return null;
                return (
                  <div
                    key={`${event.from}-${event.to}-${event.name}`}
                    title={event.name}
                    className="absolute top-12 h-12 rounded-sm bg-white/10"
                    style={{ left, width: Math.max(3, right - left) }}
                  />
                );
              })}

            {width > 0 && (
              <>
                <div
                  className={cn(
                    "absolute top-12 h-12 rounded-md shadow-[0_0_0_1px_rgba(255,255,255,0.15)]",
                    overlaps.length
                      ? "bg-rose-500/80"
                      : "bg-gradient-to-r from-amber-400 to-orange-500"
                  )}
                  style={{ left: startX, width: Math.max(8, endX - startX) }}
                  onPointerDown={onPointerDown("body")}
                />

                <Handle
                  x={startX}
                  label={clock(startTime)}
                  active={dragging === "start"}
                  onPointerDown={onPointerDown("start")}
                />
                <Handle
                  x={endX}
                  label={stillRunning ? "NOW" : clock(effectiveEnd)}
                  now={stillRunning}
                  active={dragging === "end"}
                  onPointerDown={onPointerDown("end")}
                />
              </>
            )}

            <p className="pointer-events-none absolute bottom-2 left-0 right-0 text-center text-[11px] text-white/30">
              {dragging === "end" || !stillRunning
                ? "Pull the right edge left to stop earlier · snap it back to now to keep going"
                : "Drag the ends like a film strip · scroll to zoom"}
            </p>
          </div>
        </div>

        {(error || overlaps.length > 0) && (
          <p className="px-5 pb-2 text-sm text-rose-300">
            {error ||
              `This clip overlaps “${overlaps[0].name}”. Nudge it off that block.`}
          </p>
        )}

        <div className="p-4 pt-2">
          <div
            ref={slideTrackRef}
            className={cn(
              "relative h-14 overflow-hidden rounded-full bg-white/8",
              (!changed || overlaps.length > 0 || isSaving) && "opacity-40"
            )}
            onPointerDown={onSlidePointerDown}
          >
            <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-white/50">
              {isSaving ? "Saving…" : !changed ? "Drag the clip to change it" : slideLabel}
            </p>
            <div
              className={cn(
                "absolute top-1.5 left-1.5 flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#0e0f12] shadow-lg",
                slideArmed && "bg-amber-400"
              )}
              style={{ transform: `translateX(${slide}px)` }}
            >
              <span className="text-lg leading-none">›</span>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Handle({
  x,
  label,
  now = false,
  active,
  onPointerDown,
}: {
  x: number;
  label: string;
  now?: boolean;
  active: boolean;
  onPointerDown: (event: React.PointerEvent) => void;
}) {
  return (
    <div
      className="absolute top-8 -ml-3 flex w-6 cursor-ew-resize flex-col items-center"
      style={{ left: x }}
      onPointerDown={onPointerDown}
    >
      <span
        className={cn(
          "mb-1 rounded-full px-1.5 py-0.5 font-mono text-[10px] tabular-nums",
          now ? "bg-rose-500 text-white" : "bg-white text-[#0e0f12]",
          active && "scale-110"
        )}
      >
        {label}
      </span>
      <div
        className={cn(
          "h-16 w-3 rounded-full shadow-md",
          now ? "bg-rose-500" : "bg-white",
          active && "ring-2 ring-white/40"
        )}
      />
    </div>
  );
}
