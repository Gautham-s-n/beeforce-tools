/* modules/timeoff-policy-config.js — Timeoff Policy Config: time off policies (rules per leave type) from Excel, export, delete.
 * Endpoints (core/endpoints.js):
 * timeoff-policy-config.list      ?projection=FULL
 * timeoff-policy-config.paycodes  (reference sheet)
 * timeoff-policy-config.create    (create — WITH trailing slash, as in the old tool)
 * timeoff-policy-config.update    (update — NO trailing slash)
 * timeoff-policy-config.remove
 *
 * The sheet has repeated header names (Applicable x4, Min Days x2 …), so uploads are read BY COLUMN POSITION
 * (like the old tool), not by header name. One row = one approval level; rows with the same id (update) or
 * Name (create) become one policy. Paycodes / Skip Paycodes are comma-separated ids. */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Time Off Policy';

var HEADERS = [
  'id', 'Name', 'Description', 'Paycode ID', 'Paycode Group', 'Past Signed Off Periods',
  'Probationary Period', 'Probationary Period Value',
  'Approval Level', 'Approver Type', 'Remarks', 'Notes', 'Consider Sign Off', 'Remarks Required',
  'Ignore Schedule Paycodes', 'Enable For Employee', 'Approver/s', 'TAT Duration', 'TAT Action',
  'Reminder Notification Duration/s', 'Send Notification', 'Send Employee Notification',
  'Send Push Notification', 'Enable Workflow No Emails', 'Enable TAT For Cancellation',
  'Applicable', 'Count', 'Period', 'Reference Date',
  'Applicable', 'Min Days', 'Max Days', 'Apply In Block',
  'Applicable', 'Min Days', 'Max Days', 'Period', 'Reference Date', 'Ignore Sandwich Rule',
  'Applicable', 'Before Days *', 'After Days *',
  'Paycodes', 'Skip Paycodes'
];
var C = {
  ID: 0, NAME: 1, DESC: 2, PAYCODE_ID: 3, PAYCODE_GROUP: 4, PAST_SIGNED: 5,
  PROB_PERIOD: 6, PROB_VALUE: 7,
  APPROVAL_LEVEL: 8, APPROVER_TYPE: 9, REMARKS: 10, NOTES: 11, CONSIDER_SIGNOFF: 12, REMARKS_REQUIRED: 13,
  IGNORE_SCHEDULE_PAYCODES: 14, ENABLE_FOR_EMPLOYEE: 15, APPROVER: 16, TAT_DURATION: 17, TAT_ACTION: 18,
  REMINDER_DURATIONS: 19, SEND_NOTIFICATION: 20, SEND_EMP_NOTIFICATION: 21, PUSH_NOTIFICATION: 22,
  ENABLE_WORKFLOW_NO_EMAILS: 23, ENABLE_TAT_CANCEL: 24,
  UL_APPLICABLE: 25, UL_COUNT: 26, UL_PERIOD: 27, UL_REFDATE: 28,
  AV_APPLICABLE: 29, AV_MIN: 30, AV_MAX: 31, AV_BLOCK: 32,
  DU_APPLICABLE: 33, DU_MIN: 34, DU_MAX: 35, DU_PERIOD: 36, DU_REFDATE: 37, DU_IGNORE_SANDWICH: 38,
  SR_APPLICABLE: 39, SR_BEFORE: 40, SR_AFTER: 41,
  PAYCODES: 42, SKIP_PAYCODES: 43
};
var INPUT_COLS = [1, 2, 3];
/* Columns that belong to one approval level (the rest describe the whole policy). */
var LEVEL_COLS = [C.APPROVAL_LEVEL, C.APPROVER_TYPE, C.APPROVER, C.TAT_DURATION, C.TAT_ACTION, C.REMINDER_DURATIONS,
  C.SEND_NOTIFICATION, C.SEND_EMP_NOTIFICATION, C.PUSH_NOTIFICATION, C.ENABLE_WORKFLOW_NO_EMAILS, C.ENABLE_TAT_CANCEL];

var DROP_HEADERS = [
  'Consider Sign Off', 'Ignore Schedule Paycodes', 'Enable For Employee', 'Probationary Period', 'Remarks Required',
  'Applicable (Usage Limit)', 'Period (Usage Limit)', 'Applicable (Availing Limit)', 'Apply In Block',
  'Applicable (Document Upload)', 'Ignore Sandwich Rule', 'Period (Document Upload)', 'Applicable (Sandwich Rule)',
  'Send Notification', 'Send Employee Notification', 'Send Push Notification',
  'Enable Workflow No Emails', 'Enable TAT For Cancellation', 'TAT Action'
];
var DROP_ROWS = [
  ['TRUE', 'TRUE', 'TRUE', 'Days', 'TRUE', 'TRUE', 'Weekly', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'Weekly', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'TRUE', 'APPROVE'],
  ['FALSE', 'FALSE', 'FALSE', 'Weeks', 'FALSE', 'FALSE', 'Monthly', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'Monthly', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'FALSE', 'REJECT'],
  ['', '', '', 'Months', '', '', 'Quaterly', '', '', '', '', 'Quaterly', '', '', '', '', '', '', ''],
  ['', '', '', 'Years', '', '', 'Yearly', '', '', '', '', 'Yearly', '', '', '', '', '', '', '']
];

function bs(v) { return v ? 'TRUE' : 'FALSE'; }
function vv(v) { return v == null ? '' : v; }
function toBool(v) { return ['true', '1', 'yes'].indexOf(String(v == null ? '' : v).toLowerCase().trim()) !== -1; }
function pInt(x) { var n = parseInt(parseFloat(x), 10); return isNaN(n) ? null : n; } // old parseIntSafe
function s(v) { return String(v == null ? '' : v).trim(); }
function idList(str) { return s(str).split(',').map(function (x) { return pInt(x.trim()); }).filter(function (n) { return n !== null; }); }
function addIfPresent(obj, key, raw, tf) { var v = s(raw); if (v === '') return; obj[key] = tf ? tf(v) : v; }

/* Old topolFlattenPolicy — one row per approval level, dates stay ISO. */
function flatten(p) {
  var ul = (p.usageLimits && p.usageLimits[0]) || {}, av = p.availingLimit || {}, du = p.documentUpload || {}, sr = p.sandwichRule || {};
  var configs = (p.approvalConfigs && p.approvalConfigs.length) ? p.approvalConfigs : [{}];
  var sp = (p.sandwichPaycodes || []).map(function (x) { return x.id; }).join(',');
  var ssp = (p.sandwichSkipPaycodes || []).map(function (x) { return x.id; }).join(',');
  return configs.map(function (ac) {
    var r = [];
    r[C.ID] = p.id; r[C.NAME] = p.name || ''; r[C.DESC] = p.description || '';
    r[C.PAYCODE_ID] = (p.paycode && p.paycode.id) || ''; r[C.PAYCODE_GROUP] = p.paycodeGroup || '';
    r[C.PAST_SIGNED] = vv(p.numOfPastSignedOfPeriods);
    r[C.PROB_PERIOD] = p.probationaryPeriod || ''; r[C.PROB_VALUE] = vv(p.probationaryPeriodValue);
    r[C.APPROVAL_LEVEL] = vv(ac.level); r[C.APPROVER_TYPE] = ac.approverType || '';
    r[C.REMARKS] = p.remarks || ''; r[C.NOTES] = p.notes || '';
    r[C.CONSIDER_SIGNOFF] = bs(p.considerSignOff); r[C.REMARKS_REQUIRED] = bs(p.remarksRequired);
    r[C.IGNORE_SCHEDULE_PAYCODES] = bs(p.ignoreSchedulePaycodes); r[C.ENABLE_FOR_EMPLOYEE] = bs(p.enableForEmployee);
    r[C.APPROVER] = ac.approver || ''; r[C.TAT_DURATION] = ac.tatDuration || ''; r[C.TAT_ACTION] = ac.tatAction || '';
    r[C.REMINDER_DURATIONS] = ac.reminderNotificationDurations || '';
    r[C.SEND_NOTIFICATION] = bs(ac.sendNotification); r[C.SEND_EMP_NOTIFICATION] = bs(ac.sendEmployeeNotification);
    r[C.PUSH_NOTIFICATION] = bs(ac.pushNotification); r[C.ENABLE_WORKFLOW_NO_EMAILS] = bs(ac.enableWorkflowNoEmails);
    r[C.ENABLE_TAT_CANCEL] = bs(ac.enableTatForCancellation);
    r[C.UL_APPLICABLE] = bs(ul.applicable); r[C.UL_COUNT] = vv(ul.count); r[C.UL_PERIOD] = ul.period || ''; r[C.UL_REFDATE] = ul.referenceDate || '';
    r[C.AV_APPLICABLE] = bs(av.applicable); r[C.AV_MIN] = vv(av.minDays); r[C.AV_MAX] = vv(av.maxDays); r[C.AV_BLOCK] = bs(av.applyInBlock);
    r[C.DU_APPLICABLE] = bs(du.applicable); r[C.DU_MIN] = vv(du.minDays); r[C.DU_MAX] = vv(du.maxDays);
    r[C.DU_PERIOD] = du.period || ''; r[C.DU_REFDATE] = du.referenceDate || ''; r[C.DU_IGNORE_SANDWICH] = bs(du.ignoreSandwichRule);
    r[C.SR_APPLICABLE] = bs(sr.applicable); r[C.SR_BEFORE] = vv(sr.beforeDays); r[C.SR_AFTER] = vv(sr.afterDays);
    r[C.PAYCODES] = sp; r[C.SKIP_PAYCODES] = ssp;
    return r;
  });
}

/* Old buildPayload — unchanged business rules (approverType forced to ATTRIBUTE, probation optional, etc.). */
function build(group) {
  var first = group[0];
  var typed = group.map(function (r) { return pInt(r[C.APPROVAL_LEVEL]); }).filter(function (v) { return v !== null; });
  var top = Math.max(group.length, typed.length ? Math.max.apply(null, typed) : 0); // policy.approvalLevel = number of levels
  var ul = { applicable: toBool(first[C.UL_APPLICABLE]) };
  if (ul.applicable) {
    addIfPresent(ul, 'count', first[C.UL_COUNT], function (v) { return pInt(v) || 0; });
    addIfPresent(ul, 'period', first[C.UL_PERIOD]);
    addIfPresent(ul, 'referenceDate', first[C.UL_REFDATE]);
  }
  var av = { applicable: toBool(first[C.AV_APPLICABLE]) };
  if (av.applicable) {
    addIfPresent(av, 'minDays', first[C.AV_MIN], function (v) { return String(parseFloat(v)); });
    addIfPresent(av, 'maxDays', first[C.AV_MAX], function (v) { return String(parseFloat(v)); });
    av.applyInBlock = toBool(first[C.AV_BLOCK]);
  }
  var du = { applicable: toBool(first[C.DU_APPLICABLE]) };
  if (du.applicable) {
    addIfPresent(du, 'minDays', first[C.DU_MIN], function (v) { return String(parseFloat(v)); });
    addIfPresent(du, 'maxDays', first[C.DU_MAX], function (v) { return String(parseFloat(v)); });
    addIfPresent(du, 'period', first[C.DU_PERIOD]);
    addIfPresent(du, 'referenceDate', first[C.DU_REFDATE]);
    du.ignoreSandwichRule = toBool(first[C.DU_IGNORE_SANDWICH]);
  }
  var sr = { applicable: toBool(first[C.SR_APPLICABLE]) };
  if (sr.applicable) {
    addIfPresent(sr, 'beforeDays', first[C.SR_BEFORE], function (v) { return String(pInt(v) || 0); });
    addIfPresent(sr, 'afterDays', first[C.SR_AFTER], function (v) { return String(pInt(v) || 0); });
  }
  var p = {
    name: s(first[C.NAME]),
    description: s(first[C.DESC]),
    paycode: { id: pInt(first[C.PAYCODE_ID]) },
    paycodeGroup: s(first[C.PAYCODE_GROUP]),
    numOfPastSignedOfPeriods: pInt(first[C.PAST_SIGNED]) || 1, // API rejects 0
    considerSignOff: toBool(first[C.CONSIDER_SIGNOFF]),
    ignoreSchedulePaycodes: toBool(first[C.IGNORE_SCHEDULE_PAYCODES]),
    enableForEmployee: toBool(first[C.ENABLE_FOR_EMPLOYEE]),
    approvalLevel: String(top),
    approverType: 'ATTRIBUTE',
    remarks: s(first[C.REMARKS]),
    notes: s(first[C.NOTES]),
    remarksRequired: toBool(first[C.REMARKS_REQUIRED]),
    usageLimits: [ul],
    availingLimit: av,
    documentUpload: du,
    sandwichRule: sr,
    approvalConfigs: group.map(function (r) {
      return {
        level: pInt(r[C.APPROVAL_LEVEL]) || 1,
        approverType: 'ATTRIBUTE', // forced, whatever the "Approver Type" column says (old tool)
        approver: s(r[C.APPROVER]),
        sendNotification: toBool(r[C.SEND_NOTIFICATION]),
        reminderNotificationDurations: s(r[C.REMINDER_DURATIONS]),
        tatDuration: s(r[C.TAT_DURATION]),
        tatAction: s(r[C.TAT_ACTION]) || 'APPROVE',
        sendEmployeeNotification: toBool(r[C.SEND_EMP_NOTIFICATION]),
        pushNotification: toBool(r[C.PUSH_NOTIFICATION]),
        allowEdit: false,
        enableTatForCancellation: toBool(r[C.ENABLE_TAT_CANCEL]),
        enableWorkflowNoEmails: toBool(r[C.ENABLE_WORKFLOW_NO_EMAILS])
      };
    })
  };
  var sp = idList(first[C.PAYCODES]), ssp = idList(first[C.SKIP_PAYCODES]);
  if (sp.length) p.sandwichPaycodes = sp.map(function (id) { return { id: id }; });
  if (ssp.length) p.sandwichSkipPaycodes = ssp.map(function (id) { return { id: id }; });
  var prob = s(first[C.PROB_PERIOD]);
  if (prob) { p.probationaryPeriod = prob; p.probationaryPeriodValue = pInt(first[C.PROB_VALUE]) || 1; }
  return p;
}

/* ---------- shared helpers (positional read, merge, payload diff) ---------- */
/* Rows by column POSITION from X.read (repeated headers come back as "Applicable", "Applicable_1" …, in order),
 * so dates are yyyy-mm-dd, CSV stays as typed and __row is the real Excel row. */
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
 * current approval level with the same "Approval Level" number. A cell with CLEAR is sent empty (as engine.entity()). */
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

async function loadAll() { return ctx.EP.list('timeoff-policy-config.list', null, { module: MOD }); }

async function template(withData) {
  var res = await Promise.all([loadAll().catch(function () { return []; }), ctx.EP.listQuiet('timeoff-policy-config.paycodes', null, { module: MOD })]);
  var rows = [];
  res[0].forEach(function (p) { rows = rows.concat(flatten(p)); });
  if (withData) { // old "View Existing" file — re-uploads unchanged
    await X.download('time_off_policies_' + new Date().toISOString().slice(0, 10) + '.xlsx', [{ name: 'Time_Off_Policies', tabColor: '7C3AED', headers: HEADERS, rows: rows, highlightCols: INPUT_COLS }]);
    return;
  }
  await X.download('time_off_policies_template.xlsx', [
    { name: 'Upload_Template', tabColor: '7C3AED', headers: HEADERS, rows: [], highlightCols: INPUT_COLS },
    { name: 'Paycodes_Master', tabColor: '059669', headers: ['id', 'name', 'description'], rows: res[1].map(function (p) { return [p.id, p.code || '', p.description || '']; }) },
    { name: 'Existing_Policies_Ref', tabColor: '0369A1', headers: HEADERS, rows: rows },
    { name: 'Valid_Options', tabColor: 'D97706', headers: DROP_HEADERS, rows: DROP_ROWS }
  ]);
}

function makeParse() {
  return async function (file) {
    var rows = positional(file);
    var recs = await loadAll();
    var byId = {}; recs.forEach(function (r) { byId[String(r.id)] = r; });
    var items = [], groups = {}, order = [];
    rows.forEach(function (r) {
      var id = X.int(r[C.ID]), name = s(r[C.NAME]);
      if (id == null && s(r[C.ID]) !== '') { items.push({ kind: 'bad', row: r.__row, label: name || 'Row ' + r.__row, error: 'id "' + s(r[C.ID]) + '" is not a number. Leave it blank to create.' }); return; }
      if (!name) { items.push({ kind: 'bad', row: r.__row, label: id != null ? 'Policy ' + id : 'Row ' + r.__row, error: 'Name is required' }); return; } // old rule
      var key = id != null ? 'id:' + id : 'name:' + name;
      if (!groups[key]) { groups[key] = { id: id, name: name, rows: [] }; order.push(key); }
      groups[key].rows.push(r);
    });
    order.forEach(function (key) {
      var g = groups[key];
      var it = { row: g.rows.map(function (r) { return r.__row; }).join(', '), ref: g.id };
      try {
        if (g.id != null) {
          var cur = byId[String(g.id)];
          it.label = g.name + ' (id ' + g.id + ')';
          if (!cur) { it.kind = 'bad'; it.error = 'No time off policy with id ' + g.id + ' in ' + Api.envLabel(); items.push(it); return; }
          var curRows = flatten(cur);
          var merged = g.rows.map(function (r) { return mergeBlanks(r, curRows, C.APPROVAL_LEVEL); });
          if (!s(merged[0][C.NAME])) { it.kind = 'bad'; it.error = 'Name is required'; items.push(it); return; }
          var p = build(merged); p.id = g.id;
          it.changes = diffVsCurrent(cur, p);
          if (!it.changes.length) { it.kind = 'same'; items.push(it); return; }
          if (p.paycode.id == null) { it.kind = 'bad'; it.error = 'Paycode ID is required'; items.push(it); return; }
          it.kind = 'upd'; it.payload = p;
          it.run = function () { return ctx.EP.call('timeoff-policy-config.update', { id: g.id }, { body: p, module: MOD }); };
        } else {
          it.label = g.name;
          var p2 = build(g.rows.map(function (r) { var c = r.map(function (v) { return isClear(v) ? '' : v; }); c.__row = r.__row; return c; }));
          if (p2.paycode.id == null) { it.kind = 'bad'; it.error = 'Paycode ID is required'; items.push(it); return; }
          if (recs.some(function (x) { return s(x.name).toLowerCase() === g.name.toLowerCase(); })) it.note = 'A policy with this name already exists — a second one will be created.';
          it.kind = 'new'; it.payload = p2;
          it.changes = [{ field: 'approval levels', from: '', to: p2.approvalConfigs.length }, { field: 'paycode', from: '', to: p2.paycode.id }];
          it.run = function () { return ctx.EP.call('timeoff-policy-config.create', null, { body: p2, module: MOD }); };
        }
      } catch (e) { it.kind = 'bad'; it.error = e.message; }
      items.push(it);
    });
    items.sort(function (a, b) { return parseInt(a.row, 10) - parseInt(b.row, 10); });
    return items;
  };
}

function browse(bodyEl) {
  var holder = h('div', h('div.card', h('span.spin'), '  Loading time off policies from ' + Api.envLabel() + '…'));
  bodyEl.appendChild(holder);
  async function draw() {
    var recs = await loadAll();
    var rows = recs.map(function (p) {
      var ul = (p.usageLimits && p.usageLimits[0]) || {};
      return { id: p.id, name: p.name || '', description: p.description || '', paycode: (p.paycode || {}).id || '',
        levels: (p.approvalConfigs || []).length, approvers: (p.approvalConfigs || []).map(function (a) { return a.approver; }).filter(Boolean).join(', '),
        usage: ul.applicable ? (ul.count + ' / ' + (ul.period || '')) : '—' };
    });
    var delBtn = UI.btn('Delete selected', { icon: 'trash', kind: 'quiet', sm: true }); delBtn.disabled = true;
    var tbl = UI.table([{ key: 'id', label: 'Id' }, { key: 'name', label: 'Name' }, { key: 'description', label: 'Description' }, { key: 'paycode', label: 'Paycode' },
      { key: 'levels', label: 'Levels' }, { key: 'approvers', label: 'Approvers', wrap: true }, { key: 'usage', label: 'Usage limit' }], rows, {
      select: true,
      onSelect: function (sel) { delBtn.disabled = !sel.size; U.swap(delBtn, U.icon('trash', 16), h('span', sel.size ? 'Delete ' + sel.size : 'Delete selected')); },
      toolbar: [UI.btn('Refresh', { icon: 'retry', sm: true, kind: 'quiet', onClick: draw }), UI.btn('Export for editing', { icon: 'download', sm: true, onClick: function () { return template(true); } }), delBtn]
    });
    delBtn.onclick = function () {
      var todo = Array.from(tbl.selected).map(function (id) {
        var r = rows.filter(function (x) { return String(x.id) === id; })[0] || {};
        return { kind: 'del', ref: id, label: (r.name || '') + ' (id ' + id + ')', run: function () { return ctx.EP.call('timeoff-policy-config.remove', { id: id }, { module: MOD }); } };
      });
      E.runDeletes(todo, MOD, 'policy').then(function (r) { if (r) draw(); });
    };
    U.swap(holder, rows.length ? tbl : UI.empty('No time off policies in ' + Api.envLabel() + ' yet.'));
  }
  draw().catch(function (e) { U.swap(holder, UI.note('bad', 'Could not load time off policies', e.message)); });
}

ctx.defineTool('timeoff-policy-config', {
  desc: 'Set up time off policies — approval levels, usage and availing limits, document upload and sandwich rules — from Excel.',
  render: function (view) {
    view.appendChild(UI.tabs([
      { id: 'upload', label: 'Create / update', render: function (b) {
        b.appendChild(E.uploadFlow({
          module: MOD, template: function () { return template(false); }, parse: makeParse(), itemLabel: 'Policy', verb: 'policy change',
          blankNote: function () { return 'Blank cells keep the current value in ' + Api.envLabel() + ' (level columns from the level with the same Approval Level). To empty a value, type CLEAR in the cell. Some values are always sent the same way — Approver Type ATTRIBUTE, allowEdit off, TAT Action APPROVE when empty, Past Signed Off Periods at least 1 — and the list shows them when they differ from ' + Api.envLabel() + '.'; },
          intro: h('div.note.info', h('div',
            h('b', 'One row per approval level. '), 'Leave id blank to create; fill it to update. Rows with the same id (or Name, for new policies) become one policy. ',
            'Paycodes / Skip Paycodes are comma-separated ids (e.g. 442,443). Dates are YYYY-MM-DD. Approver Type is always sent as ATTRIBUTE. ',
            'Leave both Probationary Period columns blank if the policy has no probation. Columns are read by position — keep the template column order.'))
        }));
      } },
      { id: 'browse', label: 'Browse & export', render: browse }
    ]));
  }
});
