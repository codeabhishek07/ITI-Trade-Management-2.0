'use strict';
const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');
const { hashPassword } = require('./auth-crypto');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'iti-trade.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS academic_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  is_active INTEGER NOT NULL DEFAULT 1,
  session_id INTEGER REFERENCES academic_sessions(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK(role IN ('admin','officer','trainee')),
  name TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  email TEXT,
  mobile TEXT,
  trade_id INTEGER REFERENCES trades(id),
  session_id INTEGER REFERENCES academic_sessions(id),
  roll_no TEXT,
  gender TEXT,
  guardian TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  must_change_password INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS officer_trades (
  officer_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trade_id INTEGER NOT NULL REFERENCES trades(id) ON DELETE CASCADE,
  PRIMARY KEY (officer_id, trade_id)
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ip TEXT, user_agent TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS attendance (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trainee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('present','absent','cl','ml','half_day')),
  marked_at TEXT NOT NULL DEFAULT (datetime('now')),
  source TEXT NOT NULL DEFAULT 'self' CHECK(source IN ('self','officer','system','leave')),
  lat REAL, lng REAL, distance_m REAL,
  corrected INTEGER NOT NULL DEFAULT 0,
  corrected_by INTEGER REFERENCES users(id),
  note TEXT,
  UNIQUE(trainee_id, date)
);
CREATE TABLE IF NOT EXISTS leave_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trainee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('CL','ML','HALF_DAY')),
  from_date TEXT NOT NULL,
  to_date TEXT NOT NULL,
  days REAL NOT NULL DEFAULT 1,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS warnings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trainee_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  trade_id INTEGER,
  issued_by INTEGER REFERENCES users(id),
  message TEXT NOT NULL,
  attendance_pct REAL NOT NULL DEFAULT 0,
  period TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS inventory_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT,
  unit TEXT NOT NULL DEFAULT 'pcs',
  opening_qty REAL NOT NULL DEFAULT 0,
  min_level REAL NOT NULL DEFAULT 0,
  rate REAL NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS inventory_txn (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id INTEGER NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  txn_type TEXT NOT NULL CHECK(txn_type IN ('stock_add','issue','return','usage','damage')),
  qty REAL NOT NULL,
  to_officer INTEGER REFERENCES users(id),
  trade_id INTEGER REFERENCES trades(id),
  remarks TEXT,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS indent_registers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id INTEGER NOT NULL REFERENCES trades(id),
  indenter_id INTEGER NOT NULL REFERENCES users(id),
  register_date TEXT NOT NULL,
  items TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','issued','rejected')),
  issue_note TEXT,
  reviewed_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS question_papers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  trade_id INTEGER NOT NULL REFERENCES trades(id),
  title TEXT NOT NULL,
  subject TEXT,
  session_name TEXT,
  duration_min INTEGER NOT NULL DEFAULT 120,
  total_marks INTEGER NOT NULL DEFAULT 100,
  paper_data TEXT NOT NULL,
  created_by INTEGER REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  role TEXT,
  action TEXT NOT NULL,
  entity TEXT,
  entity_id TEXT,
  detail TEXT,
  ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_att_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_att_trainee ON attendance(trainee_id, date);
CREATE INDEX IF NOT EXISTS idx_leave_status ON leave_requests(status);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`;

db.exec(SCHEMA);

const DEFAULT_SETTINGS = {
  campus_name: 'Government ITI Raigarh, Chhattisgarh',
  campus_lat: '21.897600',
  campus_lng: '83.377700',
  campus_radius_m: '250',
  attendance_start: '07:00',
  attendance_end: '10:00',
  auto_absent_enabled: '1',
  working_days_per_month: '26',
  cl_year_limit: '12',
  ml_year_limit: '10',
  half_day_month_limit: '4',
  warning_threshold_pct: '80',
  org_name: 'Government ITI Raigarh',
  org_state: 'Chhattisgarh'
};

function seed() {
  const count = db.prepare('SELECT COUNT(*) c FROM settings').get().c;
  if (count === 0) {
    const ins = db.prepare('INSERT INTO settings (key, value) VALUES (?, ?)');
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) ins.run(k, v);
  }
  const ac = db.prepare('SELECT COUNT(*) c FROM academic_sessions').get().c;
  if (ac === 0) {
    db.prepare("INSERT INTO academic_sessions (name, start_date, end_date, is_active) VALUES ('2025-26','2025-07-01','2026-06-30',1)").run();
    db.prepare("INSERT INTO academic_sessions (name, start_date, end_date, is_active) VALUES ('2026-27','2026-07-01','2027-06-30',0)").run();
  }
  const tc = db.prepare('SELECT COUNT(*) c FROM trades').get().c;
  if (tc === 0) {
    const ins = db.prepare('INSERT INTO trades (name, code) VALUES (?, ?)');
    ins.run('Fitter', 'FIT');
    ins.run('Electrician', 'ELE');
    ins.run('Welder', 'WLD');
    ins.run('Mechanic (Diesel)', 'MDL');
  }
  const uc = db.prepare("SELECT COUNT(*) c FROM users WHERE role='admin'").get().c;
  if (uc === 0) {
    const { salt, hash } = hashPassword('Admin@123');
    db.prepare("INSERT INTO users (role, name, username, password, email, mobile, is_active, must_change_password) VALUES ('admin','Trade Administrator','admin',?, 'admin.iti@cg.gov.in','9425000001',1,0)")
      .run(`${salt}:${hash}`);
  }
}
seed();

function getSettings() {
  const rows = db.prepare('SELECT key, value FROM settings').all();
  const out = {};
  for (const r of rows) out[r.key] = r.value;
  return out;
}
function setSetting(key, value) {
  db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.now`).run(key, String(value));
}
function getSetting(key, fallback = null) {
  const r = db.prepare('SELECT value FROM settings WHERE key = ?').get(key);
  return r ? r.value : fallback;
}
function getSettingNum(key, fallback) {
  const v = getSetting(key);
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function audit(user, action, entity, entityId, detail, ip) {
  try {
    db.prepare('INSERT INTO audit_logs (user_id, role, action, entity, entity_id, detail, ip) VALUES (?,?,?,?,?,?,?)')
      .run(user ? user.id : null, user ? user.role : 'system', action, entity || '', entityId != null ? String(entityId) : '', detail ? JSON.stringify(detail).slice(0, 2000) : '', ip || '');
  } catch (e) { console.error('audit failed', e.message); }
}

// Attendance helpers -------------------------------------------------------
function attendancePct(records) {
  let working = 0, earned = 0, leaves = 0;
  for (const r of records) {
    if (r.status === 'present') { working++; earned += 1; }
    else if (r.status === 'half_day') { working++; earned += 0.5; }
    else if (r.status === 'absent') { working++; }
    else if (r.status === 'cl' || r.status === 'ml') { leaves++; }
  }
  const pct = working > 0 ? (earned / working) * 100 : 0;
  return { pct: Math.round(pct * 100) / 100, working, earned, leaves };
}

module.exports = { db, getSettings, setSetting, getSetting, getSettingNum, audit, attendancePct, DB_PATH, DEFAULT_SETTINGS };
