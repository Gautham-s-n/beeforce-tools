/* modules/paycode-event-sets.js — Paycode Event Sets: group paycode events by priority.
 * Endpoints (core/endpoints.js):
 *   paycode-event-sets.list     (trailing slash, ?projection=FULL)
 *   paycode-event-sets.events   (reference sheet / names)
 *   paycode-event-sets.create   (trailing slash as the old tool)
 *   paycode-event-sets.update {id}   paycode-event-sets.remove {id}
 * Not E.policySet: the old module was hand-written, sends overridable:false on every entry and uses its own
 * sheet names, so the grouping is ported here with uploadFlow. */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Paycode Event Sets';
var HEAD = ['set_id', 'set_name', 'set_description', 'entry_id', 'priority', 'paycode_event_id'];
var VIEW_HEAD = ['id', 'name', 'description', 'paycode_event_id', 'priority', 'entry_id', 'paycode_event_name', 'paycode_event_description', 'paycode_id', 'paycode_code'];

function loadSets() { return ctx.EP.list('paycode-event-sets.list', null, { module: MOD }); }
function loadEvents() { return ctx.EP.listQuiet('paycode-event-sets.events', null, { module: MOD }); }
function byIdOf(list) { var o = {}; list.forEach(function (x) { o[String(x.id)] = x; }); return o; }
function evName(refById, id) { var e = refById[String(id)]; return e ? (e.name || e.description || '#' + id) : '#' + id; }

function uploadRows(sets) {
  var rows = [];
  sets.forEach(function (s) {
    var en = s.entries || [];
    if (!en.length) rows.push([s.id, s.name || '', s.description || '', '', '', '']);
    en.forEach(function (e) { rows.push([s.id, s.name || '', s.description || '', e.id == null ? '' : e.id, e.priority == null ? '' : e.priority, (e.paycodeEvent || {}).id || '']); });
  });
  return rows;
}
function masterSheet(events) {
  return { name: 'Paycode_Events_Master', tabColor: '059669', headers: ['id', 'name', 'description', 'paycode_id'],
    rows: events.map(function (e) { return [e.id, e.name || '', e.description || '', (e.paycode || {}).id || '']; }) };
}

async function template(withData) {
  var res = await Promise.all([withData ? loadSets() : Promise.resolve([]), loadEvents()]);
  await X.download(withData ? 'paycode_event_sets_export_' + U.stamp() + '.xlsx' : 'paycode_event_sets_template.xlsx', [
    { name: 'Event_Sets', tabColor: '7C3AED', headers: HEAD, rows: withData ? uploadRows(res[0]) : [], highlightCols: [1, 5] },
    masterSheet(res[1])
  ]);
}

// Old "View Existing" download: one row per entry with event details.
async function fullView() {
  var sets = await loadSets();
  var rows = [];
  sets.forEach(function (set) {
    (set.entries || []).forEach(function (entry) {
      var pe = entry.paycodeEvent || {};
      rows.push([set.id, set.name || '', set.description || '', pe.id || '', entry.priority || '', entry.id || '', pe.name || '', pe.description || '', (pe.paycode || {}).id || '', (pe.paycode || {}).code || '']);
    });
  });
  if (!rows.length) { UI.toast('No set entries to download.'); return; }
  await X.download('paycode_event_sets_existing.xlsx', [{ name: 'Event_Sets', tabColor: '7C3AED', headers: VIEW_HEAD, rows: rows }]);
}

function isOver(e) { return e.overridable != null && e.overridable !== '' && X.bool(e.overridable) !== false; }
// entry signature for the diff: event@priority@overridable (entry ids do not change what the set does)
function sig(entries) {
  return entries.map(function (e) { return (e.paycodeEvent || {}).id + '@' + (e.priority == null ? '' : Number(e.priority)) + (isOver(e) ? '@o' : ''); }).sort().join(',');
}
function entryText(entries, refById) {
  return entries.slice().sort(function (a, b) { return (a.priority || 0) - (b.priority || 0); })
    .map(function (e) { return evName(refById, (e.paycodeEvent || {}).id) + ' (p' + (e.priority == null ? '-' : e.priority) + ')' + (isOver(e) ? ' overridable' : ''); }).join(', ');
}

async function parse(file) {
  var res = await Promise.all([loadSets(), loadEvents()]);
  var sets = res[0], events = res[1];
  var setById = byIdOf(sets), refById = byIdOf(events);
  var upd = {}, updOrder = [], cre = {}, creOrder = [], items = [];
  file.rows.forEach(function (r) {
    var sid = X.int(X.col(r, 'set_id'));
    var rawSid = X.str(X.col(r, 'set_id'));
    if (rawSid && sid == null) { items.push({ kind: 'bad', row: r.__row, label: X.str(X.col(r, 'set_name')) || rawSid, error: 'set_id “' + rawSid + '” is not a number' }); return; }
    if (sid != null) { if (!upd[sid]) { upd[sid] = []; updOrder.push(sid); } upd[sid].push(r); return; }
    var name = X.str(X.col(r, 'set_name'));
    if (!name) { items.push({ kind: 'skip', row: r.__row, label: '(no set)', note: 'No set_id or set_name — row ignored' }); return; }
    if (!cre[name]) { cre[name] = []; creOrder.push(name); }
    cre[name].push(r);
  });

  function rowsOf(g) { return g.map(function (r) { return r.__row; }).join(', '); }
  function missingRefs(entries) {
    if (!events.length) return [];
    return entries.filter(function (e) { return !refById[String(e.paycodeEvent.id)]; }).map(function (e) { return e.paycodeEvent.id; });
  }

  // Updates first, then creates (same order as the old tool).
  updOrder.forEach(function (sid) {
    var g = upd[sid], first = g[0], cur = setById[String(sid)];
    var name = X.str(X.col(first, 'set_name')), desc = X.str(X.col(first, 'set_description'));
    var it = { row: rowsOf(g), ref: sid, label: (name || (cur && cur.name) || 'Set') + ' (id ' + sid + ')' };
    if (!cur) { it.kind = 'bad'; it.error = 'No set with id ' + sid + ' in ' + Api.envLabel(); items.push(it); return; }
    var entries = [], seen = {};
    g.forEach(function (r) {
      var entryId = X.int(X.col(r, 'entry_id'));
      var priority = X.int(X.col(r, 'priority')) || 1;
      var pe = X.int(X.col(r, 'paycode_event_id'));
      if (!pe) return;
      var k = entryId + '-' + pe; if (seen[k]) return; seen[k] = 1;
      var e = { paycodeEvent: { id: pe }, priority: priority, overridable: false }; // old tool always sends overridable:false
      if (entryId != null) e.id = entryId;
      entries.push(e);
    });
    // Blank set_name / set_description keep the current values.
    var p = { id: sid, name: name || cur.name, description: desc || cur.description || name || cur.name, entries: entries };
    // The old tool would PUT an empty entries list and wipe the set — never do that by accident.
    if (!entries.length) { it.kind = 'bad'; it.error = 'No paycode_event_id on any row for this set — nothing sent (an update with no events would empty the set). Add the set’s paycode events, or delete the set in Browse.'; items.push(it); return; }
    var miss = missingRefs(entries);
    if (miss.length) { it.kind = 'bad'; it.error = 'Paycode event id(s) not found: ' + miss.join(', '); items.push(it); return; }
    var ch = [];
    if ((p.name || '') !== (cur.name || '')) ch.push({ field: 'name', from: cur.name, to: p.name });
    if ((p.description || '') !== (cur.description || '')) ch.push({ field: 'description', from: cur.description, to: p.description });
    if (sig(cur.entries || []) !== sig(entries)) ch.push({ field: 'paycode events', from: entryText(cur.entries || [], refById), to: entryText(entries, refById) });
    // overridable is always sent as false (old tool) — list the events that lose it.
    var lose = (cur.entries || []).filter(function (e) { return isOver(e); });
    if (lose.length) ch.push({ field: 'overridable', from: lose.map(function (e) { return evName(refById, (e.paycodeEvent || {}).id) + ' ' + String(e.overridable); }).join(', '), to: 'false on every entry (always sent)' });
    if (!ch.length) { it.kind = 'same'; items.push(it); return; }
    it.kind = 'upd'; it.changes = ch; it.payload = p;
    it.run = function () { return ctx.EP.call('paycode-event-sets.update', { id: sid }, { body: p, module: MOD }); };
    items.push(it);
  });

  creOrder.forEach(function (name) {
    var g = cre[name], first = g[0];
    var it = { row: rowsOf(g), label: name };
    var entries = [], seen = {};
    g.forEach(function (r) {
      var priority = X.int(X.col(r, 'priority')) || 1;
      var pe = X.int(X.col(r, 'paycode_event_id'));
      if (!pe || seen[pe]) return; seen[pe] = 1;
      entries.push({ paycodeEvent: { id: pe }, priority: priority, overridable: false });
    });
    var p = { name: name, description: X.str(X.col(first, 'set_description')) || name, entries: entries };
    var miss = missingRefs(entries);
    if (miss.length) { it.kind = 'bad'; it.error = 'Paycode event id(s) not found: ' + miss.join(', '); items.push(it); return; }
    if (sets.some(function (s) { return String(s.name || '') === name; })) it.note = 'A set with this name already exists — a second one will be created.';
    it.kind = 'new'; it.payload = p;
    it.changes = [{ field: 'paycode events', from: '', to: entryText(entries, refById) || '(none)' }];
    it.run = function () { return ctx.EP.call('paycode-event-sets.create', null, { body: p, module: MOD }); };
    items.push(it);
  });
  return items;
}

function browse(bodyEl) {
  var holder = h('div', h('div.card', h('span.spin'), '  Loading event sets from ' + Api.envLabel() + '…'));
  bodyEl.appendChild(holder);
  async function draw() {
    var res = await Promise.all([loadSets(), loadEvents()]);
    var refById = byIdOf(res[1]);
    var rows = res[0].map(function (s) {
      return { id: s.id, name: s.name, description: s.description, n: (s.entries || []).length, list: entryText(s.entries || [], refById) };
    });
    var delBtn = UI.btn('Delete selected', { icon: 'trash', kind: 'quiet', sm: true }); delBtn.disabled = true;
    var tbl = UI.table([{ key: 'id', label: 'Id' }, { key: 'name', label: 'Name' }, { key: 'description', label: 'Description' }, { key: 'n', label: 'Events' }, { key: 'list', label: 'In priority order', wrap: true }], rows, {
      select: true,
      onSelect: function (s) { delBtn.disabled = !s.size; U.swap(delBtn, U.icon('trash', 16), h('span', s.size ? 'Delete ' + s.size : 'Delete selected')); },
      toolbar: [
        UI.btn('Refresh', { icon: 'retry', sm: true, kind: 'quiet', onClick: draw }),
        UI.btn('Full detail', { icon: 'list', sm: true, kind: 'quiet', title: 'One row per entry with event details (old “View Existing” file)', onClick: fullView }),
        UI.btn('Export for editing', { icon: 'download', sm: true, onClick: function () { return template(true); } }),
        delBtn]
    });
    delBtn.onclick = function () {
      var todo = Array.from(tbl.selected).map(function (id) {
        var r = rows.filter(function (x) { return String(x.id) === id; })[0] || {};
        return { kind: 'del', ref: id, label: (r.name || '') + ' (id ' + id + ')', run: function () { return ctx.EP.call('paycode-event-sets.remove', { id: id }, { module: MOD }); } };
      });
      E.runDeletes(todo, MOD, 'set').then(function (r) { if (r) draw(); });
    };
    U.swap(holder, rows.length ? tbl : UI.empty('No event sets in ' + Api.envLabel() + ' yet.'));
  }
  draw().catch(function (e) { U.swap(holder, UI.note('bad', 'Could not load event sets', e.message)); });
}

ctx.defineTool('paycode-event-sets', {
  desc: 'Group paycode events into sets with a priority for each. Create and update from Excel, export, or delete.',
  render: function (view) {
    view.appendChild(UI.tabs([
      { id: 'upload', label: 'Create / update', render: function (b) {
        b.appendChild(E.uploadFlow({ module: MOD, template: function () { return template(false); }, parse: parse, itemLabel: 'Set', verb: 'set change', blankNote: 'On update a blank set_name or set_description keeps the current value. The set\'s paycode events are replaced by the rows you upload (rows without paycode_event_id are left out), a blank priority is sent as 1, and every entry is sent with overridable false.',
          intro: 'One row per paycode event in the set. Rows with the same set_id (update) or set_name (create) become one set. Leave set_id blank to create. An update replaces the set’s events with the rows you upload.' }));
      } },
      { id: 'browse', label: 'Browse & export', render: browse }
    ]));
  }
});
