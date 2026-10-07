/* modules/timeoff-policy-sets.js — Time Off Policy Set: create / update sets from Excel, export, full-detail download, delete.
 * Endpoints (core/endpoints.js):
 * timeoff-policy-sets.list      ?projection=FULL
 * timeoff-policy-sets.policies  (reference sheet)
 * timeoff-policy-sets.create    (create — NO trailing slash, as in the old tool)
 * timeoff-policy-sets.update    (update — WITH trailing slash, as in the old tool)
 * timeoff-policy-sets.remove    (NO trailing slash) */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Time Off Policy Set';

/* Old "View Existing" layout — one row per (set, entry). Repeated header names are intentional (old tool). */
var VIEW_HEADERS = [
  'id', 'Timeoff Policy Set', 'Timeoff Policy Set description',
  'id', 'Timeoff Policy name', 'Timeoff Policy Description',
  'id', 'considerSignOff', 'ignoreSchedulePaycodes', 'numOfPastSignedOfPeriods',
  'applicable', 'applicable', 'minDays', 'maxDays', 'applyInBlock',
  'applicable', 'ignoreSandwichRule', 'applicable', 'beforeDays', 'afterDays',
  'level', 'approverType', 'approver', 'sendNotification', 'reminderNotificationDurations',
  'tatAction', 'sendEmployeeNotification', 'pushNotification', 'allowEdit',
  'enableTatForCancellation', 'enableWorkflowNoEmails',
  'approvalLevel', 'approverType', 'remarksRequired', 'enableForEmployee',
  'count', 'referenceDate', 'period', 'notes',
  'minDays', 'referenceDate', 'period', 'remarks'
];
var UP_HEADERS = ['ID', 'Timeoff Policy Set Name', 'Timeoff Policy Set description', 'Timeoff Policy Entry ID', 'Paycode ID'];
var UP_INPUT_COLS = [1, 3, 4];

function bs(v) { return v ? 'TRUE' : 'FALSE'; }
function vv(v) { return v == null ? '' : v; }

/* Old topsFlattenSet — rule-block field paths were best-guess in the old tool and are kept as they were. */
function flattenFull(set) {
  var entries = set.entries || [];
  if (!entries.length) return [[set.id, set.name || '', set.description || ''].concat(new Array(VIEW_HEADERS.length - 3).fill(''))];
  return entries.map(function (e) {
    var cfg = (e.approvalConfigs && e.approvalConfigs[0]) || {};
    var dl = e.delegationConfig || {}, mm = e.minMaxDaysRule || {}, sw = e.sandwichRule || {}, nt = e.noticeDaysRule || {};
    var en = e.entitlementRule || {}, np = e.noticePeriodRule || {}, pc = e.paycode || {};
    return [
      set.id, set.name || '', set.description || '',
      e.id || '', e.name || '', e.description || '',
      pc.id || '',
      bs(e.considerSignOff), bs(e.ignoreSchedulePaycodes), vv(e.numOfPastSignedOfPeriods),
      bs(e.prorationApplicable),
      bs(mm.applicable), vv(mm.minDays), vv(mm.maxDays), bs(mm.applyInBlock),
      bs(sw.applicable), bs(sw.ignoreSandwichRule),
      bs(nt.applicable), vv(nt.beforeDays), vv(nt.afterDays),
      vv(cfg.level), cfg.approverType || '', cfg.approver || '', bs(cfg.sendNotification),
      cfg.reminderNotificationDurations || '', cfg.tatAction || '', bs(cfg.sendEmployeeNotification),
      bs(cfg.pushNotification), bs(cfg.allowEdit), bs(cfg.enableTatForCancellation), bs(cfg.enableWorkflowNoEmails),
      vv(dl.approvalLevel), dl.approverType || '', bs(dl.remarksRequired), bs(dl.enableForEmployee),
      vv(en.count), en.referenceDate || '', en.period || '', en.notes || '',
      vv(np.minDays), np.referenceDate || '', np.period || '', np.remarks || ''
    ];
  });
}
/* Upload layout (5 columns) — what "Export for editing" writes, so it re-uploads unchanged. */
function flattenUpload(set) {
  var en = set.entries || [];
  if (!en.length) return [[set.id, set.name || '', set.description || '', '', '']];
  return en.map(function (e) { return [set.id, set.name || '', set.description || '', e.id == null ? '' : e.id, (e.paycode || {}).id || '']; });
}
function sig(entries) {
  return (entries || []).map(function (e) { return e.id + ':' + ((e.paycode || {}).id); }).sort().join(',');
}
function entriesText(entries) {
  return (entries || []).map(function (e) { return e.id + (e.paycode && e.paycode.id != null ? ' (paycode ' + e.paycode.id + ')' : ''); }).join(', ');
}

async function loadSets() { return ctx.EP.list('timeoff-policy-sets.list', null, { module: MOD }); }
async function loadPolicies() { return ctx.EP.listQuiet('timeoff-policy-sets.policies', null, { module: MOD }); }

async function template(withData) {
  var res = await Promise.all([loadSets().catch(function () { return []; }), loadPolicies()]);
  var sets = res[0], pols = res[1];
  var up = [], full = [];
  sets.forEach(function (s) { up = up.concat(flattenUpload(s)); full = full.concat(flattenFull(s)); });
  var S = [{ name: 'Upload_Template', tabColor: '7C3AED', headers: UP_HEADERS, rows: withData ? up : [], highlightCols: UP_INPUT_COLS }];
  S.push({ name: 'Existing_Sets_Full', tabColor: '0369A1', headers: VIEW_HEADERS, rows: full });
  S.push({ name: 'Time_Off_Policies_Master', tabColor: '059669', headers: ['id', 'name', 'description'], rows: pols.map(function (p) { return [p.id, p.name || '', p.description || '']; }) });
  await X.download(withData ? 'time_off_policy_sets_export_' + U.stamp() + '.xlsx' : 'time_off_policy_sets_template.xlsx', S);
}
async function downloadFull() {
  var sets = await loadSets();
  if (!sets.length) { UI.toast('No sets found.'); return; }
  var rows = [];
  sets.forEach(function (s) { rows = rows.concat(flattenFull(s)); });
  await X.download('time_off_policy_sets_' + new Date().toISOString().slice(0, 10) + '.xlsx', [{ name: 'Time_Off_Policy_Sets', tabColor: '7C3AED', headers: VIEW_HEADERS, rows: rows }]);
  UI.toast('Downloaded ' + sets.length + ' set(s), ' + rows.length + ' row(s).');
}

async function parse(file) {
  var sets = await loadSets();
  var byId = {}; sets.forEach(function (s) { byId[String(s.id)] = s; });
  var items = [], groups = {}, order = [];
  file.rows.forEach(function (r) {
    var sid = X.int(X.col(r, 'ID'));
    var name = X.str(X.col(r, 'Timeoff Policy Set Name'));
    var eid = X.int(X.col(r, 'Timeoff Policy Entry ID'));
    var pid = X.int(X.col(r, 'Paycode ID'));
    // "Export for editing" writes a set with no entries as one row with blank Entry ID and Paycode ID.
    // Such a row adds no entry; it only names the set (so re-uploading the export is "No change", not an error).
    if (sid != null && X.str(X.col(r, 'Timeoff Policy Entry ID')) === '' && X.str(X.col(r, 'Paycode ID')) === '') {
      var k0 = 'id:' + sid;
      if (!groups[k0]) { groups[k0] = { sid: sid, name: name, rows: [] }; order.push(k0); }
      groups[k0].rows.push(r);
      return;
    }
    // Old rules: each row needs an entry id and a paycode id; a new set needs a name. Bad rows are skipped, the rest of the set is still sent.
    var err = eid == null ? 'Timeoff Policy Entry ID is required/invalid' : pid == null ? 'Paycode ID is required/invalid' : (sid == null && !name) ? 'Timeoff Policy Set Name required when ID is blank' : null;
    if (err) { items.push({ kind: 'bad', row: r.__row, label: name || (sid != null ? 'Set ' + sid : 'Row ' + r.__row), error: err }); return; }
    var key = sid != null ? 'id:' + sid : 'name:' + name; // old tool groups new sets by exact name
    if (!groups[key]) { groups[key] = { sid: sid, name: name, rows: [] }; order.push(key); }
    groups[key].rows.push(r);
  });
  order.forEach(function (key) {
    var g = groups[key], first = g.rows[0];
    var entries = [], seen = {};
    g.rows.forEach(function (r) {
      var eid = X.int(X.col(r, 'Timeoff Policy Entry ID')), pid = X.int(X.col(r, 'Paycode ID'));
      if (eid == null || pid == null) return; // set-only row (see above)
      if (seen[eid]) return; seen[eid] = 1; // old: first row per entry id wins
      entries.push({ id: eid, paycode: { id: pid } });
    });
    var desc = X.str(X.col(first, 'Timeoff Policy Set description'));
    var it = { row: g.rows.map(function (r) { return r.__row; }).join(', '), ref: g.sid };
    if (g.sid != null) {
      var cur = byId[String(g.sid)];
      var nm = X.str(X.col(first, 'Timeoff Policy Set Name'));
      it.label = (nm || (cur && cur.name) || 'Set') + ' (id ' + g.sid + ')';
      if (!cur) { it.kind = 'bad'; it.error = 'No set with id ' + g.sid + ' in ' + Api.envLabel(); items.push(it); return; }
      // Blank name/description keep the current value (same as Engine.policySet); description still falls back to the name as in the old tool.
      // Only set-only rows (no entries) for a set that has entries: sending would wipe them, so leave the set alone.
      if (!entries.length && (cur.entries || []).length) { it.kind = 'skip'; it.note = 'No Timeoff Policy Entry ID / Paycode ID given — set left unchanged (fill them to change its entries).'; items.push(it); return; }
      var name = nm || cur.name || '';
      var p = { id: g.sid, name: name, description: desc || cur.description || name, entries: entries };
      var ch = [];
      if ((p.name || '') !== (cur.name || '')) ch.push({ field: 'name', from: cur.name, to: p.name });
      if ((p.description || '') !== (cur.description || '')) ch.push({ field: 'description', from: cur.description, to: p.description });
      if (sig(cur.entries) !== sig(entries)) ch.push({ field: 'entries', from: entriesText(cur.entries), to: entriesText(entries) });
      if (!ch.length) { it.kind = 'same'; items.push(it); return; }
      it.kind = 'upd'; it.changes = ch; it.payload = p;
      it.run = function () { return ctx.EP.call('timeoff-policy-sets.update', { id: g.sid }, { body: p, module: MOD }); };
    } else {
      it.label = g.name;
      var p2 = { name: g.name, description: desc || g.name, entries: entries };
      if (sets.some(function (s) { return String(s.name || '').toLowerCase() === g.name.toLowerCase(); })) it.note = 'A set with this name already exists — a second one will be created.';
      it.kind = 'new'; it.payload = p2;
      it.changes = [{ field: 'entries', from: '', to: entriesText(entries) }];
      it.run = function () { return ctx.EP.call('timeoff-policy-sets.create', null, { body: p2, module: MOD }); };
    }
    items.push(it);
  });
  items.sort(function (a, b) { return parseInt(a.row, 10) - parseInt(b.row, 10); });
  return items;
}

function browse(bodyEl) {
  var holder = h('div', h('div.card', h('span.spin'), '  Loading sets from ' + Api.envLabel() + '…'));
  bodyEl.appendChild(holder);
  async function draw() {
    var sets = await loadSets();
    var rows = sets.map(function (s) {
      return { id: s.id, name: s.name || '', description: s.description || '', n: (s.entries || []).length,
        list: (s.entries || []).map(function (e) { return (e.name || ('#' + e.id)) + (e.paycode && e.paycode.id != null ? ' · paycode ' + e.paycode.id : ''); }).join(', ') };
    });
    var delBtn = UI.btn('Delete selected', { icon: 'trash', kind: 'quiet', sm: true }); delBtn.disabled = true;
    var tbl = UI.table([{ key: 'id', label: 'Id' }, { key: 'name', label: 'Name' }, { key: 'description', label: 'Description' }, { key: 'n', label: 'Entries' }, { key: 'list', label: 'Time off policies', wrap: true }], rows, {
      select: true,
      onSelect: function (s) { delBtn.disabled = !s.size; U.swap(delBtn, U.icon('trash', 16), h('span', s.size ? 'Delete ' + s.size : 'Delete selected')); },
      toolbar: [
        UI.btn('Refresh', { icon: 'retry', sm: true, kind: 'quiet', onClick: draw }),
        UI.btn('Full detail', { icon: 'download', sm: true, kind: 'quiet', title: 'One row per time off policy entry (old "View Existing" file)', onClick: downloadFull }),
        UI.btn('Export for editing', { icon: 'download', sm: true, onClick: function () { return template(true); } }),
        delBtn]
    });
    delBtn.onclick = function () {
      var todo = Array.from(tbl.selected).map(function (id) {
        var r = rows.filter(function (x) { return String(x.id) === id; })[0] || {};
        return { kind: 'del', ref: id, label: (r.name || '') + ' (id ' + id + ')', run: function () { return ctx.EP.call('timeoff-policy-sets.remove', { id: id }, { module: MOD }); } };
      });
      E.runDeletes(todo, MOD, 'set').then(function (r) { if (r) draw(); });
    };
    U.swap(holder, rows.length ? tbl : UI.empty('No time off policy sets in ' + Api.envLabel() + ' yet.'));
  }
  draw().catch(function (e) { U.swap(holder, UI.note('bad', 'Could not load sets', e.message)); });
}

ctx.defineTool('timeoff-policy-sets', {
  desc: 'Link time off policies to paycodes in sets: create or update sets from Excel, export them, or delete old ones.',
  render: function (view) {
    view.appendChild(UI.tabs([
      { id: 'upload', label: 'Create / update', render: function (b) {
        b.appendChild(E.uploadFlow({
          module: MOD, template: function () { return template(false); }, parse: parse, itemLabel: 'Set', verb: 'set change', blankNote: 'On update a blank name or description keeps the current value. The set\'s entries are replaced by the rows you upload.',
          intro: 'One row per time off policy entry. Leave ID blank to create a set (rows with the same set name become one set). Fill ID to update a set — its entries are replaced by the rows you upload. Every row needs a Timeoff Policy Entry ID and a Paycode ID.'
        }));
      } },
      { id: 'browse', label: 'Browse & export', render: browse }
    ]));
  }
});
