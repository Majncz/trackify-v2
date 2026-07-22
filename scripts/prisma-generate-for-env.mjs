#!/usr/bin/env node
/**
 * Generate @prisma/client from the schema that matches DATABASE_URL.
 * - file:…  → prisma/schema.sqlite.prisma (local file DB, no Postgres)
 * - else    → prisma/schema.prisma (Postgres)
 *
 * Flags: --sqlite / --postgres override inference from .env.
 */
import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const prismaCli = path.join(root, "node_modules/prisma/build/index.js");

const argv = new Set(process.argv.slice(2));
const forceSqlite = argv.has("--sqlite");
const forcePostgres = argv.has("--postgres");

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

const dbUrl = (process.env.DATABASE_URL ?? loadDotEnvDatabaseUrl()).trim();

let useSqlite;
if (forceSqlite && forcePostgres) {
  console.error("Use only one of --sqlite or --postgres");
  process.exit(1);
}
if (forceSqlite) useSqlite = true;
else if (forcePostgres) useSqlite = false;
else useSqlite = dbUrl.startsWith("file:");

const schema = useSqlite
  ? path.join(root, "prisma", "schema.sqlite.prisma")
  : path.join(root, "prisma", "schema.prisma");

execSync(`node ${JSON.stringify(prismaCli)} generate --schema ${JSON.stringify(schema)}`, {
  stdio: "inherit",
  cwd: root,
});
