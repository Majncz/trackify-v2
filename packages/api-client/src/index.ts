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
      throw new Error(`API ${response.status}: ${await response.text()}`);
    }

    return response.json() as Promise<T>;
  }

  getProjects() {
    return this.request<ProjectSummary[]>("/api/projects");
  }

  getTasks(projectId: string) {
    return this.request<TaskSummary[]>(`/api/projects/${projectId}/tasks`);
  }

  getRunningTimer() {
    return this.request<RunningTimerSnapshot>("/api/time/running");
  }

  startTimer(input: TimeEntryInput) {
    return this.request<TimeEntry>("/api/time/start", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  stopTimer(entryId: string) {
    return this.request<TimeEntry>(`/api/time/${entryId}/stop`, {
      method: "POST",
    });
  }

  updateNote(entryId: string, note: string) {
    return this.request<TimeEntry>(`/api/time/${entryId}/note`, {
      method: "PATCH",
      body: JSON.stringify({ note }),
    });
  }

  syncQueue(actions: QueueAction[]) {
    return this.request<{ synced: number; failed: string[] }>("/api/time/sync", {
      method: "POST",
      body: JSON.stringify({ actions }),
    });
  }
}
