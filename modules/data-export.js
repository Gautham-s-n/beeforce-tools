/* modules/data-export.js — Data Export (v3.15): pull setup data from Beeforce to Excel or CSV, read only.
 *
 * The datasets are the list calls already in the endpoint registry (core/endpoints.js): every GET without a
 * placeholder, once per path (the same list is often registered by several tools as a reference).
 * Each dataset is read with its registry method, path and query — the same request the tools make. "All pages" adds
 * page / size and follows the pages, like the API explorer.
 *
 * Saved sets (bft.extractions): a named selection of datasets (and the All pages choice), kept in this browser.
 * Nothing is written to Beeforce. The tool is meant for colleagues with a read-only role as much as for admins. */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api;
var MOD = 'Data Export';
var MAX_PAGES = 500, PAGE_SIZE = 200, MAX_CELL = 32000, SKEY = 'extractions';

function toolName(t) { return (ctx.DEFAULT_TOOLS[t] || {}).name || t; }
function cleanLabel(l) { return String(l || '').replace(/\s*\([^)]*\)\s*$/, '').replace(/^List\s+/i, '').replace(/^./, function (c) { return c.toUpperCase(); }); }

/* Distinct GET list calls from the registry, one per path (trailing slash ignored). When tools read the same path
 * with different queries, the fullest one is used (projection=FULL), else the first registered. Calls that look up
 * one record ("Get …", "Find …") need values from a row, so they are left out. */
function datasets() {
  var byPath = {}, out = [];
  ctx.EP.all().forEach(function (e) {
    if (e.method !== 'GET' || e.off || /\{[a-zA-Z]+\}/.test(e.path) || /^(get|find)\b/i.test(e.label || '')) return;
    var sig = e.path.replace(/\/+$/, '');
    var full = !!(e.query && e.query.projection === 'FULL');
    var d = byPath[sig];
    if (d) {
      d.tools.push(e.tool);
      if (full && !d.full) { d.key = d.id = e.key; d.path = e.path; d.query = e.query; d.full = true; }
      return;
    }
    d = byPath[sig] = { id: e.key, key: e.key, name: cleanLabel(e.label || e.key), path: e.path, query: e.query || null, tools: [e.tool], full: full };
    out.push(d);
  });
  out.forEach(function (d) { d.usedBy = d.tools.filter(function (t, i, a) { return a.indexOf(t) === i; }).map(toolName).join(', '); });
  var byName = {}; out.forEach(function (d) { (byName[d.name] = byName[d.name] || []).push(d); });
  Object.keys(byName).forEach(function (n) { if (byName[n].length > 1) byName[n].forEach(function (d) { d.name = n + ' · ' + d.path.replace(/^\/api\/(attendance\/)?/, '').replace(/\/+$/, ''); }); });
  return out.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0; });
}

/* ---------- reading ---------- */
async function readOne(d, allPages, stopped) {
  if (!allPages) {
    var r = await ctx.EP.call(d.key, null, { module: MOD });
    if (!r.ok) throw new Error(ctx.Engine.plainError(r.status, r.text));
    return { data: r.data, pages: 1 };
  }
  var all = [], prevFirst = null, n = 0, page = 0, last = null;
  for (; n < MAX_PAGES; n++, page++) {
    if (stopped && stopped()) break;
    last = await ctx.EP.call(d.key, null, { module: MOD, query: { page: page, size: PAGE_SIZE } });
    if (!last.ok) { if (!n) throw new Error(ctx.Engine.plainError(last.status, last.text)); break; }
    var data = last.data, items = Array.isArray(data) ? data : Api.asList(data);
    var first = items.length ? JSON.stringify(items[0]) : null;
    if (n && first && first === prevFirst) break;   // the endpoint ignores paging
    prevFirst = first;
    all = all.concat(items);
    var isLast = !items.length || items.length < PAGE_SIZE || (data && !Array.isArray(data) && (data.last === true || (data.totalPages != null && page + 1 >= data.totalPages)));
    if (isLast) { n++; break; }
  }
  return { data: all, pages: n };
}

/* ---------- JSON → table ---------- */
function cellOf(v) {
  if (v == null) return '';
  if (typeof v === 'object') { var t = JSON.stringify(v); return t.length > MAX_CELL ? t.slice(0, MAX_CELL) + '…' : t; }
  if (typeof v === 'string' && v.length > MAX_CELL) return v.slice(0, MAX_CELL) + '…';
  return v;
}
function flat(o, prefix, out, depth) {
  Object.keys(o).forEach(function (k) {
    var v = o[k], key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 3 && Object.keys(v).length) flat(v, key, out, depth + 1);
    else out[key] = cellOf(v);
  });
  return out;
}
function toTable(data) {
  var list = Array.isArray(data) ? data : Api.asList(data);
  if (!list.length && data && typeof data === 'object' && !Array.isArray(data)) {
    var f = flat(data, '', {}, 0);
    return { headers: ['Field', 'Value'], rows: Object.keys(f).map(function (k) { return [k, f[k]]; }), count: 1 };
  }
  var rows = list.map(function (x) { return x && typeof x === 'object' && !Array.isArray(x) ? flat(x, '', {}, 0) : { value: cellOf(x) }; });
  var headers = [];
  rows.forEach(function (r) { Object.keys(r).forEach(function (k) { if (headers.indexOf(k) < 0) headers.push(k); }); });
  // id, code and name first: the columns people look for
  var lead = ['id', 'code', 'name', 'description'].filter(function (k) { return headers.indexOf(k) >= 0; });
  headers = lead.concat(headers.filter(function (k) { return lead.indexOf(k) < 0; }));
  return { headers: headers.length ? headers : ['value'], rows: rows.map(function (r) { return headers.map(function (k) { return r[k] === undefined ? '' : r[k]; }); }), count: list.length };
}
function sheetName(name, used) {
  var base = String(name).replace(/[\\\/?*\[\]:]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 31) || 'Data', n = base, i = 2;
  while (used[n.toLowerCase()]) { var suf = ' (' + i++ + ')'; n = base.slice(0, 31 - suf.length) + suf; }
  used[n.toLowerCase()] = 1;
  return n;
}
function fileStem() { return 'apiary_data_' + (Api.state.env || 'env') + '_' + U.stamp(); }

/* ---------- saved sets (this browser) ---------- */
function savedSets() { var l = U.store.get(SKEY, []); return Array.isArray(l) ? l.filter(function (x) { return x && typeof x.name === 'string' && Array.isArray(x.keys); }) : []; }
function saveSets(l) { return U.store.set(SKEY, l); }

/* ---------- look up one employee (v3.16): the lookup forms of core/engine.js ---------- */
function lookupCard() {
  var E = ctx.Engine, L = E.LOOKUPS;
  var empKey = Object.keys(L).filter(function (k) { return L[k].title === 'Employee by employee number' && (function () { try { return !ctx.EP.get(k).off; } catch (e) { return false; } })(); })[0];
  var choices = [['timecard-update.timecards', L['timecard-update.timecards']], ['accrual-balances.balances', L['accrual-balances.balances']]].concat(empKey ? [[empKey, L[empKey]]] : [])
    .filter(function (c) { try { return !ctx.EP.get(c[0]).off; } catch (e) { return false; } });
  var sel = UI.select(choices.map(function (c) { return { value: c[0], label: c[1].title }; }), choices.length ? choices[0][0] : '');
  sel.setAttribute('aria-label', 'What to look up'); sel.style.maxWidth = '320px';
  var fieldsBox = h('div'), out = h('div'), lk = null;
  function drawFields() { lk = E.lookupFields(L[sel.value]); U.swap(fieldsBox, lk.el); U.swap(out); }
  sel.addEventListener('change', drawFields);
  async function run(kind) {
    var key = sel.value, spec = L[key];
    U.swap(out, h('div.card', h('span.spin'), ' Reading ' + spec.title.toLowerCase() + ' from ' + Api.envLabel() + '…'));
    try {
      var v = lk.values(), q = await E.lookupQuery(key, v, MOD);
      var r = await ctx.EP.call(key, null, { module: MOD, query: q });
      if (!r.ok) throw new Error(E.plainError(r.status, r.text));
      var stem = 'apiary_' + key.split('.').pop() + '_' + String(v.emp || '').replace(/\W+/g, '') + '_' + (Api.state.env || 'env') + '_' + U.stamp();
      if (kind === 'json') UI.saveText(stem + '.json', JSON.stringify(r.data, null, 2), 'application/json');
      else {
        var t = toTable(r.data), sheet = { name: sheetName(spec.title, {}), headers: t.headers, rows: t.rows, tabColor: '0B5CC7' };
        if (kind === 'csv') X.downloadCsv(stem + '.csv', sheet);
        else await X.download(stem + '.xlsx', [sheet, { name: 'About', headers: ['Field', 'Value'], rows: spec.fields.map(function (f) { return [f.label, v[f.k]]; })
          .concat([['Environment', Api.envLabel()], ['Read at', new Date().toISOString()], ['By', Api.state.user || ''], ['Rows', t.count]]) }]);
      }
      U.swap(out, UI.note('ok', null, 'Read ' + spec.title.toLowerCase() + ' from ' + Api.envLabel() + '.'));
    } catch (e) { U.swap(out, UI.note('bad', 'Could not read it', e.message)); }
  }
  var main = UI.btn('Download (Excel)', { kind: 'primary', icon: 'download', onClick: function () { return run('xlsx'); } });
  var split = UI.splitBtn(main, [{ header: 'Download' },
    { icon: 'download', label: 'Excel (.xlsx)', right: 'default', onClick: function () { UI.busy(main, function () { return run('xlsx'); }); } },
    { icon: 'download', label: 'CSV (.csv)', onClick: function () { return run('csv'); } },
    { icon: 'code', label: 'JSON', sub: 'As Beeforce returns it', onClick: function () { return run('json'); } }], 'Download');
  if (!choices.length) return null;
  drawFields();
  return h('div.card.lookupcard',
    h('div.row', { style: { alignItems: 'center' } }, h('b', 'Look up one employee'), sel),
    h('div.small.muted', { style: { margin: '4px 0 6px' } }, 'Type the employee number (and dates); APIary builds the request the tools use.'),
    fieldsBox, h('div.row.lkacts', split), out);
}

ctx.defineTool('data-export', {
  desc: 'Pull setup data from Beeforce to Excel or CSV — one sheet per list, read only. Save the lists you pull often as a named set.',
  render: function (view) {
    var all = datasets();
    var sel = new Set();
    var pagesBox = UI.check('All pages', false);
    pagesBox.title = 'Ask for page 0, 1, 2… (' + PAGE_SIZE + ' each) and combine them. Leave off to read each list the way the tools do.';
    var holder = h('div');
    var dl = UI.btn('', { kind: 'primary', icon: 'download' });
    function label() { U.swap(dl, U.icon('download', 16), h('span', sel.size ? 'Download ' + sel.size + ' list' + (sel.size === 1 ? '' : 's') + ' (Excel)' : 'Download (Excel)')); dl.disabled = !sel.size; }
    var tbl = UI.table([
      { key: 'name', label: 'Data', wrap: true },
      { key: 'usedBy', label: 'Used by', wrap: true },
      { key: 'path', label: 'Request', wrap: true, render: function (d) { return h('span.small.muted', 'GET ' + d.path + (d.query ? '?' + Object.keys(d.query).map(function (k) { return k + '=' + d.query[k]; }).join('&') : '')); }, text: function (d) { return d.path; } }
    ], all, { select: true, selected: sel, rowKey: function (d) { return d.key; }, onSelect: label, label: 'Lists',
      rowMenu: function (d) {
        return [{ header: d.name },
          { icon: 'download', label: 'Excel (.xlsx)', sub: 'Only this list', onClick: function () { return run([d], 'xlsx'); } },
          { icon: 'download', label: 'CSV (.csv)', sub: 'Only this list', onClick: function () { return run([d], 'csv'); } },
          { icon: 'code', label: 'JSON', sub: 'As Beeforce returns it', onClick: function () { return run([d], 'json'); } }];
      } });
    dl.onclick = function () { return run(all.filter(function (d) { return sel.has(d.key); }), 'xlsx'); };

    var setSel = h('select.input', { 'aria-label': 'Saved sets' });
    setSel.style.maxWidth = '240px';
    function drawSets(pick) {
      var l = savedSets();
      U.swap(setSel, h('option', { value: '' }, l.length ? 'Saved sets…' : 'No saved sets yet'), l.map(function (x) { return h('option', { value: x.name, selected: x.name === pick }, x.name + ' (' + x.keys.length + ')'); }));
      delSet.disabled = !setSel.value;
    }
    setSel.addEventListener('change', function () {
      delSet.disabled = !setSel.value;
      var x = savedSets().filter(function (s) { return s.name === setSel.value; })[0];
      if (!x) return;
      sel.clear(); var missing = 0;
      x.keys.forEach(function (k) { if (all.some(function (d) { return d.key === k; })) sel.add(k); else missing++; });
      pagesBox.input.checked = !!x.allPages;
      tbl.setRows(all); label();
      UI.toast('Selected “' + x.name + '”: ' + sel.size + ' list' + (sel.size === 1 ? '' : 's') + (missing ? ' (' + missing + ' no longer available)' : '') + '.');
    });
    var saveSet = UI.btn('Save selection…', { kind: 'quiet', sm: true, icon: 'plus', onClick: function () {
      if (!sel.size) { UI.toast('Tick the lists to save first.'); return; }
      return UI.dialog(function (box, close) {
        var nm = UI.input({ placeholder: 'e.g. Monthly pay rules', value: setSel.value || '' });
        var err = h('div.err');
        var f = h('form', h('h2', 'Save this selection'), h('p.muted', sel.size + ' list' + (sel.size === 1 ? '' : 's') + (pagesBox.input.checked ? ', all pages' : '') + '. Saved in this browser only.'), UI.field('Name', nm), err,
          h('div.acts', h('button.btn.quiet', { type: 'button', onclick: function () { close(false); } }, 'Cancel'), h('button.btn.primary', { type: 'submit' }, 'Save')));
        f.addEventListener('submit', function (e) {
          e.preventDefault();
          var n = nm.value.trim();
          if (!n || n.length > 60) { err.textContent = 'Enter a name of up to 60 characters.'; return; }
          var l = savedSets().filter(function (x) { return x.name !== n; });
          l.push({ name: n, keys: Array.from(sel), allPages: pagesBox.input.checked });
          l.sort(function (a, b) { return a.name.toLowerCase() < b.name.toLowerCase() ? -1 : 1; });
          if (!saveSets(l)) { err.textContent = 'This browser blocked saving.'; return; }
          close(true); drawSets(n); UI.toast('Saved “' + n + '”.', 'ok');
        });
        box.appendChild(f);
      });
    } });
    var delSet = UI.btn('Delete set', { kind: 'quiet', sm: true, icon: 'trash', onClick: function () {
      var n = setSel.value; if (!n) return;
      saveSets(savedSets().filter(function (x) { return x.name !== n; })); drawSets(''); UI.toast('Deleted “' + n + '”.');
    } });
    drawSets('');

    async function run(list, kind) {
      if (!list.length) return;
      var allPages = pagesBox.input.checked, stop = false;
      var status = h('span.muted', ''), stopBtn = UI.btn('Stop', { sm: true, kind: 'quiet', icon: 'stop', onClick: function () { stop = true; status.textContent = 'Stopping after the current list…'; } });
      U.swap(holder, h('div.card', h('span.spin'), ' ', status, ' ', list.length > 1 || allPages ? stopBtn : null));
      var sheets = [], about = [], used = { about: 1 }, okN = 0, bad = [];
      for (var i = 0; i < list.length; i++) {
        var d = list[i];
        if (stop) { about.push([d.name, 'GET ' + d.path, '', '', 'Not read (stopped)']); continue; }
        status.textContent = 'Reading ' + d.name + ' from ' + Api.envLabel() + ' (' + (i + 1) + ' of ' + list.length + ')…';
        try {
          var r = await readOne(d, allPages, function () { return stop; });
          if (kind === 'json') { UI.saveText(fileStem().replace('apiary_data', 'apiary_' + d.key.replace(/\W+/g, '_')) + '.json', JSON.stringify(r.data, null, 2), 'application/json'); okN++; continue; }
          var t = toTable(r.data);
          sheets.push({ name: sheetName(d.name, used), headers: t.headers, rows: t.rows, tabColor: '0B5CC7' });
          about.push([d.name, 'GET ' + d.path, t.count, r.pages, 'OK']); okN++;
        } catch (e) { bad.push(d.name + ': ' + e.message); about.push([d.name, 'GET ' + d.path, '', '', e.message]); }
      }
      if (kind !== 'json' && sheets.length) {
        if (kind === 'csv') X.downloadCsv(fileStem().replace('apiary_data', 'apiary_' + list[0].key.replace(/\W+/g, '_')) + '.csv', sheets[0]);
        else await X.download(fileStem() + '.xlsx', sheets.concat([{ name: 'About', headers: ['List', 'Request', 'Rows', 'Pages', 'Result'],
          rows: about.concat([[], ['Environment', Api.envLabel()], ['Read at', new Date().toISOString()], ['By', Api.state.user || ''], ['APIary', ctx.CONFIG.VERSION], ['All pages', allPages ? 'yes' : 'no']]) }]));
      }
      U.swap(holder,
        UI.note(bad.length ? (okN ? 'warn' : 'bad') : 'ok', okN ? 'Read ' + okN + ' list' + (okN === 1 ? '' : 's') + ' from ' + Api.envLabel() : 'Nothing was read',
          bad.length ? 'Could not read: ' + bad.join('; ') : (kind === 'xlsx' ? 'One sheet per list, plus an About sheet with what was read and when.' : 'Saved.')));
    }

    label();
    U.append(view, [
      lookupCard(),
      UI.note('info', null, 'Pick the lists you want and download them as one Excel file (one sheet per list), or use a row’s ⋯ menu for CSV or JSON. Lists that Beeforce sends in pages (such as Employees) need “All pages”. Only reads: nothing is changed in ' + Api.envLabel() + '.'),
      h('div.row', { style: { alignItems: 'center', margin: '6px 0 8px', flexWrap: 'wrap' } }, dl, pagesBox, h('span', { style: { flex: 1 } }), setSel, saveSet, delSet),
      holder, tbl]);
  }
});
