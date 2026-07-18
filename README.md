# Trackify

A time tracking application built with Next.js, Socket.IO, and PostgreSQL.

## ⚠️ AI Assistant Rules

**NEVER deploy without the user explicitly asking for it.** Only run `npm run deploy` when the user says "deploy" or similar.

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API Routes, Socket.IO for real-time updates
- **Database**: **PostgreSQL** in production and staging (the real DB). **SQLite** (`prisma/dev.db`) for normal local development — no Docker required.

## Prerequisites

- **Node.js 18.17+** (or newer). If you use `nvm`, run `nvm install` then `nvm use` (see `.nvmrc`).
- **Database**: daily dev uses **SQLite**; install Docker Postgres **only** if you want parity with production migrations locally (optional).
- Caddy (reverse proxy, already configured on server — not needed for `dev:local`)

## Local Development

**Default workflow:** SQLite (`npm run dev:local` or `npm run dev:sqlite`). **PostgreSQL** stays for **production**, hosted staging, and optional local parity — not for day-to-day app development unless you opt in.

### SQLite file DB (`prisma/dev.db`) — normal dev

**`npm run dev:local`** and **`npm run dev:sqlite`** both run **`scripts/local-dev.mjs`**: SQLite only, **`NEXTAUTH_URL=http://localhost:3002`**, port **3002**, ignoring Postgres in **`.env`**.

Detailed setup (**`DATABASE_URL`** paths, seeding **`a@a.com`**, troubleshooting): **[docs/local-sqlite-dev.md](./docs/local-sqlite-dev.md)**.

Prisma uses **`prisma/schema.sqlite.prisma`** for SQLite; do **not** run **`prisma migrate deploy`** against this file DB — use **`npm run setup:sqlite`** (**`db push`**). If push fails, **`npm run setup:sqlite:force`** (may wipe local SQLite data).

```bash
cp .env.example .env
# SQLite: use DATABASE_URL=file:./dev.db (see docs/local-sqlite-dev.md)
# Set NEXTAUTH_SECRET (e.g. openssl rand -base64 32)

npm install
npm run setup:sqlite
npm run dev:sqlite
```

Optional demo data: **`npm run bootstrap:sqlite`** (**`a@a.com`** / **`a`** in **`prisma/dev.db`** only).

### Optional — PostgreSQL on your machine

Use this when you need **migration parity** or want to hit the **same DB stack as production** locally. Not required for UI/feature work.

`npm run dev:local:postgres` checks Postgres, runs **`prisma generate`** for **`schema.prisma`**, and starts the server using **`DATABASE_URL`** from **`.env`** (must be **`postgresql://…`**).

```bash
# .env → postgresql://… (e.g. after npm run db:up)
npm run setup:postgres   # or setup:dev — generate + migrations
npm run dev:local:postgres
```

Open **[http://localhost:3002](http://localhost:3002)**.

### HTTPS dev host / production-like (`npm run dev`)

Uses Postgres from **`.env`** (e.g. Docker). Typical when mirroring the deployed stack behind your proxy — **not** the same as everyday SQLite dev.

```bash
cp .env.example .env
# Set DATABASE_URL to postgresql://trackify:trackify_dev@localhost:5435/trackify (see comments in .env.example)

npm install
npm run db:up

# Install deps, generate Postgres client, apply migrations
npm run setup:dev

npm run dev
```

Port **3002**. **`npm run dev`** expects **`DATABASE_URL=postgresql://…`** (production-like).

### ⚠️ IMPORTANT: Hot Reload vs Restart

**DO NOT restart the dev server for code changes** - hot reload handles it automatically.

**DO restart the dev server after:**

- Prisma schema changes (`prisma/schema.prisma`)
- `package.json` changes
- Environment variable changes (`.env`)
- Server crashed

**After PostgreSQL schema changes** (`prisma/schema.prisma`):

```bash
npx prisma migrate dev   # or migrate deploy against a staging DB
npx prisma generate
pkill -f 'tsx server' && npm run dev
```

**After SQLite-only edits** (`prisma/schema.sqlite.prisma`): regenerate with `npm run setup:sqlite`, then restart the dev server.

**Never run `prisma migrate deploy` when `DATABASE_URL` is a `file:` SQLite URL** — use `npm run setup:sqlite` (`db push`) instead.

**Check if dev is already running:**

```bash
lsof -i :3002  # Shows process if running
```

## Production Deployment

**One command deploys everything:**

```bash
# Deploy with auto-generated commit message
npm run deploy

# Deploy with custom commit message
npm run deploy "feat: add new feature"
```

The deploy script handles the full workflow:

1. **Commit** all changes in dev directory
2. **Push** to GitHub
3. **Pull** latest code to prod directory (`/root/trackify-prod`)
4. **Install** dependencies & generate Prisma client
5. **Build** the application
6. **Start** production server on port 3000
7. **Verify** PM2 cwd, runtime model endpoint, and health check pass

## Server Configuration

| Environment | Directory             | Port | URL                                                              | Command          |
| ----------- | --------------------- | ---- | ---------------------------------------------------------------- | ---------------- |
| Development | `/root/trackify`      | 3002 | [https://dev.time.ranajakub.com](https://dev.time.ranajakub.com) | `npm run dev`    |
| Production  | `/root/trackify-prod` | 3000 | [https://time.ranajakub.com](https://time.ranajakub.com)         | `npm run deploy` |
| Database    | -                     | 5435 | localhost (Docker)                                               | -                |

**Note:** Dev and prod use separate directories to avoid build conflicts. The deploy script automatically pulls latest code and builds in the prod directory.

Caddy reverse proxy config is at `/etc/caddy/Caddyfile`.

## Useful Commands

```bash
# View production logs
tail -f /tmp/trackify-prod.log

# Check if server is running
lsof -i :3002

# Database studio
npx prisma studio

# Manually stop server
pkill -f 'node dist/index.js'
```

## Environment Variables

Copy `.env.example` to `.env` and configure:

```env
DATABASE_URL="file:./dev.db"              # local dev (SQLite → prisma/dev.db)
# DATABASE_URL="postgresql://…"           # production / staging / optional Docker dev only
NEXTAUTH_URL="http://localhost:3002"    # npm run dev:local / dev:sqlite
NEXTAUTH_SECRET="generate-a-secret"
ANTHROPIC_API_KEY=""     # optional — AI chat
SMTP_* / SMTP_FROM=""    # optional — password reset emails
```

## Project Structure

```
├── src/
│   ├── app/              # Next.js App Router pages
│   ├── components/       # React components
│   ├── contexts/         # React contexts (Socket)
│   ├── hooks/            # Custom hooks
│   └── lib/              # Utilities (auth, prisma, etc.)
├── server/
│   └── index.ts          # Custom server with Socket.IO
├── prisma/
│   └── schema.prisma     # Database schema
└── scripts/
    └── deploy.sh         # Deployment script
```

## Troubleshooting

**AI chat still using an old model?**
- Confirm deploy succeeded and `pm2 describe trackify-prod` shows `exec cwd` as `/root/trackify-prod`
- Check runtime model: `curl -s http://127.0.0.1:3000/api/chat/model`
- Verify compiled output: `grep claude-sonnet-5 /root/trackify-prod/.next/server/app/api/chat/route.js`

**Login not working?**

- Check `NEXTAUTH_URL` matches your domain
- Verify database is running: `docker ps | grep postgres`

**Socket disconnected (red dot)?**

- Check server logs: `tail -f /tmp/trackify-prod.log`
- Verify WebSocket connection in browser DevTools

**Port already in use?**

- Kill zombie processes: `pkill -f 'tsx server'`
- Or use deploy script which handles this automatically

