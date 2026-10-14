# ITI Trade Management — Status

Project: full-stack "ITI Trade Management" for Government ITI Raigarh, Chhattisgarh.
Stack: Node 24 + Express 4 + `node:sqlite` (built-in, no native deps), vanilla-JS SPA, light theme.
Branch: `freebuff/aabe638ca8dd669110ace4ea` — **complete and committed** (see README.md for usage).

## How to run
See **RUN.md** (artifact reproduction, detached start, health check, tests) and **README.md**
(architecture, logins, endpoints).

## Status: complete

All originally planned work is done, E2E-tested, and committed:

- [x] Database (15 tables): sessions, trades, users, officer_trades, settings, attendance,
      leave_requests, warnings, inventory_items + txn, indents, question_papers, audit_logs.
      Seeded settings (campus geofence, 07:00–10:00 window, leave limits, 80% threshold),
      4 trades, 2 academic sessions, admin/officer/trainee demo logins.
- [x] Auth/RBAC: scrypt hashing, HttpOnly cookie sessions, role guards, per-officer trade
      scoping, trainee self-only access.
- [x] Trade Admin APIs + UI: sessions, working days, trades, officer accounts, global
      settings (incl. campus lat/lng/radius), audit log viewer.
- [x] Training Officer APIs + UI: trainee CRUD, attendance marking, leave approve/reject,
      warnings <80%, inventory + indents, question papers, reports.
- [x] Trainee APIs + UI: GPS window attendance with server-side geofence verification,
      leave applications, attendance calendar dashboard (replaced bar charts), history.
- [x] Reports: dependency-free PDF + CSV/Excel exports.
- [x] Auto-absent sweep with audited officer corrections.
- [x] Fixes: add-trainee INSERT arity, modal outside-click data loss, login password eye,
      header badge with trade + roll.
- [x] Test suites: `npm test` = smoke (all 19 pages render) + UI interaction suite.
      Plus ad-hoc jsdom suites for calendar, badge, modal, eye toggle (all passing).

## Remaining / blocked on user

- **GitHub push**: no remote or credentials in the sandbox. Needs a repo URL + PAT
  (or SSH deploy key) from the user.
- GPS marking verified with mocked geolocation only — real-device check pending.
