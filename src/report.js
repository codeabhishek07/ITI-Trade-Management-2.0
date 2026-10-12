'use strict';
// Lightweight report helpers: CSV (Excel compatible) + dependency-free PDF generator.

function csvEscape(v) {
  const s = String(v == null ? '' : v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

function toCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const r of rows) lines.push(r.map(csvEscape).join(','));
  return lines.join('\r\n');
}

function sendCsv(res, filename, headers, rows) {
  const bom = '\uFEFF';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send(bom + toCsv(headers, rows));
}

// ---- Minimal PDF ----------------------------------------------------------
// Produces a single/multi-page A4 landscape PDF with a title, meta line, and table.

const PAGE_W = 842, PAGE_H = 595, MARGIN = 36;

function pdfEscape(s) {
  let out = '';
  for (const ch of String(s == null ? '' : s)) {
    const code = ch.codePointAt(0);
    if (ch === '(' || ch === ')' || ch === '\\') out += '\\' + ch;
    else if (code >= 32 && code <= 126) out += ch;
    else if (code === 160) out += ' ';
    else if (code > 127 && code <= 339) {
      // approximate latin extended with WinAnsi-ish fallbacks
      const map = { '₹': 'Rs.', '–': '-', '—': '-', '‘': "'", '’': "'", '“': '"', '”': '"', '…': '...' };
      out += map[ch] || '?';
    } else if (code > 127) out += '?';
  }
  return out;
}

function textWidth(s, size) {
  // rough Helvetica width factor
  return String(s).length * size * 0.5;
}

function buildPdf({ title, subtitle, headers, rows, footer }) {
  const colCount = headers.length;
  const avail = PAGE_W - MARGIN * 2;
  // equal columns unless weights provided in headers ({text, w})
  let weights = headers.map(h => (typeof h === 'object' ? h.w || 1 : 1));
  const wsum = weights.reduce((a, b) => a + b, 0);
  let colW = weights.map(w => (w / wsum) * avail);
  const headerText = headers.map(h => (typeof h === 'object' ? h.text : String(h)));
  const fontSize = 8.5;
  const rowH = 15;
  const tableTop = PAGE_H - MARGIN - 34;
  const footerText = footer || '';
  const contentLines = []; // each entry = array of PDF ops for a page

  let page = [];
  let y = tableTop;

  const drawHeaderRow = () => {
    let x = MARGIN;
    page.push(`0.93 0.96 0.99 rg ${MARGIN} ${y - rowH + 4} ${avail} ${rowH} re f`);
    page.push('0 0 0 rg BT /F2 8.5 Tf');
    for (let i = 0; i < colCount; i++) {
      const t = pdfEscape(truncate(headerText[i], colW[i] - 8, fontSize + 0.5));
      page.push(`1 0 0 1 ${(x + 4).toFixed(1)} ${(y - rowH + 8).toFixed(1)} Tm (${t}) Tj`);
      x += colW[i];
    }
    page.push('ET 0.55 0.68 0.85 RG 0.7 w');
    page.push(`${MARGIN} ${y - rowH + 4} m ${MARGIN + avail} ${y - rowH + 4} l S`);
    y -= rowH;
  };

  drawHeaderRow();

  for (let r = 0; r < rows.length; r++) {
    if (y - rowH < MARGIN + 30) {
      contentLines.push(page);
      page = [];
      y = tableTop;
      drawHeaderRow();
    }
    if (r % 2 === 1) page.push(`0.975 0.985 1 rg ${MARGIN} ${y - rowH + 4} ${avail} ${rowH} re f`);
    let x = MARGIN;
    page.push('0 0 0 rg BT /F1 8.5 Tf');
    for (let i = 0; i < colCount; i++) {
      const cell = rows[r][i];
      const t = pdfEscape(truncate(cell, colW[i] - 8, fontSize));
      page.push(`1 0 0 1 ${(x + 4).toFixed(1)} ${(y - rowH + 8).toFixed(1)} Tm (${t}) Tj`);
      x += colW[i];
    }
    page.push('ET');
    page.push(`0.85 0.88 0.92 RG 0.4 w ${MARGIN} ${y - rowH + 4} m ${MARGIN + avail} ${y - rowH + 4} l S`);
    y -= rowH;
  }
  contentLines.push(page);

  // Assemble PDF objects
  const objs = [];
  const add = s => { objs.push(s); return objs.length; };

  const fontRegular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');

  const pageObjIds = [];
  const pagesId = objs.length + contentLines.length * 2 + 1; // placeholder, resolve after

  const contentIds = [];
  const pageNums = [];

  // reserve page ids: we add content streams and pages after fonts
  const streams = contentLines.map((ops, idx) => {
    const head = [];
    head.push('BT');
    head.push(`/F2 14 Tf 1 0 0 1 ${MARGIN} ${(PAGE_H - MARGIN - 6).toFixed(1)} Tm (${pdfEscape(title)}) Tj`);
    head.push(`/F1 9 Tf 1 0 0 1 ${MARGIN} ${(PAGE_H - MARGIN - 22).toFixed(1)} Tm (${pdfEscape(subtitle || '')}) Tj`);
    head.push(`/F1 8 Tf 1 0 0 1 ${(PAGE_W - MARGIN - 130).toFixed(1)} ${(PAGE_H - MARGIN - 22).toFixed(1)} Tm (Page ${idx + 1} of ${contentLines.length}) Tj`);
    if (footerText) head.push(`/F1 7.5 Tf 0.35 0.35 0.35 rg 1 0 0 1 ${MARGIN} ${MARGIN - 14} Tm (${pdfEscape(footerText)}) Tj`);
    head.push('ET');
    const content = head.concat(ops).join('\n');
    return `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`;
  });

  const contentObjIds = streams.map(s => add(s));
  const kids = [];
  for (const cid of contentObjIds) {
    const pid = add(`<< /Type /Page /Parent ${'PAGES'} /MediaBox [0 0 ${PAGE_W} ${PAGE_H}] /Contents ${cid} 0 R /Resources << /Font << /F1 ${fontRegular} 0 R /F2 ${fontBold} 0 R >> >> >>`);
    kids.push(pid);
    pageNums.push(pid);
  }
  const pagesObjId = add(`<< /Type /Pages /Kids [${kids.map(k => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`);
  // fix parent refs
  for (const pid of kids) objs[pid - 1] = objs[pid - 1].replace('/Parent PAGES', `/Parent ${pagesObjId} 0 R`);
  const catalogId = add(`<< /Type /Catalog /Pages ${pagesObjId} 0 R >>`);
  const infoId = add(`<< /Title (${pdfEscape(title)}) /Producer (ITI Trade Management) /Creator (ITI Trade Management) >>`);

  let out = '%PDF-1.4\n';
  const offsets = [];
  for (let i = 0; i < objs.length; i++) {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${objs[i]}\nendobj\n`;
  }
  const xrefPos = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;
  return Buffer.from(out, 'latin1');
}

function truncate(s, width, size) {
  s = String(s == null ? '' : s);
  if (textWidth(s, size) <= width) return s;
  let out = s;
  while (out.length > 1 && textWidth(out + '...', size) > width) out = out.slice(0, -1);
  return out + '...';
}

function sendPdf(res, filename, payload) {
  const buf = buildPdf(payload);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  res.send(buf);
}

module.exports = { toCsv, sendCsv, sendPdf, buildPdf };
