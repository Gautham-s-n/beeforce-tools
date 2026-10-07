/* modules/schedule-patterns.js — Schedule Patterns: weekly rotations of shift templates / scheduled paycodes.
 * Endpoints (core/endpoints.js):
 *   schedule-patterns.list        ?projection=FULL, trailing slash — list, entries expanded
 *   schedule-patterns.create      create  (id blank), trailing slash
 *   schedule-patterns.update {id} update  — trailing slash, as old
 *   schedule-patterns.remove {id} delete  — NO trailing slash, as old
 *   schedule-patterns.templates   reference (Shift_Templates) + day-cell check
 *   schedule-patterns.paycodes    reference (Scheduled_Paycodes, schedule:true only) + day-cell check
 * Payload: { name, description, resetEveryMonth, id?, entries:[{ week, dayOfWeek, shiftTemplate:{id} } | { week, dayOfWeek, paycode:{id} }] }
 * Sheet: one row per week — id | Schedule Pattern Name | Schedule Pattern Description | Reset Every Month | Week | MONDAY..SUNDAY.
 * dayOfWeek is ISO (Mon=1..Sun=7); entries per week are sent in the order 7,1,2,3,4,5,6 (as old). */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Schedule Patterns';

var DAY_COLS = [
  { header: 'MONDAY', day: 1, s: 'Mon' }, { header: 'TUESDAY', day: 2, s: 'Tue' }, { header: 'WEDNESDAY', day: 3, s: 'Wed' },
  { header: 'THURSDAY', day: 4, s: 'Thu' }, { header: 'FRIDAY', day: 5, s: 'Fri' }, { header: 'SATURDAY', day: 6, s: 'Sat' }, { header: 'SUNDAY', day: 7, s: 'Sun' }
];
var DAY_ORDER = [7, 1, 2, 3, 4, 5, 6];
var HEAD = ['id', 'Schedule Pattern Name', 'Schedule Pattern Description', 'Reset Every Month', 'Week'].concat(DAY_COLS.map(function (d) { return d.header; }));
var INPUT_COLS = [1, 4, 5, 6, 7, 8, 9, 10, 11];

/* ---------- old helpers, same behaviour ---------- */
function col(row, name) {
  var k = Object.keys(row).filter(function (k) { return k.trim().toLowerCase() === name.toLowerCase(); })[0];
  return k ? String(row[k] == null ? '' : row[k]).trim() : '';
}
// TRUE/FALSE cell -> bool; blank = false; unrecognised -> null (reported).
function parseBoolCell(v) {
  var s = String(v == null ? '' : v).trim().toLowerCase();
  if (s === '') return false;
  if (['true', '1', 'yes', 'y'].indexOf(s) >= 0) return true;
  if (['false', '0', 'no', 'n'].indexOf(s) >= 0) return false;
  return null;
}
function tb(b) { return b ? 'TRUE' : 'FALSE'; }
function byId(a, b) { return (Number(a.id) || 0) - (Number(b.id) || 0); }
function has(x) { return x !== undefined && x !== null; }
function dayOf(day) { return DAY_COLS.filter(function (d) { return d.day === day; })[0]; }
function pInt(x) { var n = parseInt(parseFloat(x), 10); return isNaN(n) ? null : n; }

// "241", "241.0", "241 - Name", "S241", "P408", "P-408" -> { kind:'S'|'P'|null, id }; blank -> {empty}; else {invalid}.
function parseDayCell(raw) {
  var s = String(raw == null ? '' : raw).trim();
  if (!s) return { empty: true };
  var m = s.match(/^([SsPp])?\s*[-:#]?\s*(\d+)(?![\dA-Za-z])/);
  if (!m) return { invalid: true };
  return { kind: m[1] ? m[1].toUpperCase() : null, id: parseInt(m[2], 10) };
}
function resolveDayCell(parsed, refs) {
  var id = parsed.id, inShift = !!refs.shiftIds[id], inPay = !!refs.scheduledPayIds[id];
  function notScheduled() { return { error: refs.allPayIds[id] ? 'paycode ' + id + ' exists but is not a scheduled paycode' : 'paycode ' + id + ' not found' }; }
  if (parsed.kind === 'S') return inShift ? { key: 'shiftTemplate', id: id } : { error: 'shift template ' + id + ' not found' };
  if (parsed.kind === 'P') return inPay ? { key: 'paycode', id: id } : notScheduled();
  if (inShift && inPay) return { error: id + ' matches both a shift template and a scheduled paycode — write S' + id + ' (shift) or P' + id + ' (paycode)' };
  if (inShift) return { key: 'shiftTemplate', id: id };
  if (inPay) return { key: 'paycode', id: id };
  if (refs.allPayIds[id]) return notScheduled();
  return { error: id + ' is not a known shift template or scheduled paycode' };
}
function buildRefs(shifts, pays) {
  var r = { shifts: shifts, pays: pays, shiftIds: {}, scheduledPayIds: {}, allPayIds: {}, shiftName: {}, payCode: {} };
  shifts.forEach(function (s) { r.shiftIds[s.id] = true; r.shiftName[s.id] = s.name || ''; });
  pays.forEach(function (p) { r.allPayIds[p.id] = true; r.payCode[p.id] = p.code || ''; if (p.schedule === true) r.scheduledPayIds[p.id] = true; });
  return r;
}

/* A group of rows (one per week) -> one payload + errors + warnings (old buildGroupPayload).
 * cur = current pattern on update: blank name / description / reset keep its value. */
function buildGroupPayload(patternId, rows, refs, cur) {
  var errors = [], warnings = [];
  var first = rows[0];
  var name = col(first, 'Schedule Pattern Name') || (cur ? cur.name || '' : '');
  if (!name) errors.push('Schedule Pattern Name is required');
  var firstDesc = col(first, 'Schedule Pattern Description');
  var firstResetRaw = col(first, 'Reset Every Month');
  var reset = cur && firstResetRaw === '' ? X.bool(cur.resetEveryMonth) === true : parseBoolCell(firstResetRaw);
  if (reset === null) errors.push('Reset Every Month must be TRUE or FALSE (got "' + firstResetRaw + '")');
  var desc = firstDesc || (cur ? cur.description || '' : '') || name;
  // Key order as the old PUT example: name, description, resetEveryMonth, id, entries.
  var payload = { name: name, description: desc, resetEveryMonth: reset === true };
  if (patternId !== null) payload.id = patternId;
  payload.entries = [];

  var blocks = [], seenWeeks = {};
  rows.forEach(function (row, idx) {
    var weekRaw = col(row, 'Week'), week = pInt(weekRaw);
    if (week === null || week < 1) { errors.push('row ' + row.__row + ' has an invalid Week ("' + weekRaw + '") — must be 1 or higher'); return; }
    var where = 'Week ' + week;
    if (seenWeeks[week]) { errors.push(where + ' is listed more than once'); return; }
    seenWeeks[week] = true;
    if (idx > 0) {
      var n2 = col(row, 'Schedule Pattern Name'), d2 = col(row, 'Schedule Pattern Description'), r2 = col(row, 'Reset Every Month');
      if (n2 && n2 !== name) warnings.push(where + ' has a different name ("' + n2 + '") — the first row’s name is used');
      if (d2 && firstDesc && d2 !== firstDesc) warnings.push(where + ' has a different description — the first row’s is used');
      if (r2 && firstResetRaw && parseBoolCell(r2) !== parseBoolCell(firstResetRaw)) warnings.push(where + ' has a different Reset Every Month — the first row’s value is used');
    }
    var entries = [];
    DAY_ORDER.forEach(function (day) {
      var label = dayOf(day).header, raw = col(row, label), parsed = parseDayCell(raw);
      if (parsed.empty) return;
      if (parsed.invalid) { errors.push(where + ' ' + label + ': "' + raw + '" is not a shift template / paycode ID'); return; }
      var res = resolveDayCell(parsed, refs);
      if (res.error) { errors.push(where + ' ' + label + ': ' + res.error); return; }
      var e = { week: week, dayOfWeek: day }; e[res.key] = { id: res.id };
      entries.push(e);
    });
    if (entries.length && entries.length < 7) warnings.push(where + ' has only ' + entries.length + ' of 7 days filled');
    blocks.push({ week: week, entries: entries });
  });
  blocks.sort(function (a, b) { return a.week - b.week; });
  blocks.forEach(function (b) { payload.entries = payload.entries.concat(b.entries); });
  if (!errors.length && !payload.entries.length) errors.push('no schedule entries — every day cell is blank');
  return { payload: payload, errors: errors, warnings: warnings, weeks: blocks.length };
}

/* ---------- existing patterns -> sheet rows ---------- */
// "id - name" text as the old existing sheet. When the id is both a shift template and a scheduled paycode,
// it is written as S<id> / P<id> so the exported file uploads back without the "matches both" error.
function describeEntry(e, refs) {
  var st = e.shiftTemplate, pc = e.paycode;
  if (st && has(st.id)) {
    var sn = refs.shiftName[st.id] || st.name || '';
    var sp = refs.scheduledPayIds[st.id] ? 'S' : '';
    return sn ? sp + st.id + ' - ' + sn : sp + st.id;
  }
  if (pc && has(pc.id)) {
    var code = refs.payCode[pc.id] || pc.code || '';
    var pp = refs.shiftIds[pc.id] ? 'P' : '';
    return code ? pp + pc.id + ' - ' + code : pp + pc.id;
  }
  return '';
}
function existingRows(patterns, refs) {
  var rows = [];
  patterns.slice().sort(byId).forEach(function (p) {
    var byWeek = {};
    (p.entries || []).forEach(function (e) { var w = has(e.week) ? e.week : 1; (byWeek[w] = byWeek[w] || {})[e.dayOfWeek] = describeEntry(e, refs); });
    var weeks = Object.keys(byWeek).map(Number).sort(function (a, b) { return a - b; });
    var base = [p.id, p.name || '', p.description || '', tb(p.resetEveryMonth)];
    if (!weeks.length) { rows.push(base.concat(['', '', '', '', '', '', '', ''])); return; }
    weeks.forEach(function (w) { rows.push(base.concat([w].concat(DAY_COLS.map(function (c) { return byWeek[w][c.day] || ''; })))); });
  });
  return rows;
}
// Entries the sheet layout cannot show (dayOfWeek outside 1-7 or no shift/paycode).
function countUnshown(patterns) {
  var n = 0;
  patterns.forEach(function (p) { (p.entries || []).forEach(function (e) {
    var d = Number(e.dayOfWeek), ref = (e.shiftTemplate && has(e.shiftTemplate.id)) || (e.paycode && has(e.paycode.id));
    if (!(d >= 1 && d <= 7) || !ref) n++;
  }); });
  return n;
}
function unshownNote(n) { return n ? ' ' + n + ' existing entr' + (n === 1 ? 'y has' : 'ies have') + ' a day outside 1–7 or no shift/paycode and ' + (n === 1 ? 'is' : 'are') + ' not shown.' : ''; }
// Filled examples from this tenant's own ids (create rows only).
function sampleRows(shifts, scheduled) {
  if (!shifts.length || !scheduled.length) return [];
  var wo = scheduled.filter(function (p) { return String(p.code || '').toUpperCase() === 'WO'; })[0] || scheduled[0];
  var s1 = shifts[0], s2 = shifts[1] || shifts[0];
  function wk(name, reset, w, sid) { return ['', name, name, reset, w, sid, sid, sid, sid, sid, sid, wo.id]; }
  return [wk('SAMPLE - Single week, Sunday off', 'FALSE', 1, s1.id), wk('SAMPLE - Two-week rotation', 'TRUE', 1, s1.id), wk('SAMPLE - Two-week rotation', 'TRUE', 2, s2.id)];
}
// Week-by-week text for the review ("Mon 40 · Tue 40 · … · Sun P1113").
function weekText(entries) {
  var by = {};
  entries.forEach(function (e) {
    var w = has(e.week) ? e.week : 1;
    var v = e.shiftTemplate && has(e.shiftTemplate.id) ? 'S' + e.shiftTemplate.id : e.paycode && has(e.paycode.id) ? 'P' + e.paycode.id : '?';
    (by[w] = by[w] || {})[e.dayOfWeek] = v;
  });
  var out = {};
  Object.keys(by).forEach(function (w) { out[w] = DAY_COLS.map(function (d) { return by[w][d.day] ? d.s + ' ' + by[w][d.day] : null; }).filter(Boolean).join(' · ') || '(empty)'; });
  return out;
}

/* ---------- API ---------- */
function fetchPatterns() { return ctx.EP.list('schedule-patterns.list', null, { module: MOD }); }
async function fetchRefs(lenient) {
  function get(key) { return lenient ? ctx.EP.listQuiet(key, null, { module: MOD }) : ctx.EP.list(key, null, { module: MOD }); }
  var r = await Promise.all([get('schedule-patterns.templates'), get('schedule-patterns.paycodes')]);
  return buildRefs(r[0], r[1]);
}

async function template() {
  var res = await Promise.all([fetchPatterns(), fetchRefs(false)]);
  var patterns = res[0], refs = res[1];
  var shifts = refs.shifts.slice().sort(byId);
  var scheduled = refs.pays.filter(function (p) { return p.schedule === true; }).sort(byId);
  var sheets = [
    { name: 'Upload_Template', tabColor: '1D4ED8', headers: HEAD, rows: [], highlightCols: INPUT_COLS },
    { name: 'Shift_Templates', tabColor: '059669', headers: ['id', 'name', 'description'], rows: shifts.map(function (s) { return [s.id, s.name || '', s.description || '']; }) },
    { name: 'Scheduled_Paycodes', tabColor: 'EA580C', headers: ['id', 'code'], rows: scheduled.map(function (p) { return [p.id, p.code || '']; }) },
    { name: 'Existing_Schedule_Patterns', tabColor: '7C3AED', headers: HEAD, rows: existingRows(patterns, refs) }
  ];
  var samples = sampleRows(shifts, scheduled);
  if (samples.length) sheets.push({ name: 'Sample_Records', tabColor: 'CA8A04', headers: HEAD, rows: samples });
  await X.download('schedule_patterns_template.xlsx', sheets);
  UI.toast('Template downloaded — ' + shifts.length + ' shift template(s), ' + scheduled.length + ' scheduled paycode(s), ' + patterns.length + ' existing pattern(s).' + unshownNote(countUnshown(patterns)));
}
// Old "View Existing" (sheet Schedule_Patterns). Same columns as the upload sheet, so it uploads back.
async function exportAll() {
  var missing = false;
  var res = await Promise.all([fetchPatterns(), ctx.EP.listQuiet('schedule-patterns.templates', null, { module: MOD }).then(function (l) { if (!l.length) missing = true; return l; }), ctx.EP.listQuiet('schedule-patterns.paycodes', null, { module: MOD })]);
  if (!res[0].length) { UI.toast('No schedule patterns to download.'); return; }
  var refs = buildRefs(res[1], res[2]);
  await X.download('schp_existing_' + new Date().toISOString().slice(0, 10) + '.xlsx', [{ name: 'Schedule_Patterns', tabColor: '7C3AED', headers: HEAD, rows: existingRows(res[0], refs), highlightCols: INPUT_COLS }]);
  UI.toast('Downloaded ' + res[0].length + ' pattern(s)' + (missing ? ' (shift names unavailable — ids only)' : '') + '.' + unshownNote(countUnshown(res[0])));
}

async function parse(file) {
  var res = await Promise.all([fetchPatterns(), fetchRefs(false)]);
  var curById = {}; res[0].forEach(function (p) { curById[String(p.id)] = p; });
  var refs = res[1];
  var items = [], upd = {}, crt = {}, order = [];
  // id filled -> update group by id; blank -> create group by name; neither -> ignored.
  file.rows.forEach(function (r) {
    var id = pInt(col(r, 'id'));
    if (id !== null) { if (!upd[id]) { upd[id] = []; order.push('u' + id); } upd[id].push(r); return; }
    var name = col(r, 'Schedule Pattern Name');
    if (!name) { items.push({ kind: 'skip', row: r.__row, label: 'Row ' + r.__row, note: 'No id and no Schedule Pattern Name — ignored' }); return; }
    if (!crt[name]) { crt[name] = []; order.push('c' + name); } crt[name].push(r);
  });
  if (file.headers.some(function (k) { return k.trim().toLowerCase() === 'sun'; })) UI.toast('This file still has the old “SUN” column — it is ignored. Sunday is read from SUNDAY.');

  // Old order: updates first, then creates.
  var groups = order.filter(function (k) { return k[0] === 'u'; }).concat(order.filter(function (k) { return k[0] === 'c'; }));
  groups.forEach(function (k) {
    var isUpd = k[0] === 'u', key = k.slice(1);
    var rows = isUpd ? upd[key] : crt[key];
    var id = isUpd ? parseInt(key, 10) : null;
    var cur = isUpd ? curById[String(id)] : null;
    var it = { row: rows.map(function (r) { return r.__row; }).join(', '), ref: id };
    items.push(it);
    if (isUpd && !cur) { it.kind = 'bad'; it.label = (col(rows[0], 'Schedule Pattern Name') || 'Pattern') + ' (id ' + id + ')'; it.error = 'No schedule pattern with id ' + id + ' in ' + Api.envLabel(); return; }
    var b = buildGroupPayload(id, rows, refs, cur);
    var p = b.payload;
    it.label = (p.name || key) + (isUpd ? ' (id ' + id + ')' : '') + (b.warnings.length ? ' — ' + b.warnings.join('; ') : '');
    it.weeks = b.weeks; it.entries = p.entries.length;
    if (b.errors.length) { it.kind = 'bad'; it.error = b.errors.join('; '); return; }
    it.payload = p;
    if (isUpd) {
      var ch = [];
      if ((cur.name || '') !== p.name) ch.push({ field: 'Name', from: cur.name, to: p.name });
      if ((cur.description || '') !== p.description) ch.push({ field: 'Description', from: cur.description, to: p.description });
      // Diff against the real value: a server value like 1 or null is not the same as the boolean that is sent.
      if (cur.resetEveryMonth !== p.resetEveryMonth) ch.push({ field: 'Reset Every Month', from: cur.resetEveryMonth == null ? '' : String(cur.resetEveryMonth), to: tb(p.resetEveryMonth) });
      var a = weekText(cur.entries || []), z = weekText(p.entries);
      Object.keys(a).concat(Object.keys(z)).filter(function (w, i, l) { return l.indexOf(w) === i; }).sort(function (x, y) { return x - y; })
        .forEach(function (w) { if (a[w] !== z[w]) ch.push({ field: 'Week ' + w, from: a[w] || '', to: z[w] || '(removed)' }); });
      // Entries the sheet cannot show (day outside 1–7, no shift / paycode) are not in the PUT, so they go.
      var lost = countUnshown([cur]);
      if (lost) ch.push({ field: 'Other entries', from: lost + ' entr' + (lost === 1 ? 'y' : 'ies') + ' not shown in the sheet', to: '(removed)' });
      if (!ch.length) { it.kind = 'same'; return; }
      it.kind = 'upd'; it.changes = ch;
      it.run = function () { return ctx.EP.call('schedule-patterns.update', { id: id }, { body: p, module: MOD }); };
    } else {
      it.kind = 'new';
      var z2 = weekText(p.entries);
      it.changes = Object.keys(z2).sort(function (x, y) { return x - y; }).map(function (w) { return { field: 'Week ' + w, from: '', to: z2[w] }; });
      it.run = function () { return ctx.EP.call('schedule-patterns.create', null, { body: p, module: MOD }); };
    }
  });
  return items;
}

function browse(bodyEl) {
  var holder = h('div', h('div.card', h('span.spin'), '  Loading schedule patterns from ' + Api.envLabel() + '…'));
  bodyEl.appendChild(holder);
  async function draw() {
    var list = await fetchPatterns();
    var rows = list.slice().sort(byId).map(function (p) {
      var weeks = {}; (p.entries || []).forEach(function (e) { weeks[has(e.week) ? e.week : 1] = 1; });
      return { id: p.id, name: p.name, description: p.description, reset: tb(p.resetEveryMonth === true), weeks: Object.keys(weeks).length, entries: (p.entries || []).length };
    });
    var delBtn = UI.btn('Delete selected', { icon: 'trash', kind: 'quiet', sm: true }); delBtn.disabled = true;
    var tbl = UI.table([{ key: 'id', label: 'Id' }, { key: 'name', label: 'Name' }, { key: 'description', label: 'Description' }, { key: 'reset', label: 'Reset every month' }, { key: 'weeks', label: 'Weeks' }, { key: 'entries', label: 'Entries' }], rows, {
      select: true,
      onSelect: function (s) { delBtn.disabled = !s.size; U.swap(delBtn, U.icon('trash', 16), h('span', s.size ? 'Delete ' + s.size : 'Delete selected')); },
      toolbar: [UI.btn('Refresh', { icon: 'retry', sm: true, kind: 'quiet', onClick: draw }), UI.btn('Export for editing', { icon: 'download', sm: true, onClick: exportAll }), delBtn]
    });
    delBtn.onclick = function () {
      var todo = Array.from(tbl.selected).map(function (id) {
        var r = rows.filter(function (x) { return String(x.id) === id; })[0] || {};
        return { kind: 'del', ref: id, label: (r.name || '') + ' (id ' + id + ')', run: function () { return ctx.EP.call('schedule-patterns.remove', { id: id }, { module: MOD }); } };
      });
      E.runDeletes(todo, MOD, 'schedule pattern').then(function (r) { if (r) draw(); });
    };
    U.swap(holder, rows.length ? tbl : UI.empty('No schedule patterns in ' + Api.envLabel() + ' yet.'));
  }
  draw().catch(function (e) { U.swap(holder, UI.note('bad', 'Could not load schedule patterns', e.message)); });
}

ctx.defineTool('schedule-patterns', {
  desc: 'Create and update schedule patterns (weekly rotations of shifts and week-offs) from Excel, export them for editing, or delete them.',
  render: function (view) {
    var intro = UI.note('info', null, 'One row per week. Leave id blank to create a pattern, fill it to update one — rows with the same id (or, for new patterns, the same name) become one pattern with several weeks. ' +
      'Days run MONDAY to SUNDAY. A day cell takes a shift template id (Shift_Templates sheet) or a scheduled paycode id (Scheduled_Paycodes sheet); if an id is in both lists write S241 (shift) or P408 (paycode). ' +
      'A blank day cell means no entry that day, also on update. Filled examples are in the Sample_Records sheet of the template.');
    view.appendChild(UI.tabs([
      { id: 'upload', label: 'Create / update', render: function (b) {
        b.appendChild(E.uploadFlow({ module: MOD, template: template, parse: parse, itemLabel: 'Pattern', verb: 'pattern change', blankNote: 'On update a blank name, description or Reset Every Month keeps the current value. The pattern\'s entries are replaced by the uploaded weeks: a blank day cell means no entry that day, and a week that is not in the file is removed.', intro: intro,
          reportCols: [{ label: 'weeks', get: function (it) { return it.weeks == null ? '' : it.weeks; } }, { label: 'entries', get: function (it) { return it.entries == null ? '' : it.entries; } }] }));
      } },
      { id: 'browse', label: 'Browse & export', render: browse }
    ]));
  }
});
