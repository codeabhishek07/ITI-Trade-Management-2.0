# ITI Trade Management — Progress Notes (saved for later)

Project: full-stack "ITI Trade Management" for Government ITI Raigarh, CG.
Stack: Node 24 + Express 4 + node:sqlite (built-in, no native deps), vanilla JS SPA, light theme, no dark colors.
Branch: freebuff/aabe638ca8dd669110ace4ea
Run: `npm start` (to add) -> serve server.js on port 3000.

## Completed
- [x] Scaffold: package.json, express@4 installed, dirs src/, src/routes/, public/, public/css, public/js, data/
- [x] src/db.js — full schema (15 tables): academic_sessions, trades, users, officer_trades, sessions,
      settings, attendance, leave_requests, warnings, inventory_items, inventory_txn, indent_registers,
      question_papers, audit_logs + indexes. Seeds default settings (campus lat/lng/radius, attendance
      07:00-10:00, working days 26, CL 12/yr, ML 10/yr, half-day 4/mo, warning 80%, auto_absent),
      sessions 2025-26/2026-27, 4 trades (FIT/ELE/WLD/MDL), admin user `admin` / `Admin@123`.
      Helpers: getSettings/setSetting/getSetting/getSettingNum, audit(), attendancePct().
- [x] src/auth-crypto.js — scrypt hash (salt:hash), verify, newToken.
- [x] src/auth.js — cookie sessions (iti_session, 7d, HttpOnly SameSite=Lax), login/logout,
      requireLogin, requireRole, getUser (loads officer trade_ids), assertOfficerTrade, changePassword.
- [x] src/util.js — requireFields/date/time validators, rangeDates, todayStr, nowHHMM, monthBounds,
      haversineMeters, round, esc, bad().
- [x] src/report.js — CSV (BOM) + dependency-free PDF generator (multi-page A4 landscape table).
      Tested: valid %PDF output.

## TODO (next steps, in order)
1. server.js — express app: json body, /api/login, /api/logout, /api/me, /api/change-password,
   /api/public/settings, mount routes, static public/, SPA fallback, error middleware,
   auto-absent sweep (setInterval, skips Sundays, after attendance_end), listen :3000.
2. src/routes/admin.js — sessions CRUD+activate, trades CRUD, officer accounts CRUD (name, trade_ids,
   mobile, email, credentials, activate/deactivate, reset password), settings PUT (validated whitelist
   incl. campus geofence, attendance window, leave limits, working days, warning %), audit log list,
   overview stats.
3. src/routes/officer.js — scoped to req.user.trade_ids: trainees CRUD, attendance sheet/bulk/correct
   (source officer, corrected flag), leave approve/reject (on approve, fill attendance records for
   leave dates), low-attendance + warnings, inventory items/txns (stock_add/issue/return/usage/damage
   with computed available), indent review/issue (deduct stock), question papers CRUD.
4. src/routes/trainee.js — GPS self-attendance (server time-window check + haversine geofence check,
   insert present with distance), leave apply with limit validation + cancel, history + pct,
   dashboard data, own warnings.
5. src/routes/reports.js (admin+officer) — daily/monthly/percentage/trainee-list/inventory/leave
   register, format=json|csv|pdf via src/report.js; officers restricted to assigned trades.
6. Frontend public/: index.html (login panels for 3 roles), css/styles.css (light responsive),
   js/core.js (api wrapper, hash router, tables, modals, toasts, canvas charts), js/admin.js,
   js/officer.js, js/trainee.js (GPS permission states, geofence distance display).
7. End-to-end HTTP tests (curl) for all roles + flows; fix issues; npm start; preview port 3000
   with host pv-aabe638ca8dd-c6991ac8-c904-44bf-9895-54f4d5b9e7d9.style.dev.

## Key decisions
- Percentage = (present + 0.5*half_day) / (present+half_day+absent) *100; approved CL/ML excluded.
- Auto-absent: enabled by setting, runs after attendance_end, skips Sundays, source='system'.
- Officer scope enforced via officer_trades; trainees only own records.
- Audit log on every mutation (action, entity, ip).
