'use strict';
const express = require('express');
const { db, audit, attendancePct, getSetting, getSettingNum, getSettings } = require('../db');
const { bad, requireFields, requireDate, isDate, rangeDates, todayStr, nowHHMM, monthBounds, haversineMeters, round } = require('../util');

const router = express.Router();
const LEAVE_TYPES = ['CL', 'ML', 'HALF_DAY'];

function requireOwnTrainee(req) {
  const t = db.prepare("SELECT * FROM users WHERE id=? AND role='trainee'").get(req.user.id);
  if (!t) throw bad('Profile not found.', 404);
  return t;
}

// ---------- Profile / dashboard ----------
router.get('/me', (req, res) => {
  const me = requireOwnTrainee(req);
  const t = db.prepare('SELECT id, name, code FROM trades WHERE id=?').get(me.trade_id);
  const s = db.prepare('SELECT id, name, start_date, end_date FROM academic_sessions WHERE id=?').get(me.session_id);
  const stats = attendancePct(db.prepare('SELECT status FROM attendance WHERE trainee_id=?').all(me.id));
  res.json({
    profile: { id: me.id, name: me.name, username: me.username, roll_no: me.roll_no, email: me.email, mobile: me.mobile, gender: me.gender, guardian: me.guardian, trade: t, session: s },
    stats,
    settings: {
      attendance_start: getSetting('attendance_start'), attendance_end: getSetting('attendance_end'),
      warning_threshold_pct: getSettingNum('warning_threshold_pct', 80),
      working_days_per_month: getSettingNum('working_days_per_month', 26)
    }
  });
});

router.get('/dashboard', (req, res) => {
  const today = todayStr();
  const all = db.prepare('SELECT date, status, marked_at, distance_m, source FROM attendance WHERE trainee_id=? ORDER BY date DESC LIMIT 180').all(req.user.id);
  const todayRec = all.find(a => a.date === today) || null;
  const s = getSettings();

  // last 14 days chart
  const chart = [];
  for (let i = 13; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const ds = todayStr(d);
    const rec = all.find(a => a.date === ds);
    chart.push({ date: ds, status: rec ? rec.status : 'none' });
  }
  // monthly trend: pct per month for last 6 months
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - i);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const recs = all.filter(a => a.date.startsWith(ym));
    const p = attendancePct(recs);
    months.push({ month: ym, pct: p.pct, working: p.working });
  }
  const pending = db.prepare("SELECT COUNT(*) n FROM leave_requests WHERE trainee_id=? AND status='pending'").get(req.user.id).n;
  const approved = db.prepare("SELECT COUNT(*) n FROM leave_requests WHERE trainee_id=? AND status='approved'").get(req.user.id).n;
  const warnings = db.prepare('SELECT COUNT(*) n FROM warnings WHERE trainee_id=?').get(req.user.id).n;
  const stats = attendancePct(all);
  const leaveBalances = leaveBalance(req.user.id);
  res.json({
    today: todayRec, chart, months, stats, pending_leaves: pending, approved_leaves: approved,
    warnings, leave_balances: leaveBalances,
    window: { start: s.attendance_start, end: s.attendance_end },
    campus: { name: s.campus_name, lat: Number(s.campus_lat), lng: Number(s.campus_lng), radius_m: Number(s.campus_radius_m) },
    can_mark: withinWindow() && (!todayRec || todayRec.status === 'absent'),
    already_marked: !!(todayRec && todayRec.status !== 'absent')
  });
});

function withinWindow(now = new Date()) {
  const start = getSetting('attendance_start', '07:00');
  const end = getSetting('attendance_end', '10:00');
  const hm = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  return hm >= start && hm <= end;
}

// ---------- GPS attendance marking ----------
router.post('/attendance', (req, res) => {
  const b = req.body || {};
  const today = todayStr();
  const date = b.date ? requireDate(b.date, 'date') : today;
  if (date !== today) throw bad('Attendance can only be marked for today.');

  const start = getSetting('attendance_start', '07:00');
  const end = getSetting('attendance_end', '10:00');
  const hm = nowHHMM();
  if (hm < start || hm > end) {
    throw bad(`Attendance window is ${start} to ${end}. Current time ${hm}. Contact your training officer for authorized correction.`, 403);
  }
  const existing = db.prepare('SELECT * FROM attendance WHERE trainee_id=? AND date=?').get(req.user.id, date);
  if (existing && existing.status !== 'absent') {
    return res.status(409).json({ error: 'Attendance already marked today.', record: existing });
  }

  const lat = Number(b.lat), lng = Number(b.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw bad('Location (lat/lng) is required for geotag verification.');
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) throw bad('Invalid coordinates.');

  const campusLat = Number(getSetting('campus_lat', '0'));
  const campusLng = Number(getSetting('campus_lng', '0'));
  const radius = getSettingNum('campus_radius_m', 250);
  const distance = round(haversineMeters(lat, lng, campusLat, campusLng));
  if (distance > radius) {
    audit(req.user, 'ATTENDANCE_GEOFENCE_FAIL', 'attendance', '', { distance, radius }, req.ip);
    return res.status(403).json({
      error: `You are ${distance} m from campus; geofence allows ${radius} m. Attendance not recorded.`,
      distance, radius
    });
  }

  if (existing && existing.status === 'absent') {
    db.prepare(`UPDATE attendance SET status='present', source='self', lat=?, lng=?, distance_m=?, marked_at=datetime('now'), corrected=1, corrected_by=?, note='Marked within window by trainee' WHERE trainee_id=? AND date=?`)
      .run(lat, lng, distance, req.user.id, req.user.id, date);
    audit(req.user, 'MARK_ATTENDANCE', 'attendance', existing.id, { date, distance, self_marked: true }, req.ip);
    return res.json({ ok: true, status: 'present', distance, marked_at: new Date().toISOString() });
  }
  const r = db.prepare(`INSERT INTO attendance (trainee_id, date, status, source, lat, lng, distance_m, note) VALUES (?,?, 'present', 'self', ?, ?, ?, 'Self-marked with GPS geotag')`)
    .run(req.user.id, date, lat, lng, distance);
  audit(req.user, 'MARK_ATTENDANCE', 'attendance', r.lastInsertRowid, { date, distance }, req.ip);
  res.status(201).json({ ok: true, status: 'present', distance, id: r.lastInsertRowid });
});

// ---------- Attendance history ----------
router.get('/attendance', (req, res) => {
  const { from, to, month, format } = req.query;
  let f, t2;
  if (month) { const mb = monthBounds(month); f = mb.from; t2 = mb.to; }
  else { f = from || ''; t2 = to || ''; }
  let sql = 'SELECT id, date, status, marked_at, source, distance_m, corrected, note FROM attendance WHERE trainee_id=?';
  const args = [req.user.id];
  if (f) { sql += ' AND date >= ?'; args.push(f); }
  if (t2) { sql += ' AND date <= ?'; args.push(t2); }
  if (isDate(f) && !t2) { /* noop */ }
  sql += ' ORDER BY date DESC';
  const rows = db.prepare(sql).all(...args);
  const stats = attendancePct(rows);
  res.json({ rows, stats });
});

// ---------- Leave ----------
function leaveBalance(traineeId) {
  const y = new Date().getFullYear();
  const yearStart = `${y}-01-01`, yearEnd = `${y}-12-31`;
  const cur = (type) => db.prepare(`SELECT COALESCE(SUM(days),0) n FROM leave_requests WHERE trainee_id=? AND type=? AND status='approved' AND from_date>=? AND to_date<=?`)
    .get(traineeId, type, yearStart, yearEnd).n;
  const monthStart = todayStr().slice(0, 8) + '01';
  const monthEnd = todayStr().slice(0, 8) + '31';
  const hdMonth = db.prepare(`SELECT COUNT(*) n FROM leave_requests WHERE trainee_id=? AND type='HALF_DAY' AND status='approved' AND from_date>=? AND to_date<=?`)
    .get(traineeId, monthStart, monthEnd).n;
  return {
    cl_used: cur('CL'), cl_limit: getSettingNum('cl_year_limit', 12),
    ml_used: cur('ML'), ml_limit: getSettingNum('ml_year_limit', 10),
    hd_used: hdMonth, hd_limit: getSettingNum('half_day_month_limit', 4)
  };
}

router.get('/leave', (req, res) => {
  const rows = db.prepare(`SELECT l.*, rv.name reviewer_name FROM leave_requests l LEFT JOIN users rv ON rv.id=l.reviewed_by
    WHERE l.trainee_id=? ORDER BY l.id DESC`).all(req.user.id);
  res.json({ rows, balances: leaveBalance(req.user.id) });
});

router.post('/leave', (req, res) => {
  const b = req.body || {};
  requireFields(b, ['type', 'from_date', 'to_date', 'reason']);
  if (!LEAVE_TYPES.includes(b.type)) throw bad('Leave type must be CL, ML or HALF_DAY.');
  requireDate(b.from_date, 'from_date');
  requireDate(b.to_date, 'to_date');
  if (b.to_date < b.from_date) throw bad('To date must be on or after from date.');
  if (String(b.reason).trim().length < 5) throw bad('Please provide a reason (at least 5 characters).');
  const dates = rangeDates(b.from_date, b.to_date);
  if (!dates.length || dates.length > 60) throw bad('Leave range must be 1–60 days.');
  if (b.type === 'HALF_DAY' && dates.length > 1) throw bad('Half-day leave can only be for a single day.');
  const today = todayStr();
  if (dates[0] > today && dates[dates.length - 1] < today) throw bad('Leave range cannot be entirely in the past.');
  if (dates[dates.length - 1] < today) throw bad('Leave dates cannot be entirely in the past.');

  // overlapping request check
  const overlap = db.prepare(`SELECT 1 x FROM leave_requests WHERE trainee_id=? AND status IN ('pending','approved')
    AND NOT (to_date < ? OR from_date > ?)`).get(req.user.id, b.from_date, b.to_date);
  if (overlap) throw bad('A leave request already exists for these dates.');

  const days = b.type === 'HALF_DAY' ? 0.5 : dates.length;
  const bal = leaveBalance(req.user.id);
  if (b.type === 'CL' && bal.cl_used + days > bal.cl_limit) throw bad(`CL limit exceeded: ${bal.cl_used} of ${bal.cl_limit} days already used this year.`);
  if (b.type === 'ML' && bal.ml_used + days > bal.ml_limit) throw bad(`Medical leave limit exceeded: ${bal.ml_used} of ${bal.ml_limit} days already used this year.`);
  if (b.type === 'HALF_DAY' && bal.hd_used + 1 > bal.hd_limit) throw bad(`Half-day limit exceeded: ${bal.hd_used} of ${bal.hd_limit} used this month.`);

  const r = db.prepare('INSERT INTO leave_requests (trainee_id, type, from_date, to_date, days, reason) VALUES (?,?,?,?,?,?)')
    .run(req.user.id, b.type, b.from_date, b.to_date, days, String(b.reason).trim());
  audit(req.user, 'APPLY_LEAVE', 'leave_request', r.lastInsertRowid, { type: b.type, from: b.from_date, to: b.to_date }, req.ip);
  res.status(201).json({ id: r.lastInsertRowid, status: 'pending', days });
});

router.delete('/leave/:id', (req, res) => {
  const l = db.prepare('SELECT * FROM leave_requests WHERE id=? AND trainee_id=?').get(req.params.id, req.user.id);
  if (!l) throw bad('Leave request not found.', 404);
  if (l.status !== 'pending') throw bad('Only pending requests can be cancelled.');
  db.prepare('DELETE FROM leave_requests WHERE id=?').run(l.id);
  audit(req.user, 'CANCEL_LEAVE', 'leave_request', l.id, {}, req.ip);
  res.json({ ok: true });
});

// ---------- Warnings ----------
router.get('/warnings', (req, res) => {
  res.json(db.prepare(`SELECT w.*, i.name issued_by_name FROM warnings w LEFT JOIN users i ON i.id=w.issued_by
    WHERE w.trainee_id=? ORDER BY w.id DESC`).all(req.user.id));
});

module.exports = router;
