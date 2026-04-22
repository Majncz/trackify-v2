import { beforeEach, describe, expect, it, vi } from "vitest";

const autostart = vi.hoisted(() => ({
  disable: vi.fn(async () => undefined),
  enable: vi.fn(async () => undefined),
  isEnabled: vi.fn(async () => false),
}));

vi.mock("@tauri-apps/plugin-autostart", () => autostart);

import { setLaunchAtLoginEnabled, readLaunchAtLoginEnabled } from "./startup";

describe("launch at login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    autostart.isEnabled.mockResolvedValue(false);
  });

  it("reads current autostart state", async () => {
    autostart.isEnabled.mockResolvedValue(true);

    await expect(readLaunchAtLoginEnabled()).resolves.toBe(true);
    expect(autostart.isEnabled).toHaveBeenCalledTimes(1);
  });

  it("enables autostart when requested", async () => {
    await setLaunchAtLoginEnabled(true);

    expect(autostart.enable).toHaveBeenCalledTimes(1);
    expect(autostart.disable).not.toHaveBeenCalled();
  });

  it("disables autostart when requested", async () => {
    await setLaunchAtLoginEnabled(false);

    expect(autostart.disable).toHaveBeenCalledTimes(1);
    expect(autostart.enable).not.toHaveBeenCalled();
  });
});
