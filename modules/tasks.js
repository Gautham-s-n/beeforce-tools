/* modules/tasks.js — Tasks: see your pending workflow tasks, download them by type, approve in bulk.
 * tasks.list    (GET, ?active.equals=true&onlyList=true from the registry)
 * tasks.approve (POST {id})   { id, action:"complete", taskFormData:{ approved:true } } */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Tasks';

var TAB_COLORS = { Task_IDs: '1D4ED8', Timeoff: '059669', Regularization: 'D97706', default: '7C3AED' };
var DESC_HEADERS = {
  timeoff: ['Name', 'Employee Number', 'Start Date', 'End Date', 'Paycode', 'Paycode Description', 'Leave Days'],
  regularization: ['Name', 'Employee Number', 'Start Date', 'End Date', 'Reason', 'In Time', 'Out Time', 'Day Type', 'Field 9', 'Field 10'],
  default: ['Name', 'Employee Number', 'Field 3', 'Field 4', 'Field 5', 'Field 6', 'Field 7', 'Field 8', 'Field 9', 'Field 10']
};
function typeKey(pd) { if (!pd) return 'unknown'; return String(pd).split(':')[0].toLowerCase().replace(/_/g, ' '); }
function typeName(pd) { var k = typeKey(pd); return k.charAt(0).toUpperCase() + k.slice(1); }
function safeSheet(n) { return n.replace(/[:\\/?*[\]]/g, '').substring(0, 31); }
function parseDesc(d) { return d ? String(d).split('|').map(function (s) { return s.trim(); }) : []; }
function taskRow(t) {
  var dh = DESC_HEADERS[typeKey(t.processDefinitionId || '')] || DESC_HEADERS.default;
  var dv = parseDesc(t.description);
  var row = [t.id || '', t.name || '', t.priority || '', t.processDefinitionId || '', t.processInstanceId || '', t.createTime || '', t.formKey || ''];
  dh.forEach(function (_, i) { row.push(dv[i] || ''); });
  return row;
}
function typeHeaders(k) { return ['id', 'name', 'priority', 'processDefinitionId', 'processInstanceId', 'createTime', 'formKey'].concat(DESC_HEADERS[k] || DESC_HEADERS.default); }

async function loadTasks() {
  var r = await ctx.EP.call('tasks.list', null, { module: MOD });
  if (!r.ok) throw new Error('Could not load tasks (HTTP ' + r.status + '): ' + Api.parseError(r.text));
  return Api.asList(r.data);
}

/* Same workbook as the old "Download Tasks": Task_IDs + one sheet per task type. */
async function downloadTasks(tasks) {
  tasks = tasks || await loadTasks();
  if (!tasks.length) { UI.toast('No pending tasks found.'); return; }
  var grouped = {}, order = [];
  tasks.forEach(function (t) { var n = typeName(t.processDefinitionId || 'unknown'); if (!grouped[n]) { grouped[n] = []; order.push(n); } grouped[n].push(t); });
  var sheets = [{ name: 'Task_IDs', tabColor: TAB_COLORS.Task_IDs, headers: ['id', 'task_name', 'type'], rows: tasks.map(function (t) { return [t.id, t.name || '', typeName(t.processDefinitionId || '')]; }) }];
  order.forEach(function (n) {
    var list = grouped[n];
    sheets.push({ name: safeSheet(n), tabColor: TAB_COLORS[n] || TAB_COLORS.default, headers: typeHeaders(typeKey(list[0].processDefinitionId || '')), rows: list.map(taskRow) });
  });
  await X.download('pending_tasks_' + new Date().toISOString().slice(0, 10) + '.xlsx', sheets);
}

function approveItem(id, label) {
  var payload = { id: id, action: 'complete', taskFormData: { approved: true } }; // id stays a string, as in the old tool
  return { kind: 'act', op: 'updated', label: label, ref: id, payload: payload,
    run: function () { return ctx.EP.call('tasks.approve', { id: id }, { body: payload, module: MOD }); } };
}
function labelOf(t) { var d = parseDesc(t.description); return t.id + ' · ' + typeName(t.processDefinitionId) + (t.name ? ' · ' + t.name : '') + (d[0] ? ' · ' + d[0] : '') + (d[1] ? ' (' + d[1] + ')' : ''); }

/* Approve selected rows from the list: confirm, then progress in a dialog. */
async function approveNow(todo) {
  var list = h('div.muted.small', { style: { maxHeight: '140px', overflow: 'auto' } }, todo.slice(0, 40).map(function (t) { return h('div', t.label); }), todo.length > 40 ? h('div', '… and ' + (todo.length - 40) + ' more') : null);
  if (!(await UI.confirm({ title: 'Approve ' + todo.length + ' task' + (todo.length > 1 ? 's' : '') + '?', body: h('div', h('p.muted', 'Each task is completed as approved.'), list), verb: 'Approve ' + todo.length }))) return null;
  ctx.Audit.newTransaction();
  var res;
  await UI.dialog(function (box, close) {
    var panel = UI.runPanel('Approving in ' + Api.envLabel());
    var done = UI.btn('Close', { kind: 'primary' }); done.disabled = true; done.onclick = function () { close(true); };
    U.append(box, [h('h2', 'Approving tasks'), panel, h('div.acts', done)]);
    panel.set(0, todo.length);
    E.runQueue(panel, todo).then(function (r) {
      res = r;
      panel.finish(r.ok.length + ' approved · ' + r.failed.length + ' failed');
      done.disabled = false; done.focus();
      ctx.Shell && ctx.Shell.noteRun(MOD, r.ok.length, r.failed.length);
    });
  });
  return res;
}

function pending(el) {
  var holder = h('div', h('div.card', h('span.spin'), '  Loading your pending tasks from ' + Api.envLabel() + '…'));
  el.appendChild(holder);
  async function draw() {
    var tasks = await loadTasks();
    var rows = tasks.map(function (t) {
      var d = parseDesc(t.description);
      return { id: String(t.id), type: typeName(t.processDefinitionId), name: t.name || '', who: d[0] || '', emp: d[1] || '', created: t.createTime || '', __t: t };
    });
    var go = UI.btn('Approve selected', { icon: 'check', sm: true, kind: 'primary' }); go.disabled = true;
    var tbl = UI.table([{ key: 'id', label: 'Id' }, { key: 'type', label: 'Type' }, { key: 'name', label: 'Task' }, { key: 'who', label: 'Name' }, { key: 'emp', label: 'Employee no.' }, { key: 'created', label: 'Created' }], rows, {
      select: true, rowKey: function (r) { return r.id; },
      onSelect: function (s) { go.disabled = !s.size; U.swap(go, U.icon('check', 16), h('span', s.size ? 'Approve ' + s.size : 'Approve selected')); },
      toolbar: [
        UI.btn('Refresh', { icon: 'retry', sm: true, kind: 'quiet', onClick: draw }),
        UI.btn('Download Excel', { icon: 'download', sm: true, onClick: function () { return downloadTasks(tasks); } }),
        go
      ]
    });
    go.onclick = function () {
      var todo = rows.filter(function (r) { return tbl.selected.has(r.id); }).map(function (r) { return approveItem(r.id, labelOf(r.__t)); });
      approveNow(todo).then(function (r) { if (r) draw().catch(function (e) { UI.toast(e.message, 'bad'); }); });
    };
    var types = {}; rows.forEach(function (r) { types[r.type] = (types[r.type] || 0) + 1; });
    U.swap(holder, rows.length ? h('div', UI.counts(Object.keys(types).map(function (k) { return { n: types[k], label: k }; })), tbl) : UI.empty('No pending tasks in ' + Api.envLabel() + '.'));
  }
  draw().catch(function (e) { U.swap(holder, UI.note('bad', 'Could not load tasks', e.message)); });
}

async function parse(file) {
  var idCol = file.headers.filter(function (k) { return String(k).trim().toLowerCase() === 'id'; })[0];
  if (!idCol) throw new Error('No "id" column found in ' + (file.fileName || 'the file') + '. Use the Task_IDs sheet from the downloaded Excel.');
  var tasks = await loadTasks().catch(function () { return null; });
  var byId = {}; (tasks || []).forEach(function (t) { byId[String(t.id)] = t; });
  var seen = {};
  return file.rows.map(function (r) {
    var id = X.str(r[idCol]); // old cleanTaskId: "12.0" -> "12"
    if (!id) return { kind: 'skip', row: r.__row, label: '(blank)', note: 'No task id' };
    if (seen[id]) return { kind: 'skip', row: r.__row, label: id, note: 'Same id already on row ' + seen[id] };
    seen[id] = r.__row;
    var t = byId[id];
    var it = approveItem(id, t ? labelOf(t) : id);
    it.row = r.__row;
    it.changes = [{ field: 'action', from: 'pending', to: 'complete (approved)' }];
    if (tasks && !t) it.note = 'Not in your pending list right now. It will still be sent and may fail.';
    return it;
  }).filter(function (it) { return it.kind !== 'skip' || it.label !== '(blank)'; });
}

ctx.defineTool('tasks', {
  desc: 'See your pending workflow tasks, download them by type, and approve many at once.',
  render: function (body) {
    body.appendChild(UI.tabs([
      { id: 'pending', label: 'Pending tasks', render: pending },
      { id: 'approve', label: 'Approve from file', render: function (el) {
        el.appendChild(E.uploadFlow({
          module: MOD, itemLabel: 'Task', verb: 'approval', sheet: 'Task_IDs', parse: parse,
          template: function () { return downloadTasks(); },
          intro: 'Upload a file with an id column (the Task_IDs sheet of the downloaded tasks). Only the id is used. Each task is completed as approved. “Download template” downloads your current pending tasks.'
        }));
      } }
    ]));
  }
});
