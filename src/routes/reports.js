'use strict';
const express = require('express');
const { db, getSettingNum, getSettings, audit, attendancePct, getSetting } = require('../db');
const { bad, requireDate, isDate, todayStr, monthBounds, rangeDates, round, esc } = require('../util');
const { sendCsv, sendPdf } = require('../report');

const router = express.Router();
const STATUS_LABEL = { present: 'Present', absent: 'Absent', cl: 'Casual Leave', ml: 'Medical Leave', half_day: 'Half Day', none: '-' };

function tradeFilter(req) {
  const ids = req.user.role === 'officer' ? req.user.trade_ids : db.prepare('SELECT id FROM trades').all().map(t => t.id);
  const requested = req.query.trade_id ? Number(req.query.trade_id) : null;
  if (requested) {
    if (!ids.includes(requested)) throw bad('Trade is not assigned to you.', 403);
    return [requested];
  }
  return ids;
}

function headersWidths(headers, rows) {
  // weight columns by content length (capped)
  return headers.map((h, i) => {
    let max = String(h).length;
    for (const r of rows) max = Math.max(max, String(r[i] == null ? '' : r[i]).length);
    return { text: h, w: Math.min(Math.max(max, 6), 40) };
  });
}

function send(res, format, filename, headers, rows, title, subtitle, footer) {
  if (format === 'csv') return sendCsv(res, filename, headers, rows);
  if (format === 'pdf') return sendPdf(res, filename, { title, subtitle, headers: headersWidths(headers, rows), rows, footer });
  return null; // json handled by caller
}

// ---------- Daily attendance report ----------
router.get('/daily', (req, res) => {
  const date = req.query.date ? requireDate(req.query.date, 'date') : todayStr();
  const tradeIds = tradeFilter(req);
  const ph = tradeIds.map(() => '?').join(',') || '-1';
  const rows = db.prepare(`SELECT u.roll_no, u.name, t.name trade_name, a.status, a.marked_at, a.source, a.distance_m, a.note
    FROM users u JOIN trades t ON t.id=u.trade_id
    LEFT JOIN attendance a ON a.trainee_id=u.id AND a.date=?
    WHERE u.role='trainee' AND u.is_active=1 AND u.trade_id IN (${ph})
    ORDER BY t.name, u.roll_no, u.name`).all(date, ...tradeIds);
  const data = rows.map(r => [r.roll_no || '-', r.name, r.trade_name, STATUS_LABEL[r.status] || 'Not Marked', r.marked_at || '-', r.source || '-', r.distance_m != null ? `${r.distance_m} m` : '-', r.note || '']);
  const headers = ['Roll No', 'Name', 'Trade', 'Status', 'Marked At', 'Source', 'Distance', 'Remarks'];
  const s = getSettings();
  const subtitle = `${s.org_name} | Daily Attendance — ${date}`;
  if (send(res, req.query.format, `daily-attendance-${date}`, headers, data, 'Daily Attendance Report', subtitle, `Generated ${new Date().toLocaleString('en-IN')} | Window ${s.attendance_start}-${s.attendance_end}`)) return;
  const summary = { present: 0, absent: 0, cl: 0, ml: 0, half_day: 0, not_marked: 0 };
  for (const r of rows) summary[r.status || 'not_marked'] = (summary[r.status || 'not_marked'] || 0) + 1;
  res.json({ date, rows, summary });
});

// ---------- Monthly attendance report ----------
function monthlyData(month, tradeIds) {
  const { from, to } = monthBounds(month);
  const ph = tradeIds.map(() => '?').join(',') || '-1';
  const trainees = db.prepare(`SELECT u.id, u.roll_no, u.name, t.name trade_name FROM users u JOIN trades t ON t.id=u.trade_id
    WHERE u.role='trainee' AND u.is_active=1 AND u.trade_id IN (${ph}) ORDER BY t.name, u.roll_no, u.name`).all(...tradeIds);
  const dates = rangeDates(from, to).filter(d => new Date(d + 'T00:00:00Z').getUTCDay() !== 0); // exclude Sundays
  const perTrainee = [];
  for (const t of trainees) {
    const recs = db.prepare('SELECT date, status FROM attendance WHERE trainee_id=? AND date BETWEEN ? AND ?').all(t.id, from, to);
    const map = Object.fromEntries(recs.map(r => [r.date, r.status]));
    const p = attendancePct(recs);
    const counts = { present: 0, absent: 0, cl: 0, ml: 0, half_day: 0, none: 0 };
    for (const d of dates) counts[map[d] || 'none']++;
    perTrainee.push({ ...t, ...counts, pct: p.pct });
  }
  return { from, to, dates: dates.length, rows: perTrainee };
}

router.get('/monthly', (req, res) => {
  const d = new Date();
  const month = req.query.month || `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const tradeIds = tradeFilter(req);
  const { from, to, dates, rows } = monthlyData(month, tradeIds);
  const data = rows.map(r => [r.roll_no || '-', r.name, r.trade_name, r.present, r.absent, r.cl, r.ml, r.half_day, r.none, `${r.pct}%`]);
  const headers = ['Roll No', 'Name', 'Trade', 'Present', 'Absent', 'CL', 'ML', 'Half Day', 'Not Marked', 'Attendance %'];
  const s = getSettings();
  const workingDays = getSettingNum('working_days_per_month', 26);
  const subtitle = `${s.org_name} | Monthly Attendance — ${month} (${dates} working days recorded, ${workingDays} working days/month configured)`;
  if (send(res, req.query.format, `monthly-attendance-${month}`, headers, data, 'Monthly Attendance Report', subtitle, `Generated ${new Date().toLocaleString('en-IN')}`)) return;
  res.json({ month, from, to, working_days: dates, rows });
});

// ---------- Attendance percentage report ----------
router.get('/percentage', (req, res) => {
  const today = todayStr();
  let from = req.query.from || '', to = req.query.to || today;
  if (from) requireDate(from, 'from');
  requireDate(to, 'to');
  const tradeIds = tradeFilter(req);
  const threshold = Number(req.query.threshold) || getSettingNum('warning_threshold_pct', 80);
  const ph = tradeIds.map(() => '?').join(',') || '-1';
  const trainees = db.prepare(`SELECT u.id, u.roll_no, u.name, t.name trade_name FROM users u JOIN trades t ON t.id=u.trade_id
    WHERE u.role='trainee' AND u.is_active=1 AND u.trade_id IN (${ph}) ORDER BY t.name, u.roll_no, u.name`).all(...tradeIds);
  const rows = [];
  for (const t of trainees) {
    let sql = 'SELECT status FROM attendance WHERE trainee_id=?';
    const args = [t.id];
    if (from) { sql += ' AND date>=?'; args.push(from); }
    if (to) { sql += ' AND date<=?'; args.push(to); }
    const p = attendancePct(db.prepare(sql).all(...args));
    rows.push({ ...t, ...p, below: p.working > 0 && p.pct < threshold });
  }
  const data = rows.map(r => [r.roll_no || '-', r.name, r.trade_name, r.working, round(r.earned), r.leaves, `${r.pct}%`, r.below ? 'BELOW THRESHOLD' : 'OK']);
  const headers = ['Roll No', 'Name', 'Trade', 'Working Days', 'Earned Days', 'Approved Leaves', 'Attendance %', 'Status'];
  const s = getSettings();
  const subtitle = `${s.org_name} | Attendance Percentage (${from || 'start'} to ${to}) — threshold ${threshold}%`;
  if (send(res, req.query.format, `attendance-percentage-${to}`, headers, data, 'Attendance Percentage Report', subtitle, `Generated ${new Date().toLocaleString('en-IN')}`)) return;
  res.json({ threshold, rows, below_count: rows.filter(r => r.below).length });
});

// ---------- Trainee list by session ----------
router.get('/trainees', (req, res) => {
  const tradeIds = tradeFilter(req);
  const ph = tradeIds.map(() => '?').join(',') || '-1';
  let sql = `SELECT u.name, u.roll_no, u.username, u.mobile, u.email, u.gender, u.guardian, u.is_active,
      t.name trade_name, s.name session_name, u.created_at
    FROM users u JOIN trades t ON t.id=u.trade_id LEFT JOIN academic_sessions s ON s.id=u.session_id
    WHERE u.role='trainee' AND u.trade_id IN (${ph})`;
  const args = [...tradeIds];
  if (req.query.session_id) { sql += ' AND u.session_id=?'; args.push(Number(req.query.session_id)); }
  if (req.query.trade_id) { sql += ' AND u.trade_id=?'; args.push(Number(req.query.trade_id)); }
  if (req.query.q) { sql += ' AND (u.name LIKE ? OR u.roll_no LIKE ? OR u.username LIKE ?)'; args.push(`%${req.query.q}%`, `%${req.query.q}%`, `%${req.query.q}%`); }
  sql += ' ORDER BY s.name DESC, t.name, u.roll_no, u.name';
  const rows = db.prepare(sql).all(...args);
  const data = rows.map(r => [r.roll_no || '-', r.name, r.trade_name, r.session_name || '-', r.username, r.mobile || '-', r.email || '-', r.is_active ? 'Active' : 'Inactive']);
  const s = getSettings();
  const subtitle = `${s.org_name} | Trainee List${req.query.session_id ? ' — Session ' + (rows[0] ? rows[0].session_name : '') : ''}`;
  if (send(res, req.query.format, 'trainee-list', headers0(data), data, 'Trainee List', subtitle, `Generated ${new Date().toLocaleString('en-IN')}`)) return;
  res.json({ rows });
});
function headers0() { return ['Roll No', 'Name', 'Trade', 'Session', 'Username', 'Mobile', 'Email', 'Status']; }

// ---------- Leave register ----------
router.get('/leaves', (req, res) => {
  const tradeIds = tradeFilter(req);
  const ph = tradeIds.map(() => '?').join(',') || '-1';
  let sql = `SELECT l.*, u.name trainee_name, u.roll_no, t.name trade_name, rv.name reviewer_name
    FROM leave_requests l JOIN users u ON u.id=l.trainee_id JOIN trades t ON t.id=u.trade_id
    LEFT JOIN users rv ON rv.id=l.reviewed_by WHERE u.trade_id IN (${ph})`;
  const args = [...tradeIds];
  if (req.query.status) { sql += ' AND l.status=?'; args.push(req.query.status); }
  if (req.query.from) { sql += ' AND l.from_date>=?'; args.push(req.query.from); }
  if (req.query.to) { sql += ' AND l.to_date<=?'; args.push(req.query.to); }
  sql += ' ORDER BY l.id DESC';
  const rows = db.prepare(sql).all(...args);
  const data = rows.map(r => [r.id, r.roll_no || '-', r.trainee_name, r.trade_name, r.type, r.from_date, r.to_date, r.days, r.status.toUpperCase(), r.reviewer_name || '-', r.reason]);
  const headers = ['ID', 'Roll No', 'Trainee', 'Trade', 'Type', 'From', 'To', 'Days', 'Status', 'Reviewed By', 'Reason'];
  const s = getSettings();
  if (send(res, req.query.format, 'leave-register', headers, data, 'Leave Register', `${s.org_name} | Leave Register`, `Generated ${new Date().toLocaleString('en-IN')}`)) return;
  res.json({ rows });
});

// ---------- Inventory report ----------
function stockOf(itemId) {
  const it = db.prepare('SELECT * FROM inventory_items WHERE id=?').get(itemId);
  const SIGN = { stock_add: 1, issue: -1, return: 1, usage: -1, damage: -1 };
  let available = Number(it.opening_qty), issued = 0, used = 0, damaged = 0;
  for (const t of db.prepare('SELECT txn_type, qty FROM inventory_txn WHERE item_id=?').all(itemId)) {
    available += SIGN[t.txn_type] * t.qty;
    if (t.txn_type === 'issue') issued += t.qty;
    if (t.txn_type === 'return') issued -= t.qty;
    if (t.txn_type === 'usage') used += t.qty;
    if (t.txn_type === 'damage') damaged += t.qty;
  }
  return { ...it, available: round(available), issued: round(issued), used: round(used), damaged: round(damaged) };
}

router.get('/inventory', (req, res) => {
  const items = db.prepare('SELECT id FROM inventory_items ORDER BY name').all().map(i => stockOf(i.id));
  const data = items.map(i => [i.name, i.category || '-', i.unit, i.opening_qty, i.issued, i.used, i.damaged, i.available, i.available <= i.min_level ? 'LOW' : 'OK']);
  const headers = ['Item', 'Category', 'Unit', 'Opening', 'Issued Out', 'Used', 'Damaged', 'Available', 'Stock Status'];
  const s = getSettings();
  if (send(res, req.query.format, 'inventory-report', headers, data, 'Tools & Equipment Inventory', `${s.org_name} | Inventory Report`, `Generated ${new Date().toLocaleString('en-IN')}`)) return;
  res.json({ rows: items });
});

// ---------- Warnings register ----------
router.get('/warnings', (req, res) => {
  const tradeIds = tradeFilter(req);
  const ph = tradeIds.map(() => '?').join(',') || '-1';
  const rows = db.prepare(`SELECT w.*, u.name trainee_name, u.roll_no, t.name trade_name, i.name issued_by_name
    FROM warnings w JOIN users u ON u.id=w.trainee_id JOIN trades t ON t.id=w.trade_id
    LEFT JOIN users i ON i.id=w.issued_by WHERE w.trade_id IN (${ph}) ORDER BY w.id DESC`).all(...tradeIds);
  const data = rows.map(r => [r.id, r.roll_no || '-', r.trainee_name, r.trade_name, `${r.attendance_pct}%`, r.message, r.issued_by_name || '-', (r.created_at || '').slice(0, 10)]);
  const headers = ['ID', 'Roll No', 'Trainee', 'Trade', 'Attendance %', 'Warning', 'Issued By', 'Date'];
  const s = getSettings();
  if (send(res, req.query.format, 'warnings-register', headers, data, 'Attendance Warnings Register', `${s.org_name} | Warnings`, `Generated ${new Date().toLocaleString('en-IN')}`)) return;
  res.json({ rows });
});

module.exports = router;
