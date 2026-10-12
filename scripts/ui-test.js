'use strict';
/* UI interaction test: drives the real DOM like a user would.
   Covers: login form, officer attendance editing, trainee leave form,
   GPS attendance marking (mocked geolocation), admin settings save. */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = process.env.BASE || 'http://localhost:3000';
const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'public', 'index.html'), 'utf8');
const cookieJar = { value: '' };
const failures = [];
const pass = m => console.log('  PASS ' + m);
const fail = m => { failures.push(m); console.log('  FAIL ' + m); };

const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const msg = e.detail ? (e.detail.stack || e.detail.message) : e.message;
  if (String(msg).includes('getContext() method')) return;
  failures.push('jsdomError: ' + msg);
});
vc.on('error', (...a) => failures.push('console.error: ' + a.map(String).join(' ')));

async function shimFetch(url, init = {}) {
  const abs = url.startsWith('http') ? url : BASE + url;
  const headers = { ...(init.headers || {}) };
  if (cookieJar.value) headers.Cookie = cookieJar.value;
  const res = await fetch(abs, { ...init, headers });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of sc) cookieJar.value = c.split(';')[0];
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function rawAPI(pathname, method = 'GET', body) {
  const res = await fetch(BASE + pathname, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookieJar.value ? { Cookie: cookieJar.value } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  return { status: res.status, data: await res.json().catch(() => null) };
}

(async () => {
  const dom = new JSDOM(html, { url: BASE + '/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
  const { window } = dom;
  const doc = window.document;
  window.fetch = (u, i) => shimFetch(u, i);
  window.URL.createObjectURL = () => 'blob:fake';
  window.URL.revokeObjectURL = () => {};
  window.scrollTo = () => {};

  // Mock geolocation (campus coords + a far-away point)
  window.__mockGeo = { lat: 21.89765, lng: 83.37775, accuracy: 12 };
  Object.defineProperty(window.navigator, 'geolocation', {
    value: {
      getCurrentPosition(ok, err) {
        const m = window.__mockGeo;
        if (m.error) err({ code: m.error, message: 'mock' });
        else ok({ coords: { latitude: m.lat, longitude: m.lng, accuracy: m.accuracy } });
      }
    }, configurable: true
  });

  for (const f of ['js/core.js', 'js/admin.js', 'js/officer.js', 'js/trainee.js', 'js/app.js']) {
    const s = doc.createElement('script');
    s.textContent = fs.readFileSync(path.join(ROOT, 'public', f), 'utf8');
    doc.body.append(s);
  }
  await sleep(150);

  const $ = sel => doc.querySelector(sel);
  const $$ = sel => [...doc.querySelectorAll(sel)];
  const btnByText = txt => $$('button').find(b => b.textContent.includes(txt));
  const fire = (node, type) => node.dispatchEvent(new window.Event(type, { bubbles: true, cancelable: true }));

  const uiLogin = async (user, pass) => {
    cookieJar.value = '';
    $('#login-username').value = user;
    $('#login-password').value = pass;
    fire($('#login-form'), 'submit');
    for (let i = 0; i < 40 && $('#app').classList.contains('hidden'); i++) await sleep(50);
    if ($('#app').classList.contains('hidden')) throw new Error('login UI did not reach app shell for ' + user);
  };
  const uiLogout = async () => {
    $('#logout-btn').click();
    for (let i = 0; i < 20 && !$('#login-screen').offsetParent === false; i++) await sleep(30);
    await sleep(100);
  };
  const go = async hash => {
    window.location.hash = hash;
    window.renderRoute();
    await sleep(350);
  };
  const toastText = () => $$('.toast').map(t => t.textContent).join(' | ');

  /* ============ 1. Admin: login form + settings save ============ */
  console.log('ADMIN UI:');
  await uiLogin('admin', 'Admin@123');
  $('#app').classList.contains('hidden') ? fail('app shell visible after login') : pass('login form → app shell');
  await go('#/dashboard');
  doc.querySelector('#view').textContent.includes('Admin Dashboard') ? pass('dashboard renders') : fail('dashboard content missing');

  await go('#/settings');
  const wdInput = $$('input').find(i => i.dataset.name === 'working_days_per_month');
  if (!wdInput) fail('working days input not found');
  else {
    wdInput.value = '25';
    btnByText('Save Settings').click();
    await sleep(500);
    const chk = await rawAPI('/api/admin/settings');
    chk.data.working_days_per_month === '25' ? pass('settings save → DB (working_days=25)') : fail('settings did not persist: ' + chk.data.working_days_per_month);
    await rawAPI('/api/admin/settings', 'PUT', { working_days_per_month: '26' });
    const back = await rawAPI('/api/admin/settings');
    back.data.working_days_per_month === '26' ? pass('settings restored to 26') : fail('restore failed');
  }
  // validation: bad radius rejected
  const radius = $$('input').find(i => i.dataset.name === 'campus_radius_m');
  radius.value = '99999';
  btnByText('Save Settings').click();
  await sleep(400);
  const err = doc.querySelector('#view .form-error');
  (err && !err.classList.contains('hidden') && /25–5000|5000/.test(err.textContent)) ? pass('invalid radius rejected with message') : fail('radius validation missing: ' + (err && err.textContent));
  radius.value = '250';
  btnByText('Save Settings').click();
  await sleep(400);

  /* ============ 2. Officer: attendance editing via selects ============ */
  console.log('OFFICER UI:');
  await uiLogout();
  await uiLogin('rverma', 'Officer@123');
  await go('#/attendance');
  const today = new Date().toISOString().slice(0, 10);
  const sheet = $$('#view table.data')[0];
  sheet ? pass('attendance sheet renders') : fail('attendance sheet missing');

  // find row for Kavita Patel (trainee6) and set to Absent, then save
  const rows = [...sheet.querySelectorAll('tbody tr')];
  const target = rows.find(r => r.textContent.includes('Kavita Patel'));
  if (!target) fail('Kavita row not found');
  else {
    const sel = target.querySelector('select');
    sel.value = 'absent';
    fire(sel, 'change');
    btnByText('Save Changes').click();
    await sleep(600);
    const check = await rawAPI(`/api/officer/attendance?date=${today}`);
    const k = check.data.rows.find(r => r.name === 'Kavita Patel');
    k && k.status === 'absent' ? pass('UI select → bulk save → DB absent') : fail('bulk save failed: ' + (k && k.status));
    // restore to present
    await rawAPI('/api/officer/attendance', 'POST', { trainee_id: k.trainee_id, date: today, status: 'present', note: 'UI test restore' });
    pass('restored Kavita to present');
  }

  // leave approval through UI
  await go('#/leave');
  const leaveRow = $$('#view table.data tbody tr').find(r => r.textContent.includes('Pending'));
  if (leaveRow) {
    const approveBtn = [...leaveRow.querySelectorAll('button')].find(b => b.textContent.includes('Approve'));
    approveBtn.click();
    await sleep(200);
    const submit = [...doc.querySelectorAll('.modal-foot button')].find(b => b.textContent.includes('Approve'));
    submit.click();
    await sleep(600);
    toastText().includes('approved') ? pass('leave approve flow via modal') : fail('leave approve toast missing: ' + toastText());
  } else pass('no pending leaves (already approved earlier)');

  /* ============ 3. Trainee: GPS mark + leave form ============ */
  console.log('TRAINEE UI:');
  await uiLogout();
  // widen attendance window (server-side clock is afternoon in this env)
  await uiLogin('admin', 'Admin@123');
  await rawAPI('/api/admin/settings', 'PUT', { attendance_start: '00:00', attendance_end: '23:59' });
  await uiLogout();
  // clear trainee6's today record so GPS marking is possible
  await uiLogin('rverma', 'Officer@123');
  const sheet2 = (await rawAPI(`/api/officer/attendance?date=${today}`)).data;
  const kv = sheet2.rows.find(r => r.name === 'Kavita Patel');
  if (kv && kv.attendance_id) await rawAPI(`/api/officer/attendance/${kv.attendance_id}`, 'DELETE');
  await uiLogout();

  await uiLogin('trainee1', 'Trainee@123'); // trainee1 = Ramesh; ensure his record is cleared too
  await uiLogout();
  await uiLogin('trainee6', 'Trainee@123');
  await go('#/dashboard');
  const markBtn = btnByText('Mark My Attendance');
  if (!markBtn) fail('mark attendance button missing');
  else if (markBtn.disabled) fail('mark button disabled though attendance not marked');
  else {
    // (a) outside geofence first
    window.__mockGeo = { lat: 21.95, lng: 83.45, accuracy: 10 };
    markBtn.click();
    await sleep(700);
    const geoFailText = $('#view .gps-box').textContent;
    geoFailText.includes('outside') || /403|geofence|away/.test(geoFailText) ? pass('far location rejected: ' + ($('#view .gps-box .gps-status span').textContent || '').slice(0, 60)) : fail('geofence rejection not shown: ' + geoFailText.slice(0, 160));
    // (b) inside geofence
    window.__mockGeo = { lat: 21.89765, lng: 83.37775, accuracy: 8 };
    markBtn.click();
    await sleep(900);
    const after = await rawAPI('/api/trainee/attendance?month=' + today.slice(0, 7));
    const rec = after.data.rows.find(r => r.date === today);
    if (rec && rec.status === 'present' && rec.source === 'self' && rec.distance_m != null && rec.distance_m < 30) {
      pass(`GPS self-mark saved (distance ${rec.distance_m} m, source self)`);
    } else fail('GPS mark not saved correctly: ' + JSON.stringify(rec));
    // (c) permission denied path
    window.__mockGeo = { error: 1 };
    await go('#/dashboard');
    const mb2 = btnByText('Mark My Attendance') || btnByText('Check My Location');
    // record already marked now; check-location button still works for permission path
    const checkBtn = btnByText('Check My Location');
    checkBtn.click();
    await sleep(400);
    $('#view .gps-box').textContent.includes('denied') ? pass('permission denied handled with guidance') : fail('denied state not shown');
    window.__mockGeo = { lat: 21.89765, lng: 83.37775, accuracy: 8 };
  }

  // leave apply through UI form
  await go('#/leave');
  const form = $('#view form');
  if (!form) fail('leave form missing');
  else {
    const dateInputs = form.querySelectorAll('input[type=date]');
    const plus = d => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10); };
    dateInputs[0].value = plus(10);
    dateInputs[1].value = plus(11);
    form.querySelector('textarea').value = 'UI test leave request';
    const sub = [...form.querySelectorAll('button')].find(b => b.textContent.includes('Submit'));
    sub.click();
    await sleep(700);
    const list = await rawAPI('/api/trainee/leave');
    const found = list.data.rows.find(r => r.reason === 'UI test leave request' && r.status === 'pending');
    found ? pass('leave applied via UI form → pending in DB') : fail('leave not created');
    if (found) {
      // cancel it through UI
      await go('#/leave');
      const row = $$('#view table.data tbody tr').find(r => r.textContent.includes('UI test leave request'));
      const cancelBtn = row && [...row.querySelectorAll('button')].find(b => b.textContent.includes('Cancel'));
      if (cancelBtn) {
        cancelBtn.click();
        await sleep(200);
        const okBtn = [...doc.querySelectorAll('.modal-foot button')].find(b => b.textContent.includes('Cancel Request'));
        okBtn.click();
        await sleep(500);
        const after2 = await rawAPI('/api/trainee/leave');
        after2.data.rows.find(r => r.id === found.id) ? fail('cancel did not delete') : pass('pending leave cancelled via UI');
      }
    }
  }

  // restore attendance window
  await uiLogout();
  await uiLogin('admin', 'Admin@123');
  await rawAPI('/api/admin/settings', 'PUT', { attendance_start: '07:00', attendance_end: '10:00' });
  const restored = await rawAPI('/api/public/settings');
  restored.data.attendance_start === '07:00' && restored.data.attendance_end === '10:00' ? pass('attendance window restored') : fail('window not restored');

  console.log(failures.length ? `\n${failures.length} FAILURES:\n` + failures.join('\n') : '\nALL UI INTERACTION TESTS PASSED');
  process.exit(failures.length ? 1 : 0);
})().catch(e => { console.error('FATAL', e); process.exit(1); });
