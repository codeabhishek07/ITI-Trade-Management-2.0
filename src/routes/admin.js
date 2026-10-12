'use strict';
const express = require('express');
const { db, getSettings, audit } = require('../db');
const { bad, requireFields, requireDate, requireTimeHHMM } = require('../util');
const { hashPassword } = require('../auth-crypto');

const router = express.Router();

// ---------- Overview ----------
router.get('/overview', (req, res) => {
  const c = q => db.prepare(q).get().n;
  res.json({
    sessions: c('SELECT COUNT(*) n FROM academic_sessions'),
    trades: c('SELECT COUNT(*) n FROM trades WHERE is_active=1'),
    officers: c("SELECT COUNT(*) n FROM users WHERE role='officer' AND is_active=1"),
    trainees: c("SELECT COUNT(*) n FROM users WHERE role='trainee' AND is_active=1"),
    present_today: c(`SELECT COUNT(*) n FROM attendance WHERE date=date('now','localtime') AND status='present'`),
    pending_leaves: c("SELECT COUNT(*) n FROM leave_requests WHERE status='pending'"),
    recent_audit: db.prepare(`SELECT a.*, u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id ORDER BY a.id DESC LIMIT 15`).all()
  });
});

// ---------- Academic sessions ----------
router.get('/sessions', (req, res) => {
  res.json(db.prepare('SELECT * FROM academic_sessions ORDER BY start_date DESC').all());
});

router.post('/sessions', (req, res) => {
  const b = req.body || {};
  requireFields(b, ['name', 'start_date', 'end_date']);
  requireDate(b.start_date, 'start_date');
  requireDate(b.end_date, 'end_date');
  if (b.end_date < b.start_date) throw bad('End date must be after start date.');
  try {
    const r = db.prepare('INSERT INTO academic_sessions (name, start_date, end_date, is_active) VALUES (?,?,?,0)')
      .run(String(b.name).trim(), b.start_date, b.end_date);
    audit(req.user, 'CREATE', 'academic_session', r.lastInsertRowid, b, req.ip);
    res.status(201).json(db.prepare('SELECT * FROM academic_sessions WHERE id=?').get(r.lastInsertRowid));
  } catch (e) { if (String(e.message).includes('UNIQUE')) throw bad('Session name already exists.'); throw e; }
});

router.put('/sessions/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM academic_sessions WHERE id=?').get(req.params.id);
  if (!row) throw bad('Session not found.', 404);
  const b = { ...row, ...req.body };
  requireDate(b.start_date, 'start_date');
  requireDate(b.end_date, 'end_date');
  if (b.end_date < b.start_date) throw bad('End date must be after start date.');
  db.prepare('UPDATE academic_sessions SET name=?, start_date=?, end_date=? WHERE id=?')
    .run(String(b.name).trim(), b.start_date, b.end_date, row.id);
  audit(req.user, 'UPDATE', 'academic_session', row.id, req.body, req.ip);
  res.json(db.prepare('SELECT * FROM academic_sessions WHERE id=?').get(row.id));
});

router.post('/sessions/:id/activate', (req, res) => {
  const row = db.prepare('SELECT * FROM academic_sessions WHERE id=?').get(req.params.id);
  if (!row) throw bad('Session not found.', 404);
  db.exec('UPDATE academic_sessions SET is_active=0');
  db.prepare('UPDATE academic_sessions SET is_active=1 WHERE id=?').run(row.id);
  db.prepare("UPDATE users SET session_id=? WHERE role='trainee' AND session_id IS NULL").run(row.id);
  audit(req.user, 'ACTIVATE', 'academic_session', row.id, { name: row.name }, req.ip);
  res.json({ ok: true });
});

router.delete('/sessions/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM academic_sessions WHERE id=?').get(req.params.id);
  if (!row) throw bad('Session not found.', 404);
  const used = db.prepare('SELECT COUNT(*) n FROM users WHERE session_id=?').get(row.id).n;
  if (used > 0) throw bad('Cannot delete: trainees are linked to this session. Deactivate it instead.');
  db.prepare('DELETE FROM academic_sessions WHERE id=?').run(row.id);
  audit(req.user, 'DELETE', 'academic_session', row.id, { name: row.name }, req.ip);
  res.json({ ok: true });
});

// ---------- Trades ----------
router.get('/trades', (req, res) => {
  res.json(db.prepare(`SELECT t.*,
      (SELECT COUNT(*) FROM users u WHERE u.trade_id=t.id AND u.role='trainee') trainee_count,
      (SELECT COUNT(*) FROM officer_trades ot WHERE ot.trade_id=t.id) officer_count
    FROM trades t ORDER BY t.name`).all());
});

router.post('/trades', (req, res) => {
  const b = req.body || {};
  requireFields(b, ['name', 'code']);
  try {
    const r = db.prepare('INSERT INTO trades (name, code, is_active) VALUES (?,?,?)')
      .run(String(b.name).trim(), String(b.code).trim().toUpperCase(), b.is_active === false ? 0 : 1);
    audit(req.user, 'CREATE', 'trade', r.lastInsertRowid, b, req.ip);
    res.status(201).json(db.prepare('SELECT * FROM trades WHERE id=?').get(r.lastInsertRowid));
  } catch (e) { if (String(e.message).includes('UNIQUE')) throw bad('Trade code already exists.'); throw e; }
});

router.put('/trades/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM trades WHERE id=?').get(req.params.id);
  if (!row) throw bad('Trade not found.', 404);
  const b = { ...row, ...req.body };
  requireFields(b, ['name', 'code']);
  try {
    db.prepare('UPDATE trades SET name=?, code=?, is_active=? WHERE id=?')
      .run(String(b.name).trim(), String(b.code).trim().toUpperCase(), b.is_active ? 1 : 0, row.id);
  } catch (e) { if (String(e.message).includes('UNIQUE')) throw bad('Trade code already exists.'); throw e; }
  audit(req.user, 'UPDATE', 'trade', row.id, req.body, req.ip);
  res.json(db.prepare('SELECT * FROM trades WHERE id=?').get(row.id));
});

router.delete('/trades/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM trades WHERE id=?').get(req.params.id);
  if (!row) throw bad('Trade not found.', 404);
  const users = db.prepare('SELECT COUNT(*) n FROM users WHERE trade_id=? OR id IN (SELECT officer_id FROM officer_trades WHERE trade_id=?)').get(row.id, row.id).n;
  if (users > 0) throw bad('Cannot delete: users are linked to this trade. Deactivate it instead.');
  db.prepare('DELETE FROM trades WHERE id=?').run(row.id);
  audit(req.user, 'DELETE', 'trade', row.id, { name: row.name }, req.ip);
  res.json({ ok: true });
});

// ---------- Training officer accounts ----------
function officerJson(id) {
  const u = db.prepare(`SELECT id, role, name, username, email, mobile, is_active, created_at FROM users WHERE id=? AND role='officer'`).get(id);
  if (!u) return null;
  u.trades = db.prepare(`SELECT t.id, t.name, t.code FROM officer_trades ot JOIN trades t ON t.id=ot.trade_id WHERE ot.officer_id=? ORDER BY t.name`).all(id);
  return u;
}

router.get('/officers', (req, res) => {
  const q = String(req.query.q || '').trim();
  let sql = `SELECT id, name, username, email, mobile, is_active FROM users WHERE role='officer'`;
  const args = [];
  if (q) { sql += ' AND (name LIKE ? OR username LIKE ? OR mobile LIKE ? OR email LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY name';
  res.json(db.prepare(sql).all(...args).map(o => officerJson(o.id)));
});

router.post('/officers', (req, res) => {
  const b = req.body || {};
  requireFields(b, ['name', 'username', 'password', 'mobile', 'trade_ids']);
  if (!Array.isArray(b.trade_ids) || !b.trade_ids.length) throw bad('Assign at least one trade.');
  if (String(b.password).length < 6) throw bad('Password must be at least 6 characters.');
  if (!/^\d{10}$/.test(String(b.mobile))) throw bad('Mobile number must be 10 digits.');
  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email))) throw bad('Invalid email address.');
  const exists = db.prepare('SELECT 1 x FROM users WHERE lower(username)=lower(?)').get(String(b.username).trim());
  if (exists) throw bad('Username already taken.');
  const { salt, hash } = hashPassword(b.password);
  let r;
  try {
    r = db.prepare(`INSERT INTO users (role, name, username, password, email, mobile, is_active) VALUES ('officer',?,?,?,?,?,?)`)
      .run(String(b.name).trim(), String(b.username).trim(), `${salt}:${hash}`, b.email ? String(b.email).trim() : null, String(b.mobile).trim(), b.is_active === false ? 0 : 1);
  } catch (e) { if (String(e.message).includes('UNIQUE')) throw bad('Username already taken.'); throw e; }
  const ins = db.prepare('INSERT OR IGNORE INTO officer_trades (officer_id, trade_id) VALUES (?,?)');
  for (const tid of b.trade_ids) ins.run(r.lastInsertRowid, Number(tid));
  audit(req.user, 'CREATE', 'officer', r.lastInsertRowid, { username: b.username, trades: b.trade_ids }, req.ip);
  res.status(201).json(officerJson(r.lastInsertRowid));
});

router.put('/officers/:id', (req, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id=? AND role='officer'").get(req.params.id);
  if (!row) throw bad('Officer not found.', 404);
  const b = req.body || {};
  if (b.mobile !== undefined && !/^\d{10}$/.test(String(b.mobile))) throw bad('Mobile number must be 10 digits.');
  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email))) throw bad('Invalid email address.');
  if (b.username && db.prepare('SELECT 1 x FROM users WHERE lower(username)=lower(?) AND id<>?').get(String(b.username).trim(), row.id)) throw bad('Username already taken.');
  db.prepare(`UPDATE users SET name=?, username=?, email=?, mobile=?, is_active=?, updated_at=datetime('now') WHERE id=?`)
    .run(b.name !== undefined ? String(b.name).trim() : row.name,
      b.username !== undefined ? String(b.username).trim() : row.username,
      b.email !== undefined ? (b.email ? String(b.email).trim() : null) : row.email,
      b.mobile !== undefined ? String(b.mobile).trim() : row.mobile,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : row.is_active, row.id);
  if (Array.isArray(b.trade_ids)) {
    if (!b.trade_ids.length) throw bad('Assign at least one trade.');
    db.prepare('DELETE FROM officer_trades WHERE officer_id=?').run(row.id);
    const ins = db.prepare('INSERT OR IGNORE INTO officer_trades (officer_id, trade_id) VALUES (?,?)');
    for (const tid of b.trade_ids) ins.run(row.id, Number(tid));
  }
  if (b.password) {
    if (String(b.password).length < 6) throw bad('Password must be at least 6 characters.');
    const { salt, hash } = hashPassword(b.password);
    db.prepare('UPDATE users SET password=?, must_change_password=1 WHERE id=?').run(`${salt}:${hash}`, row.id);
  }
  if (b.is_active === false) db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);
  audit(req.user, 'UPDATE', 'officer', row.id, { fields: Object.keys(b) }, req.ip);
  res.json(officerJson(row.id));
});

router.delete('/officers/:id', (req, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id=? AND role='officer'").get(req.params.id);
  if (!row) throw bad('Officer not found.', 404);
  const linked = db.prepare('SELECT COUNT(*) n FROM leave_requests WHERE reviewed_by=?').get(row.id).n;
  if (linked > 0) throw bad('Cannot delete: this officer has approval history. Deactivate the account instead.');
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);
  db.prepare('DELETE FROM users WHERE id=?').run(row.id);
  audit(req.user, 'DELETE', 'officer', row.id, { name: row.name, username: row.username }, req.ip);
  res.json({ ok: true });
});

// ---------- Settings ----------
const SETTING_RULES = {
  org_name: v => String(v).trim(),
  org_state: v => String(v).trim(),
  campus_name: v => String(v).trim(),
  campus_lat: v => { const n = Number(v); if (!(n >= -90 && n <= 90)) throw bad('Latitude must be between -90 and 90.'); return String(n); },
  campus_lng: v => { const n = Number(v); if (!(n >= -180 && n <= 180)) throw bad('Longitude must be between -180 and 180.'); return String(n); },
  campus_radius_m: v => { const n = Number(v); if (!(n >= 25 && n <= 5000)) throw bad('Campus radius must be 25–5000 metres.'); return String(Math.round(n)); },
  attendance_start: v => requireTimeHHMM(v, 'attendance start'),
  attendance_end: v => { requireTimeHHMM(v, 'attendance end'); return v; },
  auto_absent_enabled: v => {
    if (v === '1' || v === 1 || v === true) return '1';
    if (v === '0' || v === 0 || v === false) return '0';
    throw bad('Auto-absent must be 0 or 1.');
  },
  working_days_per_month: v => { const n = Number(v); if (!(n >= 1 && n <= 31)) throw bad('Working days must be 1–31.'); return String(Math.round(n)); },
  cl_year_limit: v => { const n = Number(v); if (!(n >= 0 && n <= 60)) throw bad('CL limit must be 0–60 days.'); return String(Math.round(n)); },
  ml_year_limit: v => { const n = Number(v); if (!(n >= 0 && n <= 60)) throw bad('ML limit must be 0–60 days.'); return String(Math.round(n)); },
  half_day_month_limit: v => { const n = Number(v); if (!(n >= 0 && n <= 31)) throw bad('Half-day limit must be 0–31.'); return String(Math.round(n)); },
  warning_threshold_pct: v => { const n = Number(v); if (!(n >= 1 && n <= 100)) throw bad('Warning threshold must be 1–100%.'); return String(n); }
};

router.get('/settings', (req, res) => res.json(getSettings()));

router.put('/settings', (req, res) => {
  const b = req.body || {};
  const updates = [];
  for (const [k, raw] of Object.entries(b)) {
    const rule = SETTING_RULES[k];
    if (!rule) continue;
    const val = rule(raw);
    db.prepare(`INSERT INTO settings (key, value, updated_at) VALUES (?,?,datetime('now'))
      ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at`).run(k, val);
    updates.push(k);
  }
  if (!updates.length) throw bad('No valid settings provided.');
  if (updates.includes('attendance_start') || updates.includes('attendance_end')) {
    const s = getSettings();
    if (s.attendance_end <= s.attendance_start) throw bad('Attendance end time must be after start time.');
  }
  audit(req.user, 'UPDATE', 'settings', '', { updated: updates }, req.ip);
  res.json(getSettings());
});

// ---------- Audit logs ----------
router.get('/audit', (req, res) => {
  const { from, to, q, role, limit } = req.query;
  let sql = `SELECT a.*, u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id WHERE 1=1`;
  const args = [];
  if (from) { sql += ' AND a.created_at >= ?'; args.push(from); }
  if (to) { sql += ' AND a.created_at <= ?'; args.push(to + ' 23:59:59'); }
  if (role) { sql += ' AND a.role = ?'; args.push(role); }
  if (q) { sql += ' AND (a.action LIKE ? OR a.entity LIKE ? OR a.detail LIKE ? OR u.name LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  sql += ' ORDER BY a.id DESC LIMIT ?';
  args.push(Math.min(Number(limit) || 200, 1000));
  res.json(db.prepare(sql).all(...args));
});

module.exports = router;
