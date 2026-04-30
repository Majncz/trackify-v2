import type { ProjectSummary, TaskSummary, TimeEntry } from "@trackify/shared-types";
import { parseQueueSnapshot } from "../state/offlineQueue";

export const QUEUE_STORAGE_KEY = "trackify.desktop.offlineQueue";
export const RUNNING_ENTRY_STORAGE_KEY = "trackify.desktop.runningEntry";
export const ENTITY_CACHE_STORAGE_KEY = "trackify.desktop.entityCache";

export interface DesktopEntityCache {
  projects: ProjectSummary[];
  tasks: TaskSummary[];
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // best effort cache only
  }
}

export function loadQueueSnapshot() {
  return parseQueueSnapshot(readStorage(QUEUE_STORAGE_KEY));
}

export function saveQueueSnapshot(serializedQueue: string) {
  writeStorage(QUEUE_STORAGE_KEY, serializedQueue);
}

export function clearQueueSnapshot() {
  writeStorage(QUEUE_STORAGE_KEY, "[]");
}

function isProjectSummary(value: unknown): value is ProjectSummary {
  return !!value && typeof value === "object" && typeof (value as ProjectSummary).id === "string" && typeof (value as ProjectSummary).name === "string";
}

function isTaskSummary(value: unknown): value is TaskSummary {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as TaskSummary).id === "string" &&
    typeof (value as TaskSummary).projectId === "string" &&
    typeof (value as TaskSummary).name === "string"
  );
}

function isTimeEntry(value: unknown): value is TimeEntry {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as TimeEntry).id === "string" &&
    typeof (value as TimeEntry).projectId === "string" &&
    typeof (value as TimeEntry).startedAt === "string"
  );
}

export function loadEntityCache(): DesktopEntityCache {
  const raw = readStorage(ENTITY_CACHE_STORAGE_KEY);
  if (!raw) return { projects: [], tasks: [] };

  try {
    const parsed = JSON.parse(raw) as Partial<DesktopEntityCache>;
    return {
      projects: Array.isArray(parsed.projects) ? parsed.projects.filter(isProjectSummary) : [],
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks.filter(isTaskSummary) : [],
    };
  } catch {
    return { projects: [], tasks: [] };
  }
}

export function saveEntityCache(cache: DesktopEntityCache) {
  writeStorage(ENTITY_CACHE_STORAGE_KEY, JSON.stringify(cache));
}

export function clearEntityCache() {
  try {
    localStorage.removeItem(ENTITY_CACHE_STORAGE_KEY);
  } catch {
    // best effort only
  }
}

export function loadRunningEntrySnapshot(): TimeEntry | null {
  const raw = readStorage(RUNNING_ENTRY_STORAGE_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw);
    return isTimeEntry(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function saveRunningEntrySnapshot(entry: TimeEntry | null) {
  if (!entry) {
    try {
      localStorage.removeItem(RUNNING_ENTRY_STORAGE_KEY);
    } catch {
      // best effort only
    }
    return;
  }

  writeStorage(RUNNING_ENTRY_STORAGE_KEY, JSON.stringify(entry));
}
