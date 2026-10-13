'use strict';
/* App bootstrap: login, session, role nav, hash router */

const ROLE_LABELS = { admin: 'Trade Admin', officer: 'Training Officer', trainee: 'Trainee' };
const ROLE_HOME = { admin: '#/dashboard', officer: '#/dashboard', trainee: '#/dashboard' };

/* ---------- Login ---------- */
let loginRole = 'admin';
const ROLE_TITLES = { admin: 'Trade Admin Login', officer: 'Training Officer Login', trainee: 'Trainee Login' };

$('#role-tabs').addEventListener('click', e => {
  const btn = e.target.closest('.role-tab');
  if (!btn) return;
  loginRole = btn.dataset.role;
  $$('.role-tab').forEach(t => t.classList.toggle('active', t === btn));
  $('#login-title').textContent = ROLE_TITLES[loginRole];
});

$('#login-form').addEventListener('submit', async e => {
  e.preventDefault();
  const errBox = $('#login-error');
  errBox.classList.add('hidden');
  const btn = $('#login-btn');
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const data = await api('/api/login', {
      method: 'POST',
      body: { username: $('#login-username').value.trim(), password: $('#login-password').value }
    });
    if (data.next === 'change_password') {
      toast('You must change your password before continuing.', 'info');
      await api('/api/me').then(u => showApp(u.user));
      openChangePassword(true);
      return;
    }
    await boot();
  } catch (err) {
    errBox.textContent = err.message;
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false; btn.textContent = 'Sign In';
  }
});

/* ---------- Session / shell ---------- */
let booted = false;
async function boot() {
  if (booted && App.user) return;
  booted = true;
  try {
    const me = await api('/api/me');
    showApp(me.user);
  } catch {
    showLogin();
  }
}

function showLogin() {
  App.user = null;
  $('#app').classList.add('hidden');
  $('#login-screen').classList.remove('hidden');
}

function roleBadgeText(user) {
  if (user.role === 'trainee') {
    const t = user.trade_name || 'Trainee';
    return user.roll_no ? `${t} · Roll ${user.roll_no}` : t;
  }
  if (user.role === 'officer') {
    const trades = user.trade_names || [];
    return trades.length ? `${ROLE_LABELS.officer} · ${trades.join(', ')}` : ROLE_LABELS.officer;
  }
  return ROLE_LABELS[user.role];
}

function showApp(user) {
  App.user = user;
  $('#login-screen').classList.add('hidden');
  $('#app').classList.remove('hidden');
  $('#user-name').textContent = user.name;
  $('#user-role-badge').textContent = roleBadgeText(user);
  $('#user-role-badge').title = roleBadgeText(user);
  buildSidebar();
  const target = location.hash && location.hash !== '#' ? location.hash : ROLE_HOME[user.role];
  if (!currentRoute()) location.hash = ROLE_HOME[user.role];
  else renderRoute();
}

function buildSidebar() {
  const nav = $('#sidebar');
  nav.innerHTML = '';
  for (const r of App.routes[App.user.role]) {
    if (r.hidden) continue;
    nav.append(el('button', {
      class: 'nav-item', dataset: { path: r.path },
      onclick: () => { location.hash = r.path; $('#sidebar').classList.remove('open'); }
    }, el('span', { class: 'nav-ico' }, r.icon || '•'), r.label));
  }
}

function currentRoute() {
  const hash = location.hash || ROLE_HOME[App.user ? App.user.role : 'admin'];
  return App.routes[App.user ? App.user.role : 'admin'].find(r => '#' + r.path === hash || r.path === hash);
}

async function renderRoute() {
  if (!App.user) return;
  const route = currentRoute();
  const view = $('#view');
  if (!route) { view.innerHTML = ''; view.append(el('div', { class: 'card' }, 'Page not found.')); return; }
  $$('#sidebar .nav-item').forEach(n => n.classList.toggle('active', n.dataset.path === route.path));
  view.innerHTML = '';
  const loading = el('div', { class: 'card center', style: 'color:var(--muted)' }, 'Loading…');
  view.append(loading);
  try {
    const content = await route.render();
    view.innerHTML = '';
    view.append(content);
    window.scrollTo({ top: 0 });
  } catch (e) {
    view.innerHTML = '';
    view.append(el('div', { class: 'card' },
      el('div', { class: 'form-error', style: 'margin:0' }, e.message || 'Failed to load page.')));
  }
}
window.addEventListener('hashchange', renderRoute);

/* ---------- Topbar actions ---------- */
$('#logout-btn').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch {}
  location.hash = '';
  showLogin();
});

$('#menu-toggle').addEventListener('click', () => $('#sidebar').classList.toggle('open'));

$('#change-pw-btn').addEventListener('click', () => openChangePassword(false));

function openChangePassword(mandatory) {
  const errBox = el('div', { class: 'form-error hidden' });
  const oldP = el('input', { type: 'password', placeholder: 'Current password', required: true });
  const newP = el('input', { type: 'password', placeholder: 'New password (min 6 chars)', required: true });
  const confP = el('input', { type: 'password', placeholder: 'Confirm new password', required: true });
  const submit = el('button', { class: 'btn btn-primary' }, 'Update Password');
  const body = [
    errBox,
    el('label', { class: 'field' }, el('span', {}, 'Current password'), oldP),
    el('label', { class: 'field' }, el('span', {}, 'New password'), newP),
    el('label', { class: 'field' }, el('span', {}, 'Confirm new password'), confP)
  ];
  const foot = [];
  if (!mandatory) foot.push(el('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Cancel'));
  foot.push(submit);
  const m = modal({ title: 'Change Password', body, footer: foot, onClose: mandatory ? () => toast('Please change your password to continue.', 'info') : null });
  submit.addEventListener('click', async () => {
    errBox.classList.add('hidden');
    if (newP.value !== confP.value) { errBox.textContent = 'Passwords do not match.'; errBox.classList.remove('hidden'); return; }
    if (newP.value.length < 6) { errBox.textContent = 'New password must be at least 6 characters.'; errBox.classList.remove('hidden'); return; }
    submit.disabled = true;
    try {
      await api('/api/change-password', { method: 'POST', body: { old_password: oldP.value, new_password: newP.value } });
      m.close();
      toast('Password changed successfully.', 'success');
    } catch (e) {
      errBox.textContent = e.message; errBox.classList.remove('hidden');
      submit.disabled = false;
    }
  });
}

/* ---------- GPS shared helper ---------- */
function geolocate() {
  return new Promise(resolve => {
    if (!navigator.geolocation) return resolve({ state: 'unsupported', message: 'Geolocation is not supported by this browser.' });
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ state: 'ok', lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      err => resolve({
        state: err.code === 1 ? 'denied' : err.code === 2 ? 'unavailable' : 'timeout',
        message: err.code === 1 ? 'Location permission denied. Please allow location access in your browser settings.'
          : err.code === 2 ? 'Your location could not be determined. Check GPS/Wi-Fi and try again.'
          : 'Location request timed out. Try again.'
      }),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  });
}

function distanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = x => x * Math.PI / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* ---------- init ---------- */
window.addEventListener('DOMContentLoaded', boot);
if (document.readyState !== 'loading') boot();
