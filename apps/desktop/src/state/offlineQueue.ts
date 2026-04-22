import type { QueueAction } from "@trackify/shared-types";

export class OfflineQueue {
  private readonly actions: QueueAction[] = [];

  enqueue(action: Omit<QueueAction, "attempts">) {
    this.actions.push({ ...action, attempts: 0 });
  }

  list() {
    return [...this.actions];
  }

  size() {
    return this.actions.length;
  }

  markAttempt(actionId: string) {
    const action = this.actions.find((item) => item.id === actionId);
    if (action) action.attempts += 1;
  }

  removeById(actionId: string) {
    const index = this.actions.findIndex((item) => item.id === actionId);
    if (index >= 0) this.actions.splice(index, 1);
  }

  clear() {
    this.actions.length = 0;
  }
}

export function computeBackoffMs(attempt: number) {
  const base = 1500;
  const capped = Math.min(attempt, 6);
  const jitter = Math.floor(Math.random() * 300);
  return Math.pow(2, capped) * base + jitter;
}
