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
const HIT = 44;
const INSET = 18;
const MAX_LOOKBACK = 40 * HOUR;
const FIRST_VIEW = 90 * MINUTE;

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

function initialViewFrom(start: number, openedAt: number) {
  const earliest = openedAt - MAX_LOOKBACK;
  const duration = Math.max(openedAt - start, MINUTE);
  if (duration >= FIRST_VIEW) {
    return Math.max(earliest, start - 20 * MINUTE);
  }
  return Math.max(earliest, openedAt - FIRST_VIEW);
}

function minStartForEnd(end: number, busy: BusySpan[], earliest: number) {
  let min = earliest;
  for (const span of busy) {
    if (span.from < end) min = Math.max(min, span.to);
  }
  return min;
}

function maxEndForStart(start: number, busy: BusySpan[], latest: number) {
  let max = latest;
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
  const viewFromRef = useRef(0);
  const onClearErrorRef = useRef(onClearError);
  const [width, setWidth] = useState(0);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const [viewFrom, setViewFrom] = useState(() => initialViewFrom(currentStartTime, Date.now()));
  const [startTime, setStartTime] = useState(currentStartTime);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [dragging, setDragging] = useState<DragKind>(null);

  useEffect(() => {
    onClearErrorRef.current = onClearError;
  }, [onClearError]);

  useEffect(() => {
    viewFromRef.current = viewFrom;
  }, [viewFrom]);

  useEffect(() => {
    if (!open) return;
    const at = Date.now();
    const from = initialViewFrom(currentStartTime, at);
    setOpenedAt(at);
    setClockNow(at);
    setViewFrom(from);
    viewFromRef.current = from;
    setStartTime(currentStartTime);
    setEndTime(null);
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
        if (node.clientWidth > 0) setWidth(node.clientWidth);
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
    const id = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open, dragging]);

  const viewTo = openedAt;
  const earliest = openedAt - MAX_LOOKBACK;
  const stillRunning = endTime == null;
  const sliderEnd = endTime ?? viewTo;
  const durationMs = Math.max(0, (stillRunning ? clockNow : sliderEnd) - startTime);
  const span = Math.max(1, viewTo - viewFrom);
  const usable = Math.max(1, width - INSET * 2);

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
      return INSET + ((time - viewFrom) / span) * usable;
    },
    [span, usable, viewFrom, width]
  );

  const applyDrag = useCallback(
    (kind: DragKind, clientX: number, snap: boolean) => {
      const rect = trackRef.current?.getBoundingClientRect();
      if (!rect || !kind) return;
      const from = viewFromRef.current;
      const localSpan = Math.max(1, viewTo - from);
      const ratio = clamp((clientX - rect.left - INSET) / usable, 0, 1);
      let at = from + ratio * localSpan;
      if (snap) at = snapMinute(at);

      if (kind === "start") {
        if (ratio <= 0.03 && from > earliest) {
          const nextFrom = Math.max(earliest, from - 8 * MINUTE);
          viewFromRef.current = nextFrom;
          setViewFrom(nextFrom);
          at = nextFrom;
        }
        const min = minStartForEnd(sliderEnd, busy, earliest);
        const max = sliderEnd - MIN_DURATION;
        setStartTime(clamp(at, min, max));
        return;
      }

      const min = startTime + MIN_DURATION;
      const max = maxEndForStart(startTime, busy, viewTo);
      if (at >= viewTo - MINUTE / 2) {
        setEndTime(null);
        return;
      }
      setEndTime(clamp(at, min, max));
    },
    [busy, earliest, sliderEnd, startTime, usable, viewTo]
  );

  const onPointerDown = (event: React.PointerEvent) => {
    if (isSaving || width <= 0) return;
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const startX = xFor(startTime);
    const endX = xFor(sliderEnd);
    const kind: DragKind =
      Math.abs(x - startX) <= Math.abs(x - endX) ? "start" : "end";
    dragRef.current = kind;
    setDragging(kind);
    applyDrag(kind, event.clientX, false);
  };

  useEffect(() => {
    if (!dragging) return;
    const move = (event: PointerEvent) => applyDrag(dragRef.current, event.clientX, false);
    const up = (event: PointerEvent) => {
      applyDrag(dragRef.current, event.clientX, true);
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

  const handleSave = async () => {
    try {
      await onSave({
        startTime: snapMinute(startTime),
        endTime: endTime == null ? null : snapMinute(endTime),
      });
      onOpenChange(false);
    } catch {
      // Parent shows the error
    }
  };

  const startX = xFor(startTime);
  const endX = xFor(sliderEnd);
  const ready = width > 40;
  const thumbsClose = endX - startX < 64;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Fix this session</DialogTitle>
        <DialogDescription className="hidden">
          Drag the start or the end of this session.
        </DialogDescription>

        <div className="space-y-5 pt-1">
          <div>
            <p className="font-mono text-4xl font-semibold tabular-nums tracking-tight">
              {formatDurationWords(durationMs)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {stillRunning
                ? `Started ${clock(startTime)} · still running`
                : `Started ${clock(startTime)} · stopped ${clock(sliderEnd)}`}
            </p>
          </div>

          <div
            ref={trackRef}
            className="relative h-16 touch-none select-none"
            onPointerDown={onPointerDown}
          >
            <div
              className="absolute top-[34px] h-1.5 rounded-full bg-muted"
              style={{ left: INSET, right: INSET }}
            />
            {ready &&
              busy.map((block) => {
                if (block.to <= viewFrom || block.from >= viewTo) return null;
                const left = xFor(Math.max(block.from, viewFrom));
                const right = xFor(Math.min(block.to, viewTo));
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
                style={{ left: startX, width: Math.max(2, endX - startX) }}
              />
            )}
            {ready && (
              <>
                <Thumb
                  x={startX}
                  timeLabel={clock(startTime)}
                  labelSide={thumbsClose ? "left" : "center"}
                  active={dragging === "start"}
                  z={dragging === "start" ? 3 : 2}
                  ariaLabel="Start"
                />
                <Thumb
                  x={endX}
                  timeLabel={stillRunning ? "Now" : clock(sliderEnd)}
                  labelSide={thumbsClose ? "right" : "center"}
                  active={dragging === "end"}
                  z={dragging === "end" ? 3 : 2}
                  ariaLabel={stillRunning ? "Now" : "Stop"}
                />
              </>
            )}
          </div>

          <div className="flex items-start justify-between gap-4 text-sm">
            <div>
              <p className="text-muted-foreground">Started</p>
              <p className="font-mono text-base tabular-nums">{clock(startTime)}</p>
              <p className="text-muted-foreground">{agoLabel(startTime, clockNow)}</p>
            </div>
            <div className="text-right">
              <p className="text-muted-foreground">{stillRunning ? "Still running" : "Stopped"}</p>
              <p className="font-mono text-base tabular-nums">
                {stillRunning ? "Now" : clock(sliderEnd)}
              </p>
              {!stillRunning && (
                <p className="text-muted-foreground">{agoLabel(sliderEnd, clockNow)}</p>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={isSaving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving ? "Saving…" : stillRunning ? "Save start time" : `Stop ${agoLabel(sliderEnd, clockNow)}`}
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
  z,
  ariaLabel,
}: {
  x: number;
  timeLabel: string;
  labelSide: "left" | "center" | "right";
  active: boolean;
  z: number;
  ariaLabel: string;
}) {
  const labelLeft =
    labelSide === "left" ? x - 72 : labelSide === "right" ? x + 8 : x - 28;

  return (
    <>
      <p
        className="pointer-events-none absolute top-0 w-[56px] font-mono text-xs tabular-nums leading-none"
        style={{
          left: Math.round(labelLeft),
          textAlign: labelSide === "right" ? "left" : labelSide === "left" ? "right" : "center",
        }}
      >
        {timeLabel}
      </p>
      <div
        aria-label={ariaLabel}
        className="absolute top-[22px] rounded-full bg-transparent"
        style={{
          left: Math.round(x - HIT / 2),
          width: HIT,
          height: HIT,
          zIndex: z,
        }}
      >
        <div
          className="absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white"
          style={{
            boxShadow: active
              ? "0 2px 8px rgba(0,0,0,0.22), 0 0 0 5px rgba(0,0,0,0.08)"
              : "0 1px 3px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.08)",
          }}
        />
      </div>
    </>
  );
}
