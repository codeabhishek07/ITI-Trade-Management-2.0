# ITI Trade Management

A lightweight, responsive full-stack web application for **Government ITI Raigarh, Chhattisgarh**
to manage trade-level training activities across ITI trades.

**Stack:** Node.js 24 · Express 4 · `node:sqlite` (built-in, zero native deps) · Vanilla JS SPA (light theme, no dark colours)

## Quick start

```bash
npm ci            # install the single dependency (express)
npm start         # http://localhost:3000
npm run seed      # optional demo data (officer, 7 trainees, history) — runs automatically on first boot for admin
npm test          # jsdom smoke test + UI interaction test (server must be running)
```

## Demo logins

| Role              | Username   | Password      |
|-------------------|------------|---------------|
| Trade Admin       | `admin`    | `Admin@123`   |
| Training Officer  | `rverma`   | `Officer@123` |
| Trainee           | `trainee1` | `Trainee@123` |

## Roles & features

### 1. Trade Admin
- Academic sessions (create / edit / activate / delete)
- Monthly working days, attendance rules, **campus geofence (lat/lng/radius)**, leave limits,
  auto-absent toggle, low-attendance warning threshold — all in **Settings**
- Trade management (create / edit / activate)
- Training Officer accounts: name, assigned trades, mobile, email, credentials,
  activate/deactivate, password reset
- Full audit log with filters and CSV export

### 2. Training Officer (restricted to assigned trades)
- Trainee CRUD (search, filters, activate/deactivate, delete)
- Daily attendance sheet: **Present · Absent · Casual Leave · Medical Leave · Half-Day**
  with bulk save, corrections (audited), record deletion
- Leave approval / rejection with notes (approved leave fills attendance automatically)
- Low-attendance (<80%, configurable) detection + **warnings** to trainees
- Inventory: items, stock entries (issue / return / usage / damage / stock-add),
  available-stock computation, low-stock alerts
- Indent registers: create, review, issue (auto stock deduction), reject
- Examination question papers: create / edit / view / delete
- Reports: daily, monthly, attendance %, trainee list, leave register, inventory —
  **on-screen preview + PDF + Excel-compatible CSV**

### 3. Trainee (own records only)
- Attendance marking **07:00–10:00** (configurable) with automatic timestamp and
  **GPS geotag verified server-side** against the campus geofence (haversine distance)
- Automatic permission handling: denied / unavailable / timeout states with recovery tips
- Auto-absent after the window (Mon–Sat, configurable), officer-authorised corrections allowed
- Apply for CL / ML / Half-Day with **limit validation** and overlap checks; track approval; cancel pending
- Attendance history, percentage, and graphical dashboard (14-day pattern + 6-month trend)
- Warnings received, leave balances, profile

## Security
- scrypt password hashing (per-user salt, constant-time compare)
- HttpOnly, SameSite=Lax session cookies (7-day expiry, DB-backed)
- Role-based access control middleware; officers scoped via `officer_trades`;
  trainees scoped to their own records; server-side validation on every endpoint
- Geofence + time-window enforced **on the server** (not just the browser)
- Every mutation is written to `audit_logs` (user, role, action, entity, IP, time)
- No secrets in the repo; settings hold only public campus coordinates

## Configuration (admin → Settings)
campus name/lat/lng/radius · attendance start/end · auto-absent on/off ·
monthly working days · CL/ML/half-day limits · warning threshold %
