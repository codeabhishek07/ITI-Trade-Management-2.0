'use strict';
/* Trainee pages: dashboard with GPS attendance, leave, history, warnings */

registerRoutes('trainee', [
  {
    path: '#/dashboard', label: 'My Dashboard', icon: '🏠', render: async () => {
      const [me, dash] = await Promise.all([api('/api/trainee/me'), api('/api/trainee/dashboard')]);
      const page = el('div', {});

      /* ---- GPS attendance box ---- */
      const gpsDot = el('span', { class: 'gps-dot' });
      const gpsText = el('span', {}, 'Location not fetched yet.');
      const gpsDetail = el('small', { style: 'color:var(--muted);display:block;margin-left:20px' }, '');
      const markBtn = el('button', { class: 'btn btn-primary' }, '📍 Mark My Attendance');
      const gpsBox = el('div', { class: 'gps-box' },
        el('div', { style: 'display:flex;flex-wrap:wrap;gap:10px;align-items:center' },
          el('strong', { style: 'font-size:16px' }, 'Today’s Attendance'),
          el('span', { class: 'window-pill' }, `Window: ${dash.window.start} – ${dash.window.end}`),
          el('span', { class: 'window-pill' }, `Campus radius: ${dash.campus.radius_m} m`),
          el('div', { style: 'flex:1' }),
          dash.today && dash.today.status !== 'absent'
            ? el('span', { class: 'badge present' }, `Marked ${statusLabel(dash.today.status)} at ${String(dash.today.marked_at).slice(11, 16)}`)
            : (dash.today && dash.today.status === 'absent'
              ? el('span', { class: 'badge absent' }, 'Absent (auto) — contact your officer')
              : el('span', { class: 'badge pending' }, 'Not marked yet'))
        ),
        el('div', { class: 'gps-status' }, gpsDot, gpsText),
        gpsDetail,
        el('div', { style: 'display:flex;gap:10px;flex-wrap:wrap;margin-top:8px' },
          markBtn,
          el('button', {
            class: 'btn btn-outline', onclick: async () => {
              gpsDot.className = 'gps-dot busy'; gpsText.textContent = 'Checking location…';
              const g = await geolocate();
              if (g.state !== 'ok') { gpsDot.className = 'gps-dot bad'; gpsText.textContent = g.message; gpsDetail.textContent = ''; return; }
              const d = distanceMeters(g.lat, g.lng, dash.campus.lat, dash.campus.lng);
              const inside = d <= dash.campus.radius_m;
              gpsDot.className = inside ? 'gps-dot ok' : 'gps-dot bad';
              gpsText.textContent = inside ? 'You are inside the campus geofence.' : `You are ${Math.round(d)} m away — outside the ${dash.campus.radius_m} m geofence.`;
              gpsDetail.textContent = `Lat ${g.lat.toFixed(6)}, Lng ${g.lng.toFixed(6)} (±${Math.round(g.accuracy)} m) · distance to ${dash.campus.name}: ${Math.round(d)} m`;
            }
          }, 'Check My Location')
        ),
        el('div', { class: 'notice info', style: 'margin:12px 0 0' },
          `GPS geotag verification is mandatory. Attendance is accepted only between ${dash.window.start} and ${dash.window.end} and within ${dash.campus.radius_m} m of ${dash.campus.name}.`)
      );

      markBtn.addEventListener('click', async () => {
        if (!dash.can_mark && !(dash.today && dash.today.status === 'absent')) {
          toast(dash.already_marked ? 'Attendance already marked today.' : `Outside attendance window (${dash.window.start}–${dash.window.end}).`, 'error');
          return;
        }
        markBtn.disabled = true;
        gpsDot.className = 'gps-dot busy'; gpsText.textContent = 'Fetching GPS position…';
        gpsDetail.textContent = 'If your browser asks for permission, choose Allow.';
        const g = await geolocate();
        if (g.state !== 'ok') {
          gpsDot.className = 'gps-dot bad';
          gpsText.textContent = g.message;
          gpsDetail.textContent = '';
          markBtn.disabled = false;
          if (g.state === 'denied') gpsDetail.textContent = 'Tip: tap the 🔒 icon in the address bar → Site settings → Location → Allow, then reload.';
          return;
        }
        gpsText.textContent = 'Verifying geotag with server…';
        try {
          const r = await api('/api/trainee/attendance', { method: 'POST', body: { lat: g.lat, lng: g.lng, accuracy: g.accuracy } });
          gpsDot.className = 'gps-dot ok';
          gpsText.textContent = `✅ Attendance marked as Present at ${new Date().toLocaleTimeString()} (geotag verified: ${r.distance} m from campus).`;
          gpsDetail.textContent = '';
          toast('Attendance marked successfully!', 'success');
          setTimeout(() => renderRoute(), 900);
        } catch (e) {
          gpsDot.className = 'gps-dot bad';
          gpsText.textContent = e.message;
          gpsDetail.textContent = '';
          toast(e.message, 'error');
        } finally { markBtn.disabled = false; }
      });

      if (dash.already_marked) { markBtn.disabled = true; markBtn.textContent = '✅ Already Marked'; gpsDot.className = 'gps-dot ok'; gpsText.textContent = 'Attendance recorded for today.'; }
      else if (!dash.can_mark) { markBtn.disabled = true; gpsText.textContent = `Attendance window (${dash.window.start}–${dash.window.end}) is currently closed.`; }

      /* ---- Charts ---- */
      const dayCanvas = el('canvas', { class: 'chart' });
      const monthCanvas = el('canvas', { class: 'chart' });

      /* ---- Balances ---- */
      const bal = dash.leave_balances;

      const wrap = el('div', {},
        pageHead(`Welcome, ${me.profile.name}`),
        gpsBox,
        el('div', { class: 'stats-grid' },
          statCard('Overall Attendance', `${dash.stats.pct}%`, { color: dash.stats.pct >= 80 ? 'green' : 'red', icon: '📊' }),
          statCard('Working Days', dash.stats.working, { icon: '📅' }),
          statCard('Approved Leaves', dash.stats.leaves, { color: 'violet', icon: '🌴' }),
          statCard('Pending Leave Requests', dash.pending_leaves, { color: 'amber', icon: '⏳' }),
          statCard('Warnings Received', dash.warnings, dash.warnings ? { color: 'red', icon: '⚠️' } : { icon: '⚠️' }),
          statCard('Trade', me.profile.trade ? me.profile.trade.name : '—', { color: 'violet', icon: '🛠️' })
        ),
        el('div', { class: 'grid-2' },
          el('div', { class: 'chart-box' },
            el('h4', {}, 'Last 14 Days'),
            dayCanvas, CHART_LEGEND.cloneNode(true)),
          el('div', { class: 'chart-box' },
            el('h4', {}, 'Monthly Attendance % (last 6 months)'),
            monthCanvas,
            el('div', { class: 'legend' }, el('span', {}, el('i', { style: 'background:#2563eb' }), 'Monthly %'),
              el('span', {}, el('i', { style: 'background:#dc2626' }), '80% requirement')))
        ),
        el('div', { class: 'card' },
          el('h3', {}, 'Leave Balance'),
          el('dl', { class: 'kv' },
            el('dt', {}, 'Casual Leave (this year)'), el('dd', {}, `${bal.cl_used} / ${bal.cl_limit} days used`),
            el('dt', {}, 'Medical Leave (this year)'), el('dd', {}, `${bal.ml_used} / ${bal.ml_limit} days used`),
            el('dt', {}, 'Half-Day (this month)'), el('dd', {}, `${bal.hd_used} / ${bal.hd_limit} used`),
            el('dt', {}, 'Session'), el('dd', {}, me.profile.session ? me.profile.session.name : '—'),
            el('dt', {}, 'Roll Number'), el('dd', {}, me.profile.roll_no || '—')
          ),
          el('div', { class: 'notice info mt' }, 'Limits are configured by the Trade Admin in Settings. Approved CL/ML are excluded from the attendance percentage denominator.')
        )
      );

      setTimeout(() => {
        drawStackedDayChart(dayCanvas, dash.chart);
        drawBarChart(monthCanvas, dash.months.map(m => m.month.slice(2)), dash.months.map(m => m.pct),
          { color: '#2563eb', max: 100, suffix: '%', targetLine: 80 });
      }, 40);
      return wrap;
    }
  },
  {
    path: '#/leave', label: 'Apply Leave', icon: '📝', render: async () => {
      const initial = await api('/api/trainee/leave');
      const page = el('div', {});
      const load = async () => {
        const d = await api('/api/trainee/leave');
        page.innerHTML = '';
        page.append(
          pageHead('Leave Application'),
          el('div', { class: 'grid-2' },
            el('div', { class: 'card' },
              el('h3', {}, 'Apply for Leave'),
              leaveForm(load)),
            el('div', { class: 'card' },
              el('h3', {}, 'Your Leave Balance'),
              el('dl', { class: 'kv' },
                el('dt', {}, 'CL (year)'), el('dd', {}, `${d.balances.cl_used} / ${d.balances.cl_limit} days`),
                el('dt', {}, 'ML (year)'), el('dd', {}, `${d.balances.ml_used} / ${d.balances.ml_limit} days`),
                el('dt', {}, 'Half-Day (month)'), el('dd', {}, `${d.balances.hd_used} / ${d.balances.hd_limit}`)),
              el('div', { class: 'notice mt' }, 'Requests are reviewed by your Training Officer. Approved leave updates your attendance automatically.')),
          ),
          el('div', { class: 'card' },
            el('h3', {}, 'My Leave Requests'),
            dataTable({
              columns: [
                { label: '#', key: 'id', width: '50px' },
                { label: 'Type', render: r => badge(r.type === 'HALF_DAY' ? 'half_day' : r.type.toLowerCase()) },
                { label: 'From', key: 'from_date' },
                { label: 'To', key: 'to_date' },
                { label: 'Days', key: 'days' },
                { label: 'Reason', key: 'reason' },
                { label: 'Status', render: r => badge(r.status) },
                { label: 'Reviewer Note', render: r => el('small', { style: 'color:var(--muted)' }, r.review_note || (r.reviewer_name ? `by ${r.reviewer_name}` : '—')) },
                {
                  label: '', className: 'actions', render: r => r.status === 'pending'
                    ? el('button', {
                      class: 'btn btn-sm btn-danger',
                      onclick: async () => { if (await confirmDialog('Cancel this leave request?', { danger: true, okText: 'Cancel Request' })) { try { await api(`/api/trainee/leave/${r.id}`, { method: 'DELETE' }); toast('Request cancelled.', 'success'); load(); } catch (e) { toast(e.message, 'error'); } } }
                    }, 'Cancel')
                    : null
                }
              ],
              rows: d.rows, searchKeys: ['reason', 'type'], emptyText: 'No leave requests yet'
            }))
        );
      };
      function leaveForm(onDone) {
        const errBox = el('div', { class: 'form-error hidden' });
        const typeSel = el('select', {},
          el('option', { value: 'CL' }, 'Casual Leave (CL)'),
          el('option', { value: 'ML' }, 'Medical Leave (ML)'),
          el('option', { value: 'HALF_DAY' }, 'Half-Day Leave'));
        const fromI = el('input', { type: 'date', required: true });
        const toI = el('input', { type: 'date', required: true });
        const reasonI = el('textarea', { rows: 3, placeholder: 'Reason for leave…' });
        const btn = el('button', { class: 'btn btn-primary' }, 'Submit Request');
        const form = el('form', { onsubmit: e => e.preventDefault() },
          errBox,
          el('label', { class: 'field' }, el('span', {}, 'Leave Type'), typeSel),
          el('div', { class: 'form-grid' },
            el('label', { class: 'field' }, el('span', {}, 'From Date'), fromI),
            el('label', { class: 'field' }, el('span', {}, 'To Date'), toI)),
          el('label', { class: 'field' }, el('span', {}, 'Reason *'), reasonI),
          el('small', { style: 'color:var(--muted)' }, 'Half-day leave is for a single day only. Approval is subject to your leave balance limits.'),
          el('div', { style: 'margin-top:12px' }, btn));
        btn.addEventListener('click', async () => {
          errBox.classList.add('hidden');
          if (!fromI.value || !toI.value) { errBox.textContent = 'Please choose from and to dates.'; errBox.classList.remove('hidden'); return; }
          if (!reasonI.value.trim()) { errBox.textContent = 'Please provide a reason.'; errBox.classList.remove('hidden'); return; }
          btn.disabled = true;
          try {
            await api('/api/trainee/leave', { method: 'POST', body: { type: typeSel.value, from_date: fromI.value, to_date: toI.value, reason: reasonI.value.trim() } });
            toast('Leave request submitted for approval.', 'success');
            onDone();
          } catch (e) { errBox.textContent = e.message; errBox.classList.remove('hidden'); btn.disabled = false; }
        });
        return form;
      }
      await load();
      return page;
    }
  },
  {
    path: '#/history', label: 'Attendance History', icon: '📆', render: async () => {
      const state = { month: new Date().toISOString().slice(0, 7) };
      const page = el('div', {});
      const chartCanvas = el('canvas', { class: 'chart' });
      const load = async () => {
        const d = await api('/api/trainee/attendance?month=' + state.month);
        page.innerHTML = '';
        page.append(
          pageHead('My Attendance History',
            el('button', {
              class: 'btn btn-outline btn-sm',
              onclick: () => {
                const headers = ['Date', 'Status', 'Marked At', 'Source', 'Distance (m)', 'Note'];
                const esc = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
                const csv = '\uFEFF' + [headers, ...d.rows.map(r => [r.date, statusLabel(r.status), r.marked_at, r.source, r.distance_m != null ? Math.round(r.distance_m) : '', r.note || ''])].map(r => r.map(esc).join(',')).join('\r\n');
                const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: `my-attendance-${state.month}.csv` });
                document.body.append(a); a.click(); a.remove();
              }
            }, '⬇ Excel/CSV')),
          el('div', { class: 'toolbar' },
            el('input', { type: 'month', value: state.month, onchange: e => { state.month = e.target.value; load(); } }),
            el('div', { style: 'flex:1' }),
            el('span', { class: 'window-pill' }, `Month attendance: ${d.stats.pct}%`),
            el('span', { class: 'window-pill' }, `Overall: ${d.stats.working} working days`),
            el('span', { class: 'window-pill' }, `Approved leaves: ${d.stats.leaves}`)),
          el('div', { class: 'chart-box' }, el('h4', {}, 'Daily pattern for this month'), chartCanvas, CHART_LEGEND.cloneNode(true)),
          el('div', { class: 'card' },
            dataTable({
              columns: [
                { label: 'Date', key: 'date' },
                { label: 'Day', render: r => new Date(r.date + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short' }) },
                { label: 'Status', render: r => badge(r.status) },
                { label: 'Marked At', render: r => r.marked_at ? String(r.marked_at).slice(11, 16) : '—' },
                { label: 'Source', render: r => r.source === 'self' ? 'GPS Self' : r.source === 'system' ? 'Auto' : r.source === 'leave' ? 'On Leave' : 'Officer' },
                { label: 'Distance', render: r => r.distance_m != null ? `${Math.round(r.distance_m)} m` : '—' },
                { label: 'Remarks', key: 'note' }
              ],
              rows: d.rows, searchKeys: ['date', 'status'], emptyText: 'No records this month'
            }))
        );
        const days = [];
        for (const r of [...d.rows].reverse()) days.push({ date: r.date, status: r.status });
        drawStackedDayChart(chartCanvas, days);
      };
      await load();
      return page;
    }
  },
  {
    path: '#/warnings', label: 'My Warnings', icon: '⚠️', render: async () => {
      const rows = await api('/api/trainee/warnings');
      return el('div', {},
        pageHead('My Warnings'),
        rows.length
          ? el('div', { class: 'card' }, dataTable({
            columns: [
              { label: 'Date', render: r => fmtDate(r.created_at) },
              { label: 'At Attendance %', render: r => `${r.attendance_pct}%` },
              { label: 'Message', key: 'message' },
              { label: 'Issued By', key: 'issued_by_name' },
              { label: 'Period', key: 'period' }
            ],
            rows, searchKeys: ['message'], emptyText: 'No warnings'
          }))
          : el('div', { class: 'notice ok' }, '🎉 You have no warnings. Keep your attendance above 80%.'),
        el('div', { class: 'notice info' }, 'Warnings are issued by your Training Officer when attendance falls below the configured threshold. Contact them for authorized attendance corrections.')
      );
    }
  },
  {
    path: '#/profile', label: 'My Profile', icon: '👤', render: async () => {
      const me = await api('/api/trainee/me');
      return el('div', {},
        pageHead('My Profile'),
        el('div', { class: 'card' },
          el('dl', { class: 'kv' },
            el('dt', {}, 'Name'), el('dd', {}, me.profile.name),
            el('dt', {}, 'Roll Number'), el('dd', {}, me.profile.roll_no || '—'),
            el('dt', {}, 'Username'), el('dd', {}, me.profile.username),
            el('dt', {}, 'Trade'), el('dd', {}, me.profile.trade ? `${me.profile.trade.name} (${me.profile.trade.code})` : '—'),
            el('dt', {}, 'Session'), el('dd', {}, me.profile.session ? me.profile.session.name : '—'),
            el('dt', {}, 'Mobile'), el('dd', {}, me.profile.mobile || '—'),
            el('dt', {}, 'Email'), el('dd', {}, me.profile.email || '—'),
            el('dt', {}, 'Gender'), el('dd', {}, me.profile.gender || '—'),
            el('dt', {}, 'Guardian'), el('dd', {}, me.profile.guardian || '—'),
            el('dt', {}, 'Overall Attendance'), el('dd', {}, pctBar(me.stats.pct)),
            el('dt', {}, 'Working Days Counted'), el('dd', {}, me.stats.working)
          )),
        el('div', { class: 'notice info' }, 'To update your details or correct attendance, contact your Training Officer. Login password can be changed from the top bar.')
      );
    }
  }
]);
