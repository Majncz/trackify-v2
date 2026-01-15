# Dev Incident Log

Persistent log for tricky dev-environment outages. Update this file whenever you fix an issue so future you can spot repeating patterns quickly.

## How to use

- Append new entries at the top (newest first).
- Include the exact commands you ran and any config/files touched.
- If you open an issue/PR, cross-link it for context.

### Entry Template

```
## YYYY-MM-DD – short title
**Symptom**: What you saw (errors, status codes, etc.).
**Root cause**: Once known; otherwise “TBD”.
**Commands run**: Bullet list in order.
**Resolution**: Summarize fix + follow-up.
**Notes**: Optional learnings / next steps.
```

---

## 2026-01-14 – Server unresponsive (200% CPU, SSH timeout, forced restart)
**Symptom**: SSH connection dropped, server CPU at 200% in hosting panel, unable to reconnect for 10+ minutes. Required hard restart from hosting provider dashboard.

**Root cause**: 
1. Deploy script was running `npm run build` (CPU-intensive Next.js + TypeScript compilation)
2. Shell commands from Cursor agent kept timing out and retrying, possibly spawning multiple processes
3. Build was interrupted mid-way, leaving no `dist/server/index.js` file
4. After restart, PM2 tried to start `trackify-prod` but the entry file was missing
5. PM2 entered crash loop (12 restarts in rapid succession), further stressing the system

**Commands run**:
- `pm2 status` – saw `trackify-prod` in "waiting" state with 12 restarts
- `pm2 logs trackify-prod --lines 50 --nostream` – found `MODULE_NOT_FOUND: Cannot find module '/root/trackify-prod/dist/server/index.js'`
- `pm2 stop trackify-prod` – stop crash loop
- `rm -rf /root/trackify-prod/.next /root/trackify-prod/dist` – clean partial build
- `npm run build` (in trackify-prod) – rebuild from scratch
- `pm2 restart trackify-prod` – start production

**Resolution**: Stopped crash loop, rebuilt production from clean state, server now running normally.

**Prevention options**:
1. **PM2 max restarts**: Add `max_restarts: 5` and `min_uptime: "10s"` to ecosystem.config.cjs to prevent infinite crash loops
2. **Build on separate machine**: Run `npm run build` locally or in CI/CD, then deploy pre-built artifacts
3. **Graceful deploy script**: Modify `deploy.sh` to:
   - Build in a temp directory first
   - Only swap to new build after success
   - Keep old build as fallback
4. **Resource limits**: Use `nice -n 10` for build commands to lower CPU priority
5. **Health monitoring**: Add external uptime monitor (e.g., UptimeRobot) to alert when server becomes unresponsive

**Notes**: The 2-core VPS struggled with parallel Next.js + TypeScript compilation. Consider upgrading to 4-core for builds, or implementing option 2/3 above.

---

## 2026-01-14 – Next.js vendor-chunks cache corruption (500 on /api/auth/session)
**Symptom**: All API routes returning 500, browser console showing `ClientFetchError: Unexpected token '<'` (HTML error page instead of JSON). Auth session endpoint completely broken.

**Root cause**: Corrupted `.next` build cache. Server logs showed:
```
Error: Cannot find module './vendor-chunks/jose.js'
```
The `jose` library (used by NextAuth for JWT) had its webpack chunk go missing from `.next/server/vendor-chunks/`. This can happen during aggressive hot module replacement.

**Commands run**:
- `pm2 logs trackify-dev --lines 50 --nostream` – found the `MODULE_NOT_FOUND` error.
- `rm -rf .next && pm2 restart trackify-dev` – cleared cache and restarted.

**Resolution**: Deleting `.next` and restarting fixed it immediately. First request takes longer as Next.js recompiles.

**Prevention**:
- This is a known Next.js dev server issue with no guaranteed fix.
- If you see random 500s with "MODULE_NOT_FOUND" in logs, clear `.next` first.
- Could add a health check that auto-clears cache on repeated 500s, but that's overkill for dev.

**Notes**: First occurrence of this specific issue. Not related to pm2 or server crashes — the server was running fine, just had corrupted build artifacts.

---

## 2026-01-11 – Dev server not running (3rd occurrence) + PM2 setup
**Symptom**: `https://dev.time.ranajakub.com/` not loading.

**Root cause**: Dev server process was not running. No process listening on port 3002. The previous `nohup` session had terminated at some point.

**Commands run**:
- `ps aux | grep trackify` – no processes found.
- Created `/root/trackify/ecosystem.config.cjs` with pm2 config for both dev and prod.
- `pm2 start ecosystem.config.cjs` – started both servers.
- `pm2 save` – saved process list for auto-restart on reboot.
- Updated `scripts/deploy.sh` to use pm2 instead of nohup.

**Resolution**: 
- Both dev and prod servers now managed by **pm2** with auto-restart.
- Logs at `/var/log/trackify-dev-*.log` and `/var/log/trackify-prod-*.log`.
- Servers will auto-restart on crash and on system reboot.

**Useful commands**:
- `pm2 status` – check server status
- `pm2 logs trackify-dev` – view dev logs
- `pm2 restart trackify-dev` – restart dev server

---

## 2026-01-10 – Dev subdomain 502 / white page
**Symptom**: `https://dev.time.ranajakub.com/` showed a blank screen and Caddy returned 502s.

**Root cause**:  
1. Caddy was proxying `localhost:3002`, which resolved to IPv6 (`::1`) while the dev server only listened on IPv4.  
2. The dev server process had exited, so nothing was running on port 3002.

**Commands run**:
- `curl -k -I https://dev.time.ranajakub.com/` – verify 502.
- `journalctl -u caddy -n 20 --no-pager` – saw IPv6 `connect: connection refused`.
- Edited `/etc/caddy/Caddyfile` to proxy `127.0.0.1:3002` (and other hosts for consistency).
- `systemctl reload caddy`.
- `npm run dev` inside `/root/trackify` to restart the dev server.
- `curl https://dev.time.ranajakub.com/login` – confirmed 200 OK.

**Resolution**: Forced Caddy to use IPv4 loopback and restarted the dev server. Site now responds with 200 and serves the login page.

**Notes**: Consider running the dev server via a supervisor (pm2/systemd) so it auto-restarts, and add a health check that pings the dev domain to alert when it goes down.

## 2026-01-11 – Dev domain returns 502 / socket.io resets
**Symptom**: `https://dev.time.ranajakub.com/` inaccessible again; browser showed blank page, `curl -I` hung until 502, Caddy logs full of `read tcp 127.0.0.1:NNN->127.0.0.1:3002: connection reset by peer`.

**Root cause**: Dev server (`npm run dev`) was still running but got wedged (Socket.IO long-poll requests were being reset). There was no persistent log because previous run was in an ephemeral shell.

**Commands run**:
- `lsof -i :3002` – confirmed node + caddy connections.
- `journalctl -u caddy -n 10` – saw repeated `connection reset by peer` errors.
- `pkill -f "server/index.ts"` – stop stuck dev server.
- `nohup npm run dev > /var/log/trackify-dev.log 2>&1 &` – restart dev server with persistent log.
- `curl -k -I https://dev.time.ranajakub.com/login` – verified HTTP 200.

**Resolution**: Restarted dev server under `nohup` so it keeps running after the terminal closes, log stored at `/var/log/trackify-dev.log` for future debugging.

**Notes**: Next step is to wrap dev server in systemd/pm2 and add health check alerts so it auto-restarts when it wedges.

