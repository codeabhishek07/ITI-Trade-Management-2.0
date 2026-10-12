'use strict';
/* Trade Admin pages */

function auditDownload(rows, fmt) {
  const headers = ['ID', 'Date', 'Role', 'User', 'Action', 'Entity', 'Entity ID', 'Detail', 'IP'];
  const data = rows.map(r => [r.id, r.created_at, r.role, r.user_name || '', r.action, r.entity, r.entity_id, r.detail, r.ip]);
  if (fmt === 'csv') {
    const esc = v => { const s = String(v ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const csv = '\uFEFF' + [headers, ...data].map(r => r.map(esc).join(',')).join('\r\n');
    const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'audit-log.csv' });
    document.body.append(a); a.click(); a.remove();
  } else {
    toast('PDF export for audit log: use your browser print (Ctrl+P) on this page.', 'info');
  }
}

registerRoutes('admin', [
  {
    path: '#/dashboard', label: 'Dashboard', icon: '📊', render: async () => {
      const d = await api('/api/admin/overview');
      const wrap = el('div', {},
        pageHead('Admin Dashboard'),
        el('div', { class: 'stats-grid' },
          statCard('Academic Sessions', d.sessions, { icon: '🗓️' }),
          statCard('Active Trades', d.trades, { icon: '🛠️' }),
          statCard('Training Officers', d.officers, { color: 'violet', icon: '👨‍🏫' }),
          statCard('Trainees', d.trainees, { color: 'green', icon: '🎓' }),
          statCard('Present Today', d.present_today, { color: 'green', icon: '✅' }),
          statCard('Pending Leaves', d.pending_leaves, { color: 'amber', icon: ' leave' })
        ),
        el('div', { class: 'grid-2' },
          el('div', { class: 'card' },
            el('h3', {}, 'Recent Activity (Audit Trail)'),
            dataTable({
              columns: [
                { label: 'When', render: r => String(r.created_at).replace('T', ' ').slice(0, 16) },
                { label: 'Role', render: r => el('span', { class: 'badge ' + (r.role === 'admin' ? 'info' : r.role === 'officer' ? 'approved' : 'pending') }, r.role) },
                { label: 'User', key: 'user_name' },
                { label: 'Action', render: r => el('strong', {}, r.action) },
                { label: 'Entity', render: r => `${r.entity || ''} ${r.entity_id ? '#' + r.entity_id : ''}` }
              ],
              rows: d.recent_audit, searchKeys: ['action', 'entity', 'user_name'], emptyText: 'No activity yet'
            })
          ),
          el('div', { class: 'card' },
            el('h3', {}, 'Quick Actions'),
            el('div', { style: 'display:grid;gap:10px' },
              el('button', { class: 'btn btn-primary', onclick: () => location.hash = '#/officers' }, '+ Create Training Officer'),
              el('button', { class: 'btn btn-outline', onclick: () => location.hash = '#/sessions' }, '+ New Academic Session'),
              el('button', { class: 'btn btn-outline', onclick: () => location.hash = '#/trades' }, '+ Manage Trades'),
              el('button', { class: 'btn btn-outline', onclick: () => location.hash = '#/settings' }, '⚙ Attendance / Geofence / Leave Settings'),
              el('button', { class: 'btn btn-outline', onclick: () => location.hash = '#/audit' }, '🧾 Full Audit Log')
            ),
            el('div', { class: 'notice info mt' }, 'All settings — leave limits, attendance rules, campus location and working days — are configurable from the Settings page.')
          )
        )
      );
      return wrap;
    }
  },
  {
    path: '#/sessions', label: 'Academic Sessions', icon: '🗓️', render: async () => {
      const rows = await api('/api/admin/sessions');
      const refresh = () => location.hash === '#/sessions' ? renderRoute() : null;
      const table = dataTable({
        columns: [
          { label: 'ID', key: 'id', width: '50px' },
          { label: 'Session', render: r => el('strong', {}, r.name) },
          { label: 'Start', key: 'start_date' },
          { label: 'End', key: 'end_date' },
          { label: 'Status', render: r => r.is_active ? badge('active') : badge('inactive') },
          {
            label: 'Actions', className: 'actions', render: r => el('div', {},
              r.is_active ? null : el('button', { class: 'btn btn-sm btn-success', onclick: async () => { await api(`/api/admin/sessions/${r.id}/activate`, { method: 'POST' }); toast('Session activated.', 'success'); refresh(); } }, 'Activate'),
              el('button', { class: 'btn btn-sm btn-outline', onclick: () => editSession(r) }, 'Edit'),
              el('button', { class: 'btn btn-sm btn-danger', onclick: async () => { if (await confirmDialog(`Delete session "${r.name}"?`, { danger: true, okText: 'Delete' })) { try { await api(`/api/admin/sessions/${r.id}`, { method: 'DELETE' }); toast('Deleted.', 'success'); refresh(); } catch (e) { toast(e.message, 'error'); } } } }, 'Delete'))
          }
        ],
        rows, searchKeys: ['name']
      });
      const editSession = (r) => formModal({
        title: r ? 'Edit Session' : 'New Academic Session',
        fields: [
          { name: 'name', label: 'Session Name', required: true, value: r ? r.name : '', placeholder: 'e.g. 2026-27' },
          { name: 'start_date', label: 'Start Date', type: 'date', required: true, value: r ? r.start_date : '' },
          { name: 'end_date', label: 'End Date', type: 'date', required: true, value: r ? r.end_date : '' }
        ],
        onSubmit: v => r ? api(`/api/admin/sessions/${r.id}`, { method: 'PUT', body: v }) : api('/api/admin/sessions', { method: 'POST', body: v }).then(() => refresh())
      });
      return el('div', {},
        pageHead('Academic Sessions', el('button', { class: 'btn btn-primary', onclick: () => editSession(null) }, '+ New Session')),
        el('div', { class: 'card' }, table)
      );
    }
  },
  {
    path: '#/trades', label: 'Trades', icon: '🛠️', render: async () => {
      const rows = await api('/api/admin/trades');
      const refresh = () => renderRoute();
      const editTrade = (r) => formModal({
        title: r ? 'Edit Trade' : 'New Trade',
        fields: [
          { name: 'name', label: 'Trade Name', required: true, value: r ? r.name : '', placeholder: 'e.g. Fitter' },
          { name: 'code', label: 'Trade Code', required: true, value: r ? r.code : '', placeholder: 'e.g. FIT' },
          { name: 'is_active', label: 'Status', type: 'select', value: r ? String(Number(r.is_active)) : '1', options: [{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }] }
        ],
        onSubmit: v => {
          const body = { ...v, is_active: v.is_active === '1' };
          return r ? api(`/api/admin/trades/${r.id}`, { method: 'PUT', body }) : api('/api/admin/trades', { method: 'POST', body }).then(() => refresh());
        }
      });
      return el('div', {},
        pageHead('Trades', el('button', { class: 'btn btn-primary', onclick: () => editTrade(null) }, '+ New Trade')),
        el('div', { class: 'card' },
          dataTable({
            columns: [
              { label: 'Code', render: r => el('strong', {}, r.code) },
              { label: 'Trade', key: 'name' },
              { label: 'Trainees', key: 'trainee_count' },
              { label: 'Officers Assigned', key: 'officer_count' },
              { label: 'Status', render: r => r.is_active ? badge('active') : badge('inactive') },
              {
                label: 'Actions', className: 'actions', render: r => el('div', {},
                  el('button', { class: 'btn btn-sm btn-outline', onclick: () => editTrade(r) }, 'Edit'),
                  el('button', { class: 'btn btn-sm btn-danger', onclick: async () => { if (await confirmDialog(`Delete trade "${r.name}"?`, { danger: true, okText: 'Delete' })) { try { await api(`/api/admin/trades/${r.id}`, { method: 'DELETE' }); toast('Deleted.', 'success'); refresh(); } catch (e) { toast(e.message, 'error'); } } } }, 'Delete'))
              }
            ],
            rows, searchKeys: ['name', 'code']
          }))
      );
    }
  },
  {
    path: '#/officers', label: 'Training Officers', icon: '👨‍🏫', render: async () => {
      const trades = await api('/api/admin/trades');
      const officers = await api('/api/admin/officers');
      const refresh = () => renderRoute();
      const officerForm = (r) => formModal({
        title: r ? 'Edit Training Officer' : 'Create Training Officer',
        wide: true,
        fields: [
          { name: 'name', label: 'Full Name', required: true, value: r ? r.name : '' },
          { name: 'username', label: 'Username', required: true, value: r ? r.username : '' },
          { name: 'mobile', label: 'Mobile Number', required: true, value: r ? r.mobile : '', placeholder: '10-digit mobile' },
          { name: 'email', label: 'Email', type: 'email', value: r ? r.email || '' : '' },
          {
            name: 'password', label: r ? 'Reset Password (leave blank to keep)' : 'Password', type: 'password',
            required: !r, value: '', placeholder: r ? 'Leave blank to keep current' : 'Min 6 characters'
          },
          { name: 'is_active', label: 'Account Status', type: 'select', value: r ? String(Number(r.is_active)) : '1', options: [{ value: '1', label: 'Active' }, { value: '0', label: 'Deactivated' }] },
          {
            name: 'trade_ids', label: 'Assigned Trades', type: 'checkboxes', required: true, full: true,
            options: trades.map(t => ({ value: t.id, label: `${t.name} (${t.code})` })),
            value: r ? r.trades.map(t => t.id) : [], hint: 'Officer can only access trainees/data of assigned trades.'
          }
        ],
        onSubmit: v => {
          const body = { ...v, trade_ids: v.trade_ids.map(Number), is_active: v.is_active === '1' };
          if (r && !body.password) delete body.password;
          return r ? api(`/api/admin/officers/${r.id}`, { method: 'PUT', body }) : api('/api/admin/officers', { method: 'POST', body }).then(() => refresh());
        }
      });
      return el('div', {},
        pageHead('Training Officers', el('button', { class: 'btn btn-primary', onclick: () => officerForm(null) }, '+ Create Officer')),
        el('div', { class: 'card' },
          dataTable({
            columns: [
              { label: 'Name', render: r => el('div', {}, el('strong', {}, r.name), el('br'), el('small', {}, '@' + r.username)) },
              { label: 'Mobile', key: 'mobile' },
              { label: 'Email', key: 'email' },
              { label: 'Assigned Trades', render: r => el('div', { class: 'chip-row', style: 'margin:0' }, ...r.trades.map(t => el('span', { class: 'badge info' }, t.name))) },
              { label: 'Status', render: r => r.is_active ? badge('active') : badge('inactive') },
              {
                label: 'Actions', className: 'actions', render: r => el('div', {},
                  el('button', { class: 'btn btn-sm btn-outline', onclick: () => officerForm(r) }, 'Edit'),
                  el('button', { class: `btn btn-sm ${r.is_active ? 'btn-warning' : 'btn-success'}`, onclick: async () => { try { await api(`/api/admin/officers/${r.id}`, { method: 'PUT', body: { is_active: !r.is_active } }); toast(r.is_active ? 'Account deactivated.' : 'Account activated.', 'success'); refresh(); } catch (e) { toast(e.message, 'error'); } } }, r.is_active ? 'Deactivate' : 'Activate'),
                  el('button', { class: 'btn btn-sm btn-danger', onclick: async () => { if (await confirmDialog(`Delete officer "${r.name}"? This cannot be undone.`, { danger: true, okText: 'Delete' })) { try { await api(`/api/admin/officers/${r.id}`, { method: 'DELETE' }); toast('Deleted.', 'success'); refresh(); } catch (e) { toast(e.message, 'error'); } } } }, 'Delete'))
              }
            ],
            rows: officers, searchKeys: ['name', 'username', 'mobile', 'email'],
            filters: [{
              key: 'is_active', label: 'Status', options: [{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }]
            }]
          }))
      );
    }
  },
  {
    path: '#/settings', label: 'Settings', icon: '⚙️', render: async () => {
      const s = await api('/api/admin/settings');
      // Inline settings form (not a modal) for a better experience
      const errBox = el('div', { class: 'form-error hidden' });
      const fields = [
        { grp: 'Institute' },
        { name: 'org_name', label: 'Institute Name', value: s.org_name },
        { name: 'org_state', label: 'State', value: s.org_state },
        { name: 'working_days_per_month', label: 'Monthly Working Days', type: 'number', value: s.working_days_per_month, hint: 'Used in monthly reports / expectations' },
        { grp: 'Attendance Rules' },
        { name: 'attendance_start', label: 'Attendance Window Start', type: 'time', value: s.attendance_start, hint: 'Trainees can mark from this time' },
        { name: 'attendance_end', label: 'Attendance Window End', type: 'time', value: s.attendance_end, hint: 'Auto-absent applies after this time' },
        { name: 'auto_absent_enabled', label: 'Auto Mark Absent', type: 'select', value: s.auto_absent_enabled, options: [{ value: '1', label: 'Enabled (after window, Mon–Sat)' }, { value: '0', label: 'Disabled' }] },
        { name: 'warning_threshold_pct', label: 'Low Attendance Warning %', type: 'number', value: s.warning_threshold_pct, hint: 'Trainees below this % get warnings' },
        { grp: 'Leave Limits' },
        { name: 'cl_year_limit', label: 'Casual Leave / Year (days)', type: 'number', value: s.cl_year_limit },
        { name: 'ml_year_limit', label: 'Medical Leave / Year (days)', type: 'number', value: s.ml_year_limit },
        { name: 'half_day_month_limit', label: 'Half-Day Leave / Month', type: 'number', value: s.half_day_month_limit },
        { grp: 'Campus Geofence (GPS verification)' },
        { name: 'campus_name', label: 'Campus Name', value: s.campus_name, full: true },
        { name: 'campus_lat', label: 'Campus Latitude', value: s.campus_lat, hint: 'e.g. 21.897600' },
        { name: 'campus_lng', label: 'Campus Longitude', value: s.campus_lng, hint: 'e.g. 83.377700' },
        { name: 'campus_radius_m', label: 'Allowed Radius (metres)', type: 'number', value: s.campus_radius_m, hint: 'Attendance rejected outside this radius' }
      ];
      const wrap = el('form', { class: 'form-grid', onsubmit: e => e.preventDefault() });
      const inputs = {};
      for (const f of fields) {
        if (f.grp) { wrap.append(el('div', { class: 'full', style: 'grid-column:1/-1;margin:14px 0 4px;border-bottom:1px solid var(--line);padding-bottom:6px' }, el('strong', { style: 'color:var(--primary)' }, f.grp))); continue; }
        const control = f.type === 'select'
          ? el('select', {}, ...f.options.map(o => el('option', { value: o.value, selected: o.value === f.value }, o.label)))
          : el('input', { type: f.type || 'text', value: f.value ?? '' });
        control.dataset.name = f.name;
        inputs[f.name] = control;
        wrap.append(el('label', { class: `field ${f.full ? 'full' : ''}` }, el('span', {}, f.label), control, f.hint ? el('small', { style: 'color:var(--muted)' }, f.hint) : null));
      }
      const locateBtn = el('button', {
        class: 'btn btn-outline', type: 'button',
        onclick: async () => {
          locateBtn.disabled = true; locateBtn.textContent = 'Locating…';
          const g = await geolocate();
          locateBtn.disabled = false; locateBtn.textContent = '📍 Use my current location';
          if (g.state === 'ok') {
            inputs.campus_lat.value = g.lat.toFixed(6);
            inputs.campus_lng.value = g.lng.toFixed(6);
            toast('Coordinates filled from your device. Save to apply.', 'success');
          } else toast(g.message, 'error');
        }
      }, '📍 Use my current location');
      const saveBtn = el('button', { class: 'btn btn-primary' }, '💾 Save Settings');
      saveBtn.addEventListener('click', async () => {
        errBox.classList.add('hidden');
        const body = {};
        for (const [k, node] of Object.entries(inputs)) body[k] = node.value;
        saveBtn.disabled = true;
        try {
          await api('/api/admin/settings', { method: 'PUT', body });
          toast('Settings saved.', 'success');
          renderRoute();
        } catch (e) {
          errBox.textContent = e.message; errBox.classList.remove('hidden');
          saveBtn.disabled = false;
          window.scrollTo({ top: 0, behavior: 'smooth' });
        }
      });
      return el('div', {},
        pageHead('System Settings'),
        el('div', { class: 'notice info' }, 'These settings drive attendance rules, GPS verification, leave limits and reports across the application.'),
        el('div', { class: 'card' }, errBox, wrap,
          el('div', { class: 'full', style: 'grid-column:1/-1;display:flex;gap:10px;flex-wrap:wrap;margin-top:8px' }, locateBtn, saveBtn))
      );
    }
  },
  {
    path: '#/audit', label: 'Audit Log', icon: '🧾', render: async () => {
      let rows = await api('/api/admin/audit?limit=500');
      const table = dataTable({
        columns: [
          { label: 'ID', key: 'id', width: '56px' },
          { label: 'When', render: r => String(r.created_at).replace('T', ' ').slice(0, 16) },
          { label: 'Role', render: r => badge(r.role === 'admin' ? 'info' : r.role === 'officer' ? 'approved' : r.role === 'trainee' ? 'pending' : 'none') },
          { label: 'User', render: r => r.user_name || 'system' },
          { label: 'Action', render: r => el('strong', {}, r.action) },
          { label: 'Entity', render: r => `${r.entity || ''}${r.entity_id ? ' #' + r.entity_id : ''}` },
          { label: 'Detail', render: r => el('small', { title: r.detail || '' }, (r.detail || '').slice(0, 60) + ((r.detail || '').length > 60 ? '…' : '')) },
          { label: 'IP', key: 'ip' }
        ],
        rows, searchKeys: ['action', 'entity', 'user_name', 'detail'], emptyText: 'No audit entries'
      });
      return el('div', {},
        pageHead('Audit Log',
          el('button', { class: 'btn btn-outline btn-sm', onclick: () => auditDownload(rows, 'csv') }, '⬇ CSV')),
        el('div', { class: 'notice' }, 'Every login, create/update/delete, attendance correction, leave decision and settings change is recorded here with user, time and IP.'),
        el('div', { class: 'card' }, table)
      );
    }
  }
]);
