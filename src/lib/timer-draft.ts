import { MIN_EVENT_MS } from "./event-limits";

export type StopItem = {
  id: string;
  kind: "stopping";
  taskId: string;
  startTime: number;
  endTime: number;
  name: string;
};

export type RunItem = {
  kind: "running";
  taskId: string;
  startTime: number;
  synced: boolean;
  updatedAt: number;
};

export type TimerQueue = {
  version: 2;
  userId?: string;
  updatedAt: number;
  stopping: StopItem[];
  running: RunItem | null;
};


const LOCAL_KEY = "trackify.timer-draft.v2";
const SESSION_KEY = "trackify.timer-draft.v2";
const LEGACY_KEY = "trackify.timer-draft.v1";

let memoryQueue: TimerQueue | null = null;

function emptyQueue(userId?: string): TimerQueue {
  return {
    version: 2,
    userId,
    updatedAt: 0,
    stopping: [],
    running: null,
  };
}

function isQueue(value: unknown): value is TimerQueue {
  if (!value || typeof value !== "object") return false;
  const q = value as TimerQueue;
  return q.version === 2 && Array.isArray(q.stopping);
}

function migrateLegacy(raw: string, userId?: string | null): TimerQueue | null {
  try {
    const draft = JSON.parse(raw) as {
      version?: number;
      userId?: string;
      kind?: string;
      taskId?: string;
      startTime?: number;
      endTime?: number;
      name?: string;
      synced?: boolean;
    };
    if (!draft || draft.version !== 1) return null;
    if (userId && draft.userId && draft.userId !== userId) return null;
    const queue = emptyQueue(draft.userId ?? userId ?? undefined);
    queue.updatedAt = Date.now();
    if (draft.kind === "running" && draft.taskId && draft.startTime) {
      queue.running = {
        kind: "running",
        taskId: draft.taskId,
        startTime: draft.startTime,
        synced: Boolean(draft.synced),
        updatedAt: Date.now(),
      };
      return queue;
    }
    if (draft.kind === "stopping" && draft.taskId && draft.startTime && draft.endTime) {
      queue.stopping = [
        {
          id: makeId(),
          kind: "stopping",
          taskId: draft.taskId,
          startTime: draft.startTime,
          endTime: draft.endTime,
          name: draft.name || "Time entry",
        },
      ];
      return queue;
    }
    return null;
  } catch {
    return null;
  }
}

function parseQueue(raw: string | null, userId?: string | null): TimerQueue | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isQueue(parsed)) {
      if (userId && parsed.userId && parsed.userId !== userId) return null;
      return parsed;
    }
  } catch {
    return migrateLegacy(raw, userId);
  }
  return migrateLegacy(raw, userId);
}

function readStore(store: Storage | undefined, key: string, userId?: string | null) {
  if (!store) return null;
  try {
    return parseQueue(store.getItem(key), userId);
  } catch {
    return null;
  }
}

function pickNewest(candidates: Array<TimerQueue | null>): TimerQueue | null {
  return candidates.reduce<TimerQueue | null>((best, current) => {
    if (!current) return best;
    if (!best || current.updatedAt > best.updatedAt) return current;
    return best;
  }, null);
}

function makeId() {
  return `stop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function readTimerQueue(userId?: string | null): TimerQueue {
  if (typeof window === "undefined") {
    return memoryQueue ?? emptyQueue(userId ?? undefined);
  }
  const local = readStore(window.localStorage, LOCAL_KEY, userId);
  const session = readStore(window.sessionStorage, SESSION_KEY, userId);
  const legacyLocal = (() => {
    try {
      const raw = window.localStorage.getItem(LEGACY_KEY);
      return raw ? migrateLegacy(raw, userId) : null;
    } catch {
      return null;
    }
  })();
  const chosen = pickNewest([memoryQueue, local, session, legacyLocal]);
  return chosen ?? emptyQueue(userId ?? undefined);
}

export function writeTimerQueue(queue: TimerQueue) {
  const next = { ...queue, version: 2 as const, updatedAt: Date.now() };
  memoryQueue = next;
  if (typeof window === "undefined") return;
  const raw = JSON.stringify(next);
  try {
    window.localStorage.setItem(LOCAL_KEY, raw);
    window.localStorage.removeItem(LEGACY_KEY);
  } catch {
    // continue with session / memory
  }
  try {
    window.sessionStorage.setItem(SESSION_KEY, raw);
  } catch {
    // memory still holds this tab
  }
}

export function hasPendingWork(queue: TimerQueue = readTimerQueue()) {
  return queue.stopping.length > 0 || Boolean(queue.running && !queue.running.synced);
}

export function pendingStopTaskIds(queue: TimerQueue = readTimerQueue()) {
  return queue.stopping.map((item) => item.taskId);
}

export function enqueueStop(
  input: {
    userId?: string;
    taskId: string;
    startTime: number;
    endTime: number;
    name?: string;
  },
  queue = readTimerQueue(input.userId)
): TimerQueue {
  if (input.endTime - input.startTime < MIN_EVENT_MS) {
    const next: TimerQueue = {
      ...queue,
      userId: input.userId ?? queue.userId,
      running: queue.running && queue.running.taskId === input.taskId ? null : queue.running,
    };
    writeTimerQueue(next);
    return next;
  }
  const next: TimerQueue = {
    ...queue,
    userId: input.userId ?? queue.userId,
    stopping: [
      ...queue.stopping,
      {
        id: makeId(),
        kind: "stopping",
        taskId: input.taskId,
        startTime: input.startTime,
        endTime: input.endTime,
        name: input.name ?? "Time entry",
      },
    ],
    running: queue.running && queue.running.taskId === input.taskId ? null : queue.running,
  };
  writeTimerQueue(next);
  return next;
}

export function enqueueStart(
  input: { userId?: string; taskId: string; startTime: number },
  queue = readTimerQueue(input.userId)
): TimerQueue {
  let next = queue;
  if (queue.running) {
    next = enqueueStop(
      {
        userId: input.userId,
        taskId: queue.running.taskId,
        startTime: queue.running.startTime,
        endTime: input.startTime,
      },
      queue
    );
  }
  next = {
    ...next,
    userId: input.userId ?? next.userId,
    running: {
      kind: "running",
      taskId: input.taskId,
      startTime: input.startTime,
      synced: false,
      updatedAt: Date.now(),
    },
  };
  writeTimerQueue(next);
  return next;
}

export function markRunningSynced(userId?: string | null) {
  const queue = readTimerQueue(userId);
  if (!queue.running) return queue;
  const next = {
    ...queue,
    running: { ...queue.running, synced: true, updatedAt: Date.now() },
  };
  writeTimerQueue(next);
  return next;
}

export function updateRunningStart(startTime: number, userId?: string | null) {
  const queue = readTimerQueue(userId);
  if (!queue.running) return queue;
  const next = {
    ...queue,
    running: { ...queue.running, startTime, synced: false, updatedAt: Date.now() },
  };
  writeTimerQueue(next);
  return next;
}

export function removeStopping(id: string, userId?: string | null) {
  const queue = readTimerQueue(userId);
  const next = {
    ...queue,
    stopping: queue.stopping.filter((item) => item.id !== id),
  };
  writeTimerQueue(next);
  return next;
}

export function clearRunning(userId?: string | null) {
  const queue = readTimerQueue(userId);
  if (!queue.running) return queue;
  const next = { ...queue, running: null };
  writeTimerQueue(next);
  return next;
}

export function adoptServerRunning(
  input: { userId?: string; taskId: string; startTime: number },
  queue = readTimerQueue(input.userId)
) {
  if (hasPendingWork(queue)) return queue;
  const next: TimerQueue = {
    ...queue,
    userId: input.userId ?? queue.userId,
    running: {
      kind: "running",
      taskId: input.taskId,
      startTime: input.startTime,
      synced: true,
      updatedAt: Date.now(),
    },
  };
  writeTimerQueue(next);
  return next;
}
