import type { TimeEntryInput } from "@trackify/shared-types";

export interface TimerState {
  activeEntryId?: string;
  startedAt?: string;
  note?: string;
  projectId?: string;
  taskId?: string;
}

export type TimerEvent =
  | { type: "START"; payload: TimeEntryInput }
  | { type: "STOP"; payload: { entryId: string } }
  | { type: "UPDATE_NOTE"; payload: { note: string } }
  | { type: "SWITCH_TASK"; payload: { taskId?: string } };

export function reduceTimer(state: TimerState, event: TimerEvent): TimerState {
  switch (event.type) {
    case "START":
      return {
        activeEntryId: `local-${Date.now()}`,
        startedAt: event.payload.startedAt,
        note: event.payload.note,
        projectId: event.payload.projectId,
        taskId: event.payload.taskId,
      };
    case "STOP":
      if (state.activeEntryId !== event.payload.entryId) return state;
      return {};
    case "UPDATE_NOTE":
      if (!state.activeEntryId) return state;
      return { ...state, note: event.payload.note };
    case "SWITCH_TASK":
      if (!state.activeEntryId) return state;
      return { ...state, taskId: event.payload.taskId };
    default:
      return state;
  }
}
