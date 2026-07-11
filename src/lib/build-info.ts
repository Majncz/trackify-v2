import { readFileSync } from "fs";
import { join } from "path";
import { CHAT_MODEL_ID } from "@/lib/ai-model";

export interface BuildInfo {
  gitSha: string;
  gitShaShort: string;
  model: string;
  builtAt: string;
}

export function getBuildInfo(): BuildInfo | null {
  try {
    const raw = readFileSync(join(process.cwd(), "build-info.json"), "utf8");
    return JSON.parse(raw) as BuildInfo;
  } catch {
    return null;
  }
}

export function getRuntimeChatModelInfo() {
  const buildInfo = getBuildInfo();

  return {
    model: CHAT_MODEL_ID,
    gitSha: buildInfo?.gitSha ?? null,
    gitShaShort: buildInfo?.gitShaShort ?? null,
    builtAt: buildInfo?.builtAt ?? null,
  };
}
