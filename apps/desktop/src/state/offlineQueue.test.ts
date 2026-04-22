import { describe, expect, it, vi } from "vitest";
import { OfflineQueue, computeBackoffMs, parseQueueSnapshot } from "./offlineQueue";

describe("OfflineQueue", () => {
  it("enqueues and removes actions", () => {
    const queue = new OfflineQueue();

    queue.enqueue({
      id: "1",
      type: "START_TIMER",
      payload: { projectId: "p1" },
      createdAt: new Date().toISOString(),
    });

    expect(queue.size()).toBe(1);

    queue.removeById("1");
    expect(queue.size()).toBe(0);
  });

  it("tracks attempts", () => {
    const queue = new OfflineQueue();
    queue.enqueue({
      id: "2",
      type: "STOP_TIMER",
      payload: { entryId: "e1" },
      createdAt: new Date().toISOString(),
    });

    queue.markAttempt("2");
    expect(queue.list()[0]?.attempts).toBe(1);
  });

  it("hydrates from snapshot", () => {
    const queue = new OfflineQueue();
    queue.hydrate([
      {
        id: "x1",
        type: "STOP_TIMER",
        payload: { entryId: "e2" },
        createdAt: new Date().toISOString(),
        attempts: 2,
      },
    ]);

    expect(queue.size()).toBe(1);
    expect(queue.serialize()).toContain("x1");
  });

  it("parses safe snapshot", () => {
    const parsed = parseQueueSnapshot(
      JSON.stringify([
        {
          id: "x2",
          type: "START_TIMER",
          payload: {},
          createdAt: new Date().toISOString(),
          attempts: 0,
        },
      ]),
    );

    expect(parsed).toHaveLength(1);
    expect(parseQueueSnapshot("not-json")).toHaveLength(0);
  });

  it("computes exponential backoff", () => {
    vi.spyOn(Math, "random").mockReturnValue(0.2);
    expect(computeBackoffMs(0)).toBeGreaterThanOrEqual(1500);
    expect(computeBackoffMs(3)).toBeGreaterThan(computeBackoffMs(0));
    vi.restoreAllMocks();
  });
});
