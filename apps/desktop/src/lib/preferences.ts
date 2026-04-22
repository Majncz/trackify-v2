const API_BASE_URL_STORAGE_KEY = "trackify.desktop.apiBaseUrl";
export const DEFAULT_API_BASE_URL = "http://localhost:3000";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

const memoryStorage = new Map<string, string>();

function getStorage(): StorageLike {
  if (typeof localStorage !== "undefined") {
    return localStorage;
  }

  return {
    getItem(key) {
      return memoryStorage.get(key) ?? null;
    },
    setItem(key, value) {
      memoryStorage.set(key, value);
    },
  };
}

export interface DesktopPreferences {
  apiBaseUrl: string;
}

export function normalizeApiBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return DEFAULT_API_BASE_URL;
  }

  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;

  let parsed: URL;
  try {
    parsed = new URL(withProtocol);
  } catch {
    throw new Error("Please enter a valid URL");
  }

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Please enter an HTTP or HTTPS URL");
  }

  parsed.hash = "";
  parsed.search = "";

  return parsed.toString().replace(/\/$/, "");
}

export function loadDesktopPreferences(): DesktopPreferences {
  const storage = getStorage();
  const storedBaseUrl = storage.getItem(API_BASE_URL_STORAGE_KEY);

  return {
    apiBaseUrl: storedBaseUrl ? normalizeApiBaseUrl(storedBaseUrl) : DEFAULT_API_BASE_URL,
  };
}

export function saveDesktopPreferences(preferences: DesktopPreferences): DesktopPreferences {
  const normalized: DesktopPreferences = {
    apiBaseUrl: normalizeApiBaseUrl(preferences.apiBaseUrl),
  };

  getStorage().setItem(API_BASE_URL_STORAGE_KEY, normalized.apiBaseUrl);
  return normalized;
}
