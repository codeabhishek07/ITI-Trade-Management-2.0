'use strict';
const path = require('node:path');
const express = require('express');
const { db, getSettings, getSettingNum, audit } = require('./src/db');
const { login, logout, requireLogin, requireRole, changePassword, getUser } = require('./src/auth');
const { todayStr, nowHHMM, bad } = require('./src/util');
const adminRoutes = require('./src/routes/admin');
const officerRoutes = require('./src/routes/officer');
const traineeRoutes = require('./src/routes/trainee');
const reportRoutes = require('./src/routes/reports');
const { sweepAutoAbsent } = require('./src/auto-absent');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

// ---- Auth endpoints -------------------------------------------------------
app.post('/api/login', login);
app.post('/api/logout', logout);
app.get('/api/me', (req, res) => {
  const u = getUser(req);
  if (!u) return res.status(401).json({ error: 'Authentication required.' });
  res.json({ user: { id: u.id, role: u.role, name: u.name, username: u.username, email: u.email, mobile: u.mobile, must_change_password: u.must_change_password, trade_ids: u.trade_ids } });
});
app.post('/api/change-password', requireLogin, changePassword);

// Public settings needed by login page / GPS check (no secrets here)
app.get('/api/public/settings', (req, res) => {
  const s = getSettings();
  res.json({
    org_name: s.org_name, org_state: s.org_state, campus_name: s.campus_name,
    campus_lat: Number(s.campus_lat), campus_lng: Number(s.campus_lng),
    campus_radius_m: Number(s.campus_radius_m),
    attendance_start: s.attendance_start, attendance_end: s.attendance_end
  });
});

// ---- Role routers ---------------------------------------------------------
app.use('/api/admin', requireLogin, requireRole('admin'), adminRoutes);
app.use('/api/officer', requireLogin, requireRole('officer'), officerRoutes);
app.use('/api/trainee', requireLogin, requireRole('trainee'), traineeRoutes);
app.use('/api/reports', requireLogin, requireRole('admin', 'officer'), reportRoutes);

// ---- Static + SPA fallback ------------------------------------------------
const PUBLIC = path.join(__dirname, 'public');
app.use(express.static(PUBLIC, { index: 'index.html', maxAge: '1h',
  setHeaders: (res, filePath) => { if (/\.(js|css|html)$/.test(filePath)) res.setHeader('Cache-Control', 'no-cache'); } }));
app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(PUBLIC, 'index.html')));

// ---- Errors ---------------------------------------------------------------
app.use((req, res) => res.status(404).json({ error: 'Not found.' }));
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Server error.' });
});

// ---- Auto-absent sweep ----------------------------------------------------
sweepAutoAbsent();
const sweepTimer = setInterval(() => {
  try { sweepAutoAbsent(); } catch (e) { console.error('sweep failed', e.message); }
}, 60 * 1000);
sweepTimer.unref();

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log(`ITI Trade Management running on http://0.0.0.0:${PORT}`));
