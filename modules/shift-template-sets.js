/* modules/shift-template-sets.js — Shift Template Set: group shift templates.
 * Endpoints (core/endpoints.js):
 *   shift-template-sets.list        ?projection=FULL
 *   shift-template-sets.templates   (reference sheet / names)
 *   shift-template-sets.create      (trailing slash)
 *   shift-template-sets.update {id} (trailing slash as the old tool)   shift-template-sets.remove {id}
 * Upload: set_id, set_name, set_description, entry_id. entry_id IS the shift template id (old rule):
 * payload { id?, name, description, entries:[{ id: <shift template id> }] }. An update replaces the entries. */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Shift Template Set';
var HEAD = ['set_id', 'set_name', 'set_description', 'entry_id'];
var VIEW_HEAD = ['id', 'name', 'description', 'id', 'name', 'description', 'Start Time', 'End Time', 'Start day', 'End Day',
  'beforeStartToleranceMinute', 'afterStartToleranceMinute', 'lateInToleranceMinute', 'earlyOutToleranceMinute',
  'report', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

function loadSets() { return ctx.EP.list('shift-template-sets.list', null, { module: MOD }); }
function loadTemplates() { return ctx.EP.listQuiet('shift-template-sets.templates', null, { module: MOD }); }
function byIdOf(list) { var o = {}; list.forEach(function (x) { o[String(x.id)] = x; }); return o; }
// A set entry may come back as { shiftTemplate:{…} } or as the shift template itself.
function tplOf(entry) { return (entry && entry.shiftTemplate) || entry || {}; }
function tplIds(set) { return (set.entries || []).map(function (e) { return tplOf(e).id; }).filter(function (x) { return x != null; }); }
function tName(byId, id) { var t = byId[String(id)]; return t ? (t.name || t.description || '#' + id) : '#' + id; }

function fmtTime(dt) { if (!dt) return ''; var p = String(dt).split(' '); return p.length > 1 ? p[1].slice(0, 5) : String(dt).slice(0, 5); }
function fmtDay(dt) { if (!dt) return 1; return String(dt).split(' ')[0].slice(-2) === '02' ? 2 : 1; }
function tb(v) { return v ? 'TRUE' : 'FALSE'; }
function nz(v) { return v != null ? v : ''; }

// Old "Existing Sets" / "View Existing" layout: one row per (set, shift template), template fields flattened.
function viewRows(sets) {
  var rows = [];
  sets.forEach(function (set) {
    var en = set.entries || [];
    if (!en.length) { rows.push([set.id, set.name || '', set.description || ''].concat(VIEW_HEAD.slice(3).map(function () { return ''; }))); return; }
    en.forEach(function (entry) {
      var t = tplOf(entry);
      rows.push([set.id, set.name || '', set.description || '', t.id || '', t.name || '', t.description || '',
        fmtTime(t.startTime), fmtTime(t.endTime), fmtDay(t.startTime), fmtDay(t.endTime),
        nz(t.beforeStartToleranceMinute), nz(t.afterStartToleranceMinute), nz(t.lateInToleranceMinute), nz(t.earlyOutToleranceMinute),
        tb(t.report), tb(t.monday), tb(t.tuesday), tb(t.wednesday), tb(t.thursday), tb(t.friday), tb(t.saturday), tb(t.sunday)]);
    });
  });
  return rows;
}
function uploadRows(sets) {
  var rows = [];
  sets.forEach(function (s) {
    var ids = tplIds(s);
    if (!ids.length) rows.push([s.id, s.name || '', s.description || '', '']);
    ids.forEach(function (id) { rows.push([s.id, s.name || '', s.description || '', id]); });
  });
  return rows;
}
function masterSheet(tpls) {
  return { name: 'Shift_Templates_Master', tabColor: '059669', headers: ['id', 'name', 'description'], rows: tpls.map(function (t) { return [t.id, t.name || '', t.description || '']; }) };
}

async function template() {
  var res = await Promise.all([loadSets().catch(function () { return []; }), loadTemplates()]);
  await X.download('shift_template_sets_template.xlsx', [
    { name: 'Upload_Template', tabColor: 'D97706', headers: HEAD, rows: [], highlightCols: [1, 3] },
    { name: 'Existing_Sets_Full', tabColor: '7C3AED', headers: VIEW_HEAD, rows: viewRows(res[0]) },
    masterSheet(res[1])
  ]);
}
async function exportForEditing() {
  var res = await Promise.all([loadSets(), loadTemplates()]);
  await X.download('shift_template_sets_export_' + U.stamp() + '.xlsx', [
    { name: 'Upload_Template', tabColor: 'D97706', headers: HEAD, rows: uploadRows(res[0]), highlightCols: [1, 3] },
    { name: 'Existing_Sets_Full', tabColor: '7C3AED', headers: VIEW_HEAD, rows: viewRows(res[0]) },
    masterSheet(res[1])
  ]);
}
async function fullView() {
  var sets = await loadSets();
  if (!sets.length) { UI.toast('No sets found.'); return; }
  await X.download('shift_template_sets_' + new Date().toISOString().slice(0, 10) + '.xlsx', [{ name: 'Shift_Template_Sets', tabColor: 'D97706', headers: VIEW_HEAD, rows: viewRows(sets) }]);
}

function sig(ids) { return ids.map(String).sort().join(','); }

async function parse(file) {
  var res = await Promise.all([loadSets(), loadTemplates()]);
  var sets = res[0], tpls = res[1];
  var setById = byIdOf(sets), tById = byIdOf(tpls);
  var upd = {}, updOrder = [], cre = {}, creOrder = [], items = [];
  file.rows.forEach(function (r) {
    var rawSid = X.str(X.col(r, 'set_id')), sid = X.int(rawSid);
    var name = X.str(X.col(r, 'set_name'));
    var entryId = X.int(X.col(r, 'entry_id'));
    if (rawSid && sid == null) { items.push({ kind: 'bad', row: r.__row, label: name || rawSid, error: 'set_id “' + rawSid + '” is not a number' }); return; }
    // Old rules: entry_id required on every row; set_name required when set_id is blank.
    if (entryId == null) { items.push({ kind: 'bad', row: r.__row, label: name || (sid != null ? 'Set id ' + sid : '(no set)'), error: 'entry_id (shift template id) is required' }); return; }
    if (sid != null) { if (!upd[sid]) { upd[sid] = []; updOrder.push(sid); } upd[sid].push(r); return; }
    if (!name) { items.push({ kind: 'bad', row: r.__row, label: '(no set)', error: 'set_name is required when set_id is blank' }); return; }
    if (!cre[name]) { cre[name] = []; creOrder.push(name); }
    cre[name].push(r);
  });

  function rowsOf(g) { return g.map(function (r) { return r.__row; }).join(', '); }
  function entriesOf(g) {
    var out = [], seen = {};
    g.forEach(function (r) { var id = X.int(X.col(r, 'entry_id')); if (id == null || seen[id]) return; seen[id] = 1; out.push({ id: id }); });
    return out;
  }
  function missing(entries) { return tpls.length ? entries.filter(function (e) { return !tById[String(e.id)]; }).map(function (e) { return e.id; }) : []; }
  function names(ids) { return ids.map(function (id) { return tName(tById, id); }).join(', '); }

  updOrder.forEach(function (sid) {
    var g = upd[sid], first = g[0], cur = setById[String(sid)];
    var name = X.str(X.col(first, 'set_name')), desc = X.str(X.col(first, 'set_description'));
    var it = { row: rowsOf(g), ref: sid, label: (name || (cur && cur.name) || 'Set') + ' (id ' + sid + ')' };
    if (!cur) { it.kind = 'bad'; it.error = 'No set with id ' + sid + ' in ' + Api.envLabel(); items.push(it); return; }
    var entries = entriesOf(g);
    var miss = missing(entries);
    if (miss.length) { it.kind = 'bad'; it.error = 'Shift template id(s) not found: ' + miss.join(', '); items.push(it); return; }
    // Blank set_name / set_description keep the current values.
    var p = { id: sid, name: name || cur.name, description: desc || cur.description || name || cur.name, entries: entries };
    var ch = [], curIds = tplIds(cur), newIds = entries.map(function (e) { return e.id; });
    if ((p.name || '') !== (cur.name || '')) ch.push({ field: 'name', from: cur.name, to: p.name });
    if ((p.description || '') !== (cur.description || '')) ch.push({ field: 'description', from: cur.description, to: p.description });
    if (sig(curIds) !== sig(newIds)) ch.push({ field: 'shift templates', from: names(curIds), to: names(newIds) });
    if (!ch.length) { it.kind = 'same'; items.push(it); return; }
    it.kind = 'upd'; it.changes = ch; it.payload = p;
    it.run = function () { return ctx.EP.call('shift-template-sets.update', { id: sid }, { body: p, module: MOD }); };
    items.push(it);
  });

  creOrder.forEach(function (name) {
    var g = cre[name], first = g[0];
    var it = { row: rowsOf(g), label: name };
    var entries = entriesOf(g);
    var miss = missing(entries);
    if (miss.length) { it.kind = 'bad'; it.error = 'Shift template id(s) not found: ' + miss.join(', '); items.push(it); return; }
    var p = { name: name, description: X.str(X.col(first, 'set_description')) || name, entries: entries };
    if (sets.some(function (s) { return String(s.name || '') === name; })) it.note = 'A set with this name already exists — a second one will be created.';
    it.kind = 'new'; it.payload = p;
    it.changes = [{ field: 'shift templates', from: '', to: names(entries.map(function (e) { return e.id; })) }];
    it.run = function () { return ctx.EP.call('shift-template-sets.create', null, { body: p, module: MOD }); };
    items.push(it);
  });
  return items;
}

function browse(bodyEl) {
  var holder = h('div', h('div.card', h('span.spin'), '  Loading shift template sets from ' + Api.envLabel() + '…'));
  bodyEl.appendChild(holder);
  async function draw() {
    var res = await Promise.all([loadSets(), loadTemplates()]);
    var tById = byIdOf(res[1]);
    var rows = res[0].map(function (s) {
      var ids = tplIds(s);
      return { id: s.id, name: s.name, description: s.description, n: ids.length,
        list: (s.entries || []).map(function (e) { var t = tplOf(e); return t.name || tName(tById, t.id); }).join(', ') };
    });
    var delBtn = UI.btn('Delete selected', { icon: 'trash', kind: 'quiet', sm: true }); delBtn.disabled = true;
    var tbl = UI.table([{ key: 'id', label: 'Id' }, { key: 'name', label: 'Name' }, { key: 'description', label: 'Description' }, { key: 'n', label: 'Templates' }, { key: 'list', label: 'Shift templates', wrap: true }], rows, {
      select: true,
      onSelect: function (s) { delBtn.disabled = !s.size; U.swap(delBtn, U.icon('trash', 16), h('span', s.size ? 'Delete ' + s.size : 'Delete selected')); },
      toolbar: [
        UI.btn('Refresh', { icon: 'retry', sm: true, kind: 'quiet', onClick: draw }),
        UI.btn('Full detail', { icon: 'list', sm: true, kind: 'quiet', title: 'One row per shift template with times and days (old “View Existing” file)', onClick: fullView }),
        UI.btn('Export for editing', { icon: 'download', sm: true, onClick: exportForEditing }),
        delBtn]
    });
    delBtn.onclick = function () {
      var todo = Array.from(tbl.selected).map(function (id) {
        var r = rows.filter(function (x) { return String(x.id) === id; })[0] || {};
        return { kind: 'del', ref: id, label: (r.name || '') + ' (id ' + id + ')', run: function () { return ctx.EP.call('shift-template-sets.remove', { id: id }, { module: MOD }); } };
      });
      E.runDeletes(todo, MOD, 'set').then(function (r) { if (r) draw(); });
    };
    U.swap(holder, rows.length ? tbl : UI.empty('No shift template sets in ' + Api.envLabel() + ' yet.'));
  }
  draw().catch(function (e) { U.swap(holder, UI.note('bad', 'Could not load sets', e.message)); });
}

ctx.defineTool('shift-template-sets', {
  desc: 'Group shift templates into sets. Create and update from Excel, export, or delete.',
  render: function (view) {
    view.appendChild(UI.tabs([
      { id: 'upload', label: 'Create / update', render: function (b) {
        b.appendChild(E.uploadFlow({ module: MOD, template: template, parse: parse, itemLabel: 'Set', verb: 'set change', blankNote: 'On update a blank name or description keeps the current value. The set\'s shift templates are replaced by the rows you upload.',
          intro: 'One row per shift template in the set: set_id (blank = create), set_name, set_description, entry_id (the shift template id — see Shift_Templates_Master). Rows with the same set_id or set_name become one set. An update replaces the set’s shift templates with the rows you upload.' }));
      } },
      { id: 'browse', label: 'Browse & export', render: browse }
    ]));
  }
});
