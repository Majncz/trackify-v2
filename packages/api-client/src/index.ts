import type {
  ProjectSummary,
  QueueAction,
  RunningTimerSnapshot,
  TaskSummary,
  TimeEntry,
  TimeEntryInput,
} from "@trackify/shared-types";

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

  getProjects(signal?: AbortSignal) {
    return this.request<ProjectSummary[]>("/api/projects", { signal });
  }

  getTasks(projectId: string, signal?: AbortSignal) {
    return this.request<TaskSummary[]>(`/api/projects/${projectId}/tasks`, { signal });
  }

  getRunningTimer(signal?: AbortSignal) {
    return this.request<RunningTimerSnapshot>("/api/time/running", { signal });
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
    return this.request<{ synced: number; failed: string[] }>("/api/time/sync", {
      method: "POST",
      body: JSON.stringify({ actions }),
      signal,
    });
  }
}
