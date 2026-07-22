#!/usr/bin/env node
/**
 * When DATABASE_URL points at Postgres on this machine, ensure the Docker
 * Postgres from docker-compose.yml is running and migrations are applied.
 * SQLite and remote Postgres URLs are left unchanged.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const prismaCli = path.join(root, "node_modules/prisma/build/index.js");
const schema = path.join(root, "prisma", "schema.prisma");

function loadDotEnvDatabaseUrl() {
  const p = path.join(root, ".env");
  if (!existsSync(p)) return "";
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const m = t.match(/^DATABASE_URL\s*=\s*(.*)$/);
    if (!m) continue;
    let v = m[1].trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    return v;
  }
  return "";
}

function isLocalPostgresHost(hostname) {
  const h = hostname.toLowerCase();
  return (
    h === "localhost" ||
    h === "127.0.0.1" ||
    h === "::1" ||
    h === "[::1]"
  );
}

/** Prefer IPv4 for localhost so we do not hit ::1 when the port is IPv4-only. */
function tcpCheckHost(hostname) {
  return hostname.toLowerCase() === "localhost" ? "127.0.0.1" : hostname;
}

function waitForPort(host, port, timeoutMs = 45000) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    function tryConnect() {
      if (Date.now() > deadline) {
        reject(new Error(`Timeout waiting for ${host}:${port}`));
        return;
      }
      const socket = net.createConnection({ host, port: Number(port) }, () => {
        socket.end();
        resolve();
      });
      socket.on("error", () => {
        socket.destroy();
        setTimeout(tryConnect, 400);
      });
    }
    tryConnect();
  });
}

const dbUrl = (process.env.DATABASE_URL ?? loadDotEnvDatabaseUrl()).trim();

if (!dbUrl || dbUrl.startsWith("file:")) {
  process.exit(0);
}

if (!dbUrl.startsWith("postgres://") && !dbUrl.startsWith("postgresql://")) {
  process.exit(0);
}

let parsed;
try {
  parsed = new URL(dbUrl);
} catch {
  process.exit(0);
}

if (!isLocalPostgresHost(parsed.hostname)) {
  process.exit(0);
}

const port = parsed.port || "5432";
const checkHost = tcpCheckHost(parsed.hostname);

let dockerStarted = false;
try {
  await waitForPort(checkHost, port, 3000);
} catch {
  console.log("Postgres not reachable yet — trying `docker compose up -d`…");
  try {
    execSync("docker compose up -d", { stdio: "inherit", cwd: root });
    dockerStarted = true;
  } catch {
    console.warn(
      "Docker Compose did not run (install Docker or start Postgres yourself). Waiting briefly for Postgres…"
    );
  }
  const timeoutMs = dockerStarted ? 60000 : 12000;
  try {
    await waitForPort(checkHost, port, timeoutMs);
  } catch {
    console.error(
      `Postgres never became reachable at ${checkHost}:${port}. ` +
        `Run npm run db:up, or set DATABASE_URL to SQLite (file:./dev.db → prisma/dev.db) and use npm run dev:sqlite.`
    );
    process.exit(1);
  }
}

console.log("Applying Prisma migrations…");
execSync(
  `node ${JSON.stringify(prismaCli)} migrate deploy --schema ${JSON.stringify(schema)}`,
  { stdio: "inherit", cwd: root }
);
