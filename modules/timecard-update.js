/* modules/timecard-update.js — Timecard Update: set the attendance paycode for employees on given dates.
 * Endpoints (core/endpoints.js):
 *   timecard-update.paycodes   (Paycodes_Master sheet, paycode names)
 *   timecard-update.timecards  ?startDate=&endDate=&externalNumber=&attributes=…   (employee id + version, and verify)
 *   timecard-update.update     { attendanceDate, entries:[{ index, employee:{id}, attendancePaycode:{…, version} }] }
 * One POST per date with every employee for that date; if it fails, each employee is sent on its own.
 * Every 200/201 is re-checked with a GET before it counts as done (same as the old tool). */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Timecard Update';
var TC_ATTR = 'attendancePunches(organizationLocation|shiftTemplate),schedule(shiftTemplate)';
var HEAD = ['externalNumber', 'attendanceDate', 'paycode_id'];

/* Old tcNormalizeDate, kept as is: slashes are read month-first (M/D/YYYY, M/D/YY) like Excel US. */
function tcNormalizeDate(val) {
  if (!val) return '';
  var s = String(val).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{5}(\.\d+)?$/.test(s)) return X.date(s); // Excel serial (new: the old reader never produced these)
  var long = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (long) return long[3] + '-' + U.pad(long[1]) + '-' + U.pad(long[2]);
  var short = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (short) return (2000 + parseInt(short[3], 10)) + '-' + U.pad(short[1]) + '-' + U.pad(short[2]);
  var d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return s;
}

function pool(list, n, fn) {
  var i = 0, out = new Array(list.length);
  function next() {
    if (i >= list.length) return Promise.resolve();
    var k = i++;
    return Promise.resolve().then(function () { return fn(list[k], k); })
      .then(function (v) { out[k] = v; }, function (e) { out[k] = { ok: false, body: e.message }; }).then(next);
  }
  var w = [];
  for (var j = 0; j < Math.min(n, list.length); j++) w.push(next());
  return Promise.all(w).then(function () { return out; });
}

var debug = false;
function dlog() { if (debug) console.info.apply(console, ['[Timecard Update]'].concat([].slice.call(arguments))); }

function tcQuery(ext, date) { return { startDate: date, endDate: date, externalNumber: ext, attributes: TC_ATTR }; }
function tcUrl(ext, date) { return ctx.EP.path('timecard-update.timecards') + '?startDate=' + date + '&endDate=' + date + '&externalNumber=' + encodeURIComponent(ext) + '&attributes=' + encodeURIComponent(TC_ATTR); }
function pickEntry(data, ext) {
  if (!Array.isArray(data) || !data.length || !(data[0].entries || []).length) return null;
  var en = data[0].entries;
  return en.filter(function (e) { return String((e.employee || {}).externalNumber || '').trim() === String(ext).trim(); })[0] || (en.length === 1 ? en[0] : null);
}

/* GET one employee's timecard for a date -> { ok, empId, version, pcId } */
async function fetchEmployee(ext, date) {
  dlog('GET', tcUrl(ext, date));
  var r = await ctx.EP.call('timecard-update.timecards', null, { query: tcQuery(ext, date), module: MOD });
  if (r.status !== 200) return { ok: false, status: r.status, body: 'HTTP ' + r.status + ': ' + Api.parseError(r.text) };
  if (!Array.isArray(r.data) || !r.data.length || !(r.data[0].entries || []).length) return { ok: false, status: 200, body: 'No timecard entries returned for this employee and date' };
  var e = pickEntry(r.data, ext);
  if (!e) return { ok: false, status: 200, body: 'No matching entry for externalNumber "' + ext + '" in ' + r.data[0].entries.length + ' entries' };
  var ap = e.attendancePaycode || {};
  return { ok: true, empId: e.employee.id, version: ap.version == null ? 0 : ap.version, pcId: (ap.paycode || {}).id, pcCode: (ap.paycode || {}).code };
}

async function verify(m, date) {
  dlog('Verify GET', tcUrl(m.ext, date));
  var r = await ctx.EP.call('timecard-update.timecards', null, { query: tcQuery(m.ext, date), module: MOD });
  if (r.status !== 200) return 'Check after update returned HTTP ' + r.status + ': ' + String(r.text || '').slice(0, 150);
  var e = pickEntry(r.data, m.ext);
  if (!e) return 'Check after update found no timecard entry for "' + m.ext + '"';
  var got = ((e.attendancePaycode || {}).paycode || {}).id;
  if (String(got) === String(m.pcId)) return null;
  return 'Beeforce answered OK but the paycode did not change. Expected paycode ' + m.pcId + ', found ' + got;
}

function entryOf(m, date, index) {
  return { index: index, employee: { id: m.empId }, attendancePaycode: { attendanceDate: date, employee: { id: m.empId }, paycode: { id: m.pcId }, version: m.version } };
}
/* Old tcPostBatch (old timecard-update.js:24-26, :155-176): up to 3 attempts on 429 / 5xx / network error,
 * waiting 2s then 4s. The old tool resent timecard POSTs, so this module keeps doing it (Api.call itself does
 * not retry writes). Only 200/201 count as success. */
var TC_MAX_RETRIES = 3, TC_BACKOFF_MS = 2000;
function tcTransient(r) { return r.status === 429 || (r.status >= 500 && r.status < 600) || (r.status === 0 && /^Network error/.test(r.text || '')); }
async function post(date, entries) {
  var body = { attendanceDate: date, entries: entries };
  var r;
  for (var attempt = 1; attempt <= TC_MAX_RETRIES; attempt++) {
    dlog('POST', ctx.EP.path('timecard-update.update'), 'attempt ' + attempt, JSON.stringify(body));
    r = await ctx.EP.call('timecard-update.update', null, { body: body, module: MOD });
    dlog('POST response', r.status, String(r.text || '').slice(0, 300));
    r.ok = r.status === 200 || r.status === 201;
    if (r.ok || !tcTransient(r)) return r;
    if (attempt < TC_MAX_RETRIES) await U.sleep(TC_BACKOFF_MS * attempt);
  }
  return r;
}

/* Sends one date group. Only members not yet done are sent, so "Retry failed" resends just those. */
async function runGroup(g) {
  var pending = g.members.filter(function (m) { return !m.done; });
  g.tries++;
  // Like the old tool (old :266, :298), read each employee's timecard right before posting, so the version
  // sent is current (the review may be minutes old). An employee whose read fails is not sent.
  var todo = [];
  await pool(pending, 6, async function (m) {
    var f = await fetchEmployee(m.ext, g.date);
    if (f.ok) { m.version = f.version; m.empId = f.empId; todo.push(m); }
    else { m.status = f.status; m.msg = 'Could not read the timecard before sending: ' + f.body; }
  });
  todo.sort(function (a, b) { return pending.indexOf(a) - pending.indexOf(b); });
  if (!todo.length) {
    var msg0 = '0 of ' + g.members.length + ' verified · ' + pending.map(function (m) { return m.ext + ': ' + m.msg; }).join(' · ');
    return { ok: false, status: pending[0] ? pending[0].status : '', msg: msg0, text: msg0 };
  }
  var batch = await post(g.date, todo.map(function (m, i) { return entryOf(m, g.date, i + 1); }));
  var sent = todo;
  if (!batch.ok) {
    g.batchNote = 'Batch failed (HTTP ' + batch.status + ': ' + Api.parseError(batch.text) + '), sent one by one';
    sent = [];
    await pool(todo, 4, async function (m) {
      var r = await post(g.date, [entryOf(m, g.date, 1)]);
      if (r.ok) sent.push(m); else { m.status = r.status; m.msg = Api.parseError(r.text); }
    });
  } else g.batchNote = '';
  await pool(sent, 6, async function (m) {
    var why = await verify(m, g.date);
    if (why) { m.status = 'VERIFY_FAILED'; m.msg = why; } else { m.done = true; m.status = batch.ok ? batch.status : 200; m.msg = 'Verified'; }
  });
  var bad = g.members.filter(function (m) { return !m.done; });
  var msg = (g.members.length - bad.length) + ' of ' + g.members.length + ' verified' +
    (bad.length ? ' · ' + bad.map(function (m) { return m.ext + ': ' + m.msg; }).join(' · ') : '') + (g.batchNote ? ' · ' + g.batchNote : '');
  return { ok: !bad.length, status: batch.ok || bad.length ? batch.status : 200, msg: msg, text: msg };
}

ctx.defineTool('timecard-update', {
  desc: 'Set the attendance paycode for employees on given dates. Every update is checked afterwards.',
  render: function (body) {
    var groups = [], badRows = [];
    var slot = h('div', { style: { marginTop: '14px' } });
    var dbg = UI.check('Debug: print every request to the browser console', false);
    dbg.input.addEventListener('change', function () { debug = dbg.input.checked; });

    async function template() {
      var pcs = await ctx.EP.listQuiet('timecard-update.paycodes', null, { module: MOD });
      await X.download('timecard_update_template.xlsx', [
        { name: 'Timecard_Update', tabColor: '1D4ED8', headers: HEAD, rows: [], highlightCols: [0, 1, 2] },
        { name: 'Paycodes_Master', tabColor: '059669', headers: ['id', 'code', 'description'], rows: pcs.map(function (p) { return [p.id, p.code || '', p.description || '']; }) }
      ]);
    }

    async function parse(file) {
      U.clear(slot);
      var lower = file.headers.map(function (x) { return String(x).trim().toLowerCase(); });
      var miss = HEAD.filter(function (k) { return lower.indexOf(k.toLowerCase()) < 0; });
      if (miss.length) throw new Error('Missing required columns — need: ' + HEAD.join(', ') + ' (missing ' + miss.join(', ') + ')');
      var pcs = await ctx.EP.listQuiet('timecard-update.paycodes', null, { module: MOD });
      var pcById = {}; pcs.forEach(function (p) { pcById[String(p.id)] = p; });
      function pcName(id) { var p = pcById[String(id)]; return p ? p.code + (p.description ? ' (' + p.description + ')' : '') : id == null ? '' : 'id ' + id; }

      var items = [], rows = [], seen = {};
      file.rows.forEach(function (r) {
        var ext = X.str(X.col(r, 'externalNumber')), raw = X.str(X.col(r, 'attendanceDate')), pc = X.str(X.col(r, 'paycode_id'));
        var date = tcNormalizeDate(raw), pcId = X.int(pc);
        var it = { row: r.__row, label: (ext || '?') + ' · ' + (date || raw || '?'), ext: ext, date: date, pcId: pcId };
        if (!ext || !date || pcId === null) { it.kind = 'bad'; it.error = 'Needs externalNumber, attendanceDate and paycode_id (got "' + ext + '", "' + raw + '", "' + pc + '")'; }
        else if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) { it.kind = 'bad'; it.error = 'Could not read the date "' + raw + '"'; }
        else if (pcs.length && !pcById[String(pcId)]) { it.kind = 'bad'; it.error = 'No paycode with id ' + pcId + ' in ' + Api.envLabel(); }
        else if (seen[ext + '|' + date]) { it.kind = 'bad'; it.error = 'Same employee and date already on row ' + seen[ext + '|' + date]; }
        else { seen[ext + '|' + date] = r.__row; rows.push(it); return; }
        items.push(it);
      });
      if (!rows.length && !items.length) throw new Error('No data rows found');

      var got = await pool(rows, 6, function (it) { return fetchEmployee(it.ext, it.date); });
      var byDate = {}, order = [];
      rows.forEach(function (it, i) {
        var f = got[i] || {};
        if (!f.ok) { it.kind = 'bad'; it.error = 'Could not read the timecard: ' + (f.body || 'no response'); it.status = f.status; items.push(it); return; }
        if (String(f.pcId) === String(it.pcId)) { it.kind = 'same'; it.note = 'Already ' + pcName(it.pcId); items.push(it); return; }
        var m = { row: it.row, ext: it.ext, pcId: it.pcId, empId: f.empId, version: f.version, curPc: f.pcId };
        if (!byDate[it.date]) { byDate[it.date] = []; order.push(it.date); }
        byDate[it.date].push(m);
      });
      groups = order.sort().map(function (date) {
        var g = { date: date, members: byDate[date], tries: 0 };
        return {
          kind: 'act', op: 'updated', group: g, // 'act' (not 'upd'): the engine's "blank cells keep current value" hint does not apply here
          row: g.members.map(function (m) { return m.row; }).join(', '),
          label: date + ' · ' + g.members.length + ' employee' + (g.members.length > 1 ? 's' : ''),
          changes: g.members.map(function (m) { return { field: m.ext + ' (id ' + m.empId + ')', from: pcName(m.curPc), to: pcName(m.pcId) }; }),
          run: async function () {
            var before = g.members.filter(function (m) { return m.done; }).length;
            var r = await runGroup(g);
            // The engine counts one 'updated' per successful item; the audit counts employees, like the old tool.
            var k = g.members.filter(function (m) { return m.done; }).length - before - (r.ok ? 1 : 0);
            if (k > 0) ctx.Audit.onDbOp('updated', k);
            return r;
          }
        };
      });
      badRows = items.filter(function (i) { return i.kind === 'bad'; });
      return groups.concat(items.sort(function (a, b) { return a.row - b.row; }));
    }

    function onDone() {
      var ok = [], failed = [];
      groups.forEach(function (it) {
        it.group.members.forEach(function (m) {
          if (m.done) ok.push([m.ext, it.group.date, m.pcId, m.empId, m.version]);
          else if (m.status != null) failed.push([m.ext, it.group.date, m.pcId, Api.state.base + ctx.EP.path('timecard-update.update'), String(m.status), m.msg || '']);
        });
      });
      badRows.forEach(function (b) { failed.push([b.ext, b.date, b.pcId == null ? '' : b.pcId, b.status != null ? Api.state.base + tcUrl(b.ext, b.date) : '', String(b.status || ''), b.error]); });
      U.swap(slot, h('div.card', h('div.row', h('div', h('b', 'Per-employee result'), h('div.muted.small', ok.length + ' verified · ' + failed.length + ' failed or skipped')),
        h('span.spacer'),
        UI.btn('Download per-employee report', { icon: 'download', onClick: function () {
          return X.download('timecard_update_result_' + U.stamp() + '.xlsx', [
            { name: 'Success', tabColor: '059669', headers: ['externalNumber', 'attendanceDate', 'paycode_id', 'employee_id', 'version'], rows: ok },
            { name: 'Failed', tabColor: 'DC2626', headers: ['externalNumber', 'attendanceDate', 'paycode_id', 'url', 'status', 'response_body'], rows: failed }
          ]);
        } }))));
    }

    body.appendChild(E.uploadFlow({
      module: MOD, itemLabel: 'Date / employee', verb: 'date', template: template, parse: parse, onDone: onDone,
      intro: h('div', UI.note('info', null, 'Columns: externalNumber, attendanceDate, paycode_id. Dates can be YYYY-MM-DD, MM/DD/YYYY or M/D/YY. ' +
        'The current paycode of each employee is read first so you can see what changes. All employees of a date go in one request; if that fails they are sent one by one. Each update is checked afterwards.')),
      extraActions: dbg,
      reportCols: [{ label: 'employees', get: function (it) { return it.group ? it.group.members.map(function (m) { return m.ext + '=' + (m.done ? 'OK' : m.msg || 'not sent'); }).join('; ') : (it.ext || ''); } }]
    }));
    body.appendChild(slot);
  }
});
