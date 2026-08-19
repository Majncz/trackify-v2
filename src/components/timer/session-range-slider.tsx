"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { relocateToTime, viewAround } from "@/lib/suggest-past-range";

export type DragKind = "start" | "end" | "pan" | "arm" | null;

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

let gestureBlockUntil = 0;
let gestureListening = false;
let draggingNow = false;

export function markSliderGesture() {
  gestureBlockUntil = Date.now() + 500;
  if (gestureListening) return;
  gestureListening = true;
  const stop = (event: Event) => {
    if (Date.now() >= gestureBlockUntil) {
      window.removeEventListener("click", stop, true);
      gestureListening = false;
      return;
    }
    const target = event.target;
    if (target instanceof Element && target.closest('[role="dialog"]')) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  };
  window.addEventListener("click", stop, true);
}

export function sliderGestureBlocksUi() {
  return draggingNow || Date.now() < gestureBlockUntil;
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
  onDraggingChange,
  onViewTo,
  placeInGaps = false,
  horizon,
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
  onDraggingChange?: (dragging: boolean) => void;
  onViewTo?: (next: number) => void;
  placeInGaps?: boolean;
  horizon?: number;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragKind>(null);
  const viewFromRef = useRef(viewFrom);
  const viewToRef = useRef(viewTo);
  const panRef = useRef({ x: 0, from: 0, to: 0 });
  const armRef = useRef({ x: 0, at: 0 });
  const latestRef = useRef({
    startTime,
    endTime,
    busy,
    viewTo,
    earliest,
    allowLiveEnd,
    usable: 1,
    horizon: horizon ?? viewTo,
    onViewFrom,
    onViewTo,
    onStartTime,
    onEndTime,
  });
  const lastPointerXRef = useRef(0);
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState<DragKind>(null);

  useEffect(() => {
    viewFromRef.current = viewFrom;
  }, [viewFrom]);

  useEffect(() => {
    viewToRef.current = viewTo;
  }, [viewTo]);

  latestRef.current = {
    startTime,
    endTime,
    busy,
    viewTo,
    earliest,
    allowLiveEnd,
    usable: Math.max(1, width - INSET * 2),
    horizon: horizon ?? viewTo,
    onViewFrom,
    onViewTo,
    onStartTime,
    onEndTime,
  };

  useLayoutEffect(() => {
    const node = trackRef.current;
    if (!node) return;
    const measure = () => {
      const next = node.clientWidth;
      if (next > 0) {
        setWidth((prev) => (prev === next ? prev : next));
      }
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

  const applyDrag = useCallback((kind: DragKind, clientX: number, snap: boolean) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || !kind || kind === "arm") return;
    const latest = latestRef.current;
    const from = viewFromRef.current;
    const localSpan = Math.max(1, viewToRef.current - from);

    if (kind === "pan") {
      const shift = -((clientX - panRef.current.x) / latest.usable) * (panRef.current.to - panRef.current.from);
      const spanMs = panRef.current.to - panRef.current.from;
      let nextFrom = panRef.current.from + shift;
      let nextTo = panRef.current.to + shift;
      if (nextFrom < latest.earliest) {
        nextFrom = latest.earliest;
        nextTo = nextFrom + spanMs;
      }
      if (nextTo > latest.horizon) {
        nextTo = latest.horizon;
        nextFrom = nextTo - spanMs;
      }
      viewFromRef.current = nextFrom;
      viewToRef.current = nextTo;
      latest.onViewFrom(nextFrom);
      latest.onViewTo?.(nextTo);
      return;
    }

    const ratio = clamp((clientX - rect.left - INSET) / latest.usable, 0, 1);
    let at = from + ratio * localSpan;
    if (snap) at = snapMinute(at);

    if (kind === "start") {
      const min = minStartForEnd(latest.endTime, latest.busy, latest.earliest);
      const max = latest.endTime - MIN_DURATION;
      latest.onStartTime(clamp(at, min, max));
      return;
    }

    const min = latest.startTime + MIN_DURATION;
    const max = maxEndForStart(latest.startTime, latest.busy, latest.horizon);
    if (latest.allowLiveEnd && at >= viewToRef.current - MINUTE / 2) {
      latest.onEndTime(null);
      return;
    }
    latest.onEndTime(clamp(at, min, max));
  }, []);

  const applyEdgeScroll = useCallback((kind: "start" | "end", dt: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const latest = latestRef.current;
    const ratio = clamp((lastPointerXRef.current - rect.left - INSET) / latest.usable, 0, 1);
    const step = 48 * MINUTE * dt;

    if (kind === "start" && ratio <= 0.07) {
      const from = viewFromRef.current;
      const min = minStartForEnd(latest.endTime, latest.busy, latest.earliest);
      if (from <= min) return;
      const nextFrom = Math.max(min, latest.earliest, from - step);
      if (nextFrom >= from) return;
      viewFromRef.current = nextFrom;
      latest.onViewFrom(nextFrom);
      latest.onStartTime(nextFrom);
      return;
    }

    if (kind === "end" && ratio >= 0.93) {
      const to = viewToRef.current;
      const max = maxEndForStart(latest.startTime, latest.busy, latest.horizon);
      if (to >= max) return;
      const nextTo = Math.min(max, latest.horizon, to + step);
      if (nextTo <= to) return;
      viewToRef.current = nextTo;
      latest.onViewTo?.(nextTo);
      latest.onEndTime(nextTo);
    }
  }, []);

  const placeAt = useCallback((at: number) => {
    const latest = latestRef.current;
    const placed = relocateToTime({
      anchor: snapMinute(at),
      duration: Math.max(MIN_DURATION, latest.endTime - latest.startTime),
      earliest: latest.earliest,
      latest: latest.horizon,
      busy: latest.busy,
    });
    if (!placed) return;
    latest.onStartTime(placed.start);
    latest.onEndTime(placed.end);
    if (latest.onViewTo) {
      const window = viewAround(placed.start, placed.end, latest.earliest, latest.horizon);
      viewFromRef.current = window.viewFrom;
      viewToRef.current = window.viewTo;
      latest.onViewFrom(window.viewFrom);
      latest.onViewTo(window.viewTo);
    }
  }, []);

  useEffect(() => {
    if (!dragging) return;
    draggingNow = true;
    markSliderGesture();
    onDraggingChange?.(true);
    let lastTs = performance.now();
    let raf = 0;
    const tick = (ts: number) => {
      const dt = Math.min(0.05, (ts - lastTs) / 1000);
      lastTs = ts;
      const kind = dragRef.current;
      if (kind === "start" || kind === "end") applyEdgeScroll(kind, dt);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const move = (event: PointerEvent) => {
      event.preventDefault();
      lastPointerXRef.current = event.clientX;
      if (dragRef.current === "arm") {
        if (Math.abs(event.clientX - armRef.current.x) < 10) return;
        dragRef.current = "pan";
        panRef.current = {
          x: armRef.current.x,
          from: viewFromRef.current,
          to: viewToRef.current,
        };
      }
      applyDrag(dragRef.current, event.clientX, false);
    };
    const up = (event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (dragRef.current === "arm") {
        const at = armRef.current.at;
        const onBusy = latestRef.current.busy.some((block) => at >= block.from && at < block.to);
        if (!onBusy) placeAt(at);
      } else {
        applyDrag(dragRef.current, event.clientX, true);
      }
      draggingNow = false;
      markSliderGesture();
      dragRef.current = null;
      setDragging(null);
      onDraggingChange?.(false);
    };
    window.addEventListener("pointermove", move, { capture: true });
    window.addEventListener("pointerup", up, { capture: true });
    return () => {
      draggingNow = false;
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", move, { capture: true });
      window.removeEventListener("pointerup", up, { capture: true });
    };
  }, [applyDrag, applyEdgeScroll, dragging, onDraggingChange, placeAt]);

  const startX = xFor(startTime);
  const endX = xFor(endTime);
  const ready = width > 40;
  const thumbsClose = endX - startX < 64;

  return (
    <div
      ref={trackRef}
      className={placeInGaps ? "relative h-16 touch-none select-none cursor-grab active:cursor-grabbing" : "relative h-16 touch-none select-none"}
      onPointerDown={(event) => {
        if (disabled || width <= 0) return;
        event.preventDefault();
        event.stopPropagation();
        event.currentTarget.setPointerCapture(event.pointerId);
        markSliderGesture();
        lastPointerXRef.current = event.clientX;
        const rect = event.currentTarget.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const distStart = Math.abs(x - xFor(startTime));
        const distEnd = Math.abs(x - xFor(endTime));
        let kind: DragKind;
        if (distStart <= HIT && distStart <= distEnd) {
          kind = "start";
        } else if (distEnd <= HIT) {
          kind = "end";
        } else if (placeInGaps) {
          kind = "arm";
          const ratio = clamp((x - INSET) / usable, 0, 1);
          armRef.current = { x: event.clientX, at: viewFrom + ratio * span };
        } else {
          kind = distStart <= distEnd ? "start" : "end";
        }
        dragRef.current = kind;
        setDragging(kind);
        if (kind === "start" || kind === "end") {
          applyDrag(kind, event.clientX, false);
        }
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
