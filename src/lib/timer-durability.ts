import {
  clearRunning,
  hasPendingWork,
  markRunningSynced,
  readTimerQueue,
  removeStopping,
} from "./timer-draft";
import {
  persistRunningTimer,
  persistStoppedTimer,
  persistTimeEntry,
  sleep,
} from "./timer-sync";

export const TIMER_SYNC_EVENT = "trackify-timer-sync";

export type TimerSyncDetail =
  | { result: "ok"; kind: "running"; taskId: string }
  | { result: "ok"; kind: "stopping"; taskId: string }
  | { result: "rejected"; kind: "running" | "stopping"; taskId: string; error: string };

let syncing = false;
let started = false;

function emitSync(detail: TimerSyncDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<TimerSyncDetail>(TIMER_SYNC_EVENT, { detail }));
}

async function persistNext(): Promise<"done" | "continue" | "retry" | "rejected"> {
  const queue = readTimerQueue();
  const stopping = queue.stopping[0];
  if (stopping) {
    const entry = await persistTimeEntry({
      taskId: stopping.taskId,
      name: stopping.name,
      from: new Date(stopping.startTime).toISOString(),
      to: new Date(stopping.endTime).toISOString(),
    });
    if (entry.result === "ok") {
      await persistStoppedTimer(stopping.taskId);
      removeStopping(stopping.id);
      emitSync({ result: "ok", kind: "stopping", taskId: stopping.taskId });
      return hasPendingWork() ? "continue" : "done";
    }
    if (entry.result === "rejected") {
      emitSync({
        result: "rejected",
        kind: "stopping",
        taskId: stopping.taskId,
        error: entry.error || "Failed to save time entry",
      });
      return "rejected";
    }
    return "retry";
  }

  const running = queue.running;
  if (running && !running.synced) {
    const { result, error } = await persistRunningTimer(running.taskId, running.startTime);
    if (result === "ok") {
      markRunningSynced();
      emitSync({ result: "ok", kind: "running", taskId: running.taskId });
      return "done";
    }
    if (result === "rejected") {
      clearRunning();
      emitSync({
        result: "rejected",
        kind: "running",
        taskId: running.taskId,
        error: error || "Failed to start timer",
      });
      return "rejected";
    }
    return "retry";
  }

  return "done";
}

async function runSync() {
  if (syncing) return;
  syncing = true;
  try {
    let backoff = 600;
    while (hasPendingWork()) {
      const outcome = await persistNext();
      if (outcome === "done") return;
      if (outcome === "continue") {
        backoff = 600;
        continue;
      }
      if (outcome === "rejected") return;
      await sleep(backoff);
      backoff = Math.min(backoff * 1.6, 8000);
    }
  } finally {
    syncing = false;
  }
}

export function kickTimerDurability() {
  void runSync();
}

function flushOnHide() {
  const queue = readTimerQueue();
  for (const stopping of queue.stopping) {
    void persistTimeEntry({
      taskId: stopping.taskId,
      name: stopping.name,
      from: new Date(stopping.startTime).toISOString(),
      to: new Date(stopping.endTime).toISOString(),
    });
  }
  if (queue.running && !queue.running.synced) {
    void persistRunningTimer(queue.running.taskId, queue.running.startTime);
  }
}

export function startTimerDurability() {
  if (started || typeof window === "undefined") return;
  started = true;
  window.addEventListener("online", kickTimerDurability);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flushOnHide();
      return;
    }
    kickTimerDurability();
  });
  window.addEventListener("pageshow", kickTimerDurability);
  window.addEventListener("pagehide", flushOnHide);
  window.addEventListener("beforeunload", flushOnHide);
  kickTimerDurability();
}
