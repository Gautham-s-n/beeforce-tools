/* modules/timeoff-raise.js — Timeoff Raise: submit time-off requests on behalf of employees.
 * Endpoints (core/endpoints.js):
 * timeoff-raise.raise      { action:"SUBMIT", employeeNumber, paycode (the CODE, e.g. "WFH"), startDate, endDate (DD-MM-YYYY), remarks }
 *   (the old file's comments say chatbot/… without "attendance", but its code calls attendance/chatbot/… — kept as the code had it)
 * timeoff-raise.paycodes   (Paycodes_Master sheet, paycode warning, form list)
 * timeoff-raise.employees  ?page=&size=500 (Employees_Master sheet)
 *                          ?externalNumber.equals= (review: warns if the employee is not found; never blocks) */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Timeoff Raise';
var HEAD = ['Employee Number', 'Paycode', 'Start date', 'End date', 'remarks'];

var MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
function z(n) { return ('0' + n).slice(-2); }
/* Old torNormalizeDate: whatever Excel turned the date into -> DD-MM-YYYY. Slashes are read month-first (Excel US). */
function normDate(val) {
  if (!val) return '';
  var s = String(val).trim();
  if (/^\d{2}-\d{2}-\d{4}$/.test(s)) return s;
  if (/^\d{5}(\.\d+)?$/.test(s)) { var x = X.date(s); return x.slice(8, 10) + '-' + x.slice(5, 7) + '-' + x.slice(0, 4); } // Excel serial (new)
  var iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (iso) return z(iso[3]) + '-' + z(iso[2]) + '-' + iso[1];
  var us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) return z(us[2]) + '-' + z(us[1]) + '-' + us[3];
  var dmy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dmy) return z(dmy[1]) + '-' + z(dmy[2]) + '-' + dmy[3];
  var mm = s.match(/^(\d{1,2})-([A-Za-z]{3,})-(\d{2,4})$/);
  if (mm) { var mon = MONTHS[mm[2].slice(0, 3).toLowerCase()]; if (mon) return z(mm[1]) + '-' + z(mon) + '-' + (mm[3].length === 2 ? '20' + mm[3] : mm[3]); }
  var d = new Date(s);
  if (!isNaN(d.getTime())) return z(d.getDate()) + '-' + z(d.getMonth() + 1) + '-' + d.getFullYear();
  return s;
}
function ymd(dmy) { return dmy.slice(6) + dmy.slice(3, 5) + dmy.slice(0, 2); }
var DMY = /^\d{2}-\d{2}-\d{4}$/;

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

function paycodes() { return ctx.EP.listQuiet('timeoff-raise.paycodes', null, { module: MOD }); }

/* Same as Api.employeeId (same request, same errors), but through the endpoint registry. */
async function employeeId(externalNumber) {
  var r = await ctx.EP.call('timeoff-raise.employees', null, { query: { 'externalNumber.equals': externalNumber }, module: MOD });
  if (!r.ok) throw new Error('Employee lookup failed (HTTP ' + r.status + '): ' + Api.parseError(r.text));
  var l = Api.asList(r.data);
  if (!l.length) throw new Error('No employee with number "' + externalNumber + '"');
  var exact = l.filter(function (e) { return String(e.externalNumber || '').trim() === String(externalNumber).trim(); })[0];
  return (exact || l[0]).id;
}

/* Old torFetchAllEmployees: pages of 500 until a short page. Stops quietly on error. */
async function allEmployees() {
  var all = [];
  for (var page = 0; ; page++) {
    var r = await ctx.EP.call('timeoff-raise.employees', null, { query: { page: page, size: 500 }, module: MOD });
    if (!r.ok) break;
    var list = Api.asList(r.data);
    if (!list.length) break;
    all = all.concat(list);
    if (list.length < 500) break;
  }
  return all;
}

function bodyOf(emp, pc, start, end, remarks) {
  return { action: 'SUBMIT', employeeNumber: emp, paycode: pc, startDate: start, endDate: end, remarks: remarks };
}

async function template() {
  var res = await Promise.all([paycodes(), allEmployees().catch(function () { return []; })]);
  await X.download('timeoff_raise_template.xlsx', [
    { name: 'Upload_Template', tabColor: '0EA5E9', headers: HEAD, rows: [], highlightCols: [0, 1, 2, 3, 4] },
    { name: 'Paycodes_Master', tabColor: '059669', headers: ['id', 'paycode name', 'description'], rows: res[0].map(function (p) { return [p.id, p.code || '', p.description || '']; }) },
    { name: 'Employees_Master', tabColor: '7C3AED', headers: ['id', 'external number', 'name'], rows: res[1].map(function (e) { return [e.id, e.externalNumber || '', e.name || e.fullName || '']; }) }
  ]);
}

async function parse(file) {
  function col(row, name) { var v = X.col(row, name); return v == null ? '' : String(v).trim(); }
  var pcs = await paycodes();
  var codes = {}; pcs.forEach(function (p) { if (p.code) codes[String(p.code).toLowerCase()] = p; });
  var emps = {};
  var rows = file.rows.map(function (r) {
    var o = { row: r.__row, emp: col(r, 'Employee Number'), paycode: col(r, 'Paycode'), rs: col(r, 'Start date'), re: col(r, 'End date'), remarks: col(r, 'remarks') };
    o.start = normDate(o.rs); o.end = normDate(o.re);
    if (o.emp) emps[o.emp] = 1;
    return o;
  });
  var list = Object.keys(emps);
  var res = await pool(list, 6, function (e) { return employeeId(e).then(function (id) { return { id: id }; }); });
  var found = {}; list.forEach(function (e, i) { found[e] = res[i]; });
  return rows.map(function (o) {
    var it = { row: o.row, label: (o.emp || '?') + ' · ' + (o.paycode || '?') + ' · ' + (o.start || '?') + ' to ' + (o.end || '?'), o: o };
    if (!o.emp || !o.paycode || !o.start || !o.end) { it.kind = 'bad'; it.error = 'Employee Number, Paycode, Start date and End date are all required'; return it; }
    if (!DMY.test(o.start) || !DMY.test(o.end)) { it.kind = 'bad'; it.error = 'Could not read the date "' + (DMY.test(o.start) ? o.re : o.rs) + '"'; return it; }
    if (ymd(o.start) > ymd(o.end)) { it.kind = 'bad'; it.error = 'Start date is after end date'; return it; }
    var pc = codes[o.paycode.toLowerCase()];
    // Employee number and paycode are sent exactly as typed (same as the old tool), so neither lookup is needed to
    // build the request. The old tool did no lookup: a missing employee or unknown paycode is a warning, not a block.
    var warns = [];
    if (found[o.emp].err) warns.push(found[o.emp].err);
    if (pcs.length && !pc) warns.push('No paycode with code "' + o.paycode + '" in ' + Api.envLabel());
    var body = bodyOf(o.emp, o.paycode, o.start, o.end, o.remarks);
    it.kind = 'act'; it.op = 'created'; it.payload = body;
    it.changes = [{ field: 'paycode', from: '', to: o.paycode + (pc && pc.description ? ' (' + pc.description + ')' : '') }, { field: 'dates', from: '', to: o.start + ' to ' + o.end }];
    if (o.remarks) it.changes.push({ field: 'remarks', from: '', to: o.remarks });
    if (pc && pc.code !== o.paycode) warns.push('Paycode "' + o.paycode + '" is written differently in Beeforce ("' + pc.code + '")');
    if (warns.length) {
      it.warn = warns.join('. ');
      it.note = 'Warning: ' + it.warn + '. Sent as typed. ' + o.paycode + ' · ' + o.start + ' to ' + o.end + '.';
    }
    it.run = function () { return ctx.EP.call('timeoff-raise.raise', null, { body: body, module: MOD }); };
    return it;
  });
}

function single(el) {
  var emp = UI.input({ placeholder: '3475' });
  var pcHolder = h('div', UI.input({ placeholder: 'Loading paycodes…' }));
  var pcCtl = pcHolder.firstChild;
  var start = UI.input({ type: 'date' }), end = UI.input({ type: 'date' });
  var remarks = UI.input({ placeholder: 'Leave' });
  var out = h('div');
  paycodes().then(function (pcs) {
    pcCtl = pcs.length ? UI.select([{ value: '', label: 'Choose a paycode' }].concat(pcs.filter(function (p) { return p.code; }).map(function (p) { return { value: p.code, label: p.code + (p.description ? ' — ' + p.description : '') }; })), '')
      : UI.input({ placeholder: 'Paycode code, e.g. WFH' });
    U.swap(pcHolder, pcCtl);
  });
  start.addEventListener('change', function () { if (!end.value || end.value < start.value) end.value = start.value; });
  function dmy(v) { return v ? v.slice(8, 10) + '-' + v.slice(5, 7) + '-' + v.slice(0, 4) : ''; }
  var go = UI.btn('Submit time off', { kind: 'primary', icon: 'check', onClick: async function () {
    var e = emp.value.trim(), pc = String(pcCtl.value || '').trim(), s = dmy(start.value), en = dmy(end.value), rm = remarks.value.trim();
    if (!e || !pc || !s || !en) { U.swap(out, UI.note('bad', null, 'Employee number, paycode, start date and end date are required.')); return; }
    if (start.value > end.value) { U.swap(out, UI.note('bad', null, 'Start date is after end date.')); return; }
    var body = bodyOf(e, pc, s, en, rm);
    if (!(await UI.confirm({ title: 'Submit this time off?', body: UI.kv({ 'Employee number': e, Paycode: pc, 'Start date': s, 'End date': en, Remarks: rm }), verb: 'Submit' }))) return;
    ctx.Audit.newTransaction();
    var r = await ctx.EP.call('timeoff-raise.raise', null, { body: body, module: MOD });
    if (r.ok) { ctx.Audit.onDbOp('created', 1); U.swap(out, UI.note('ok', 'Time off submitted', e + ' · ' + pc + ' · ' + s + ' to ' + en)); UI.toast('Time off submitted'); }
    else U.swap(out, UI.note('bad', 'Not submitted (HTTP ' + r.status + ')', Api.parseError(r.text)));
  } });
  el.appendChild(h('div.card', { style: { maxWidth: '640px' } },
    h('div.grid2', UI.field('Employee number', emp), UI.field('Paycode', pcHolder)),
    h('div.grid2', UI.field('Start date', start), UI.field('End date', end)),
    UI.field('Remarks', remarks),
    h('div.acts', go), out));
}

ctx.defineTool('timeoff-raise', {
  desc: 'Submit time-off requests on behalf of employees, one at a time or many from Excel.',
  render: function (body) {
    body.appendChild(UI.tabs([
      { id: 'bulk', label: 'Bulk upload', render: function (el) {
        el.appendChild(E.uploadFlow({
          module: MOD, itemLabel: 'Request', verb: 'request', template: template, parse: parse,
          intro: 'Columns: Employee Number, Paycode (the paycode code, e.g. WFH), Start date, End date (DD-MM-YYYY), remarks. One row is one request. Dates in other formats are converted to DD-MM-YYYY.',
          reportCols: ['emp', 'paycode', 'start', 'end', 'remarks'].map(function (k, i) { return { label: HEAD[i], get: function (it) { return it.o ? it.o[k] : ''; } }; })
            .concat([{ label: 'warning', get: function (it) { return it.warn || ''; } }])
        }));
      } },
      { id: 'single', label: 'Single request', render: single }
    ]));
  }
});
