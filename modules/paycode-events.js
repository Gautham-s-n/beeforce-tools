/* modules/paycode-events.js — Paycode Events: holiday-style events with dated schedules.
 * Endpoints (core/endpoints.js):
 *   paycode-events.list       (no projection, as the old tool)
 *   paycode-events.paycodes   (reference sheet / names)
 *   paycode-events.create / .update {id} / .remove {id}
 * One row per schedule (holiday). Rows with the same id (update) or the same name (create) become one event.
 * Payload as the old tool: { id?, name, description, paycode:{id}, schedules:[{ name, startDate:"2026-01-01",
 *   repeatDay, repeatMonth, repeatYear, repeatWeek, repeatWeekday }] } — schedules are sent without ids,
 * so an update replaces the event's schedules with the uploaded rows. */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Paycode Events';
var HEAD = ['id', 'Paycode Event Name', 'Description', 'paycode_id', 'holiday_name', 'holiday_date(YYYY-MM-DD)', 'repeatWeek', 'repeatWeekday'];
var START_DATE = '2026-01-01'; // the old tool hard-codes startDate on every schedule — kept as is

function loadEvents() { return ctx.EP.list('paycode-events.list', null, { module: MOD }); }
function loadPaycodes() { return ctx.EP.listQuiet('paycode-events.paycodes', null, { module: MOD }); }
function byIdOf(list) { var o = {}; list.forEach(function (x) { o[String(x.id)] = x; }); return o; }
function pad(n) { return String(n).padStart(2, '0'); }
function dateOf(s) { return s.repeatYear + '-' + pad(s.repeatMonth) + '-' + pad(s.repeatDay); }
function pcName(pcById, id) { var p = pcById[String(id)]; return p ? (p.code || p.description || '#' + id) : (id ? '#' + id : ''); }

// Same layout as the old "View Existing" download. Events without schedules get one row with blank holiday cells.
function flatRows(events) {
  var rows = [];
  events.forEach(function (e) {
    var sc = e.schedules || [];
    var base = [e.id, e.name || '', e.description || '', (e.paycode || {}).id || ''];
    if (!sc.length) rows.push(base.concat(['', '', '', '']));
    sc.forEach(function (s) { rows.push(base.concat([s.name || '', dateOf(s), s.repeatWeek == null ? '' : s.repeatWeek, s.repeatWeekday == null ? '' : s.repeatWeekday])); });
  });
  return rows;
}

async function template(withData) {
  var res = await Promise.all([withData ? loadEvents() : Promise.resolve([]), loadPaycodes()]);
  await X.download(withData ? 'paycode_events_export_' + U.stamp() + '.xlsx' : 'paycode_events_template.xlsx', [
    { name: 'Paycode_Events', tabColor: '1D4ED8', headers: HEAD, rows: withData ? flatRows(res[0]) : [], highlightCols: [1, 3, 4, 5] },
    { name: 'Paycodes_Master', tabColor: '059669', headers: ['id', 'code', 'description'], rows: res[1].map(function (p) { return [p.id, p.code || '', p.description || '']; }) }
  ]);
}

/* holiday date → [year, month, day]. The old tool only took YYYY-MM-DD; other forms Excel may produce
 * (DD-MM-YYYY, date serials) are converted first instead of being sent wrongly. */
function parseDate(v) {
  var s = X.str(v);
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) { var d = X.date(s); m = d ? d.match(/^(\d{4})-(\d{2})-(\d{2})$/) : null; }
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// Everything that is sent, startDate included (the old tool always sends 2026-01-01, so an older startDate is reset).
function schedSig(list) {
  return list.map(function (s) { return [s.name, dateOf(s), s.startDate == null ? '' : s.startDate, s.repeatWeek == null ? '*' : s.repeatWeek, s.repeatWeekday == null ? '*' : s.repeatWeekday].map(String).join('|'); }).sort().join('\n');
}
function holSig(list) {
  return list.map(function (s) { return [s.name, dateOf(s), s.repeatWeek == null ? '*' : s.repeatWeek, s.repeatWeekday == null ? '*' : s.repeatWeekday].map(String).join('|'); }).sort().join('\n');
}
function schedText(list) { return list.map(function (s) { return s.name + ' ' + dateOf(s) + (s.repeatWeek !== '*' || s.repeatWeekday !== '*' ? ' [' + s.repeatWeek + '/' + s.repeatWeekday + ']' : ''); }).join(', '); }
function startText(list) { return list.map(function (s) { return s.name + ' ' + (s.startDate == null || s.startDate === '' ? '(none)' : s.startDate); }).join(', '); }

/* Old rules (old :109-118): a row needs Paycode Event Name (or, here, an id), paycode_id, holiday_name and a
 * YYYY-MM-DD holiday_date — otherwise the row is skipped (shown as Skipped) and the rest of the event still goes.
 * Event fields (name, description, paycode) come from the first complete row of the event. */
async function parse(file) {
  var res = await Promise.all([loadEvents(), loadPaycodes()]);
  var events = res[0], pcs = res[1];
  var evById = byIdOf(events), pcById = byIdOf(pcs);
  var groups = {}, order = [], items = [];

  file.rows.forEach(function (row) {
    var rawId = X.str(X.col(row, 'id'));
    var name = X.str(X.col(row, 'Paycode Event Name'));
    if (rawId && X.int(rawId) == null) { items.push({ kind: 'bad', row: row.__row, label: name || rawId, error: 'id “' + rawId + '” is not a number' }); return; }
    var key = rawId ? 'id:' + X.int(rawId) : name ? 'name:' + name : null;
    if (!key) { items.push({ kind: 'skip', row: row.__row, label: '(no name)', note: 'No id or Paycode Event Name — row ignored' }); return; }
    if (!groups[key]) { groups[key] = { id: rawId ? X.int(rawId) : null, rows: [] }; order.push(key); }
    groups[key].rows.push(row);
  });

  order.forEach(function (key) {
    var g = groups[key], cur = g.id != null ? evById[String(g.id)] : null;
    var it = { ref: g.id };
    var schedules = [], valid = [], skipped = [];
    g.rows.forEach(function (r) {
      var hName = X.str(X.col(r, 'holiday_name')), hDate = X.str(X.col(r, 'holiday_date(YYYY-MM-DD)'));
      var miss = [];
      if (X.int(X.col(r, 'paycode_id')) == null) miss.push('paycode_id');
      if (!hName) miss.push('holiday_name');
      if (!hDate) miss.push('holiday_date');
      if (miss.length) { skipped.push({ row: r.__row, why: 'no ' + miss.join(', ') }); return; }
      var d = parseDate(hDate);
      if (!d) { skipped.push({ row: r.__row, why: 'bad date “' + hDate + '” (use YYYY-MM-DD)' }); return; }
      valid.push(r);
      schedules.push({ name: hName, startDate: START_DATE, repeatDay: d[2], repeatMonth: d[1], repeatYear: d[0],
        repeatWeek: X.str(X.col(r, 'repeatWeek')) || '*', repeatWeekday: X.str(X.col(r, 'repeatWeekday')) || '*' });
    });
    var first = valid[0] || g.rows[0];
    var name = X.str(X.col(first, 'Paycode Event Name'));
    it.row = (valid.length ? valid : g.rows).map(function (r) { return r.__row; }).join(', ');
    it.label = (name || (cur && cur.name) || '') + (g.id != null ? ' (id ' + g.id + ')' : '');
    var evLabel = it.label || key.slice(key.indexOf(':') + 1);
    skipped.forEach(function (s) { items.push({ kind: 'skip', row: s.row, label: evLabel, note: 'Holiday row skipped (' + s.why + ') — not sent, like the old tool' + (g.id != null ? '. The update replaces the event’s holidays, so a skipped holiday is not kept.' : '.') }); });
    if (!valid.length) return; // old tool: nothing sent for an event without a complete row; the rows are listed as skipped above
    if (g.id != null && !cur) { it.kind = 'bad'; it.error = 'No paycode event with id ' + g.id + ' in ' + Api.envLabel(); items.push(it); return; }

    // On update a blank name / description keeps the current value.
    var desc = X.str(X.col(first, 'Description'));
    var pcId = X.int(X.col(first, 'paycode_id'));
    if (cur) {
      if (!name) name = cur.name || '';
      if (!desc) desc = cur.description || '';
    }
    desc = desc || name; // old rule: description defaults to the name
    var errs = [];
    if (!name) errs.push('Paycode Event Name is required');
    if (pcs.length && !pcById[String(pcId)]) errs.push('paycode_id ' + pcId + ' not found');
    if (errs.length) { it.kind = 'bad'; it.error = errs.join('; '); items.push(it); return; }

    var p = { name: name, description: desc, paycode: { id: pcId }, schedules: schedules };
    if (cur) {
      p.id = g.id;
      var ch = [];
      if (p.name !== (cur.name || '')) ch.push({ field: 'name', from: cur.name, to: p.name });
      if (p.description !== (cur.description || '')) ch.push({ field: 'description', from: cur.description, to: p.description });
      if (String(pcId) !== String((cur.paycode || {}).id)) ch.push({ field: 'paycode', from: pcName(pcById, (cur.paycode || {}).id), to: pcName(pcById, pcId) });
      var curSc = cur.schedules || [];
      if (holSig(curSc) !== holSig(schedules)) ch.push({ field: 'holidays', from: schedText(curSc), to: schedText(schedules) });
      if (schedSig(curSc) !== schedSig(schedules) && curSc.some(function (s) { return s.startDate !== START_DATE; }))
        ch.push({ field: 'startDate', from: startText(curSc), to: START_DATE + ' on every holiday (always sent)' });
      if (!ch.length) { it.kind = 'same'; items.push(it); return; }
      it.kind = 'upd'; it.changes = ch; it.payload = p;
      it.run = function () { return ctx.EP.call('paycode-events.update', { id: g.id }, { body: p, module: MOD }); };
    } else {
      if (events.some(function (e) { return String(e.name || '') === name; })) it.note = 'An event with this name already exists — a second one will be created.';
      it.kind = 'new'; it.payload = p;
      it.changes = [{ field: 'holidays', from: '', to: schedText(schedules) }, { field: 'paycode', from: '', to: pcName(pcById, pcId) }];
      it.run = function () { return ctx.EP.call('paycode-events.create', null, { body: p, module: MOD }); };
    }
    items.push(it);
  });
  return items;
}

function browse(bodyEl) {
  var holder = h('div', h('div.card', h('span.spin'), '  Loading paycode events from ' + Api.envLabel() + '…'));
  bodyEl.appendChild(holder);
  async function draw() {
    var res = await Promise.all([loadEvents(), loadPaycodes()]);
    var pcById = byIdOf(res[1]);
    var rows = res[0].map(function (e) {
      return { id: e.id, name: e.name, description: e.description, paycode: pcName(pcById, (e.paycode || {}).id), n: (e.schedules || []).length, list: schedText(e.schedules || []) };
    });
    var delBtn = UI.btn('Delete selected', { icon: 'trash', kind: 'quiet', sm: true }); delBtn.disabled = true;
    var tbl = UI.table([{ key: 'id', label: 'Id' }, { key: 'name', label: 'Name' }, { key: 'description', label: 'Description' }, { key: 'paycode', label: 'Paycode' }, { key: 'n', label: 'Holidays' }, { key: 'list', label: 'Dates', wrap: true }], rows, {
      select: true,
      onSelect: function (s) { delBtn.disabled = !s.size; U.swap(delBtn, U.icon('trash', 16), h('span', s.size ? 'Delete ' + s.size : 'Delete selected')); },
      toolbar: [
        UI.btn('Refresh', { icon: 'retry', sm: true, kind: 'quiet', onClick: draw }),
        UI.btn('Export for editing', { icon: 'download', sm: true, onClick: function () { return template(true); } }),
        delBtn]
    });
    delBtn.onclick = function () {
      var todo = Array.from(tbl.selected).map(function (id) {
        var r = rows.filter(function (x) { return String(x.id) === id; })[0] || {};
        return { kind: 'del', ref: id, label: (r.name || '') + ' (id ' + id + ')', run: function () { return ctx.EP.call('paycode-events.remove', { id: id }, { module: MOD }); } };
      });
      E.runDeletes(todo, MOD, 'paycode event').then(function (r) { if (r) draw(); });
    };
    U.swap(holder, rows.length ? tbl : UI.empty('No paycode events in ' + Api.envLabel() + ' yet.'));
  }
  draw().catch(function (e) { U.swap(holder, UI.note('bad', 'Could not load paycode events', e.message)); });
}

ctx.defineTool('paycode-events', {
  desc: 'Holiday-style events that put a paycode on given dates. Create and update from Excel, export, or delete.',
  render: function (view) {
    view.appendChild(UI.tabs([
      { id: 'upload', label: 'Create / update', render: function (b) {
        b.appendChild(E.uploadFlow({ module: MOD, template: function () { return template(false); }, parse: parse, itemLabel: 'Event', verb: 'event change', blankNote: 'On update a blank Paycode Event Name or Description keeps the current value. paycode_id, holiday_name and holiday_date are needed on every row — a row missing one is skipped (as in the old tool). The event\'s holidays are replaced by the complete rows you upload, and every holiday is sent with startDate 2026-01-01.',
          intro: 'One row per holiday. Rows with the same id (update) or the same Paycode Event Name (create) become one event. Leave id blank to create. An update replaces the event’s holidays with the rows you upload. Rows without paycode_id, holiday_name or holiday_date are skipped. repeatWeek / repeatWeekday default to *.' }));
      } },
      { id: 'browse', label: 'Browse & export', render: browse }
    ]));
  }
});
