import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";

export type TrayAction = "start" | "stop" | "show";

export interface TrayStateInput {
  detail?: string;
  running: boolean;
  status: string;
}

export async function listenForTrayActions(
  handler: (action: TrayAction) => void,
): Promise<() => void> {
  return listen<string>("trackify://tray-action", (event) => {
    const action = event.payload as TrayAction;
    if (action === "start" || action === "stop" || action === "show") {
      handler(action);
    }
  });
}

export async function updateTrayState(input: TrayStateInput): Promise<void> {
  await invoke("update_tray_state", {
    detail: input.detail ?? null,
    running: input.running,
    status: input.status,
  });
}
