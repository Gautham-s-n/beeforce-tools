/* modules/accrual-policy-sets.js — Accrual Policy Set: group accrual policies into sets.
 * Endpoints (core/endpoints.js):
 * accrual-policy-sets.list      ?projection=FULL — list (entries expanded)
 * accrual-policy-sets.policies  reference (Accrual_Policies_Master)
 * accrual-policy-sets.create    create { name, description, entries:[{id}] }  (no trailing slash, as old)
 * accrual-policy-sets.update    update { id, name, description, entries:[{id}] }
 * accrual-policy-sets.remove    delete
 * Note: this module did NOT use buildPolicySetModule in the old tool — entries are flat { id: <accrual policy id> }
 * with no priority and no wrapper key, so E.policySet does not fit. It is ported with E.uploadFlow + grouping. */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Accrual Policy Set';

var UPLOAD_HEADERS = ['ID', 'Accrual Set Name', 'Accrual Set Description', 'Accrual Policy ID'];
var INPUT_COLS = [1, 3];
// Old "View Existing" / Existing_Sets_Full layout (the duplicate "id" header is as in the old tool).
var VIEW_HEADERS = ['id', 'Accrual Set Name', 'Accrual Set Description', 'id', 'Accrual Policy Name', 'Accrual Policy Description', 'Accrual ID'];

function fetchSets() { return ctx.EP.list('accrual-policy-sets.list', null, { module: MOD }); }
function fetchPolicies() { return ctx.EP.listQuiet('accrual-policy-sets.policies', null, { module: MOD }); }

// FULL projection expands each entry straight into the policy's own fields; tolerate an accrualPolicy wrapper too.
function entryPolicy(e) { return (e && (e.accrualPolicy || e)) || {}; }
function policyIds(set) { return (set.entries || []).map(function (e) { return entryPolicy(e).id; }).filter(function (x) { return x != null; }); }

function viewRows(sets) {
  var rows = [];
  sets.forEach(function (set) {
    var en = set.entries || [];
    if (!en.length) { rows.push([set.id, set.name || '', set.description || '', '', '', '', '']); return; }
    en.forEach(function (e) {
      var p = entryPolicy(e);
      rows.push([set.id, set.name || '', set.description || '', p.id || '', p.name || '', p.description || '', p.accrual && p.accrual.id != null ? p.accrual.id : '']);
    });
  });
  return rows;
}
// Upload-format rows (one per policy in the set) — re-uploading these unchanged gives "No change".
function uploadRows(sets) {
  var rows = [];
  sets.forEach(function (set) {
    var ids = policyIds(set);
    if (!ids.length) { rows.push([set.id, set.name || '', set.description || '', '']); return; }
    ids.forEach(function (pid) { rows.push([set.id, set.name || '', set.description || '', pid]); });
  });
  return rows;
}
function masterRows(pols) { return pols.map(function (p) { return [p.id, p.name || '', p.description || '']; }); }

async function template(withData) {
  var res = await Promise.all([fetchSets().catch(function () { return []; }), fetchPolicies()]);
  var sets = res[0], pols = res[1];
  await X.download(withData ? 'accrual_policy_sets_export_' + U.stamp() + '.xlsx' : 'accrual_policy_sets_template.xlsx', [
    { name: 'Upload_Template', tabColor: '0369A1', headers: UPLOAD_HEADERS, rows: withData ? uploadRows(sets) : [], highlightCols: INPUT_COLS },
    { name: 'Existing_Sets_Full', tabColor: '7C3AED', headers: VIEW_HEADERS, rows: viewRows(sets) },
    { name: 'Accrual_Policies_Master', tabColor: '059669', headers: ['id', 'name', 'description'], rows: masterRows(pols) }
  ]);
}

function polName(byId, id) { var p = byId[String(id)]; return p ? p.name || ('#' + id) : String(id); }

async function parse(file) {
  var res = await Promise.all([fetchSets(), fetchPolicies()]);
  var sets = res[0], pols = res[1];
  var setById = {}; sets.forEach(function (s) { setById[String(s.id)] = s; });
  var polById = {}; pols.forEach(function (p) { polById[String(p.id)] = p; });
  var items = [], groups = {}, order = [];

  // Old rules: Accrual Policy ID is required on every row; blank ID needs an Accrual Set Name.
  // Rows group by ID (update) or, when ID is blank, by Accrual Set Name (create).
  file.rows.forEach(function (r) {
    var sid = X.int(X.col(r, 'ID'));
    var name = X.str(X.col(r, 'Accrual Set Name'));
    var pid = X.int(X.col(r, 'Accrual Policy ID'));
    if (pid == null) { items.push({ kind: 'bad', row: r.__row, label: name || (sid != null ? 'Set ' + sid : 'Row ' + r.__row), error: 'Accrual Policy ID is required/invalid' }); return; }
    if (sid == null && !name) { items.push({ kind: 'bad', row: r.__row, label: 'Row ' + r.__row, error: 'Accrual Set Name required when ID is blank' }); return; }
    var key = sid != null ? 'id:' + sid : 'name:' + name;
    if (!groups[key]) { groups[key] = { sid: sid, name: name, rows: [] }; order.push(key); }
    groups[key].rows.push(r);
  });

  // Old order: all updates first, then creates.
  order = order.filter(function (k) { return groups[k].sid != null; }).concat(order.filter(function (k) { return groups[k].sid == null; }));
  order.forEach(function (key) {
    var g = groups[key], first = g.rows[0];
    var name = X.str(X.col(first, 'Accrual Set Name')), desc = X.str(X.col(first, 'Accrual Set Description'));
    var entries = [], seen = {}, missing = [];
    g.rows.forEach(function (r) {
      var pid = X.int(X.col(r, 'Accrual Policy ID'));
      if (seen[pid]) return; seen[pid] = 1;
      if (pols.length && !polById[String(pid)]) missing.push(pid);
      entries.push({ id: pid });
    });
    var it = { row: g.rows.map(function (r) { return r.__row; }).join(', '), ref: g.sid, entries: entries.length };
    var after = entries.map(function (e) { return polName(polById, e.id); }).join(', ');
    if (g.sid != null) {
      var cur = setById[String(g.sid)];
      it.label = (name || (cur && cur.name) || 'Set') + ' (id ' + g.sid + ')';
      if (!cur) { it.kind = 'bad'; it.error = 'No accrual policy set with id ' + g.sid + ' in ' + Api.envLabel(); items.push(it); return; }
      if (missing.length) { it.kind = 'bad'; it.error = 'Accrual policy id(s) not found: ' + missing.join(', '); items.push(it); return; }
      // Old: name/description from the group's first row; description falls back to the name.
      // Blank cells keep the current value here (the old tool sent a blank name).
      var p = { id: g.sid, name: name || cur.name || '', description: desc || cur.description || name || cur.name || '', entries: entries };
      var ch = [];
      if ((p.name || '') !== (cur.name || '')) ch.push({ field: 'Accrual Set Name', from: cur.name, to: p.name });
      if ((p.description || '') !== (cur.description || '')) ch.push({ field: 'Accrual Set Description', from: cur.description, to: p.description });
      var curIds = policyIds(cur);
      if (curIds.map(String).sort().join(',') !== entries.map(function (e) { return String(e.id); }).sort().join(',')) {
        ch.push({ field: 'Accrual policies', from: curIds.map(function (id) { return polName(polById, id); }).join(', '), to: after });
      }
      if (!ch.length) { it.kind = 'same'; items.push(it); return; }
      it.kind = 'upd'; it.changes = ch; it.payload = p;
      it.run = function () { return ctx.EP.call('accrual-policy-sets.update', { id: g.sid }, { body: p, module: MOD }); };
    } else {
      it.label = g.name;
      if (missing.length) { it.kind = 'bad'; it.error = 'Accrual policy id(s) not found: ' + missing.join(', '); items.push(it); return; }
      var p2 = { name: g.name, description: desc || g.name, entries: entries };
      it.kind = 'new'; it.payload = p2;
      it.changes = [{ field: 'Accrual policies', from: '', to: after }];
      if (sets.some(function (s) { return String(s.name || '') === g.name; })) it.label += ' (a set with this name already exists — a second one will be created)';
      it.run = function () { return ctx.EP.call('accrual-policy-sets.create', null, { body: p2, module: MOD }); };
    }
    items.push(it);
  });
  return items;
}

function browse(bodyEl) {
  var holder = h('div', h('div.card', h('span.spin'), '  Loading accrual policy sets from ' + Api.envLabel() + '…'));
  bodyEl.appendChild(holder);
  async function draw() {
    var res = await Promise.all([fetchSets(), fetchPolicies()]);
    var sets = res[0];
    var polById = {}; res[1].forEach(function (p) { polById[String(p.id)] = p; });
    var rows = sets.map(function (s) {
      var ids = policyIds(s);
      return { id: s.id, name: s.name, description: s.description, n: ids.length,
        list: (s.entries || []).map(function (e) { var p = entryPolicy(e); return p.name || polName(polById, p.id); }).join(', ') };
    });
    var delBtn = UI.btn('Delete selected', { icon: 'trash', kind: 'quiet', sm: true }); delBtn.disabled = true;
    var tbl = UI.table([{ key: 'id', label: 'Id' }, { key: 'name', label: 'Accrual Set Name' }, { key: 'description', label: 'Description' }, { key: 'n', label: 'Policies' }, { key: 'list', label: 'Accrual policies', wrap: true }], rows, {
      select: true,
      onSelect: function (s) { delBtn.disabled = !s.size; U.swap(delBtn, U.icon('trash', 16), h('span', s.size ? 'Delete ' + s.size : 'Delete selected')); },
      toolbar: [
        UI.btn('Refresh', { icon: 'retry', sm: true, kind: 'quiet', onClick: draw }),
        // Old "View Existing": one row per (set, policy) with the policy's own fields.
        UI.btn('Download full view', { icon: 'list', sm: true, kind: 'quiet', onClick: async function () {
          var s = await fetchSets();
          await X.download('accrual_policy_sets_' + new Date().toISOString().slice(0, 10) + '.xlsx', [{ name: 'Accrual_Policy_Sets', tabColor: '0369A1', headers: VIEW_HEADERS, rows: viewRows(s) }]);
        } }),
        UI.btn('Export for editing', { icon: 'download', sm: true, onClick: function () { return template(true); } }),
        delBtn]
    });
    delBtn.onclick = function () {
      var todo = Array.from(tbl.selected).map(function (id) {
        var r = rows.filter(function (x) { return String(x.id) === id; })[0] || {};
        return { kind: 'del', ref: id, label: (r.name || '') + ' (id ' + id + ')', run: function () { return ctx.EP.call('accrual-policy-sets.remove', { id: id }, { module: MOD }); } };
      });
      E.runDeletes(todo, MOD, 'accrual policy set').then(function (r) { if (r) draw(); });
    };
    U.swap(holder, rows.length ? tbl : UI.empty('No accrual policy sets in ' + Api.envLabel() + ' yet.'));
  }
  draw().catch(function (e) { U.swap(holder, UI.note('bad', 'Could not load accrual policy sets', e.message)); });
}

ctx.defineTool('accrual-policy-sets', {
  desc: 'Group accrual policies into sets from Excel, export them for editing, or delete sets.',
  render: function (view) {
    view.appendChild(UI.tabs([
      { id: 'upload', label: 'Create / update', render: function (b) {
        b.appendChild(E.uploadFlow({
          module: MOD, template: function () { return template(false); }, parse: parse, itemLabel: 'Set', verb: 'set change', blankNote: 'On update a blank name or description keeps the current value. The set\'s accrual policies are replaced by the rows you upload.',
          intro: 'One row per accrual policy in the set. Leave ID blank to create a set, fill it to update one (its policies are replaced by the rows you upload). Rows with the same ID — or, for new sets, the same Accrual Set Name — become one set. Accrual Policy ID is required on every row.',
          reportCols: [{ label: 'entries_submitted', get: function (it) { return it.entries == null ? '' : it.entries; } }]
        }));
      } },
      { id: 'browse', label: 'Browse & export', render: browse }
    ]));
  }
});
