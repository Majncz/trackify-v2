export type SyncResult = "ok" | "rejected" | "retry";

async function readError(res: Response): Promise<string> {
  const data = await res.json().catch(() => ({}));
  return typeof data.error === "string" ? data.error : `Request failed (${res.status})`;
}

function classify(res: Response): SyncResult {
  if (res.ok) return "ok";
  if (res.status === 408 || res.status === 429 || res.status >= 500) return "retry";
  if (res.status === 401 || res.status === 403) return "retry";
  return "rejected";
}

export async function persistRunningTimer(
  taskId: string,
  startTime: number
): Promise<{ result: SyncResult; error?: string }> {
  try {
    const res = await fetch("/api/timer", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId,
        startTime: new Date(startTime).toISOString(),
      }),
      keepalive: true,
    });
    if (res.ok) return { result: "ok" };
    return { result: classify(res), error: await readError(res) };
  } catch {
    return { result: "retry" };
  }
}

export async function persistStoppedTimer(taskId: string): Promise<SyncResult> {
  try {
    const res = await fetch(`/api/timer?taskId=${encodeURIComponent(taskId)}`, {
      method: "DELETE",
      keepalive: true,
    });
    if (res.ok) return "ok";
    return classify(res) === "rejected" ? "ok" : "retry";
  } catch {
    return "retry";
  }
}

export async function persistTimeEntry(data: {
  taskId: string;
  name: string;
  from: string;
  to: string;
}): Promise<{ result: SyncResult; error?: string }> {
  try {
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
      keepalive: true,
    });
    if (res.ok) return { result: "ok" };
    if (res.status === 409) {
      const alreadySaved = await hasMatchingEvent(data);
      if (alreadySaved) return { result: "ok" };
    }
    return { result: classify(res), error: await readError(res) };
  } catch {
    return { result: "retry" };
  }
}

async function hasMatchingEvent(data: {
  taskId: string;
  from: string;
  to: string;
}): Promise<boolean> {
  try {
    const res = await fetch(`/api/events?taskId=${encodeURIComponent(data.taskId)}`);
    if (!res.ok) return false;
    const events = (await res.json()) as Array<{ from?: string; to?: string }>;
    const from = new Date(data.from).getTime();
    const to = new Date(data.to).getTime();
    return events.some((event) => {
      const eventFrom = new Date(event.from ?? "").getTime();
      const eventTo = new Date(event.to ?? "").getTime();
      return Math.abs(eventFrom - from) < 2000 && Math.abs(eventTo - to) < 2000;
    });
  } catch {
    return false;
  }
}

export type ServerTimerLookup =
  | { status: "unknown" }
  | { status: "ok"; running: false }
  | { status: "ok"; running: true; taskId: string; startTime: number };

export async function fetchServerTimer(): Promise<ServerTimerLookup> {
  try {
    const res = await fetch("/api/timer");
    if (!res.ok) return { status: "unknown" };
    const data = (await res.json()) as {
      running?: boolean;
      taskId?: string;
      startTime?: number;
    };
    if (data.running && data.taskId && data.startTime) {
      return {
        status: "ok",
        running: true,
        taskId: data.taskId,
        startTime: data.startTime,
      };
    }
    return { status: "ok", running: false };
  } catch {
    return { status: "unknown" };
  }
}

export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
