# Trackify

A time tracking application built with Next.js, Socket.IO, and PostgreSQL.

## ⚠️ AI Assistant Rules

**NEVER deploy without the user explicitly asking for it.** Only run `npm run deploy` when the user says "deploy" or similar.

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API Routes, Socket.IO for real-time updates
- **Database**: PostgreSQL in production; optional **SQLite file** for local dev without Docker

## Prerequisites

- **Node.js 18.17+** (or newer). If you use `nvm`, run `nvm install` then `nvm use` (see `.nvmrc`).
- **Database**: either nothing extra (SQLite file), **or** PostgreSQL via Docker (`npm run db:up`), **or** any reachable Postgres URL
- Caddy (reverse proxy, already configured on server — not needed for `dev:local`)

## Local Development

### Without Docker — SQLite file database

`.env.example` defaults to `DATABASE_URL=file:./prisma/dev.db`. Prisma generates a **SQLite-specific client** from `prisma/schema.sqlite.prisma`; do **not** run `npm run setup:dev` / `prisma migrate deploy` against SQLite (those migrations are for Postgres).

```bash
cp .env.example .env
# Set NEXTAUTH_SECRET (e.g. openssl rand -base64 32)

npm install
npm run setup:sqlite
npm run dev:local
```

The `npm run setup:sqlite` script passes `DATABASE_URL=file:./prisma/dev.db` to Prisma only; **`npm run dev:local`** sets the same URL for the Node process so it still matches SQLite even if `.env` still lists Postgres.

Open **[http://localhost:3002](http://localhost:3002)** and register an account.

For **localhost + Postgres** (generated client from `npm run setup:postgres`), use **`npm run dev:local:postgres`** instead.

To switch back to Postgres later: put a `postgresql://…` URL in `.env`, then run `npm run setup:postgres`.

### With Docker — PostgreSQL (matches production migrations)

```bash
cp .env.example .env
# Set DATABASE_URL to postgresql://trackify:trackify_dev@localhost:5435/trackify (see comments in .env.example)

npm install
npm run db:up

# Install deps, generate Postgres client, apply migrations
npm run setup:dev

npm run dev
```

Port **3002**. **`npm run dev:local`** pins SQLite (`DATABASE_URL=file:./prisma/dev.db`) and **http://localhost:3002** auth. **`npm run dev`** is for the HTTPS dev host behind your proxy and expects Postgres in `.env`. **`npm run dev:local:postgres`** is localhost auth with **`DATABASE_URL` from `.env`** (Postgres client — run **`npm run setup:postgres`** first).

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
7. **Verify** health check passes

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
DATABASE_URL="file:./prisma/dev.db"   # local SQLite — or postgresql://… for Postgres
NEXTAUTH_URL="http://localhost:3002" # use with npm run dev:local for SQLite workflow
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

**Login not working?**

- Check `NEXTAUTH_URL` matches your domain
- Verify database is running: `docker ps | grep postgres`

**Socket disconnected (red dot)?**

- Check server logs: `tail -f /tmp/trackify-prod.log`
- Verify WebSocket connection in browser DevTools

**Port already in use?**

- Kill zombie processes: `pkill -f 'tsx server'`
- Or use deploy script which handles this automatically

