# Trackify cutover rollback (2026-07-22)

## Current production (post-cutover)
- App SHA: `01b5bd7` (`taryk` merged to `master` + unused-import build fix)
- Runtime: **PM2** app `trackify-prod` from `/root/trackify-prod` (CI deploy path)
- Docker container `trackify-prod` is **stopped** (`--restart=no`) to avoid port 3000 / Prisma OpenSSL conflicts
- DB container `trackify-database` remains up (:5435)
- Migrations: **16** (was 3 on master-era)
- Data counts verified: users=11, tasks=95, events=4067

## Backups (download from home dir)
- Pre-migrate (restore target for full rollback): `/home/taryk/trackify-backups/pre_taryk_merge_20260722T185632Z/`
- Post-migrate snapshot: `/home/taryk/trackify-backups/cutover_post_migrate_20260722T190216Z/`
- Root copies: `/root/trackify-backups/`
- This file: `/home/taryk/trackify-backups/ROLLBACK.md`

## Rollback A — app only (keep migrated DB)
```bash
sudo pm2 stop trackify-prod
cd /root/trackify-prod
sudo git fetch origin
sudo git reset --hard 82378a6912bb0411516a908491431f19b67b199c
sudo npm ci
sudo node ./node_modules/prisma/build/index.js generate --schema prisma/schema.prisma
sudo rm -rf .next dist && sudo npm run build
sudo pm2 startOrReload ecosystem.config.cjs --only trackify-prod --update-env
sudo pm2 save
curl -sS http://127.0.0.1:3000/api/chat/model
```
Note: old app may error on new schema; use Rollback B if so.

## Rollback B — restore pre-migrate DB + old app
```bash
sudo pm2 stop trackify-prod
# DBPASS from /root/trackify/.env DATABASE_URL
sudo docker exec -e PGPASSWORD="$DBPASS" trackify-database \
  psql -U trackify -d postgres -c "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='trackify' AND pid <> pg_backend_pid();"
sudo docker exec -e PGPASSWORD="$DBPASS" trackify-database \
  psql -U trackify -d postgres -c "DROP DATABASE trackify; CREATE DATABASE trackify OWNER trackify;"
sudo docker cp /home/taryk/trackify-backups/pre_taryk_merge_20260722T185632Z/trackify_prod.dump trackify-database:/tmp/restore.dump
sudo docker exec -e PGPASSWORD="$DBPASS" trackify-database \
  pg_restore -U trackify -d trackify --no-owner --role=trackify /tmp/restore.dump
# then Rollback A to SHA 82378a6
```

## Validation
- `curl -sS http://127.0.0.1:3000/api/chat/model`
- `curl -sS -o /dev/null -w '%{http_code}\n' https://trackify.ranajakub.com/login`
- `sudo bash /root/trackify-prod/scripts/verify-production.sh runtime`
- Row counts on `trackify_user`, `trackify_task`, `trackify_event`
