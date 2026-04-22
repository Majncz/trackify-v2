import { describe, expect, it } from "vitest";
import { reduceTimer } from "./timerMachine";

describe("timerMachine", () => {
  it("starts and stops timer", () => {
    const started = reduceTimer({}, {
      type: "START",
      payload: {
        projectId: "p1",
        startedAt: new Date().toISOString(),
      },
    });

    expect(started.activeEntryId).toBeTruthy();

    const stopped = reduceTimer(started, {
      type: "STOP",
      payload: { entryId: started.activeEntryId! },
    });

    expect(stopped.activeEntryId).toBeUndefined();
  });

  it("updates note while running", () => {
    const started = reduceTimer({}, {
      type: "START",
      payload: {
        projectId: "p1",
        startedAt: new Date().toISOString(),
      },
    });

    const updated = reduceTimer(started, {
      type: "UPDATE_NOTE",
      payload: { note: "deep work" },
    });

    expect(updated.note).toBe("deep work");
  });
});
