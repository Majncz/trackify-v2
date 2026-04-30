import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TrackifyApiClient } from "@trackify/api-client";

const originalFetch = global.fetch;

describe("TrackifyApiClient backend alignment", () => {
  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it("synthesizes the desktop project locally without calling /api/projects", async () => {
    const client = new TrackifyApiClient({
      baseUrl: "https://trackify.test",
      getToken: async () => "secret-token",
    });

    const projects = await client.getProjects();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(projects).toEqual([{ id: "desktop-workspace", name: "Trackify" }]);
  });

  it("loads tasks from /api/tasks and maps them into a single desktop project bucket", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { id: "task-a", name: "Admin", hidden: false },
        { id: "task-b", name: "Build", hidden: false },
      ],
    } as Response);

    const client = new TrackifyApiClient({
      baseUrl: "https://trackify.test",
      getToken: async () => "secret-token",
    });

    const tasks = await client.getTasks("desktop-workspace");

    expect(global.fetch).toHaveBeenCalledWith(
      "https://trackify.test/api/tasks",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer secret-token" }),
      }),
    );
    expect(tasks).toEqual([
      { id: "task-a", name: "Admin", projectId: "desktop-workspace" },
      { id: "task-b", name: "Build", projectId: "desktop-workspace" },
    ]);
  });

  it("loads the running timer snapshot from /api/time/running", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "running",
        queuedActions: 0,
        todayTotalSeconds: 90,
        entry: {
          id: "timer-1",
          projectId: "desktop-workspace",
          taskId: "task-a",
          startedAt: "2026-04-22T20:00:00.000Z",
        },
      }),
    } as Response);

    const client = new TrackifyApiClient({
      baseUrl: "https://trackify.test",
      getToken: async () => "secret-token",
    });

    const snapshot = await client.getRunningTimer();

    expect(global.fetch).toHaveBeenCalledWith(
      expect.stringMatching(/^https:\/\/trackify\.test\/api\/time\/running\?timezone=/),
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer secret-token" }),
      }),
    );
    expect(snapshot).toEqual({
      status: "running",
      queuedActions: 0,
      todayTotalSeconds: 90,
      entry: {
        id: "timer-1",
        projectId: "desktop-workspace",
        taskId: "task-a",
        startedAt: "2026-04-22T20:00:00.000Z",
      },
    });
  });

  it("posts timer start and stop to the backend time endpoints", async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "timer-1",
          projectId: "desktop-workspace",
          taskId: "task-a",
          startedAt: "2026-04-22T20:00:00.000Z",
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "timer-1",
          projectId: "desktop-workspace",
          taskId: "task-a",
          startedAt: "2026-04-22T20:00:00.000Z",
          stoppedAt: "2026-04-22T21:00:00.000Z",
          durationSeconds: 3600,
        }),
      } as Response);

    const client = new TrackifyApiClient({
      baseUrl: "https://trackify.test",
      getToken: async () => "secret-token",
    });

    await client.startTimer({
      projectId: "desktop-workspace",
      taskId: "task-a",
      startedAt: "2026-04-22T20:00:00.000Z",
    });
    await client.stopTimer("timer-1");

    expect(global.fetch).toHaveBeenNthCalledWith(
      1,
      "https://trackify.test/api/time/start",
      expect.objectContaining({ method: "POST" }),
    );
    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      "https://trackify.test/api/time/timer-1/stop",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("preserves structured sync failures so desktop can stop retrying permanent conflicts", async () => {
    vi.mocked(global.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        synced: 0,
        failed: [
          {
            id: "queued-1",
            permanent: true,
            message: "Active timer mismatch",
          },
        ],
      }),
    } as Response);

    const client = new TrackifyApiClient({
      baseUrl: "https://trackify.test",
      getToken: async () => "secret-token",
    });

    const result = await client.syncQueue([
      {
        id: "queued-1",
        type: "STOP_TIMER",
        payload: { entryId: "local-entry-1" },
        createdAt: "2026-04-22T20:30:00.000Z",
        attempts: 0,
      },
    ]);

    expect(result).toEqual({
      synced: 0,
      failed: [
        {
          id: "queued-1",
          permanent: true,
          message: "Active timer mismatch",
        },
      ],
    });
  });
});
