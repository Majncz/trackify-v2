import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";

export async function readLaunchAtLoginEnabled(): Promise<boolean> {
  return isEnabled();
}

export async function setLaunchAtLoginEnabled(enabled: boolean): Promise<void> {
  if (enabled) {
    await enable();
    return;
  }

  await disable();
}
