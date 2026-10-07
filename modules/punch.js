/* modules/punch.js — Punch: add one punch, or many from Excel, with or without direction.
 * punch.add (POST)
 *   without direction → { action:"ADD_NO_TYPE", punch:{ employee:{externalNumber}, punchTime } }
 *   with direction    → { action:"ADD", punch:{ employee:{externalNumber}, punchTime, punchType:"IN"|"OUT" } }
 * punch.employees ?externalNumber.equals=   (bulk review only: warns if the employee is not found; never blocks) */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Punch';
var FMT = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

/* Api.employeeId through the registry (same request, same errors). */
async function employeeId(externalNumber) {
  var r = await ctx.EP.call('punch.employees', null, { query: { 'externalNumber.equals': externalNumber }, module: MOD });
  if (!r.ok) throw new Error('Employee lookup failed (HTTP ' + r.status + '): ' + Api.parseError(r.text));
  var l = Api.asList(r.data);
  if (!l.length) throw new Error('No employee with number "' + externalNumber + '"');
  var exact = l.filter(function (e) { return String(e.externalNumber || '').trim() === String(externalNumber).trim(); })[0];
  return (exact || l[0]).id;
}

function buildBody(externalNumber, punchTime, withDir, punchType) {
  var body = { action: withDir ? 'ADD' : 'ADD_NO_TYPE', punch: { employee: { externalNumber: externalNumber }, punchTime: punchTime } };
  if (withDir && punchType) body.punch.punchType = punchType;
  return body;
}

var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function z(n) { return ('0' + n).slice(-2); }
function ampm(hh, tag) { if (!tag) return hh; var pm = /pm/i.test(tag); if (pm && hh < 12) hh += 12; if (!pm && hh === 12) hh = 0; return hh; }
/* Old punNormalizeDateTime: whatever Excel turned the datetime into -> "YYYY-MM-DD HH:MM:SS". */
function normalizeDateTime(val) {
  if (!val) return '';
  var s = String(val).trim();
  if (FMT.test(s)) return s;
  // Excel serial date-time (new: the old reader never produced these)
  if (/^\d{5}(\.\d+)?$/.test(s)) { var d0 = new Date(Math.round((parseFloat(s) - 25569) * 86400) * 1000); return d0.toISOString().slice(0, 19).replace('T', ' '); }
  var isoT = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (isoT) return isoT[1] + '-' + z(isoT[2]) + '-' + z(isoT[3]) + ' ' + z(isoT[4]) + ':' + isoT[5] + ':' + (isoT[6] || '00');
  var us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/);
  if (us) return us[3] + '-' + z(us[1]) + '-' + z(us[2]) + ' ' + z(ampm(parseInt(us[4], 10), us[7])) + ':' + us[5] + ':' + (us[6] || '00');
  var mm = s.match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{2,4})[ ,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM|am|pm)?/);
  if (mm) {
    var mon = MONTHS[mm[2].slice(0, 3).toLowerCase()];
    if (mon) return (mm[3].length === 2 ? '20' + mm[3] : mm[3]) + '-' + z(mon) + '-' + z(mm[1]) + ' ' + z(ampm(parseInt(mm[4], 10), mm[7])) + ':' + mm[5] + ':' + (mm[6] || '00');
  }
  var d = new Date(s.replace(' ', 'T'));
  if (!isNaN(d.getTime())) return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()) + ' ' + z(d.getHours()) + ':' + z(d.getMinutes()) + ':' + z(d.getSeconds());
  return s;
}

function pool(list, n, fn) {
  var i = 0, out = new Array(list.length);
  function next() {
    if (i >= list.length) return Promise.resolve();
    var k = i++;
    return Promise.resolve().then(function () { return fn(list[k], k); }).then(function (v) { out[k] = v; }, function (e) { out[k] = { err: e.message }; }).then(next);
  }
  var w = []; for (var j = 0; j < Math.min(n, list.length); j++) w.push(next());
  return Promise.all(w).then(function () { return out; });
}

/* Two-button switch: Without / With direction. */
function dirSwitch(labels, onChange) {
  var withDir = false;
  var a = h('button', { type: 'button', 'aria-pressed': 'true' }, labels[0]);
  var b = h('button', { type: 'button', 'aria-pressed': 'false' }, labels[1]);
  function set(v) { withDir = v; a.setAttribute('aria-pressed', v ? 'false' : 'true'); b.setAttribute('aria-pressed', v ? 'true' : 'false'); onChange && onChange(v); }
  a.onclick = function () { set(false); }; b.onclick = function () { set(true); };
  var el = h('div.seg', { style: { margin: '0 0 14px', maxWidth: '520px' } }, a, b);
  el.get = function () { return withDir; };
  return el;
}

function single(el) {
  var ext = UI.input({ placeholder: 'K1004062' });
  var time = UI.input({ placeholder: '2026-07-14 06:50:00' });
  var type = UI.select(['IN', 'OUT'], 'IN');
  var typeField = UI.field('Punch type', type);
  typeField.style.display = 'none'; // .field sets display, so the hidden attribute alone would not hide it
  var sw = dirSwitch(['Without direction (ADD_NO_TYPE)', 'With direction (ADD)'], function (v) { typeField.style.display = v ? '' : 'none'; });
  var out = h('div');
  var go = UI.btn('Submit punch', { kind: 'primary', icon: 'check', onClick: async function () {
    var e = ext.value.trim(), t = time.value.trim(), withDir = sw.get(), pt = withDir ? type.value : '';
    if (!e || !t) { U.swap(out, UI.note('bad', null, 'External number and punch time are required.')); return; }
    // Single entry sends the time exactly as typed (same as the old tool).
    var body = buildBody(e, t, withDir, pt);
    var kv = { 'External number': e, 'Punch time': t, Action: body.action };
    if (withDir) kv['Punch type'] = pt;
    var warn = FMT.test(t) ? null : UI.note('warn', null, 'The time is not in YYYY-MM-DD HH:MM:SS. It will be sent as typed.');
    if (!(await UI.confirm({ title: 'Add this punch?', body: h('div', UI.kv(kv), warn), verb: 'Submit punch' }))) return;
    ctx.Audit.newTransaction();
    var r = await ctx.EP.call('punch.add', null, { body: body, module: MOD });
    if (r.ok) {
      ctx.Audit.onDbOp('created', 1);
      U.swap(out, UI.note('ok', 'Punch added', e + ' · ' + t + (withDir ? ' · ' + pt : '')));
      UI.toast('Punch added');
    } else U.swap(out, UI.note('bad', 'Not added (HTTP ' + r.status + ')', Api.parseError(r.text)));
  } });
  el.appendChild(h('div.card', { style: { maxWidth: '640px' } },
    h('div.field', h('span', 'Punch direction'), sw),
    h('div.grid2', UI.field('External number', ext), typeField),
    UI.field('Punch time', time, 'YYYY-MM-DD HH:MM:SS'),
    h('div.acts', go), out));
}

function bulk(el) {
  var sw = dirSwitch(['Without direction', 'With direction']);
  async function template() {
    if (sw.get()) {
      await X.download('punch_with_direction_template.xlsx', [{ name: 'Punch_With_Direction', tabColor: '1D4ED8',
        headers: ['externalNumber', 'punchTime (YYYY-MM-DD HH:MM:SS)', 'punchType (IN/OUT)'], rows: [], highlightCols: [0, 1, 2] }]);
    } else {
      await X.download('punch_no_direction_template.xlsx', [{ name: 'Punch_No_Direction', tabColor: '059669',
        headers: ['externalNumber', 'punchTime (YYYY-MM-DD HH:MM:SS)'], rows: [], highlightCols: [0, 1] }]);
    }
  }
  async function parse(file) {
    function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
    function col(row, name) { var n = norm(name); var k = Object.keys(row).filter(function (k) { return k !== '__row' && norm(k) === n; })[0]; return k ? String(row[k] == null ? '' : row[k]).trim() : ''; }
    // Direction comes from the file's columns, not from the switch (same as the old tool).
    var hasDir = file.headers.some(function (k) { k = String(k).toLowerCase(); return k.indexOf('punchtype') >= 0 || k.indexOf('direction') >= 0; });
    var exts = {};
    var rows = file.rows.map(function (row) {
      var ext = col(row, 'externalNumber');
      var raw = col(row, 'punchTime') || col(row, 'punchtimeyyyymmddhhmmss');
      var time = normalizeDateTime(raw);
      var rawDir = (col(row, 'direction') || '').toUpperCase();
      var rawType = (col(row, 'punchType') || col(row, 'punchtypeinout') || '').toUpperCase();
      var withDir = hasDir && (rawDir === 'ADD' || rawType === 'IN' || rawType === 'OUT' || rawDir === 'WITH');
      var pt = withDir ? (rawType || 'IN') : '';
      if (ext) exts[ext] = 1;
      return { row: row.__row, ext: ext, raw: raw, time: time, withDir: withDir, pt: pt };
    });
    var list = Object.keys(exts);
    var res = await pool(list, 6, function (e) { return employeeId(e).then(function (id) { return { id: id }; }); });
    var emp = {}; list.forEach(function (e, i) { emp[e] = res[i]; });
    return rows.map(function (r) {
      var it = { row: r.row, label: (r.ext || '?') + ' · ' + (r.time || '?'), ext: r.ext, time: r.time, dir: r.withDir ? 'ADD' : 'ADD_NO_TYPE', pt: r.pt };
      if (!r.ext || !r.time) { it.kind = 'bad'; it.error = 'Missing externalNumber or punchTime'; return it; }
      if (!FMT.test(r.time)) { it.kind = 'bad'; it.error = 'Could not read the punch time "' + r.raw + '"'; return it; }
      var body = buildBody(r.ext, r.time, r.withDir, r.pt);
      it.kind = 'act'; it.op = 'created'; it.payload = body;
      it.changes = [{ field: 'punchTime', from: r.raw !== r.time ? r.raw : '', to: r.time }, { field: 'action', from: '', to: body.action }];
      if (r.withDir) it.changes.push({ field: 'punchType', from: '', to: r.pt });
      // The punch is sent by externalNumber, so the employee check is only advice: the old tool did no lookup and
      // sent the row anyway. A failed or empty lookup is shown as a warning; the row stays sendable.
      if (emp[r.ext] && emp[r.ext].err) {
        it.warn = emp[r.ext].err;
        it.note = 'Warning: ' + it.warn + '. Sent anyway (Beeforce decides). ' + body.action + ' · ' + r.time + (r.withDir ? ' · ' + r.pt : '');
      }
      it.run = function () { return ctx.EP.call('punch.add', null, { body: body, module: MOD }); };
      return it;
    });
  }
  el.appendChild(E.uploadFlow({
    module: MOD, itemLabel: 'Punch', verb: 'punch record', template: template, parse: parse,
    intro: h('div',
      UI.note('info', null, 'Without direction: externalNumber, punchTime. With direction: also punchType (IN/OUT). Any common date-time format works; it is converted to YYYY-MM-DD HH:MM:SS. Rows with a punchType column are sent with direction.'),
      h('div.field', { style: { marginTop: '14px' } }, h('span', 'Template type'), sw)),
    reportCols: [
      { label: 'externalNumber', get: function (it) { return it.ext || ''; } },
      { label: 'punchTime', get: function (it) { return it.time || ''; } },
      { label: 'direction', get: function (it) { return it.dir || ''; } },
      { label: 'punchType', get: function (it) { return it.pt || ''; } },
      { label: 'warning', get: function (it) { return it.warn || ''; } }
    ]
  }));
}

ctx.defineTool('punch', {
  desc: 'Add one punch, or upload many from Excel, with or without IN/OUT direction.',
  render: function (body) {
    body.appendChild(UI.tabs([
      { id: 'single', label: 'Single entry', render: single },
      { id: 'bulk', label: 'Bulk upload', render: bulk }
    ]));
  }
});
