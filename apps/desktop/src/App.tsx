import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, TrackifyApiClient } from "@trackify/api-client";
import type { ProjectSummary, TaskSummary, TimeEntry } from "@trackify/shared-types";
import { formatDuration, secondsSince } from "./lib/time";
import { clearAuthToken, loadAuthToken, saveAuthToken } from "./lib/auth";
import {
  DEFAULT_API_BASE_URL,
  loadDesktopPreferences,
  saveDesktopPreferences,
} from "./lib/preferences";
import { readLaunchAtLoginEnabled, setLaunchAtLoginEnabled } from "./lib/startup";
import {
  clearEntityCache,
  loadEntityCache,
  loadQueueSnapshot,
  loadRunningEntrySnapshot,
  saveEntityCache,
  saveQueueSnapshot,
  saveRunningEntrySnapshot,
} from "./lib/offlineState";
import { listenForTrayActions, updateTrayState } from "./lib/tray";
import { OfflineQueue, computeBackoffMs } from "./state/offlineQueue";

const fallbackProjects: ProjectSummary[] = [
  { id: "project-1", name: "Trackify Platform" },
  { id: "project-2", name: "Client Work" },
];

const fallbackTasks: TaskSummary[] = [
  { id: "task-1", projectId: "project-1", name: "Desktop app" },
  { id: "task-2", projectId: "project-1", name: "API integration" },
  { id: "task-3", projectId: "project-2", name: "Meeting" },
];

function isAuthError(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 401 || error.status === 403);
}

function isSyncConflictError(error: unknown): error is ApiError {
  return error instanceof ApiError && (error.status === 404 || error.status === 409);
}

function makeClient(baseUrl: string, getToken: () => Promise<string | null>) {
  return new TrackifyApiClient({
    baseUrl,
    getToken,
  });
}

export function App() {
  const initialEntityCache = useRef(loadEntityCache()).current;
  const initialRunningEntry = useRef(loadRunningEntrySnapshot()).current;
  const initialProjects = initialEntityCache.projects.length > 0 ? initialEntityCache.projects : fallbackProjects;
  const initialProjectId = initialRunningEntry?.projectId ?? initialProjects[0]?.id ?? "";
  const initialTasks = initialEntityCache.tasks.length > 0 ? initialEntityCache.tasks : fallbackTasks;

  const [projects, setProjects] = useState<ProjectSummary[]>(initialProjects);
  const [tasks, setTasks] = useState<TaskSummary[]>(initialTasks);
  const [projectId, setProjectId] = useState(initialProjectId);
  const [taskId, setTaskId] = useState<string | undefined>(initialRunningEntry?.taskId);
  const [note, setNote] = useState(initialRunningEntry?.note ?? "");
  const [runningEntry, setRunningEntry] = useState<TimeEntry | null>(initialRunningEntry);
  const [elapsed, setElapsed] = useState(0);
  const [todayTotal, setTodayTotal] = useState(0);
  const [status, setStatus] = useState("Loading...");
  const [error, setError] = useState<string | null>(null);
  const [tokenInput, setTokenInput] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState(DEFAULT_API_BASE_URL);
  const [launchAtLoginEnabled, setLaunchAtLoginState] = useState(false);
  const [settingsBusy, setSettingsBusy] = useState(false);

  const queueRef = useRef(new OfflineQueue());
  const tokenRef = useRef<string | null>(null);
  const clientRef = useRef<TrackifyApiClient | null>(null);
  const entityCacheRef = useRef(initialEntityCache);
  const taskRequestIdRef = useRef(0);
  const authGenerationRef = useRef(0);
  const syncInFlightRef = useRef<Promise<void> | null>(null);
  const syncRetryTimeoutRef = useRef<number | null>(null);
  const reloadAbortControllerRef = useRef<AbortController | null>(null);
  const syncAbortControllerRef = useRef<AbortController | null>(null);
  const startMutationAbortControllerRef = useRef<AbortController | null>(null);
  const stopMutationAbortControllerRef = useRef<AbortController | null>(null);
  const startTimerActionRef = useRef<(() => Promise<void>) | null>(null);
  const stopTimerActionRef = useRef<(() => Promise<void>) | null>(null);

  const running = Boolean(runningEntry?.startedAt);

  const shouldResetSession = (error: unknown) => Boolean(tokenRef.current) && isAuthError(error);

  const persistQueue = () => {
    saveQueueSnapshot(queueRef.current.serialize());
  };

  const persistEntityCache = (
    nextProjects: ProjectSummary[],
    nextTasks: TaskSummary[],
    replaceProjectId?: string,
  ) => {
    const mergedTasks = replaceProjectId
      ? [
          ...entityCacheRef.current.tasks.filter((task) => task.projectId !== replaceProjectId),
          ...nextTasks,
        ]
      : nextTasks;
    const nextCache = { projects: nextProjects, tasks: mergedTasks };
    entityCacheRef.current = nextCache;
    saveEntityCache(nextCache);
  };

  const clearSyncRetry = () => {
    if (syncRetryTimeoutRef.current !== null) {
      window.clearTimeout(syncRetryTimeoutRef.current);
      syncRetryTimeoutRef.current = null;
    }
  };

  const scheduleQueueRetry = () => {
    const actions = queueRef.current.list();
    if (actions.length === 0) {
      clearSyncRetry();
      return;
    }

    clearSyncRetry();
    const highestAttempt = Math.max(...actions.map((action) => action.attempts));
    const retryInMs = computeBackoffMs(highestAttempt);
    syncRetryTimeoutRef.current = window.setTimeout(() => {
      syncRetryTimeoutRef.current = null;
      queueSync().catch(() => undefined);
    }, retryInMs);
  };

  const handleSessionExpired = async (message = "Session expired. Please sign in again.") => {
    authGenerationRef.current += 1;
    clearSyncRetry();
    reloadAbortControllerRef.current?.abort();
    syncAbortControllerRef.current?.abort();
    startMutationAbortControllerRef.current?.abort();
    stopMutationAbortControllerRef.current?.abort();

    try {
      await clearAuthToken();
    } catch {
      // best effort: still reset local auth/session state below
    }

    tokenRef.current = null;
    clientRef.current = makeClient(apiBaseUrl, async () => null);
    queueRef.current.hydrate([]);
    persistQueue();
    clearEntityCache();
    entityCacheRef.current = { projects: [], tasks: [] };
    saveRunningEntrySnapshot(null);
    setProjects(fallbackProjects);
    setTasks(fallbackTasks.filter((task) => task.projectId === fallbackProjects[0]?.id));
    setProjectId(fallbackProjects[0]?.id ?? "");
    setTaskId(undefined);
    setRunningEntry(null);
    setTodayTotal(0);
    setNote("");
    setStatus(message);
    setError(message);
  };

  const refreshTasks = async (
    nextProjectId: string,
    authGeneration = authGenerationRef.current,
    signal?: AbortSignal,
    projectsForCache: ProjectSummary[] = projects,
  ) => {
    const client = clientRef.current;
    if (!client || !nextProjectId) return;

    const requestId = ++taskRequestIdRef.current;
    const cachedTasksForProject = entityCacheRef.current.tasks.filter((task) => task.projectId === nextProjectId);
    const demoFallbackForProject = fallbackTasks.filter((task) => task.projectId === nextProjectId);
    const fallbackForProject = cachedTasksForProject.length > 0 ? cachedTasksForProject : demoFallbackForProject;

    try {
      const apiTasks = await client.getTasks(nextProjectId, signal);
      if (signal?.aborted || authGeneration !== authGenerationRef.current || requestId !== taskRequestIdRef.current) return;
      const nextTasks = apiTasks.length > 0 ? apiTasks : fallbackForProject;
      const tasksToPersist = apiTasks.length > 0 ? apiTasks : cachedTasksForProject;
      setTasks(nextTasks);
      persistEntityCache(projectsForCache, tasksToPersist, nextProjectId);
    } catch (taskError) {
      if (signal?.aborted || authGeneration !== authGenerationRef.current || requestId !== taskRequestIdRef.current) return;
      if (shouldResetSession(taskError)) {
        await handleSessionExpired();
        return;
      }
      setTasks(fallbackForProject);
      persistEntityCache(projectsForCache, cachedTasksForProject, nextProjectId);
    }
  };

  const reloadFromApi = async (preferredProjectId?: string) => {
    const client = clientRef.current;
    if (!client) return false;

    const authGeneration = authGenerationRef.current;
    const abortController = new AbortController();
    reloadAbortControllerRef.current?.abort();
    reloadAbortControllerRef.current = abortController;

    try {
      const [apiProjects, runningSnapshot] = await Promise.all([
        client.getProjects(abortController.signal),
        client.getRunningTimer(abortController.signal),
      ]);

      if (abortController.signal.aborted || authGeneration !== authGenerationRef.current) {
        return false;
      }

      let resolvedProjectId = preferredProjectId ?? projectId;
      const projectsForCache = apiProjects.length > 0 ? apiProjects : entityCacheRef.current.projects;
      if (apiProjects.length > 0) {
        setProjects(apiProjects);
        resolvedProjectId =
          resolvedProjectId && apiProjects.some((project) => project.id === resolvedProjectId)
            ? resolvedProjectId
            : apiProjects[0]!.id;
        setProjectId(resolvedProjectId);
      }

      setRunningEntry(runningSnapshot.entry ?? null);
      setTodayTotal(runningSnapshot.todayTotalSeconds ?? 0);
      setStatus(runningSnapshot.entry ? "Running" : "Ready");

      if (resolvedProjectId) {
        await refreshTasks(resolvedProjectId, authGeneration, abortController.signal, projectsForCache);
      } else if (projectsForCache.length > 0) {
        persistEntityCache(projectsForCache, entityCacheRef.current.tasks);
      }

      if (abortController.signal.aborted || authGeneration !== authGenerationRef.current) {
        return false;
      }

      setError(null);
      return true;
    } catch (apiError) {
      if (abortController.signal.aborted || authGeneration !== authGenerationRef.current) {
        return false;
      }

      if (shouldResetSession(apiError)) {
        await handleSessionExpired();
        return false;
      }

      setStatus("Ready (offline mode)");
      const message = apiError instanceof Error ? apiError.message : "API unavailable";
      setError(message);
      throw apiError instanceof Error ? apiError : new Error(message);
    } finally {
      if (reloadAbortControllerRef.current === abortController) {
        reloadAbortControllerRef.current = null;
      }
    }
  };

  const queueSync = async () => {
    if (syncInFlightRef.current) {
      return syncInFlightRef.current;
    }

    const work = (async () => {
      const client = clientRef.current;
      if (!client) return;

      const actions = queueRef.current.list();
      if (actions.length === 0) return;

      const authGeneration = authGenerationRef.current;
      const abortController = new AbortController();
      syncAbortControllerRef.current?.abort();
      syncAbortControllerRef.current = abortController;

      try {
        const result = await client.syncQueue(actions, abortController.signal);
        if (abortController.signal.aborted || authGeneration !== authGenerationRef.current) {
          return;
        }

        const failuresById = new Map(result.failed.map((failure) => [failure.id, failure]));
        const permanentFailures = result.failed.filter((failure) => failure.permanent);
        const transientFailures = result.failed.filter((failure) => !failure.permanent);

        for (const action of actions) {
          const failure = failuresById.get(action.id);
          if (!failure) {
            queueRef.current.removeById(action.id);
            continue;
          }

          if (failure.permanent) {
            queueRef.current.removeById(action.id);
            continue;
          }

          queueRef.current.markAttempt(action.id);
        }
        persistQueue();

        if (result.synced > 0 || permanentFailures.length > 0) {
          await reloadFromApi(projectId || fallbackProjects[0]?.id);
        }

        if (abortController.signal.aborted || authGeneration !== authGenerationRef.current) {
          return;
        }

        if (permanentFailures.length > 0) {
          const message = permanentFailures.map((failure) => failure.message).find(Boolean) ?? "Offline sync conflict";
          setError(message);
        }

        if (transientFailures.length > 0) {
          scheduleQueueRetry();
        } else {
          clearSyncRetry();
        }
        setStatus(queueRef.current.size() > 0 ? `Sync pending (${queueRef.current.size()})` : "Ready");
      } catch (syncError) {
        if (abortController.signal.aborted || authGeneration !== authGenerationRef.current) {
          return;
        }
        if (shouldResetSession(syncError)) {
          await handleSessionExpired();
          return;
        }
        for (const action of actions) {
          queueRef.current.markAttempt(action.id);
        }
        persistQueue();
        scheduleQueueRetry();
        setStatus("Offline sync pending");
      } finally {
        if (syncAbortControllerRef.current === abortController) {
          syncAbortControllerRef.current = null;
        }
      }
    })();

    syncInFlightRef.current = work;
    try {
      await work;
    } finally {
      if (syncInFlightRef.current === work) {
        syncInFlightRef.current = null;
      }
    }
  };

  useEffect(() => {
    const boot = async () => {
      const preferences = loadDesktopPreferences();
      setApiBaseUrl(preferences.apiBaseUrl);

      const queueSnapshot = loadQueueSnapshot();
      queueRef.current.hydrate(queueSnapshot);
      if (queueSnapshot.length > 0) {
        setStatus(`Sync pending (${queueSnapshot.length})`);
      }

      const cachedEntityState = loadEntityCache();
      entityCacheRef.current = cachedEntityState;
      if (cachedEntityState.projects.length > 0) {
        setProjects(cachedEntityState.projects);
      }
      if (cachedEntityState.tasks.length > 0) {
        setTasks(cachedEntityState.tasks);
      }

      const cachedRunningEntry = loadRunningEntrySnapshot();
      if (cachedRunningEntry) {
        setRunningEntry(cachedRunningEntry);
        setProjectId(cachedRunningEntry.projectId);
        setTaskId(cachedRunningEntry.taskId);
        setNote(cachedRunningEntry.note ?? "");
        if (queueSnapshot.length === 0) {
          setStatus("Recovered running timer");
        }
      }

      try {
        tokenRef.current = await loadAuthToken();
      } catch {
        tokenRef.current = null;
      }

      try {
        setLaunchAtLoginState(await readLaunchAtLoginEnabled());
      } catch {
        setLaunchAtLoginState(false);
      }

      clientRef.current = makeClient(preferences.apiBaseUrl, async () => tokenRef.current);

      const hasPersistedOfflineState =
        queueSnapshot.length > 0 ||
        Boolean(cachedRunningEntry) ||
        cachedEntityState.projects.length > 0 ||
        cachedEntityState.tasks.length > 0;

      if (!tokenRef.current && hasPersistedOfflineState) {
        setStatus(queueSnapshot.length > 0 ? `Sync pending (${queueSnapshot.length})` : cachedRunningEntry ? "Recovered running timer" : "Ready (offline mode)");
        return;
      }

      const authGeneration = authGenerationRef.current;
      await reloadFromApi(preferences.apiBaseUrl ? projectId : undefined);
      if (authGeneration !== authGenerationRef.current) {
        return;
      }
      await queueSync();
      if (authGeneration !== authGenerationRef.current) {
        return;
      }
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
    return () => {
      clearSyncRetry();
      window.removeEventListener("online", onOnline);
    };
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

  useEffect(() => {
    saveRunningEntrySnapshot(runningEntry);
  }, [runningEntry]);

  const filteredTasks = useMemo(
    () => tasks.filter((task) => task.projectId === projectId),
    [tasks, projectId],
  );
  const selectedProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projectId, projects],
  );
  const selectedTask = useMemo(
    () => tasks.find((task) => task.id === taskId) ?? null,
    [taskId, tasks],
  );

  useEffect(() => {
    if (taskId && !filteredTasks.some((task) => task.id === taskId)) {
      setTaskId(undefined);
      return;
    }

    if (!taskId && filteredTasks.length > 0) {
      setTaskId(filteredTasks[0]!.id);
    }
  }, [filteredTasks, taskId]);

  useEffect(() => {
    if (!projectId) return;
    refreshTasks(projectId).catch(() => undefined);
  }, [projectId]);

  useEffect(() => {
    let active = true;
    let unlisten: (() => void) | undefined;

    listenForTrayActions((action) => {
      if (action === "start") {
        void startTimerActionRef.current?.();
      } else if (action === "stop") {
        void stopTimerActionRef.current?.();
      }
    })
      .then((cleanup) => {
        if (!active) {
          cleanup();
          return;
        }
        unlisten = cleanup;
      })
      .catch(() => undefined);

    return () => {
      active = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    const parts = [selectedProject?.name, selectedTask?.name, note.trim() || undefined].filter(Boolean);
    const detail = parts.join(" · ") || undefined;

    updateTrayState({
      detail,
      running,
      status,
    }).catch(() => undefined);
  }, [note, running, selectedProject?.name, selectedTask?.name, status]);

  const startTimer = async () => {
    if (!taskId) {
      setError("No task available for timer start.");
      setStatus("Ready");
      return;
    }

    const startedAt = new Date().toISOString();
    const client = clientRef.current;
    if (!client) return;

    const authGeneration = authGenerationRef.current;
    const abortController = new AbortController();
    startMutationAbortControllerRef.current?.abort();
    startMutationAbortControllerRef.current = abortController;

    setStatus("Starting timer...");
    setError(null);

    try {
      const entry = await client.startTimer(
        {
          projectId,
          taskId,
          note: note || undefined,
          startedAt,
        },
        abortController.signal,
      );
      if (abortController.signal.aborted || authGeneration !== authGenerationRef.current) {
        return;
      }
      setRunningEntry(entry);
      setStatus("Running");
    } catch (timerError) {
      if (abortController.signal.aborted || authGeneration !== authGenerationRef.current) {
        return;
      }
      if (shouldResetSession(timerError)) {
        await handleSessionExpired();
        return;
      }
      if (isSyncConflictError(timerError)) {
        await reloadFromApi(projectId);
        setError(timerError.message);
        setStatus("Ready");
        return;
      }

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
      queueSync().catch(() => undefined);
    } finally {
      if (startMutationAbortControllerRef.current === abortController) {
        startMutationAbortControllerRef.current = null;
      }
    }
  };
  startTimerActionRef.current = startTimer;

  const stopTimer = async () => {
    const client = clientRef.current;
    if (!client || !runningEntry?.id) return;

    const authGeneration = authGenerationRef.current;
    const abortController = new AbortController();
    stopMutationAbortControllerRef.current?.abort();
    stopMutationAbortControllerRef.current = abortController;

    setStatus("Stopping timer...");

    try {
      const stopped = await client.stopTimer(runningEntry.id, abortController.signal);
      if (abortController.signal.aborted || authGeneration !== authGenerationRef.current) {
        return;
      }
      const duration = stopped.durationSeconds ?? elapsed;
      setTodayTotal((value) => value + duration);
      setRunningEntry(null);
      setStatus("Ready");
    } catch (timerError) {
      if (abortController.signal.aborted || authGeneration !== authGenerationRef.current) {
        return;
      }
      if (shouldResetSession(timerError)) {
        await handleSessionExpired();
        return;
      }
      if (isSyncConflictError(timerError)) {
        await reloadFromApi(projectId);
        setError(timerError.message);
        setStatus("Ready");
        return;
      }

      queueRef.current.enqueue({
        id: `local-${crypto.randomUUID()}`,
        type: "STOP_TIMER",
        payload: {
          entryId: runningEntry.id,
          taskId: runningEntry.taskId,
          startedAt: runningEntry.startedAt,
          stoppedAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
      });
      persistQueue();
      setTodayTotal((value) => value + elapsed);
      setRunningEntry(null);
      setStatus(`Ready (stop queued: ${queueRef.current.size()})`);
    } finally {
      if (stopMutationAbortControllerRef.current === abortController) {
        stopMutationAbortControllerRef.current = null;
      }
    }

    queueSync().catch(() => undefined);
  };
  stopTimerActionRef.current = stopTimer;

  const handleSaveToken = async () => {
    if (!tokenInput.trim()) return;

    try {
      authGenerationRef.current += 1;
      const authGeneration = authGenerationRef.current;
      await saveAuthToken(tokenInput.trim());
      tokenRef.current = tokenInput.trim();
      setTokenInput("");
      await reloadFromApi(projectId);
      if (authGeneration !== authGenerationRef.current) {
        return;
      }
      await queueSync();
      if (authGeneration !== authGenerationRef.current) {
        return;
      }
      setStatus(queueRef.current.size() > 0 ? `Sync pending (${queueRef.current.size()})` : "Ready");
      setError(null);
    } catch (tokenError) {
      setError(tokenError instanceof Error ? tokenError.message : "Failed to save token");
    }
  };

  const handleClearToken = async () => {
    try {
      authGenerationRef.current += 1;
      clearSyncRetry();
      reloadAbortControllerRef.current?.abort();
      syncAbortControllerRef.current?.abort();
      await clearAuthToken();
      tokenRef.current = null;
      clientRef.current = makeClient(apiBaseUrl, async () => null);
      queueRef.current.hydrate([]);
      persistQueue();
      clearEntityCache();
      entityCacheRef.current = { projects: [], tasks: [] };
      saveRunningEntrySnapshot(null);
      setProjects(fallbackProjects);
      setTasks(fallbackTasks.filter((task) => task.projectId === fallbackProjects[0]?.id));
      setProjectId(fallbackProjects[0]?.id ?? "");
      setTaskId(undefined);
      setRunningEntry(null);
      setTodayTotal(0);
      setNote("");
      setError(null);
      setStatus("Token cleared");
    } catch (tokenError) {
      setError(tokenError instanceof Error ? tokenError.message : "Failed to clear token");
    }
  };

  const handleSaveSettings = async () => {
    setSettingsBusy(true);
    setError(null);

    try {
      const preferences = saveDesktopPreferences({ apiBaseUrl });
      const authGeneration = authGenerationRef.current;
      setApiBaseUrl(preferences.apiBaseUrl);
      clientRef.current = makeClient(preferences.apiBaseUrl, async () => tokenRef.current);
      await reloadFromApi(projectId);
      if (authGeneration !== authGenerationRef.current) {
        return;
      }
      setStatus("Settings saved");
    } catch (settingsError) {
      setError(settingsError instanceof Error ? settingsError.message : "Failed to save settings");
    } finally {
      setSettingsBusy(false);
    }
  };

  const handleLaunchAtLoginChange = async (enabled: boolean) => {
    setSettingsBusy(true);
    setError(null);

    try {
      await setLaunchAtLoginEnabled(enabled);
      setLaunchAtLoginState(enabled);
      setStatus(enabled ? "Launch at login enabled" : "Launch at login disabled");
    } catch (startupError) {
      setError(startupError instanceof Error ? startupError.message : "Failed to update launch at login");
    } finally {
      setSettingsBusy(false);
    }
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
          API base URL
          <input
            type="url"
            value={apiBaseUrl}
            onChange={(event) => setApiBaseUrl(event.target.value)}
            placeholder={DEFAULT_API_BASE_URL}
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

        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={launchAtLoginEnabled}
            onChange={(event) => handleLaunchAtLoginChange(event.target.checked)}
            disabled={settingsBusy}
          />
          Launch Trackify at login
        </label>

        <button className="button-primary" onClick={handleSaveToken}>
          Save token
        </button>
        <button className="button-primary" onClick={handleSaveSettings} disabled={settingsBusy}>
          Save settings
        </button>
        <button className="button-danger" onClick={handleClearToken}>
          Clear token
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
