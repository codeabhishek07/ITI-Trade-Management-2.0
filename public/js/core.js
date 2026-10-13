'use strict';
/* Core: API wrapper, DOM helpers, router, modal, toast, table, charts */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && k !== 'list' && typeof v !== 'object') node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

async function api(path, opts = {}) {
  const init = { method: opts.method || 'GET', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin' };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);
  let res;
  try { res = await fetch(path, init); }
  catch { throw new Error('Network error — is the server running?'); }
  let data = null;
  try { data = await res.json(); } catch { /* non-json */ }
  if (res.status === 401 && !path.endsWith('/login')) { forceLogout(); throw new Error('Session expired. Please login again.'); }
  if (!res.ok) { const err = new Error((data && data.error) || `Request failed (${res.status})`); err.status = res.status; throw err; }
  return data;
}

async function downloadFile(path, filename) {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (!res.ok) { let d = {}; try { d = await res.json(); } catch {} throw new Error(d.error || 'Download failed'); }
  const blob = await res.blob();
  const cd = res.headers.get('Content-Disposition') || '';
  const m = cd.match(/filename="(.+)"/);
  const a = el('a', { href: URL.createObjectURL(blob), download: filename || (m ? m[1] : 'download') });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function toast(msg, type = 'info') {
  const box = $('#toast-box');
  const t = el('div', { class: `toast ${type}` }, msg);
  box.append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .4s'; setTimeout(() => t.remove(), 400); }, 4200);
}

function modal({ title, body, footer, wide, onClose }) {
  const root = $('#modal-root');
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); onClose && onClose(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const box = el('div', { class: `modal ${wide ? 'wide' : ''}`, onclick: e => e.stopPropagation() },
    el('div', { class: 'modal-head' }, el('h3', {}, title), el('button', { class: 'modal-close', onclick: close, 'aria-label': 'Close' }, '×')),
    el('div', { class: 'modal-body' }, body),
    footer ? el('div', { class: 'modal-foot' }, footer) : null
  );
  // Backdrop clicks intentionally do NOT close the modal — unsaved form data must not vanish.
  // Close only via the × button, Cancel, or Esc.
  const backdrop = el('div', { class: 'modal-backdrop' }, box);
  root.innerHTML = ''; root.append(backdrop);
  document.addEventListener('keydown', onKey);
  return { close, box };
}

function confirmDialog(message, { danger = false, okText = 'Confirm' } = {}) {
  return new Promise(resolve => {
    const m = modal({
      title: 'Please confirm',
      body: el('p', {}, message),
      footer: [
        el('button', { class: 'btn btn-ghost', onclick: () => { m.close(); resolve(false); } }, 'Cancel'),
        el('button', { class: `btn ${danger ? 'btn-danger' : 'btn-primary'}`, onclick: () => { m.close(); resolve(true); } }, okText)
      ]
    });
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/* ---------- Form modal helper ---------- */
function formModal({ title, fields, submitText = 'Save', onSubmit, wide }) {
  const inputs = {};
  const errBox = el('div', { class: 'form-error hidden' });
  const form = el('form', { class: 'form-grid', onsubmit: e => e.preventDefault() });
  for (const f of fields) {
    const id = 'f_' + f.name + '_' + Math.random().toString(36).slice(2, 7);
    let control;
    if (f.type === 'select') {
      control = el('select', { id, name: f.name },
        ...(f.options || []).map(o => el('option', { value: o.value, selected: String(o.value) === String(f.value) }, o.label)));
    } else if (f.type === 'textarea') {
      control = el('textarea', { id, rows: f.rows || 3, placeholder: f.placeholder || '', required: !!f.required }, f.value || '');
    } else if (f.type === 'checkboxes') {
      control = el('div', { class: 'checks', id },
        ...(f.options || []).map(o => {
          const cb = el('input', { type: 'checkbox', value: o.value });
          cb.checked = (f.value || []).map(String).includes(String(o.value));
          return el('label', {}, cb, ' ' + o.label);
        }));
    } else if (f.type === 'static') {
      control = el('div', { id, class: 'form-static' }, String(f.value ?? ''));
    } else {
      control = el('input', { type: f.type || 'text', id, placeholder: f.placeholder || '', value: f.value ?? '', required: !!f.required, min: f.min, max: f.max, step: f.step });
    }
    control.dataset.name = f.name;
    inputs[f.name] = control;
    form.append(el('label', { class: `field ${f.full || f.type === 'textarea' || f.type === 'checkboxes' ? 'full' : ''}` },
      el('span', { html: f.label + (f.required ? ' *' : '') }), control, f.hint ? el('small', { style: 'color:var(--muted)' }, f.hint) : null));
  }
  const submitBtn = el('button', { class: 'btn btn-primary', type: 'button' }, submitText);
  const m = modal({
    title, wide,
    body: [errBox, form],
    footer: [el('button', { class: 'btn btn-ghost', onclick: () => m.close() }, 'Cancel'), submitBtn],
    onClose: () => { /* noop */ }
  });
  const readValues = () => {
    const out = {};
    for (const [name, node] of Object.entries(inputs)) {
      if (node.classList.contains('checks')) out[name] = $$('input:checked', node).map(c => Number(c.value));
      else out[name] = node.value;
    }
    return out;
  };
  const doSubmit = async () => {
    errBox.classList.add('hidden');
    for (const [name, node] of Object.entries(inputs)) {
      if (node.required && !String(node.value).trim()) { errBox.textContent = `${name.replace(/_/g, ' ')} is required.`; errBox.classList.remove('hidden'); node.focus(); return; }
    }
    submitBtn.disabled = true; submitBtn.textContent = 'Saving…';
    try {
      const result = await onSubmit(readValues());
      m.close();
      if (result !== false) toast('Saved successfully.', 'success');
    } catch (e) {
      errBox.textContent = e.message; errBox.classList.remove('hidden');
      submitBtn.disabled = false; submitBtn.textContent = submitText;
    }
  };
  submitBtn.addEventListener('click', doSubmit);
  form.addEventListener('submit', e => { e.preventDefault(); doSubmit(); });
  setTimeout(() => { const first = $('input,select,textarea', form); first && first.focus(); }, 60);
  return { close: () => m.close(), readValues };
}

/* ---------- Searchable table ---------- */
function dataTable({ columns, rows, searchKeys = [], filters = [], rowActions, emptyText = 'No records found', onRowClick }) {
  const state = { q: '', filterVals: {} };
  const tbody = el('tbody');
  const countNote = el('div', { class: 'count-note' });
  const searchInput = searchKeys.length ? el('input', { class: 'search', placeholder: 'Search…', oninput: e => { state.q = e.target.value.toLowerCase(); render(); } }) : null;
  const filterEls = {};
  const toolbar = el('div', { class: 'toolbar' },
    searchInput,
    ...filters.map(f => {
      const sel = el('select', { onchange: e => { state.filterVals[f.key] = e.target.value; render(); } },
        el('option', { value: '' }, `All ${f.label}`),
        ...(f.options || []).map(o => el('option', { value: o.value }, o.label)));
      filterEls[f.key] = sel;
      return sel;
    })
  );
  const head = el('thead', {}, el('tr', {}, ...columns.map(c => el('th', { style: c.width ? `width:${c.width}` : '' }, c.label))));
  const table = el('table', { class: 'data' }, head, tbody);
  const wrap = el('div', { class: 'table-wrap' }, table);

  function render() {
    let data = rows;
    if (state.q && searchKeys.length) {
      data = data.filter(r => searchKeys.some(k => String(r[k] ?? '').toLowerCase().includes(state.q)));
    }
    for (const [k, v] of Object.entries(state.filterVals)) {
      if (v) data = data.filter(r => String(r[k]) === v);
    }
    tbody.innerHTML = '';
    if (!data.length) {
      tbody.append(el('tr', {}, el('td', { class: 'empty', colspan: columns.length }, emptyText)));
    } else {
      for (const r of data) {
        const tr = el('tr', onRowClick ? { style: 'cursor:pointer', onclick: () => onRowClick(r) } : {});
        for (const c of columns) {
          const val = c.render ? c.render(r) : r[c.key];
          tr.append(el('td', { class: c.className || '' }, val === null || val === undefined || val === '' ? '—' : val));
        }
        tbody.append(tr);
      }
    }
    countNote.textContent = `${data.length} of ${rows.length} record${rows.length === 1 ? '' : 's'}`;
  }
  render();
  const container = el('div', {}, toolbar, wrap, countNote);
  container.refresh = () => render();
  return container;
}

/* ---------- Charts (dependency-free canvas) ---------- */
function drawBarChart(canvas, labels, values, { color = '#2563eb', max, suffix = '', targetLine } = {}) {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 400, cssH = canvas.clientHeight || 190;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);
  const padL = 34, padB = 24, padT = 12, padR = 8;
  const w = cssW - padL - padR, h = cssH - padT - padB;
  const hi = max ?? Math.max(1, ...values);
  // gridlines
  ctx.strokeStyle = '#eef2f7'; ctx.fillStyle = '#94a3b8'; ctx.font = '10.5px sans-serif'; ctx.textAlign = 'right';
  for (let i = 0; i <= 4; i++) {
    const y = padT + h - (h * i) / 4;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cssW - padR, y); ctx.stroke();
    ctx.fillText(Math.round((hi * i) / 4) + suffix, padL - 5, y + 3);
  }
  const n = values.length || 1;
  const bw = Math.min(34, (w / n) * 0.62);
  values.forEach((v, i) => {
    const x = padL + (w / n) * (i + 0.5) - bw / 2;
    const bh = hi ? (v / hi) * h : 0;
    ctx.fillStyle = color;
    const y = padT + h - bh;
    const r = Math.min(5, bw / 2, bh / 2);
    ctx.beginPath();
    ctx.moveTo(x, padT + h); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + bw - r, y); ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
    ctx.lineTo(x + bw, padT + h); ctx.closePath(); ctx.fill();
    // value label
    ctx.fillStyle = '#475569'; ctx.textAlign = 'center'; ctx.font = '10px sans-serif';
    if (n <= 20) ctx.fillText(v + suffix, x + bw / 2, y - 4);
    // x label
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(labels[i], x + bw / 2, cssH - 8);
  });
  if (targetLine !== undefined) {
    const y = padT + h - (targetLine / hi) * h;
    ctx.strokeStyle = '#dc2626'; ctx.setLineDash([5, 4]); ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(cssW - padR, y); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#dc2626'; ctx.textAlign = 'left'; ctx.font = '10px sans-serif';
    ctx.fillText(targetLine + suffix + ' target', padL + 3, y - 4);
  }
}

function drawStackedDayChart(canvas, days) {
  // days: [{date, status}]
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 400, cssH = canvas.clientHeight || 190;
  canvas.width = cssW * dpr; canvas.height = cssH * dpr;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);
  const COLORS = { present: '#16a34a', half_day: '#d97706', absent: '#dc2626', cl: '#2563eb', ml: '#7c3aed', none: '#e2e8f0' };
  const padB = 26, padT = 10;
  const n = days.length || 1;
  const w = cssW - 16, h = cssH - padT - padB;
  const bw = Math.min(26, (w / n) * 0.7);
  days.forEach((d, i) => {
    const x = 8 + (w / n) * (i + 0.5) - bw / 2;
    const color = COLORS[d.status] || COLORS.none;
    const val = ['present'].includes(d.status) ? 1 : ['half_day'].includes(d.status) ? 0.6 : ['cl', 'ml'].includes(d.status) ? 0.75 : d.status === 'absent' ? 0.35 : 0.15;
    const bh = h * val;
    ctx.fillStyle = color;
    ctx.beginPath();
    const r = 4;
    const y = padT + h - bh;
    ctx.moveTo(x, padT + h); ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.lineTo(x + bw - r, y); ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
    ctx.lineTo(x + bw, padT + h); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#94a3b8'; ctx.font = '9.5px sans-serif'; ctx.textAlign = 'center';
    const dt = new Date(d.date + 'T00:00:00');
    ctx.fillText(`${dt.getDate()}/${dt.getMonth() + 1}`, x + bw / 2, cssH - 9);
  });
}

const CHART_LEGEND = el('div', { class: 'legend' },
  el('span', {}, el('i', { style: 'background:#16a34a' }), 'Present'),
  el('span', {}, el('i', { style: 'background:#d97706' }), 'Half Day'),
  el('span', {}, el('i', { style: 'background:#2563eb' }), 'Casual Leave'),
  el('span', {}, el('i', { style: 'background:#7c3aed' }), 'Medical Leave'),
  el('span', {}, el('i', { style: 'background:#dc2626' }), 'Absent'),
  el('span', {}, el('i', { style: 'background:#e2e8f0' }), 'Not Marked')
);

/* ---------- Small UI atoms ---------- */
function badge(status) {
  const map = { present: 'Present', absent: 'Absent', cl: 'Casual Leave', ml: 'Medical Leave', half_day: 'Half Day', pending: 'Pending', approved: 'Approved', rejected: 'Rejected', active: 'Active', inactive: 'Inactive', issued: 'Issued', none: 'Not Marked' };
  return el('span', { class: `badge ${status || 'none'}` }, map[status] || status || '—');
}
function pctBar(pct) {
  const cls = pct >= 80 ? '' : pct >= 60 ? 'warn' : 'bad';
  return el('div', { class: 'pct-bar' },
    el('div', { class: 'pct-track' }, el('div', { class: `pct-fill ${cls}`, style: `width:${Math.min(100, pct)}%` })),
    el('strong', {}, `${pct}%`));
}
function statCard(label, value, { color = '', icon = '' } = {}) {
  return el('div', { class: `stat-card ${color}` },
    el('div', { class: 'stat-ico' }, icon),
    el('div', { class: 'stat-value' }, value),
    el('div', { class: 'stat-label' }, label));
}
function pageHead(title, ...actions) {
  return el('div', { class: 'page-head' }, el('h2', {}, title), el('div', { class: 'spacer' }), ...actions);
}
function downloadBtn(path, label, filename) {
  return el('button', {
    class: 'btn btn-outline btn-sm',
    onclick: async e => {
      const b = e.currentTarget; b.disabled = true;
      try { await downloadFile(path, filename); toast('Download started.', 'success'); }
      catch (err) { toast(err.message, 'error'); }
      b.disabled = false;
    }
  }, '⬇ ' + label);
}
function fmtDate(s) { return s ? String(s).slice(0, 10) : '—'; }
function statusLabel(s) { return { present: 'Present', absent: 'Absent', cl: 'Casual Leave', ml: 'Medical Leave', half_day: 'Half Day' }[s] || (s ? s : 'Not Marked'); }


/* ---------- Route registry (must exist before role modules load) ---------- */
const App = { user: null, routes: { admin: [], officer: [], trainee: [] } };
function registerRoutes(role, routes) {
  for (const r of routes) App.routes[role].push(r);
}
