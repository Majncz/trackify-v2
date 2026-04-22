import { useEffect, useMemo, useRef, useState } from "react";
import { TrackifyApiClient } from "@trackify/api-client";
import type { ProjectSummary, TaskSummary, TimeEntry } from "@trackify/shared-types";
import { formatDuration, secondsSince } from "./lib/time";
import { loadAuthToken, saveAuthToken } from "./lib/auth";
import { OfflineQueue, parseQueueSnapshot } from "./state/offlineQueue";

const fallbackProjects: ProjectSummary[] = [
  { id: "project-1", name: "Trackify Platform" },
  { id: "project-2", name: "Client Work" },
];

const QUEUE_STORAGE_KEY = "trackify.desktop.offlineQueue";

const fallbackTasks: TaskSummary[] = [
  { id: "task-1", projectId: "project-1", name: "Desktop app" },
  { id: "task-2", projectId: "project-1", name: "API integration" },
  { id: "task-3", projectId: "project-2", name: "Meeting" },
];

function makeClient(getToken: () => Promise<string | null>) {
  const baseUrl =
    localStorage.getItem("trackify.desktop.apiBaseUrl")?.trim() || "http://localhost:3000";

  return new TrackifyApiClient({
    baseUrl,
    getToken,
  });
}

export function App() {
  const [projects, setProjects] = useState<ProjectSummary[]>(fallbackProjects);
  const [tasks, setTasks] = useState<TaskSummary[]>(fallbackTasks);
  const [projectId, setProjectId] = useState(fallbackProjects[0]?.id ?? "");
  const [taskId, setTaskId] = useState<string | undefined>(undefined);
  const [note, setNote] = useState("");
  const [runningEntry, setRunningEntry] = useState<TimeEntry | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [todayTotal, setTodayTotal] = useState(0);
  const [status, setStatus] = useState("Loading...");
  const [error, setError] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");

  const queueRef = useRef(new OfflineQueue());
  const tokenRef = useRef<string | null>(null);
  const clientRef = useRef<TrackifyApiClient | null>(null);

  const running = Boolean(runningEntry?.startedAt);

  const persistQueue = () => {
    localStorage.setItem(QUEUE_STORAGE_KEY, queueRef.current.serialize());
  };

  useEffect(() => {
    const boot = async () => {
      const queueSnapshot = parseQueueSnapshot(localStorage.getItem(QUEUE_STORAGE_KEY));
      queueRef.current.hydrate(queueSnapshot);
      if (queueSnapshot.length > 0) {
        setStatus(`Sync pending (${queueSnapshot.length})`);
      }

      try {
        tokenRef.current = await loadAuthToken();
      } catch {
        tokenRef.current = null;
      }

      clientRef.current = makeClient(async () => tokenRef.current);
      await reloadFromApi();
      await queueSync();
      setStatus(queueRef.current.size() > 0 ? `Sync pending (${queueRef.current.size()})` : "Ready");
    };

    boot().catch((bootError) => {
      setStatus("Ready (offline mode)");
      setError(bootError instanceof Error ? bootError.message : "Failed to load data");
    });

    const onOnline = () => {
      queueSync().catch(() => undefined);
    };

    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!runningEntry?.startedAt) {
      setElapsed(0);
      return;
    }

    const tick = () => setElapsed(secondsSince(runningEntry.startedAt));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [runningEntry?.startedAt]);

  const filteredTasks = useMemo(
    () => tasks.filter((task) => task.projectId === projectId),
    [tasks, projectId],
  );

  useEffect(() => {
    if (taskId && !filteredTasks.some((task) => task.id === taskId)) {
      setTaskId(undefined);
    }
  }, [filteredTasks, taskId]);

  const reloadFromApi = async () => {
    const client = clientRef.current;
    if (!client) return;

    try {
      const [apiProjects, runningSnapshot] = await Promise.all([
        client.getProjects(),
        client.getRunningTimer(),
      ]);

      if (apiProjects.length > 0) {
        setProjects(apiProjects);
        setProjectId((current) =>
          current && apiProjects.some((project) => project.id === current)
            ? current
            : apiProjects[0]!.id,
        );
      }

      setRunningEntry(runningSnapshot.entry ?? null);
      setTodayTotal(runningSnapshot.todayTotalSeconds ?? 0);

      if (projectId) {
        const apiTasks = await client.getTasks(projectId);
        if (apiTasks.length > 0) setTasks(apiTasks);
      }

      setError(null);
    } catch (apiError) {
      setStatus("Ready (offline mode)");
      setError(apiError instanceof Error ? apiError.message : "API unavailable");
    }
  };

  const queueSync = async () => {
    const client = clientRef.current;
    if (!client) return;

    const actions = queueRef.current.list();
    if (actions.length === 0) return;

    try {
      const result = await client.syncQueue(actions);
      const failed = new Set(result.failed);
      for (const action of actions) {
        if (!failed.has(action.id)) queueRef.current.removeById(action.id);
      }
      persistQueue();
      setStatus(queueRef.current.size() > 0 ? `Sync pending (${queueRef.current.size()})` : "Ready");
    } catch {
      setStatus("Offline sync pending");
    }
  };

  const startTimer = async () => {
    const startedAt = new Date().toISOString();
    const client = clientRef.current;
    if (!client) return;

    setStatus("Starting timer...");
    setError(null);

    try {
      const entry = await client.startTimer({
        projectId,
        taskId,
        note: note || undefined,
        startedAt,
      });
      setRunningEntry(entry);
      setStatus("Running");
    } catch {
      const optimisticId = `local-${crypto.randomUUID()}`;
      queueRef.current.enqueue({
        id: optimisticId,
        type: "START_TIMER",
        payload: { projectId, taskId, note, startedAt },
        createdAt: startedAt,
      });
      persistQueue();
      setRunningEntry({ id: optimisticId, projectId, taskId, note, startedAt });
      setStatus(`Running (offline queued: ${queueRef.current.size()})`);
    }
  };

  const stopTimer = async () => {
    const client = clientRef.current;
    if (!client || !runningEntry?.id) return;

    setStatus("Stopping timer...");

    try {
      const stopped = await client.stopTimer(runningEntry.id);
      const duration = stopped.durationSeconds ?? elapsed;
      setTodayTotal((value) => value + duration);
      setRunningEntry(null);
      setStatus("Ready");
    } catch {
      queueRef.current.enqueue({
        id: `local-${crypto.randomUUID()}`,
        type: "STOP_TIMER",
        payload: { entryId: runningEntry.id, stoppedAt: new Date().toISOString() },
        createdAt: new Date().toISOString(),
      });
      persistQueue();
      setTodayTotal((value) => value + elapsed);
      setRunningEntry(null);
      setStatus(`Ready (stop queued: ${queueRef.current.size()})`);
    }

    queueSync().catch(() => undefined);
  };

  const handleSaveToken = async () => {
    if (!tokenInput.trim()) return;
    await saveAuthToken(tokenInput.trim());
    tokenRef.current = tokenInput.trim();
    setTokenInput("");
    await reloadFromApi();
    setStatus("Ready");
  };

  return (
    <div className="panel-root">
      <header>
        <div className="label">Trackify Desktop</div>
        <h1>Quick Tracker</h1>
      </header>

      <div className="status-card">
        <div>
          <div className="status-label">Current</div>
          <div className="status-value">{running ? "Running" : "Idle"}</div>
          <div className="status-label">{status}</div>
        </div>
        <div className="clock">{formatDuration(elapsed)}</div>
      </div>

      <div className="form-grid">
        <label>
          Project
          <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
            {projects.map((project) => (
              <option key={project.id} value={project.id}>
                {project.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Task
          <select
            value={taskId ?? ""}
            onChange={(event) => setTaskId(event.target.value || undefined)}
          >
            <option value="">No specific task</option>
            {filteredTasks.map((task) => (
              <option key={task.id} value={task.id}>
                {task.name}
              </option>
            ))}
          </select>
        </label>

        <label>
          Note
          <textarea
            placeholder="What are you working on?"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </label>

        <label>
          API token (stored in OS keychain)
          <input
            type="password"
            value={tokenInput}
            onChange={(event) => setTokenInput(event.target.value)}
            placeholder="Paste access token"
          />
        </label>
        <button className="button-primary" onClick={handleSaveToken}>
          Save token
        </button>
      </div>

      <div className="actions">
        {!running ? (
          <button className="button-primary" onClick={startTimer}>
            Start timer
          </button>
        ) : (
          <button className="button-danger" onClick={stopTimer}>
            Stop timer
          </button>
        )}
      </div>

      {error ? <div className="status-label">⚠ {error}</div> : null}

      <footer>
        <span>Today total</span>
        <strong>{formatDuration(running ? todayTotal + elapsed : todayTotal)}</strong>
      </footer>
    </div>
  );
}
