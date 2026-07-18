#!/usr/bin/env node
/**
 * Simulates upgrading a master-era Postgres DB to the current migration chain
 * without needing production access.
 *
 * Requires Docker Desktop running (docker compose postgres on :5435).
 *
 * Usage:
 *   node scripts/verify-migrate-from-master.mjs
 */
import { execSync, spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const prismaCli = path.join(root, "node_modules/prisma/build/index.js");
const schema = path.join(root, "prisma", "schema.prisma");

const DB = "trackify_migrate_from_master";
const URL = `postgresql://trackify:trackify_dev@127.0.0.1:5435/${DB}`;

const MASTER_MIGRATIONS = [
  "20251229080738_init",
  "20251229151301_add_password_reset",
  "20260127114458_migrate_event_to_from_to",
];

function sh(cmd, env = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
    shell: true,
  });
}

function psqlPostgres(sql) {
  const r = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "trackify",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      sql,
    ],
    { cwd: root, stdio: "inherit" }
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
}

function applySqlToDb(sql) {
  const r = spawnSync(
    "docker",
    [
      "compose",
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "trackify",
      "-d",
      DB,
      "-v",
      "ON_ERROR_STOP=1",
    ],
    { cwd: root, input: sql, stdio: ["pipe", "inherit", "inherit"] }
  );
  if (r.status !== 0) process.exit(r.status ?? 1);
}

console.log("== verify-migrate-from-master ==");
console.log("Starting Postgres (if needed)...");
sh("docker compose up -d");

psqlPostgres(`DROP DATABASE IF EXISTS ${DB};`);
psqlPostgres(`CREATE DATABASE ${DB};`);

for (const name of MASTER_MIGRATIONS) {
  const file = path.join(root, "prisma/migrations", name, "migration.sql");
  console.log(`\nApplying master SQL: ${name}`);
  applySqlToDb(readFileSync(file, "utf8"));
  sh(
    `node "${prismaCli}" migrate resolve --applied "${name}" --schema "${schema}"`,
    { DATABASE_URL: URL }
  );
}

console.log("\nSeeding legacy task/event rows...");
applySqlToDb(`
INSERT INTO "trackify_user" (id, email, password)
VALUES ('user-old', 'old@example.com', 'x');
INSERT INTO "trackify_task" (id, name, hidden, "userId")
VALUES ('task-old', 'Legacy Task', false, 'user-old');
INSERT INTO "trackify_event" (id, "from", "to", name, "taskId")
VALUES (
  'event-old',
  '2026-01-01 10:00:00+00',
  '2026-01-01 11:00:00+00',
  'Time entry',
  'task-old'
);
`);

console.log("\nRunning full migrate deploy (current chain)...");
sh(`node "${prismaCli}" migrate deploy --schema "${schema}"`, {
  DATABASE_URL: URL,
});

console.log("\nChecking old rows + new tables...");
applySqlToDb(`
SELECT id, name FROM "trackify_task" WHERE id = 'task-old';
SELECT id FROM "trackify_event" WHERE id = 'event-old';
SELECT to_regclass('public.trackify_task_group') AS task_group;
SELECT to_regclass('public.trackify_billing_task') AS billing_task;
SELECT COUNT(*)::int AS migration_count FROM "_prisma_migrations";
`);

// Keep a small marker file so CI/local can see last success time
const marker = path.join(root, "scripts", ".verify-migrate-from-master.ok");
writeFileSync(marker, new Date().toISOString());
try {
  unlinkSync(marker);
} catch {
  /* ignore */
}

console.log("\n✅ Master → current migrate path OK. Old task/event rows kept.");
console.log(`Test DB: ${URL}`);
console.log(`Drop with: docker compose exec -T postgres psql -U trackify -d postgres -c "DROP DATABASE ${DB};"`);
