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

  it("clears token state and empties the offline queue", async () => {
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
      expect(mocked.clearAuthToken).toHaveBeenCalledTimes(1);
    });

    expect(localStorage.getItem("trackify.desktop.offlineQueue") ?? "[]").toBe("[]");
    expect(screen.getAllByText(/session expired/i).length).toBeGreaterThan(0);
  });
});
