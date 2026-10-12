'use strict';
// Demo data seeder: officer + trainees + attendance history + leave/inventory/paper samples.
const { db, audit } = require('../src/db');
const { hashPassword } = require('../src/auth-crypto');
const { todayStr } = require('../src/util');

function pw(p) { const { salt, hash } = hashPassword(p); return `${salt}:${hash}`; }
function activeSession() { return db.prepare('SELECT * FROM academic_sessions WHERE is_active=1 ORDER BY id DESC LIMIT 1').get(); }
function round2(x) { return Math.round(x * 100) / 100; }

if (db.prepare("SELECT COUNT(*) n FROM users WHERE role='officer'").get().n > 0) {
  console.log('Demo data already present — skipping.');
  process.exit(0);
}

const sess = activeSession();
const fit = db.prepare("SELECT id FROM trades WHERE code='FIT'").get().id;
const ele = db.prepare("SELECT id FROM trades WHERE code='ELE'").get().id;

const off = db.prepare(`INSERT INTO users (role,name,username,password,email,mobile,is_active) VALUES ('officer',?,?,?,?,?,1)`)
  .run('Rahul Verma', 'rverma', pw('Officer@123'), 'rahul.verma@iti.cg.gov.in', '9425000002');
db.prepare('INSERT INTO officer_trades (officer_id, trade_id) VALUES (?,?)').run(off.lastInsertRowid, fit);
db.prepare('INSERT INTO officer_trades (officer_id, trade_id) VALUES (?,?)').run(off.lastInsertRowid, ele);

const trainees = [
  ['Ramesh Kumar', 'trainee1', fit, 'F-2025-001', '9876500001', 'Male', 'Shri Lal Kumar'],
  ['Suresh Yadav', 'trainee2', fit, 'F-2025-002', '9876500002', 'Male', 'Shri Ram Yadav'],
  ['Priya Sahu', 'trainee3', fit, 'F-2025-003', '9876500003', 'Female', 'Shri Mohan Sahu'],
  ['Anil Gupta', 'trainee4', fit, 'F-2025-004', '9876500004', 'Male', 'Shri Deepak Gupta'],
  ['Vivek Ekka', 'trainee5', ele, 'E-2025-001', '9876500005', 'Male', 'Shri Sunil Ekka'],
  ['Kavita Patel', 'trainee6', ele, 'E-2025-002', '9876500006', 'Female', 'Shri Ramesh Patel'],
  ['Manoj Rathore', 'trainee7', ele, 'E-2025-003', '9876500007', 'Male', 'Shri Devi Rathore']
];
const ids = [];
for (const [name, uname, trade, roll, mobile, gender, guardian] of trainees) {
  const r = db.prepare(`INSERT INTO users (role,name,username,password,mobile,trade_id,session_id,roll_no,gender,guardian,is_active)
    VALUES ('trainee',?,?,?,?,?,?,?,?,?,1)`).run(name, uname, pw('Trainee@123'), mobile, trade, sess.id, roll, gender, guardian);
  ids.push({ id: r.lastInsertRowid, name, uname });
}

const ins = db.prepare(`INSERT OR IGNORE INTO attendance (trainee_id, date, status, source, marked_at, note) VALUES (?,?,?,?,datetime('now','localtime'),?)`);
let n = 0;
for (let i = 24; i >= 1; i--) {
  const d = new Date(); d.setDate(d.getDate() - i);
  if (d.getDay() === 0) continue;
  const ds = todayStr(d);
  ids.forEach((t, idx) => {
    let status = 'present';
    const absentDays = t.uname === 'trainee2' ? [0, 1, 2, 3, 5, 7, 9] : t.uname === 'trainee7' ? [2, 4, 6, 8] : [3];
    if (absentDays.includes(i % 11)) status = 'absent';
    else if (i === 6 && idx === 2) status = 'cl';
    else if (i === 9 && idx === 4) status = 'ml';
    else if (i === 4 && idx === 0) status = 'half_day';
    ins.run(t.id, ds, status, status === 'absent' ? 'system' : 'officer', status === 'absent' ? 'Auto-marked' : 'Demo seed');
    n++;
  });
}
ids.forEach((t, idx) => {
  const st = idx === 3 ? 'cl' : 'present';
  ins.run(t.id, todayStr(), st, st === 'cl' ? 'leave' : 'officer', st === 'cl' ? 'CL approved' : 'Demo seed');
  n++;
});

const t3 = ids[2].id, t5 = ids[4].id;
const plus = (d) => { const x = new Date(); x.setDate(x.getDate() + d); return todayStr(x); };
db.prepare(`INSERT INTO leave_requests (trainee_id,type,from_date,to_date,days,reason,status,reviewed_by,reviewed_at) VALUES (?,?,?,?,?,?,'approved',?,datetime('now','-2 day'))`)
  .run(t3, 'CL', plus(-6), plus(-6), 1, 'Family function', off.lastInsertRowid);
db.prepare(`INSERT INTO leave_requests (trainee_id,type,from_date,to_date,days,reason,status) VALUES (?,?,?,?,?,'Fever and doctor advice','pending')`)
  .run(t5, 'ML', plus(1), plus(2), 2);
db.prepare(`INSERT INTO leave_requests (trainee_id,type,from_date,to_date,days,reason,status) VALUES (?,?,?,?,?,'Marriage in family','pending')`)
  .run(ids[6].id, 'CL', plus(3), plus(5), 3);

const p2 = db.prepare('SELECT status FROM attendance WHERE trainee_id=?').all(ids[1].id);
let earned = 0, working = 0;
for (const r of p2) { working++; if (r.status === 'present') earned++; else if (r.status === 'half_day') earned += 0.5; }
db.prepare('INSERT INTO warnings (trainee_id,trade_id,issued_by,message,attendance_pct,period) VALUES (?,?,?,?,?,?)')
  .run(ids[1].id, fit, off.lastInsertRowid, 'Your attendance is below 80%. Improve immediately or your session may be detained.', round2(earned * 100 / working), 'Last 30 days');

const items = [
  ['Spanner Set 8-24mm', 'Hand Tools', 'set', 10, 2, 450],
  ['Testing Lamp', 'Electrical Tools', 'pcs', 8, 2, 120],
  ['Welding Rod E6013 (3.15mm)', 'Consumable', 'kg', 50, 10, 95],
  ['Insulation Tape', 'Consumable', 'pcs', 40, 10, 15],
  ['Digital Multimeter', 'Electrical Tools', 'pcs', 6, 1, 850],
  ['Safety Gloves', 'PPE', 'pair', 30, 5, 60],
  ['Grinding Disc 4"', 'Consumable', 'pcs', 25, 5, 25]
];
for (const [name, category, unit, opening, minl, rate] of items) {
  db.prepare('INSERT INTO inventory_items (name,category,unit,opening_qty,min_level,rate) VALUES (?,?,?,?,?,?)').run(name, category, unit, opening, minl, rate);
}
db.prepare("INSERT INTO inventory_txn (item_id,txn_type,qty,trade_id,remarks,created_by) VALUES (3,'usage',5,?,'Workshop practice',?)").run(fit, off.lastInsertRowid);
db.prepare("INSERT INTO inventory_txn (item_id,txn_type,qty,trade_id,remarks,created_by) VALUES (4,'issue',6,?,'Issued to trainees',?)").run(ele, off.lastInsertRowid);

db.prepare("INSERT INTO indent_registers (trade_id,indenter_id,register_date,items,status) VALUES (?,?,?,?,'pending')")
  .run(fit, off.lastInsertRowid, todayStr(), JSON.stringify([{ item_id: 1, qty: 2 }, { item_id: 6, qty: 10 }]));

db.prepare(`INSERT INTO question_papers (trade_id,title,subject,session_name,duration_min,total_marks,paper_data,created_by) VALUES (?,?,?,?,?,?,?,?)`)
  .run(fit, 'Fitter Theory - Unit Test 1', 'Workshop Technology & Science', '2025-26', 120, 20,
    JSON.stringify({ questions: [
      { text: 'Define measuring instrument. Give two examples.', marks: 4 },
      { text: 'Explain the use of a vernier caliper with a neat diagram.', marks: 6 },
      { text: 'What is the importance of safety in a workshop? List any four safety rules.', marks: 6 },
      { text: 'Differentiate between mild steel and cast iron.', marks: 4 }
    ] }), off.lastInsertRowid);

audit({ id: 1, role: 'admin' }, 'SEED_DEMO', 'system', '', { trainees: ids.length, attendance: n }, '');
console.log(`Seeded: 1 officer, ${ids.length} trainees, ${n} attendance records, leave/warnings/inventory/indent/paper samples.`);
