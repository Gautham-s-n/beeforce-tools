/* modules/playbooks.js — Playbooks (v3.13): one workbook, one sheet per tool, run left to right.
 *
 * Each sheet is named after a tool (as in the tool list: "Paycodes", "Accrual", "Combinations" …) and uses that tool's
 * own upload format. APIary checks every sheet against Beeforce first, then applies the sheets in order and stops at
 * the first sheet that has errors or failed rows. Nothing new is sent to Beeforce: every step is the tool's own
 * review + apply (same requests as using the tool by hand), and every step is recorded in the run journal with its
 * undo data.
 *
 * Cross-sheet check: an error in a later sheet that names a value from an earlier sheet (e.g. a paycode code that
 * the Paycodes sheet creates) is shown as "waits for step N" instead of an error, and is checked again after that
 * step has run. */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Playbooks';

function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }
function toolForSheet(name) {
  var n = norm(name), T = ctx.TOOLS || {};
  var ids = Object.keys(T).filter(function (id) { return id !== 'playbooks' && id !== 'admin-settings' && id !== 'api-automation' && id !== 'health'; });
  return ids.filter(function (id) { return norm(T[id].name) === n || norm(id) === n; })[0] || null;
}
/* The tool's upload flow settings, by rendering it once off screen (no Beeforce writes; some tools read reference
 * lists when they open). */
async function flowOf(id) {
  var def = await ctx.loadTool(id);
  var box = h('div'), got;
  E.capture(function () { def.render(box, { id: id, name: ctx.TOOLS[id].name }); }, function (list) { got = list; });
  if (!got || !got.length) throw new Error(ctx.TOOLS[id].name + ' has no file upload that a playbook can use.');
  return got[0].cfg;
}
function sheetValues(rd) {
  var vals = {};
  rd.rows.forEach(function (r) { rd.headers.slice(0, 4).forEach(function (k) { var v = X.str(r[k]); if (v.length >= 2 && !/^\d+(\.0+)?$/.test(v)) vals[v.toLowerCase()] = 1; }); });
  return vals;
}

ctx.defineTool('playbooks', {
  desc: 'Run several tools from one workbook — one sheet per tool, in order — and stop at the first problem.',
  render: function (view) {
    var body = h('div');
    view.appendChild(body);
    var wb = null, steps = [];

    function intro() {
      U.swap(body,
        UI.note('info', 'One workbook, one sheet per tool', 'Name each sheet after a tool (for example “Paycodes”, “Accrual”, “Combinations”) and fill it in that tool’s own upload format. ' +
          'Sheets run from left to right. Everything is checked against ' + Api.envLabel() + ' first; then each sheet is applied with the tool’s own review and stops at the first problem.'),
        h('div.row', { style: { marginBottom: '14px' } }, UI.btn('Download playbook template', { icon: 'template', onClick: templatePicker })),
        UI.drop({ title: 'Drop your playbook workbook here', accept: '.xlsx,.xls', onFile: load }));
    }

    async function templatePicker() {
      var T = ctx.TOOLS || {};
      var ids = Object.keys(T).filter(function (id) { return toolForSheet(T[id].name) === id; });
      var chosen = await UI.dialog(function (box, close) {
        var checks = ids.map(function (id) { var c = UI.check(T[id].name, ['paycodes', 'accrual', 'paycode-combinations'].indexOf(id) >= 0); c.dataset.id = id; return c; });
        U.append(box, [h('h2', 'Playbook template'), h('p.muted', 'Pick the tools, in the order they should run. Each becomes a sheet with that tool’s upload headers.'),
          h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px 16px', maxHeight: '50vh', overflow: 'auto' } }, checks),
          h('div.acts', h('button.btn.quiet', { type: 'button', onclick: function () { close(null); } }, 'Cancel'),
            h('button.btn.primary', { type: 'button', onclick: function () { close(checks.filter(function (c) { return c.input.checked; }).map(function (c) { return c.dataset.id; })); } }, 'Download'))]);
      });
      if (!chosen || !chosen.length) return;
      var sheets = [];
      for (var i = 0; i < chosen.length; i++) {
        try {
          var cfg = await flowOf(chosen[i]);
          var got = await E.captureSheets(cfg.template);
          var sh = got && got[0];
          if (sh) sheets.push({ name: ctx.TOOLS[chosen[i]].name.slice(0, 31), headers: sh.headers, rows: [], highlightCols: sh.highlightCols, tabColor: '0B5CC7' });
        } catch (e) { UI.toast(ctx.TOOLS[chosen[i]].name + ': ' + e.message, 'warn'); }
      }
      if (sheets.length) await X.download('playbook_template_' + U.stamp() + '.xlsx', sheets.concat([{ name: 'How_to', headers: ['Step'], rows: [
        ['Fill each sheet in the order you want them to run (left to right). Delete sheets you do not need.'],
        ['Sheet names must stay the tool names. Columns are the same as each tool’s own template.'],
        ['Upload the workbook in Automation → Playbooks. You see every sheet checked before anything is sent.']] }]));
    }

    async function load(f) {
      var hash = null;
      try { hash = await E.fileHash(f); } catch (x) {}
      var rd = await X.read(f);
      wb = { name: f.name, hash: hash, rd: rd };
      steps = [];
      var skipped = [];
      rd.sheetNames.forEach(function (n) {
        if (/^how_?to$/i.test(n)) return;
        var id = toolForSheet(n);
        var s = rd.sheet(n);
        if (!id) { if (s.rows.length) skipped.push(n); return; }
        if (!s.rows.length) return;
        steps.push({ n: steps.length + 1, sheet: n, id: id, name: ctx.TOOLS[id].name, rd: s, state: 'waiting', items: [], counts: '' });
      });
      if (!steps.length) throw new Error('No sheet in ' + f.name + ' is named after a tool (or they are all empty).');
      if (skipped.length) UI.toast('Sheets not named after a tool were skipped: ' + skipped.join(', '), 'warn');
      await check();
    }

    function kindsOf(items) {
      var c = {}; items.forEach(function (it) { c[it.kind] = (c[it.kind] || 0) + 1; });
      var parts = [];
      if (c.new) parts.push(c.new + ' new'); if (c.upd) parts.push(c.upd + ' update' + (c.upd > 1 ? 's' : '')); if (c.act) parts.push(c.act + ' to send');
      if (c.del) parts.push(c.del + ' delete' + (c.del > 1 ? 's' : '')); if (c.same) parts.push(c.same + ' no change'); if (c.skip) parts.push(c.skip + ' skipped');
      if (c.wait) parts.push(c.wait + ' waiting'); if (c.bad) parts.push(c.bad + ' error' + (c.bad > 1 ? 's' : ''));
      return parts.join(' · ');
    }

    async function check() {
      U.swap(body, UI.skeleton('Checking ' + steps.length + ' sheet(s) against ' + Api.envLabel() + '…'));
      var earlier = [];
      for (var i = 0; i < steps.length; i++) {
        var s = steps[i];
        if (s.state === 'done') { earlier.push({ n: s.n, vals: sheetValues(s.rd) }); continue; }
        try {
          s.cfg = s.cfg || await flowOf(s.id);
          s.items = await s.cfg.parse(s.rd);
          // cross-sheet: an error that names a value from an earlier (not yet run) sheet waits for that step
          s.items.forEach(function (it) {
            if (it.kind !== 'bad' || !it.error) return;
            var low = it.error.toLowerCase();
            var by = earlier.filter(function (e) { return Object.keys(e.vals).some(function (v) { return low.indexOf(v) >= 0; }); })[0];
            if (by) { it.kind = 'wait'; it.waitFor = by.n; }
          });
          s.state = s.items.some(function (it) { return it.kind === 'bad'; }) ? 'errors' : 'ready';
          s.counts = kindsOf(s.items);
        } catch (e) { s.state = 'errors'; s.counts = e.message; s.items = []; }
        earlier.push({ n: s.n, vals: sheetValues(s.rd) });
      }
      plan();
    }

    var LBL = { waiting: 'Not checked', ready: 'Ready', errors: 'Has errors', done: 'Done', failed: 'Stopped', running: 'Running' };
    var CH = { ready: 'new', errors: 'bad', done: 'ok', failed: 'bad', running: 'upd' };
    function plan(msg) {
      var bad = steps.filter(function (s) { return s.state === 'errors'; });
      var todo = steps.filter(function (s) { return s.state !== 'done'; });
      var tbl = UI.table([
        { key: 'n', label: 'Step' }, { key: 'sheet', label: 'Sheet' }, { key: 'name', label: 'Tool' },
        { key: 'rows', label: 'Rows', text: function (s) { return s.rd.rows.length; }, render: function (s) { return String(s.rd.rows.length); } },
        { key: 'state', label: 'Status', render: function (s) { return UI.chip(LBL[s.state], CH[s.state]); }, text: function (s) { return LBL[s.state]; } },
        { key: 'counts', label: 'What it does', wrap: true }
      ], steps, { label: 'Playbook steps', rowKey: function (s) { return String(s.n); }, search: false, rowMenu: function (s) {
        return [{ header: 'Step ' + s.n + ' · ' + s.name },
          { icon: 'eye', label: 'Show the review', onClick: function () { showItems(s); } },
          { icon: 'download', label: 'Download the problems', onClick: function () { problems(s); } }];
      } });
      var runBtn = UI.btn(bad.length ? 'Fix the errors first' : 'Run ' + todo.length + ' step' + (todo.length === 1 ? '' : 's'), { kind: 'primary', icon: 'play', onClick: runAll });
      if (bad.length || !todo.length) runBtn.disabled = true;
      U.swap(body,
        h('div.row', h('span.muted', wb.name), h('span', { style: { flex: 1 } }),
          UI.btn('Choose another workbook', { kind: 'quiet', icon: 'back', onClick: intro }),
          UI.btn('Check again', { kind: 'quiet', icon: 'retry', onClick: check }), runBtn),
        msg || null,
        bad.length ? UI.note('bad', bad.length + ' sheet' + (bad.length > 1 ? 's have' : ' has') + ' errors', 'Nothing has been sent. Open the step’s menu (⋯) to see the review or download the problems, fix the workbook, and choose it again.') :
          todo.length ? UI.note('info', null, 'Rows marked “waiting” use something an earlier step creates; they are checked again after that step has run. The run stops at the first step with errors or failed rows.') : null,
        tbl);
    }
    function showItems(s) {
      return UI.dialog(function (box, close) {
        box.classList.add('wide');
        U.append(box, [h('h2', 'Step ' + s.n + ' · ' + s.name),
          UI.table([{ key: 'row', label: 'Row' }, { key: 'kind', label: 'Action', text: function (it) { return it.kind === 'wait' ? 'Waits for step ' + it.waitFor : it.kind; } }, { key: 'label', label: 'Item', wrap: true },
            { key: 'error', label: 'Error / changes', wrap: true, text: function (it) { return it.error || (it.changes || []).map(function (c) { return c.field + ' → ' + X.fmt(c.to); }).join(', '); } }],
            s.items, { label: 'Review', rowKey: function (it, i) { return String(i); } }),
          h('div.acts', h('button.btn.primary', { type: 'button', onclick: function () { close(); } }, 'Close'))]);
      }, 'journaldlg');
    }
    function problems(s) {
      var bad = s.items.filter(function (it) { return it.kind === 'bad' || it.kind === 'wait' || (it.result && !it.result.ok); });
      return X.download('playbook_step' + s.n + '_' + norm(s.name) + '_problems.xlsx', [{ name: 'Problems', headers: ['Row', 'Item', 'Problem'],
        rows: bad.map(function (it) { return [it.row, it.label, it.kind === 'wait' ? 'Waits for step ' + it.waitFor : it.error || (it.result ? (it.result.status ? 'HTTP ' + it.result.status + ': ' : '') + it.result.msg : '')]; }) }]);
    }

    async function runAll() {
      var todo = steps.filter(function (s) { return s.state !== 'done'; });
      var n = todo.reduce(function (a, s) { return a + s.items.filter(E.applicable).length; }, 0);
      var ok = await UI.confirm({ title: 'Run ' + todo.length + ' step' + (todo.length === 1 ? '' : 's') + '?', body: h('div', h('p.muted', 'About ' + n + ' change(s) now, plus the waiting rows once their step has run. Steps run in order and stop at the first problem.'),
        h('div.muted.small', todo.map(function (s) { return h('div', s.n + '. ' + s.name + ' — ' + s.counts); }))), verb: 'Run playbook' });
      if (!ok) return;
      var panel = UI.runPanel('Playbook · ' + wb.name + ' · ' + Api.envLabel());
      U.swap(body, panel);
      for (var i = 0; i < steps.length; i++) {
        var s = steps[i];
        if (s.state === 'done') continue;
        panel.log('Step ' + s.n + ': ' + s.name + ' — checking against ' + Api.envLabel() + '…');
        try { s.items = await s.cfg.parse(s.rd); } catch (e) { s.state = 'failed'; s.counts = e.message; panel.log('✕ Step ' + s.n + ' could not be checked: ' + e.message, 'e'); break; }
        var errs = s.items.filter(function (it) { return it.kind === 'bad'; });
        s.counts = kindsOf(s.items);
        if (errs.length) { s.state = 'failed'; panel.log('✕ Step ' + s.n + ' has ' + errs.length + ' error(s); stopping. Nothing from this step was sent.', 'e'); break; }
        var items = s.items.filter(E.applicable);
        if (!items.length) { s.state = 'done'; panel.log('✓ Step ' + s.n + ': nothing to change.', 'o'); continue; }
        s.state = 'running';
        var res = await E.runAndRecord(panel, items, s.cfg, { file: { name: wb.name + ' › ' + s.sheet, sha256: wb.hash, rows: s.rd.rows.length }, note: 'Playbook step ' + s.n });
        s.counts = res.ok.length + ' succeeded · ' + res.failed.length + ' failed';
        if (res.failed.length || panel.ctrl.stopped) { s.state = 'failed'; panel.log('✕ Step ' + s.n + ': ' + res.failed.length + ' failed; stopping. Later steps were not run.', 'e'); break; }
        s.state = 'done';
        panel.log('✓ Step ' + s.n + ' done.', 'o');
      }
      var left = steps.filter(function (s) { return s.state !== 'done'; }).length;
      panel.finish(left ? 'Stopped — ' + (steps.length - left) + ' of ' + steps.length + ' steps done' : 'All ' + steps.length + ' steps done');
      ctx.Shell && ctx.Shell.noteRun(MOD, steps.length - left, left);
      U.append(body, [h('div.reportbox', UI.note(left ? 'warn' : 'ok', null, left ? 'Fix the workbook and choose it again: steps already done are skipped only while this page stays open; a fresh check shows them as “No change”. Every step is in the run journal with its undo file.' : 'Every step is in the run journal (user menu → Run journal), with an undo file where the tool supports it.'),
        h('div.acts', UI.btn('Back to the steps', { icon: 'back', onClick: function () { plan(); } }), UI.btn('Open the run journal', { kind: 'quiet', icon: 'list', onClick: function () { E.openJournal(); } })))]);
    }

    intro();
  }
});
