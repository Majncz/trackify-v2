export type TimerStatus = "idle" | "running" | "syncing" | "error";

export interface ProjectSummary {
  id: string;
  name: string;
}

export interface TaskSummary {
  id: string;
  projectId: string;
  name: string;
}

export interface TimeEntryInput {
  projectId: string;
  taskId?: string;
  note?: string;
  startedAt: string;
}

export interface TimeEntry {
  id: string;
  projectId: string;
  taskId?: string;
  note?: string;
  startedAt: string;
  stoppedAt?: string;
  durationSeconds?: number;
}

export interface RunningTimerSnapshot {
  status: TimerStatus;
  entry?: TimeEntry;
  queuedActions: number;
  todayTotalSeconds: number;
}

export type QueueActionType =
  | "START_TIMER"
  | "STOP_TIMER"
  | "UPDATE_NOTE"
  | "SWITCH_TASK";

export interface QueueAction {
  id: string;
  type: QueueActionType;
  payload: Record<string, unknown>;
  createdAt: string;
  attempts: number;
}
