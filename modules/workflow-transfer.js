/* modules/workflow-transfer.js — Workflow Transfer: move employees to a new manager in the approval workflow.
 * workflow-transfer.transfer (POST)   { externalNumber, newManager, replace }
 * workflow-transfer.employees ?externalNumber.equals=   (review only: warns if employee / manager not found; never blocks) */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Workflow Transfer';
var HEAD = ['externalNumber', 'newManager', 'replace (TRUE/FALSE, default FALSE)'];

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
  var r = await ctx.EP.call('workflow-transfer.employees', null, { query: { 'externalNumber.equals': externalNumber }, module: MOD });
  if (!r.ok) throw new Error('Employee lookup failed (HTTP ' + r.status + '): ' + Api.parseError(r.text));
  var l = Api.asList(r.data);
  if (!l.length) throw new Error('No employee with number "' + externalNumber + '"');
  var exact = l.filter(function (e) { return String(e.externalNumber || '').trim() === String(externalNumber).trim(); })[0];
  return (exact || l[0]).id;
}

async function parse(file) {
  function norm(s) { return String(s).trim().toLowerCase().replace(/[^a-z0-9]/g, ''); }
  function col(row, name) { var n = norm(name); var k = Object.keys(row).filter(function (k) { return k !== '__row' && norm(k) === n; })[0]; return k ? String(row[k] == null ? '' : row[k]).trim() : ''; }
  // DELIBERATE CHANGE from the old tool: it looked for "replace" / "replacetruefalsdefaultfalse", which never matched
  // its own template header ("replace (TRUE/FALSE, default FALSE)" normalises to "replacetruefalsedefaultfalse"), so
  // with the template it always sent replace:false. Here any column starting with "replace" is read, so TRUE in the
  // template now really sends replace:true. The review shows "replace: true/false" on every row so this is visible.
  var replCol = file.headers.filter(function (k) { return norm(k).indexOf('replace') === 0; })[0];
  var people = {};
  var rows = file.rows.map(function (row) {
    var ext = col(row, 'externalnumber'), mgr = col(row, 'newmanager');
    var raw = replCol ? String(row[replCol] == null ? '' : row[replCol]).trim() : '';
    if (ext) people[ext] = 1; if (mgr) people[mgr] = 1;
    return { row: row.__row, ext: ext, mgr: mgr, rawRepl: raw, replace: ['true', '1', 'yes'].indexOf(raw.toLowerCase()) >= 0 };
  });
  var list = Object.keys(people);
  var res = await pool(list, 6, function (e) { return employeeId(e).then(function (id) { return { id: id }; }); });
  var found = {}; list.forEach(function (e, i) { found[e] = res[i]; });
  return rows.map(function (r) {
    // "replace: true/false" is part of the label so every review row shows what will be sent.
    var it = { row: r.row, label: (r.ext || '?') + ' → ' + (r.mgr || '?') + ' · replace: ' + (r.replace ? 'true' : 'false'), ext: r.ext, mgr: r.mgr, repl: r.replace ? 'TRUE' : 'FALSE' };
    if (!r.ext || !r.mgr) { it.kind = 'bad'; it.error = 'externalNumber and newManager are required'; return it; }
    // Both are sent by number, so the lookups are only advice (the old tool did none): warn, never block.
    var notes = [];
    if (found[r.ext].err) notes.push('Employee: ' + found[r.ext].err + '.');
    if (found[r.mgr].err) notes.push('New manager: ' + found[r.mgr].err + '.');
    if (notes.length) it.warn = notes.join(' ');
    if (r.ext === r.mgr) notes.push('Employee and new manager are the same.');
    if (r.rawRepl && ['true', '1', 'yes', 'false', '0', 'no'].indexOf(r.rawRepl.toLowerCase()) < 0) notes.push('replace "' + r.rawRepl + '" is read as FALSE.');
    if (notes.length) it.note = (it.warn ? 'Warning: ' : '') + notes.join(' ') + ' Sent as written. replace: ' + (r.replace ? 'true' : 'false') + '.';
    var body = { externalNumber: r.ext, newManager: r.mgr, replace: r.replace };
    it.kind = 'act'; it.op = 'updated'; it.payload = body;
    it.changes = [{ field: 'newManager', from: '', to: r.mgr }, { field: 'replace', from: '', to: r.replace ? 'TRUE (replace manager)' : 'FALSE (add manager)' }];
    it.run = function () { return ctx.EP.call('workflow-transfer.transfer', null, { body: body, module: MOD }); };
    return it;
  });
}

ctx.defineTool('workflow-transfer', {
  desc: 'Move employees to a new manager in the approval workflow, from Excel.',
  render: function (body) {
    body.appendChild(E.uploadFlow({
      module: MOD, itemLabel: 'Employee → manager', verb: 'transfer', parse: parse,
      template: function () { return X.download('workflow_transfer_template.xlsx', [{ name: 'Workflow_Transfer', tabColor: '0369A1', headers: HEAD, rows: [], highlightCols: [0, 1] }]); },
      intro: 'Columns: externalNumber and newManager (required). replace: TRUE replaces the current manager, FALSE or blank adds the new one.',
      reportCols: [
        { label: 'externalNumber', get: function (it) { return it.ext || ''; } },
        { label: 'newManager', get: function (it) { return it.mgr || ''; } },
        { label: 'replace', get: function (it) { return it.repl || ''; } },
        { label: 'warning', get: function (it) { return it.warn || ''; } }
      ]
    }));
  }
});
