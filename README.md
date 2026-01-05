# Trackify

A time tracking application built with Next.js, Socket.IO, and PostgreSQL.

## Tech Stack

- **Frontend**: Next.js 14 (App Router), React, Tailwind CSS, shadcn/ui
- **Backend**: Next.js API Routes, Socket.IO for real-time updates
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: NextAuth.js v5

## Prerequisites

- Node.js 20+
- PostgreSQL (via Docker)
- Caddy (reverse proxy, already configured on server)

## Local Development

```bash
# Start the database
docker-compose up -d

# Install dependencies
npm install

# Generate Prisma client
npx prisma generate

# Push schema to database
npx prisma db push

# Start dev server with hot reload
npm run dev
```

Dev server runs on port 3002 → https://dev.time.ranajakub.com

## Production Deployment

**One command:**

```bash
npm run deploy
```

This will:
1. Stop any running production server
2. Clean old builds
3. Build the application
4. Start the production server on port 3000
5. Verify it's responding

## Server Configuration

| Environment | Directory | Port | URL | Command |
|-------------|-----------|------|-----|---------|
| Development | `/root/trackify` | 3002 | https://dev.time.ranajakub.com | `npm run dev` |
| Production | `/root/trackify-prod` | 3000 | https://time.ranajakub.com | `npm run deploy` |
| Database | - | 5435 | localhost (Docker) | - |

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
DATABASE_URL="postgresql://user:pass@localhost:5435/trackify"
NEXTAUTH_URL="https://dev.time.ranajakub.com"
NEXTAUTH_SECRET="generate-a-secret"
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
