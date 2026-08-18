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

interface BusySpan {
  from: number;
  to: number;
  name: string;
}

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const MIN_DURATION = MINUTE;
const THUMB = 24;
const INSET = 16;
const MAX_WINDOW = 12 * HOUR;

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

function windowFor(start: number, openedAt: number) {
  const duration = Math.max(openedAt - start, MINUTE);
  const leftPad = duration < 45 * MINUTE ? 45 * MINUTE : Math.min(Math.max(duration * 0.2, 20 * MINUTE), 90 * MINUTE);
  return {
    from: Math.max(openedAt - MAX_WINDOW, start - leftPad),
    to: openedAt,
  };
}

function minStartForEnd(end: number, busy: BusySpan[], from: number) {
  let min = from;
  for (const span of busy) {
    if (span.from < end) min = Math.max(min, span.to);
  }
  return min;
}

function maxEndForStart(start: number, busy: BusySpan[], to: number) {
  let max = to;
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
  const onClearErrorRef = useRef(onClearError);
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const [rangeFrom, setRangeFrom] = useState(() => windowFor(currentStartTime, Date.now()).from);
  const [startTime, setStartTime] = useState(currentStartTime);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    onClearErrorRef.current = onClearError;
  }, [onClearError]);

  useEffect(() => {
    if (!open) return;
    const at = Date.now();
    const win = windowFor(currentStartTime, at);
    setOpenedAt(at);
    setClockNow(at);
    setRangeFrom(win.from);
    setStartTime(currentStartTime);
    setEndTime(null);
    onClearErrorRef.current?.();
  }, [open, currentStartTime]);

  useEffect(() => {
    if (!open || dragging) return;
    const id = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open, dragging]);

  const rangeTo = openedAt;
  const stillRunning = endTime == null;
  const sliderEnd = endTime ?? rangeTo;
  const durationMs = Math.max(0, (stillRunning ? clockNow : sliderEnd) - startTime);

  const busy = useMemo<BusySpan[]>(() => {
    return tasks.flatMap((task) =>
      task.events.map((event) => ({
        from: new Date(event.from).getTime(),
        to: new Date(event.to).getTime(),
        name: `${task.name}: ${event.name}`,
      }))
    );
  }, [tasks]);

  const setStartFromPointer = useCallback(
    (time: number, snap: boolean) => {
      const at = snap ? snapMinute(time) : time;
      const max = sliderEnd - MIN_DURATION;
      const min = minStartForEnd(sliderEnd, busy, rangeFrom);
      setStartTime(clamp(at, min, max));
    },
    [busy, rangeFrom, sliderEnd]
  );

  const setEndFromPointer = useCallback(
    (time: number, snap: boolean) => {
      const at = snap ? snapMinute(time) : time;
      if (at >= rangeTo - MINUTE / 2) {
        setEndTime(null);
        return;
      }
      const min = startTime + MIN_DURATION;
      const max = maxEndForStart(startTime, busy, rangeTo);
      setEndTime(clamp(at, min, max));
    },
    [busy, rangeTo, startTime]
  );

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogTitle>Fix this session</DialogTitle>
        <DialogDescription className="hidden">
          Drag when the session started and when it should stop.
        </DialogDescription>

        <div className="space-y-6 pt-1">
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

          <SliderRow
            label="Started"
            valueLabel={clock(startTime)}
            rangeFrom={rangeFrom}
            rangeTo={rangeTo}
            thumbTime={startTime}
            fillFrom={sliderEnd}
            busy={busy}
            disabled={isSaving}
            onDragStart={() => setDragging(true)}
            onDrag={(time, snap) => setStartFromPointer(time, snap)}
            onDragEnd={() => setDragging(false)}
          />

          <SliderRow
            label={stillRunning ? "Still running" : "Stopped"}
            valueLabel={stillRunning ? "Now" : clock(sliderEnd)}
            rangeFrom={rangeFrom}
            rangeTo={rangeTo}
            thumbTime={sliderEnd}
            fillFrom={startTime}
            busy={busy}
            disabled={isSaving}
            onDragStart={() => setDragging(true)}
            onDrag={(time, snap) => setEndFromPointer(time, snap)}
            onDragEnd={() => setDragging(false)}
          />

          {!stillRunning && (
            <p className="text-sm text-muted-foreground">
              Stops {agoLabel(sliderEnd, clockNow)}.
            </p>
          )}

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

function SliderRow({
  label,
  valueLabel,
  rangeFrom,
  rangeTo,
  thumbTime,
  fillFrom,
  busy,
  disabled,
  onDragStart,
  onDrag,
  onDragEnd,
}: {
  label: string;
  valueLabel: string;
  rangeFrom: number;
  rangeTo: number;
  thumbTime: number;
  fillFrom: number;
  busy: BusySpan[];
  disabled?: boolean;
  onDragStart: () => void;
  onDrag: (time: number, snap: boolean) => void;
  onDragEnd: () => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [width, setWidth] = useState(0);
  const span = Math.max(1, rangeTo - rangeFrom);
  const usable = Math.max(1, width - INSET * 2);

  useLayoutEffect(() => {
    const node = trackRef.current;
    if (!node) return;
    const measure = () => {
      if (node.clientWidth > 0) setWidth(node.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const xFor = (time: number) => INSET + ((time - rangeFrom) / span) * usable;
  const timeForClientX = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return thumbTime;
    const ratio = clamp((clientX - rect.left - INSET) / usable, 0, 1);
    return rangeFrom + ratio * span;
  };

  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragging.current) return;
      onDrag(timeForClientX(event.clientX), false);
    };
    const up = (event: PointerEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      onDrag(timeForClientX(event.clientX), true);
      onDragEnd();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  });

  const thumbX = xFor(thumbTime);
  const fillLeft = xFor(Math.min(fillFrom, thumbTime));
  const fillRight = xFor(Math.max(fillFrom, thumbTime));

  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between gap-3 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono text-base font-medium tabular-nums">{valueLabel}</span>
      </div>
      <div
        ref={trackRef}
        className="relative h-7 touch-none select-none"
        onPointerDown={(event) => {
          if (disabled) return;
          event.preventDefault();
          dragging.current = true;
          onDragStart();
          onDrag(timeForClientX(event.clientX), false);
        }}
      >
        <div
          className="absolute top-[11px] h-1.5 rounded-full bg-muted"
          style={{ left: INSET, right: INSET }}
        />
        {width > 0 &&
          busy.map((block) => {
            if (block.to <= rangeFrom || block.from >= rangeTo) return null;
            const left = xFor(Math.max(block.from, rangeFrom));
            const right = xFor(Math.min(block.to, rangeTo));
            return (
              <div
                key={`${block.from}-${block.to}-${block.name}`}
                title={block.name}
                className="absolute top-[11px] h-1.5 rounded-full bg-neutral-400/70"
                style={{ left, width: Math.max(3, right - left) }}
              />
            );
          })}
        {width > 0 && (
          <div
            className="absolute top-[11px] h-1.5 rounded-full bg-foreground"
            style={{ left: fillLeft, width: Math.max(2, fillRight - fillLeft) }}
          />
        )}
        {width > 0 && (
          <div
            className="absolute top-0.5 h-6 w-6 rounded-full bg-white"
            style={{
              left: Math.round(thumbX - THUMB / 2),
              boxShadow: "0 1px 3px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.08)",
            }}
          />
        )}
      </div>
    </div>
  );
}
