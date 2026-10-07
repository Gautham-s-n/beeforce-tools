/* modules/outpass-policies.js — Outpass Policies: create / update from Excel, export, delete.
 * Endpoints (core/endpoints.js):
 * outpass-policies.list    ?attributes=attendanceAdjustmentType
 * outpass-policies.types   (reference sheet)
 * outpass-policies.create  (create)
 * outpass-policies.update  (update)
 * outpass-policies.remove
 *
 * "Approver Type" appears twice in the sheet (col 10 = the policy's own, col 18 = the approval level's), so uploads
 * are read BY COLUMN POSITION, as in the old tool. One row = one approval level; rows with the same id (update) or
 * Name (create) become ONE request with all their approvalConfigs. Usage-limit Reference Date is DD-MM-YYYY in the
 * sheet and YYYY-MM-DD over the wire. "Min/Max Minutes" map to the API's minDays/maxDays. */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Outpass Policies';

var HEADERS = [
  'id', 'Name', 'Description', 'Type ID', 'Past Signed Off Periods',
  'Consider Sign Off', 'Enable For Employee', 'Enable Shift Validation',
  'Approval Level', 'Approver Type', 'Remarks', 'Remarks Required',
  'Usage Limit - Applicable', 'Usage Limit - Count', 'Usage Limit - Period', 'Usage Limit - Reference Date',
  'Approval Configuration - Level', 'Approver Type', 'Send Notification', 'Send Employee Notification',
  'Send Push Notification', 'Enable Workflow No Emails', 'Approver', 'TAT Action', 'TAT Duration',
  'Reminder Notification Duration',
  'Availing Limit (Minutes) - Applicable', 'Apply In Block', 'Min Minutes', 'Max Minutes'
];
var COL = {
  ID: 0, NAME: 1, DESC: 2, TYPE_ID: 3, PAST_SIGNED_OFF_PERIODS: 4,
  CONSIDER_SIGN_OFF: 5, ENABLE_FOR_EMPLOYEE: 6, ENABLE_SHIFT_VALIDATION: 7,
  APPROVAL_LEVEL: 8, APPROVER_TYPE: 9, REMARKS: 10, REMARKS_REQUIRED: 11,
  USAGE_APPLICABLE: 12, USAGE_COUNT: 13, USAGE_PERIOD: 14, USAGE_REF_DATE: 15,
  APC_LEVEL: 16, APC_APPROVER_TYPE: 17, APC_SEND_NOTIFICATION: 18, APC_SEND_EMPLOYEE_NOTIFICATION: 19,
  APC_PUSH_NOTIFICATION: 20, APC_ENABLE_WORKFLOW_NO_EMAILS: 21, APC_APPROVER: 22, APC_TAT_ACTION: 23,
  APC_TAT_DURATION: 24, APC_REMINDER_NOTIFICATION_DURATION: 25,
  AVAIL_APPLICABLE: 26, AVAIL_APPLY_IN_BLOCK: 27, AVAIL_MIN: 28, AVAIL_MAX: 29
};
var LEVEL_COLS = [COL.APPROVAL_LEVEL, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];

function cell(row, i) { return row[i] == null ? '' : row[i]; }
function toBool(v) { var x = String(v == null ? '' : v).trim().toLowerCase(); return x === 'true' || x === '1' || x === 'yes'; }
function fromBool(b) { return b ? 'TRUE' : 'FALSE'; }
function pInt(x) { var n = parseInt(parseFloat(x), 10); return isNaN(n) ? null : n; } // old parseIntSafe
function pFloat(x) { if (x === '' || x == null) return null; var n = parseFloat(x); return isNaN(n) ? null : n; }
function s(v) { return String(v == null ? '' : v).trim(); }
function ddmmyyyyToIso(v) { v = s(v); var m = v.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/); if (!m) return v || null; return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2); }
function isoToDdmmyyyy(v) { v = s(v); var m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (!m) return v || ''; return ('0' + m[3]).slice(-2) + '-' + ('0' + m[2]).slice(-2) + '-' + m[1]; }

/* Old rowsFromPolicy — one row per approvalConfigs entry, so an exported sheet re-uploads unchanged. */
function flatten(p) {
  var ul = (p.usageLimits && p.usageLimits[0]) || {}, av = p.availingLimit || {};
  var configs = (p.approvalConfigs && p.approvalConfigs.length) ? p.approvalConfigs : [{}];
  return configs.map(function (ac) {
    var r = [];
    r[COL.ID] = p.id; r[COL.NAME] = p.name || ''; r[COL.DESC] = p.description || '';
    r[COL.TYPE_ID] = p.attendanceAdjustmentType ? p.attendanceAdjustmentType.id : '';
    r[COL.PAST_SIGNED_OFF_PERIODS] = p.numOfPastSignedOfPeriods;
    r[COL.CONSIDER_SIGN_OFF] = fromBool(p.considerSignOff); r[COL.ENABLE_FOR_EMPLOYEE] = fromBool(p.enableForEmployee);
    r[COL.ENABLE_SHIFT_VALIDATION] = fromBool(p.enableShiftValidation);
    r[COL.APPROVAL_LEVEL] = ac.level !== undefined ? ac.level : p.approvalLevel;
    r[COL.APPROVER_TYPE] = p.approverType || ''; r[COL.REMARKS] = p.remarks || ''; r[COL.REMARKS_REQUIRED] = fromBool(p.remarksRequired);
    r[COL.USAGE_APPLICABLE] = fromBool(ul.applicable); r[COL.USAGE_COUNT] = ul.count; r[COL.USAGE_PERIOD] = ul.period || '';
    r[COL.USAGE_REF_DATE] = isoToDdmmyyyy(ul.referenceDate);
    r[COL.APC_LEVEL] = ac.level; r[COL.APC_APPROVER_TYPE] = ac.approverType || '';
    r[COL.APC_SEND_NOTIFICATION] = fromBool(ac.sendNotification); r[COL.APC_SEND_EMPLOYEE_NOTIFICATION] = fromBool(ac.sendEmployeeNotification);
    r[COL.APC_PUSH_NOTIFICATION] = fromBool(ac.pushNotification); r[COL.APC_ENABLE_WORKFLOW_NO_EMAILS] = fromBool(ac.enableWorkflowNoEmails);
    r[COL.APC_APPROVER] = ac.approver || ''; r[COL.APC_TAT_ACTION] = ac.tatAction || ''; r[COL.APC_TAT_DURATION] = ac.tatDuration || '';
    r[COL.APC_REMINDER_NOTIFICATION_DURATION] = ac.reminderNotificationDurations || '';
    r[COL.AVAIL_APPLICABLE] = fromBool(av.applicable); r[COL.AVAIL_APPLY_IN_BLOCK] = fromBool(av.applyInBlock);
    r[COL.AVAIL_MIN] = av.minDays; r[COL.AVAIL_MAX] = av.maxDays;
    return r;
  });
}

/* Old buildPayloadForGroup — unchanged. */
function build(policyId, group) {
  var first = group[0];
  var p = {
    name: cell(first, COL.NAME),
    description: cell(first, COL.DESC),
    attendanceAdjustmentType: { id: pInt(cell(first, COL.TYPE_ID)) },
    numOfPastSignedOfPeriods: pInt(cell(first, COL.PAST_SIGNED_OFF_PERIODS)),
    considerSignOff: toBool(cell(first, COL.CONSIDER_SIGN_OFF)),
    enableForEmployee: toBool(cell(first, COL.ENABLE_FOR_EMPLOYEE)),
    enableShiftValidation: toBool(cell(first, COL.ENABLE_SHIFT_VALIDATION)),
    approverType: s(cell(first, COL.APPROVER_TYPE)),
    remarks: cell(first, COL.REMARKS),
    remarksRequired: toBool(cell(first, COL.REMARKS_REQUIRED)),
    usageLimits: [{
      applicable: toBool(cell(first, COL.USAGE_APPLICABLE)),
      count: pInt(cell(first, COL.USAGE_COUNT)),
      period: cell(first, COL.USAGE_PERIOD) || 'Monthly', // API enum rejects "" even when not applicable (old tool)
      referenceDate: ddmmyyyyToIso(cell(first, COL.USAGE_REF_DATE))
    }],
    approvalConfigs: [],
    availingLimit: {
      applicable: toBool(cell(first, COL.AVAIL_APPLICABLE)),
      applyInBlock: toBool(cell(first, COL.AVAIL_APPLY_IN_BLOCK)),
      minDays: pFloat(cell(first, COL.AVAIL_MIN)),
      maxDays: pFloat(cell(first, COL.AVAIL_MAX))
    }
  };
  var maxLevel = 0, seen = {};
  group.forEach(function (row) {
    var top = pInt(cell(row, COL.APPROVAL_LEVEL));
    if (top !== null && top > maxLevel) maxLevel = top;
    var lv = pInt(cell(row, COL.APC_LEVEL));
    if (lv !== null) { if (seen[lv]) return; seen[lv] = true; }
    p.approvalConfigs.push({
      level: lv,
      approverType: cell(row, COL.APC_APPROVER_TYPE),
      sendNotification: toBool(cell(row, COL.APC_SEND_NOTIFICATION)),
      sendEmployeeNotification: toBool(cell(row, COL.APC_SEND_EMPLOYEE_NOTIFICATION)),
      pushNotification: toBool(cell(row, COL.APC_PUSH_NOTIFICATION)),
      enableWorkflowNoEmails: toBool(cell(row, COL.APC_ENABLE_WORKFLOW_NO_EMAILS)),
      approver: cell(row, COL.APC_APPROVER),
      tatAction: cell(row, COL.APC_TAT_ACTION),
      tatDuration: cell(row, COL.APC_TAT_DURATION),
      reminderNotificationDurations: cell(row, COL.APC_REMINDER_NOTIFICATION_DURATION)
    });
  });
  p.approvalLevel = String(maxLevel).trim(); // STRING on write; highest level in the group
  if (policyId !== null) p.id = policyId;
  return p;
}

/* ---------- shared helpers (positional read, merge, payload diff) ---------- */
/* Rows by column POSITION from X.read (the second "Approver Type" comes back as "Approver Type_1"), so date cells
 * are yyyy-mm-dd, CSV stays as typed and __row is the real Excel row. */
function positional(file) {
  return file.rows.map(function (r) {
    var row = [];
    for (var k = 0; k < HEADERS.length; k++) { var hd = file.headers[k]; row[k] = hd && r[hd] != null ? r[hd] : ''; }
    row.__row = r.__row;
    return row;
  });
}
function isClear(v) { return /^clear$/i.test(s(v)); }
/* Blank cells on an update keep the current value: policy columns from the current policy, level columns from the
 * current approval config with the same "Approval Configuration - Level". A cell with CLEAR is sent empty (as engine.entity()). */
function mergeBlanks(row, curRows, levelKey) {
  var lv = pInt(row[levelKey]);
  var same = curRows.filter(function (c) { return lv !== null && pInt(c[levelKey]) === lv; })[0];
  var m = row.slice(); m.__row = row.__row;
  for (var i = 1; i < HEADERS.length; i++) {
    if (isClear(m[i])) { m[i] = ''; continue; }
    if (s(m[i]) !== '') continue;
    var src = LEVEL_COLS.indexOf(i) >= 0 ? same : curRows[0];
    if (src) m[i] = X.fmt(src[i]);
  }
  return m;
}
function paths(v, pre, out) {
  if (Array.isArray(v)) { if (!v.length) out[pre] = '(none)'; v.forEach(function (x, i) { paths(x, pre + '[' + i + ']', out); }); }
  else if (v && typeof v === 'object') { var ks = Object.keys(v); if (!ks.length) out[pre] = '(none)'; ks.forEach(function (k) { paths(v[k], pre ? pre + '.' + k : k, out); }); }
  else out[pre] = v == null ? null : v;
  return out;
}
function pretty(k) { return k.replace(/approvalConfigs\[(\d+)\]\./, function (_, i) { return 'level row ' + (+i + 1) + ' · '; }).replace(/usageLimits\[0\]\./, 'usageLimit.'); }
/* Review diff: the outgoing payload against the REAL current record (not build(current)), so values build() forces
 * (approverType ATTRIBUTE, allowEdit false, defaults) and list items it drops show up as changes.
 *  - every field in the payload is compared with the same field on the server ("1" = 1, blank = null);
 *  - items of a sent list beyond what is sent (e.g. usageLimits[1]) are listed as "(removed)";
 *  - fields the server has but the sheet does not send are listed as "(not sent)" when the row changes anyway;
 *    they do not by themselves make a row an update. */
var AUDIT_KEYS = /^(createdBy|createdDate|lastModifiedBy|lastModifiedDate|version)$/;
function toks(k) { var out = [], m, re = /([^.\[\]]+)|\[(\d+)\]/g; while ((m = re.exec(k))) out.push(m[1] !== undefined ? m[1] : +m[2]); return out; }
function emptyish(v) { return v == null || v === '' || v === '(none)'; }
function sameLeaf(a, b) { return emptyish(a) && emptyish(b) ? true : (emptyish(a) || emptyish(b)) ? false : E.same(a, b); }
function diffVsCurrent(cur, p) {
  var A = paths(cur, '', {}), B = paths(p, '', {});
  var changes = [], extra = [];
  Object.keys(B).forEach(function (k) {
    if (k === 'id') return;
    if (!sameLeaf(A[k], B[k])) changes.push({ field: pretty(k), from: A[k], to: B[k] });
  });
  Object.keys(A).forEach(function (k) {
    if (k in B || k === 'id' || emptyish(A[k])) return;
    var t = toks(k), last = t[t.length - 1];
    if (t.some(function (x) { return typeof x === 'string' && AUDIT_KEYS.test(x); })) return;
    if (!(t[0] in p)) { extra.push({ field: pretty(k), from: A[k], to: '(not sent)' }); return; }
    var node = p;
    for (var i = 0; i < t.length - 1; i++) {
      if (node == null || typeof node !== 'object') break;
      var nxt = node[t[i]];
      if (Array.isArray(nxt) && typeof t[i + 1] === 'number' && t[i + 1] >= nxt.length) { changes.push({ field: pretty(k), from: A[k], to: '(removed)' }); return; }
      node = nxt;
    }
    if (node && typeof node === 'object' && !Array.isArray(node) && (last === 'id' || (Object.keys(node).length === 1 && 'id' in node))) return; // row id the old tool never sent / reference like paycode:{id}
    extra.push({ field: pretty(k), from: A[k], to: '(not sent)' });
  });
  return changes.length ? changes.concat(extra) : [];
}

async function loadAll() { return ctx.EP.list('outpass-policies.list', null, { module: MOD }); }
async function loadTypes() { return ctx.EP.listQuiet('outpass-policies.types', null, { module: MOD }); }

async function template(withData) {
  var res = await Promise.all([loadAll().catch(function () { return []; }), loadTypes()]);
  var rows = res[0].reduce(function (acc, p) { return acc.concat(flatten(p)); }, []);
  if (withData) { // old "View Existing" file — re-uploads unchanged
    await X.download('outpol_existing_' + new Date().toISOString().slice(0, 10) + '.xlsx', [{ name: 'Outpass_Policies', tabColor: '7C3AED', headers: HEADERS, rows: rows }]);
    return;
  }
  await X.download('outpass_policies_template.xlsx', [
    { name: 'Upload_Template', tabColor: '1D4ED8', headers: HEADERS, rows: [] },
    { name: 'Existing_Outpass_Policies', tabColor: '7C3AED', headers: HEADERS, rows: rows },
    { name: 'Adjustment_Types_Master', tabColor: '059669', headers: ['id', 'name', 'description', 'inactive', 'outpass'],
      rows: res[1].map(function (t) { return [t.id, t.name || '', t.description || '', fromBool(t.inactive), fromBool(t.outpass)]; }) }
  ]);
}

function makeParse() {
  return async function (file) {
    var rows = positional(file);
    var res = await Promise.all([loadAll(), loadTypes()]);
    var recs = res[0], types = res[1];
    var byId = {}; recs.forEach(function (r) { byId[String(r.id)] = r; });
    var typeIds = {}; types.forEach(function (t) { typeIds[String(t.id)] = t; });
    var items = [], groups = {}, order = [];
    rows.forEach(function (r) {
      var id = X.int(cell(r, COL.ID)), name = s(cell(r, COL.NAME));
      if (id == null && s(cell(r, COL.ID)) !== '') { items.push({ kind: 'bad', row: r.__row, label: name || 'Row ' + r.__row, error: 'id "' + s(cell(r, COL.ID)) + '" is not a number. Leave it blank to create.' }); return; }
      if (id == null && !name) { items.push({ kind: 'skip', row: r.__row, label: 'Row ' + r.__row, note: 'No id and no Name — skipped (as in the old tool)' }); return; }
      var key = id != null ? 'id:' + id : 'name:' + cell(r, COL.NAME);
      if (!groups[key]) { groups[key] = { id: id, name: name, rows: [] }; order.push(key); }
      groups[key].rows.push(r);
    });
    order.forEach(function (key) {
      var g = groups[key];
      var it = { row: g.rows.map(function (r) { return r.__row; }).join(', '), ref: g.id };
      var p;
      if (g.id != null) {
        var cur = byId[String(g.id)];
        it.label = (g.name || (cur && cur.name) || 'Policy') + ' (id ' + g.id + ')';
        if (!cur) { it.kind = 'bad'; it.error = 'No outpass policy with id ' + g.id + ' in ' + Api.envLabel(); items.push(it); return; }
        var curRows = flatten(cur);
        p = build(g.id, g.rows.map(function (r) { return mergeBlanks(r, curRows, COL.APC_LEVEL); }));
        it.changes = diffVsCurrent(cur, p);
        if (!it.changes.length) { it.kind = 'same'; items.push(it); return; }
      } else {
        it.label = g.name;
        p = build(null, g.rows.map(function (r) { var c = r.map(function (v) { return isClear(v) ? '' : v; }); c.__row = r.__row; return c; }));
        if (recs.some(function (x) { return s(x.name).toLowerCase() === g.name.toLowerCase(); })) it.note = 'A policy with this name already exists — a second one will be created.';
        it.changes = [{ field: 'approval levels', from: '', to: p.approvalConfigs.length }, { field: 'type', from: '', to: p.attendanceAdjustmentType.id }];
      }
      var tid = p.attendanceAdjustmentType.id;
      if (tid == null) { it.kind = 'bad'; it.error = 'Type ID is required'; items.push(it); return; }
      // The type list is fetched like the old tool (no page/size); if the server pages it, a real id could be missing
      // from it — so an unknown id is a warning to check, not an error.
      if (types.length && !typeIds[String(tid)]) {
        var warn = 'Type ID ' + tid + ' is not in the ' + types.length + ' attendance adjustment type(s) loaded from ' + Api.envLabel() + ' — make sure it exists.';
        if (it.note) it.note += ' ' + warn; else it.changes.unshift({ field: 'check', from: '', to: warn });
      }
      it.payload = p;
      if (g.id != null) { it.kind = 'upd'; it.run = function () { return ctx.EP.call('outpass-policies.update', { id: g.id }, { body: p, module: MOD }); }; }
      else { it.kind = 'new'; it.run = function () { return ctx.EP.call('outpass-policies.create', null, { body: p, module: MOD }); }; }
      items.push(it);
    });
    items.sort(function (a, b) { return parseInt(a.row, 10) - parseInt(b.row, 10); });
    return items;
  };
}

function browse(bodyEl) {
  var holder = h('div', h('div.card', h('span.spin'), '  Loading outpass policies from ' + Api.envLabel() + '…'));
  bodyEl.appendChild(holder);
  async function draw() {
    var res = await Promise.all([loadAll(), loadTypes()]);
    var tn = {}; res[1].forEach(function (t) { tn[String(t.id)] = t.name; });
    var rows = res[0].map(function (p) {
      var ul = (p.usageLimits && p.usageLimits[0]) || {}, tid = (p.attendanceAdjustmentType || {}).id;
      return { id: p.id, name: p.name || '', description: p.description || '', type: tid == null ? '' : (tn[String(tid)] || '') + ' (' + tid + ')',
        levels: (p.approvalConfigs || []).length, approvers: (p.approvalConfigs || []).map(function (a) { return a.approver; }).filter(Boolean).join(', '),
        usage: ul.applicable ? ul.count + ' / ' + (ul.period || '') : '—' };
    });
    var delBtn = UI.btn('Delete selected', { icon: 'trash', kind: 'quiet', sm: true }); delBtn.disabled = true;
    var tbl = UI.table([{ key: 'id', label: 'Id' }, { key: 'name', label: 'Name' }, { key: 'description', label: 'Description' }, { key: 'type', label: 'Type' },
      { key: 'levels', label: 'Levels' }, { key: 'approvers', label: 'Approvers', wrap: true }, { key: 'usage', label: 'Usage limit' }], rows, {
      select: true,
      onSelect: function (sel) { delBtn.disabled = !sel.size; U.swap(delBtn, U.icon('trash', 16), h('span', sel.size ? 'Delete ' + sel.size : 'Delete selected')); },
      toolbar: [UI.btn('Refresh', { icon: 'retry', sm: true, kind: 'quiet', onClick: draw }), UI.btn('Export for editing', { icon: 'download', sm: true, onClick: function () { return template(true); } }), delBtn]
    });
    delBtn.onclick = function () {
      var todo = Array.from(tbl.selected).map(function (id) {
        var r = rows.filter(function (x) { return String(x.id) === id; })[0] || {};
        return { kind: 'del', ref: id, label: (r.name || '') + ' (id ' + id + ')', run: function () { return ctx.EP.call('outpass-policies.remove', { id: id }, { module: MOD }); } };
      });
      E.runDeletes(todo, MOD, 'policy').then(function (r) { if (r) draw(); });
    };
    U.swap(holder, rows.length ? tbl : UI.empty('No outpass policies in ' + Api.envLabel() + ' yet.'));
  }
  draw().catch(function (e) { U.swap(holder, UI.note('bad', 'Could not load outpass policies', e.message)); });
}

ctx.defineTool('outpass-policies', {
  desc: 'Set up outpass (short leave) policies — approval levels, usage and availing limits — from Excel, export them, or delete them.',
  render: function (view) {
    view.appendChild(UI.tabs([
      { id: 'upload', label: 'Create / update', render: function (b) {
        b.appendChild(E.uploadFlow({
          module: MOD, template: function () { return template(false); }, parse: makeParse(), itemLabel: 'Policy', verb: 'policy change',
          blankNote: function () { return 'Blank cells keep the current value in ' + Api.envLabel() + ' (level columns from the level with the same Approval Configuration - Level). To empty a value, type CLEAR in the cell. Some values are always sent the same way — a blank Usage Limit Period is sent as Monthly — and the list shows them when they differ from ' + Api.envLabel() + '.'; },
          intro: h('div',
            UI.note('info', 'One row per approval level. ', 'Leave id blank to create; fill it to update. Rows with the same id (or Name, for new policies) become one policy with several approval levels — only the level columns should differ between those rows. Usage Limit Reference Date is DD-MM-YYYY.'),
            UI.note('warn', null, '"Approver Type" appears twice (the policy\'s own, then the approval level\'s). That is expected — fill both and keep the column order; the sheet is read by position.'))
        }));
      } },
      { id: 'browse', label: 'Browse & export', render: browse }
    ]));
  }
});
