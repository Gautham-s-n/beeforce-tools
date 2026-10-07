/* modules/ot-approval.js — OT / Post Approval: raise approved overtime requests from Excel.
 * ot-approval.employees ?externalNumber.equals=    (by external number: employee id lookup)
 * ot-approval.add (POST)   { action:"ADD", data:[{ id, attendanceDate, requestDuration, employee:{id} }] }
 * One POST per attendance date with every row of that date; if it fails, that date's rows are sent one by one. */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'OT Approval';

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

/* Api.employeeId through the registry (same request, same errors). */
async function employeeId(externalNumber) {
  var r = await ctx.EP.call('ot-approval.employees', null, { query: { 'externalNumber.equals': externalNumber }, module: MOD });
  if (!r.ok) throw new Error('Employee lookup failed (HTTP ' + r.status + '): ' + Api.parseError(r.text));
  var l = Api.asList(r.data);
  if (!l.length) throw new Error('No employee with number "' + externalNumber + '"');
  var exact = l.filter(function (e) { return String(e.externalNumber || '').trim() === String(externalNumber).trim(); })[0];
  return (exact || l[0]).id;
}

function send(data) {
  return ctx.EP.call('ot-approval.add', null, { body: { action: 'ADD', data: data }, module: MOD }).then(function (r) { r.ok = r.status === 200 || r.status === 201; return r; });
}

/* One date group. Only rows not yet done are sent, so "Retry failed" resends just those. */
async function runGroup(g) {
  var todo = g.members.filter(function (m) { return !m.done; });
  var r = await send(todo.map(function (m, idx) { return { id: idx, attendanceDate: g.date, requestDuration: m.duration, employee: { id: m.empId } }; }));
  var note = '';
  if (r.ok) todo.forEach(function (m) { m.done = true; m.msg = 'OK'; });
  else if (r.status === 0) todo.forEach(function (m) { m.msg = Api.parseError(r.text); m.status = 0; }); // network error: no one-by-one (old behaviour)
  else {
    note = 'Batch failed (HTTP ' + r.status + ': ' + Api.parseError(r.text) + '), sent one by one';
    for (var i = 0; i < todo.length; i++) {
      var m = todo[i];
      var r2 = await send([{ id: 0, attendanceDate: g.date, requestDuration: m.duration, employee: { id: m.empId } }]);
      if (r2.ok) { m.done = true; m.msg = 'OK'; } else { m.status = r2.status; m.msg = Api.parseError(r2.text); }
    }
  }
  var bad = g.members.filter(function (m) { return !m.done; });
  var msg = (g.members.length - bad.length) + ' of ' + g.members.length + ' sent' +
    (bad.length ? ' · ' + bad.map(function (m) { return m.id + ': ' + m.msg; }).join(' · ') : '') + (note ? ' · ' + note : '');
  return { ok: !bad.length, status: r.status, msg: msg, text: msg };
}

ctx.defineTool('ot-approval', {
  desc: 'Raise approved overtime for many employees from Excel, by external number or employee id.',
  render: function (body) {
    var byEmp = false;
    var groups = [], badRows = [];
    var slot = h('div', { style: { marginTop: '14px' } });
    var hint = h('div.muted.small');
    var a = h('button', { type: 'button', 'aria-pressed': 'true' }, 'By external number');
    var b = h('button', { type: 'button', 'aria-pressed': 'false' }, 'By employee ID');
    function setMode(v) {
      byEmp = v;
      a.setAttribute('aria-pressed', v ? 'false' : 'true'); b.setAttribute('aria-pressed', v ? 'true' : 'false');
      hint.textContent = v ? 'Template columns: employeeID · attendanceDate · duration (HH:MM). Employee ids are used as they are.'
        : 'Template columns: externalNumber · attendanceDate · duration (HH:MM). Employee ids are looked up from the external number.';
    }
    a.onclick = function () { setMode(false); flow.reset(); }; b.onclick = function () { setMode(true); flow.reset(); };
    setMode(false);

    async function template() {
      if (byEmp) await X.download('ot_by_employee_id_template.xlsx', [{ name: 'OT_ByEmployeeID', tabColor: '7C3AED', headers: ['employeeID', 'attendanceDate', 'duration'], rows: [], highlightCols: [0, 1, 2] }]);
      else await X.download('ot_by_external_number_template.xlsx', [{ name: 'OT_ByExternalNumber', tabColor: 'D97706', headers: ['externalNumber', 'attendanceDate', 'duration'], rows: [], highlightCols: [0, 1, 2] }]);
    }

    async function parse(file) {
      U.clear(slot);
      var idCol = byEmp ? 'employeeID' : 'externalNumber';
      var lower = file.headers.map(function (x) { return String(x).trim().toLowerCase(); });
      if ([idCol, 'attendanceDate', 'duration'].some(function (k) { return lower.indexOf(k.toLowerCase()) < 0; }))
        throw new Error('Missing columns — need: ' + idCol + ', attendanceDate, duration' + (byEmp ? '' : '. For an employeeID file, switch to “By employee ID”.'));
      var items = [], rows = [], exts = {};
      file.rows.forEach(function (r) {
        // Values are sent as written in the file (trimmed), same as the old tool.
        var id = String(X.col(r, idCol) == null ? '' : X.col(r, idCol)).trim();
        var date = String(X.col(r, 'attendanceDate') == null ? '' : X.col(r, 'attendanceDate')).trim();
        var duration = String(X.col(r, 'duration') == null ? '' : X.col(r, 'duration')).trim();
        var it = { row: r.__row, label: (id || '?') + ' · ' + (date || '?'), id: id, date: date, duration: duration };
        if (!id || !date || !duration) { it.kind = 'bad'; it.error = 'Missing ' + [!id && idCol, !date && 'attendanceDate', !duration && 'duration'].filter(Boolean).join(', '); items.push(it); return; }
        if (byEmp) {
          it.empId = X.int(id);
          if (it.empId === null) { it.kind = 'bad'; it.error = 'Invalid employee ID: "' + id + '"'; items.push(it); return; }
        } else exts[id] = 1;
        rows.push(it);
      });
      if (!byEmp) {
        var list = Object.keys(exts);
        var res = await pool(list, 6, function (e) { return employeeId(e).then(function (v) { return { id: v }; }); });
        var map = {}; list.forEach(function (e, i) { map[e] = res[i]; });
        rows = rows.filter(function (it) {
          var m = map[it.id];
          if (m.err) { it.kind = 'bad'; it.error = 'Lookup failed: ' + m.err; items.push(it); return false; }
          it.empId = m.id; return true;
        });
      }
      var byDate = {};
      rows.forEach(function (it) { (byDate[it.date] = byDate[it.date] || []).push(it); });
      groups = Object.keys(byDate).sort().map(function (date) {
        var g = { date: date, members: byDate[date] };
        var it = {
          kind: 'act', group: g, row: g.members.map(function (m) { return m.row; }).join(', '),
          label: date + ' · ' + g.members.length + ' request' + (g.members.length > 1 ? 's' : ''),
          changes: g.members.map(function (m) { return { field: (byEmp ? 'employee ' : '') + m.id + (byEmp ? '' : ' (id ' + m.empId + ')'), from: '', to: m.duration }; }),
          run: async function () {
            var before = g.members.filter(function (m) { return m.done; }).length;
            var r = await runGroup(g);
            var k = g.members.filter(function (m) { return m.done; }).length - before;
            if (k > 0) ctx.Audit.onDbOp('created', k); // per request, like the old tool ('act' items are not counted by the engine)
            return r;
          }
        };
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) it.note = 'Date is sent as written: "' + date + '". Beeforce normally expects YYYY-MM-DD.';
        return it;
      });
      badRows = items;
      return groups.concat(items.sort(function (x, y) { return x.row - y.row; }));
    }

    function onDone() {
      var ok = [], failed = [];
      groups.forEach(function (it) {
        it.group.members.forEach(function (m) {
          if (m.done) ok.push([m.id, m.date, m.duration, m.empId]);
          else if (m.msg) failed.push([m.id, m.date, m.duration, m.msg, String(m.status == null ? '' : m.status), '']);
        });
      });
      badRows.forEach(function (x) { failed.push([x.id, x.date, x.duration, x.error, '', '']); });
      U.swap(slot, h('div.card', h('div.row', h('div', h('b', 'Per-request result'), h('div.muted.small', ok.length + ' sent · ' + failed.length + ' failed or skipped')),
        h('span.spacer'),
        UI.btn('Download per-request report', { icon: 'download', onClick: function () {
          return X.download('ot_approval_result_' + U.stamp() + '.xlsx', [
            { name: 'Success', tabColor: '059669', headers: ['externalNumber', 'attendanceDate', 'duration', 'employee_id'], rows: ok },
            { name: 'Failed', tabColor: 'DC2626', headers: ['externalNumber', 'attendanceDate', 'duration', 'error', 'status', 'response_body'], rows: failed }
          ]);
        } }))));
    }

    var flow = E.uploadFlow({
      module: MOD, itemLabel: 'Date / employees', verb: 'date', template: template, parse: parse, onDone: onDone,
      intro: h('div', h('div.field', h('span', 'Upload type'), h('div.seg', { style: { margin: '0 0 6px', maxWidth: '480px' } }, a, b), hint),
        UI.note('info', null, 'All rows of one attendance date go in one request. If it fails, the rows of that date are sent one by one so one bad row does not block the rest.')),
      reportCols: [{ label: 'requests', get: function (it) { return it.group ? it.group.members.map(function (m) { return m.id + '=' + (m.done ? 'OK' : m.msg || 'not sent'); }).join('; ') : (it.id || ''); } }]
    });
    body.appendChild(flow);
    body.appendChild(slot);
  }
});
