'use strict';

function bad(msg, status = 400) { const e = new Error(msg); e.status = status; return e; }

function requireFields(obj, fields) {
  for (const f of fields) {
    const v = obj[f];
    if (v === undefined || v === null || String(v).trim() === '') throw bad(`${f.replace(/_/g, ' ')} is required.`);
  }
}

function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s)) && !isNaN(Date.parse(s)); }

function requireDate(s, field = 'date') {
  if (!isDate(s)) throw bad(`Invalid ${field}. Use YYYY-MM-DD.`);
  return s;
}

function requireTimeHHMM(s, field) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(s))) throw bad(`Invalid ${field}. Use HH:MM (24h).`);
  return s;
}

function rangeDates(from, to) {
  const out = [];
  const d = new Date(from + 'T00:00:00Z');
  const end = new Date(to + 'T00:00:00Z');
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

function todayStr(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function nowHHMM(d = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function monthBounds(ym) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(ym)) throw bad('Invalid month. Use YYYY-MM.');
  return { from: `${ym}-01`, to: `${ym}-31` };
}

// Haversine distance in meters between two WGS84 points
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = x => (x * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1), dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function round(n, places = 2) { const p = 10 ** places; return Math.round(n * p) / p; }

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

module.exports = { bad, requireFields, isDate, requireDate, requireTimeHHMM, rangeDates, todayStr, nowHHMM, monthBounds, haversineMeters, round, esc };
