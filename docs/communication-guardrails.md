# Communication Guardrails (Trackify Build)

Purpose: prevent silent long gaps while implementation is in progress.

## Hard rules
1. Maximum silence while building: **30 minutes**.
2. Post an update after every completed chunk with:
   - commit hash
   - what was built
   - what was verified (tests/build)
3. If blocked, post within 15 minutes with exact blocker.
4. No status-only updates; every update must contain proof (commit/tests/artifact path).

## Enforcement workflow
1. Finish a chunk.
2. Commit it.
3. Run:
   ```bash
   npm run progress:chunk -- "<chunk summary>"
   ```
4. Use the printed template to send the update.

## Audit trail
- Automatic local log file: `docs/progress-log.md`
- Every chunk checkpoint appends timestamp + commit + changed files.
