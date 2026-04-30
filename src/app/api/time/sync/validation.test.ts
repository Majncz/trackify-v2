import { describe, expect, it } from "vitest";
import { parseStartedAtForSync, resolveStoppedAtForSync } from "./validation";

describe("time sync validation", () => {
  it("rejects malformed queued start timestamps as permanent input errors", () => {
    expect(
      parseStartedAtForSync({
        payloadStartedAt: "not-a-date",
        actionCreatedAt: "2026-04-22T20:00:00.000Z",
      }),
    ).toEqual({
      ok: false,
      message: "Invalid startedAt",
      permanent: true,
    });
  });

  it("rejects empty queued start timestamps instead of silently falling back", () => {
    expect(
      parseStartedAtForSync({
        payloadStartedAt: "",
        actionCreatedAt: "2026-04-22T20:00:00.000Z",
      }),
    ).toEqual({
      ok: false,
      message: "Invalid startedAt",
      permanent: true,
    });
  });

  it("rejects non-string queued start timestamps instead of treating them as missing", () => {
    expect(
      parseStartedAtForSync({
        payloadStartedAt: 123 as unknown as string,
        actionCreatedAt: "2026-04-22T20:00:00.000Z",
      }),
    ).toEqual({
      ok: false,
      message: "Invalid startedAt",
      permanent: true,
    });
  });

  it("rejects non-ISO queued start timestamps even if JavaScript Date would parse them", () => {
    expect(
      parseStartedAtForSync({
        payloadStartedAt: "2026-04-22 20:00:00Z",
        actionCreatedAt: "2026-04-22T20:00:00.000Z",
      }),
    ).toEqual({
      ok: false,
      message: "Invalid startedAt",
      permanent: true,
    });

    expect(
      parseStartedAtForSync({
        payloadStartedAt: "2026/04/22 20:00:00Z",
        actionCreatedAt: "2026-04-22T20:00:00.000Z",
      }),
    ).toEqual({
      ok: false,
      message: "Invalid startedAt",
      permanent: true,
    });

    expect(
      parseStartedAtForSync({
        payloadStartedAt: "2026-04-22",
        actionCreatedAt: "2026-04-22T20:00:00.000Z",
      }),
    ).toEqual({
      ok: false,
      message: "Invalid startedAt",
      permanent: true,
    });
  });

  it("rejects queued stop timestamps that precede the active timer start", () => {
    expect(
      resolveStoppedAtForSync({
        payloadStoppedAt: "2026-04-22T19:59:59.000Z",
        activeTimerStartedAt: new Date("2026-04-22T20:00:00.000Z"),
      }),
    ).toEqual({
      ok: false,
      message: "Invalid stoppedAt",
      permanent: true,
    });
  });

  it("rejects empty queued stop timestamps instead of silently substituting now", () => {
    expect(
      resolveStoppedAtForSync({
        payloadStoppedAt: "",
        activeTimerStartedAt: new Date("2026-04-22T20:00:00.000Z"),
        now: new Date("2026-04-22T20:30:00.000Z"),
      }),
    ).toEqual({
      ok: false,
      message: "Invalid stoppedAt",
      permanent: true,
    });
  });

  it("rejects non-string queued stop timestamps instead of silently substituting now", () => {
    expect(
      resolveStoppedAtForSync({
        payloadStoppedAt: 123 as unknown as string,
        activeTimerStartedAt: new Date("2026-04-22T20:00:00.000Z"),
        now: new Date("2026-04-22T20:30:00.000Z"),
      }),
    ).toEqual({
      ok: false,
      message: "Invalid stoppedAt",
      permanent: true,
    });
  });

  it("rejects non-ISO queued stop timestamps even if JavaScript Date would parse them", () => {
    expect(
      resolveStoppedAtForSync({
        payloadStoppedAt: "2026-04-22 20:30:00Z",
        activeTimerStartedAt: new Date("2026-04-22T20:00:00.000Z"),
      }),
    ).toEqual({
      ok: false,
      message: "Invalid stoppedAt",
      permanent: true,
    });

    expect(
      resolveStoppedAtForSync({
        payloadStoppedAt: "2026/04/22 20:30:00Z",
        activeTimerStartedAt: new Date("2026-04-22T20:00:00.000Z"),
      }),
    ).toEqual({
      ok: false,
      message: "Invalid stoppedAt",
      permanent: true,
    });
  });

  it("accepts a valid queued stop timestamp at or after the active timer start", () => {
    const result = resolveStoppedAtForSync({
      payloadStoppedAt: "2026-04-22T20:30:00.000Z",
      activeTimerStartedAt: new Date("2026-04-22T20:00:00.000Z"),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.toISOString()).toBe("2026-04-22T20:30:00.000Z");
    }
  });
});
