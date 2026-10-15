/* core/engine.js — the shared "review before write" flow used by every tool.
 *
 *   Choose file → Review (what will change) → Apply (pause / stop) → Report (download, retry failed)
 *
 * Item shape produced by a tool's parse():
 *   { kind:'new'|'upd'|'same'|'skip'|'bad', label, ref (id or key), row (Excel row no.),
 *     changes:[{ field, from, to }], error, payload, run: async () => apiResult }
 * Only 'new' and 'upd' items can be applied; 'same' / 'skip' / 'bad' are shown for transparency.
 */
'use strict';

var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api;

var KIND = {
  new: { chip: 'new', label: 'New' },
  upd: { chip: 'upd', label: 'Update' },
  del: { chip: 'bad', label: 'Delete' },
  act: { chip: 'new', label: 'Action' },
  same: { chip: '', label: 'No change' },
  skip: { chip: '', label: 'Skipped' },
  bad: { chip: 'bad', label: 'Error' }
};
function applicable(it) { return it.kind === 'new' || it.kind === 'upd' || it.kind === 'del' || it.kind === 'act'; }

/* ---------- queue runner ---------- */
async function runQueue(panel, items, opts) {
  opts = opts || {};
  var ok = [], failed = [];
  var total = items.length;
  for (var i = 0; i < items.length; i++) {
    while (panel.ctrl.paused && !panel.ctrl.stopped) await U.sleep(200);
    if (panel.ctrl.stopped) { panel.log('Stopped. ' + (total - i) + ' item(s) not sent.', 'w'); items.slice(i).forEach(function (it) { it.result = { ok: false, status: '', msg: 'Not sent (stopped)' }; failed.push(it); }); break; }
    var it = items[i];
    var res;
    try { res = await it.run(); }
    catch (e) { res = { ok: false, status: 0, text: e.message }; }
    res = res || { ok: false, status: 0, text: 'No response' };
    var msg = res.ok ? (res.msg || 'OK') : (res.msg || Api.parseError(res.text));
    var newId = '';
    if (res.ok && res.data && typeof res.data === 'object' && res.data.id != null) newId = res.data.id;
    it.result = { ok: !!res.ok, status: res.status, msg: msg, id: newId };
    if (res.ok) {
      ok.push(it);
      panel.log('✓ ' + (KIND[it.kind] || {}).label + ' · ' + it.label + (newId && it.kind === 'new' ? ' → id ' + newId : ''), 'o');
      var op = it.op || (it.kind === 'new' ? 'created' : it.kind === 'upd' ? 'updated' : it.kind === 'del' ? 'deleted' : null);
      if (op) ctx.Audit.onDbOp(op, 1);
    } else {
      failed.push(it);
      panel.log('✕ ' + it.label + ' — ' + (res.status ? 'HTTP ' + res.status + ': ' : '') + msg, 'e');
    }
    panel.set(i + 1, total, ok.length + ' ok · ' + failed.length + ' failed');
    if (opts.gap) await U.sleep(opts.gap);
  }
  return { ok: ok, failed: failed };
}

/* ---------- report ---------- */
function reportSheet(items, extraCols) {
  extraCols = extraCols || [];
  return {
    name: 'Result', tabColor: '0B5CC7',
    headers: ['excel_row', 'action', 'item', 'result', 'http_status', 'new_id', 'message'].concat(extraCols.map(function (c) { return c.label; })),
    rows: items.map(function (it) {
      var r = it.result || {};
      return [it.row || '', (KIND[it.kind] || {}).label || it.kind, it.label, r.ok ? 'OK' : (it.result ? 'FAILED' : (KIND[it.kind] || {}).label), r.status || '', r.id || '', r.msg || it.error || '']
        .concat(extraCols.map(function (c) { return c.get(it); }));
    })
  };
}

/* ---------- change list cell ---------- */
function changesCell(it) {
  if (it.error) return h('span', { style: { color: 'var(--bad)' } }, it.error);
  if (it.note) return h('span.muted', it.note);
  if (!it.changes || !it.changes.length) return h('span.dim', it.kind === 'new' ? 'New record' : '—');
  var shown = it.changes.slice(0, 4).map(function (c) {
    return h('div', h('span.muted', c.field + ': '), h('s.dim', fmtv(c.from)), ' → ', h('b', fmtv(c.to)));
  });
  if (it.changes.length > 4) shown.push(h('div.dim', '+' + (it.changes.length - 4) + ' more'));
  return h('div', shown);
}
function fmtv(v) { v = X.fmt(v); return v === '' || v == null ? '∅' : String(v).length > 60 ? String(v).slice(0, 57) + '…' : String(v); }

/* =========================================================
 * uploadFlow(cfg) -> element
 *  cfg.module        audit module name
 *  cfg.intro         node/text shown above the drop zone
 *  cfg.template()    async → downloads template (optional)
 *  cfg.parse(file)   async → items[]   (file = result of X.read)
 *  cfg.verb          'Apply' label noun, e.g. 'changes'
 *  cfg.reportCols    extra report columns [{label,get(it)}]
 *  cfg.blankNote     text (or fn → text) shown on review when updates exist, describing what blank cells do
 *  cfg.sheet         sheet name to read (optional)
 * ========================================================= */
function uploadFlow(cfg) {
  var st = UI.steps(['Choose file', 'Review', 'Apply', 'Report']);
  var body = h('div');
  var el = h('div', st, body);
  var items = [];
  var fileName = '';

  function stepChoose() {
    st.set(0);
    var tplBtn = cfg.template ? UI.btn('Download template', { icon: 'template', onClick: cfg.template }) : null;
    var dz = UI.drop({
      onFile: async function (f) {
        fileName = f.name;
        var file = await X.read(f, { sheet: cfg.sheet });
        if (!file.rows.length) throw new Error('No data rows found in ' + f.name);
        U.swap(body, h('div.card', h('span.spin'), '  Reading ' + file.rows.length + ' row(s) and comparing with ' + Api.envLabel() + '…'));
        try { items = await cfg.parse(file); }
        catch (e) { stepChoose(); UI.toast(e.message, 'bad'); return; }
        stepReview();
      }
    });
    U.swap(body,
      cfg.intro ? (cfg.intro instanceof Node ? cfg.intro : UI.note('info', null, cfg.intro)) : null,
      h('div.row', { style: { marginBottom: '14px' } }, tplBtn, cfg.extraActions || null),
      dz);
  }

  function stepReview() {
    st.set(1);
    var by = function (k) { return items.filter(function (i) { return i.kind === k; }).length; };
    var cnt = [];
    if (by('new')) cnt.push({ n: by('new'), label: 'New', kind: 'new' });
    if (by('upd')) cnt.push({ n: by('upd'), label: 'Updated', kind: 'upd' });
    if (by('del')) cnt.push({ n: by('del'), label: 'To delete', kind: 'bad' });
    if (by('act')) cnt.push({ n: by('act'), label: 'To send', kind: 'new' });
    cnt.push({ n: by('same'), label: 'No change' });
    if (by('skip')) cnt.push({ n: by('skip'), label: 'Skipped' });
    cnt.push({ n: by('bad'), label: 'Errors', kind: 'bad' });

    var sel = new Set();
    items.forEach(function (it, i) { it.__k = String(i); it.__lock = !applicable(it); if (applicable(it)) sel.add(it.__k); });
    var applyBtn = UI.btn('', { kind: 'primary', icon: 'play' });
    function label() { U.swap(applyBtn, U.icon('play', 18), h('span', 'Apply ' + sel.size + ' ' + (cfg.verb || 'change') + (sel.size === 1 ? '' : 's'))); applyBtn.disabled = !sel.size; }
    var filter = 'all';
    var list = items.slice();
    var tbl = UI.table([
      { key: 'row', label: 'Row' },
      { key: 'kind', label: 'Action', render: function (it) { return UI.chip((KIND[it.kind] || {}).label || it.kind, (KIND[it.kind] || {}).chip); }, text: function (it) { return (KIND[it.kind] || {}).label; } },
      { key: 'label', label: cfg.itemLabel || 'Item', wrap: true },
      { key: 'changes', label: 'What changes', wrap: true, render: changesCell, text: function (it) { return (it.error || '') + (it.changes || []).map(function (c) { return c.field + ' ' + c.to; }).join(' '); } }
    ], list, { select: true, selected: sel, rowKey: function (it) { return it.__k; }, onSelect: label });
    var chipsBar = h('div.row', { style: { margin: '6px 0 2px' } });
    [['all', 'All'], ['change', 'Changes only'], ['bad', 'Errors']].forEach(function (f) {
      var b = UI.btn(f[1], { sm: true, kind: f[0] === filter ? '' : 'quiet' });
      b.onclick = function () {
        filter = f[0];
        Array.prototype.forEach.call(chipsBar.children, function (c) { c.classList.add('quiet'); });
        b.classList.remove('quiet');
        tbl.setRows(items.filter(function (it) { return filter === 'all' ? true : filter === 'bad' ? it.kind === 'bad' : applicable(it); }));
      };
      chipsBar.appendChild(b);
    });
    applyBtn.onclick = function () { stepApply(items.filter(function (it) { return sel.has(it.__k); })); };
    label();
    var errs = items.filter(function (i) { return i.kind === 'bad'; });
    U.swap(body,
      h('div.row', h('span.muted', fileName), h('span', { style: { flex: 1 } }),
        errs.length ? UI.btn('Download errors', { icon: 'download', kind: 'quiet', onClick: function () { return X.download((cfg.module || 'upload').replace(/\W+/g, '_') + '_errors_' + U.stamp() + '.xlsx', [reportSheet(errs, cfg.reportCols)]); } }) : null,
        UI.btn('Choose another file', { kind: 'quiet', icon: 'back', onClick: stepChoose }),
        applyBtn),
      UI.counts(cnt),
      by('upd') && cfg.blankNote ? UI.note('info', null, typeof cfg.blankNote === 'function' ? cfg.blankNote() : cfg.blankNote) : null,
      chipsBar, tbl);
  }

  async function stepApply(todo) {
    var n = todo.length;
    var nn = todo.filter(function (i) { return i.kind === 'new'; }).length, nu = todo.filter(function (i) { return i.kind === 'upd'; }).length, nd = todo.filter(function (i) { return i.kind === 'del'; }).length;
    var parts = [];
    if (nn) parts.push(nn + ' new'); if (nu) parts.push(nu + ' update' + (nu > 1 ? 's' : '')); if (nd) parts.push(nd + ' delete' + (nd > 1 ? 's' : ''));
    var ok = await UI.confirm({ title: 'Apply ' + n + ' ' + (cfg.verb || 'change') + (n === 1 ? '' : 's') + '?', body: (parts.join(', ') || n + ' item(s)') + (cfg.module ? ' in ' + cfg.module + '.' : '.'), verb: 'Apply ' + n, danger: nd > 0 });
    if (!ok) return;
    st.set(2);
    ctx.Audit.newTransaction();
    var panel = UI.runPanel('Applying ' + n + ' ' + (cfg.verb || 'change') + (n === 1 ? '' : 's') + ' to ' + Api.envLabel());
    U.swap(body, panel);
    panel.set(0, n);
    var res = await runQueue(panel, todo, { gap: cfg.gap });
    panel.finish(res.ok.length + ' succeeded · ' + res.failed.length + ' failed');
    stepReport(todo, res, panel);
    cfg.onDone && cfg.onDone(res);
    ctx.Shell && ctx.Shell.noteRun(cfg.module, res.ok.length, res.failed.length);
  }

  function stepReport(todo, res, panel) {
    st.set(3);
    var all = items.filter(function (it) { return it.result || !applicable(it); });
    U.append(body, [
      UI.counts([{ n: res.ok.length, label: 'Succeeded', kind: 'ok' }, { n: res.failed.length, label: 'Failed', kind: 'bad' }]),
      h('div.acts',
        UI.btn('Download report', { icon: 'download', kind: 'primary', onClick: function () { return X.download((cfg.module || 'upload').replace(/\W+/g, '_') + '_report_' + U.stamp() + '.xlsx', [reportSheet(all, cfg.reportCols)]); } }),
        res.failed.length ? UI.btn('Retry ' + res.failed.length + ' failed', { icon: 'retry', onClick: function () { stepApply(res.failed.slice()); } }) : null,
        UI.btn('Start over', { kind: 'quiet', icon: 'upload', onClick: stepChoose }))
    ]);
  }

  stepChoose();
  el.reset = stepChoose;
  return el;
}

/* =========================================================
 * entity(view, cfg) — standard config tool: Upload (create/update with diff) + Browse (export, delete).
 *  cfg.module, cfg.noun ('paycode'), cfg.base ('/api/attendance/paycodes')
 *  cfg.list()              async → records (default GET base?projection=FULL)
 *  cfg.refs()              async → reference data used by flatten/build (optional)
 *  cfg.headers(refs)       → upload headers (first = id column)
 *  cfg.inputCols           → highlighted header indexes
 *  cfg.flatten(rec, refs)  → { header: value } (same headers as upload)
 *  cfg.build(row, refs)    → payload (row = { header: value })
 *  cfg.validate(row, payload, refs) → error string | null
 *  cfg.labelOf(row)        → readable item name
 *  cfg.refSheets(refs, records) → extra template sheets
 *  cfg.browse              → [{ key: header, label }] (default: first 6 headers)
 *  cfg.create(payload) / cfg.update(id, payload) / cfg.remove(id)  (defaults: POST base, PUT base/id, DELETE base/id)
 *  cfg.extraTabs           → [{ id, label, render(body) }]
 *  cfg.idCol (default headers[0])
 * ========================================================= */
function entity(view, cfg) {
  var mod = cfg.module;
  var base = cfg.base;
  var cache = { records: null, refs: null };
  async function loadRefs() { if (!cache.refs) cache.refs = cfg.refs ? await cfg.refs() : {}; return cache.refs; }
  async function loadList(force) {
    if (!cache.records || force) cache.records = cfg.list ? await cfg.list() : await Api.list(base, { query: { projection: 'FULL' }, module: mod });
    return cache.records;
  }
  function hdrs(refs) { return typeof cfg.headers === 'function' ? cfg.headers(refs) : cfg.headers; }
  var create = cfg.create || function (p) { return Api.call('POST', base, { body: p, module: mod }); };
  var update = cfg.update || function (id, p) { return Api.call('PUT', base + '/' + id, { body: p, module: mod }); };
  var remove = cfg.remove || function (id) { return Api.call('DELETE', base + '/' + id, { module: mod }); };
  var noun = cfg.noun || 'record';

  async function template(withData) {
    var refs = await loadRefs();
    var recs = await loadList(true).catch(function () { return []; });
    var H = hdrs(refs);
    var rows = withData ? recs.map(function (r) { var f = cfg.flatten(r, refs); return H.map(function (k) { return X.fmt(f[k]); }); }) : [];
    var sheets = [{ name: (mod + '_Upload').replace(/\W+/g, '_'), headers: H, rows: rows, highlightCols: cfg.inputCols, tabColor: '0B5CC7' }];
    if (!withData && recs.length) sheets.push({ name: 'Existing_Ref', tabColor: '7C3AED', headers: H, rows: recs.map(function (r) { var f = cfg.flatten(r, refs); return H.map(function (k) { return X.fmt(f[k]); }); }) });
    if (cfg.refSheets) sheets = sheets.concat((await cfg.refSheets(refs, recs)) || []);
    await X.download(mod.replace(/\W+/g, '_').toLowerCase() + (withData ? '_export_' + U.stamp() : '_template') + '.xlsx', sheets);
  }

  async function parse(file) {
    var refs = await loadRefs();
    var recs = await loadList(true);
    var H = hdrs(refs);
    var idCol = cfg.idCol || H[0];
    var byId = {};
    recs.forEach(function (r) { byId[String(r.id)] = r; });
    var fileCols = file.headers.filter(Boolean);
    function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
    var colMap = {}; // template header -> file header
    H.forEach(function (k) { var m = fileCols.filter(function (c) { return norm(c) === norm(k); })[0]; if (m) colMap[k] = m; });
    // accept "id" for "id (blank=create)" and similar
    if (!colMap[idCol]) { var alt = fileCols.filter(function (c) { return norm(c) === 'id' || norm(c).indexOf(norm(idCol).slice(0, 6)) === 0; })[0]; if (alt) colMap[idCol] = alt; }
    var unknown = fileCols.filter(function (c) { return !Object.keys(colMap).some(function (k) { return colMap[k] === c; }); });

    var items = file.rows.map(function (r) {
      var row = {};
      Object.keys(colMap).forEach(function (k) { row[k] = r[colMap[k]]; });
      var id = X.int(row[idCol]);
      if (id == null && X.str(row[idCol]) !== '') return { row: r.__row, kind: 'bad', label: String(row[H[1]] || ''), error: 'Id "' + X.str(row[idCol]) + '" is not a number. Leave it blank to create.' };
      var it = { row: r.__row, label: cfg.labelOf ? cfg.labelOf(row) : String(row[H[1]] || '') };
      try {
        if (id != null) {
          var cur = byId[String(id)];
          if (!cur) { it.kind = 'bad'; it.error = 'No ' + noun + ' with id ' + id + ' in ' + Api.envLabel(); return it; }
          var before = cfg.flatten(cur, refs);
          var merged = Object.assign({}, before);
          Object.keys(colMap).forEach(function (k) { if (k !== idCol && X.str(row[k]) !== '') merged[k] = /^clear$/i.test(X.str(row[k])) ? '' : row[k]; });
          if (!it.label) it.label = cfg.labelOf ? cfg.labelOf(merged) : String(merged[H[1]] || id);
          it.ref = id;
          it.changes = H.filter(function (k) { return k !== idCol && colMap[k] && X.str(row[k]) !== '' && !(merged[k] === '' ? X.str(before[k]) === '' : same(before[k], merged[k])); })
            .map(function (k) { return { field: k, from: before[k], to: merged[k] }; });
          if (!it.changes.length) { it.kind = 'same'; return it; }
          var p = cfg.build(merged, refs, cur);
          p.id = id;
          var err = cfg.validate && cfg.validate(merged, p, refs);
          if (err) { it.kind = 'bad'; it.error = err; return it; }
          it.kind = 'upd'; it.payload = p;
          it.run = function () { return update(id, p); };
        } else {
          if (!Object.keys(row).some(function (k) { return X.str(row[k]) !== ''; })) { it.kind = 'skip'; it.note = 'Empty row'; return it; }
          Object.keys(row).forEach(function (k) { if (/^clear$/i.test(X.str(row[k]))) row[k] = ''; });
          var p2 = cfg.build(row, refs, null);
          var err2 = cfg.validate && cfg.validate(row, p2, refs);
          if (err2) { it.kind = 'bad'; it.error = err2; return it; }
          it.kind = 'new'; it.payload = p2;
          it.run = function () { return create(p2); };
        }
      } catch (e) { it.kind = 'bad'; it.error = e.message; }
      return it;
    });
    if (unknown.length) UI.toast('Ignored column(s) not in the template: ' + unknown.slice(0, 5).join(', ') + (unknown.length > 5 ? '…' : ''));
    var seen = {};
    items.forEach(function (it) { if (it.ref != null && applicable(it)) { if (seen[it.ref]) { it.kind = 'bad'; it.error = 'Same id ' + it.ref + ' appears again on row ' + seen[it.ref]; } else seen[it.ref] = it.row; } });
    return items;
  }

  function browse(bodyEl) {
    var holder = h('div', h('div.card', h('span.spin'), '  Loading ' + noun + 's from ' + Api.envLabel() + '…'));
    U.append(bodyEl, [holder]);
    async function draw(force) {
      var refs = await loadRefs();
      var recs = await loadList(force);
      var H = hdrs(refs);
      var show = [{ key: 'id', label: 'Id' }].concat(cfg.browse || H.slice(1, 7).map(function (k) { return { key: k, label: k.replace(/\s*\(.*\)/, '') }; }));
      var rows = recs.map(function (r) { var f = cfg.flatten(r, refs); f.id = r.id; f.__rec = r; return f; });
      var delBtn = UI.btn('Delete selected', { icon: 'trash', kind: 'quiet', sm: true });
      delBtn.disabled = true;
      var tbl = UI.table(show, rows, {
        select: cfg.canDelete !== false, rowKey: function (r) { return String(r.id); },
        onSelect: function (s) { delBtn.disabled = !s.size; U.swap(delBtn, U.icon('trash', 16), h('span', s.size ? 'Delete ' + s.size : 'Delete selected')); },
        toolbar: [
          UI.btn('Refresh', { icon: 'retry', sm: true, kind: 'quiet', onClick: function () { return draw(true); } }),
          UI.btn('Export for editing', { icon: 'download', sm: true, onClick: function () { return template(true); } }),
          cfg.canDelete !== false ? delBtn : null
        ]
      });
      delBtn.onclick = function () {
        var ids = Array.from(tbl.selected);
        var todo = ids.map(function (id) {
          var f = rows.filter(function (r) { return String(r.id) === id; })[0] || {};
          return { kind: 'del', ref: id, label: (cfg.labelOf ? cfg.labelOf(f) : id) + ' (id ' + id + ')', run: function () { return remove(id); } };
        });
        runDeletes(todo, mod, noun).then(function (r) { if (r) draw(true); });
      };
      U.swap(holder, recs.length ? tbl : UI.empty('No ' + noun + 's in ' + Api.envLabel() + ' yet.'));
    }
    draw().catch(function (e) { U.swap(holder, UI.note('bad', 'Could not load ' + noun + 's', e.message)); });
  }

  view.appendChild(UI.tabs([
    { id: 'upload', label: 'Create / update', render: function (b) { b.appendChild(uploadFlow({ module: mod, template: function () { return template(false); }, parse: parse, itemLabel: cap(noun), blankNote: function () { return 'Columns that are missing or left blank keep their current value in ' + Api.envLabel() + '. To empty a value, type CLEAR in the cell.'; }, intro: cfg.intro || 'Leave the id blank to create a new ' + noun + '. Fill the id to update an existing one. Tip: use “Export for editing” in Browse to get current data in this format.', reportCols: cfg.reportCols })); } },
    { id: 'browse', label: 'Browse & export', render: browse }
  ].concat(cfg.extraTabs || [])));
}

/* Confirm + run deletes, shown in a dialog with progress. Returns the results or null if cancelled. */
async function runDeletes(todo, mod, noun) {
  if (!todo.length) return null;
  var list = h('div.muted.small', { style: { maxHeight: '140px', overflow: 'auto' } }, todo.slice(0, 40).map(function (t) { return h('div', '• ' + t.label); }), todo.length > 40 ? h('div', '… and ' + (todo.length - 40) + ' more') : null);
  var ok = await UI.confirm({ title: 'Delete ' + todo.length + ' ' + noun + (todo.length > 1 ? 's' : '') + '?', body: h('div', h('p.muted', 'This cannot be undone.'), list), verb: 'Delete ' + todo.length, danger: true });
  if (!ok) return null;
  ctx.Audit.newTransaction();
  var res;
  await UI.dialog(function (box, close) {
    var panel = UI.runPanel('Deleting from ' + Api.envLabel());
    var done = UI.btn('Close', { kind: 'primary' }); done.disabled = true; done.onclick = function () { close(true); };
    U.append(box, [h('h2', 'Deleting ' + noun + 's'), panel, h('div.acts', done)]);
    panel.set(0, todo.length);
    runQueue(panel, todo).then(function (r) {
      res = r;
      panel.finish(r.ok.length + ' deleted · ' + r.failed.length + ' failed');
      done.disabled = false; done.focus();
      ctx.Shell && ctx.Shell.noteRun(mod, r.ok.length, r.failed.length);
    });
  });
  return res;
}

/* Is an uploaded cell the same as the current value?
 * TRUE/true/yes all mean true; numbers compare by value ("1" = "1.0" = "1,000" vs "1000"),
 * but codes with leading zeros ("0012") are text and must match exactly. */
function same(a, b) {
  var x = X.str(X.fmt(a)), y = X.str(X.fmt(b));
  if (x === y) return true;
  var bw = /^(true|false|yes|no)$/i;
  if (bw.test(x) && bw.test(y)) return X.bool(x) === X.bool(y);
  var nx = X.num(x), ny = X.num(y), lz = /^-?0\d/;
  if (nx !== null && ny !== null && !lz.test(x) && !lz.test(y)) return nx === ny;
  return false;
}
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

ctx.Engine = { runQueue: runQueue, uploadFlow: uploadFlow, entity: entity, runDeletes: runDeletes, reportSheet: reportSheet, applicable: applicable, same: same };
