/* modules/paycodes.js — Paycodes: create, update, export, delete.
 * Endpoints (core/endpoints.js): paycodes.list (?projection=FULL)   paycodes.attributes
 *   paycodes.create   paycodes.update {id}   paycodes.remove {id}
 * Same headers / payload as the old tool. Not E.entity: the upload also accepts the old alternative linked-paycode
 * columns (Linked Paycode, LinkedPaycode, linked_paycode_id), must stop when paycode_attributes cannot be read,
 * and diffs the payload against the real current record (the builder turns blank flags into FALSE / 0). */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Paycodes';

var HEAD = ['id (blank=create)', 'code', 'description', 'inactive', 'schedule', 'absence',
  'validateWithPaycodeEvent', 'exception', 'historical', 'optionalHoliday',
  'presentDays', 'lopDays', 'leaveDays', 'woDays', 'holDays', 'payableDays', 'otHours',
  'linkTimeOffInTimeCard', 'linkRegularizeInTimeCard', 'futureDays', 'pastDays', 'Linked Paycode (id)'];
var ATTR_AT = 17;
var ID_COL = HEAD[0], LINK_COL = 'Linked Paycode (id)';
// Old payBuildPayload: col("Linked Paycode (id)") || col("Linked Paycode") || col("LinkedPaycode") || col("linked_paycode_id")
var LINK_ALIASES = ['linkedpaycodeid', 'linkedpaycode'];
var BOOLS = ['inactive', 'schedule', 'absence', 'validateWithPaycodeEvent', 'exception', 'historical', 'optionalHoliday', 'linkTimeOffInTimeCard', 'linkRegularizeInTimeCard'];
var NUMS = ['presentDays', 'lopDays', 'leaveDays', 'woDays', 'holDays', 'payableDays', 'otHours'];
var PROPS = ['DAY_FLAG', 'PAYDED_FLG', 'HISTORICAL_PAYDED_FLG', 'HOLIDAY_OT_GROUP'];

function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function attrNames(refs) {
  return (refs.attrs || []).slice().sort(function (a, b) { return (a.sequence || 99) - (b.sequence || 99); }).map(function (a) { return a.name; });
}
function propCols(refs) {
  var extra = attrNames(refs);
  PROPS.forEach(function (p) { if (extra.indexOf(p) < 0) extra.push(p); });
  return extra;
}
function headers(refs) { return HEAD.slice(0, ATTR_AT).concat(propCols(refs), HEAD.slice(ATTR_AT)); }
function tb(v) { return v == null ? 'FALSE' : v ? 'TRUE' : 'FALSE'; }

function flatten(p, refs) {
  var o = { 'id (blank=create)': p.id, code: p.code || '', description: p.description || '' };
  BOOLS.forEach(function (k) { o[k] = tb(p[k]); });
  NUMS.forEach(function (k) { o[k] = p[k] == null ? 0 : p[k]; });
  var props = p.properties || {};
  propCols(refs).forEach(function (k) { o[k] = props[k] == null ? '' : props[k]; });
  o.futureDays = p.futureDays == null ? '' : p.futureDays;
  o.pastDays = p.pastDays == null ? '' : p.pastDays;
  o[LINK_COL] = (p.linkedPaycode || {}).id || '';
  return o;
}

// Old payBuildPayload. On update (cur given) property keys that have no column in the template are kept from the
// current record, so an update never drops properties; a property column set to CLEAR removes that key.
function build(row, refs, cur) {
  var p = { code: X.str(row.code), description: X.str(row.description) };
  BOOLS.forEach(function (k) { p[k] = X.bool(row[k]) === true; });
  NUMS.forEach(function (k) { var n = X.num(row[k]); p[k] = n == null ? 0 : n; });
  var cols = propCols(refs), props = {};
  if (cur && cur.properties) Object.keys(cur.properties).forEach(function (k) { if (cols.indexOf(k) < 0 && cur.properties[k] != null && cur.properties[k] !== '') props[k] = cur.properties[k]; });
  cols.forEach(function (k) { var v = X.str(row[k]); if (v) props[k] = v; });
  if (Object.keys(props).length) p.properties = props;
  var f = X.int(row.futureDays); if (f != null) p.futureDays = f;
  var pd = X.int(row.pastDays); if (pd != null) p.pastDays = pd;
  var l = X.int(row[LINK_COL]); if (l != null) p.linkedPaycode = { id: l };
  return p;
}
function labelOf(r) { return [X.str(r.code), X.str(r.description)].filter(Boolean).join(' — '); }

/* ---------- data ---------- */
function loadList() { return ctx.EP.list('paycodes.list', null, { module: MOD }); }
// Template / browse: quiet like the old payFetchAttrs. Upload: must succeed, or updates would lose properties.
function loadAttrsQuiet() { return ctx.EP.listQuiet('paycodes.attributes', null, { module: MOD }); }
async function loadAttrsStrict() {
  try { return await ctx.EP.list('paycodes.attributes', null, { module: MOD }); }
  catch (e) { throw new Error('Could not load paycode attributes (' + e.message + '). Nothing was sent — without them an update could drop paycode properties. Try again.'); }
}

/* ---------- template / export (same sheets as before) ---------- */
async function template(withData) {
  var res = await Promise.all([loadAttrsQuiet(), loadList().catch(function () { return []; })]);
  var refs = { attrs: res[0] }, recs = res[1], H = headers(refs);
  function rowsOf(list) { return list.map(function (r) { var f = flatten(r, refs); return H.map(function (k) { return X.fmt(f[k]); }); }); }
  var sheets = [{ name: 'Paycodes_Upload', headers: H, rows: withData ? rowsOf(recs) : [], highlightCols: [1, 2], tabColor: '0B5CC7' }];
  if (!withData && recs.length) sheets.push({ name: 'Existing_Ref', tabColor: '7C3AED', headers: H, rows: rowsOf(recs) });
  if (refs.attrs.length) sheets.push({ name: 'Paycode_Attributes', tabColor: '059669', headers: ['sequence', 'name', 'label', 'type', 'required'],
    rows: refs.attrs.map(function (a) { return [a.sequence, a.name, a.label, a.type, a.required ? 'TRUE' : 'FALSE']; }) });
  await X.download('paycodes' + (withData ? '_export_' + U.stamp() : '_template') + '.xlsx', sheets);
}

/* ---------- upload ---------- */
function show(v) { return v == null ? '' : v; }
function propText(p) { return p ? Object.keys(p).sort().map(function (k) { return k + '=' + p[k]; }).join(', ') : ''; }

// Everything the PUT changes compared with the real record (blank flags become FALSE, blank numbers 0, ...).
function realChanges(cur, p, already) {
  var out = [];
  function add(field, from, to) { if (!already[field]) out.push({ field: field, from: from, to: to }); }
  ['code', 'description'].concat(BOOLS, NUMS).forEach(function (k) { if (!E.same(show(cur[k]), p[k])) add(k, cur[k], p[k]); });
  ['futureDays', 'pastDays'].forEach(function (k) { if (!E.same(show(cur[k]), show(p[k]))) add(k, cur[k], p[k] == null ? '(not sent)' : p[k]); });
  var cl = (cur.linkedPaycode || {}).id, pl = (p.linkedPaycode || {}).id;
  if (!E.same(show(cl), show(pl))) add(LINK_COL, cl, pl == null ? '(not sent)' : pl);
  var cp = cur.properties || {}, pp = p.properties || {};
  Object.keys(cp).concat(Object.keys(pp)).filter(function (k, i, a) { return a.indexOf(k) === i; }).forEach(function (k) {
    if (X.str(cp[k]) !== X.str(pp[k])) add(k, cp[k], pp[k] == null ? '(removed)' : pp[k]);
  });
  return out;
}

async function parse(file) {
  var res = await Promise.all([loadAttrsStrict(), loadList()]);
  var refs = { attrs: res[0] }, recs = res[1], H = headers(refs);
  var byId = {}; recs.forEach(function (r) { byId[String(r.id)] = r; });
  var fileCols = file.headers.filter(Boolean);
  var colMap = {};
  H.forEach(function (k) { var m = fileCols.filter(function (c) { return norm(c) === norm(k); })[0]; if (m) colMap[k] = m; });
  if (!colMap[ID_COL]) { var idc = fileCols.filter(function (c) { return norm(c) === 'id' || norm(c) === 'idblankcreate'; })[0]; if (idc) colMap[ID_COL] = idc; }
  if (!colMap[LINK_COL]) { var lc = LINK_ALIASES.map(function (a) { return fileCols.filter(function (c) { return norm(c) === a; })[0]; }).filter(Boolean)[0]; if (lc) colMap[LINK_COL] = lc; }
  var used = {}; Object.keys(colMap).forEach(function (k) { used[colMap[k]] = 1; });
  var unknown = fileCols.filter(function (c) { return !used[c]; });

  var items = file.rows.map(function (r) {
    var row = {};
    Object.keys(colMap).forEach(function (k) { row[k] = r[colMap[k]]; });
    var rawId = X.str(row[ID_COL]), id = X.int(rawId);
    var it = { row: r.__row, label: labelOf(row) };
    if (id == null && rawId !== '') { it.kind = 'bad'; it.label = it.label || rawId; it.error = 'Id "' + rawId + '" is not a number. Leave it blank to create.'; return it; }
    try {
      if (id != null) {
        var cur = byId[String(id)];
        if (!cur) { it.kind = 'bad'; it.error = 'No paycode with id ' + id + ' in ' + Api.envLabel(); return it; }
        var before = flatten(cur, refs), merged = Object.assign({}, before);
        Object.keys(colMap).forEach(function (k) { if (k !== ID_COL && X.str(row[k]) !== '') merged[k] = /^clear$/i.test(X.str(row[k])) ? '' : row[k]; });
        if (!it.label) it.label = labelOf(merged) || String(id);
        it.label += ' (id ' + id + ')';
        it.ref = id;
        var asked = H.filter(function (k) { return k !== ID_COL && colMap[k] && X.str(row[k]) !== '' && !(merged[k] === '' ? X.str(before[k]) === '' : E.same(before[k], merged[k])); })
          .map(function (k) { return { field: k, from: before[k], to: merged[k] }; });
        var p = build(merged, refs, cur);
        p.id = id;
        var seen = {}; asked.forEach(function (c) { seen[c.field] = 1; });
        it.changes = asked.concat(realChanges(cur, p, seen));
        if (!it.changes.length) { it.kind = 'same'; return it; }
        if (!p.code) { it.kind = 'bad'; it.error = '“code” is required'; return it; }
        it.kind = 'upd'; it.payload = p;
        it.run = function () { return ctx.EP.call('paycodes.update', { id: id }, { body: p, module: MOD }); };
      } else {
        if (!Object.keys(row).some(function (k) { return X.str(row[k]) !== ''; })) { it.kind = 'skip'; it.note = 'Empty row'; return it; }
        Object.keys(row).forEach(function (k) { if (/^clear$/i.test(X.str(row[k]))) row[k] = ''; });
        var p2 = build(row, refs, null);
        if (!p2.code) { it.kind = 'bad'; it.error = '“code” is required'; return it; }
        it.kind = 'new'; it.payload = p2;
        it.run = function () { return ctx.EP.call('paycodes.create', null, { body: p2, module: MOD }); };
      }
    } catch (e) { it.kind = 'bad'; it.error = e.message; }
    return it;
  });
  if (unknown.length) UI.toast('Ignored column(s) not in the template: ' + unknown.slice(0, 5).join(', ') + (unknown.length > 5 ? '…' : ''));
  var seenIds = {};
  items.forEach(function (it) { if (it.ref != null && E.applicable(it)) { if (seenIds[it.ref]) { it.kind = 'bad'; it.error = 'Same id ' + it.ref + ' appears again on row ' + seenIds[it.ref]; } else seenIds[it.ref] = it.row; } });
  return items;
}

/* ---------- browse ---------- */
function browse(bodyEl) {
  var holder = h('div', h('div.card', h('span.spin'), '  Loading paycodes from ' + Api.envLabel() + '…'));
  bodyEl.appendChild(holder);
  async function draw() {
    var res = await Promise.all([loadAttrsQuiet(), loadList()]);
    var refs = { attrs: res[0] };
    var rows = res[1].map(function (r) { var f = flatten(r, refs); f.id = r.id; return f; });
    var delBtn = UI.btn('Delete selected', { icon: 'trash', kind: 'quiet', sm: true }); delBtn.disabled = true;
    var tbl = UI.table([{ key: 'id', label: 'Id' }, { key: 'code', label: 'Code' }, { key: 'description', label: 'Description' }, { key: 'inactive', label: 'Inactive' },
      { key: 'absence', label: 'Absence' }, { key: 'presentDays', label: 'Present' }, { key: 'payableDays', label: 'Payable' }, { key: LINK_COL, label: 'Linked' }], rows, {
      select: true, rowKey: function (r) { return String(r.id); },
      onSelect: function (s) { delBtn.disabled = !s.size; U.swap(delBtn, U.icon('trash', 16), h('span', s.size ? 'Delete ' + s.size : 'Delete selected')); },
      toolbar: [
        UI.btn('Refresh', { icon: 'retry', sm: true, kind: 'quiet', onClick: draw }),
        UI.btn('Export for editing', { icon: 'download', sm: true, onClick: function () { return template(true); } }),
        delBtn]
    });
    delBtn.onclick = function () {
      var todo = Array.from(tbl.selected).map(function (id) {
        var f = rows.filter(function (r) { return String(r.id) === id; })[0] || {};
        return { kind: 'del', ref: id, label: labelOf(f) + ' (id ' + id + ')', run: function () { return ctx.EP.call('paycodes.remove', { id: id }, { module: MOD }); } };
      });
      E.runDeletes(todo, MOD, 'paycode').then(function (r) { if (r) draw(); });
    };
    U.swap(holder, rows.length ? tbl : UI.empty('No paycodes in ' + Api.envLabel() + ' yet.'));
  }
  draw().catch(function (e) { U.swap(holder, UI.note('bad', 'Could not load paycodes', e.message)); });
}

ctx.defineTool('paycodes', {
  desc: 'Create and update paycodes from Excel, export them for editing, or delete the ones you no longer need.',
  render: function (view) {
    view.appendChild(UI.tabs([
      { id: 'upload', label: 'Create / update', render: function (b) {
        b.appendChild(E.uploadFlow({ module: MOD, template: function () { return template(false); }, parse: parse, itemLabel: 'Paycode',
          blankNote: function () { return 'On update, columns that are missing or left blank keep their current value in ' + Api.envLabel() + ' (properties without a column are kept too). To empty a value, type CLEAR in the cell. Flags the record has no value for are sent as FALSE and day counts as 0 — the review lists them.'; },
          intro: 'Leave the id blank to create a new paycode. Fill the id to update an existing one. Attribute columns (DAY_FLAG, PAYDED_FLG …) go into the paycode’s properties. Tip: use “Export for editing” in Browse to get current data in this format.' }));
      } },
      { id: 'browse', label: 'Browse & export', render: browse }
    ]));
  }
});
