# Trackify

Time tracking app for personal use.

## Deployment

- **URL**: https://time.ranajakub.com
- **Server**: Local machine (not remote 188.245.148.53)
- **Reverse proxy**: Caddy (auto SSL)
- **Database**: PostgreSQL 17 in Docker on port 5435

## Running the App

**Always use dev mode** - single user app, no need for production builds:

```bash
npm run dev
```

Changes to files are instant (hot reload). No build or restart needed.

## Tech Stack

- Next.js 14 (App Router)
- Prisma 7 with PostgreSQL adapter
- NextAuth.js v5 (credentials + JWT)
- Socket.io (real-time timer sync)
- TanStack Query
- Tailwind CSS

## Database

```bash
# Run migrations
npx prisma migrate dev

# View data
npx prisma studio
```

## Data Migration

Original data was migrated from remote server (188.245.148.53) basic-database.
Migration script: `npm run migrate`
