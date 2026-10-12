'use strict';
const { db, audit, getSetting } = require('./db');
const { hashPassword, verifyPassword, newToken } = require('./auth-crypto');

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const COOKIE = 'iti_session';

function parseCookies(req) {
  const out = {};
  const h = req.headers.cookie;
  if (!h) return out;
  for (const part of h.split(';')) {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function createSession(req, user) {
  const token = newToken(32);
  const expires = Date.now() + SESSION_TTL_MS;
  db.prepare('INSERT INTO sessions (token, user_id, ip, user_agent, expires_at) VALUES (?,?,?,?,?)')
    .run(token, user.id, req.ip || '', String(req.headers['user-agent'] || '').slice(0, 250), expires);
  return { token, expires };
}

function destroySession(req) {
  const token = parseCookies(req)[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  return token;
}

function setSessionCookie(res, token, expires) {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; Max-Age=${Math.floor((expires - Date.now()) / 1000)}; SameSite=Lax${secure}`);
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
}

function getUser(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const row = db.prepare(`SELECT s.token, s.expires_at, u.id, u.role, u.name, u.username, u.email, u.mobile,
      u.trade_id, u.session_id, u.is_active, u.must_change_password, u.roll_no
    FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ?`).get(token);
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  if (!row.is_active) return null;
  const user = { ...row, token };
  if (user.role === 'officer') {
    user.trade_ids = db.prepare('SELECT trade_id FROM officer_trades WHERE officer_id = ?').all(user.id).map(r => r.trade_id);
  } else if (user.role === 'trainee') {
    const t = db.prepare('SELECT trade_id FROM users WHERE id = ?').get(user.id);
    user.trade_ids = t && t.trade_id ? [t.trade_id] : [];
  } else {
    user.trade_ids = db.prepare('SELECT id FROM trades').all().map(r => r.id);
  }
  return user;
}

function login(req, res) {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username and password are required.' });
  const user = db.prepare('SELECT * FROM users WHERE lower(username) = lower(?)').get(String(username).trim());
  if (!user || !verifyPassword(password, user.password)) {
    audit(user ? { id: user.id, role: user.role } : null, 'LOGIN_FAILED', 'user', user ? user.id : '', { username }, req.ip);
    return res.status(401).json({ error: 'Invalid username or password.' });
  }
  if (!user.is_active) return res.status(403).json({ error: 'Account is deactivated. Contact the Trade Admin.' });
  const { token, expires } = createSession(req, user);
  setSessionCookie(res, token, expires);
  audit({ id: user.id, role: user.role }, 'LOGIN', 'user', user.id, { username: user.username }, req.ip);
  res.json({
    user: { id: user.id, role: user.role, name: user.name, username: user.username, must_change_password: user.must_change_password },
    next: user.must_change_password ? 'change_password' : 'dashboard'
  });
}

function logout(req, res) {
  const u = getUser(req);
  destroySession(req);
  clearSessionCookie(res);
  if (u) audit(u, 'LOGOUT', 'user', u.id, {}, req.ip);
  res.json({ ok: true });
}

function requireLogin(req, res, next) {
  const user = getUser(req);
  if (!user) return res.status(401).json({ error: 'Authentication required.' });
  req.user = user;
  next();
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.' });
    if (!roles.includes(req.user.role)) return res.status(403).json({ error: 'You do not have permission for this action.' });
    next();
  };
}

// Officer scope guard: ensures the trade belongs to the officer's assignments
function assertOfficerTrade(req, tradeId) {
  const t = Number(tradeId);
  if (!t || !req.user.trade_ids.includes(t)) {
    const err = new Error('Trade is not assigned to you.');
    err.status = 403;
    throw err;
  }
}

function changePassword(req, res) {
  const { old_password, new_password } = req.body || {};
  if (!old_password || !new_password) return res.status(400).json({ error: 'Old and new password are required.' });
  if (String(new_password).length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters.' });
  const u = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!verifyPassword(old_password, u.password)) return res.status(400).json({ error: 'Old password is incorrect.' });
  const { salt, hash } = hashPassword(new_password);
  db.prepare("UPDATE users SET password = ?, must_change_password = 0, updated_at = datetime('now') WHERE id = ?")
    .run(`${salt}:${hash}`, u.id);
  audit(req.user, 'CHANGE_PASSWORD', 'user', u.id, {}, req.ip);
  res.json({ ok: true });
}

module.exports = { login, logout, requireLogin, requireRole, getUser, setSessionCookie, clearSessionCookie, assertOfficerTrade, changePassword, COOKIE };
