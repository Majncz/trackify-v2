# Local development with SQLite (`prisma/dev.db`)

**PostgreSQL is the production database** (“the real deal”). **Day-to-day development is SQLite only** — file **`prisma/dev.db`**, no Docker — so `.env` can stay simple and you avoid mixing two DB stacks accidentally.

PostgreSQL migrations live under `prisma/migrations` for **`schema.prisma`**. SQLite uses **`prisma/schema.sqlite.prisma`** (`db push`, not `migrate deploy`). Keep both schemas aligned when you add models or columns.

Optional: **`npm run dev:local:postgres`** or Docker **`npm run stack:local`** only when you explicitly want local parity with Postgres.

---

## Prerequisites

- **Node.js** ≥ 18.17 (see `.nvmrc`)
- Dependencies installed: `npm install`
- **`.env`** copied from `.env.example` with at least **`NEXTAUTH_SECRET`** set (e.g. `openssl rand -base64 32`)

---

## Important: `DATABASE_URL` for SQLite

Prisma resolves **relative** SQLite URLs against the **`prisma/` directory** (where `schema.sqlite.prisma` lives), not necessarily your shell’s current working directory.

| Value | Resolves to |
| --- | --- |
| **`file:./dev.db`** | **`prisma/dev.db`** (correct) |
| ~~`file:./prisma/dev.db`~~ | **`prisma/prisma/dev.db`** (wrong — nested path) |

**Use `file:./dev.db` in `.env`** when you point at the local SQLite mock DB. The physical file is still **`prisma/dev.db`** on disk.

The **`npm run setup:sqlite`** / **`seed:test-user:sqlite`** scripts already pass the correct URL. **`scripts/local-dev.mjs`** forces SQLite with **`file:./dev.db`** for `npm run dev:local` / **`npm run dev:sqlite`**, so Postgres in `.env` does not affect that command.

---

## One-time (or clean) database setup

### Apply schema (`db push`)

Sync **`schema.sqlite.prisma`** into **`prisma/dev.db`** and regenerate the Prisma client for SQLite:

```bash
npm run setup:sqlite
```

If Prisma refuses to push (drift, experimental schema edits), you can reset the **local** file DB:

```bash
npm run setup:sqlite:force
```

**`--accept-data-loss`** can wipe SQLite data — only use this when you are fine losing local mock data.

Do **not** run **`prisma migrate deploy`** against SQLite in this project. Use **`db push`** via the scripts above.

### Seed demo user and sample data

```bash
npm run seed:test-user:sqlite
```

This ensures the SQLite client is generated, then runs **`scripts/seed-test-user.ts`** against **`prisma/dev.db`**.

**Login after seed**

- Email: **`a@a.com`**
- Password: **`a`**

The seed creates groups, tasks, time entries, and billing demo data (see the script header for details). It does **not** seed AI subscription rows.

### One-shot bootstrap (force schema + seed)

```bash
npm run bootstrap:sqlite
```

Equivalent to **`setup:sqlite:force`** then **`seed:test-user:sqlite`**. Useful for a fresh mock DB.

---

## Run the dev server (SQLite)

From the repo root:

```bash
npm run dev:sqlite
```

**`npm run dev:local`** runs the **same** entrypoint (`scripts/local-dev.mjs`): SQLite at **`prisma/dev.db`**, **`NEXTAUTH_URL=http://localhost:3002`**, port **3002**.

On **first run**, if **`prisma/dev.db`** is missing or very small, **`local-dev.mjs`** runs **`bootstrap:sqlite`** automatically so you get schema + **`a@a.com`**.

If **`dev.db`** already exists (for example after **`npm run setup:sqlite`** only) but there are **no users** yet, **`local-dev.mjs`** runs **`npm run seed:test-user:sqlite`** once so the mock login is always present.

Open **http://localhost:3002**.

For **Postgres** local dev instead, use **`npm run dev:local:postgres`** (and **`npm run setup:postgres`** / Docker as in the root **README**).

---

## After editing `schema.sqlite.prisma`

1. **`npm run setup:sqlite`** (or **`setup:sqlite:force`** if needed)
2. **Restart** the dev server (Prisma client / env expectations change)

---

## Troubleshooting

### `EADDRINUSE` / port **3002** already in use

Another Node process is still bound to **3002**. Find and stop it:

```bash
lsof -nP -iTCP:3002 -sTCP:LISTEN
kill <PID>
```

Or **`npm run dev:stop`** (kills listeners on **3002**).

### Logged in but tasks / billing are empty

You may still have a **JWT from an older database** (e.g. Postgres) whose **`user.id` does not exist** in the current SQLite file after **`bootstrap:sqlite`** or **`seed:test-user:sqlite`**.

The app now **reconciles** your session to the current DB row by **email** when the id is stale. If anything still looks wrong, **sign out** and sign back in as **`a@a.com`** once.

### Empty **`prisma/dev.db`** or API errors after “successful” setup

Check you do **not** have data only under **`prisma/prisma/dev.db`** (wrong URL). Remove that nested path if it appears, set **`DATABASE_URL=file:./dev.db`** for SQLite, then **`npm run bootstrap:sqlite`**.

### Wrong Prisma client (Postgres vs SQLite)

Always run **`node scripts/prisma-generate-for-env.mjs --sqlite`** before SQLite tooling, or use the **`npm run`** scripts above — they invoke it for you.

---

## Quick reference

| Goal | Command |
| --- | --- |
| Schema → **`prisma/dev.db`** | `npm run setup:sqlite` |
| Force reset local SQLite schema | `npm run setup:sqlite:force` |
| Seed **`a@a.com`** + demo data | `npm run seed:test-user:sqlite` |
| Fresh DB + seed | `npm run bootstrap:sqlite` |
| Dev server (SQLite) | `npm run dev:sqlite` or `npm run dev:local` |

For **PostgreSQL** (production, staging, optional local parity), see the root **`README.md`** — dev stays on SQLite unless you opt into **`dev:local:postgres`** / **`stack:local`**.
