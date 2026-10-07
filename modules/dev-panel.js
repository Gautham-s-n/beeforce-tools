/* modules/dev-panel.js — Developer panel for one tool (admins only).
 * Lists the tool's endpoints from the registry (core/endpoints.js). For GET endpoints it can send the request and
 * show the response body. Every endpoint can be copied as cURL (token hidden unless you ask for it) and the whole
 * tool downloaded as a Postman collection. Writes (POST/PUT/DELETE) are never sent from here. */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, EP = ctx.EP, Api = ctx.Api;
var MAX_SHOW = 200000; // characters of response shown on screen (download has everything)

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

function endpointCard(e, toolId) {
  var params = {}, ph = placeholders(e.path);
  var inputs = ph.map(function (p) {
    var inp = UI.input({ placeholder: p });
    inp.addEventListener('input', function () { params[p] = inp.value.trim(); refreshUrl(); });
    return UI.field(p, inp);
  });
  var qIn = UI.input({ placeholder: 'extra query, e.g. page=0&size=20' });
  qIn.addEventListener('input', refreshUrl);
  var urlEl = h('code.devurl');
  function refreshUrl() { urlEl.textContent = EP.url(e.key, params, parseQuery(qIn.value)); }
  refreshUrl();
  var out = h('div');
  var isGet = e.method === 'GET';
  var signedIn = !!(Api.state.token && Api.state.base);

  async function send() {
    var missing = ph.filter(function (p) { return !params[p]; });
    if (missing.length) { UI.toast('Fill ' + missing.join(', ') + ' first.', 'bad'); return; }
    U.swap(out, h('div.card.loadcard', h('span.spin'), ' Sending GET to ' + Api.envLabel() + '…'));
    var t0 = performance.now();
    var r = await EP.call(e.key, params, { query: parseQuery(qIn.value), module: 'Developer panel' });
    var ms = Math.round(performance.now() - t0);
    var text = r.data != null ? JSON.stringify(r.data, null, 2) : (r.text || '');
    var count = Array.isArray(r.data) ? r.data.length + ' items' : (r.data && Array.isArray(r.data.content) ? r.data.content.length + ' items (page)' : '');
    var shown = text.length > MAX_SHOW ? text.slice(0, MAX_SHOW) + '\n… (' + size(text.length - MAX_SHOW) + ' more — download to see everything)' : text;
    U.swap(out,
      h('div.devres',
        h('div.row', { style: { alignItems: 'center', gap: '8px', marginBottom: '6px' } },
          UI.chip('HTTP ' + (r.status || 'error'), r.ok ? 'ok' : 'bad'), h('span.small.muted', ms + ' ms · ' + size(text.length) + (count ? ' · ' + count : '')),
          h('span', { style: { flex: 1 } }),
          UI.btn('Copy', { sm: true, kind: 'quiet', icon: 'copy', onClick: function () { return copy(text, 'Response'); } }),
          UI.btn('Download', { sm: true, kind: 'quiet', icon: 'download', onClick: function () { save(toolId + '_' + e.key.split('.').pop() + '_' + U.stamp() + '.json', text); } })),
        h('pre.code.devpre', shown || '(empty response)')));
  }

  function curlBtn(withToken) {
    return UI.btn(withToken ? 'cURL with token' : 'Copy cURL', { sm: true, kind: 'quiet', icon: 'copy', onClick: async function () {
      if (withToken) {
        var ok = await UI.confirm({ title: 'Copy cURL with your live token?', body: 'Anyone who gets this text can act as you on ' + Api.envLabel() + ' until the session ends. Don\'t paste it into chat, tickets or email.', verb: 'Copy with token', danger: true });
        if (!ok) return;
      }
      return copy(EP.curl(e.key, params, { withToken: withToken, query: parseQuery(qIn.value) }), withToken ? 'cURL (with token)' : 'cURL (token hidden as $BEEFORCE_TOKEN)');
    } });
  }

  return h('div.devcard',
    h('div.devhead', h('span.meth.m-' + e.method.toLowerCase(), e.method), h('div', h('b', e.label || e.key), h('code.dim', e.key)),
      e.source !== 'built-in' ? UI.chip(e.source === 'team' ? 'Team file' : 'This browser', 'upd') : null,
      e.required === false ? UI.chip('Optional') : null),
    urlEl,
    inputs.length || isGet ? h('div.grid2', { style: { marginTop: '8px' } }, inputs, isGet ? UI.field('Query', qIn) : null) : null,
    h('div.row', { style: { marginTop: '8px', alignItems: 'center' } },
      isGet ? (signedIn ? UI.btn('Send GET', { sm: true, kind: 'primary', icon: 'play', onClick: send }) : h('span.small.dim', 'Sign in to Beeforce to send requests.'))
        : h('span.small.dim', 'Writes are not sent from here — copy the cURL to test them elsewhere.'),
      h('span', { style: { flex: 1 } }), curlBtn(false), signedIn ? curlBtn(true) : null),
    out);
}

function open(toolId) {
  if (!ctx.Layout.isAdmin()) { UI.toast('Developer panels are for admins.', 'bad'); return; }
  var list = EP.all().filter(function (e) { return e.tool === toolId; });
  var name = (ctx.TOOLS[toolId] || ctx.DEFAULT_TOOLS[toolId] || {}).name || toolId;
  var scrim = h('div.scrim.devscrim');
  var panel = h('aside.devpanel', { role: 'dialog', 'aria-label': 'Developer panel' });
  function close() { scrim.classList.remove('on'); setTimeout(function () { scrim.remove(); }, 250); document.removeEventListener('keydown', esc, true); }
  function esc(ev) { if (ev.key === 'Escape') { ev.stopPropagation(); close(); } }
  document.addEventListener('keydown', esc, true);
  scrim.addEventListener('mousedown', function (ev) { if (ev.target === scrim) close(); });
  U.append(panel, [
    h('div.devtop',
      h('div', h('div.small.muted', 'Developer · ' + (Api.envLabel() || 'not signed in')), h('h2', name)),
      h('span', { style: { flex: 1 } }),
      UI.btn('Postman', { sm: true, icon: 'download', onClick: function () { save(toolId + '.postman_collection.json', JSON.stringify(EP.postman(list, 'APIary · ' + name), null, 2)); } }),
      h('button.iconbtn', { type: 'button', title: 'Close', onclick: close }, U.icon('x', 18))),
    h('p.small.muted', list.length + ' endpoint' + (list.length === 1 ? '' : 's') + ' from the registry. Change them in Admin Settings → API endpoints. Query parameters the tool adds while running are not shown here.'),
    list.length ? h('div.devlist', list.map(function (e) { return endpointCard(e, toolId); })) : UI.empty('This tool has no registered endpoints.')
  ]);
  scrim.appendChild(panel);
  ctx.appEl.appendChild(scrim);
  requestAnimationFrame(function () { scrim.classList.add('on'); });
}

ctx.addCSS('dev-panel', [
  '.devscrim{place-items:stretch;justify-items:end}',
  '.devpanel{width:min(760px,96vw);height:100%;overflow:auto;background:var(--panel2);border-left:1px solid var(--line2);padding:20px 22px 40px;box-shadow:-30px 0 60px -30px var(--shadow);transform:translateX(40px);transition:transform .3s var(--ease)}',
  '.devscrim.on .devpanel{transform:none}',
  '.devtop{display:flex;align-items:center;gap:10px;margin-bottom:6px}.devtop h2{margin:2px 0 0;font-size:20px}',
  '.devlist{display:grid;gap:12px;margin-top:12px}',
  '.devcard{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:12px 14px}',
  '.devhead{display:flex;align-items:center;gap:10px}.devhead>div{flex:1;display:flex;flex-direction:column;min-width:0}.devhead code{font-size:11px}',
  '.meth{font:700 11px ui-monospace,Consolas,monospace;padding:3px 7px;border-radius:6px;background:var(--chipbg);color:var(--ink2)}',
  '.m-get{background:var(--okbg);color:var(--ok)}.m-post{background:var(--bluebg);color:var(--blue3)}.m-put{background:var(--warnbg);color:var(--honey)}.m-delete{background:var(--badbg);color:var(--bad)}',
  '.devurl{display:block;margin-top:8px;font:12px ui-monospace,Consolas,monospace;color:var(--ink2);word-break:break-all;background:var(--well);border:1px solid var(--line);border-radius:10px;padding:8px 10px}',
  '.devres{margin-top:10px}.devpre{max-height:420px;white-space:pre;overflow:auto}'
].join('\n'));

ctx.defineTool('dev-panel', { open: open });
