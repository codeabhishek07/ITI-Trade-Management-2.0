'use strict';
/* Training Officer pages — part 1: dashboard, trainees, attendance */

const OFFICER_TRADES_CACHE = { list: null };
async function officerTrades() {
  if (!OFFICER_TRADES_CACHE.list) {
    const d = await api('/api/officer/overview');
    OFFICER_TRADES_CACHE.list = d.trades;
  }
  return OFFICER_TRADES_CACHE.list;
}

registerRoutes('officer', [
  {
    path: '#/dashboard', label: 'Dashboard', icon: '📊', render: async () => {
      const d = await api('/api/officer/overview');
      const low = await api('/api/officer/low-attendance');
      return el('div', {},
        pageHead('Training Officer Dashboard'),
        el('div', { class: 'stats-grid' },
          statCard('My Trainees', d.trainees, { icon: '🎓' }),
          statCard('Present Today', d.present_today, { color: 'green', icon: '✅' }),
          statCard('Absent Today', d.absent_today, { color: 'red', icon: '❌' }),
          statCard('Pending Leaves', d.pending_leaves, { color: 'amber', icon: '📋' }),
          statCard('Low Attendance (<' + d.threshold + '%)', d.low_attendance, { color: 'red', icon: '⚠️' }),
          statCard('Pending Indents', d.pending_indents, { color: 'violet', icon: '📦' })
        ),
        el('div', { class: 'grid-2' },
          el('div', { class: 'card' },
            el('h3', {}, `⚠ Trainees Below ${d.threshold}% Attendance`),
            low.length
              ? dataTable({
                columns: [
                  { label: 'Roll No', key: 'roll_no' },
                  { label: 'Name', render: r => el('strong', {}, r.name) },
                  { label: 'Trade', key: 'trade_name' },
                  { label: 'Attendance', render: r => pctBar(r.pct) },
                  {
                    label: '', className: 'actions', render: r => el('button', {
                      class: 'btn btn-sm btn-warning',
                      onclick: () => warnModal(r)
                    }, 'Issue Warning')
                  }
                ],
                rows: low, searchKeys: ['name', 'roll_no'], emptyText: 'All trainees are above the threshold 🎉'
              })
              : el('div', { class: 'notice ok' }, 'All trainees are above the attendance threshold. 🎉')
          ),
          el('div', { class: 'card' },
            el('h3', {}, 'Quick Actions'),
            el('div', { style: 'display:grid;gap:10px' },
              el('button', { class: 'btn btn-primary', onclick: () => location.hash = '#/attendance' }, '📅 Mark / Correct Attendance'),
              el('button', { class: 'btn btn-outline', onclick: () => location.hash = '#/leave' }, '📝 Review Leave Requests'),
              el('button', { class: 'btn btn-outline', onclick: () => location.hash = '#/trainees' }, '+ Add Trainee'),
              el('button', { class: 'btn btn-outline', onclick: () => location.hash = '#/reports' }, '⬇ Generate Reports (PDF/Excel)'),
              el('button', { class: 'btn btn-outline', onclick: () => location.hash = '#/inventory' }, '📦 Inventory &amp; Indents')
            ),
            el('div', { class: 'notice mt' }, `Assigned trades: ${d.trades.map(t => t.name).join(', ') || '—'}. You can only access these trades.`)
          )
        )
      );
    }
  },
  {
    path: '#/trainees', label: 'Trainees', icon: '🎓', render: async () => {
      const trades = await officerTrades();
      const rows = await api('/api/officer/trainees');
      const refresh = () => renderRoute();
      const traineeForm = (r) => formModal({
        title: r ? 'Edit Trainee' : 'Add Trainee',
        wide: true,
        fields: [
          { name: 'name', label: 'Full Name', required: true, value: r ? r.name : '' },
          { name: 'roll_no', label: 'Roll Number', value: r ? r.roll_no || '' : '', placeholder: 'e.g. F-2026-001' },
          { name: 'username', label: 'Login Username', required: true, value: r ? r.username : '' },
          { name: 'mobile', label: 'Mobile', value: r ? r.mobile || '' : '', placeholder: '10-digit mobile' },
          { name: 'password', label: r ? 'Reset Password (optional)' : 'Password', type: 'password', required: !r, placeholder: r ? 'Leave blank to keep' : 'Min 6 characters' },
          { name: 'email', label: 'Email', type: 'email', value: r ? r.email || '' : '' },
          { name: 'trade_id', label: 'Trade', type: 'select', required: true, value: r ? r.trade_id : trades[0] && trades[0].id, options: trades.map(t => ({ value: t.id, label: t.name })) },
          { name: 'gender', label: 'Gender', type: 'select', value: r ? r.gender || '' : '', options: [{ value: '', label: '—' }, { value: 'Male', label: 'Male' }, { value: 'Female', label: 'Female' }, { value: 'Other', label: 'Other' }] },
          { name: 'guardian', label: 'Guardian Name', value: r ? r.guardian || '' : '', full: true },
          { name: 'is_active', label: 'Status', type: 'select', value: r ? String(Number(r.is_active)) : '1', options: [{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }] }
        ],
        onSubmit: v => {
          const body = { ...v, trade_id: Number(v.trade_id), is_active: v.is_active === '1' };
          if (r && !body.password) delete body.password;
          return r ? api(`/api/officer/trainees/${r.id}`, { method: 'PUT', body }) : api('/api/officer/trainees', { method: 'POST', body }).then(() => refresh());
        }
      });
      const viewTrainee = async (r) => {
        const att = await api(`/api/officer/attendance?date=${new Date().toISOString().slice(0, 10)}`);
        const pctData = await api(`/api/reports/percentage?trade_id=${r.trade_id}`);
        const me = pctData.rows.find(x => x.id === r.id);
        const warns = await api(`/api/officer/warnings?trainee_id=${r.id}`);
        modal({
          title: `${r.name} (${r.roll_no || '—'})`,
          wide: true,
          body: el('div', {},
            el('dl', { class: 'kv' },
              el('dt', {}, 'Trade'), el('dd', {}, r.trade_name),
              el('dt', {}, 'Session'), el('dd', {}, r.session_name || '—'),
              el('dt', {}, 'Username'), el('dd', {}, r.username),
              el('dt', {}, 'Mobile'), el('dd', {}, r.mobile || '—'),
              el('dt', {}, 'Email'), el('dd', {}, r.email || '—'),
              el('dt', {}, 'Guardian'), el('dd', {}, r.guardian || '—'),
              el('dt', {}, 'Overall Attendance'), el('dd', {}, me ? pctBar(me.pct) : '—'),
              el('dt', {}, 'Status'), el('dd', {}, r.is_active ? badge('active') : badge('inactive'))
            ),
            el('h4', { class: 'mt' }, 'Warnings issued'),
            warns.length ? el('ul', {}, ...warns.map(w => el('li', { style: 'margin-bottom:6px' }, el('small', {}, `${fmtDate(w.created_at)} · ${w.attendance_pct}%`), el('br'), w.message)))
              : el('small', { style: 'color:var(--muted)' }, 'No warnings issued.'),
            el('div', { class: 'notice info mt' }, 'Full history is available under Reports → Attendance Percentage.')
          ),
          footer: [el('button', { class: 'btn btn-ghost', onclick: () => { $$('.modal-backdrop').forEach(m => m.remove()); } }, 'Close')]
        });
      };
      return el('div', {},
        pageHead('Trainees',
          el('button', { class: 'btn btn-outline btn-sm', onclick: () => downloadFile(`/api/reports/trainees?format=csv`, 'trainees.csv').catch(e => toast(e.message, 'error')) }, '⬇ Excel'),
          el('button', { class: 'btn btn-outline btn-sm', onclick: () => downloadFile(`/api/reports/trainees?format=pdf`, 'trainees.pdf').catch(e => toast(e.message, 'error')) }, '⬇ PDF'),
          el('button', { class: 'btn btn-primary', onclick: () => traineeForm(null) }, '+ Add Trainee')),
        el('div', { class: 'card' },
          dataTable({
            columns: [
              { label: 'Roll No', key: 'roll_no' },
              { label: 'Name', render: r => el('div', { style: 'cursor:pointer', onclick: () => viewTrainee(r) }, el('u', {}, r.name)) },
              { label: 'Username', key: 'username' },
              { label: 'Trade', key: 'trade_name' },
              { label: 'Mobile', key: 'mobile' },
              { label: 'Status', render: r => r.is_active ? badge('active') : badge('inactive') },
              {
                label: 'Actions', className: 'actions', render: r => el('div', {},
                  el('button', { class: 'btn btn-sm btn-outline', onclick: () => traineeForm(r) }, 'Edit'),
                  el('button', { class: `btn btn-sm ${r.is_active ? 'btn-warning' : 'btn-success'}`, onclick: async () => { try { await api(`/api/officer/trainees/${r.id}`, { method: 'PUT', body: { is_active: !r.is_active } }); toast('Updated.', 'success'); refresh(); } catch (e) { toast(e.message, 'error'); } } }, r.is_active ? 'Deactivate' : 'Activate'),
                  el('button', { class: 'btn btn-sm btn-danger', onclick: async () => { if (await confirmDialog(`Delete trainee "${r.name}"` + ' and ALL their attendance/leave history?', { danger: true, okText: 'Delete' })) { try { await api(`/api/officer/trainees/${r.id}`, { method: 'DELETE' }); toast('Deleted.', 'success'); refresh(); } catch (e) { toast(e.message, 'error'); } } } }, 'Delete'))
              }
            ],
            rows, searchKeys: ['name', 'roll_no', 'username', 'mobile'],
            filters: [
              { key: 'trade_id', label: 'Trade', options: trades.map(t => ({ value: t.id, label: t.name })) },
              { key: 'is_active', label: 'Status', options: [{ value: '1', label: 'Active' }, { value: '0', label: 'Inactive' }] }
            ],
            onRowClick: viewTrainee
          }))
      );
    }
  },
  {
    path: '#/attendance', label: 'Attendance', icon: '📅', render: async () => {
      const trades = await officerTrades();
      const state = { date: new Date().toISOString().slice(0, 10), trade_id: '' };
      const page = el('div', {});

      const fetchData = async () => {
        const q = new URLSearchParams({ date: state.date });
        if (state.trade_id) q.set('trade_id', state.trade_id);
        return api('/api/officer/attendance?' + q);
      };

      const header = (d) => {
        const base = `/api/reports/daily?date=${state.date}${state.trade_id ? '&trade_id=' + state.trade_id : ''}`;
        return [
          pageHead('Daily Attendance',
            downloadBtn(`${base}&format=csv`, 'Excel/CSV', `attendance-${state.date}.csv`),
            downloadBtn(`${base}&format=pdf`, 'PDF', `attendance-${state.date}.pdf`)),
          el('div', { class: 'toolbar' },
            el('input', { type: 'date', value: state.date, onchange: e => { state.date = e.target.value; reload(); } }),
            el('select', { onchange: e => { state.trade_id = e.target.value; reload(); } },
              el('option', { value: '' }, 'All my trades'),
              ...trades.map(t => el('option', { value: t.id, selected: String(t.id) === state.trade_id }, t.name))),
            el('span', { class: 'window-pill' }, `Attendance window: ${d.window.start} – ${d.window.end}`),
            el('div', { style: 'flex:1' }),
            el('button', {
              class: 'btn btn-success btn-sm',
              onclick: () => { for (const r of d.rows) r._new = 'present'; redraw(d); }
            }, '✅ Mark all Present'),
            el('button', {
              class: 'btn btn-primary', onclick: async () => {
                const entries = d.rows.filter(r => r._new !== undefined && r._new !== (r.status || '')).map(r => ({ trainee_id: r.trainee_id, status: r._new }));
                if (!entries.length) { toast('No changes to save.', 'info'); return; }
                try {
                  await api('/api/officer/attendance/bulk', { method: 'POST', body: { date: state.date, entries } });
                  toast(`${entries.length} record(s) saved.`, 'success');
                  reload();
                } catch (e) { toast(e.message, 'error'); }
              }
            }, '💾 Save Changes')
          )
        ];
      };

      const sheet = (d) => el('div', { class: 'card' },
        dataTable({
          columns: [
            { label: 'Roll No', key: 'roll_no' },
            { label: 'Name', render: r => el('strong', {}, r.name) },
            { label: 'Trade', key: 'trade_name' },
            { label: 'Current', render: r => badge(r.status) },
            {
              label: 'Set Status',
              render: r => el('select', {
                onchange: e => {
                  r._new = e.target.value;
                  const dirty = r._new !== (r.status || '');
                  e.target.style.borderColor = dirty ? 'var(--primary)' : '';
                  e.target.style.background = dirty ? 'var(--primary-soft)' : '';
                }
              },
                ...['', 'present', 'absent', 'cl', 'ml', 'half_day'].map(v =>
                  el('option', { value: v, selected: v === (r._new !== undefined ? r._new : (r.status || '')) }, v ? statusLabel(v) : 'Not Marked')))
            },
            {
              label: 'Record Info', render: r => r.marked_at
                ? el('small', { style: 'color:var(--muted)' },
                  `${String(r.marked_at).slice(11, 16)} · ${r.source}` +
                  (r.distance_m != null ? ` · ${Math.round(r.distance_m)} m` : '') + (r.corrected ? ' · corrected' : ''))
                : el('small', { style: 'color:var(--muted)' }, '—')
            },
            {
              label: '', className: 'actions', render: r => r.attendance_id
                ? el('button', {
                  class: 'btn btn-sm btn-ghost', title: 'Delete record',
                  onclick: async () => {
                    if (await confirmDialog(`Delete attendance record of ${r.name} on ${state.date}?`, { danger: true, okText: 'Delete' })) {
                      try { await api(`/api/officer/attendance/${r.attendance_id}`, { method: 'DELETE' }); toast('Deleted.', 'success'); reload(); }
                      catch (e) { toast(e.message, 'error'); }
                    }
                  }
                }, '🗑')
                : null
            }
          ],
          rows: d.rows, searchKeys: ['name', 'roll_no'], emptyText: 'No trainees in scope'
        }),
        el('div', { class: 'notice mt' },
          'Statuses: Present · Absent · Casual Leave (CL) · Medical Leave (ML) · Half-Day. Every correction is recorded in the audit trail with your name and time.')
      );

      function redraw(d) {
        page.innerHTML = '';
        page.append(...header(d), sheet(d));
      }
      async function reload() { redraw(await fetchData()); }
      await reload();
      return page;
    }
  }
]);

/* ---------- Warnings modal (shared) ---------- */
async function warnModal(trainee) {
  formModal({
    title: `Issue Warning — ${trainee.name}`,
    fields: [
      { name: 'message', label: 'Warning Message', type: 'textarea', required: true, full: true, rows: 4, value: `Your attendance is ${trainee.pct}%, which is below the required 80%. Improve immediately or face detention.` },
      { name: 'period', label: 'Period', value: 'Current session' },
      { name: 'force', label: 'Allow even if above threshold', type: 'select', value: '0', options: [{ value: '0', label: 'No (enforce 80% rule)' }, { value: '1', label: 'Yes, issue anyway' }] }
    ],
    onSubmit: async v => {
      await api('/api/officer/warnings', { method: 'POST', body: { trainee_id: trainee.id, message: v.message, period: v.period, force: v.force === '1' } });
      if (location.hash === '#/dashboard' || location.hash === '#/warnings') setTimeout(renderRoute, 100);
    }
  });
}

registerRoutes('officer', [
  {
    path: '#/leave', label: 'Leave Requests', icon: '📝', render: async () => {
      const trades = await officerTrades();
      const state = { status: 'pending' };
      const page = el('div', {});
      const reviewModal = (r, action) => {
        const isApprove = action === 'approve';
        formModal({
          title: `${isApprove ? 'Approve' : 'Reject'} Leave — ${r.trainee_name}`,
          fields: [
            { name: 'summary', label: 'Request', type: 'static', full: true, value: `${r.type} · ${r.from_date} to ${r.to_date} · ${r.days} day(s) — "${r.reason}"` },
            { name: 'note', label: 'Note to trainee', type: 'textarea', full: true, rows: 3, value: isApprove ? 'Approved by Training Officer.' : 'Rejected — insufficient reason / duty requirements.' }
          ],
          submitText: isApprove ? '✅ Approve' : '❌ Reject',
          onSubmit: async v => {
            await api(`/api/officer/leave/${r.id}/review`, { method: 'POST', body: { action, note: v.note } });
            toast(`Leave ${action === 'approve' ? 'approved' : 'rejected'}.`, 'success');
            load();
          }
        });
      };
      const load = async () => {
        const rows = await api('/api/officer/leave' + (state.status ? `?status=${state.status}` : ''));
        page.innerHTML = '';
        page.append(
          pageHead('Leave Requests'),
          el('div', { class: 'chip-row' },
            ...[['pending', 'Pending'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['', 'All']].map(([v, l]) =>
              el('button', { class: `chip ${state.status === v ? 'active' : ''}`, onclick: () => { state.status = v; load(); } }, l))),
          el('div', { class: 'card' },
            dataTable({
              columns: [
                { label: 'Trainee', render: r => el('div', {}, el('strong', {}, r.trainee_name), el('br'), el('small', {}, r.roll_no || '')) },
                { label: 'Trade', key: 'trade_name' },
                { label: 'Type', render: r => badge(r.type === 'HALF_DAY' ? 'half_day' : r.type.toLowerCase()) },
                { label: 'From', key: 'from_date' },
                { label: 'To', key: 'to_date' },
                { label: 'Days', key: 'days' },
                { label: 'Reason', render: r => el('span', { title: r.reason }, String(r.reason).slice(0, 40) + (String(r.reason).length > 40 ? '…' : '')) },
                { label: 'Status', render: r => badge(r.status) },
                {
                  label: 'Actions', className: 'actions', render: r => r.status === 'pending'
                    ? el('div', {},
                      el('button', { class: 'btn btn-sm btn-success', onclick: () => reviewModal(r, 'approve') }, 'Approve'),
                      el('button', { class: 'btn btn-sm btn-danger', onclick: () => reviewModal(r, 'reject') }, 'Reject'))
                    : el('small', { style: 'color:var(--muted)' }, r.reviewer_name ? `by ${r.reviewer_name}` : '')
                }
              ],
              rows, searchKeys: ['trainee_name', 'roll_no', 'reason'],
              filters: [{ key: 'trade_id', label: 'Trade', options: trades.map(t => ({ value: t.id, label: t.name })) }],
              emptyText: 'No leave requests'
            }))
        );
      };
      await load();
      return page;
    }
  },
  {
    path: '#/warnings', label: 'Warnings', icon: '⚠️', render: async () => {
      const low = await api('/api/officer/low-attendance');
      const rows = await api('/api/officer/warnings');
      const load = () => renderRoute();
      return el('div', {},
        pageHead('Attendance Warnings',
          downloadBtn('/api/reports/warnings?format=csv', 'Excel/CSV', 'warnings.csv'),
          downloadBtn('/api/reports/warnings?format=pdf', 'PDF', 'warnings.pdf')),
        el('div', { class: 'card' },
          el('h3', {}, 'Trainees below threshold'),
          low.length
            ? dataTable({
              columns: [
                { label: 'Roll No', key: 'roll_no' },
                { label: 'Name', render: r => el('strong', {}, r.name) },
                { label: 'Trade', key: 'trade_name' },
                { label: 'Working Days', key: 'working' },
                { label: 'Attendance', render: r => pctBar(r.pct) },
                { label: '', className: 'actions', render: r => el('button', { class: 'btn btn-sm btn-warning', onclick: () => warnModal(r) }, 'Issue Warning') }
              ],
              rows: low, searchKeys: ['name', 'roll_no'], emptyText: 'Nobody below threshold 🎉'
            })
            : el('div', { class: 'notice ok' }, 'No trainees below the attendance threshold.')
        ),
        el('div', { class: 'card' },
          el('h3', {}, 'Issued warnings'),
          dataTable({
            columns: [
              { label: '#', key: 'id', width: '50px' },
              { label: 'Trainee', render: r => el('strong', {}, r.trainee_name) },
              { label: 'Trade', key: 'trade_name' },
              { label: 'At %', render: r => `${r.attendance_pct}%` },
              { label: 'Message', key: 'message' },
              { label: 'Issued By', key: 'issued_by_name' },
              { label: 'Date', render: r => fmtDate(r.created_at) },
              {
                label: '', className: 'actions', render: r => el('button', {
                  class: 'btn btn-sm btn-danger',
                  onclick: async () => { if (await confirmDialog('Delete this warning?', { danger: true, okText: 'Delete' })) { try { await api(`/api/officer/warnings/${r.id}`, { method: 'DELETE' }); toast('Deleted.', 'success'); load(); } catch (e) { toast(e.message, 'error'); } } }
                }, 'Delete')
              }
            ],
            rows, searchKeys: ['trainee_name', 'message'], emptyText: 'No warnings issued yet'
          }))
      );
    }
  }
]);

registerRoutes('officer', [
  {
    path: '#/inventory', label: 'Inventory & Indents', icon: '📦', render: async () => {
      const trades = await officerTrades();
      const items = await api('/api/officer/inventory');
      const indents = await api('/api/officer/indents');
      const txns = await api('/api/officer/inventory/txns');
      const load = () => renderRoute();

      const itemForm = (r) => formModal({
        title: r ? 'Edit Item' : 'Add Inventory Item',
        fields: [
          { name: 'name', label: 'Item Name', required: true, value: r ? r.name : '' },
          { name: 'category', label: 'Category', value: r ? r.category || '' : '', placeholder: 'Hand Tools / Consumable…' },
          { name: 'unit', label: 'Unit', required: true, value: r ? r.unit : 'pcs', placeholder: 'pcs / kg / set' },
          { name: 'opening_qty', label: 'Opening Stock', type: 'number', value: r ? r.opening_qty : 0, min: 0, step: '0.01' },
          { name: 'min_level', label: 'Minimum Level (alert below)', type: 'number', value: r ? r.min_level : 0, min: 0, step: '0.01' },
          { name: 'rate', label: 'Rate (Rs.)', type: 'number', value: r ? r.rate : 0, min: 0, step: '0.01' }
        ],
        onSubmit: v => r
          ? api(`/api/officer/inventory/${r.id}`, { method: 'PUT', body: v }).then(() => load())
          : api('/api/officer/inventory', { method: 'POST', body: v }).then(() => load())
      });

      const txnModal = (item) => formModal({
        title: `Stock Entry — ${item.name} (${item.available} ${item.unit} available)`,
        fields: [
          {
            name: 'txn_type', label: 'Entry Type', type: 'select', value: 'issue',
            options: [
              { value: 'issue', label: 'Issue (out)' },
              { value: 'return', label: 'Return (in)' },
              { value: 'usage', label: 'Usage consumed (out)' },
              { value: 'damage', label: 'Damaged (out)' },
              { value: 'stock_add', label: 'Add new stock (in)' }
            ]
          },
          { name: 'qty', label: `Quantity (${item.unit})`, type: 'number', required: true, min: '0.01', step: '0.01', value: 1 },
          { name: 'trade_id', label: 'For Trade', type: 'select', value: trades[0] && trades[0].id, options: trades.map(t => ({ value: t.id, label: t.name })) },
          { name: 'remarks', label: 'Remarks', full: true, placeholder: 'Issued to / purpose / condition' }
        ],
        submitText: 'Save Entry',
        onSubmit: async v => {
          await api(`/api/officer/inventory/${item.id}/txn`, { method: 'POST', body: { ...v, qty: Number(v.qty), trade_id: Number(v.trade_id) } });
          load();
        }
      });

      const indentModal = () => formModal({
        title: 'New Indent Register Entry',
        wide: true,
        fields: [
          { name: 'trade_id', label: 'Trade', type: 'select', required: true, value: trades[0] && trades[0].id, options: trades.map(t => ({ value: t.id, label: t.name })) },
          { name: 'register_date', label: 'Date', type: 'date', required: true, value: new Date().toISOString().slice(0, 10) },
          {
            name: 'items', label: 'Items (ID:QTY, comma separated)', required: true, full: true,
            placeholder: '1:2, 6:10',
            hint: 'Item IDs: ' + items.map(i => `${i.id}→${i.name}`).join(', ')
          }
        ],
        submitText: 'Create Indent',
        onSubmit: async v => {
          const parsed = String(v.items).split(',').map(part => {
            const m = part.trim().match(/^(\d+)\s*[:x]\s*(\d+(?:\.\d+)?)$/);
            return m ? { item_id: Number(m[1]), qty: Number(m[2]) } : null;
          }).filter(Boolean);
          if (!parsed.length) throw new Error('Format: ID:QTY separated by commas (e.g. 1:2, 6:10).');
          await api('/api/officer/indents', { method: 'POST', body: { trade_id: Number(v.trade_id), register_date: v.register_date, items: parsed } });
          load();
        }
      });

      const reviewIndent = (g, action) => formModal({
        title: `${action === 'issue' ? 'Issue' : 'Reject'} Indent #${g.id}`,
        fields: [
          { name: 'summary', type: 'static', full: true, label: 'Indent', value: g.items.map(it => { const i = items.find(x => x.id === it.item_id); return `${i ? i.name : '#' + it.item_id}: ${it.qty}`; }).join(' · ') },
          { name: 'note', label: 'Note', value: action === 'issue' ? 'Issued from store.' : 'Stock not available.' }
        ],
        submitText: action === 'issue' ? '✅ Issue Stock' : '❌ Reject',
        onSubmit: async v => {
          await api(`/api/officer/indents/${g.id}/review`, { method: 'POST', body: { action, note: v.note } });
          toast(action === 'issue' ? 'Indent issued — stock updated.' : 'Indent rejected.', 'success');
          load();
        }
      });

      return el('div', {},
        pageHead('Inventory & Indent Registers',
          downloadBtn('/api/reports/inventory?format=csv', 'Excel/CSV', 'inventory.csv'),
          downloadBtn('/api/reports/inventory?format=pdf', 'PDF', 'inventory.pdf'),
          el('button', { class: 'btn btn-primary', onclick: () => itemForm(null) }, '+ Add Item'),
          el('button', { class: 'btn btn-success', onclick: indentModal }, '+ New Indent')),

        el('div', { class: 'stats-grid' },
          statCard('Items', items.length, { icon: '🧰' }),
          statCard('Pending Indents', indents.filter(i => i.status === 'pending').length, { color: 'amber', icon: '📝' }),
          statCard('Low Stock Items', items.filter(i => i.low).length, { color: 'red', icon: '⚠️' }),
          statCard('Total Movements', txns.length, { color: 'violet', icon: '🔄' })),

        items.some(i => i.low) ? el('div', { class: 'notice' }, '⚠ Low stock: ' + items.filter(i => i.low).map(i => i.name).join(', ')) : null,

        el('div', { class: 'card' },
          el('h3', {}, 'Tools & Equipment Stock'),
          dataTable({
            columns: [
              { label: 'Item', render: r => el('strong', {}, r.name) },
              { label: 'Category', key: 'category' },
              { label: 'Unit', key: 'unit' },
              { label: 'Opening', key: 'opening_qty' },
              { label: 'Issued Out', key: 'issued' },
              { label: 'Used', key: 'used' },
              { label: 'Damaged', key: 'damaged' },
              { label: 'Available', render: r => el('span', { class: `badge ${r.low ? 'low' : 'present'}` }, `${r.available} ${r.unit}`) },
              {
                label: 'Actions', className: 'actions', render: r => el('div', {},
                  el('button', { class: 'btn btn-sm btn-primary', onclick: () => txnModal(r) }, 'Entry'),
                  el('button', { class: 'btn btn-sm btn-outline', onclick: () => itemForm(r) }, 'Edit'))
              }
            ],
            rows: items, searchKeys: ['name', 'category'], emptyText: 'No inventory items yet'
          })),

        el('div', { class: 'card' },
          el('h3', {}, 'Indent Registers'),
          dataTable({
            columns: [
              { label: '#', key: 'id', width: '50px' },
              { label: 'Date', key: 'register_date' },
              { label: 'Trade', key: 'trade_name' },
              { label: 'Items', render: r => r.items.map(it => { const i = items.find(x => x.id === it.item_id); return `${i ? i.name : '#' + it.item_id} × ${it.qty}`; }).join(', ') },
              { label: 'By', key: 'indenter_name' },
              { label: 'Status', render: r => badge(r.status) },
              {
                label: 'Actions', className: 'actions', render: r => r.status === 'pending'
                  ? el('div', {},
                    el('button', { class: 'btn btn-sm btn-success', onclick: () => reviewIndent(r, 'issue') }, 'Issue'),
                    el('button', { class: 'btn btn-sm btn-danger', onclick: () => reviewIndent(r, 'reject') }, 'Reject'))
                  : el('small', { style: 'color:var(--muted)' }, r.issue_note || '')
              }
            ],
            rows: indents, searchKeys: ['trade_name'], emptyText: 'No indents'
          })),

        el('div', { class: 'card' },
          el('h3', {}, 'Recent Stock Movements'),
          dataTable({
            columns: [
              { label: 'When', render: r => String(r.created_at).replace('T', ' ').slice(0, 16) },
              { label: 'Item', key: 'item_name' },
              { label: 'Type', render: r => badge({ issue: 'absent', return: 'present', usage: 'pending', damage: 'rejected', stock_add: 'info' }[r.txn_type] || 'none') },
              { label: 'Qty', render: r => `${r.qty} ${r.unit}` },
              { label: 'Trade', key: 'trade_name' },
              { label: 'Remarks', key: 'remarks' },
              { label: 'By', key: 'created_by_name' }
            ],
            rows: txns, searchKeys: ['item_name', 'remarks'], emptyText: 'No movements yet'
          }))
      );
    }
  }
]);

registerRoutes('officer', [
  {
    path: '#/papers', label: 'Question Papers', icon: '📄', render: async () => {
      const trades = await officerTrades();
      const rows = await api('/api/officer/papers');
      const load = () => renderRoute();

      const paperForm = (r) => {
        const pd = r ? r.paper_data : { questions: [{ text: '', marks: 5 }] };
        const list = el('div', {}, ...pd.questions.map((q, i) => qRow(q, i)));
        function qRow(q, i) {
          const ta = el('textarea', { rows: 2, placeholder: 'Question text…' }, q.text || '');
          const mk = el('input', { type: 'number', min: '1', value: q.marks || 1, style: 'width:90px' });
          const row = el('div', { class: 'q-item' },
            el('div', { class: 'q-head' }, el('span', {}, `Question ${i + 1}`),
              el('button', { class: 'btn btn-sm btn-danger', type: 'button', onclick: () => { row.remove(); renumber(); } }, 'Remove')),
            ta, el('label', { class: 'field', style: 'margin:8px 0 0;max-width:160px' }, el('span', {}, 'Marks'), mk));
          row._ta = ta; row._mk = mk;
          return row;
        }
        function renumber() { $$('.q-item', list).forEach((r2, i) => { $('.q-head span', r2).textContent = `Question ${i + 1}`; }); }
        formModal({
          title: r ? 'Edit Question Paper' : 'Create Question Paper',
          wide: true,
          fields: [
            { name: 'title', label: 'Paper Title', required: true, value: r ? r.title : '', full: true, placeholder: 'e.g. Fitter Theory — Unit Test 2' },
            { name: 'subject', label: 'Subject', value: r ? r.subject || '' : '' },
            { name: 'session_name', label: 'Session', value: r ? r.session_name || '' : '', placeholder: '2025-26' },
            { name: 'trade_id', label: 'Trade', type: 'select', required: true, value: r ? r.trade_id : trades[0] && trades[0].id, options: trades.map(t => ({ value: t.id, label: t.name })) },
            { name: 'duration_min', label: 'Duration (minutes)', type: 'number', value: r ? r.duration_min : 120, min: '15' }
          ],
          submitText: 'Save Paper',
          onSubmit: async (v) => {
            const questions = $$('.q-item', list).map(r2 => ({ text: r2._ta.value.trim(), marks: Number(r2._mk.value) })).filter(q => q.text);
            if (!questions.length) throw new Error('Add at least one question.');
            const body = { ...v, trade_id: Number(v.trade_id), duration_min: Number(v.duration_min), paper_data: { questions } };
            await (r ? api(`/api/officer/papers/${r.id}`, { method: 'PUT', body }) : api('/api/officer/papers', { method: 'POST', body }));
            load();
          }
        });
        setTimeout(() => {
          const body = $('.modal-body');
          if (!body) return;
          body.append(el('h4', { class: 'mt' }, 'Questions'), list,
            el('button', {
              class: 'btn btn-outline btn-sm', type: 'button',
              onclick: () => list.append(qRow({ text: '', marks: 5 }, $$('.q-item', list).length))
            }, '+ Add Question'));
        }, 80);
      };

      const viewPaper = (r) => modal({
        title: r.title,
        wide: true,
        body: el('div', {},
          el('dl', { class: 'kv' },
            el('dt', {}, 'Subject'), el('dd', {}, r.subject || '—'),
            el('dt', {}, 'Trade'), el('dd', {}, r.trade_name),
            el('dt', {}, 'Duration'), el('dd', {}, `${r.duration_min} minutes`),
            el('dt', {}, 'Total Marks'), el('dd', {}, r.total_marks)),
          el('hr', { style: 'border:none;border-top:1px solid var(--line);margin:14px 0' }),
          ...r.paper_data.questions.map((q, i) => el('div', { class: 'q-item' },
            el('div', { class: 'q-head' }, el('span', {}, `Q${i + 1}`), el('strong', {}, `[${q.marks}] marks`)),
            el('div', {}, q.text)))
        ),
        footer: [el('button', { class: 'btn btn-ghost', onclick: () => $$('.modal-backdrop').forEach(m => m.remove()) }, 'Close')]
      });

      return el('div', {},
        pageHead('Examination Question Papers',
          el('button', { class: 'btn btn-primary', onclick: () => paperForm(null) }, '+ Create Paper')),
        el('div', { class: 'card' },
          dataTable({
            columns: [
              { label: 'Title', render: r => el('strong', { style: 'cursor:pointer', onclick: () => viewPaper(r) }, r.title) },
              { label: 'Subject', key: 'subject' },
              { label: 'Trade', key: 'trade_name' },
              { label: 'Session', key: 'session_name' },
              { label: 'Qs', render: r => r.paper_data.questions.length },
              { label: 'Marks', key: 'total_marks' },
              { label: 'Duration', render: r => `${r.duration_min}m` },
              {
                label: 'Actions', className: 'actions', render: r => el('div', {},
                  el('button', { class: 'btn btn-sm btn-outline', onclick: () => viewPaper(r) }, 'View'),
                  el('button', { class: 'btn btn-sm btn-outline', onclick: () => paperForm(r) }, 'Edit'),
                  el('button', {
                    class: 'btn btn-sm btn-danger',
                    onclick: async () => { if (await confirmDialog(`Delete paper "${r.title}"?`, { danger: true, okText: 'Delete' })) { try { await api(`/api/officer/papers/${r.id}`, { method: 'DELETE' }); toast('Deleted.', 'success'); load(); } catch (e) { toast(e.message, 'error'); } } }
                  }, 'Delete'))
              }
            ],
            rows, searchKeys: ['title', 'subject'], emptyText: 'No question papers created yet'
          }),
          el('div', { class: 'notice info mt' }, 'Papers are stored in the database and scoped to your assigned trades only.'))
      );
    }
  }
]);

function renderReportPreview(title, data) {
  if (title.startsWith('Daily')) {
    const s = data.summary || {};
    return el('div', {},
      el('div', { class: 'stats-grid' },
        statCard('Present', s.present || 0, { color: 'green' }),
        statCard('Absent', s.absent || 0, { color: 'red' }),
        statCard('Leaves (CL/ML)', `${(s.cl || 0) + (s.ml || 0)}`, { color: 'amber' }),
        statCard('Half Day', s.half_day || 0, { color: 'violet' })),
      dataTable({
        columns: [
          { label: 'Roll No', render: r => r.roll_no || '—' },
          { label: 'Name', key: 'name' },
          { label: 'Trade', key: 'trade_name' },
          { label: 'Status', render: r => badge(r.status) },
          { label: 'Time', render: r => r.marked_at ? String(r.marked_at).slice(11, 16) : '—' },
          { label: 'Source', key: 'source' }
        ],
        rows: data.rows, searchKeys: ['name', 'roll_no'], emptyText: 'No records'
      }));
  }
  if (title.startsWith('Monthly')) {
    return dataTable({
      columns: [
        { label: 'Roll No', render: r => r.roll_no || '—' }, { label: 'Name', key: 'name' },
        { label: 'Trade', key: 'trade_name' },
        { label: 'Present', key: 'present' }, { label: 'Absent', key: 'absent' },
        { label: 'CL', key: 'cl' }, { label: 'ML', key: 'ml' }, { label: 'Half', key: 'half_day' },
        { label: 'Not Marked', key: 'none' },
        { label: 'Attendance %', render: r => pctBar(r.pct) }
      ],
      rows: data.rows, searchKeys: ['name', 'roll_no'], emptyText: 'No records'
    });
  }
  if (title.startsWith('Attendance %')) {
    return dataTable({
      columns: [
        { label: 'Roll No', render: r => r.roll_no || '—' }, { label: 'Name', key: 'name' },
        { label: 'Trade', key: 'trade_name' }, { label: 'Working Days', key: 'working' },
        { label: 'Approved Leaves', key: 'leaves' },
        { label: 'Attendance %', render: r => pctBar(r.pct) },
        { label: 'Status', render: r => r.below ? badge('absent') : badge('present') }
      ],
      rows: data.rows, searchKeys: ['name', 'roll_no'], emptyText: 'No records'
    });
  }
  if (title.startsWith('Trainee')) {
    return dataTable({
      columns: [
        { label: 'Roll No', render: r => r.roll_no || '—' }, { label: 'Name', key: 'name' },
        { label: 'Trade', key: 'trade_name' }, { label: 'Session', key: 'session_name' },
        { label: 'Mobile', key: 'mobile' }, { label: 'Username', key: 'username' },
        { label: 'Status', render: r => r.is_active ? badge('active') : badge('inactive') }
      ],
      rows: data.rows, searchKeys: ['name', 'roll_no', 'mobile'], emptyText: 'No records'
    });
  }
  if (title.startsWith('Leave')) {
    return dataTable({
      columns: [
        { label: '#', key: 'id' }, { label: 'Trainee', key: 'trainee_name' },
        { label: 'Type', key: 'type' }, { label: 'From', key: 'from_date' },
        { label: 'To', key: 'to_date' }, { label: 'Days', key: 'days' },
        { label: 'Status', render: r => badge(r.status) }, { label: 'Reason', key: 'reason' }
      ],
      rows: data.rows, searchKeys: ['trainee_name', 'reason'], emptyText: 'No records'
    });
  }
  if (title.startsWith('Inventory')) {
    return dataTable({
      columns: [
        { label: 'Item', key: 'name' }, { label: 'Unit', key: 'unit' },
        { label: 'Opening', key: 'opening_qty' }, { label: 'Issued', key: 'issued' },
        { label: 'Used', key: 'used' }, { label: 'Damaged', key: 'damaged' },
        { label: 'Available', key: 'available' },
        { label: 'Status', render: r => r.low ? badge('low') : badge('ok') }
      ],
      rows: data.rows, searchKeys: ['name'], emptyText: 'No items'
    });
  }
  return el('pre', { style: 'white-space:pre-wrap' }, JSON.stringify(data, null, 1).slice(0, 3000));
}

registerRoutes('officer', [
  {
    path: '#/reports', label: 'Reports', icon: '📥', render: async () => {
      const trades = await officerTrades();
      const today = new Date().toISOString().slice(0, 10);

      const reportCard = (title, desc, buildQuery, stateObj) => {
        const status = el('div', { class: 'count-note' });
        const preview = el('div', {});
        const run = async (fmt) => {
          const q = buildQuery(stateObj) + `&format=${fmt}`;
          try {
            if (fmt === 'csv' || fmt === 'pdf') {
              await downloadFile('/api/reports/' + q, `${title.toLowerCase().replace(/[^a-z]+/g, '-')}-${today}.${fmt}`);
              toast(`${title} downloaded.`, 'success');
              return;
            }
            status.textContent = 'Loading preview…';
            const data = await api('/api/reports/' + q);
            status.textContent = '';
            preview.innerHTML = '';
            preview.append(renderReportPreview(title, data));
          } catch (e) { status.textContent = ''; toast(e.message, 'error'); }
        };
        const fields = el('div', { class: 'toolbar' },
          ...(stateObj.date !== undefined ? [el('input', { type: 'date', value: stateObj.date, onchange: e => stateObj.date = e.target.value })] : []),
          ...(stateObj.month !== undefined ? [el('input', { type: 'month', value: stateObj.month, onchange: e => stateObj.month = e.target.value })] : []),
          ...(stateObj.from !== undefined ? [el('input', { type: 'date', placeholder: 'From (optional)', value: stateObj.from, onchange: e => stateObj.from = e.target.value })] : []),
          ...(stateObj.to !== undefined ? [el('input', { type: 'date', value: stateObj.to, onchange: e => stateObj.to = e.target.value })] : []),
          ...(stateObj.trade_id !== undefined ? [el('select', { onchange: e => stateObj.trade_id = e.target.value },
            el('option', { value: '' }, 'All my trades'),
            ...trades.map(t => el('option', { value: t.id }, t.name)))] : []),
          el('div', { style: 'flex:1' }),
          el('button', { class: 'btn btn-outline btn-sm', onclick: () => run('csv') }, '⬇ Excel/CSV'),
          el('button', { class: 'btn btn-outline btn-sm', onclick: () => run('pdf') }, '⬇ PDF'),
          el('button', { class: 'btn btn-primary btn-sm', onclick: () => run('json') }, '👁 Preview')
        );
        return el('div', { class: 'card' },
          el('h3', {}, title),
          el('p', { style: 'margin-top:0;color:var(--muted);font-size:13.5px' }, desc),
          fields, status, preview);
      };

      return el('div', {},
        pageHead('Reports (PDF / Excel)'),
        el('div', { class: 'notice info' }, 'All reports are generated live from the database. Downloads are Excel-compatible CSV or PDF.'),
        reportCard('Daily Attendance', 'Date-wise attendance sheet with status, timing and GPS source.',
          s => `daily?date=${s.date}${s.trade_id ? '&trade_id=' + s.trade_id : ''}`,
          { date: today, trade_id: '' }),
        reportCard('Monthly Attendance', 'Month-wise present / absent / leave counts and percentage per trainee (Sundays excluded).',
          s => `monthly?month=${s.month}${s.trade_id ? '&trade_id=' + s.trade_id : ''}`,
          { month: today.slice(0, 7), trade_id: '' }),
        reportCard('Attendance % Report', 'Percentage report with threshold highlighting for warning decisions.',
          s => `percentage?from=${s.from || ''}&to=${s.to}${s.trade_id ? '&trade_id=' + s.trade_id : ''}`,
          { from: '', to: today, trade_id: '' }),
        reportCard('Trainee List', 'All trainees with trade, session and contact details.',
          s => `trainees`, {}),
        reportCard('Leave Register', 'All leave applications with approval status and reviewer.',
          s => `leaves`, {}),
        reportCard('Inventory Report', 'Stock position: opening, issued, used, damaged and available quantities.',
          s => `inventory`, {})
      );
    }
  }
]);
