import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_API_BASE_URL,
  loadDesktopPreferences,
  normalizeApiBaseUrl,
  saveDesktopPreferences,
} from "./preferences";

function installStorageMock() {
  const store = new Map<string, string>();

  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      clear() {
        store.clear();
      },
      getItem(key: string) {
        return store.get(key) ?? null;
      },
      removeItem(key: string) {
        store.delete(key);
      },
      setItem(key: string, value: string) {
        store.set(key, value);
      },
    },
  });
}

describe("desktop preferences", () => {
  beforeEach(() => {
    installStorageMock();
    localStorage.clear();
  });

  it("normalizes and validates API base URLs", () => {
    expect(normalizeApiBaseUrl(" localhost:3000 ")).toBe("http://localhost:3000");
    expect(normalizeApiBaseUrl("https://api.trackify.test/")).toBe("https://api.trackify.test");
    expect(() => normalizeApiBaseUrl("not a url")).toThrow(/valid URL/i);
  });

  it("returns defaults when nothing is stored", () => {
    expect(loadDesktopPreferences()).toEqual({
      apiBaseUrl: DEFAULT_API_BASE_URL,
    });
  });

  it("persists normalized preferences", () => {
    saveDesktopPreferences({ apiBaseUrl: "https://trackify.example.com/" });

    expect(loadDesktopPreferences()).toEqual({
      apiBaseUrl: "https://trackify.example.com",
    });
  });
});
