"use client";

import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDurationWords } from "@/lib/utils";
import { useTasks } from "@/hooks/use-tasks";
import {
  SessionRangeSlider,
  agoLabel,
  clock,
  initialViewFrom,
  MAX_LOOKBACK,
  sliderGestureBlocksUi,
  snapMinute,
  type BusySpan,
} from "@/components/timer/session-range-slider";
import {
  SessionStampField,
  clampTypedEnd,
  clampTypedStart,
} from "@/components/timer/session-stamp-field";

interface AdjustTimerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentStartTime: number;
  onSave: (session: { startTime: number; endTime: number | null }) => Promise<void>;
  onClearError?: () => void;
  isSaving?: boolean;
  error?: string | null;
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
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const [viewFrom, setViewFrom] = useState(() => initialViewFrom(currentStartTime, Date.now()));
  const [startTime, setStartTime] = useState(currentStartTime);
  const [endTime, setEndTime] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    if (!open) return;
    const at = Date.now();
    setOpenedAt(at);
    setClockNow(at);
    setViewFrom(initialViewFrom(currentStartTime, at));
    setStartTime(currentStartTime);
    setEndTime(null);
    onClearError?.();
  }, [open, currentStartTime, onClearError]);

  useEffect(() => {
    if (!open || dragging) return;
    const id = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open, dragging]);

  const viewTo = openedAt;
  const stillRunning = endTime == null;
  const sliderEnd = endTime ?? viewTo;
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

  const dismissSafe = (next: boolean) => {
    if (!next && sliderGestureBlocksUi()) return;
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={dismissSafe}>
      <DialogContent
        className="sm:max-w-lg"
        onPointerDownOutside={(event) => {
          if (sliderGestureBlocksUi()) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (sliderGestureBlocksUi()) event.preventDefault();
        }}
      >
        <DialogTitle>Fix this session</DialogTitle>
        <DialogDescription className="hidden">
          Drag the start or the end of this session.
        </DialogDescription>

        <div className="space-y-5 pt-1">
          <div className="text-center">
            <p className="font-mono text-4xl font-semibold tabular-nums tracking-tight">
              {formatDurationWords(durationMs)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {stillRunning
                ? `Started ${clock(startTime)} · still running`
                : `Started ${clock(startTime)} · stopped ${clock(sliderEnd)}`}
            </p>
          </div>

          <SessionRangeSlider
            startTime={startTime}
            endTime={sliderEnd}
            endIsLive={stillRunning}
            allowLiveEnd
            busy={busy}
            viewFrom={viewFrom}
            viewTo={viewTo}
            earliest={openedAt - MAX_LOOKBACK}
            disabled={isSaving}
            onViewFrom={setViewFrom}
            onStartTime={setStartTime}
            onEndTime={setEndTime}
            onDraggingChange={setDragging}
          />

          <div className="flex items-start justify-between gap-4 text-sm">
            <SessionStampField
              label="Started"
              value={startTime}
              min={openedAt - MAX_LOOKBACK}
              max={sliderEnd - 60 * 1000}
              now={clockNow}
              onChange={(next) => {
                const clamped = clampTypedStart(next, sliderEnd, busy, openedAt - MAX_LOOKBACK);
                setStartTime(clamped);
                if (clamped < viewFrom) setViewFrom(clamped);
              }}
            />
            <SessionStampField
              label={stillRunning ? "Until · now" : "Until"}
              value={sliderEnd}
              min={startTime + 60 * 1000}
              max={openedAt}
              align="right"
              now={clockNow}
              onChange={(next) => {
                setEndTime(clampTypedEnd(next, startTime, busy, openedAt));
              }}
            />
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
