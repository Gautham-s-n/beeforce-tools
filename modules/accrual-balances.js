/* modules/accrual-balances.js — Accrual Balances report (read-only).
 * Endpoints (core/endpoints.js):
 * accrual-balances.employees  ?page={n}&size=500 — all employees, paged (Run for all + Employees_Master)
 * accrual-balances.accruals   Accruals_Master
 * accrual-balances.balances   ?employeeId.equals={id}&effectiveDate={yyyy-mm-dd} — per employee, 10 at a time */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api;
var MOD = 'Accrual Balances';

var REPORT_HEADERS = ['employeeId', 'accrualId', 'balance', 'expired', 'totalBalance', 'granted', 'asOnDate', 'reserved', 'openingBalance', 'carryForward', 'availed'];

// yyyy-mm-dd -> dd-mm-yyyy (as old report)
function fmtDate(d) {
  if (!d) return '';
  var p = String(d).split('-');
  return p.length === 3 && p[0].length === 4 ? p[2] + '-' + p[1] + '-' + p[0] : d;
}
function flatBalance(b) {
  function z(v) { return v === null || v === undefined ? 0 : v; }
  return [b.employeeId || '', b.accrualId || '', z(b.balance), z(b.expired), z(b.totalBalance), z(b.granted), fmtDate(b.asOnDate || ''), z(b.reserved), z(b.openingBalance), z(b.carryForward), z(b.availed)];
}
function today() { var d = new Date(); return d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate()); }

// Old acgrFetchEmployees: page through 500 at a time; a failed page ends the list (partial list kept).
async function fetchEmployees(onCount) {
  var all = [];
  for (var page = 0; ; page++) {
    var r = await ctx.EP.call('accrual-balances.employees', null, { query: { page: page, size: 500 }, module: MOD });
    if (!r.ok) break;
    var list = Api.asList(r.data);
    if (!list.length) break;
    all = all.concat(list);
    onCount && onCount(all.length);
    if (list.length < 500) break;
  }
  return all;
}
function fetchAccruals() { return ctx.EP.listQuiet('accrual-balances.accruals', null, { module: MOD }); }
function empRows(emps) { return emps.map(function (e) { return [e.id || '', e.externalNumber || '', e.name || e.fullName || '']; }); }
function accRows(accs) { return accs.map(function (a) { return [a.id || '', a.name || '', a.description || '']; }); }

async function template() {
  var res = await Promise.all([fetchEmployees(), fetchAccruals()]);
  await X.download('accrual_balances_template.xlsx', [
    { name: 'Employee_IDs_Upload', tabColor: '1D4ED8', headers: ['employeeId'], rows: [], highlightCols: [0] },
    { name: 'Employees_Master', tabColor: '059669', headers: ['id', 'externalNumber', 'name'], rows: empRows(res[0]) },
    { name: 'Accruals_Master', tabColor: '7C3AED', headers: ['id', 'name', 'description'], rows: accRows(res[1]) }
  ]);
}

ctx.defineTool('accrual-balances', {
  desc: 'Get accrual balances on a date for the employees in your file, or for everyone, as an Excel report.',
  render: function (body) {
    var date = UI.input({ type: 'date' });
    var mode = 'file', ids = [];
    var out = h('div');
    var runBtn = UI.btn('Get balances', { kind: 'primary', icon: 'play' });
    var fileInfo = h('div');
    var dz = UI.drop({
      title: 'Drop the file with an employeeId column', hint: 'One employee id (Beeforce internal id) per row · .xlsx, .xls or .csv',
      onFile: async function (f) {
        var file = await X.read(f);
        ids = [];
        file.rows.forEach(function (r) {
          // Old: employeeId column, else id column.
          var v = X.str(X.col(r, 'employeeId')) || X.str(X.col(r, 'id'));
          var n = parseInt(parseFloat(v), 10);
          if (!isNaN(n)) ids.push(n);
        });
        if (!ids.length) throw new Error('No valid employee ids found in ' + f.name + '. Put them in an “employeeId” column.');
        U.swap(fileInfo, UI.note('ok', null, ids.length + ' employee id(s) found.'));
        sync();
      },
      onClear: function () { ids = []; U.clear(fileInfo); sync(); }
    });
    var fileBox = h('div', dz, fileInfo);
    function sync() {
      fileBox.hidden = mode !== 'file';
      runBtn.disabled = mode === 'file' && !ids.length;
    }
    var modeSel = UI.tabs([
      { id: 'file', label: 'Employees in my file', render: function () { mode = 'file'; } },
      { id: 'all', label: 'All employees', render: function () { mode = 'all'; } }
    ]);
    // tabs only call render on first open; track the active one on click too.
    modeSel.querySelectorAll('.tab').forEach(function (b) { b.addEventListener('click', function () { mode = b.dataset.id; sync(); U.clear(out); }); });

    runBtn.onclick = function () { UI.busy(runBtn, run); };

    async function run() {
      var d = date.value || today();
      U.clear(out);
      var panel = UI.runPanel('Getting balances on ' + fmtDate(d) + ' from ' + Api.envLabel());
      out.appendChild(panel);
      var emps = null, empIds;
      if (mode === 'all') {
        panel.log('Loading all employees…');
        emps = await fetchEmployees(function (n) { panel.set(0, 0, 'Employees loaded: ' + n); });
        empIds = emps.map(function (e) { return e.id; }).filter(Boolean);
        panel.log(empIds.length + ' employee(s) found.');
      } else empIds = ids.slice();
      if (!empIds.length) { panel.finish('No employees to check.'); return; }

      var balances = [], failed = 0, done = 0;
      for (var i = 0; i < empIds.length; i += 10) {
        while (panel.ctrl.paused && !panel.ctrl.stopped) await U.sleep(200);
        if (panel.ctrl.stopped) { panel.log('Stopped. ' + (empIds.length - i) + ' employee(s) not checked.', 'w'); break; }
        var batch = empIds.slice(i, i + 10);
        var got = await Promise.all(batch.map(function (id) {
          return ctx.EP.call('accrual-balances.balances', null, { query: { 'employeeId.equals': id, effectiveDate: d }, module: MOD })
            .then(function (r) { return { id: id, r: r }; });
        }));
        got.forEach(function (g) {
          if (!g.r.ok) { failed++; panel.log('Employee ' + g.id + ' — HTTP ' + g.r.status + ': ' + Api.parseError(g.r.text), 'e'); return; }
          var raw = g.r.data;
          var list = Array.isArray(raw) ? raw : (raw && (raw.data || raw.balances)) || [];
          list.forEach(function (b) { balances.push(b); });
        });
        done += batch.length;
        panel.set(done, empIds.length, balances.length + ' balance record(s)' + (failed ? ' · ' + failed + ' failed' : ''));
      }
      panel.finish(done + ' employee(s) checked · ' + balances.length + ' balance record(s)' + (failed ? ' · ' + failed + ' failed' : ''));
      if (!balances.length) { out.appendChild(UI.note('info', 'No balances', 'No balance records came back for these employees on ' + fmtDate(d) + '.')); return; }

      // Old report: balances + Employees_Master (all employees) + Accruals_Master.
      var refs = await Promise.all([emps ? Promise.resolve(emps) : fetchEmployees(), fetchAccruals()]);
      var rows = balances.map(flatBalance);
      var fname = 'accrual_balances_' + fmtDate(d).replace(/-/g, '') + '.xlsx';
      var sheets = [
        { name: 'Accrual_Balances', tabColor: '1D4ED8', headers: REPORT_HEADERS, rows: rows },
        { name: 'Employees_Master', tabColor: '059669', headers: ['id', 'externalNumber', 'name'], rows: empRows(refs[0]) },
        { name: 'Accruals_Master', tabColor: '7C3AED', headers: ['id', 'name', 'description'], rows: accRows(refs[1]) }
      ];
      await X.download(fname, sheets);
      var empName = {}; refs[0].forEach(function (e) { empName[String(e.id)] = (e.externalNumber ? e.externalNumber + ' · ' : '') + (e.name || e.fullName || ''); });
      var accName = {}; refs[1].forEach(function (a) { accName[String(a.id)] = a.name; });
      var trows = balances.map(function (b, i) {
        var f = rows[i], o = { __i: i };
        REPORT_HEADERS.forEach(function (k, j) { o[k] = f[j]; });
        o.employee = empName[String(b.employeeId)] || b.employeeId;
        o.accrual = accName[String(b.accrualId)] || b.accrualId;
        return o;
      });
      U.append(out, [
        UI.note('ok', 'Report downloaded', fname + ' — ' + rows.length + ' balance record(s) for ' + done + ' employee(s) on ' + fmtDate(d) + '.'),
        UI.table([{ key: 'employee', label: 'Employee' }, { key: 'accrual', label: 'Accrual' }, { key: 'balance', label: 'Balance' }, { key: 'granted', label: 'Granted' },
          { key: 'availed', label: 'Availed' }, { key: 'reserved', label: 'Reserved' }, { key: 'expired', label: 'Expired' }, { key: 'carryForward', label: 'Carry forward' },
          { key: 'openingBalance', label: 'Opening' }, { key: 'totalBalance', label: 'Total' }, { key: 'asOnDate', label: 'As on' }], trows,
          { rowKey: function (r) { return String(r.__i); }, toolbar: [UI.btn('Download again', { icon: 'download', sm: true, onClick: function () { return X.download(fname, sheets); } })] })
      ]);
    }

    U.append(body, [
      h('div.card',
        h('div.row', { style: { alignItems: 'flex-end', marginBottom: '12px' } },
          UI.field('Effective date', date, 'Leave blank to use today'),
          h('span', { style: { flex: 1 } }),
          UI.btn('Download template', { icon: 'template', kind: 'quiet', onClick: template })),
        modeSel, fileBox,
        h('div.acts', { style: { marginTop: '14px' } }, runBtn)),
      out
    ]);
    sync();
  }
});
