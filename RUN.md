# Run doc — ITI Trade Management

Lightweight full-stack app: Express + `node:sqlite` (Node 24) + vanilla-JS SPA. No build step.

## 1. Reproduce uncommitted artifacts (fresh checkout)

1. Install dependencies with the project's package manager:
   ```sh
   npm ci          # package-lock.json is committed; installs express + jsdom (dev)
   ```
2. Database: **no artifact to copy.** The seeded SQLite file `data/iti-trade.db` is committed.
   If it is missing, recreate the demo data:
   ```sh
   npm run seed     # scripts/seed-demo.js — creates schema, default settings, demo accounts
   ```
3. **No `.env` / `.env.local` files exist or are needed.** All configuration lives in the
   database and is edited at runtime via the Trade Admin → Settings page (campus geofence
   lat/lng + radius, attendance time window, leave limits, 80% threshold, working days).
   Login credentials are in README.md (`admin / Admin@123`, `rverma / Officer@123`,
   `trainee1 / Trainee@123`).
4. Note: `data/iti-trade.db-shm` and `data/iti-trade.db-wal` are SQLite runtime files,
   recreated automatically; they show as modified while the server runs and can be ignored.

## 2. Run the server

Default port is **3000** (`PORT` env var overrides it):

```sh
PORT=3000 npm start        # = node server.js
```

Server binds `0.0.0.0` (required for the preview hostname), logs to stdout.

**Detached start (POSIX — this workspace runs in a Linux sandbox; the PowerShell
`Start-Process` detach recipe from the host preview config does not apply here):**

```sh
cd <workspace-root>
(PORT=3000 nohup node server.js > /tmp/iti.log 2>&1 & echo $! > /tmp/iti.pid)
sleep 1.2 && cat /tmp/iti.log     # expect: "ITI Trade Management running on http://0.0.0.0:3000"
```

**Health check** (use the current preview hostname; it changes per session restore):

```sh
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" \
  -H "Host: <preview-hostname>.style.dev" http://127.0.0.1:3000/   # expect 200 text/html
```

**Tests** (server must already be running on 3000):

```sh
npm test          # scripts/smoke-test.js (all 19 pages render) + scripts/ui-test.js (login,
                  # attendance, leave, settings, GPS with mocked geolocation)
```

Stop the server: `kill $(cat /tmp/iti.pid)` (or the PID printed above).
