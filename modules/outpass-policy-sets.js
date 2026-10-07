/* modules/outpass-policy-sets.js — Outpass Policy Set: create / update sets of outpass policies from Excel, export, delete.
 * Endpoints (core/endpoints.js):
 * outpass-policy-sets.list      ?projection=FULL
 * outpass-policy-sets.types     (names + reference sheet)
 * outpass-policy-sets.policies  ?attributes=attendanceAdjustmentType (reference sheet + id check)
 * outpass-policy-sets.create    (create)
 * outpass-policy-sets.update    (update — trailing slash, as in the old tool)
 * outpass-policy-sets.remove    (trailing slash, as in the old tool)
 * Entry shape kept exactly as the old tool: { id: "<outpass policy id as a STRING>", attendanceAdjustmentType: { id: <number> } }. */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Outpass Policy Set';

var UPLOAD_HEADERS = ['id', 'Name', 'Description', 'Outpass Policy ID', 'Attendance Adjustment Type ID'];
var EXISTING_HEADERS = ['id', 'Name', 'Description', 'Outpass Policy ID', 'Outpass Policy Name', 'Attendance Adjustment Type ID', 'Attendance Adjustment Type'];
var ADJTYPE_HEADERS = ['id', 'name', 'description', 'inactive', 'outpass'];
var POLICY_HEADERS = ['id', 'Name', 'Description', 'Attendance Adjustment Type ID', 'Attendance Adjustment Type name'];
var INPUT_COLS = [1, 3, 4];

function col(row, name) { return X.str(X.col(row, name)); }
function pInt(x) { var n = parseInt(parseFloat(x), 10); return isNaN(n) ? null : n; }
function fromBool(b) { return b ? 'TRUE' : 'FALSE'; }

async function loadSets() { return ctx.EP.list('outpass-policy-sets.list', null, { module: MOD }); }
async function loadTypes() { return ctx.EP.listQuiet('outpass-policy-sets.types', null, { module: MOD }); }
async function loadPolicies() { return ctx.EP.listQuiet('outpass-policy-sets.policies', null, { module: MOD }); }
function typeNames(types) { var m = {}; types.forEach(function (t) { m[t.id] = t.name || ''; }); return m; }

/* Old buildExistingRows — one row per entry (this is also the "Export for editing" file; it re-uploads unchanged). */
function existingRows(sets, adj) {
  var rows = [];
  sets.forEach(function (set) {
    if (!(set.entries || []).length) rows.push([set.id, set.name || '', set.description || '', '', '', '', '']);
    else set.entries.forEach(function (e) {
      var a = e.attendanceAdjustmentType ? e.attendanceAdjustmentType.id : '';
      rows.push([set.id, set.name || '', set.description || '', e.id, e.name || '', a, adj[a] || '']);
    });
  });
  return rows;
}
function sig(entries) { return (entries || []).map(function (e) { return String(e.id).trim() + ':' + ((e.attendanceAdjustmentType || {}).id); }).sort().join(','); }
function entriesText(entries, polName) {
  return (entries || []).map(function (e) { var n = polName[String(e.id).trim()] || e.name; return (n ? n + ' ' : '') + '#' + e.id + ' / type ' + ((e.attendanceAdjustmentType || {}).id); }).join(', ');
}

async function template(withData) {
  var res = await Promise.all([loadSets().catch(function () { return []; }), loadTypes(), loadPolicies()]);
  var adj = typeNames(res[1]);
  var ex = existingRows(res[0], adj);
  if (withData) {
    await X.download('outpolset_existing_' + new Date().toISOString().slice(0, 10) + '.xlsx', [{ name: 'Outpass_Policy_Sets', tabColor: '7C3AED', headers: EXISTING_HEADERS, rows: ex, highlightCols: INPUT_COLS.map(function (i) { return i === 4 ? 5 : i; }) }]);
    return;
  }
  await X.download('outpass_policy_sets_template.xlsx', [
    { name: 'Upload_Template', tabColor: '1D4ED8', headers: UPLOAD_HEADERS, rows: [], highlightCols: INPUT_COLS },
    { name: 'Existing_Outpass_Policy_Sets', tabColor: '7C3AED', headers: EXISTING_HEADERS, rows: ex },
    { name: 'Adjustment_Types_Master', tabColor: '059669', headers: ADJTYPE_HEADERS, rows: res[1].map(function (t) { return [t.id, t.name || '', t.description || '', fromBool(t.inactive), fromBool(t.outpass)]; }) },
    { name: 'Outpass_Policies_Master', tabColor: 'EA580C', headers: POLICY_HEADERS, rows: res[2].map(function (p) { var a = p.attendanceAdjustmentType ? p.attendanceAdjustmentType.id : ''; return [p.id, p.name || '', p.description || '', a, adj[a] || '']; }) }
  ]);
}

async function parse(file) {
  var res = await Promise.all([loadSets(), loadPolicies()]);
  var sets = res[0], pols = res[1];
  var byId = {}; sets.forEach(function (x) { byId[String(x.id)] = x; });
  var polName = {}; pols.forEach(function (p) { polName[String(p.id)] = p.name || ''; });
  var items = [], groups = {}, order = [];
  file.rows.forEach(function (r) {
    var sid = pInt(col(r, 'id')), name = col(r, 'Name');
    if (sid == null && !name) { items.push({ kind: 'skip', row: r.__row, label: 'Row ' + r.__row, note: 'No id and no Name — skipped' }); return; }
    var key = sid != null ? 'id:' + sid : 'name:' + name;
    if (!groups[key]) { groups[key] = { sid: sid, name: name, rows: [] }; order.push(key); }
    groups[key].rows.push(r);
  });
  order.forEach(function (key) {
    var g = groups[key], first = g.rows[0];
    var it = { row: g.rows.map(function (r) { return r.__row; }).join(', '), ref: g.sid };
    var entries = [], seen = {}, half = [], missing = [];
    g.rows.forEach(function (r) {
      var pid = col(r, 'Outpass Policy ID'), tid = pInt(col(r, 'Attendance Adjustment Type ID'));
      if (!pid || tid === null) { if (pid || tid !== null) half.push(r.__row); return; } // old tool skips such rows
      var k = pid + '-' + tid; if (seen[k]) return; seen[k] = 1;
      if (pols.length && !(String(pid) in polName)) missing.push(pid);
      entries.push({ id: String(pid).trim(), attendanceAdjustmentType: { id: tid } });
    });
    var nm = col(first, 'Name'), desc = col(first, 'Description');
    var p;
    if (g.sid != null) {
      var cur = byId[String(g.sid)];
      it.label = (nm || (cur && cur.name) || 'Set') + ' (id ' + g.sid + ')';
      if (!cur) { it.kind = 'bad'; it.error = 'No set with id ' + g.sid + ' in ' + Api.envLabel(); items.push(it); return; }
      var name = nm || cur.name || ''; // blank keeps the current name / description (same as Engine.policySet)
      p = { name: name, description: desc || cur.description || name, entries: entries, id: g.sid };
      var ch = [];
      if ((p.name || '') !== (cur.name || '')) ch.push({ field: 'name', from: cur.name, to: p.name });
      if ((p.description || '') !== (cur.description || '')) ch.push({ field: 'description', from: cur.description, to: p.description });
      if (sig(cur.entries) !== sig(entries)) ch.push({ field: 'entries', from: entriesText(cur.entries, polName), to: entriesText(entries, polName) });
      it.changes = ch;
      if (!ch.length) { it.kind = 'same'; items.push(it); return; }
      it.kind = 'upd';
      it.run = function () { return ctx.EP.call('outpass-policy-sets.update', { id: g.sid }, { body: p, module: MOD }); };
    } else {
      it.label = g.name;
      p = { name: nm, description: desc || nm, entries: entries };
      if (sets.some(function (x) { return String(x.name || '').toLowerCase() === nm.toLowerCase(); })) it.note = 'A set with this name already exists — a second one will be created.';
      it.kind = 'new';
      it.changes = [{ field: 'entries', from: '', to: entriesText(entries, polName) }];
      it.run = function () { return ctx.EP.call('outpass-policy-sets.create', null, { body: p, module: MOD }); };
    }
    // The policy list is fetched like the old tool (no page/size); if the server pages it, a real id could be missing
    // from it — so an unknown id is a warning to check, not an error.
    if (missing.length) {
      var warn = 'Outpass Policy ID(s) ' + missing.join(', ') + ' not in the ' + pols.length + ' polic' + (pols.length === 1 ? 'y' : 'ies') + ' loaded from ' + Api.envLabel() + ' — make sure they exist.';
      if (it.note) it.note += ' ' + warn; else it.changes.unshift({ field: 'check', from: '', to: warn });
    }
    if (half.length) it.changes.push({ field: 'skipped rows', from: '', to: half.join(', ') + ' (need both Outpass Policy ID and Attendance Adjustment Type ID)' });
    it.payload = p;
    items.push(it);
  });
  items.sort(function (a, b) { return parseInt(a.row, 10) - parseInt(b.row, 10); });
  return items;
}

function browse(bodyEl) {
  var holder = h('div', h('div.card', h('span.spin'), '  Loading sets from ' + Api.envLabel() + '…'));
  bodyEl.appendChild(holder);
  async function draw() {
    var res = await Promise.all([loadSets(), loadTypes()]);
    var adj = typeNames(res[1]);
    var rows = res[0].map(function (st) {
      return { id: st.id, name: st.name || '', description: st.description || '', n: (st.entries || []).length,
        list: (st.entries || []).map(function (e) { var a = (e.attendanceAdjustmentType || {}).id; return (e.name || '#' + e.id) + (a != null ? ' · ' + (adj[a] || 'type ' + a) : ''); }).join(', ') };
    });
    var delBtn = UI.btn('Delete selected', { icon: 'trash', kind: 'quiet', sm: true }); delBtn.disabled = true;
    var tbl = UI.table([{ key: 'id', label: 'Id' }, { key: 'name', label: 'Name' }, { key: 'description', label: 'Description' }, { key: 'n', label: 'Policies' }, { key: 'list', label: 'Outpass policies', wrap: true }], rows, {
      select: true,
      onSelect: function (sel) { delBtn.disabled = !sel.size; U.swap(delBtn, U.icon('trash', 16), h('span', sel.size ? 'Delete ' + sel.size : 'Delete selected')); },
      toolbar: [UI.btn('Refresh', { icon: 'retry', sm: true, kind: 'quiet', onClick: draw }), UI.btn('Export for editing', { icon: 'download', sm: true, onClick: function () { return template(true); } }), delBtn]
    });
    delBtn.onclick = function () {
      var todo = Array.from(tbl.selected).map(function (id) {
        var r = rows.filter(function (x) { return String(x.id) === id; })[0] || {};
        return { kind: 'del', ref: id, label: (r.name || '') + ' (id ' + id + ')', run: function () { return ctx.EP.call('outpass-policy-sets.remove', { id: id }, { module: MOD }); } };
      });
      E.runDeletes(todo, MOD, 'set').then(function (r) { if (r) draw(); });
    };
    U.swap(holder, rows.length ? tbl : UI.empty('No outpass policy sets in ' + Api.envLabel() + ' yet.'));
  }
  draw().catch(function (e) { U.swap(holder, UI.note('bad', 'Could not load sets', e.message)); });
}

ctx.defineTool('outpass-policy-sets', {
  desc: 'Group outpass policies into sets: create or update sets from Excel, export them, or delete old ones.',
  render: function (view) {
    view.appendChild(UI.tabs([
      { id: 'upload', label: 'Create / update', render: function (b) {
        b.appendChild(E.uploadFlow({
          module: MOD, template: function () { return template(false); }, parse: parse, itemLabel: 'Set', verb: 'set change', blankNote: 'On update a blank name or description keeps the current value. The set\'s outpass policies are replaced by the rows you upload.',
          intro: 'One row per outpass policy in the set. Leave id blank to create a set (rows with the same Name become one set); fill id to update — the set\'s policies are replaced by the rows you upload. Each row needs an Outpass Policy ID and its Attendance Adjustment Type ID.'
        }));
      } },
      { id: 'browse', label: 'Browse & export', render: browse }
    ]));
  }
});
