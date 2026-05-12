#!/usr/bin/env node
/**
 * Local Trackify: SQLite file DB at prisma/dev.db, seeded test user on first run.
 * Prisma resolves SQLite URLs relative to the schema folder (prisma/). Use file:./dev.db.
 *
 * This repo has two Prisma schemas (Postgres + SQLite). The generated client must
 * match DATABASE_URL. `.env` often sets Postgres, which caused endless “fix local dev”
 * loops. This script always generates the SQLite client, forces file:… for the server,
 * and bootstraps when dev.db is missing — one path, no guessing.
 *
 * Docker Postgres: use `npm run dev:local:postgres` instead.
 */
import { execSync, spawn } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const genScript = path.join(root, "scripts", "prisma-generate-for-env.mjs");
const tsxCli = path.join(root, "node_modules", "tsx", "dist", "cli.mjs");
const serverEntry = path.join(root, "server", "index.ts");
const dbFile = path.join(root, "prisma", "dev.db");

execSync(`node ${JSON.stringify(genScript)} --sqlite`, { stdio: "inherit", cwd: root });

function needsBootstrap() {
  if (!existsSync(dbFile)) return true;
  try {
    return statSync(dbFile).size < 512;
  } catch {
    return true;
  }
}

if (needsBootstrap()) {
  console.log(
    "SQLite dev.db missing or empty — running bootstrap:sqlite (schema + test user a@a.com / a)…"
  );
  execSync("npm run bootstrap:sqlite", { stdio: "inherit", cwd: root, env: process.env });
} else {
  const probe = path.join(root, "scripts", "sqlite-has-users.mjs");
  try {
    execSync(`node ${JSON.stringify(probe)}`, {
      cwd: root,
      stdio: "pipe",
      env: { ...process.env, DATABASE_URL: "file:./dev.db" },
    });
  } catch (err) {
    const code = err instanceof Error && "status" in err ? err.status : null;
    if (code === 1) {
      console.log(
        "SQLite dev.db has no users — running seed:test-user:sqlite (a@a.com / a)…"
      );
      execSync("npm run seed:test-user:sqlite", {
        stdio: "inherit",
        cwd: root,
        env: process.env,
      });
    } else {
      throw err;
    }
  }
}

const env = {
  ...process.env,
  DATABASE_URL: "file:./dev.db",
  NEXTAUTH_URL: "http://localhost:3002",
  PORT: process.env.PORT ?? "3002",
};

const child = spawn(process.execPath, [tsxCli, serverEntry], {
  cwd: root,
  stdio: "inherit",
  env,
});

const forward = () => child.kill("SIGINT");
process.on("SIGINT", forward);
process.on("SIGTERM", forward);

child.on("exit", (code, signal) => {
  process.off("SIGINT", forward);
  process.off("SIGTERM", forward);
  if (signal === "SIGINT") process.exit(130);
  process.exit(code ?? 0);
});
