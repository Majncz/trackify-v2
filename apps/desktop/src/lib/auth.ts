import { invoke } from "@tauri-apps/api/core";

export async function loadAuthToken(): Promise<string | null> {
  return invoke<string | null>("load_auth_token");
}

export async function saveAuthToken(token: string): Promise<void> {
  await invoke("save_auth_token", { token });
}

export async function clearAuthToken(): Promise<void> {
  await invoke("clear_auth_token");
}
