// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  ApiError: class ApiError extends Error {
    status: number;

    constructor(status: number, message: string) {
      super(message);
      this.name = "ApiError";
      this.status = status;
    }
  },
  apiClient: {
    getProjects: vi.fn(),
    getRunningTimer: vi.fn(),
    getTasks: vi.fn(),
    startTimer: vi.fn(),
    stopTimer: vi.fn(),
    syncQueue: vi.fn(),
  },
  clearAuthToken: vi.fn(),
  invoke: vi.fn(),
  listen: vi.fn(),
  loadAuthToken: vi.fn(),
  loadDesktopPreferences: vi.fn(),
  readLaunchAtLoginEnabled: vi.fn(),
  saveAuthToken: vi.fn(),
  saveDesktopPreferences: vi.fn(),
  setLaunchAtLoginEnabled: vi.fn(),
}));

let trayActionHandler: ((event: { payload: string }) => void) | null = null;

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

vi.mock("@tauri-apps/api/event", () => ({
  listen: mocked.listen,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocked.invoke,
}));

vi.mock("./lib/auth", () => ({
  loadAuthToken: mocked.loadAuthToken,
  saveAuthToken: mocked.saveAuthToken,
  clearAuthToken: mocked.clearAuthToken,
}));

vi.mock("./lib/startup", () => ({
  readLaunchAtLoginEnabled: mocked.readLaunchAtLoginEnabled,
  setLaunchAtLoginEnabled: mocked.setLaunchAtLoginEnabled,
}));

vi.mock("./lib/preferences", async () => {
  const actual = await vi.importActual<typeof import("./lib/preferences")>("./lib/preferences");
  return {
    ...actual,
    loadDesktopPreferences: mocked.loadDesktopPreferences,
    saveDesktopPreferences: mocked.saveDesktopPreferences,
  };
});

vi.mock("@trackify/api-client", () => ({
  ApiError: mocked.ApiError,
  TrackifyApiClient: vi.fn().mockImplementation(() => mocked.apiClient),
}));

import { App } from "./App";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

describe("App tray integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    trayActionHandler = null;

    mocked.listen.mockImplementation(async (_event: string, handler: (event: { payload: string }) => void) => {
      trayActionHandler = handler;
      return () => undefined;
    });

    mocked.loadAuthToken.mockResolvedValue(null);
    mocked.saveAuthToken.mockResolvedValue(undefined);
    mocked.clearAuthToken.mockResolvedValue(undefined);
    mocked.readLaunchAtLoginEnabled.mockResolvedValue(false);
    mocked.setLaunchAtLoginEnabled.mockResolvedValue(undefined);
    mocked.loadDesktopPreferences.mockReturnValue({ apiBaseUrl: "http://localhost:3000" });
    mocked.saveDesktopPreferences.mockImplementation((prefs: { apiBaseUrl: string }) => prefs);

    mocked.apiClient.getProjects.mockResolvedValue([{ id: "project-1", name: "Trackify Platform" }]);
    mocked.apiClient.getRunningTimer.mockResolvedValue({
      status: "idle",
      queuedActions: 0,
      todayTotalSeconds: 0,
    });
    mocked.apiClient.getTasks.mockResolvedValue([{ id: "task-1", projectId: "project-1", name: "Desktop app" }]);
    mocked.apiClient.startTimer.mockResolvedValue({
      id: "entry-1",
      projectId: "project-1",
      taskId: "task-1",
      startedAt: "2026-04-22T20:00:00.000Z",
    });
    mocked.apiClient.stopTimer.mockResolvedValue({
      id: "entry-1",
      projectId: "project-1",
      taskId: "task-1",
      startedAt: "2026-04-22T20:00:00.000Z",
      stoppedAt: "2026-04-22T21:00:00.000Z",
      durationSeconds: 3600,
    });
    mocked.apiClient.syncQueue.mockResolvedValue({ synced: 0, failed: [] });
  });

  it("auto-selects the first task so timer start remains available", async () => {
    render(<App />);

    await waitFor(() => {
      expect((screen.getByRole("combobox", { name: "Task" }) as HTMLSelectElement).value).toBe("task-1");
    });
  });

  it("starts the timer when the tray start action is emitted", async () => {
    render(<App />);

    await waitFor(() => {
      expect(mocked.apiClient.getProjects).toHaveBeenCalled();
    });

    expect(trayActionHandler).toBeTruthy();

    await act(async () => {
      trayActionHandler?.({ payload: "start" });
    });

    await waitFor(() => {
      expect(mocked.apiClient.startTimer).toHaveBeenCalledTimes(1);
    });

    expect(screen.getByRole("button", { name: "Stop timer" })).toBeTruthy();
  });

  it("saves desktop settings with the edited API base URL", async () => {
    const user = userEvent.setup();
    render(<App />);

    const apiInput = await screen.findByDisplayValue("http://localhost:3000");
    await user.clear(apiInput);
    await user.type(apiInput, "trackify.example.com");
    await user.click(screen.getByRole("button", { name: "Save settings" }));

    await waitFor(() => {
      expect(mocked.saveDesktopPreferences).toHaveBeenCalledWith({
        apiBaseUrl: "trackify.example.com",
      });
    });
  });

  it("preserves cached task lists across multiple projects", async () => {
    const user = userEvent.setup();
    mocked.apiClient.getProjects.mockResolvedValue([
      { id: "project-1", name: "Trackify Platform" },
      { id: "project-2", name: "Client Work" },
    ]);
    mocked.apiClient.getTasks.mockImplementation((projectId: string) => {
      if (projectId === "project-1") {
        return Promise.resolve([{ id: "task-1", projectId: "project-1", name: "Desktop app" }]);
      }
      if (projectId === "project-2") {
        return Promise.resolve([{ id: "task-2", projectId: "project-2", name: "Client review" }]);
      }
      return Promise.resolve([]);
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Desktop app" })).toBeTruthy();
    });

    await user.selectOptions(screen.getByRole("combobox", { name: "Project" }), "project-2");

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Client review" })).toBeTruthy();
    });

    expect(JSON.parse(localStorage.getItem("trackify.desktop.entityCache") ?? "{}").tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "task-1", projectId: "project-1" }),
        expect.objectContaining({ id: "task-2", projectId: "project-2" }),
      ]),
    );
  });

  it("clears token state, cached entities, and empties the offline queue", async () => {
    const user = userEvent.setup();
    localStorage.setItem(
      "trackify.desktop.offlineQueue",
      JSON.stringify([
        {
          id: "queued-1",
          type: "START_TIMER",
          payload: { projectId: "project-1" },
          createdAt: "2026-04-22T20:00:00.000Z",
          attempts: 0,
        },
      ]),
    );
    localStorage.setItem(
      "trackify.desktop.entityCache",
      JSON.stringify({
        projects: [{ id: "project-1", name: "Trackify Platform" }],
        tasks: [{ id: "task-1", projectId: "project-1", name: "Desktop app" }],
      }),
    );

    mocked.loadAuthToken.mockResolvedValue("secret-token");
    mocked.apiClient.getRunningTimer.mockResolvedValue({
      status: "running",
      queuedActions: 1,
      todayTotalSeconds: 120,
      entry: {
        id: "entry-1",
        projectId: "project-1",
        taskId: "task-1",
        note: "deep work",
        startedAt: "2026-04-22T20:00:00.000Z",
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop timer" })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Clear token" }));

    await waitFor(() => {
      expect(mocked.clearAuthToken).toHaveBeenCalledTimes(1);
    });

    expect(localStorage.getItem("trackify.desktop.offlineQueue")).toBe("[]");
    expect(localStorage.getItem("trackify.desktop.entityCache")).toBeNull();
    expect(screen.getByRole("button", { name: "Start timer" })).toBeTruthy();
    expect(screen.getByText("Token cleared")).toBeTruthy();
  });

  it("ignores stale task responses after the project selection changes", async () => {
    const user = userEvent.setup();
    const firstProjectTasks = createDeferred<Array<{ id: string; projectId: string; name: string }>>();
    const secondProjectTasks = createDeferred<Array<{ id: string; projectId: string; name: string }>>();

    mocked.apiClient.getProjects.mockResolvedValue([
      { id: "project-1", name: "Trackify Platform" },
      { id: "project-2", name: "Client Work" },
    ]);
    mocked.apiClient.getTasks.mockImplementation((projectId: string) => {
      if (projectId === "project-1") return firstProjectTasks.promise;
      if (projectId === "project-2") return secondProjectTasks.promise;
      return Promise.resolve([]);
    });

    render(<App />);

    const projectSelect = await screen.findByRole("combobox", { name: "Project" });
    await user.selectOptions(projectSelect, "project-2");

    await act(async () => {
      secondProjectTasks.resolve([{ id: "task-2", projectId: "project-2", name: "Client review" }]);
    });

    await waitFor(() => {
      expect(screen.getByRole("option", { name: "Client review" })).toBeTruthy();
    });

    await act(async () => {
      firstProjectTasks.resolve([{ id: "task-1", projectId: "project-1", name: "Old task" }]);
    });

    await waitFor(() => {
      expect(screen.queryByRole("option", { name: "Old task" })).toBeNull();
    });
  });

  it("restores cached entities and running timer snapshot when booting offline", async () => {
    mocked.loadAuthToken.mockResolvedValue("secret-token");
    mocked.apiClient.getProjects.mockRejectedValue(new Error("offline"));
    localStorage.setItem(
      "trackify.desktop.entityCache",
      JSON.stringify({
        projects: [{ id: "project-cached", name: "Recovered Project" }],
        tasks: [{ id: "task-cached", projectId: "project-cached", name: "Recovered task" }],
      }),
    );
    localStorage.setItem(
      "trackify.desktop.runningEntry",
      JSON.stringify({
        id: "entry-cached",
        projectId: "project-cached",
        taskId: "task-cached",
        note: "Recovered note",
        startedAt: "2026-04-22T20:00:00.000Z",
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop timer" })).toBeTruthy();
    });

    expect((screen.getByRole("combobox", { name: "Project" }) as HTMLSelectElement).value).toBe("project-cached");
    expect(screen.getByRole("option", { name: "Recovered task" })).toBeTruthy();
    expect(screen.getByDisplayValue("Recovered note")).toBeTruthy();
  });

  it("keeps offline state intact when the app boots without a token", async () => {
    mocked.loadAuthToken.mockResolvedValue(null);
    localStorage.setItem(
      "trackify.desktop.offlineQueue",
      JSON.stringify([
        {
          id: "queued-1",
          type: "START_TIMER",
          payload: { projectId: "project-cached" },
          createdAt: "2026-04-22T20:00:00.000Z",
          attempts: 0,
        },
      ]),
    );
    localStorage.setItem(
      "trackify.desktop.entityCache",
      JSON.stringify({
        projects: [{ id: "project-cached", name: "Recovered Project" }],
        tasks: [{ id: "task-cached", projectId: "project-cached", name: "Recovered task" }],
      }),
    );
    localStorage.setItem(
      "trackify.desktop.runningEntry",
      JSON.stringify({
        id: "entry-cached",
        projectId: "project-cached",
        taskId: "task-cached",
        note: "Recovered note",
        startedAt: "2026-04-22T20:00:00.000Z",
      }),
    );

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop timer" })).toBeTruthy();
    });

    expect(mocked.apiClient.getProjects).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("trackify.desktop.offlineQueue") ?? "[]")).toHaveLength(1);
    expect(screen.getByText(/sync pending/i)).toBeTruthy();
  });

  it("persists the running timer snapshot when start is queued offline", async () => {
    const user = userEvent.setup();
    mocked.apiClient.startTimer.mockRejectedValue(new Error("offline"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start timer" })).toBeTruthy();
    });

    await user.type(screen.getByLabelText("Note"), "Offline focus");
    await user.click(screen.getByRole("button", { name: "Start timer" }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop timer" })).toBeTruthy();
    });

    expect(mocked.apiClient.syncQueue).toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("trackify.desktop.runningEntry") ?? "null")).toMatchObject({
      projectId: "project-1",
      note: "Offline focus",
    });
  });

  it("stores task identity on queued offline stops so sync can reconcile local timer ids later", async () => {
    const user = userEvent.setup();
    mocked.loadAuthToken.mockResolvedValue("secret-token");
    mocked.apiClient.getRunningTimer.mockResolvedValue({
      status: "running",
      queuedActions: 0,
      todayTotalSeconds: 120,
      entry: {
        id: "local-entry-1",
        projectId: "project-1",
        taskId: "task-1",
        note: "deep work",
        startedAt: "2026-04-22T20:00:00.000Z",
      },
    });
    mocked.apiClient.stopTimer.mockRejectedValue(new Error("offline"));
    mocked.apiClient.syncQueue.mockRejectedValue(new Error("offline"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop timer" })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Stop timer" }));

    await waitFor(() => {
      const queue = JSON.parse(localStorage.getItem("trackify.desktop.offlineQueue") ?? "[]");
      expect(queue).toHaveLength(1);
      expect(queue[0]?.payload).toMatchObject({
        entryId: "local-entry-1",
        taskId: "task-1",
        startedAt: "2026-04-22T20:00:00.000Z",
      });
    });
  });

  it("keeps the offline queue when saving a token does not restore API access", async () => {
    const user = userEvent.setup();
    mocked.apiClient.getProjects.mockRejectedValue(new Error("offline"));
    localStorage.setItem(
      "trackify.desktop.offlineQueue",
      JSON.stringify([
        {
          id: "queued-1",
          type: "START_TIMER",
          payload: { projectId: "project-1" },
          createdAt: "2026-04-22T20:00:00.000Z",
          attempts: 0,
        },
      ]),
    );

    render(<App />);

    const tokenInput = await screen.findByPlaceholderText("Paste access token");
    await user.type(tokenInput, "new-token");
    await user.click(screen.getByRole("button", { name: "Save token" }));

    await waitFor(() => {
      expect(mocked.saveAuthToken).toHaveBeenCalledWith("new-token");
    });

    expect(JSON.parse(localStorage.getItem("trackify.desktop.offlineQueue") ?? "[]")).toHaveLength(1);
  });

  it("does not queue offline work when start timer returns a backend conflict", async () => {
    const user = userEvent.setup();
    mocked.loadAuthToken.mockResolvedValue("secret-token");
    mocked.apiClient.startTimer.mockRejectedValue(new mocked.ApiError(409, "API 409: timer already running"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start timer" })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Start timer" }));

    await waitFor(() => {
      expect(screen.getByText(/timer already running/i)).toBeTruthy();
    });

    expect(localStorage.getItem("trackify.desktop.offlineQueue") ?? "[]").toBe("[]");
    expect(screen.getByRole("button", { name: "Start timer" })).toBeTruthy();
  });

  it("forces re-auth instead of queueing when start timer returns 401", async () => {
    const user = userEvent.setup();
    mocked.loadAuthToken.mockResolvedValue("expired-token");
    mocked.apiClient.startTimer.mockRejectedValue(new mocked.ApiError(401, "API 401: expired"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Start timer" })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Start timer" }));

    await waitFor(() => {
      expect(mocked.clearAuthToken).toHaveBeenCalledTimes(1);
    });

    expect(localStorage.getItem("trackify.desktop.offlineQueue") ?? "[]").toBe("[]");
    expect(screen.getAllByText(/session expired/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Start timer" })).toBeTruthy();
  });

  it("forces re-auth on bootstrap when project loading returns 401", async () => {
    mocked.loadAuthToken.mockResolvedValue("expired-token");
    mocked.apiClient.getProjects.mockRejectedValue(new mocked.ApiError(401, "API 401: expired"));

    render(<App />);

    await waitFor(() => {
      expect(mocked.clearAuthToken).toHaveBeenCalledTimes(1);
    });

    expect(screen.getAllByText(/session expired/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("Ready")).toBeNull();
  });

  it("forces re-auth when task refresh returns 403", async () => {
    mocked.loadAuthToken.mockResolvedValue("expired-token");
    mocked.apiClient.getTasks.mockRejectedValue(new mocked.ApiError(403, "API 403: forbidden"));

    render(<App />);

    await waitFor(() => {
      expect(mocked.clearAuthToken).toHaveBeenCalledTimes(1);
    });

    expect(screen.getAllByText(/session expired/i).length).toBeGreaterThan(0);
  });

  it("forces re-auth instead of queueing when stop timer returns 403", async () => {
    const user = userEvent.setup();
    mocked.loadAuthToken.mockResolvedValue("expired-token");
    mocked.apiClient.getRunningTimer.mockResolvedValue({
      status: "running",
      queuedActions: 0,
      todayTotalSeconds: 120,
      entry: {
        id: "entry-1",
        projectId: "project-1",
        taskId: "task-1",
        note: "deep work",
        startedAt: "2026-04-22T20:00:00.000Z",
      },
    });
    mocked.apiClient.stopTimer.mockRejectedValue(new mocked.ApiError(403, "API 403: forbidden"));

    render(<App />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Stop timer" })).toBeTruthy();
    });

    await user.click(screen.getByRole("button", { name: "Stop timer" }));

    await waitFor(() => {
      expect(mocked.clearAuthToken).toHaveBeenCalledTimes(1);
    });

    expect(localStorage.getItem("trackify.desktop.offlineQueue") ?? "[]").toBe("[]");
    expect(screen.getAllByText(/session expired/i).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Start timer" })).toBeTruthy();
  });

  it("forces re-auth when queued sync returns 401", async () => {
    mocked.loadAuthToken.mockResolvedValue("expired-token");
    mocked.apiClient.syncQueue.mockRejectedValue(new mocked.ApiError(401, "API 401: expired"));
    localStorage.setItem(
      "trackify.desktop.offlineQueue",
      JSON.stringify([
        {
          id: "queued-1",
          type: "START_TIMER",
          payload: { projectId: "project-1" },
          createdAt: "2026-04-22T20:00:00.000Z",
          attempts: 0,
        },
      ]),
    );

    render(<App />);

    await waitFor(() => {
      expect(mocked.apiClient.syncQueue).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(mocked.clearAuthToken).toHaveBeenCalledTimes(1);
    });

    expect(localStorage.getItem("trackify.desktop.offlineQueue") ?? "[]").toBe("[]");
    expect(screen.getAllByText(/session expired/i).length).toBeGreaterThan(0);
  });

  it("drops permanently conflicted queued sync actions instead of retrying them forever", async () => {
    mocked.loadAuthToken.mockResolvedValue("secret-token");
    mocked.apiClient.syncQueue.mockResolvedValue({
      synced: 0,
      failed: [
        {
          id: "queued-1",
          permanent: true,
          message: "Active timer mismatch",
        },
      ],
    });
    localStorage.setItem(
      "trackify.desktop.offlineQueue",
      JSON.stringify([
        {
          id: "queued-1",
          type: "STOP_TIMER",
          payload: { entryId: "local-entry-1", stoppedAt: "2026-04-22T20:30:00.000Z" },
          createdAt: "2026-04-22T20:30:00.000Z",
          attempts: 0,
        },
      ]),
    );

    render(<App />);

    await waitFor(() => {
      expect(mocked.apiClient.syncQueue).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(localStorage.getItem("trackify.desktop.offlineQueue") ?? "[]").toBe("[]");
    });

    expect(screen.getByText(/active timer mismatch/i)).toBeTruthy();
    expect(screen.queryByText(/sync pending/i)).toBeNull();
  });
});
