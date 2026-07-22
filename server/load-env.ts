import fs from "node:fs";
import path from "node:path";

/** Minimal parser when `dotenv` is not installed yet (broken npm install). */
function parseDotEnv(filePath: string): void {
  const raw = fs.readFileSync(filePath, "utf8");
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

let loaded = false;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require.resolve("dotenv/package.json");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require("dotenv/config");
  loaded = true;
} catch {
  /* dotenv missing */
}

if (!loaded) {
  const envPath = path.join(process.cwd(), ".env");
  if (fs.existsSync(envPath)) parseDotEnv(envPath);
}
