'use strict';
/* Frontend smoke test: loads the real UI in jsdom, logs in as each role,
   renders every registered page, and reports any runtime errors. */
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = process.env.BASE || 'http://localhost:3000';
const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const errors = [];
const cookieJar = { value: '' };

const vc = new VirtualConsole();
vc.on('jsdomError', e => {
  const msg = e.detail ? (e.detail.stack || e.detail.message) : e.message;
  if (String(msg).includes("getContext() method: without installing the canvas")) return; // jsdom limitation, guarded in app
  errors.push('jsdomError: ' + msg);
});
vc.on('error', (...a) => errors.push('console.error: ' + a.map(String).join(' ')));

async function shimFetch(url, init = {}) {
  const abs = url.startsWith('http') ? url : BASE + url;
  const headers = { ...(init.headers || {}) };
  if (cookieJar.value) headers.Cookie = cookieJar.value;
  const res = await fetch(abs, { ...init, headers });
  const sc = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  for (const c of sc) cookieJar.value = c.split(';')[0];
  return new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers });
}

(async () => {
  const dom = new JSDOM(html, { url: BASE + '/', runScripts: 'dangerously', pretendToBeVisual: true, virtualConsole: vc });
  const { window } = dom;
  window.fetch = (url, init) => shimFetch(url, init).catch(e => { throw new Error('Network: ' + e.message); });
  window.URL.createObjectURL = () => 'blob:fake';
  window.URL.revokeObjectURL = () => {};
  window.scrollTo = () => {};
  window.addEventListener('error', e => errors.push('window.onerror: ' + e.message));
  window.addEventListener('unhandledrejection', e => errors.push('unhandledrejection: ' + (e.reason && e.reason.message || e.reason)));

  const inject = code => {
    const s = window.document.createElement('script');
    s.textContent = code;
    window.document.body.append(s);
  };
  for (const f of ['js/core.js', 'js/admin.js', 'js/officer.js', 'js/trainee.js', 'js/app.js']) {
    try { inject(fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8')); }
    catch (e) { errors.push(`script ${f}: ${e.message}`); }
  }

  const loginAs = async (username, password) => {
    await window.api('/api/login', { method: 'POST', body: { username, password } });
    const me = await window.api('/api/me');
    window.showApp(me.user);
    await new Promise(r => setTimeout(r, 30));
  };

  const results = [];
  const testRole = async (label, user, pass) => {
    try { await loginAs(user, pass); } catch (e) { errors.push(`${label} login failed: ${e.message}`); return; }
    const App = window.eval('App');
    const routes = App.routes[App.user.role];
    results.push(`${label}: ${routes.length} pages`);
    for (const route of routes) {
      const start = Date.now();
      try {
        const node = await route.render();
        if (!node || !node.nodeType) throw new Error('render() did not return a DOM node');
        const txt = node.textContent || '';
        if (/undefined|\[object Object\]|NaN/.test(txt)) {
          const m = txt.match(/.{0,40}(undefined|\[object Object\]|NaN).{0,40}/);
          errors.push(`${label} ${route.path}: suspicious text "${m ? m[0].trim() : ''}"`);
        }
        results.push(`  OK ${route.path} (${Date.now() - start}ms, ${txt.length} chars)`);
      } catch (e) {
        errors.push(`${label} ${route.path}: ${e.stack ? e.stack.split('\n').slice(0, 2).join(' | ') : e.message}`);
        results.push(`  FAIL ${route.path} — ${e.message}`);
      }
    }
    try { await window.api('/api/logout', { method: 'POST' }); cookieJar.value = ''; } catch {}
  };

  await testRole('ADMIN(admin)', 'admin', 'Admin@123');
  await testRole('OFFICER(rverma)', 'rverma', 'Officer@123');
  await testRole('TRAINEE(trainee1)', 'trainee1', 'Trainee@123');

  console.log(results.join('\n'));
  if (errors.length) {
    console.log('\n=== ERRORS (' + errors.length + ') ===');
    console.log(errors.join('\n'));
    process.exit(1);
  }
  console.log('\nALL PAGES RENDERED WITHOUT ERRORS');
})().catch(e => { console.error('FATAL', e); process.exit(1); });
