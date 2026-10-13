'use strict';
const express = require('express');
const { db, audit, attendancePct, getSettingNum, getSetting, getSettings } = require('../db');
const { bad, requireFields, requireDate, isDate, rangeDates, todayStr, monthBounds, round } = require('../util');
const { assertOfficerTrade } = require('../auth');
const { hashPassword } = require('../auth-crypto');

const router = express.Router();
const STATUSES = ['present', 'absent', 'cl', 'ml', 'half_day'];

function activeSession() {
  return db.prepare('SELECT * FROM academic_sessions WHERE is_active=1 ORDER BY id DESC LIMIT 1').get();
}
function traineeScope(req, tradeId, extra = '') {
  const ids = req.user.trade_ids;
  if (!ids.length) return { clause: '0=1', args: [] };
  const ph = ids.map(() => '?').join(',');
  return { clause: `u.role='trainee' AND u.trade_id IN (${ph})${extra}`, args: ids };
}

// ---------- Overview ----------
router.get('/overview', (req, res) => {
  const ids = req.user.trade_ids;
  const ph = ids.map(() => '?').join(',') || '-1';
  const today = todayStr();
  const s = getSettings();
  const trainees = db.prepare(`SELECT COUNT(*) n FROM users u WHERE u.role='trainee' AND u.is_active=1 AND u.trade_id IN (${ph})`).get(...ids).n;
  const present = db.prepare(`SELECT COUNT(*) n FROM attendance a JOIN users u ON u.id=a.trainee_id WHERE a.date=? AND u.trade_id IN (${ph}) AND a.status='present'`).get(today, ...ids).n;
  const half = db.prepare(`SELECT COUNT(*) n FROM attendance a JOIN users u ON u.id=a.trainee_id WHERE a.date=? AND u.trade_id IN (${ph}) AND a.status='half_day'`).get(today, ...ids).n;
  const absent = db.prepare(`SELECT COUNT(*) n FROM attendance a JOIN users u ON u.id=a.trainee_id WHERE a.date=? AND u.trade_id IN (${ph}) AND a.status='absent'`).get(today, ...ids).n;
  const pendingLeaves = db.prepare(`SELECT COUNT(*) n FROM leave_requests l JOIN users u ON u.id=l.trainee_id WHERE l.status='pending' AND u.trade_id IN (${ph})`).get(...ids).n;
  const low = lowAttendanceRows(req).length;
  const pendingIndents = db.prepare(`SELECT COUNT(*) n FROM indent_registers WHERE status='pending' AND trade_id IN (${ph})`).get(...ids).n;
  res.json({
    trainees, present_today: present, absent_today: absent, half_day_today: half,
    pending_leaves: pendingLeaves, low_attendance: low, pending_indents: pendingIndents,
    threshold: Number(s.warning_threshold_pct || 80),
    trades: db.prepare(`SELECT t.* FROM trades t JOIN officer_trades ot ON ot.trade_id=t.id WHERE ot.officer_id=? ORDER BY t.name`).all(req.user.id)
  });
});

function lowAttendanceRows(req, threshold) {
  const th = threshold || getSettingNum('warning_threshold_pct', 80);
  const scope = traineeScope(req);
  const rows = db.prepare(`SELECT u.id, u.name, u.roll_no, u.trade_id, t.name trade_name,
      COUNT(a.id) working,
      SUM(CASE WHEN a.status='present' THEN 1 WHEN a.status='half_day' THEN 0.5 ELSE 0 END) earned
    FROM users u JOIN trades t ON t.id=u.trade_id
    LEFT JOIN attendance a ON a.trainee_id=u.id
    WHERE ${scope.clause} AND u.is_active=1
    GROUP BY u.id HAVING working > 0 AND (earned * 100.0 / working) < ? ORDER BY (earned*100.0/working) ASC`).all(...scope.args, th);
  return rows.map(r => ({ ...r, pct: round((r.earned * 100) / r.working) }));
}
router.get('/low-attendance', (req, res) => res.json(lowAttendanceRows(req, Number(req.query.threshold) || undefined)));

// ---------- Trainees ----------
router.get('/trainees', (req, res) => {
  const { q, trade_id, active } = req.query;
  const scope = traineeScope(req);
  let sql = `SELECT u.id, u.role, u.name, u.username, u.email, u.mobile, u.trade_id, u.session_id,
      u.roll_no, u.gender, u.guardian, u.is_active, u.must_change_password, u.created_at, u.updated_at,
      t.name trade_name, t.code trade_code, s.name session_name FROM users u
    JOIN trades t ON t.id=u.trade_id LEFT JOIN academic_sessions s ON s.id=u.session_id WHERE ${scope.clause}`;
  const args = [...scope.args];
  if (trade_id) { assertOfficerTrade(req, trade_id); sql += ' AND u.trade_id=?'; args.push(Number(trade_id)); }
  if (q) { sql += ' AND (u.name LIKE ? OR u.username LIKE ? OR u.roll_no LIKE ? OR u.mobile LIKE ?)'; args.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`); }
  if (active !== undefined && active !== '') { sql += ' AND u.is_active=?'; args.push(Number(active)); }
  sql += ' ORDER BY t.name, u.roll_no, u.name';
  res.json(db.prepare(sql).all(...args));
});

function validateTrainee(b, editingId) {
  requireFields(b, ['name', 'username', 'trade_id']);
  if (b.username && db.prepare('SELECT 1 x FROM users WHERE lower(username)=lower(?) AND id<>?').get(String(b.username).trim(), editingId || 0)) throw bad('Username already taken.');
  if (b.mobile && !/^\d{10}$/.test(String(b.mobile))) throw bad('Mobile number must be 10 digits.');
  if (b.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(b.email))) throw bad('Invalid email address.');
  if (b.password && String(b.password).length < 6) throw bad('Password must be at least 6 characters.');
}

router.post('/trainees', (req, res) => {
  const b = req.body || {};
  assertOfficerTrade(req, b.trade_id);
  validateTrainee(b);
  if (!b.password) throw bad('password is required.');
  const { salt, hash } = hashPassword(b.password);
  const sess = activeSession();
  let r;
  try {
    r = db.prepare(`INSERT INTO users (role, name, username, password, email, mobile, trade_id, session_id, roll_no, gender, guardian, is_active)
      VALUES ('trainee',?,?,?,?,?,?,?,?,?,?,?)`)
      .run(String(b.name).trim(), String(b.username).trim(), `${salt}:${hash}`,
        b.email ? String(b.email).trim() : null, b.mobile ? String(b.mobile).trim() : null,
        Number(b.trade_id), b.session_id ? Number(b.session_id) : (sess ? sess.id : null),
        b.roll_no ? String(b.roll_no).trim() : null, b.gender || null, b.guardian || null,
        b.is_active === false ? 0 : 1);
  } catch (e) { if (String(e.message).includes('UNIQUE')) throw bad('Username already taken.'); throw e; }
  audit(req.user, 'CREATE', 'trainee', r.lastInsertRowid, { username: b.username, trade_id: b.trade_id }, req.ip);
  res.status(201).json(db.prepare('SELECT id, name, username, roll_no, trade_id, is_active FROM users WHERE id=?').get(r.lastInsertRowid));
});

router.put('/trainees/:id', (req, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id=? AND role='trainee'").get(req.params.id);
  if (!row) throw bad('Trainee not found.', 404);
  assertOfficerTrade(req, row.trade_id);
  const b = { ...row, ...req.body };
  if (req.body.trade_id !== undefined) assertOfficerTrade(req, req.body.trade_id);
  validateTrainee(b, row.id);
  db.prepare(`UPDATE users SET name=?, username=?, email=?, mobile=?, trade_id=?, session_id=?, roll_no=?, gender=?, guardian=?, is_active=?, updated_at=datetime('now') WHERE id=?`)
    .run(String(b.name).trim(), String(b.username).trim(),
      b.email ? String(b.email).trim() : null, b.mobile ? String(b.mobile).trim() : null,
      Number(b.trade_id), b.session_id ? Number(b.session_id) : null,
      b.roll_no ? String(b.roll_no).trim() : null, b.gender || null, b.guardian || null,
      b.is_active !== undefined ? (b.is_active ? 1 : 0) : row.is_active, row.id);
  if (b.password) {
    if (String(b.password).length < 6) throw bad('Password must be at least 6 characters.');
    const { salt, hash } = hashPassword(b.password);
    db.prepare('UPDATE users SET password=?, must_change_password=1 WHERE id=?').run(`${salt}:${hash}`, row.id);
  }
  if (b.is_active === false) db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);
  audit(req.user, 'UPDATE', 'trainee', row.id, { fields: Object.keys(req.body || {}) }, req.ip);
  res.json({ ok: true });
});

router.delete('/trainees/:id', (req, res) => {
  const row = db.prepare("SELECT * FROM users WHERE id=? AND role='trainee'").get(req.params.id);
  if (!row) throw bad('Trainee not found.', 404);
  assertOfficerTrade(req, row.trade_id);
  db.prepare('DELETE FROM sessions WHERE user_id=?').run(row.id);
  db.prepare('DELETE FROM users WHERE id=?').run(row.id);
  audit(req.user, 'DELETE', 'trainee', row.id, { name: row.name, username: row.username }, req.ip);
  res.json({ ok: true });
});

// ---------- Attendance ----------
router.get('/attendance', (req, res) => {
  const date = req.query.date ? requireDate(req.query.date, 'date') : todayStr();
  const tradeId = req.query.trade_id ? Number(req.query.trade_id) : null;
  if (tradeId) assertOfficerTrade(req, tradeId);
  const scope = traineeScope(req);
  let sql = `SELECT u.id trainee_id, u.name, u.roll_no, u.trade_id, t.name trade_name, a.id attendance_id, a.status, a.marked_at, a.source, a.distance_m, a.corrected, a.note
    FROM users u JOIN trades t ON t.id=u.trade_id
    LEFT JOIN attendance a ON a.trainee_id=u.id AND a.date=?
    WHERE ${scope.clause} AND u.is_active=1`;
  const args = [date, ...scope.args];
  if (tradeId) { sql += ' AND u.trade_id=?'; args.push(tradeId); }
  sql += ' ORDER BY t.name, u.roll_no, u.name';
  const rows = db.prepare(sql).all(...args);
  res.json({ date, rows, window: { start: getSetting('attendance_start'), end: getSetting('attendance_end') } });
});

function upsertAttendance(req, { trainee_id, date, status, note }) {
  const row = db.prepare("SELECT * FROM users WHERE id=? AND role='trainee'").get(trainee_id);
  if (!row) throw bad('Trainee not found.', 404);
  assertOfficerTrade(req, row.trade_id);
  if (!STATUSES.includes(status)) throw bad('Invalid attendance status.');
  requireDate(date, 'date');
  const existing = db.prepare('SELECT * FROM attendance WHERE trainee_id=? AND date=?').get(trainee_id, date);
  if (existing) {
    db.prepare(`UPDATE attendance SET status=?, source='officer', corrected=1, corrected_by=?, note=?, marked_at=datetime('now') WHERE trainee_id=? AND date=?`)
      .run(status, req.user.id, note || (existing.status !== status ? `Corrected from ${existing.status}` : note || ''), trainee_id, date);
    audit(req.user, 'CORRECT_ATTENDANCE', 'attendance', existing.id, { trainee_id, date, from: existing.status, to: status, note }, req.ip);
    return { ...existing, status };
  }
  const r = db.prepare(`INSERT INTO attendance (trainee_id, date, status, source, note) VALUES (?,?,?,'officer',?)`)
    .run(trainee_id, date, status, note || null);
  audit(req.user, 'MARK_ATTENDANCE', 'attendance', r.lastInsertRowid, { trainee_id, date, status }, req.ip);
  return { id: r.lastInsertRowid, trainee_id, date, status };
}

router.post('/attendance', (req, res) => {
  const b = req.body || {};
  requireFields(b, ['trainee_id', 'date', 'status']);
  res.json(upsertAttendance(req, b));
});

router.post('/attendance/bulk', (req, res) => {
  const { date, entries } = req.body || {};
  requireDate(date, 'date');
  if (!Array.isArray(entries) || !entries.length) throw bad('entries array is required.');
  let n = 0;
  for (const e of entries) {
    if (!STATUSES.includes(e.status)) throw bad(`Invalid status: ${e.status}`);
    upsertAttendance(req, { trainee_id: e.trainee_id, date, status: e.status, note: e.note });
    n++;
  }
  audit(req.user, 'BULK_ATTENDANCE', 'attendance', '', { date, count: n }, req.ip);
  res.json({ ok: true, count: n });
});

router.delete('/attendance/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM attendance WHERE id=?').get(req.params.id);
  if (!row) throw bad('Record not found.', 404);
  assertOfficerTrade(req, db.prepare('SELECT trade_id FROM users WHERE id=?').get(row.trainee_id).trade_id);
  db.prepare('DELETE FROM attendance WHERE id=?').run(row.id);
  audit(req.user, 'DELETE', 'attendance', row.id, row, req.ip);
  res.json({ ok: true });
});

// ---------- Leave approval ----------
router.get('/leave', (req, res) => {
  const scope = traineeScope(req);
  let sql = `SELECT l.*, u.name trainee_name, u.roll_no, t.name trade_name, rv.name reviewer_name
    FROM leave_requests l JOIN users u ON u.id=l.trainee_id JOIN trades t ON t.id=u.trade_id
    LEFT JOIN users rv ON rv.id=l.reviewed_by WHERE ${scope.clause}`;
  const args = [...scope.args];
  if (req.query.status) { sql += ' AND l.status=?'; args.push(req.query.status); }
  if (req.query.trade_id) { sql += ' AND u.trade_id=?'; args.push(Number(req.query.trade_id)); }
  if (req.query.q) { sql += ' AND (u.name LIKE ? OR u.roll_no LIKE ?)'; args.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  sql += ` ORDER BY CASE l.status WHEN 'pending' THEN 0 ELSE 1 END, l.created_at DESC`;
  res.json(db.prepare(sql).all(...args));
});

router.post('/leave/:id/review', (req, res) => {
  const { action, note } = req.body || {};
  if (!['approve', 'reject'].includes(action)) throw bad('action must be approve or reject.');
  const l = db.prepare(`SELECT l.*, u.trade_id, u.name trainee_name FROM leave_requests l JOIN users u ON u.id=l.trainee_id WHERE l.id=?`).get(req.params.id);
  if (!l) throw bad('Leave request not found.', 404);
  assertOfficerTrade(req, l.trade_id);
  if (l.status !== 'pending') throw bad('This request is already reviewed.');
  const status = action === 'approve' ? 'approved' : 'rejected';
  db.prepare(`UPDATE leave_requests SET status=?, reviewed_by=?, reviewed_at=datetime('now'), review_note=? WHERE id=?`)
    .run(status, req.user.id, note || '', l.id);
  if (status === 'approved') {
    const statusFor = { CL: 'cl', ML: 'ml', HALF_DAY: 'half_day' }[l.type];
    const ins = db.prepare(`INSERT INTO attendance (trainee_id, date, status, source, note) VALUES (?,?,?,'leave',?)
      ON CONFLICT(trainee_id, date) DO UPDATE SET status=excluded.status, source='leave', note=excluded.note
      WHERE attendance.status='absent'`);
    for (const d of rangeDates(l.from_date, l.to_date)) {
      ins.run(l.trainee_id, d, statusFor, `Leave #${l.id} approved`);
    }
  }
  audit(req.user, status.toUpperCase() + '_LEAVE', 'leave_request', l.id, { trainee: l.trainee_name, type: l.type, note }, req.ip);
  res.json({ ok: true, status });
});

// ---------- Warnings ----------
router.post('/warnings', (req, res) => {
  const b = req.body || {};
  requireFields(b, ['trainee_id', 'message']);
  const t = db.prepare("SELECT * FROM users WHERE id=? AND role='trainee'").get(b.trainee_id);
  if (!t) throw bad('Trainee not found.', 404);
  assertOfficerTrade(req, t.trade_id);
  const stats = attendancePct(db.prepare('SELECT status FROM attendance WHERE trainee_id=?').all(t.id));
  if (stats.pct >= getSettingNum('warning_threshold_pct', 80) && b.force !== true) {
    throw bad(`Attendance is ${stats.pct}% — at or above the threshold. Use force to issue anyway.`);
  }
  const r = db.prepare('INSERT INTO warnings (trainee_id, trade_id, issued_by, message, attendance_pct, period) VALUES (?,?,?,?,?,?)')
    .run(t.id, t.trade_id, req.user.id, String(b.message).trim(), stats.pct, b.period || null);
  audit(req.user, 'ISSUE_WARNING', 'warning', r.lastInsertRowid, { trainee: t.name, pct: stats.pct }, req.ip);
  res.status(201).json({ id: r.lastInsertRowid, pct: stats.pct });
});

router.get('/warnings', (req, res) => {
  const scope = traineeScope(req);
  let sql = `SELECT w.*, u.name trainee_name, u.roll_no, t.name trade_name, i.name issued_by_name
    FROM warnings w JOIN users u ON u.id=w.trainee_id JOIN trades t ON t.id=w.trade_id
    LEFT JOIN users i ON i.id=w.issued_by WHERE ${scope.clause}`;
  const args = [...scope.args];
  if (req.query.trainee_id) { sql += ' AND w.trainee_id=?'; args.push(Number(req.query.trainee_id)); }
  sql += ' ORDER BY w.id DESC LIMIT 500';
  res.json(db.prepare(sql).all(...args));
});

router.delete('/warnings/:id', (req, res) => {
  const w = db.prepare('SELECT * FROM warnings WHERE id=?').get(req.params.id);
  if (!w) throw bad('Warning not found.', 404);
  assertOfficerTrade(req, w.trade_id);
  db.prepare('DELETE FROM warnings WHERE id=?').run(w.id);
  audit(req.user, 'DELETE', 'warning', w.id, {}, req.ip);
  res.json({ ok: true });
});


// ---------- Inventory ----------
const TXN_SIGN = { stock_add: 1, issue: -1, return: 1, usage: -1, damage: -1 };

function itemStock(itemId) {
  const it = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(itemId);
  if (!it) return null;
  const txns = db.prepare('SELECT txn_type, qty FROM inventory_txn WHERE item_id=?').all(itemId);
  let available = Number(it.opening_qty), issued = 0, used = 0, damaged = 0, added = 0;
  for (const t of txns) {
    available += TXN_SIGN[t.txn_type] * t.qty;
    if (t.txn_type === 'issue') issued += t.qty;
    if (t.txn_type === 'return') issued -= t.qty;
    if (t.txn_type === 'usage') used += t.qty;
    if (t.txn_type === 'damage') damaged += t.qty;
    if (t.txn_type === 'stock_add') added += t.qty;
  }
  return { ...it, available: round(available), issued: round(issued), used: round(used), damaged: round(damaged), added: round(added), low: available <= it.min_level };
}

router.get('/inventory', (req, res) => {
  const items = db.prepare('SELECT id FROM inventory_items ORDER BY name').all().map(i => itemStock(i.id));
  res.json(items);
});

router.post('/inventory', (req, res) => {
  const b = req.body || {};
  requireFields(b, ['name', 'unit']);
  const qty = Number(b.opening_qty || 0);
  if (!(qty >= 0)) throw bad('Opening stock must be 0 or more.');
  const r = db.prepare('INSERT INTO inventory_items (name, category, unit, opening_qty, min_level, rate, is_active) VALUES (?,?,?,?,?,?,?)')
    .run(String(b.name).trim(), b.category || null, String(b.unit).trim(), qty, Number(b.min_level || 0), Number(b.rate || 0), b.is_active === false ? 0 : 1);
  audit(req.user, 'CREATE', 'inventory_item', r.lastInsertRowid, b, req.ip);
  res.status(201).json(itemStock(r.lastInsertRowid));
});

router.put('/inventory/:id', (req, res) => {
  const it = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(req.params.id);
  if (!it) throw bad('Item not found.', 404);
  const b = { ...it, ...req.body };
  db.prepare('UPDATE inventory_items SET name=?, category=?, unit=?, min_level=?, rate=?, is_active=? WHERE id=?')
    .run(String(b.name).trim(), b.category || null, String(b.unit).trim(), Number(b.min_level || 0), Number(b.rate || 0), b.is_active ? 1 : 0, it.id);
  audit(req.user, 'UPDATE', 'inventory_item', it.id, req.body, req.ip);
  res.json(itemStock(it.id));
});

router.post('/inventory/:id/txn', (req, res) => {
  const b = req.body || {};
  const it = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(req.params.id);
  if (!it) throw bad('Item not found.', 404);
  const type = b.txn_type;
  if (!TXN_SIGN[type]) throw bad('txn_type must be stock_add, issue, return, usage or damage.');
  const qty = Number(b.qty);
  if (!(qty > 0)) throw bad('Quantity must be greater than 0.');
  if (type !== 'stock_add' && itemStock(it.id).available < qty) throw bad(`Only ${itemStock(it.id).available} ${it.unit} available.`);
  if (type === 'issue' && b.trade_id) assertOfficerTrade(req, b.trade_id);
  const r = db.prepare('INSERT INTO inventory_txn (item_id, txn_type, qty, to_officer, trade_id, remarks, created_by) VALUES (?,?,?,?,?,?,?)')
    .run(it.id, type, qty, b.to_officer || null, b.trade_id ? Number(b.trade_id) : null, b.remarks || null, req.user.id);
  audit(req.user, 'INVENTORY_' + type.toUpperCase(), 'inventory_item', it.id, { qty, remarks: b.remarks }, req.ip);
  res.status(201).json({ txn_id: r.lastInsertRowid, stock: itemStock(it.id) });
});

router.get('/inventory/txns', (req, res) => {
  let sql = `SELECT x.*, i.name item_name, i.unit, u.name to_name, t.name trade_name, c.name created_by_name
    FROM inventory_txn x JOIN inventory_items i ON i.id=x.item_id
    LEFT JOIN users u ON u.id=x.to_officer LEFT JOIN trades t ON t.id=x.trade_id
    LEFT JOIN users c ON c.id=x.created_by WHERE 1=1`;
  const args = [];
  if (req.query.item_id) { sql += ' AND x.item_id=?'; args.push(Number(req.query.item_id)); }
  if (req.query.type) { sql += ' AND x.txn_type=?'; args.push(req.query.type); }
  sql += ' ORDER BY x.id DESC LIMIT 500';
  res.json(db.prepare(sql).all(...args));
});

// ---------- Indent registers ----------
router.get('/indents', (req, res) => {
  const scope = traineeScope(req, '', ''); // trades scope only
  const ids = req.user.trade_ids;
  const ph = ids.map(() => '?').join(',') || '-1';
  let sql = `SELECT g.*, t.name trade_name, u.name indenter_name, r.name reviewer_name
    FROM indent_registers g JOIN trades t ON t.id=g.trade_id JOIN users u ON u.id=g.indenter_id
    LEFT JOIN users r ON r.id=g.reviewed_by WHERE g.trade_id IN (${ph})`;
  const args = [...ids];
  if (req.query.status) { sql += ' AND g.status=?'; args.push(req.query.status); }
  if (req.query.trade_id) { assertOfficerTrade(req, req.query.trade_id); sql += ' AND g.trade_id=?'; args.push(Number(req.query.trade_id)); }
  sql += " ORDER BY CASE g.status WHEN 'pending' THEN 0 ELSE 1 END, g.id DESC LIMIT 500";
  const rows = db.prepare(sql).all(...args);
  res.json(rows.map(r => ({ ...r, items: JSON.parse(r.items) })));
});

router.post('/indents', (req, res) => {
  const b = req.body || {};
  requireFields(b, ['trade_id', 'register_date', 'items']);
  assertOfficerTrade(req, b.trade_id);
  requireDate(b.register_date, 'register_date');
  if (!Array.isArray(b.items) || !b.items.length) throw bad('Add at least one item to the indent.');
  for (const it of b.items) {
    if (!db.prepare('SELECT 1 x FROM inventory_items WHERE id=?').get(Number(it.item_id))) throw bad(`Item ${it.item_id} not found.`);
    if (!(Number(it.qty) > 0)) throw bad('Indent quantity must be greater than 0.');
  }
  const r = db.prepare('INSERT INTO indent_registers (trade_id, indenter_id, register_date, items, status) VALUES (?,?,?,?,?)')
    .run(Number(b.trade_id), req.user.id, b.register_date, JSON.stringify(b.items), 'pending');
  audit(req.user, 'CREATE', 'indent_register', r.lastInsertRowid, { items: b.items.length }, req.ip);
  res.status(201).json({ id: r.lastInsertRowid, status: 'pending' });
});

router.post('/indents/:id/review', (req, res) => {
  const { action, note } = req.body || {};
  if (!['issue', 'reject'].includes(action)) throw bad('action must be issue or reject.');
  const g = db.prepare('SELECT * FROM indent_registers WHERE id=?').get(req.params.id);
  if (!g) throw bad('Indent not found.', 404);
  assertOfficerTrade(req, g.trade_id);
  if (g.status !== 'pending') throw bad('This indent is already reviewed.');
  const items = JSON.parse(g.items);
  if (action === 'issue') {
    for (const it of items) {
      const stock = itemStock(it.item_id);
      if (!stock) throw bad('An item on this indent no longer exists.');
      if (stock.available < Number(it.qty)) throw bad(`Insufficient stock for ${stock.name}: available ${stock.available} ${stock.unit}, requested ${it.qty}.`);
    }
    const ins = db.prepare("INSERT INTO inventory_txn (item_id, txn_type, qty, trade_id, remarks, created_by) VALUES (?, 'issue', ?, ?, ?, ?)");
    for (const it of items) ins.run(Number(it.item_id), Number(it.qty), g.trade_id, `Indent #${g.id} issued`, req.user.id);
  }
  db.prepare(`UPDATE indent_registers SET status=?, issue_note=?, reviewed_by=?, updated_at=datetime('now') WHERE id=?`)
    .run(action === 'issue' ? 'issued' : 'rejected', note || '', req.user.id, g.id);
  audit(req.user, action === 'issue' ? 'ISSUE_INDENT' : 'REJECT_INDENT', 'indent_register', g.id, { note }, req.ip);
  res.json({ ok: true, status: action === 'issue' ? 'issued' : 'rejected' });
});

// ---------- Question papers ----------
function parsePaper(row) { return { ...row, paper_data: JSON.parse(row.paper_data) }; }

router.get('/papers', (req, res) => {
  const ids = req.user.trade_ids;
  const ph = ids.map(() => '?').join(',') || '-1';
  let sql = `SELECT p.*, t.name trade_name, u.name created_by_name FROM question_papers p
    JOIN trades t ON t.id=p.trade_id LEFT JOIN users u ON u.id=p.created_by WHERE p.trade_id IN (${ph})`;
  const args = [...ids];
  if (req.query.trade_id) { assertOfficerTrade(req, req.query.trade_id); sql += ' AND p.trade_id=?'; args.push(Number(req.query.trade_id)); }
  if (req.query.q) { sql += ' AND (p.title LIKE ? OR p.subject LIKE ?)'; args.push(`%${req.query.q}%`, `%${req.query.q}%`); }
  sql += ' ORDER BY p.id DESC';
  res.json(db.prepare(sql).all(...args).map(parsePaper));
});

function validatePaper(b) {
  requireFields(b, ['trade_id', 'title', 'paper_data']);
  const pd = b.paper_data;
  if (!pd || !Array.isArray(pd.questions) || !pd.questions.length) throw bad('Add at least one question.');
  let marks = 0;
  for (const q of pd.questions) {
    if (!q.text || !String(q.text).trim()) throw bad('Every question needs text.');
    const m = Number(q.marks || 0);
    if (!(m > 0)) throw bad('Every question needs marks greater than 0.');
    marks += m;
  }
  return { marks };
}

router.post('/papers', (req, res) => {
  const b = req.body || {};
  assertOfficerTrade(req, b.trade_id);
  const { marks } = validatePaper(b);
  const r = db.prepare(`INSERT INTO question_papers (trade_id, title, subject, session_name, duration_min, total_marks, paper_data, created_by) VALUES (?,?,?,?,?,?,?,?)`)
    .run(Number(b.trade_id), String(b.title).trim(), b.subject || null, b.session_name || null,
      Number(b.duration_min || 120), Number(b.total_marks || marks), JSON.stringify(b.paper_data), req.user.id);
  audit(req.user, 'CREATE', 'question_paper', r.lastInsertRowid, { title: b.title }, req.ip);
  res.status(201).json({ id: r.lastInsertRowid });
});

router.put('/papers/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM question_papers WHERE id=?').get(req.params.id);
  if (!p) throw bad('Paper not found.', 404);
  assertOfficerTrade(req, p.trade_id);
  const b = { ...p, ...req.body, paper_data: req.body.paper_data || JSON.parse(p.paper_data) };
  assertOfficerTrade(req, b.trade_id);
  const { marks } = validatePaper(b);
  db.prepare(`UPDATE question_papers SET trade_id=?, title=?, subject=?, session_name=?, duration_min=?, total_marks=?, paper_data=? WHERE id=?`)
    .run(Number(b.trade_id), String(b.title).trim(), b.subject || null, b.session_name || null,
      Number(b.duration_min || 120), Number(b.total_marks || marks), JSON.stringify(b.paper_data), p.id);
  audit(req.user, 'UPDATE', 'question_paper', p.id, { title: b.title }, req.ip);
  res.json({ ok: true });
});

router.delete('/papers/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM question_papers WHERE id=?').get(req.params.id);
  if (!p) throw bad('Paper not found.', 404);
  assertOfficerTrade(req, p.trade_id);
  db.prepare('DELETE FROM question_papers WHERE id=?').run(p.id);
  audit(req.user, 'DELETE', 'question_paper', p.id, { title: p.title }, req.ip);
  res.json({ ok: true });
});

module.exports = router;
module.exports.activeSession = activeSession;
module.exports.STATUSES = STATUSES;
