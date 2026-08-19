"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export type DragKind = "start" | "end" | null;

export interface BusySpan {
  from: number;
  to: number;
  name: string;
}

export const MINUTE = 60 * 1000;
export const HOUR = 60 * MINUTE;
export const MIN_DURATION = MINUTE;
export const MAX_LOOKBACK = 40 * HOUR;
export const FIRST_VIEW = 90 * MINUTE;

const HIT = 44;
const KNOB = 28;
const TRACK_H = 6;
const TRACK_CENTER = 40;
const TRACK_TOP = TRACK_CENTER - TRACK_H / 2;
const INSET = 18;

export function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n));
}

export function snapMinute(ms: number) {
  return Math.round(ms / MINUTE) * MINUTE;
}

export function clock(ms: number) {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function agoLabel(ms: number, now: number) {
  const mins = Math.max(0, Math.round((now - ms) / MINUTE));
  if (mins <= 0) return "now";
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.floor(mins / 60);
  const rest = mins % 60;
  if (rest === 0) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  return `${hours}h ${rest}m ago`;
}

export function initialViewFrom(start: number, openedAt: number) {
  const earliest = openedAt - MAX_LOOKBACK;
  const duration = Math.max(openedAt - start, MINUTE);
  if (duration >= FIRST_VIEW) {
    return Math.max(earliest, start - 20 * MINUTE);
  }
  return Math.max(earliest, openedAt - FIRST_VIEW);
}

export function minStartForEnd(end: number, busy: BusySpan[], earliest: number) {
  let min = earliest;
  for (const span of busy) {
    if (span.from < end) min = Math.max(min, span.to);
  }
  return min;
}

export function maxEndForStart(start: number, busy: BusySpan[], latest: number) {
  let max = latest;
  for (const span of busy) {
    if (span.to > start) max = Math.min(max, span.from);
  }
  return max;
}

export function SessionRangeSlider({
  startTime,
  endTime,
  endIsLive = false,
  allowLiveEnd = false,
  busy,
  viewFrom,
  viewTo,
  earliest,
  disabled,
  onViewFrom,
  onStartTime,
  onEndTime,
}: {
  startTime: number;
  endTime: number;
  endIsLive?: boolean;
  allowLiveEnd?: boolean;
  busy: BusySpan[];
  viewFrom: number;
  viewTo: number;
  earliest: number;
  disabled?: boolean;
  onViewFrom: (next: number) => void;
  onStartTime: (next: number) => void;
  onEndTime: (next: number | null) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragKind>(null);
  const viewFromRef = useRef(viewFrom);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState<DragKind>(null);

  useEffect(() => {
    viewFromRef.current = viewFrom;
  }, [viewFrom]);

  useLayoutEffect(() => {
    const node = trackRef.current;
    if (!node) return;
    const measure = () => {
      if (node.clientWidth > 0) setWidth(node.clientWidth);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    const frame = requestAnimationFrame(measure);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  const span = Math.max(1, viewTo - viewFrom);
  const usable = Math.max(1, width - INSET * 2);

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
          onViewFrom(nextFrom);
          at = nextFrom;
        }
        const min = minStartForEnd(endTime, busy, earliest);
        const max = endTime - MIN_DURATION;
        onStartTime(clamp(at, min, max));
        return;
      }

      const min = startTime + MIN_DURATION;
      const max = maxEndForStart(startTime, busy, viewTo);
      if (allowLiveEnd && at >= viewTo - MINUTE / 2) {
        onEndTime(null);
        return;
      }
      onEndTime(clamp(at, min, max));
    },
    [allowLiveEnd, busy, earliest, endTime, onEndTime, onStartTime, onViewFrom, startTime, usable, viewTo]
  );

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

  const startX = xFor(startTime);
  const endX = xFor(endTime);
  const ready = width > 40;
  const thumbsClose = endX - startX < 64;

  return (
    <div
      ref={trackRef}
      className="relative h-16 touch-none select-none"
      onPointerDown={(event) => {
        if (disabled || width <= 0) return;
        event.preventDefault();
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const kind: DragKind =
          Math.abs(x - xFor(startTime)) <= Math.abs(x - xFor(endTime)) ? "start" : "end";
        dragRef.current = kind;
        setDragging(kind);
        applyDrag(kind, event.clientX, false);
      }}
    >
      <div
        className="absolute rounded-full bg-muted"
        style={{ left: INSET, right: INSET, top: TRACK_TOP, height: TRACK_H }}
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
              className="absolute rounded-full bg-neutral-400/70"
              style={{ left, width: Math.max(3, right - left), top: TRACK_TOP, height: TRACK_H }}
            />
          );
        })}
      {ready && (
        <div
          className="absolute rounded-full bg-foreground"
          style={{ left: startX, width: Math.max(2, endX - startX), top: TRACK_TOP, height: TRACK_H }}
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
            timeLabel={endIsLive ? "Now" : clock(endTime)}
            labelSide={thumbsClose ? "right" : "center"}
            active={dragging === "end"}
            z={dragging === "end" ? 3 : 2}
            ariaLabel={endIsLive ? "Now" : "Stop"}
          />
        </>
      )}
    </div>
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
  const labelShift =
    labelSide === "left"
      ? "translateX(calc(-100% - 8px))"
      : labelSide === "right"
        ? "translateX(8px)"
        : "translateX(-50%)";

  return (
    <>
      <p
        className="pointer-events-none absolute top-0 whitespace-nowrap font-mono text-xs tabular-nums leading-none"
        style={{ left: Math.round(x), transform: labelShift }}
      >
        {timeLabel}
      </p>
      <div
        aria-label={ariaLabel}
        className="absolute rounded-full bg-transparent"
        style={{
          left: Math.round(x - HIT / 2),
          top: TRACK_CENTER - HIT / 2,
          width: HIT,
          height: HIT,
          zIndex: z,
        }}
      >
        <div
          className="absolute rounded-full bg-white"
          style={{
            left: (HIT - KNOB) / 2,
            top: (HIT - KNOB) / 2,
            width: KNOB,
            height: KNOB,
            boxShadow: active
              ? "0 2px 8px rgba(0,0,0,0.22), 0 0 0 5px rgba(0,0,0,0.08)"
              : "0 1px 3px rgba(0,0,0,0.22), 0 0 0 1px rgba(0,0,0,0.08)",
          }}
        />
      </div>
    </>
  );
}
