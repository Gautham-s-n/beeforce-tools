/* modules/dev-panel.js — API console for admins: the Developer panel of one tool, and the API explorer
 * (Admin Settings → API explorer) for every endpoint plus any Beeforce path.
 *
 * Per endpoint: see the live URL; edit method / path, reset, or turn an optional call off (saved in this browser,
 * shared with the team via endpoints.json); copy cURL (token hidden unless you confirm); Postman.
 * GET endpoints can be sent: the response can be narrowed to a part (e.g. content.{id,code}), every page of a
 * paged list can be fetched, and the result downloaded as JSON, Excel or CSV.
 * Writes (POST / PUT / PATCH / DELETE) are never sent from here — copy them as cURL or Postman instead. */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, EP = ctx.EP, Api = ctx.Api;
var MAX_SHOW = 200000;   // characters shown on screen (downloads have everything)
var MAX_PAGES = 500;     // safety stop for "all pages"

/* ---------------- small helpers ---------------- */
function copy(text, what) {
  return navigator.clipboard.writeText(text).then(function () { UI.toast(what + ' copied.'); }, function () { UI.toast('This browser blocked copying.', 'bad'); });
}
function save(name, text, type) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: type || 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  ctx.Audit.onDownload(name);
}
function placeholders(path) { return (path.match(/\{([a-zA-Z]+)\}/g) || []).map(function (p) { return p.slice(1, -1); }); }
function parseQuery(s) {
  var o = {};
  String(s || '').replace(/^\?/, '').split('&').forEach(function (kv) {
    if (!kv.trim()) return;
    var i = kv.indexOf('='), k = i < 0 ? kv : kv.slice(0, i), v = i < 0 ? '' : kv.slice(i + 1);
    try { o[decodeURIComponent(k.trim())] = decodeURIComponent(v.trim()); } catch (e) { o[k.trim()] = v.trim(); }
  });
  return o;
}
function size(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(1) + ' MB'; }
function slug(s) { return String(s || 'response').replace(/^\/+|\/+$/g, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) || 'response'; }
function toolName(t) { return (ctx.TOOLS[t] || ctx.DEFAULT_TOOLS[t] || {}).name || t; }
function signedIn() { return !!(Api.state.token && Api.state.base); }

/* ---------------- picking a part of a response ----------------
 *   content            → the "content" field
 *   content.code       → code of every item (lists are walked automatically)
 *   content[0]         → first item          content.{id,code,type.name} → only those fields of every item */
function getPath(v, path) { return path.split('.').reduce(function (x, k) { return x == null ? undefined : x[k]; }, v); }
function pick(data, expr) {
  expr = String(expr || '').trim();
  if (!expr) return data;
  var segs = expr.match(/\{[^}]*\}|\[\d*\]|[^.\[\]{}]+/g) || [];
  function step(v, i) {
    if (i >= segs.length || v === undefined) return v;
    var s = segs[i];
    if (s === '[]') return Array.isArray(v) ? v.map(function (x) { return step(x, i + 1); }) : undefined;
    if (/^\[\d+\]$/.test(s)) return step(Array.isArray(v) ? v[+s.slice(1, -1)] : undefined, i + 1);
    if (s.charAt(0) === '{') {
      var fields = s.slice(1, -1).split(',').map(function (f) { return f.trim(); }).filter(Boolean);
      if (Array.isArray(v)) return v.map(function (x) { return step(x, i); });
      if (v == null || typeof v !== 'object') return undefined;
      var o = {}; fields.forEach(function (f) { o[f] = getPath(v, f); });
      return step(o, i + 1);
    }
    if (v == null) return undefined;
    if (Array.isArray(v) && !/^\d+$/.test(s)) return v.map(function (x) { return step(x, i); });
    return step(v[s], i + 1);
  }
  return step(data, 0);
}
/* Suggested parts: top-level fields, and the fields of the main list's items. */
function suggestions(data) {
  var out = [];
  var list = Array.isArray(data) ? data : null, base = '';
  if (!list && data && typeof data === 'object') {
    Object.keys(data).slice(0, 8).forEach(function (k) { out.push(k); });
    ['content', 'data', 'items', 'results'].some(function (k) { if (Array.isArray(data[k])) { list = data[k]; base = k + '.'; return true; } return false; });
  }
  var first = list && list.filter(function (x) { return x && typeof x === 'object' && !Array.isArray(x); })[0];
  if (first) {
    var keys = Object.keys(first);
    keys.slice(0, 10).forEach(function (k) { out.push(base + k); });
    var simple = keys.filter(function (k) { return first[k] == null || typeof first[k] !== 'object'; }).slice(0, 4);
    if (simple.length > 1) out.push(base + '{' + simple.join(',') + '}');
  }
  return out.filter(function (x, i) { return out.indexOf(x) === i; }).slice(0, 14);
}

/* ---------------- table export (Excel / CSV) ---------------- */
function flatten(o, prefix, out, depth) {
  out = out || {};
  Object.keys(o).forEach(function (k) {
    var v = o[k], key = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v) && depth < 3) flatten(v, key, out, depth + 1);
    else out[key] = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v;
  });
  return out;
}
function toTable(data) {
  var list = Array.isArray(data) ? data : Api.asList(data);
  if (!list.length && data && typeof data === 'object' && !Array.isArray(data)) {
    var f = flatten(data, '', {}, 0);
    return { headers: ['Field', 'Value'], rows: Object.keys(f).map(function (k) { return [k, f[k]]; }) };
  }
  var flat = list.map(function (x) { return x && typeof x === 'object' && !Array.isArray(x) ? flatten(x, '', {}, 0) : { value: x == null ? '' : typeof x === 'object' ? JSON.stringify(x) : x }; });
  var headers = [];
  flat.forEach(function (r) { Object.keys(r).forEach(function (k) { if (headers.indexOf(k) < 0) headers.push(k); }); });
  return { headers: headers, rows: flat.map(function (r) { return headers.map(function (k) { return r[k] === undefined ? '' : r[k]; }); }) };
}
function csv(t) {
  var q = function (v) { v = v == null ? '' : String(v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
  return '﻿' + [t.headers].concat(t.rows).map(function (r) { return r.map(q).join(','); }).join('\r\n') + '\r\n';
}

/* ---------------- sending GETs (one page or all pages) ---------------- */
async function sendGet(path, query, opts) {
  var t0 = performance.now();
  var r = await Api.call('GET', path, { query: query, module: opts.module || 'API console' });
  return { r: r, ms: Math.round(performance.now() - t0), pages: 1 };
}
/* Follows ?page=0,1,2… until a short / empty / last page. Spring pages ({content, last, totalPages}) and plain
 * arrays both work. Stops if the server ignores paging (same first item twice). */
async function sendAllPages(path, query, opts, onPage, stopped) {
  var sizeN = parseInt(query.size, 10) || 200, all = [], prevFirst = null, t0 = performance.now(), page = parseInt(query.page, 10) || 0, n = 0, last;
  for (; n < MAX_PAGES; n++, page++) {
    if (stopped()) break;
    var q = Object.assign({}, query, { page: page, size: sizeN });
    last = await Api.call('GET', path, { query: q, module: opts.module || 'API console' });
    if (!last.ok) { if (!n) return { r: last, ms: Math.round(performance.now() - t0), pages: 0 }; break; }
    var d = last.data, items = Array.isArray(d) ? d : Api.asList(d);
    var firstKey = items.length ? JSON.stringify(items[0]) : null;
    if (n && firstKey && firstKey === prevFirst) break;   // the endpoint ignores paging
    prevFirst = firstKey;
    all = all.concat(items);
    onPage(n + 1, all.length);
    var isLast = !items.length || items.length < sizeN || (d && !Array.isArray(d) && (d.last === true || (d.totalPages != null && page + 1 >= d.totalPages)));
    if (isLast) { n++; break; }
  }
  return { r: { ok: true, status: last ? last.status : 0, data: all, text: '' }, ms: Math.round(performance.now() - t0), pages: n, combined: true, stopped: stopped() };
}

/* ---------------- response viewer ---------------- */
function responseView(res, base) {
  var r = res.r, whole = r.data != null ? r.data : null;
  var rawText = whole != null ? JSON.stringify(whole, null, 2) : (r.text || '');
  var partIn = UI.input({ placeholder: 'Part (optional) — e.g. content.{id,code,description}' });
  var info = h('span.small.muted'), pre = h('pre.code.devpre'), chips = h('div.devsug');
  var cur = whole;
  function curText() { return cur === undefined ? '' : cur != null && typeof cur === 'object' ? JSON.stringify(cur, null, 2) : String(cur == null ? r.text || '' : cur); }
  function refresh() {
    cur = whole != null ? pick(whole, partIn.value) : null;
    var text = curText();
    var count = Array.isArray(cur) ? cur.length + ' items' : (cur && Array.isArray(cur.content) ? cur.content.length + ' items (page)' : '');
    info.textContent = res.ms + ' ms · ' + size(text.length) + (count ? ' · ' + count : '') + (res.combined ? ' · ' + res.pages + ' page' + (res.pages === 1 ? '' : 's') + ' combined' + (res.stopped ? ' (stopped)' : '') : '') + (partIn.value.trim() ? ' · part of the response' : '');
    if (partIn.value.trim() && cur === undefined) { pre.textContent = 'Nothing at “' + partIn.value.trim() + '”. Pick one of the suggestions above.'; return; }
    pre.textContent = text.length > MAX_SHOW ? text.slice(0, MAX_SHOW) + '\n… (' + size(text.length - MAX_SHOW) + ' more — download to see everything)' : (text || '(empty response)');
  }
  var tm; partIn.addEventListener('input', function () { clearTimeout(tm); tm = setTimeout(refresh, 200); });
  if (whole != null) U.swap(chips, suggestions(whole).map(function (s) { return h('button', { type: 'button', onclick: function () { partIn.value = s; refresh(); } }, s); }));
  var name = function (ext) { return base + (partIn.value.trim() ? '_' + slug(partIn.value) : '') + '_' + U.stamp() + '.' + ext; };
  var tableOk = function () { return cur != null && typeof cur === 'object'; };
  var acts = h('div.row', { style: { alignItems: 'center', gap: '6px' } },
    UI.chip('HTTP ' + (r.status || 'error'), r.ok ? 'ok' : 'bad'), info, h('span', { style: { flex: 1 } }),
    UI.btn('Copy', { sm: true, kind: 'quiet', icon: 'copy', onClick: function () { return copy(curText() || rawText, 'Response'); } }),
    UI.btn('JSON', { sm: true, kind: 'quiet', icon: 'download', onClick: function () { save(name('json'), curText() || rawText); } }),
    UI.btn('Excel', { sm: true, kind: 'quiet', icon: 'download', onClick: function () {
      if (!tableOk()) { UI.toast('Pick a list or object to export as a table.', 'bad'); return; }
      var t = toTable(cur);
      return ctx.X.download(name('xlsx'), [{ name: 'Response', headers: t.headers, rows: t.rows }]);
    } }),
    UI.btn('CSV', { sm: true, kind: 'quiet', icon: 'download', onClick: function () {
      if (!tableOk()) { UI.toast('Pick a list or object to export as a table.', 'bad'); return; }
      save(name('csv'), csv(toTable(cur)), 'text/csv');
    } }));
  refresh();
  return h('div.devres', acts, whole != null ? h('div', { style: { marginTop: '8px' } }, partIn, chips) : null,
    !r.ok && r.text && whole == null ? h('div.small.badtxt', { style: { margin: '6px 0' } }, Api.parseError(r.text)) : null, pre);
}

/* A "Send" bar shared by registered endpoints and custom paths. getReq() → { path, query, base } or null. */
function sender(getReq, module) {
  var out = h('div');
  var allPages = UI.check('All pages', false);
  allPages.title = 'Follow ?page=0,1,2… and combine every page into one list';
  var stop = false;
  async function run() {
    var req = getReq(); if (!req) return;
    if (!signedIn()) { UI.toast('Sign in to Beeforce first.', 'bad'); return; }
    stop = false;
    var prog = h('span', ' Sending GET to ' + Api.envLabel() + '…');
    var stopBtn = allPages.input.checked ? UI.btn('Stop', { sm: true, kind: 'quiet', icon: 'stop', onClick: function () { stop = true; } }) : null;
    U.swap(out, h('div.card.loadcard', h('span.spin'), prog, stopBtn));
    var res = allPages.input.checked
      ? await sendAllPages(req.path, req.query, { module: module }, function (p, n) { prog.textContent = ' Page ' + p + ' · ' + n + ' items so far…'; }, function () { return stop; })
      : await sendGet(req.path, req.query, { module: module });
    U.swap(out, responseView(res, req.base));
  }
  return { allPages: allPages, run: run, out: out };
}

/* ---------------- one registered endpoint ---------------- */
function endpointCard(key, o) {
  o = o || {};
  var el = h('div.devcard');
  var params = {}, qIn = UI.input({ placeholder: 'extra query, e.g. page=0&size=20' });
  var editing = false, sendBox = null;
  function draw() {
    var e = EP.get(key), ph = placeholders(e.path), isGet = e.method === 'GET';
    var urlEl = h('code.devurl');
    function refreshUrl() { urlEl.textContent = EP.url(key, params, parseQuery(qIn.value)); }
    var inputs = ph.map(function (p) {
      var inp = UI.input({ placeholder: p, value: params[p] || '' });
      inp.addEventListener('input', function () { params[p] = inp.value.trim(); refreshUrl(); });
      return UI.field(p, inp);
    });
    qIn.oninput = refreshUrl;
    refreshUrl();
    var s = sender(function () {
      var miss = ph.filter(function (p) { return !params[p]; });
      if (miss.length) { UI.toast('Fill ' + miss.join(', ') + ' first.', 'bad'); return null; }
      return { path: EP.path(key, params), query: Object.assign({}, e.query || {}, parseQuery(qIn.value)), base: e.tool + '_' + key.split('.').pop() };
    }, o.module || 'Developer panel');
    if (sendBox) U.swap(s.out, Array.prototype.slice.call(sendBox.childNodes));
    sendBox = s.out;
    var src = e.source === 'built-in' ? null : UI.chip(e.source === 'team' ? 'Team file' : 'Changed in this browser', 'upd');
    U.swap(el,
      h('div.devhead', h('span.meth.m-' + e.method.toLowerCase(), e.method),
        h('div', h('b', e.label || key), h('code.dim', key + (o.showTool ? ' · ' + toolName(e.tool) : ''))),
        e.off ? UI.chip('Turned off', 'bad') : null, src, e.required === false && !e.off ? UI.chip('Optional') : null),
      urlEl,
      e.off ? h('div.small.muted', { style: { marginTop: '6px' } }, 'The tool skips this call (as if it failed). Turn it on to use it again.') : null,
      editing ? editor(e) : null,
      inputs.length || isGet ? h('div.grid2', { style: { marginTop: '8px' } }, inputs, isGet ? UI.field('Query', qIn) : null) : null,
      h('div.row.devacts', { style: { marginTop: '8px', alignItems: 'center' } },
        isGet ? (signedIn() ? [UI.btn('Send GET', { sm: true, kind: 'primary', icon: 'play', onClick: s.run }), s.allPages] : h('span.small.dim', 'Sign in to Beeforce to send requests.'))
          : h('span.small.dim', 'Writes are not sent from here — copy as cURL or Postman.'),
        h('span', { style: { flex: 1 } }),
        UI.btn(editing ? 'Close edit' : 'Edit', { sm: true, kind: 'quiet', icon: 'edit', onClick: function () { editing = !editing; draw(); } }),
        EP.canOff(key) ? UI.btn(e.off ? 'Turn on' : 'Turn off', { sm: true, kind: 'quiet', icon: 'power', onClick: function () { toggleOff(e); } }) : null,
        UI.btn('cURL', { sm: true, kind: 'quiet', icon: 'copy', onClick: function () { return copy(EP.curl(key, params, { query: parseQuery(qIn.value) }), 'cURL (token hidden as $BEEFORCE_TOKEN)'); } }),
        signedIn() ? UI.btn('cURL + token', { sm: true, kind: 'quiet', icon: 'copy', onClick: curlWithToken }) : null,
        UI.btn('Postman', { sm: true, kind: 'quiet', icon: 'download', onClick: function () { save(key + '.postman_collection.json', JSON.stringify(EP.postman([e], 'APIary · ' + (e.label || key)), null, 2)); } })),
      sendBox);
    async function curlWithToken() {
      var ok = await UI.confirm({ title: 'Copy cURL with your live token?', body: 'Anyone who gets this text can act as you on ' + Api.envLabel() + ' until the session ends. Don\'t paste it into chat, tickets or email.', verb: 'Copy with token', danger: true });
      if (ok) return copy(EP.curl(key, params, { withToken: true, query: parseQuery(qIn.value) }), 'cURL (with token)');
    }
  }
  function editor(e) {
    var t = EP.team(key);
    var m = UI.select(EP.METHODS, e.method); m.style.width = '100px';
    var p = UI.input({ value: e.path }); p.classList.add('mono');
    var err = h('div.small.badtxt');
    function problems() { return EP.check(m.value, p.value.trim(), EP.DEFAULTS[key]); }
    p.addEventListener('input', function () { err.textContent = problems().join(' · '); });
    m.addEventListener('change', function () { err.textContent = problems().join(' · '); });
    async function saveIt() {
      var errs = problems();
      if (errs.length) { err.textContent = errs.join(' · '); return; }
      if (m.value === e.method && p.value.trim() === e.path) { UI.toast('Nothing changed.'); return; }
      var ok = await UI.confirm({ title: 'Change this endpoint?', body: (e.label || key) + ':\n' + e.method + ' ' + e.path + '\n→ ' + m.value + ' ' + p.value.trim() + '\n\nTools in this browser use the new URL straight away. Share it with the team via Admin Settings → API endpoints → Download endpoints.json.', verb: 'Save' });
      if (!ok) return;
      var r = EP.setOne(key, { method: m.value, path: p.value.trim() });
      if (r.length) { err.textContent = r.join(' · '); return; }
      editing = false; draw(); o.onChange && o.onChange(); UI.toast('Saved in this browser.');
    }
    async function resetIt() {
      if (!(await UI.confirm({ title: 'Reset this endpoint?', body: 'Back to ' + (t.source === 'team' ? 'the team file' : 'the built-in value') + ': ' + t.method + ' ' + t.path + (t.off ? ' (turned off)' : '') + '.', verb: 'Reset' }))) return;
      EP.resetOne(key); editing = false; draw(); o.onChange && o.onChange(); UI.toast('Reset to ' + (t.source === 'team' ? 'the team file' : 'built-in') + '.');
    }
    return h('div.devedit',
      h('div.row', { style: { gap: '8px', alignItems: 'center' } }, m, h('div', { style: { flex: 1 } }, p)),
      err,
      h('div.small.muted', 'Path only, starting with /api/. Keep trailing slashes exact. Placeholders: ' + (placeholders(EP.DEFAULTS[key].path).map(function (x) { return '{' + x + '}'; }).join(', ') || 'none') + '. ' +
        (t.source === 'team' ? 'Team file: ' : 'Built-in: ') + t.method + ' ' + t.path),
      h('div.row', { style: { gap: '8px', marginTop: '6px' } },
        UI.btn('Save in this browser', { sm: true, kind: 'primary', icon: 'check', onClick: saveIt }),
        e.source === 'browser' ? UI.btn('Reset', { sm: true, kind: 'quiet', icon: 'retry', onClick: resetIt }) : null));
  }
  async function toggleOff(e) {
    if (!e.off && !(await UI.confirm({ title: 'Turn off “' + (e.label || key) + '”?', body: toolName(e.tool) + ' will skip this call, as if it failed (for example a reference sheet or a review check is left out). Turn it on again any time.', verb: 'Turn off', danger: true }))) return;
    var r = EP.setOne(key, { off: !e.off });
    if (r.length) { UI.toast(r[0], 'bad'); return; }
    draw(); o.onChange && o.onChange();
    UI.toast(e.off ? 'Turned on.' : 'Turned off in this browser.');
  }
  draw();
  return el;
}

/* ---------------- any Beeforce path (API explorer) ---------------- */
function customCard() {
  var pathIn = UI.input({ placeholder: '/api/attendance/paycodes   (or a full ' + (Api.state.base || 'https://app.beeforce.in') + '/… URL)' });
  pathIn.classList.add('mono');
  var qIn = UI.input({ placeholder: 'query, e.g. projection=FULL&size=50' });
  var urlEl = h('code.devurl');
  function req() {
    var raw = pathIn.value.trim();
    if (!raw) return null;
    var u;
    try { u = new URL(/^https?:/.test(raw) ? raw : (Api.state.base || 'https://app.beeforce.in') + (raw.charAt(0) === '/' ? '' : '/') + raw); } catch (e) { return null; }
    var q = {}; u.searchParams.forEach(function (v, k) { q[k] = v; });
    Object.assign(q, parseQuery(qIn.value));
    return { origin: u.origin, path: u.pathname, query: q };
  }
  function fullUrl(x) { var qs = Object.keys(x.query).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(x.query[k]); }).join('&'); return x.origin + x.path + (qs ? '?' + qs : ''); }
  function refresh() { var x = req(); urlEl.textContent = x ? fullUrl(x) : '—'; }
  pathIn.addEventListener('input', refresh); qIn.addEventListener('input', refresh); refresh();
  var s = sender(function () {
    var x = req();
    if (!x) { UI.toast('Enter a path such as /api/attendance/paycodes.', 'bad'); return null; }
    if (!/^\/api\//.test(x.path)) { UI.toast('Only Beeforce API paths (/api/…) can be sent from here.', 'bad'); return null; }
    if (Api.state.base && x.origin !== new URL(Api.state.base).origin) { UI.toast('That URL is not the signed-in environment (' + Api.envLabel() + ').', 'bad'); return null; }
    return { path: x.path, query: x.query, base: 'custom_' + slug(x.path) };
  }, 'API explorer');
  return h('div.devcard.custom',
    h('div.devhead', h('span.meth.m-get', 'GET'), h('div', h('b', 'Any Beeforce path'), h('span.small.muted', 'Read anything the API offers — handy for endpoints no tool uses yet.'))),
    h('div.grid2', { style: { marginTop: '8px' } }, UI.field('Path or URL', pathIn), UI.field('Query', qIn)),
    urlEl,
    h('div.row.devacts', { style: { marginTop: '8px', alignItems: 'center' } },
      signedIn() ? [UI.btn('Send GET', { sm: true, kind: 'primary', icon: 'play', onClick: s.run }), s.allPages] : h('span.small.dim', 'Sign in to Beeforce to send requests.'),
      h('span', { style: { flex: 1 } }),
      UI.btn('cURL', { sm: true, kind: 'quiet', icon: 'copy', onClick: function () { var x = req(); if (!x) return UI.toast('Enter a path first.', 'bad'); return copy(EP.curlRaw('GET', fullUrl(x)), 'cURL (token hidden as $BEEFORCE_TOKEN)'); } })),
    s.out);
}

/* cURL script for many endpoints (token as $BEEFORCE_TOKEN; writes get an empty {} body to fill in). */
function curlScript(entries, title) {
  return '#!/bin/sh\n# ' + title + ' — generated by APIary ' + new Date().toISOString().slice(0, 16).replace('T', ' ') +
    '\n# Set the token first:  export BEEFORCE_TOKEN=...   Placeholders like {id} must be replaced before running.\n\n' +
    entries.map(function (e) { return '# ' + (e.label || e.key) + ' (' + e.key + ')' + (e.off ? ' — turned off in APIary' : '') + '\n' + EP.curl(e.key, null) + '\n'; }).join('\n');
}

/* ---------------- Developer panel (one tool, drawer) ---------------- */
function open(toolId) {
  if (!ctx.Layout.isAdmin()) { UI.toast('Developer panels are for admins.', 'bad'); return; }
  var name = toolName(toolId);
  var scrim = h('div.scrim.devscrim');
  var panel = h('aside.devpanel', { role: 'dialog', 'aria-label': 'Developer panel' });
  function close() { scrim.classList.remove('on'); setTimeout(function () { scrim.remove(); }, 250); document.removeEventListener('keydown', esc, true); }
  function esc(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } }
  document.addEventListener('keydown', esc, true);
  scrim.addEventListener('mousedown', function (ev) { if (ev.target === scrim) close(); });
  var list = EP.all().filter(function (e) { return e.tool === toolId; });
  U.append(panel, [
    h('div.devtop',
      h('div', h('div.small.muted', 'Developer · ' + (Api.envLabel() || 'not signed in to Beeforce')), h('h2', name)),
      h('span', { style: { flex: 1 } }),
      UI.btn('Postman', { sm: true, icon: 'download', onClick: function () { save(toolId + '.postman_collection.json', JSON.stringify(EP.postman(EP.all().filter(function (e) { return e.tool === toolId; }), 'APIary · ' + name), null, 2)); } }),
      UI.btn('cURL script', { sm: true, kind: 'quiet', icon: 'download', onClick: function () { save(toolId + '_curl.sh', curlScript(EP.all().filter(function (e) { return e.tool === toolId; }), name), 'text/x-shellscript'); } }),
      h('button.iconbtn', { type: 'button', title: 'Close', onclick: close }, U.icon('x', 18))),
    h('p.small.muted', list.length + ' endpoint' + (list.length === 1 ? '' : 's') + '. Edit, reset or turn off optional calls here (saved in this browser). All endpoints and any Beeforce path: Admin Settings → API explorer. Query parameters the tool adds while running are not shown.'),
    list.length ? h('div.devlist', list.map(function (e) { return endpointCard(e.key); })) : UI.empty('This tool has no registered endpoints.')
  ]);
  scrim.appendChild(panel);
  ctx.appEl.appendChild(scrim);
  requestAnimationFrame(function () { scrim.classList.add('on'); });
}

/* ---------------- API explorer (Admin Settings tab) ---------------- */
function explorer(el) {
  var q = '', tool = '', only = '', openKeys = {};
  var root = h('div');
  el.appendChild(root);
  var search = UI.input({ placeholder: 'Search endpoints — name, path or key' });
  var tm; search.addEventListener('input', function () { clearTimeout(tm); tm = setTimeout(function () { q = search.value.toLowerCase().trim(); drawList(); }, 150); });
  var toolSel = UI.select([{ value: '', label: 'All tools' }].concat(Object.keys(groupBy(EP.all())).map(function (t) { return { value: t, label: toolName(t) }; })), '');
  toolSel.addEventListener('change', function () { tool = toolSel.value; drawList(); });
  var onlySel = UI.select([{ value: '', label: 'All endpoints' }, { value: 'GET', label: 'GET only' }, { value: 'write', label: 'Writes only' }, { value: 'changed', label: 'Changed or turned off' }], '');
  onlySel.addEventListener('change', function () { only = onlySel.value; drawList(); });
  var listEl = h('div');
  function groupBy(list) { var g = {}; list.forEach(function (e) { (g[e.tool] = g[e.tool] || []).push(e); }); return g; }
  function shown() {
    return EP.all().filter(function (e) {
      if (tool && e.tool !== tool) return false;
      if (only === 'GET' && e.method !== 'GET') return false;
      if (only === 'write' && e.method === 'GET') return false;
      if (only === 'changed' && e.source === 'built-in' && !e.off) return false;
      return !q || (e.label + ' ' + e.path + ' ' + e.key + ' ' + e.method + ' ' + toolName(e.tool)).toLowerCase().indexOf(q) >= 0;
    });
  }
  function row(e) {
    var body = h('div.exbody');
    var head = h('button.exrow', { type: 'button', 'aria-expanded': openKeys[e.key] ? 'true' : 'false' },
      h('span.meth.m-' + e.method.toLowerCase(), e.method), h('span.exname', e.label || e.key), h('code.expath', e.path),
      e.off ? UI.chip('Off', 'bad') : e.source !== 'built-in' ? UI.chip(e.source === 'team' ? 'Team' : 'Changed', 'upd') : null,
      U.icon('chev', 14));
    function fill() { U.swap(body, openKeys[e.key] ? endpointCard(e.key, { module: 'API explorer', onChange: function () { drawList(); } }) : null); }
    head.addEventListener('click', function () { openKeys[e.key] = !openKeys[e.key]; head.setAttribute('aria-expanded', openKeys[e.key] ? 'true' : 'false'); fill(); });
    fill();
    return h('div.exitem', head, body);
  }
  function drawList() {
    var list = shown(), g = groupBy(list);
    U.swap(listEl, list.length ? Object.keys(g).map(function (t) {
      return h('section.exgrp', h('div.exgh', h('b', toolName(t)), h('span.small.muted', g[t].length + ' endpoint' + (g[t].length === 1 ? '' : 's'))), g[t].map(row));
    }) : UI.empty('No endpoint matches.'));
  }
  function draw() {
    U.swap(root,
      signedIn() ? null : signInCard(),
      h('div.row', { style: { margin: '4px 0 12px', alignItems: 'center' } },
        h('span.muted.small', { style: { flex: '1 1 300px' } }, signedIn() ? 'Signed in to ' + Api.envLabel() + ' as ' + Api.state.user + '. GET requests can be sent; writes are copy-only.' : 'Not signed in to Beeforce: you can edit, copy and download, but not send.'),
        h('div.acts',
          UI.btn('Postman (shown)', { sm: true, icon: 'download', onClick: function () { save('apiary.postman_collection.json', JSON.stringify(EP.postman(shown(), 'APIary endpoints'), null, 2)); } }),
          UI.btn('cURL script (shown)', { sm: true, kind: 'quiet', icon: 'download', onClick: function () { save('apiary_curl.sh', curlScript(shown(), 'APIary endpoints'), 'text/x-shellscript'); } }),
          UI.btn('endpoints.json', { sm: true, kind: 'quiet', icon: 'download', onClick: function () { save('endpoints.json', JSON.stringify(EP.exportRepo(), null, 2) + '\n'); UI.toast('endpoints.json downloaded. Commit it next to index.js to share these endpoints with the team.'); } }))),
      customCard(),
      h('div.row', { style: { margin: '18px 0 10px', gap: '8px' } }, h('div', { style: { flex: '2 1 260px' } }, search), h('div', { style: { flex: '1 1 160px' } }, toolSel), h('div', { style: { flex: '1 1 160px' } }, onlySel)),
      listEl);
    drawList();
  }
  draw();
}

/* Admin console: sign in to Beeforce from here, so requests can be sent (switches to a normal session with admin tools). */
function signInCard() {
  if (!ctx.adminConsole) return UI.note('info', 'Not signed in to Beeforce', 'Sign in again to send requests.');
  var env = UI.select([{ value: 'production', label: 'Production' }, { value: 'uat', label: 'UAT' }], U.store.get('env', 'production'));
  var user = UI.input({ placeholder: 'Beeforce username', value: U.store.get('user', '') }); user.autocomplete = 'username';
  var pass = UI.input({ type: 'password', placeholder: 'Password' }); pass.autocomplete = 'current-password';
  var err = h('div.err');
  var go = h('button.btn.primary', { type: 'submit' }, 'Sign in to Beeforce');
  var f = h('form.card.devsign', { novalidate: true },
    h('b', 'Sign in to Beeforce to send requests'),
    h('p.small.muted', { style: { margin: '2px 0 10px' } }, 'Uses a normal Beeforce login (e.g. a client admin account). You stay an admin: this page reopens with Settings, every tool and the Developer panels.'),
    h('div.grid3', UI.field('Environment', env), UI.field('Username', user), UI.field('Password', pass)),
    err, h('div.acts', { style: { justifyContent: 'flex-end' } }, go));
  f.addEventListener('submit', async function (e) {
    e.preventDefault(); err.textContent = '';
    if (!user.value.trim() || !pass.value) { err.textContent = 'Enter the Beeforce username and password.'; return; }
    if (ctx.AdminLogin.isAdminUser && ctx.AdminLogin.isAdminUser(user.value)) { err.textContent = 'Use a Beeforce login here, not the admin console username.'; return; }
    go.disabled = true; go.textContent = 'Signing in…';
    try {
      await Api.signIn(env.value, user.value.trim(), pass.value);
      pass.value = '';
      U.store.set('env', env.value); U.store.set('user', user.value.trim());
      ctx.Shell.adminToBeeforce();
    } catch (ex) { err.textContent = ex.message; go.disabled = false; go.textContent = 'Sign in to Beeforce'; }
  });
  return f;
}

ctx.addCSS('dev-panel', [
  '.devscrim{place-items:stretch;justify-items:end}',
  '.devpanel{width:min(820px,96vw);height:100%;overflow:auto;background:var(--panel2);border-left:1px solid var(--line2);padding:20px 22px 40px;box-shadow:-30px 0 60px -30px var(--shadow);transform:translateX(40px);transition:transform .3s var(--ease)}',
  '.devscrim.on .devpanel{transform:none}',
  '.devtop{display:flex;align-items:center;gap:10px;margin-bottom:6px}.devtop h2{margin:2px 0 0;font-size:20px}',
  '.devlist{display:grid;gap:12px;margin-top:12px}',
  '.devcard{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:12px 14px}',
  '.devcard.custom{border-style:dashed}',
  '.devhead{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.devhead>div{flex:1;display:flex;flex-direction:column;min-width:0}.devhead code{font-size:11px}',
  '.devacts{flex-wrap:wrap;gap:6px}',
  '.meth{font:700 11px ui-monospace,Consolas,monospace;padding:3px 7px;border-radius:6px;background:var(--chipbg);color:var(--ink2);flex:none}',
  '.m-get{background:var(--okbg);color:var(--ok)}.m-post{background:var(--bluebg);color:var(--blue3)}.m-put,.m-patch{background:var(--warnbg);color:var(--honey)}.m-delete{background:var(--badbg);color:var(--bad)}',
  '.devurl{display:block;margin-top:8px;font:12px ui-monospace,Consolas,monospace;color:var(--ink2);word-break:break-all;background:var(--well);border:1px solid var(--line);border-radius:10px;padding:8px 10px}',
  '.devedit{margin-top:10px;padding:10px 12px;border:1px solid var(--line2);border-radius:12px;background:var(--well);display:grid;gap:6px}',
  '.input.mono{font:12.5px ui-monospace,Consolas,monospace}',
  '.devres{margin-top:10px}.devpre{max-height:420px;white-space:pre;overflow:auto;margin-top:8px}',
  '.devsug{display:flex;flex-wrap:wrap;gap:6px;margin-top:6px}.devsug button{border:1px solid var(--line2);background:var(--well);color:var(--ink2);border-radius:999px;padding:3px 10px;font:12px ui-monospace,Consolas,monospace;cursor:pointer}',
  '.devsug button:hover{border-color:var(--honey);color:var(--ink)}',
  '.devsign{margin-bottom:14px}.grid3{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px}',
  '.exgrp{margin-bottom:14px}.exgh{display:flex;align-items:baseline;gap:10px;margin:0 0 6px}',
  '.exitem{border:1px solid var(--line);border-radius:12px;background:var(--panel);margin-bottom:6px;overflow:hidden}',
  '.exrow{width:100%;display:flex;align-items:center;gap:10px;padding:9px 12px;border:0;background:none;text-align:left;color:var(--ink);cursor:pointer}',
  '.exrow:hover{background:var(--rowhover)}.exrow .exname{font-weight:600;flex:0 1 auto;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:40%}',
  '.exrow .expath{flex:1;min-width:0;font:12px ui-monospace,Consolas,monospace;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
  '.exrow>.ic:last-child{color:var(--ink3);transition:transform .2s var(--ease)}.exrow[aria-expanded=true]>.ic:last-child{transform:rotate(180deg)}',
  '.exbody>.devcard{border:0;border-top:1px solid var(--line);border-radius:0}'
].join('\n'));

ctx.defineTool('dev-panel', { open: open, explorer: explorer, endpointCard: endpointCard, pick: pick, toTable: toTable });
