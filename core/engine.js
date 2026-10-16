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
  bad: { chip: 'bad', label: 'Error' },
  done: { chip: 'ok', label: 'Applied' }
};
function applicable(it) { return it.kind === 'new' || it.kind === 'upd' || it.kind === 'del' || it.kind === 'act'; }

/* =========================================================
 * Read-only roles (v3.15). A role listed in layout.json access.readOnly (core/layout.js sets ctx.READONLY) can open
 * its tools, browse and export, but APIary sends no write for it:
 *  - every call through Api.call other than GET is refused before it leaves the browser (the few POSTs that only read,
 *    READ_POSTS, still go through);
 *  - runQueue sends nothing (this also covers tools that send their own requests, such as Roles & Positions);
 *  - upload flows show a note instead of the drop zone, and Delete buttons are hidden.
 * When the role is not read-only nothing changes: the original Api.call runs with the same arguments.
 * This is a guard rail in APIary, not a permission: Beeforce still decides what an account may change.
 * ========================================================= */
var RO_TEXT = 'Not sent: your APIary role is read only.';
var READ_POSTS = ['employee-bulk-create.org-level-entries-next'];
function readOnly() { return !!ctx.READONLY; }
function readPost(method, path) {
  if (String(method).toUpperCase() !== 'POST') return false;
  var p = String(path || '').replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  return READ_POSTS.some(function (k) { try { return ctx.EP.path(k) === p; } catch (e) { return false; } });
}
(function () {
  var inner = Api.call;
  Api.call = function (method, path) {
    if (ctx.READONLY && String(method).toUpperCase() !== 'GET' && !readPost(method, path)) return Promise.resolve({ ok: false, status: 0, data: null, text: RO_TEXT });
    return inner.apply(this, arguments);
  };
})();
function readOnlyNote() {
  return UI.note('info', 'Read only', 'Your APIary role can read and export, but not change data. Use Browse & export (or the Data Export tool) to get data. Ask the APIary admin if you need to make changes.');
}

/* Production guard (v3.15): in Production, a run of many items, or any delete, asks you to type PRODUCTION first.
 * Settings for this browser (Admin Settings → Safety): bft.prodGuard = { on: true, min: 20 }. */
var GUARD_DEFAULT = { on: true, min: 20 };
function guardSettings() {
  var g = U.store.get('prodGuard', null);
  var on = g && typeof g.on === 'boolean' ? g.on : GUARD_DEFAULT.on;
  var min = g && typeof g.min === 'number' && g.min >= 1 && g.min <= 100000 ? Math.floor(g.min) : GUARD_DEFAULT.min;
  return { on: on, min: min };
}

/* =========================================================
 * Run journal (v3.13). Every run (apply, retry, delete) is kept in this browser for this site, in IndexedDB
 * ("apiary" / "runs"): who, environment, tool, file name + SHA-256, every item with its result, every request with its
 * response (bodies shortened), and the undo data. The newest 300 runs are kept. Nothing leaves the browser unless you
 * download it. The token is never recorded (request headers are not kept).
 * ========================================================= */
var Journal = (function () {
  var DB = 'apiary', ST = 'runs', KEEP = 300;
  function open() {
    return new Promise(function (res, rej) {
      if (!window.indexedDB) return rej(new Error('This browser cannot keep a run journal (IndexedDB is not available).'));
      var r = indexedDB.open(DB, 1);
      r.onupgradeneeded = function () { var db = r.result; if (!db.objectStoreNames.contains(ST)) db.createObjectStore(ST, { keyPath: 'id', autoIncrement: true }); };
      r.onsuccess = function () { res(r.result); };
      r.onerror = function () { rej(r.error || new Error('Could not open the run journal.')); };
    });
  }
  function req(mode, fn) {
    return open().then(function (db) {
      return new Promise(function (res, rej) {
        var t = db.transaction(ST, mode), q = fn(t.objectStore(ST));
        t.oncomplete = function () { db.close(); res(q ? q.result : undefined); };
        t.onerror = t.onabort = function () { db.close(); rej(t.error || new Error('Run journal error')); };
      });
    });
  }
  function prune() {
    return req('readonly', function (s) { return s.getAllKeys(); }).then(function (keys) {
      if (!keys || keys.length <= KEEP) return;
      var drop = keys.slice(0, keys.length - KEEP);
      return req('readwrite', function (s) { drop.forEach(function (k) { s.delete(k); }); return null; });
    }).catch(function () {});
  }
  return {
    add: function (rec) { return req('readwrite', function (s) { return s.add(rec); }).then(function (id) { prune(); return id; }); },
    all: function () { return req('readonly', function (s) { return s.getAll(); }).then(function (l) { return (l || []).sort(function (a, b) { return b.id - a.id; }); }); },
    get: function (id) { return req('readonly', function (s) { return s.get(id); }); },
    del: function (id) { return req('readwrite', function (s) { return s.delete(id); }); },
    clear: function () { return req('readwrite', function (s) { return s.clear(); }); }
  };
})();

function clip(v, n) {
  if (v == null) return null;
  var s = typeof v === 'string' ? v : (function () { try { return JSON.stringify(v); } catch (e) { return String(v); } })();
  n = n || 4000;
  return s.length > n ? s.slice(0, n) + '… (' + s.length + ' characters)' : s;
}
/* Record every Beeforce call made while a run is going (wraps Api.call; restored by stop()). */
function recordCalls() {
  var calls = [], orig = Api.call, wrapper;
  wrapper = function (method, path, opts) {
    var t0 = performance.now(), at = Date.now();
    return orig.apply(this, arguments).then(function (r) {
      if (calls.length < 5000) calls.push({ at: at, m: method, p: String(path).replace(/^https?:\/\/[^/]+/, ''), q: (opts && opts.query) || null, req: clip(opts && opts.body),
        status: r ? r.status : 0, ok: !!(r && r.ok), ms: Math.round(performance.now() - t0), res: clip(r && (r.text != null ? r.text : r.data), 2000) });
      return r;
    });
  };
  Api.call = wrapper;
  return { calls: calls, stop: function () { if (Api.call === wrapper) Api.call = orig; } };
}
async function sha256(buf) {
  try {
    var d = await crypto.subtle.digest('SHA-256', buf);
    return Array.prototype.map.call(new Uint8Array(d), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
  } catch (e) { return null; }
}
function saveRun(o) {
  var st = Api.state;
  var rec = {
    at: new Date().toISOString(), kind: o.kind || 'apply', tool: o.tool || 'Tool', user: st.user || '', env: st.env || '', envLabel: Api.envLabel() || '',
    host: location.host, version: ctx.CONFIG.VERSION, file: o.file || null,
    sent: o.todo.length, ok: o.res.ok.length, failed: o.res.failed.length,
    items: o.todo.slice(0, 5000).map(function (it) { var r = it.result || {}; return { row: it.row == null ? '' : it.row, label: it.label || '', kind: it.kind, ok: !!r.ok, status: r.status || '', msg: r.msg || '', id: r.id == null ? '' : r.id }; }),
    calls: o.calls || [], undo: o.undo || null, note: o.note || ''
  };
  return Journal.add(rec).catch(function (e) { console.warn('APIary run journal:', e); return null; });
}

/* ---------- undo (v3.13) ----------
 * Tools that know how a record looked before an update set it.before (values by upload header) and it.undoCols
 * (the upload headers, id first). The undo file holds those old values in the tool's own upload format: changed fields
 * that were empty before get CLEAR, everything else is the old value. Records created by the run can be deleted again
 * when the tool names its delete endpoint (cfg.removeEp). */
/* v3.15: tools that send one record from several rows (one row per approval level, read by column position) give
 * it.undoRows instead: the record's rows as "Export for editing" writes them, taken just before the run, with
 * it.undoHeaders. Uploading those rows sends the record as it was, as far as the tool's upload format can say it. */
function undoOf(okItems, removeEp) {
  var upd = okItems.filter(function (it) { return it.kind === 'upd' && ((it.before && it.undoCols) || (it.undoRows && it.undoHeaders)); });
  var cols = upd.length ? (upd[0].undoHeaders || upd[0].undoCols) : null;
  var rows = [];
  upd.forEach(function (it) {
    if (it.undoRows) { it.undoRows.forEach(function (r) { rows.push(r.slice()); }); return; }
    var ch = {}; (it.changes || []).forEach(function (c) { ch[c.field] = 1; });
    rows.push(cols.map(function (k, i) {
      if (i === 0) return it.ref;
      var v = X.fmt(it.before[k]); v = v == null ? '' : v;
      return X.str(v) === '' && ch[k] ? 'CLEAR' : v;
    }));
  });
  var created = removeEp ? okItems.filter(function (it) { return it.kind === 'new' && it.result && it.result.id !== '' && it.result.id != null; })
    .map(function (it) { return { id: it.result.id, label: it.label || '' }; }) : [];
  if (!rows.length && !created.length) return null;
  return { headers: cols, rows: rows, records: upd.length, created: created, removeEp: removeEp || null };
}
function undoFile(u, tool, envLabel) {
  var sheets = [];
  if (u.rows.length) sheets.push({ name: 'Undo', headers: u.headers, rows: u.rows, tabColor: 'B57A00' });
  if (u.created.length) sheets.push({ name: 'Created_by_run', headers: ['id', 'item'], rows: u.created.map(function (c) { return [c.id, c.label]; }) });
  sheets.push({ name: 'How_to_undo', headers: ['Step'], rows: [
    ['Old values of ' + (u.records != null ? u.records : u.rows.length) + ' updated record(s) in ' + envLabel + ' (' + tool + ')' + (u.records != null && u.records !== u.rows.length ? ', in ' + u.rows.length + ' rows' : '') + '.'],
    ['Upload this file in ' + tool + ' → Create / update. You see the review first; nothing is sent before Apply.'],
    u.created.length ? [u.created.length + ' record(s) were created by the run. Delete them from the run journal or the report ("Delete created records").'] : ['No records were created by the run.']] });
  return X.download(String(tool).replace(/\W+/g, '_').toLowerCase() + '_undo_' + U.stamp() + '.xlsx', sheets);
}
async function deleteCreated(u, tool, env) {
  if (Api.state.env !== env) { UI.toast('These records are in ' + ((ctx.CONFIG.ENVIRONMENTS[env] || {}).label || env) + '. Sign in there to delete them.', 'bad'); return null; }
  var todo = u.created.map(function (c) { return { kind: 'del', ref: c.id, label: (c.label || 'record') + ' (id ' + c.id + ')', run: function () { return ctx.EP.call(u.removeEp, { id: c.id }, { module: tool }); } }; });
  return runDeletes(todo, tool, 'created record');
}

/* ---------- queue runner ---------- */
async function runQueue(panel, items, opts) {
  opts = opts || {};
  var ok = [], failed = [];
  var total = items.length;
  if (readOnly()) {
    panel.log(RO_TEXT + ' ' + total + ' item(s) not sent.', 'w');
    items.forEach(function (it) { it.result = { ok: false, status: '', msg: RO_TEXT }; failed.push(it); });
    panel.set(total, total, '0 ok · ' + failed.length + ' not sent');
    return { ok: ok, failed: failed };
  }
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


/* ---------- column mapping (v3.14): a customer's own column names → this tool's columns, remembered per tool in
 * this browser (bft.colmap). Applied before the tool reads the file; the tool's own checks are unchanged. ---------- */
function normH(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function savedMap(m) { var all = U.store.get('colmap', {}) || {}; return all[m] || {}; }
function saveMap(m, map) { var all = U.store.get('colmap', {}) || {}; if (Object.keys(map).length) all[m] = map; else delete all[m]; return U.store.set('colmap', all); }
function applyMap(rd, map) {
  var have = {}; rd.headers.forEach(function (x) { if (x) have[normH(x)] = 1; });
  var ren = [];
  var headers = rd.headers.map(function (x) { var t = x && map[normH(x)]; if (t && !have[normH(t)]) { ren.push([x, t]); have[normH(t)] = 1; return t; } return x; });
  if (!ren.length) return { rd: rd, ren: [] };
  var rows = rd.rows.map(function (r) { var o = { __row: r.__row }; rd.headers.forEach(function (x, i) { if (x) o[headers[i]] = r[x]; }); return o; });
  return { rd: Object.assign({}, rd, { headers: headers, rows: rows }), ren: ren };
}

/* ---------- helpers for runs, playbooks and Compare (v3.13) ---------- */
var CAPTURE = null;
/* Collect the upload flows a tool creates while fn() renders it (used by Playbooks to reuse a tool's parse + apply). */
function capture(fn, cb) { var prev = CAPTURE; CAPTURE = []; try { fn(); } finally { var got = CAPTURE; CAPTURE = prev; cb(got); } }
/* The sheets a template function would download, without downloading. */
async function captureSheets(excelFn) {
  var orig = X.download, got = null;
  X.download = function (name, sheets) { got = sheets; return Promise.resolve(); };
  try { await excelFn(); } finally { X.download = orig; }
  return got;
}
async function fileHash(f) { try { return await sha256(await f.arrayBuffer()); } catch (e) { return null; } }
/* runQueue + run journal + undo data. meta: { kind, file, note }. Returns runQueue's result plus .undo. */
async function runAndRecord(panel, todo, cfg, meta) {
  meta = meta || {};
  var rec = recordCalls(), res;
  try { res = await runQueue(panel, todo, { gap: cfg.gap }); }
  finally { rec.stop(); }
  res.undo = meta.kind === 'delete' ? null : undoOf(res.ok, cfg.removeEp);
  await saveRun({ kind: meta.kind || 'apply', tool: cfg.module || 'Tool', file: meta.file || null, todo: todo, res: res, calls: rec.calls, undo: res.undo, note: meta.note });
  return res;
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
 *  cfg.errorRows     true when every item comes from its own row(s) of the read sheet (item.row = a row number or
 *                    "2, 3"): error files then carry those rows with their upload columns, so they can be fixed and
 *                    uploaded again (v3.9). Grouped tools leave it off and get the result list only.
 *  cfg.csv           true when the template's first sheet is all the upload needs: "Download template" offers CSV.
 *
 * v3.9 step navigation: the stepper and Back buttons go to earlier steps; Alt ← / Alt → step back and forward.
 * Going back after (or while pausing) a run re-reads Beeforce with cfg.parse (the same GET requests) and marks the
 * rows that were already applied: they are locked and never sent again, whatever the review shows.
 * ========================================================= */
var ERR_COLS = ['Error', 'Stage', 'Row in file'];
/* CSV of an Excel download: run the tool's own Excel builder, take its first sheet (the one an upload reads) and save
 * that as CSV instead. The same GET requests are made; nothing else changes. */
async function captureCsv(excelFn, fallbackName) {
  var orig = X.download, got = null;
  X.download = function (name, sheets) { got = { name: name, sheets: sheets }; return Promise.resolve(); };
  try { await excelFn(); } finally { X.download = orig; }
  if (!got || !got.sheets || !got.sheets.length) throw new Error('Nothing to save.');
  var sh = got.sheets[0];
  X.downloadCsv(String(got.name || fallbackName + '.xlsx').replace(/\.xlsx$/i, '') + '.csv', sh);
  UI.toast('Saved as CSV: the ' + (sh.name || 'upload') + ' sheet' + (got.sheets.length > 1 ? '. Reference sheets are only in the Excel file.' : '.'), 'ok');
}
/* "Export for editing": one click = Excel as before; the chevron offers CSV of the upload sheet. */
function exportButton(excelFn, label) {
  var main = UI.btn(label || 'Export for editing', { icon: 'download', sm: true, onClick: excelFn });
  return UI.splitBtn(main, [{ header: 'Current data, in the upload format' },
    { icon: 'download', label: 'Excel (.xlsx)', sub: 'Every sheet', right: 'default', onClick: function () { UI.busy(main, excelFn); } },
    { icon: 'download', label: 'CSV (.csv)', sub: 'The upload sheet only', onClick: function () { captureCsv(excelFn, 'export').catch(function (e) { UI.toast(e.message, 'bad'); }); } }], label || 'Export for editing');
}
function rowNums(r) { return String(r == null ? '' : r).split(/\s*,\s*/).map(function (x) { return parseInt(x, 10); }).filter(function (n) { return n > 0; }); }
function uploadFlow(cfg) {
  var NAMES = ['Choose file', 'Review', 'Apply', 'Report'];
  var cur = 0;
  var items = [];
  var fileName = '', file = null, fileSha = null, raw = null, renamed = [];
  var done = {};         // identity → result, for every item applied in this flow (never sent again)
  var run = null;        // { panel, todo, back } while applying
  var last = null;       // { todo, res } of the last finished run
  var st = UI.steps(NAMES, { canPick: canPick, onPick: goStep });
  var body = h('div');
  var el = h('div.flow', st, body);
  var mod = (cfg.module || 'upload').replace(/\W+/g, '_');
  if (CAPTURE) CAPTURE.push({ cfg: cfg, el: el });

  /* An item's identity across re-reads of the same file: its row(s), or its label when it has no row. */
  function identify(list) {
    var seen = {};
    list.forEach(function (it, i) {
      var base = it.row != null && it.row !== '' ? 'r' + it.row : 'l' + (it.label || '');
      seen[base] = (seen[base] || 0) + 1;
      it.__id = base + '#' + seen[base];
      it.__k = String(i);
      if (done[it.__id]) { it.kind = 'done'; it.result = done[it.__id]; }
      it.__lock = !applicable(it);
    });
    return list;
  }
  function setStep(i) { cur = i; st.set(i); }
  function canPick(i) {
    if (run) return i === 1 ? true : false;
    if (i === 0) return true;
    if (i === 1) return items.length > 0;
    if (i === 3) return !!last;
    return false;
  }
  function goStep(i) {
    if (run) { if (i < 2) backFromRun(); return; }
    if (i === 0) stepChoose();
    else if (i === 1) last ? recheck() : stepReview();
    else if (i === 3 && last) stepReport();
  }
  el.stepKey = function (dir) {
    if (dir < 0) { if (run) return backFromRun(); if (cur === 3) return recheck(); if (cur === 1) return stepChoose(); }
    else { if (run) return; if (cur === 0 && items.length) return last ? recheck() : stepReview(); if (cur === 1 && R.applyBtn && !R.applyBtn.disabled) return R.applyBtn.click(); }
  };
  var R = {};

  /* ---------- downloads ---------- */
  // The review works on the current items; the report on the items as they were when its run ended (last.items).
  function src() { return cur === 3 && last ? last.items : items; }
  function errorItems() {
    return src().filter(function (it) { return it.kind === 'bad' || (it.result && !it.result.ok && it.kind !== 'done'); });
  }
  function stageOf(it) { return it.kind === 'bad' ? 'Review' : 'Apply'; }
  function msgOf(it) { var r = it.result; return it.kind === 'bad' ? (it.error || '') : r ? ((r.status ? 'HTTP ' + r.status + ': ' : '') + (r.msg || '')) : ''; }
  /* Re-uploadable errors: the uploaded rows (all their columns, in file order) + Error, Stage, Row in file. */
  function errorSheet(errs) {
    var hdr = (file && file.headers || []).filter(function (x) { return x && ERR_COLS.indexOf(x) < 0; });
    var byRow = {}; (file && file.rows || []).forEach(function (r) { byRow[r.__row] = r; });
    var rows = [];
    errs.forEach(function (it) {
      rowNums(it.row).forEach(function (n) {
        var r = byRow[n]; if (!r) return;
        rows.push({ n: n, v: hdr.map(function (k) { return r[k] == null ? '' : r[k]; }).concat([msgOf(it), stageOf(it), n]) });
      });
    });
    rows.sort(function (a, b) { return a.n - b.n; });
    return { name: 'Errors', tabColor: 'C62828', headers: hdr.concat(ERR_COLS), rows: rows.map(function (x) { return x.v; }), highlightCols: [hdr.length] };
  }
  function errorsExcel() {
    var errs = errorItems();
    var sheets = cfg.errorRows ? [errorSheet(errs), reportSheet(errs, cfg.reportCols)] : [reportSheet(errs, cfg.reportCols)];
    return X.download(mod + '_errors_' + U.stamp() + '.xlsx', sheets);
  }
  function errorsCsv() {
    var errs = errorItems();
    X.downloadCsv(mod + '_errors_' + U.stamp() + '.csv', cfg.errorRows ? errorSheet(errs) : reportSheet(errs, cfg.reportCols));
    UI.toast('Errors saved as CSV.', 'ok');
  }
  function copyErrors() {
    var errs = errorItems(), sh = cfg.errorRows ? errorSheet(errs) : reportSheet(errs, cfg.reportCols);
    var cell = function (v) { return String(v == null ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : v).replace(/[\t\r\n]+/g, ' '); };
    return UI.copy([sh.headers].concat(sh.rows).map(function (r) { return r.map(cell).join('\t'); }).join('\n'), errs.length + ' error row' + (errs.length === 1 ? '' : 's'));
  }
  function reportAll() { return src().filter(function (it) { return it.result || !applicable(it); }); }
  function reportExcel() { return X.download(mod + '_report_' + U.stamp() + '.xlsx', [reportSheet(reportAll(), cfg.reportCols)]); }
  function reportCsv() { X.downloadCsv(mod + '_report_' + U.stamp() + '.csv', reportSheet(reportAll(), cfg.reportCols)); UI.toast('Report saved as CSV.', 'ok'); }
  function errorsButton(kind) {
    var main = UI.btn('Download errors', { icon: 'download', kind: kind || 'quiet', title: 'Excel: ' + (cfg.errorRows ? 'the rows to fix (Errors) and the result list (Result)' : 'the result list of the rows that failed'), onClick: errorsExcel });
    return UI.splitBtn(main, [{ header: 'Rows with errors' },
      { icon: 'download', label: 'Excel (.xlsx)', sub: cfg.errorRows ? 'Errors to fix and upload again + Result' : 'Result list', right: 'default', onClick: function () { UI.busy(main, errorsExcel); } },
      { icon: 'download', label: 'CSV (.csv)', sub: cfg.errorRows ? 'Errors to fix and upload again' : 'Result list', onClick: errorsCsv },
      'hr',
      { icon: 'copy', label: 'Copy errors', sub: 'Tab-separated, to paste into a sheet or a message', onClick: copyErrors }], 'Download errors');
  }
  function templateCsv() { return captureCsv(cfg.template, mod + '_template'); }

  /* ---------- 1. choose ---------- */
  function stepChoose() {
    setStep(0);
    var tplBtn = null;
    if (cfg.template) {
      tplBtn = UI.btn('Download template', { icon: 'template', onClick: cfg.template });
      if (cfg.csv) tplBtn = UI.splitBtn(tplBtn, [{ header: 'Template' },
        { icon: 'download', label: 'Excel (.xlsx)', sub: 'Every sheet, with reference data', right: 'default', onClick: function () { UI.busy(tplBtn.firstChild, cfg.template); } },
        { icon: 'download', label: 'CSV (.csv)', sub: 'The upload sheet only', onClick: function () { templateCsv().catch(function (e) { UI.toast(e.message, 'bad'); }); } }], 'Download template');
    }
    if (readOnly()) {
      U.swap(body, readOnlyNote(), cfg.intro ? (cfg.intro instanceof Node ? cfg.intro : UI.note('info', null, cfg.intro)) : null, tplBtn ? h('div.row', tplBtn) : null);
      return;
    }
    var dz = UI.drop({
      onFile: async function (f) {
        var hash = await fileHash(f);
        var rd = await X.read(f, { sheet: cfg.sheet });
        if (!rd.rows.length) throw new Error('No data rows found in ' + f.name);
        return loadData(rd, f.name, hash);
      }
    });
    var keep = items.length && file ? UI.note('info', null, h('span', h('b', fileName), ' is still loaded' + (last ? ' (applied rows stay marked)' : '') + '. ',
      h('button.linkbtn', { type: 'button', onclick: function () { last ? recheck() : stepReview(); } }, 'Back to review →'))) : null;
    U.swap(body,
      cfg.intro ? (cfg.intro instanceof Node ? cfg.intro : UI.note('info', null, cfg.intro)) : null,
      keep,
      h('div.row', { style: { marginBottom: '14px' } }, tplBtn, cfg.extraActions || null),
      dz);
  }

  /* A file (or rows prepared by Compare) goes to the review. */
  async function loadData(rd, name, hash) {
    raw = rd;
    var mp = applyMap(rd, savedMap(mod)); rd = mp.rd; renamed = mp.ren;
    fileName = name; file = rd; fileSha = hash || null; done = {}; last = null;
    U.swap(body, h('div.card', h('span.spin'), '  Reading ' + rd.rows.length + ' row(s) and comparing with ' + Api.envLabel() + '…'));
    try { items = identify(await cfg.parse(rd)); }
    catch (e) { items = []; stepChoose(); UI.toast(e.message, 'bad'); return; }
    stepReview();
  }
  el.loadData = function (rd, name) {
    var txt = ''; try { txt = JSON.stringify(rd.rows); } catch (x) {}
    return sha256(new TextEncoder().encode(txt)).then(function (h_) { return loadData(rd, name, h_); });
  };

  /* Map the file's columns to this tool's columns (from its template), remember per tool, read the file again. */
  async function mapDialog() {
    var sheets = null;
    try { sheets = await captureSheets(cfg.template); } catch (e) { UI.toast('Could not read the template: ' + e.message, 'bad'); return; }
    var want = ((sheets && sheets[0] && sheets[0].headers) || []).filter(Boolean);
    var fileCols = raw.headers.filter(function (x) { return x && ERR_COLS.indexOf(x) < 0; });
    var cur = savedMap(mod);
    var sels = fileCols.map(function (x) {
      var pre = cur[normH(x)] || (want.filter(function (w) { return normH(w) === normH(x); })[0] || '');
      var s = UI.select([{ value: '', label: '— not used / as it is —' }].concat(want.map(function (w) { return { value: w, label: w }; })), pre);
      s.dataset.col = x;
      return s;
    });
    var used = want.filter(function (w) { return fileCols.some(function (x) { return normH(x) === normH(w); }); });
    var ok = await UI.dialog(function (box, close) {
      box.classList.add('wide');
      U.append(box, [h('h2', 'Map columns · ' + (cfg.module || 'this tool')),
        h('p.muted', { style: { margin: '0 0 10px' } }, 'Pick which of this tool’s columns each column of ' + fileName + ' holds. APIary remembers this for ' + (cfg.module || 'this tool') + ' in this browser and applies it to the next files with the same column names.'),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(160px,1fr) minmax(200px,1.4fr)', gap: '8px 16px', alignItems: 'center', maxHeight: '55vh', overflow: 'auto' } },
          fileCols.map(function (x, i) { return [h('b', x), sels[i]]; })),
        h('p.small.muted', { style: { margin: '10px 0 0' } }, 'This tool’s columns: ' + want.join(', ') + (used.length ? '. Already matching: ' + used.length + '.' : '.')),
        h('div.acts', h('button.btn.quiet', { type: 'button', onclick: function () { close(false); } }, 'Cancel'),
          h('button.btn.quiet', { type: 'button', onclick: function () { saveMap(mod, {}); close(true); } }, 'Forget the mapping'),
          h('button.btn.primary', { type: 'button', onclick: function () {
            var map = {};
            sels.forEach(function (s) { var t = s.value; if (t && normH(t) !== normH(s.dataset.col)) map[normH(s.dataset.col)] = t; });
            saveMap(mod, map); close(true);
          } }, 'Save and read the file again'))]);
    }, 'journaldlg');
    if (ok === true) loadData(raw, fileName, fileSha);
  }

  /* ---------- 2. review ---------- */
  function stepReview() {
    setStep(1);
    var by = function (k) { return items.filter(function (i) { return i.kind === k; }).length; };
    var cnt = [];
    if (by('done')) cnt.push({ n: by('done'), label: 'Already applied', kind: 'ok' });
    if (by('new')) cnt.push({ n: by('new'), label: 'New', kind: 'new' });
    if (by('upd')) cnt.push({ n: by('upd'), label: 'Updated', kind: 'upd' });
    if (by('del')) cnt.push({ n: by('del'), label: 'To delete', kind: 'bad' });
    if (by('act')) cnt.push({ n: by('act'), label: 'To send', kind: 'new' });
    cnt.push({ n: by('same'), label: 'No change' });
    if (by('skip')) cnt.push({ n: by('skip'), label: 'Skipped' });
    cnt.push({ n: by('bad'), label: 'Errors', kind: 'bad' });

    var sel = new Set();
    items.forEach(function (it) { it.__lock = !applicable(it); if (applicable(it)) sel.add(it.__k); });
    var applyBtn = UI.btn('', { kind: 'primary', icon: 'play' });
    R.applyBtn = applyBtn;
    function label() { U.swap(applyBtn, U.icon('play', 18), h('span', 'Apply ' + sel.size + ' ' + (cfg.verb || 'change') + (sel.size === 1 ? '' : 's'))); applyBtn.disabled = !sel.size; }
    var filter = 'all';
    var list = items.slice();
    var tbl = UI.table([
      { key: 'row', label: 'Row' },
      { key: 'kind', label: 'Action', render: function (it) { return UI.chip((KIND[it.kind] || {}).label || it.kind, (KIND[it.kind] || {}).chip); }, text: function (it) { return (KIND[it.kind] || {}).label; } },
      { key: 'label', label: cfg.itemLabel || 'Item', wrap: true },
      { key: 'changes', label: 'What changes', wrap: true, render: changesCell, text: function (it) { return (it.error || '') + (it.changes || []).map(function (c) { return c.field + ' ' + c.to; }).join(' '); } }
    ], list, { select: true, selected: sel, rowKey: function (it) { return it.__k; }, onSelect: label, label: 'Review' });
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
        errs.length ? errorsButton('quiet') : null,
        cfg.template && raw ? UI.btn('Map columns…', { kind: 'quiet', icon: 'columns', title: 'Your file uses other column names? Match them to this tool’s columns; APIary remembers it for this tool.', onClick: mapDialog }) : null,
        UI.btn('Choose another file', { kind: 'quiet', icon: 'back', title: 'Back to step 1 (Alt ←)', onClick: stepChoose }),
        applyBtn),
      renamed.length ? UI.note('info', null, h('span', 'Columns renamed by your saved mapping: ' + renamed.map(function (x) { return '“' + x[0] + '” → ' + x[1]; }).join(', ') + '. ',
        h('button.linkbtn', { type: 'button', onclick: mapDialog }, 'Edit mapping'))) : null,
      by('done') ? UI.note('ok', null, by('done') + ' row' + (by('done') === 1 ? ' was' : 's were') + ' applied in this run and ' + (by('done') === 1 ? 'is' : 'are') + ' locked: ' + (by('done') === 1 ? 'it is' : 'they are') + ' never sent again.') : null,
      UI.counts(cnt),
      by('upd') && cfg.blankNote ? UI.note('info', null, typeof cfg.blankNote === 'function' ? cfg.blankNote() : cfg.blankNote) : null,
      chipsBar, tbl);
  }

  /* Back to the review after a run: read Beeforce again with the same parse, keep applied rows locked. */
  async function recheck() {
    if (!file) return stepChoose();
    setStep(1);
    U.swap(body, h('div.card', h('span.spin'), '  Checking ' + fileName + ' against ' + Api.envLabel() + ' again…'));
    try { items = identify(await cfg.parse(file)); }
    catch (e) { UI.toast('Could not check again: ' + e.message + ' Showing the last review.', 'bad'); items.forEach(function (it) { if (done[it.__id]) { it.kind = 'done'; it.result = done[it.__id]; } }); }
    stepReview();
  }

  /* ---------- 3. apply ---------- */
  async function stepApply(todo) {
    todo = todo.filter(function (it) { return applicable(it) && !done[it.__id]; });   // never re-send an applied row
    var n = todo.length;
    if (!n) { UI.toast('Nothing left to apply.'); return; }
    if (readOnly()) { UI.toast(RO_TEXT, 'bad'); return; }
    var nn = todo.filter(function (i) { return i.kind === 'new'; }).length, nu = todo.filter(function (i) { return i.kind === 'upd'; }).length, nd = todo.filter(function (i) { return i.kind === 'del'; }).length;
    var parts = [];
    if (nn) parts.push(nn + ' new'); if (nu) parts.push(nu + ' update' + (nu > 1 ? 's' : '')); if (nd) parts.push(nd + ' delete' + (nd > 1 ? 's' : ''));
    var ok = await UI.confirm({ title: 'Apply ' + n + ' ' + (cfg.verb || 'change') + (n === 1 ? '' : 's') + '?', body: (parts.join(', ') || n + ' item(s)') + (cfg.module ? ' in ' + cfg.module + '.' : '.'), verb: 'Apply ' + n, danger: nd > 0, count: n });
    if (!ok) return;
    ctx.Audit.newTransaction();
    var panel = UI.runPanel('Applying ' + n + ' ' + (cfg.verb || 'change') + (n === 1 ? '' : 's') + ' to ' + Api.envLabel());
    run = { panel: panel, todo: todo, back: false };
    panel.addBack(backFromRun);
    setStep(2);
    U.swap(body, panel);
    panel.set(0, n);
    var res = await runAndRecord(panel, todo, cfg, { file: file ? { name: fileName, sha256: fileSha, rows: file.rows.length } : null });
    res.ok.forEach(function (it) { done[it.__id] = it.result; });
    var wentBack = run && run.back;
    run = null;
    panel.finish(res.ok.length + ' succeeded · ' + res.failed.length + ' failed');
    last = { todo: todo, res: res, panel: panel, items: items.slice(), undo: res.undo };
    cfg.onDone && cfg.onDone(res);
    ctx.Shell && ctx.Shell.noteRun(cfg.module, res.ok.length, res.failed.length);
    if (wentBack) return recheck();
    stepReport();
  }
  /* Paused (or running): ask, stop after the current item, then review again with applied rows locked. */
  async function backFromRun() {
    if (!run || run.back) return;
    var r = run, sent = r.todo.filter(function (it) { return it.result; }).length;
    // not UI.confirm: going back changes nothing in Beeforce, so no "This changes data in…" box
    var ok = await UI.dialog(function (box, close) {
      U.append(box, [h('h2', 'Stop and go back to the review?'),
        h('p.muted', { style: { margin: '0 0 6px' } }, 'The run stops after the item in progress. ' + sent + ' of ' + r.todo.length + ' already sent stay as they are; rows that succeeded are locked in the review and never sent again.'),
        h('p.muted', { style: { margin: 0 } }, 'Rows not sent yet go back to the review, where you can apply them again.'),
        h('div.acts', h('button.btn.quiet', { type: 'button', onclick: function () { close(false); } }, 'Keep applying'),
          h('button.btn.primary', { type: 'button', onclick: function () { close(true); } }, 'Stop and go back'))]);
    }).then(function (v) { return v === true; });
    if (!ok || run !== r) return;
    r.back = true;
    r.panel.ctrl.stopped = true; r.panel.ctrl.paused = false;
    r.panel.log('Going back to the review after the current item…', 'w');
  }

  /* Undo: the old values as an upload file, and deleting what the run created. */
  function undoButton(u) {
    var env = Api.state.env, envLabel = Api.envLabel();
    var main = UI.btn('Undo this run', { icon: 'retry', kind: 'quiet', onClick: function () { return u.rows.length ? undoFile(u, cfg.module || 'Tool', envLabel) : deleteCreated(u, cfg.module || 'Tool', env); } });
    return UI.splitBtn(main, [{ header: 'Put things back as they were' },
      u.rows.length ? { icon: 'download', label: 'Download undo file', sub: (u.records != null ? u.records : u.rows.length) + ' updated record(s): old values in this tool’s upload format. Upload it here to review the undo.', onClick: function () { return undoFile(u, cfg.module || 'Tool', envLabel); } } : null,
      u.created.length ? { icon: 'trash', label: 'Delete ' + u.created.length + ' created record' + (u.created.length === 1 ? '' : 's') + '…', sub: 'Asks first', danger: true, onClick: function () { return deleteCreated(u, cfg.module || 'Tool', env); } } : null].filter(Boolean), 'Undo this run');
  }

  /* ---------- 4. report ---------- */
  function stepReport() {
    if (!last) return;
    setStep(3);
    var res = last.res, errs = errorItems();
    if (!body.contains(last.panel)) U.swap(body, last.panel);
    Array.prototype.slice.call(body.querySelectorAll('.reportbox')).forEach(function (x) { x.remove(); });
    var rep = UI.btn('Download report', { icon: 'download', kind: 'primary', onClick: reportExcel });
    var earlier = Object.keys(done).length - res.ok.length;
    U.append(body, [h('div.reportbox',
      UI.counts([{ n: res.ok.length, label: 'Succeeded', kind: 'ok' }, { n: res.failed.length, label: 'Failed', kind: 'bad' }]),
      earlier > 0 ? UI.note('ok', null, earlier + ' more row' + (earlier === 1 ? ' was' : 's were') + ' applied earlier in this flow. The report file lists every row with its result.') : null,
      h('div.acts',
        UI.splitBtn(rep, [{ header: 'Every row with its result' },
          { icon: 'download', label: 'Excel (.xlsx)', right: 'default', onClick: function () { UI.busy(rep, reportExcel); } },
          { icon: 'download', label: 'CSV (.csv)', onClick: reportCsv }], 'Download report'),
        errs.length ? errorsButton('') : null,
        res.failed.length ? UI.btn('Retry ' + res.failed.length + ' failed', { icon: 'retry', onClick: function () { stepApply(res.failed.slice()); } }) : null,
        last.undo ? undoButton(last.undo) : null,
        UI.btn('Back to review', { kind: 'quiet', icon: 'back', title: 'Check the file against ' + Api.envLabel() + ' again; applied rows stay locked (Alt ←)', onClick: recheck }),
        UI.btn('Start over', { kind: 'quiet', icon: 'upload', onClick: function () { items = []; file = null; done = {}; last = null; stepChoose(); } })),
      h('p.small.muted', { style: { margin: '8px 0 0' } }, 'This run is saved in the run journal (user menu → Run journal).'))]);
  }

  stepChoose();
  el.reset = function () { items = []; file = null; done = {}; last = null; stepChoose(); };
  return el;
}

/* Alt ← / Alt → step through the visible flow (registered once per page; the latest load handles it). */
window.__bftFlowKey = function (e) {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
  var app = ctx.appEl;
  if (!app || !app.isConnected || app.classList.contains('min') || app.querySelector('.scrim') || (UI.menuOpen && UI.menuOpen())) return;
  var path = e.composedPath ? e.composedPath() : [];
  if (path.some(function (n) { return n && n.nodeType === 1 && (/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName) || n.isContentEditable); })) return;
  var flow = Array.prototype.filter.call(app.querySelectorAll('.work.on .page:not([hidden]) .flow'), function (f) { return f.offsetParent; })[0];
  if (!flow || !flow.stepKey) return;
  e.preventDefault(); e.stopPropagation();
  flow.stepKey(e.key === 'ArrowLeft' ? -1 : 1);
};
if (!window.__bftFlowKeyOn) { window.__bftFlowKeyOn = true; document.addEventListener('keydown', function (e) { if (window.__bftFlowKey) window.__bftFlowKey(e); }, true); }

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
    // the Error / Stage / Row in file columns of a v3.9 error file are expected extras: ignored without a message
    var unknown = fileCols.filter(function (c) { return ERR_COLS.indexOf(c) < 0 && !Object.keys(colMap).some(function (k) { return colMap[k] === c; }); });

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
          it.kind = 'upd'; it.payload = p; it.before = before; it.undoCols = H;
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
    var holder = h('div', UI.skeleton('Loading ' + noun + 's from ' + Api.envLabel() + '…'));
    U.append(bodyEl, [holder]);
    async function draw(force) {
      var refs = await loadRefs();
      var recs = await loadList(force);
      var H = hdrs(refs);
      var show = [{ key: 'id', label: 'Id' }].concat(cfg.browse || H.slice(1, 7).map(function (k) { return { key: k, label: k.replace(/\s*\(.*\)/, '') }; }));
      var rows = recs.map(function (r) { var f = cfg.flatten(r, refs); f.id = r.id; f.__rec = r; return f; });
      var delBtn = UI.btn('Delete selected', { icon: 'trash', kind: 'quiet', sm: true });
      delBtn.disabled = true;
      var canDel = cfg.canDelete !== false && !readOnly();
      var tbl = UI.table(show, rows, {
        select: canDel, rowKey: function (r) { return String(r.id); }, label: cap(noun) + 's',
        rowMenu: function (r) {
          var id = String(r.id), name = cfg.labelOf ? cfg.labelOf(r) : id;
          return [{ header: name + ' · id ' + id },
            { icon: 'copy', label: 'Copy id', onClick: function () { UI.copy(id, 'Id'); } },
            { icon: 'code', label: 'Show JSON', sub: 'As read from ' + Api.envLabel(), onClick: function () { UI.codeDialog(cap(noun) + ' ' + id + ' · JSON', JSON.stringify(r.__rec, null, 2), { what: 'JSON', filename: mod.replace(/\W+/g, '_').toLowerCase() + '_' + id + '.json', mime: 'application/json', note: 'Read from ' + Api.envLabel() + '. Copying or downloading sends nothing.' }); } },
            canDel ? 'hr' : null,
            canDel ? { icon: 'trash', label: 'Delete…', danger: true, onClick: function () { runDeletes([{ kind: 'del', ref: id, label: name + ' (id ' + id + ')', run: function () { return remove(id); } }], mod, noun).then(function (x) { if (x) draw(true); }); } } : null];
        },
        onSelect: function (s) { delBtn.disabled = !s.size; U.swap(delBtn, U.icon('trash', 16), h('span', s.size ? 'Delete ' + s.size : 'Delete selected')); },
        toolbar: [
          UI.btn('Refresh', { icon: 'retry', sm: true, kind: 'quiet', onClick: function () { return draw(true); } }),
          exportButton(function () { return template(true); }),
          canDel ? delBtn : null
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

  var flowEl = null, tabsEl;
  var cmp = cfg.compare ? compareTab(Object.assign({ module: mod, noun: noun, openUpload: function (rd, name) { tabsEl.open('upload'); if (flowEl) flowEl.loadData(rd, name); } }, cfg.compare)) : null;
  view.appendChild(tabsEl = UI.tabs([
    { id: 'upload', label: 'Create / update', render: function (b) { b.appendChild(flowEl = uploadFlow({ module: mod, removeEp: cfg.removeEp, template: function () { return template(false); }, parse: parse, errorRows: true, csv: true, itemLabel: cap(noun), blankNote: function () { return 'Columns that are missing or left blank keep their current value in ' + Api.envLabel() + '. To empty a value, type CLEAR in the cell.'; }, intro: cfg.intro || 'Leave the id blank to create a new ' + noun + '. Fill the id to update an existing one. Tip: use “Export for editing” in Browse to get current data in this format.', reportCols: cfg.reportCols })); } },
    { id: 'browse', label: 'Browse & export', render: browse }
  ].concat(cmp ? [cmp] : [], cfg.extraTabs || [])));
}

/* Confirm + run deletes, shown in a dialog with progress. Returns the results or null if cancelled. */
async function runDeletes(todo, mod, noun) {
  if (!todo.length) return null;
  if (readOnly()) { UI.toast(RO_TEXT, 'bad'); return null; }
  var list = h('div.muted.small', { style: { maxHeight: '140px', overflow: 'auto' } }, todo.slice(0, 40).map(function (t) { return h('div', '• ' + t.label); }), todo.length > 40 ? h('div', '… and ' + (todo.length - 40) + ' more') : null);
  var ok = await UI.confirm({ title: 'Delete ' + todo.length + ' ' + noun + (todo.length > 1 ? 's' : '') + '?', body: h('div', h('p.muted', 'This cannot be undone.'), list), verb: 'Delete ' + todo.length, danger: true, count: todo.length });
  if (!ok) return null;
  ctx.Audit.newTransaction();
  var res;
  await UI.dialog(function (box, close) {
    var panel = UI.runPanel('Deleting from ' + Api.envLabel());
    var done = UI.btn('Close', { kind: 'primary' }); done.disabled = true; done.onclick = function () { close(true); };
    U.append(box, [h('h2', 'Deleting ' + noun + 's'), panel, h('div.acts', done)]);
    panel.set(0, todo.length);
    runAndRecord(panel, todo, { module: mod }, { kind: 'delete' }).then(function (r) {
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


/* ---------- run journal screen (user menu → Run journal, or search "journal") ---------- */
function when(iso) { var d = new Date(iso); return isNaN(d) ? iso : d.getFullYear() + '-' + U.pad(d.getMonth() + 1) + '-' + U.pad(d.getDate()) + ' ' + U.pad(d.getHours()) + ':' + U.pad(d.getMinutes()); }
function runExcel(r) {
  var sum = [['When', when(r.at)], ['Tool', r.tool], ['What', r.kind === 'delete' ? 'Delete' : 'Apply'], ['Environment', r.envLabel], ['Signed in as', r.user], ['Site', r.host], ['APIary', r.version],
    ['File', r.file ? r.file.name : ''], ['File SHA-256', r.file ? r.file.sha256 || '' : ''], ['Rows in file', r.file ? r.file.rows : ''],
    ['Sent', r.sent], ['Succeeded', r.ok], ['Failed', r.failed], ['Undo data', r.undo ? 'yes' : 'no']];
  return X.download('apiary_run_' + r.id + '_' + String(r.tool).replace(/\W+/g, '_').toLowerCase() + '.xlsx', [
    { name: 'Summary', headers: ['Field', 'Value'], rows: sum },
    { name: 'Items', headers: ['Row', 'Action', 'Item', 'Result', 'HTTP', 'Message', 'New id'], rows: r.items.map(function (i) { return [i.row, (KIND[i.kind] || {}).label || i.kind, i.label, i.ok ? 'OK' : 'Failed', i.status, i.msg, i.id]; }) },
    { name: 'Requests', headers: ['Time', 'Method', 'Path', 'Query', 'HTTP', 'ms', 'Request body', 'Response'], rows: r.calls.map(function (c) { return [new Date(c.at).toISOString(), c.m, c.p, c.q ? JSON.stringify(c.q) : '', c.status, c.ms, c.req || '', c.res || '']; }) }]);
}
function runJson(r) { UI.saveText('apiary_run_' + r.id + '.json', JSON.stringify(r, null, 2), 'application/json'); }
function runMenu(r, redraw) {
  return [{ header: r.tool + ' · ' + when(r.at) },
    { icon: 'eye', label: 'Details', onClick: function () { runDetails(r, redraw); } },
    { icon: 'download', label: 'Download (Excel)', sub: 'Summary, items, requests', onClick: function () { runExcel(r); } },
    { icon: 'code', label: 'Download (JSON)', onClick: function () { runJson(r); } },
    r.undo && r.undo.rows.length ? { icon: 'retry', label: 'Download undo file', sub: r.undo.rows.length + ' old value row(s), ' + r.envLabel, onClick: function () { undoFile(r.undo, r.tool, r.envLabel); } } : null,
    r.undo && r.undo.created.length ? { icon: 'trash', label: 'Delete ' + r.undo.created.length + ' created record' + (r.undo.created.length === 1 ? '' : 's') + '…', danger: true, onClick: function () { deleteCreated(r.undo, r.tool, r.env).then(function (x) { if (x) redraw(); }); } } : null,
    'hr',
    { icon: 'trash', label: 'Remove from journal', onClick: function () { Journal.del(r.id).then(redraw); } }].filter(Boolean);
}
function runDetails(r, redraw) {
  return UI.dialog(function (box, close) {
    box.classList.add('wide');
    var items = UI.table([{ key: 'row', label: 'Row' }, { key: 'kind', label: 'Action', text: function (i) { return (KIND[i.kind] || {}).label || i.kind; } }, { key: 'label', label: 'Item', wrap: true },
      { key: 'ok', label: 'Result', render: function (i) { return UI.chip(i.ok ? 'OK' : 'Failed', i.ok ? 'ok' : 'bad'); }, text: function (i) { return i.ok ? 'OK' : 'Failed'; } }, { key: 'msg', label: 'Message', wrap: true }, { key: 'id', label: 'New id' }],
      r.items, { label: 'Items', rowKey: function (i, n) { return String(n); }, search: true });
    var calls = UI.table([{ key: 'm', label: 'Method' }, { key: 'p', label: 'Path', wrap: true }, { key: 'status', label: 'HTTP' }, { key: 'ms', label: 'ms' }],
      r.calls.map(function (c, n) { c.__n = n; return c; }), { label: 'Requests', rowKey: function (c) { return String(c.__n); }, search: true,
        rowMenu: function (c) { return [{ icon: 'code', label: 'Show request and response', onClick: function () { UI.codeDialog(c.m + ' ' + c.p, 'Request body:\n' + (c.req || '(none)') + '\n\nResponse (HTTP ' + c.status + '):\n' + (c.res || '(empty)'), { what: 'text' }); } }]; } });
    U.append(box, [h('h2', r.tool + ' · ' + when(r.at)),
      UI.kv({ Environment: r.envLabel, 'Signed in as': r.user, File: r.file ? r.file.name + (r.file.sha256 ? ' · SHA-256 ' + r.file.sha256.slice(0, 16) + '…' : '') : '—', Result: r.ok + ' succeeded · ' + r.failed + ' failed of ' + r.sent }),
      h('div.label', 'Items'), items, h('div.label', 'Requests (' + r.calls.length + ')'), calls,
      h('div.acts', UI.btn('Download (Excel)', { icon: 'download', onClick: function () { return runExcel(r); } }),
        r.undo && r.undo.rows.length ? UI.btn('Download undo file', { icon: 'retry', onClick: function () { return undoFile(r.undo, r.tool, r.envLabel); } }) : null,
        h('span', { style: { flex: 1 } }), h('button.btn.primary', { type: 'button', onclick: function () { close(true); } }, 'Close'))]);
  }, 'journaldlg');
}
function openJournal() {
  return UI.dialog(function (box, close) {
    box.classList.add('wide');
    var holder = h('div', UI.skeleton('Reading the run journal…'));
    U.append(box, [h('h2', 'Run journal'),
      h('p.muted', { style: { margin: '0 0 10px' } }, 'Every run from this browser on ' + location.host + ': who, where, the file, every request and its result. The newest 300 runs are kept. Nothing leaves this browser unless you download it.'),
      holder, h('div.acts', h('button.btn.primary', { type: 'button', onclick: function () { close(true); } }, 'Close'))]);
    function draw() {
      return Journal.all().then(function (list) {
        if (!list.length) return U.swap(holder, UI.empty('No runs yet. Every Apply and Delete from now on is recorded here.'));
        var tbl = UI.table([
          { key: 'at', label: 'When', text: function (r) { return when(r.at); }, render: function (r) { return when(r.at); } },
          { key: 'tool', label: 'Tool' }, { key: 'envLabel', label: 'Environment' }, { key: 'user', label: 'By' },
          { key: 'file', label: 'File', text: function (r) { return r.file ? r.file.name : r.kind === 'delete' ? '(delete)' : ''; }, render: function (r) { return r.file ? r.file.name : r.kind === 'delete' ? h('span.muted', 'Delete') : ''; } },
          { key: 'ok', label: 'OK', num: true }, { key: 'failed', label: 'Failed', num: true },
          { key: 'undo', label: 'Undo', text: function (r) { return r.undo ? 'yes' : ''; }, render: function (r) { return r.undo ? UI.chip('Undo', 'upd') : ''; } }
        ], list, { label: 'Run journal', rowKey: function (r) { return String(r.id); }, rowMenu: function (r) { return runMenu(r, draw); },
          toolbar: [UI.btn('Download all (JSON)', { icon: 'download', sm: true, kind: 'quiet', onClick: function () { UI.saveText('apiary_journal_' + U.stamp() + '.json', JSON.stringify(list, null, 2), 'application/json'); } }),
            UI.btn('Clear journal', { icon: 'trash', sm: true, kind: 'quiet', onClick: function () {
              UI.dialog(function (b2, c2) { U.append(b2, [h('h2', 'Clear the run journal?'), h('p.muted', 'All ' + list.length + ' recorded runs are removed from this browser. Beeforce is not touched.'),
                h('div.acts', h('button.btn.quiet', { type: 'button', onclick: function () { c2(false); } }, 'Cancel'), h('button.btn.danger', { type: 'button', onclick: function () { c2(true); } }, 'Clear journal'))]); })
                .then(function (v) { if (v === true) Journal.clear().then(draw); });
            } })] });
        U.swap(holder, tbl);
      }).catch(function (e) { U.swap(holder, UI.note('bad', 'Could not read the run journal', e.message)); });
    }
    draw();
  }, 'journaldlg');
}

/* =========================================================
 * Compare with the other environment (v3.13). A second, read-only sign-in to the other environment is kept in memory
 * for this page only (never saved). While APIary reads the other environment, every write is blocked and a 401 does
 * not open the normal sign-in prompt. The same Beeforce sign-in request is used (Api.signIn); the main session is
 * restored right after it.
 * ========================================================= */
var OTHER = null;   // { env, base, token, issued, user } of the other environment
function otherEnv() { return Api.state.env === 'uat' ? 'production' : 'uat'; }
function envName(env) { return (ctx.CONFIG.ENVIRONMENTS[env] || {}).label || env; }
function otherReady() { return !!(OTHER && OTHER.env === otherEnv() && Api.minutesLeft(OTHER) > 2); }
function signInOther() {
  var env = otherEnv(), label = envName(env);
  return UI.dialog(function (box, close) {
    var user = UI.input({ placeholder: 'Beeforce username', value: (OTHER && OTHER.user) || Api.state.user || '' }); user.autocomplete = 'username';
    var pass = UI.input({ type: 'password', placeholder: 'Password' }); pass.autocomplete = 'current-password';
    var err = h('div.err', { role: 'alert' });
    var go = h('button.btn.primary', { type: 'submit' }, 'Sign in to ' + label);
    var form = h('form', { novalidate: true }, h('h2', 'Read ' + label),
      h('p.muted', { style: { margin: '0 0 12px' } }, 'A read-only sign-in for comparing. It stays on this page until APIary is closed and is never used to write. You stay signed in to ' + Api.envLabel() + '.'),
      UI.field('Username', user), UI.field('Password', pass), err,
      h('div.acts', h('button.btn.quiet', { type: 'button', onclick: function () { close(false); } }, 'Cancel'), go));
    form.addEventListener('submit', async function (e) {
      e.preventDefault(); err.textContent = '';
      if (!user.value.trim() || !pass.value) { err.textContent = 'Enter your username and password.'; return; }
      go.disabled = true;
      var keep = Object.assign({}, Api.state), saved = null;
      try { saved = sessionStorage.getItem('bft.session'); } catch (x) {}
      try {
        await Api.signIn(env, user.value.trim(), pass.value);
        OTHER = { env: Api.state.env, base: Api.state.base, token: Api.state.token, issued: Api.state.issued, user: Api.state.user };
        Object.assign(Api.state, keep); try { if (saved != null) sessionStorage.setItem('bft.session', saved); } catch (x) {}
        pass.value = '';
        close(true);
      } catch (ex) {
        Object.assign(Api.state, keep); try { if (saved != null) sessionStorage.setItem('bft.session', saved); } catch (x) {}
        err.textContent = ex.message; go.disabled = false;
      }
    });
    U.append(box, [form]);
    setTimeout(function () { (user.value ? pass : user).focus(); }, 60);
  }).then(function (v) { return v === true; });
}
/* Run fn with the other environment's session. Writes are refused; the main session comes back afterwards. */
async function withOther(fn) {
  if (!otherReady()) throw new Error('Sign in to ' + envName(otherEnv()) + ' first.');
  var keep = Object.assign({}, Api.state), orig = Api.call;
  Object.assign(Api.state, OTHER);
  Api.setReauth(null);
  Api.call = function (method) {
    if (method !== 'GET') return Promise.resolve({ ok: false, status: 0, data: null, text: 'Blocked: ' + OTHER.env + ' is read-only in Compare.' });
    return orig.apply(this, arguments).then(function (r) { if (r && r.status === 401) OTHER.issued = 0; return r; });
  };
  try { return await fn(); }
  finally { Api.call = orig; Object.assign(Api.state, keep); if (ctx.Shell && ctx.Shell.reauth) Api.setReauth(ctx.Shell.reauth); }
}
function cmpKey(v) { return X.str(v).toLowerCase(); }

/* compareTab(cfg) — a "Compare" tab for a tool.
 *  cfg.module, cfg.noun, cfg.keyLabel, cfg.headers (upload headers; first = id)
 *  cfg.load()            → { rows: [{ header: value }], ctx }   rows as shown/compared (references as codes)
 *  cfg.keyOf(row)        → natural key that is the same in both environments (e.g. the code)
 *  cfg.fields            → headers compared (default: all but the id)
 *  cfg.toUpload(row, target) → { row } or { error }: a row for the target's upload, ids translated (target = load() result + byKey)
 *  cfg.openUpload(rd, name)  → hand a prepared file to the tool's Create / update flow */
function compareTab(cfg) {
  return { id: 'compare', label: 'Compare', render: function (b) {
    var here = h('div');
    b.appendChild(here);
    var other = envName(otherEnv()), cur = Api.envLabel();
    function intro() {
      U.swap(here,
        UI.note('info', 'Compare ' + cur + ' with ' + other, 'Reads both environments and lists what is only in one, and what differs. Nothing is written. ' +
          'You can then review copying the ' + other + ' values into ' + cur + ' (the normal review and Apply), or download a file to upload in ' + other + '.'),
        h('div.row', otherReady() ? UI.btn('Compare now', { kind: 'primary', icon: 'play', onClick: run }) : UI.btn('Sign in to ' + other + ' (read only)', { kind: 'primary', icon: 'key', onClick: function () { return signInOther().then(function (ok) { if (ok) run(); }); } }),
          otherReady() ? h('span.muted.small', 'Reading ' + other + ' as ' + OTHER.user) : null));
    }
    async function run() {
      U.swap(here, UI.skeleton('Reading ' + cur + ' and ' + other + '…'));
      var A, B;
      try {
        A = await cfg.load();
        B = await withOther(function () { return cfg.load(); });
      } catch (e) { U.swap(here, UI.note('bad', 'Could not compare', e.message), h('div.row', UI.btn('Try again', { icon: 'retry', onClick: run }), UI.btn('Sign in to ' + other + ' again', { kind: 'quiet', icon: 'key', onClick: function () { OTHER = null; intro(); } }))); return; }
      function index(side) { side.byKey = {}; side.rows.forEach(function (r) { var k = cmpKey(cfg.keyOf(r)); if (k) side.byKey[k] = r; }); return side; }
      index(A); index(B);
      var HA = A.headers || cfg.headers, HB = B.headers || cfg.headers;
      var fields = cfg.fields || HA.slice(1).concat(HB.slice(1)).filter(function (k, i, a) { return a.indexOf(k) === i; });
      var keys = Object.keys(A.byKey).concat(Object.keys(B.byKey)).filter(function (k, i, a) { return a.indexOf(k) === i; }).sort();
      var rows = keys.map(function (k) {
        var a = A.byKey[k], o = B.byKey[k];
        var r = { __k: k, key: cfg.keyOf(a || o), here: a, there: o };
        if (!a) { r.status = 'only-there'; r.what = 'Not in ' + cur; }
        else if (!o) { r.status = 'only-here'; r.what = 'Not in ' + other; }
        else {
          r.diff = fields.filter(function (f) { return !same(a[f] == null ? '' : a[f], o[f] == null ? '' : o[f]); });
          r.status = r.diff.length ? 'diff' : 'same';
          r.what = r.diff.map(function (f) { return f + ': ' + fmtv(a[f]) + ' → ' + fmtv(o[f]); }).join(' · ');
        }
        r.__lock = r.status === 'same' || r.status === 'only-here';
        return r;
      });
      var n = function (s) { return rows.filter(function (r) { return r.status === s; }).length; };
      var LBL = { 'only-there': 'Only in ' + other, 'only-here': 'Only in ' + cur, diff: 'Different', same: 'Same' };
      var CH = { 'only-there': 'new', 'only-here': '', diff: 'upd', same: 'ok' };
      var sel = new Set(rows.filter(function (r) { return !r.__lock; }).map(function (r) { return r.__k; }));
      var copyBtn = UI.btn('', { kind: 'primary', icon: 'play' });
      function lbl() { U.swap(copyBtn, U.icon('play', 16), h('span', 'Review copying ' + sel.size + ' into ' + cur)); copyBtn.disabled = !sel.size; }
      var tbl = UI.table([
        { key: 'key', label: cfg.keyLabel || 'Key' },
        { key: 'status', label: 'Status', render: function (r) { return UI.chip(LBL[r.status], CH[r.status]); }, text: function (r) { return LBL[r.status]; } },
        { key: 'what', label: 'What differs (' + cur + ' → ' + other + ')', wrap: true }
      ], rows, { select: true, selected: sel, rowKey: function (r) { return r.__k; }, onSelect: lbl, label: 'Comparison' });
      function build(direction) {
        // direction 'here': copy the other environment's values into this one; 'there': the reverse, as a file
        var src = direction === 'here' ? B : A, tgt = direction === 'here' ? A : B;
        var pick = rows.filter(function (r) { return direction === 'here' ? sel.has(r.__k) : (r.status === 'only-here' || r.status === 'diff'); });
        var out = [], errs = [];
        pick.forEach(function (r, i) {
          var s = src.byKey[r.__k]; if (!s) return;
          var res = cfg.toUpload(s, tgt);
          if (res.error) { errs.push(r.key + ': ' + res.error); return; }
          // a value that is empty in the source but set in the target must be cleared, not kept
          (r.diff || []).forEach(function (f) { if (X.str(res.row[f]) === '' && tgt.byKey[r.__k] && X.str(tgt.byKey[r.__k][f]) !== '') res.row[f] = 'CLEAR'; });
          res.row.__row = out.length + 2; out.push(res.row);
        });
        return { rd: { headers: (tgt.headers || cfg.headers).slice(), rows: out, sheetNames: ['Compare'], fileName: 'compare' }, errs: errs };
      }
      copyBtn.onclick = function () {
        var x = build('here');
        if (x.errs.length) UI.toast(x.errs.length + ' row(s) left out: ' + x.errs.slice(0, 3).join('; ') + (x.errs.length > 3 ? '…' : ''), 'warn');
        if (!x.rd.rows.length) return;
        cfg.openUpload(x.rd, 'Compare: ' + other + ' → ' + cur);
      };
      function sheetOf(x) { return { name: 'Upload', headers: x.rd.headers, rows: x.rd.rows.map(function (r) { return x.rd.headers.map(function (k) { return X.fmt(r[k] == null ? '' : r[k]); }); }), tabColor: '0B5CC7' }; }
      var dl = UI.btn('Download', { icon: 'download' });
      var split = UI.splitBtn(dl, [{ header: 'Files' },
        { icon: 'download', label: 'Comparison (Excel)', right: 'default', onClick: function () { UI.busy(dl, cmpExcel); } },
        { icon: 'download', label: 'Upload file for ' + cur, sub: 'Selected rows, ' + other + ' values', onClick: function () { var x = build('here'); return X.download(String(cfg.module).replace(/\W+/g, '_').toLowerCase() + '_for_' + Api.state.env + '_' + U.stamp() + '.xlsx', [sheetOf(x)]); } },
        { icon: 'download', label: 'Upload file for ' + other, sub: 'Rows only in or different in ' + cur + '; upload it after signing in to ' + other, onClick: function () { var x = build('there'); if (x.errs.length) UI.toast(x.errs.length + ' row(s) left out: ' + x.errs.slice(0, 3).join('; '), 'warn'); return X.download(String(cfg.module).replace(/\W+/g, '_').toLowerCase() + '_for_' + otherEnv() + '_' + U.stamp() + '.xlsx', [sheetOf(x)]); } }], 'Download');
      dl.onclick = function () { UI.busy(dl, cmpExcel); };
      function cmpExcel() {
        var H = [cfg.keyLabel || 'Key', 'Status'], F = fields;
        var hdr = H.concat(F.map(function (f) { return f + ' (' + cur + ')'; }), F.map(function (f) { return f + ' (' + other + ')'; }));
        return X.download(String(cfg.module).replace(/\W+/g, '_').toLowerCase() + '_compare_' + U.stamp() + '.xlsx', [{ name: 'Compare', headers: hdr,
          rows: rows.map(function (r) { return [r.key, LBL[r.status]].concat(F.map(function (f) { return r.here ? X.fmt(r.here[f]) : ''; }), F.map(function (f) { return r.there ? X.fmt(r.there[f]) : ''; })); }) }]);
      }
      lbl();
      U.swap(here,
        UI.counts([{ n: n('only-there'), label: 'Only in ' + other, kind: 'new' }, { n: n('diff'), label: 'Different', kind: 'upd' }, { n: n('only-here'), label: 'Only in ' + cur }, { n: n('same'), label: 'Same', kind: 'ok' }]),
        h('div.row', { style: { margin: '6px 0 4px' } }, copyBtn, split, UI.btn('Compare again', { kind: 'quiet', icon: 'retry', onClick: run }), h('span.muted.small', 'Reading ' + other + ' as ' + OTHER.user)),
        UI.note('info', null, 'Ticked rows: ' + other + ' values go into ' + cur + ' through the normal review — new ones are created, different ones updated. Nothing is sent before you press Apply there.'),
        tbl);
    }
    if (otherReady()) run(); else intro();
  } };
}

ctx.CSS += '\n' + [
  '.dlg.wide{width:min(1100px,96vw);max-height:90vh;overflow:auto}',
  '.dlg.wide .twrap{max-height:42vh}',
  '.guard{margin:12px 0}.guard label{display:block;margin:0 0 6px}.guard .input{max-width:260px;font-family:var(--mono);letter-spacing:.06em}',
  '.app.ro .btn.delsel{display:none}',
  '.app.ro .envpill::after{content:"Read only";margin-left:8px;padding:1px 6px;border:1px solid currentColor;border-radius:3px;font-size:11px;font-weight:600;opacity:.85}'
].join('\n');

ctx.Engine = { ERR_COLS: ERR_COLS, exportButton: exportButton, runQueue: runQueue, uploadFlow: uploadFlow, entity: entity, runDeletes: runDeletes, reportSheet: reportSheet, applicable: applicable, same: same,
  Journal: Journal, openJournal: openJournal, runAndRecord: runAndRecord, capture: capture, captureSheets: captureSheets, fileHash: fileHash, compareTab: compareTab, withOther: withOther, undoFile: undoFile,
  readOnly: readOnly, readOnlyNote: readOnlyNote, guardSettings: guardSettings, GUARD_DEFAULT: GUARD_DEFAULT, READ_POSTS: READ_POSTS };
