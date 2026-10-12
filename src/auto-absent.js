'use strict';
const { db, getSetting, audit } = require('./db');
const { todayStr } = require('./util');

// Marks trainees absent automatically for dates whose attendance window has closed
// and no attendance record exists. Skips Sundays. Controlled by auto_absent_enabled.
function sweepAutoAbsent() {
  const enabled = getSetting('auto_absent_enabled', '1') === '1';
  if (!enabled) return 0;
  const end = getSetting('attendance_end', '10:00');
  const now = new Date();
  const today = todayStr(now);
  const nowHM = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
  const windowClosed = nowHM >= end;

  // look back 14 days to catch missed days
  const dates = [];
  for (let i = 14; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    if (d.getDay() === 0) continue; // Sunday: no auto-absent
    const ds = todayStr(d);
    if (ds === today && !windowClosed) continue;
    dates.push(ds);
  }
  if (!dates.length) return 0;

  const trainees = db.prepare("SELECT id FROM users WHERE role='trainee' AND is_active=1").all();
  if (!trainees.length) return 0;

  const hasRec = db.prepare('SELECT 1 x FROM attendance WHERE trainee_id=? AND date=?');
  const ins = db.prepare("INSERT OR IGNORE INTO attendance (trainee_id, date, status, source, note) VALUES (?,?, 'absent', 'system', 'Auto-marked: not recorded within attendance window')");
  let n = 0;
  const tx = db.begin ? db.begin() : null;
  try {
    for (const t of trainees) {
      for (const d of dates) {
        if (!hasRec.get(t.id, d)) { const r = ins.run(t.id, d); if (r.changes) n++; }
      }
    }
    if (tx) tx.commit();
  } catch (e) { if (tx) tx.rollback(); console.error('auto-absent', e.message); }
  if (n > 0) audit(null, 'AUTO_ABSENT', 'attendance', '', { count: n }, '');
  return n;
}

module.exports = { sweepAutoAbsent };
