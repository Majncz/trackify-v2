"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatDurationWords } from "@/lib/utils";
import { useTasks } from "@/hooks/use-tasks";
import { useTimer } from "@/hooks/use-timer";
import { suggestPastRange, typicalDurationMs } from "@/lib/suggest-past-range";
import {
  SessionRangeSlider,
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

interface LogPastDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  taskId: string;
  taskName: string;
}

export function LogPastDialog({
  open,
  onOpenChange,
  taskId,
  taskName,
}: LogPastDialogProps) {
  const { tasks, createEvent } = useTasks();
  const { running, startTime: runningStart, taskId: runningTaskId } = useTimer();
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [openedAt, setOpenedAt] = useState(() => Date.now());
  const [viewFrom, setViewFrom] = useState(() => Date.now() - 90 * 60 * 1000);
  const [startTime, setStartTime] = useState(() => Date.now() - 25 * 60 * 1000);
  const [endTime, setEndTime] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);

  const thisTask = tasks.find((task) => task.id === taskId);

  useEffect(() => {
    if (!open) return;
    const now = Date.now();
    const preferred = typicalDurationMs(thisTask?.events ?? []);
    const allEvents = tasks.flatMap((task) => task.events);
    const guess = suggestPastRange({
      now,
      events: allEvents,
      runningStart: running && runningStart ? runningStart : null,
      preferredMs: preferred,
    });
    setOpenedAt(now);
    setClockNow(now);
    setStartTime(guess.start);
    setEndTime(guess.end);
    setViewFrom(initialViewFrom(guess.start, now));
    setError(null);
    // Seed once per open so a refetch doesn't yank the sliders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const id = window.setInterval(() => setClockNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [open]);

  const busy = useMemo<BusySpan[]>(() => {
    const blocks = tasks.flatMap((task) =>
      task.events.map((event) => ({
        from: new Date(event.from).getTime(),
        to: new Date(event.to).getTime(),
        name: `${task.name}: ${event.name}`,
      }))
    );
    if (running && runningStart) {
      blocks.push({
        from: runningStart,
        to: openedAt,
        name: runningTaskId === taskId ? "This timer" : "Running timer",
      });
    }
    return blocks;
  }, [openedAt, running, runningStart, runningTaskId, taskId, tasks]);

  const durationMs = Math.max(0, endTime - startTime);
  const endedJustNow = openedAt - endTime < 90 * 1000;

  const handleSave = async () => {
    setError(null);
    try {
      await createEvent.mutateAsync({
        taskId,
        from: new Date(snapMinute(startTime)).toISOString(),
        to: new Date(snapMinute(endTime)).toISOString(),
      });
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that time");
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
        <DialogTitle>Add time to {taskName}</DialogTitle>
        <DialogDescription className="hidden">
          Place a finished stretch of this task on the timeline.
        </DialogDescription>

        <div className="space-y-5 pt-1">
          <div className="text-center">
            <p className="font-mono text-4xl font-semibold tabular-nums tracking-tight">
              {formatDurationWords(durationMs)}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {clock(startTime)} → {endedJustNow ? "just now" : clock(endTime)}
            </p>
          </div>

          <SessionRangeSlider
            startTime={startTime}
            endTime={endTime}
            busy={busy}
            viewFrom={viewFrom}
            viewTo={openedAt}
            earliest={openedAt - MAX_LOOKBACK}
            disabled={createEvent.isPending}
            onViewFrom={setViewFrom}
            onStartTime={setStartTime}
            onEndTime={(next) => {
              if (next != null) setEndTime(next);
            }}
          />

          <div className="flex items-start justify-between gap-4 text-sm">
            <SessionStampField
              label="From"
              value={startTime}
              min={openedAt - MAX_LOOKBACK}
              max={endTime - 60 * 1000}
              busy={busy}
              now={clockNow}
              onChange={(next) => {
                const clamped = clampTypedStart(next, endTime, busy, openedAt - MAX_LOOKBACK);
                setStartTime(clamped);
                if (clamped < viewFrom) setViewFrom(clamped);
              }}
            />
            <SessionStampField
              label="Until"
              value={endTime}
              min={startTime + 60 * 1000}
              max={openedAt}
              busy={busy}
              align="right"
              now={clockNow}
              onChange={(next) => {
                setEndTime(clampTypedEnd(next, startTime, busy, openedAt));
              }}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={createEvent.isPending}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={createEvent.isPending}>
              {createEvent.isPending
                ? "Adding…"
                : `Add ${formatDurationWords(durationMs)}`}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
