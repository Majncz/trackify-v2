import type {
  ProjectSummary,
  QueueAction,
  QueueSyncResult,
  RunningTimerSnapshot,
  TaskSummary,
  TimeEntry,
  TimeEntryInput,
} from "@trackify/shared-types";

const DESKTOP_PROJECT_ID = "desktop-workspace";
const DESKTOP_PROJECT_NAME = "Trackify";

interface BackendTask {
  id: string;
  name: string;
  hidden?: boolean;
}

interface BackendStatsResponse {
  todayTotal: number;
}

export interface ApiClientOptions {
  baseUrl: string;
  getToken: () => Promise<string | null>;
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class TrackifyApiClient {
  constructor(private readonly options: ApiClientOptions) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const token = await this.options.getToken();

    const response = await fetch(`${this.options.baseUrl}${path}`, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(init?.headers ?? {}),
      },
    });

    if (!response.ok) {
      throw new ApiError(response.status, `API ${response.status}: ${await response.text()}`);
    }

    return response.json() as Promise<T>;
  }

  getProjects(_signal?: AbortSignal) {
    return Promise.resolve<ProjectSummary[]>([
      { id: DESKTOP_PROJECT_ID, name: DESKTOP_PROJECT_NAME },
    ]);
  }

  async getTasks(_projectId: string, signal?: AbortSignal) {
    const tasks = await this.request<BackendTask[]>("/api/tasks", { signal });
    return tasks
      .filter((task) => !task.hidden)
      .map((task) => ({
        id: task.id,
        name: task.name,
        projectId: DESKTOP_PROJECT_ID,
      } satisfies TaskSummary));
  }

  getRunningTimer(signal?: AbortSignal): Promise<RunningTimerSnapshot> {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
    return this.request<RunningTimerSnapshot>(`/api/time/running?timezone=${encodeURIComponent(timezone)}`, { signal });
  }

  startTimer(input: TimeEntryInput, signal?: AbortSignal) {
    return this.request<TimeEntry>("/api/time/start", {
      method: "POST",
      body: JSON.stringify(input),
      signal,
    });
  }

  stopTimer(entryId: string, signal?: AbortSignal) {
    return this.request<TimeEntry>(`/api/time/${entryId}/stop`, {
      method: "POST",
      signal,
    });
  }

  updateNote(entryId: string, note: string, signal?: AbortSignal) {
    return this.request<TimeEntry>(`/api/time/${entryId}/note`, {
      method: "PATCH",
      body: JSON.stringify({ note }),
      signal,
    });
  }

  syncQueue(actions: QueueAction[], signal?: AbortSignal) {
    return this.request<QueueSyncResult>("/api/time/sync", {
      method: "POST",
      body: JSON.stringify({ actions }),
      signal,
    });
  }
}
