/* modules/api-automation.js — API Automation (Postman-style requests + bulk runs from Excel/CSV).
 * The endpoint is typed by the user and is always relative to the signed-in environment:
 *   <METHOD> /api/<endpoint>      METHOD = GET POST PUT PATCH DELETE HEAD OPTIONS
 *   AUTO (bulk only) = PUT /api/<endpoint with {{id}}> when the row has an id, else POST /api/<endpoint without the /{{id}} part>
 * A pasted cURL or full URL keeps only its path — requests never go to any other host, and the
 * Bearer token always comes from the current session (a pasted Authorization header is dropped). */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api;
var MOD = 'API Automation';

/* =========================================================
 * Constants (same as the old module)
 * ========================================================= */
var MAX_EDITABLE_ROWS_SHOWN = 100;
var HISTORY_KEY = 'bfAA_history_v1';   // same localStorage keys as the old tool, so history carries over
var SAVED_KEY = 'bfAA_saved_v1';
var BROWSER_ONLY_HEADERS = ['sec-ch-ua', 'sec-ch-ua-platform', 'sec-ch-ua-mobile', 'user-agent', 'referer', 'referrer',
  'accept-language', 'cookie', 'origin', 'sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest', 'sec-fetch-user',
  'host', 'content-length', 'connection', 'upgrade-insecure-requests', 'pragma', 'cache-control', 'te'];
var METHODS = [
  { value: 'GET', label: 'GET' }, { value: 'POST', label: 'POST' },
  { value: 'AUTO', label: 'AUTO (PUT if id, else POST)' },
  { value: 'PUT', label: 'PUT' }, { value: 'DELETE', label: 'DELETE' }, { value: 'PATCH', label: 'PATCH' },
  { value: 'HEAD', label: 'HEAD' }, { value: 'OPTIONS', label: 'OPTIONS' }
];
var EXAMPLE_JSON = {
  employee: { id: '1128201', active: true, attributes: { email: 'test@example.com', roles: [{ id: 1, name: 'Admin' }] } },
  remarks: null
};
var DELAYS = [{ value: 0, label: '0 ms (fastest)' }, { value: 100, label: '100 ms' }, { value: 250, label: '250 ms' }, { value: 500, label: '500 ms' }, { value: 1000, label: '1000 ms' }];
var READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

var CSS = [
  '.aa-top{display:flex;gap:10px;align-items:center;flex-wrap:wrap}',
  '.aa-top .aa-method{flex:0 0 200px;width:200px}',
  '.aa-top .aa-ep{flex:1;min-width:240px}',
  '.aa-url{font:12.5px/1.5 ui-monospace,Consolas,monospace;color:var(--blue3);word-break:break-all;margin-top:10px}',
  '.aa-mono{font:12.5px/1.5 ui-monospace,Consolas,monospace}',
  'textarea.aa-mono{min-height:180px}',
  '.aa-pre{white-space:pre-wrap;word-break:break-all;font:12px/1.55 ui-monospace,Consolas,monospace;background:#0C1626;border:1px solid var(--line);border-radius:10px;padding:10px 12px;max-height:420px;overflow:auto;color:var(--ink2);margin:8px 0}',
  '.aa-grid td,.aa-grid th{padding:4px 6px;max-width:none}',
  '.aa-in{width:100%;min-width:90px;background:transparent;border:1px solid transparent;color:var(--ink);padding:4px 6px;border-radius:6px;font:inherit;font-size:12.5px}',
  '.aa-in:hover{border-color:var(--line)}.aa-in:focus{border-color:var(--blue2);outline:none;background:#0C1626}',
  'th .aa-in{font-weight:700}',
  '.aa-mini{border:0;background:#1A2436;color:var(--ink2);border-radius:6px;font-size:11px;padding:2px 7px;cursor:pointer;margin:2px 2px 0 0}',
  '.aa-mini:hover{color:var(--ink)}.aa-mini.bad{color:var(--bad)}',
  '.aa-map{display:grid;grid-template-columns:minmax(0,1.4fr) auto minmax(0,1fr);gap:8px 14px;align-items:center;margin-top:10px;font-size:13px}',
  '.aa-map .hd{font-weight:600;color:var(--ink3);font-size:12px}',
  '.aa-map select.input{min-height:36px;padding:6px 10px}',
  '.aa-check{list-style:none;padding:0;margin:8px 0;font-size:13px}.aa-check li{padding:3px 0}',
  '.aa-check li.ok::before{content:"OK  ";color:var(--ok);font-weight:700}.aa-check li.bad::before{content:"FIX  ";color:var(--bad);font-weight:700}',
  '.aa-sec{margin-bottom:16px}.aa-sec>h3{margin:0 0 10px;font-size:15px}',
  '.aa-hist{max-height:340px;overflow:auto;margin:8px 0}',
  '.aa-hist button.it{display:flex;width:100%;justify-content:space-between;gap:12px;border:0;background:none;color:var(--ink);padding:8px 10px;border-radius:8px;text-align:left;cursor:pointer;font:inherit;font-size:13px}',
  '.aa-hist button.it:hover{background:var(--panel3)}',
  '.aa-seg{margin:0 0 12px;max-width:360px}'
].join('');

/* =========================================================
 * Small pure helpers (ported unchanged)
 * ========================================================= */
function lsGet(key) { try { var raw = window.localStorage.getItem(key); return raw ? JSON.parse(raw) : []; } catch (e) { return []; } }
function lsSet(key, val) { try { window.localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* ignore */ } }

function csvEscape(val) {
  var s = (val === null || val === undefined) ? '' : String(val);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}
function downloadCSV(filename, headers, rows) {
  var lines = [headers.map(csvEscape).join(',')];
  rows.forEach(function (r) { lines.push(headers.map(function (k) { return csvEscape(r[k]); }).join(',')); });
  var blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  var url = URL.createObjectURL(blob);
  var a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  ctx.Audit.onDownload(filename);
}
// Excel cells hold at most 32767 characters.
function cellText(v) { v = v == null ? '' : (typeof v === 'object' ? JSON.stringify(v) : v); return typeof v === 'string' && v.length > 32000 ? v.slice(0, 32000) + ' …(cut)' : v; }

/* JSON template flatten / rebuild / type conversion */
function flattenTemplate(obj, prefix) {
  var out = [];
  prefix = prefix || '';
  if (obj === null) { out.push({ path: prefix, type: 'null', sample: null }); return out; }
  if (Array.isArray(obj)) {
    obj.forEach(function (item, idx) { out = out.concat(flattenTemplate(item, prefix + '[' + idx + ']')); });
    return out;
  }
  if (typeof obj === 'object') {
    Object.keys(obj).forEach(function (k) { out = out.concat(flattenTemplate(obj[k], prefix ? prefix + '.' + k : k)); });
    return out;
  }
  out.push({ path: prefix, type: typeof obj, sample: obj });
  return out;
}
function tokenizePath(path) {
  var tokens = [], m, re = /([^.\[\]]+)|\[(\d+)\]/g;
  while ((m = re.exec(path)) !== null) tokens.push(m[1] !== undefined ? m[1] : m[2]);
  return tokens;
}
function setPath(root, path, value) {
  var tokens = tokenizePath(path), cur = root;
  for (var i = 0; i < tokens.length; i++) {
    var tok = tokens[i];
    if (i === tokens.length - 1) cur[tok] = value;
    else {
      if (cur[tok] === undefined || cur[tok] === null) cur[tok] = /^\d+$/.test(tokens[i + 1]) ? [] : {};
      cur = cur[tok];
    }
  }
}
function convertValue(raw, type) {
  if (raw === undefined || raw === null) raw = '';
  var s = String(raw).trim();
  if (type === 'boolean') {
    var lo = s.toLowerCase();
    if (lo === 'true') return true;
    if (lo === 'false') return false;
    return s === '' ? false : raw;
  }
  if (type === 'number') {
    if (s === '') return null;
    var n = Number(s);
    return isNaN(n) ? raw : n;
  }
  if (type === 'null') return s === '' ? null : raw;
  return String(raw);
}
function detectVariables(text) {
  var out = [], m, re = /\{\{(\w+)\}\}/g;
  while ((m = re.exec(text || '')) !== null) if (out.indexOf(m[1]) === -1) out.push(m[1]);
  return out;
}
function has(o, k) { return Object.prototype.hasOwnProperty.call(o, k); }

/* cURL parsing (Unix and Windows cmd "Copy as cURL") */
function tokenizeUnixShell(str) {
  var tokens = [], cur = '', quote = null;
  for (var i = 0; i < str.length; i++) {
    var c = str[i];
    if (quote) {
      if (c === '\\' && quote === '"' && (str[i + 1] === '"' || str[i + 1] === '\\')) { cur += str[i + 1]; i++; continue; }
      if (c === quote) { quote = null; continue; }
      cur += c; continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (/\s/.test(c)) { if (cur) { tokens.push(cur); cur = ''; } continue; }
    cur += c;
  }
  if (cur) tokens.push(cur);
  return tokens;
}
function tokenizeWindowsCmd(str) {
  str = str.replace(/\^\r?\n\s*/g, ' ');
  var tokens = [], cur = '', inQuote = false, i = 0;
  while (i < str.length) {
    if (inQuote) {
      // Chrome "Copy as cURL (cmd)" escapes an embedded quote as ^\^"
      if (str[i] === '^' && str[i + 1] === '\\' && str[i + 2] === '^' && str[i + 3] === '"') { cur += '"'; i += 4; continue; }
      if (str[i] === '\\' && str[i + 1] === '^' && str[i + 2] === '"') { cur += '"'; i += 3; continue; }
      if (str[i] === '^' && str[i + 1] === '"') { inQuote = false; i += 2; continue; }
      if (str[i] === '^' && str[i + 1] !== undefined) { cur += str[i + 1]; i += 2; continue; }
      cur += str[i]; i++; continue;
    }
    if (str[i] === '^' && str[i + 1] === '"') { inQuote = true; i += 2; continue; }
    if (/\s/.test(str[i])) { if (cur) { tokens.push(cur); cur = ''; } i++; continue; }
    if (str[i] === '^') { i++; continue; }
    cur += str[i]; i++;
  }
  if (cur) tokens.push(cur);
  return tokens;
}
function parseCurl(rawText) {
  var text = String(rawText || '').trim();
  var isWindows = /\^"/.test(text);
  var tokens = isWindows ? tokenizeWindowsCmd(text) : tokenizeUnixShell(text.replace(/\\\r?\n\s*/g, ' '));
  var result = { method: null, url: null, headers: [], body: null };
  var dataParts = [];
  for (var i = 0; i < tokens.length; i++) {
    var t = tokens[i];
    if (t === 'curl') continue;
    if (t === '--url') { result.url = tokens[++i]; continue; }
    if (t === '-X' || t === '--request') { result.method = (tokens[++i] || '').toUpperCase(); continue; }
    if (t === '-H' || t === '--header') {
      var hd = tokens[++i] || '';
      var idx = hd.indexOf(':');
      if (idx !== -1) result.headers.push({ key: hd.slice(0, idx).trim(), value: hd.slice(idx + 1).trim() });
      continue;
    }
    if (t === '--data' || t === '--data-raw' || t === '--data-binary' || t === '--data-ascii' || t === '-d') { dataParts.push(tokens[++i] || ''); continue; }
    if (t === '-u' || t === '--user') { i++; continue; }
    if (t === '-b' || t === '--cookie') { result.headers.push({ key: 'Cookie', value: tokens[++i] || '' }); continue; }
    if (t.charAt(0) !== '-' && !result.url && /^https?:\/\//i.test(t)) { result.url = t; continue; }
  }
  result.body = dataParts.length ? dataParts.join('&') : null;
  if (!result.method) result.method = result.body ? 'POST' : 'GET';
  return result;
}

/* Full URL → { envGuess, host, path } where path is relative to /api/ (old splitBaseAndPath). */
function splitBaseAndPath(url) {
  var envs = ctx.CONFIG.ENVIRONMENTS, envGuess = null, path = url, host = '';
  try { host = new URL(url).host; } catch (e) {}
  Object.keys(envs).forEach(function (key) {
    var base = envs[key].url.replace(/\/+$/, '') + '/api/';
    if (url.indexOf(base) === 0) { envGuess = key; path = url.slice(base.length); }
  });
  if (!envGuess) path = url.replace(/^https?:\/\/[^/]+\/?/, '').replace(/^api\//, '');
  return { envGuess: envGuess, host: host, path: path };
}

/* =========================================================
 * Tool
 * ========================================================= */
ctx.defineTool('api-automation', {
  desc: 'Send any Beeforce API request, or run the same request for every row of an Excel or CSV file.',
  render: function (view) {
    view.appendChild(h('style', CSS));

    /* ---------------- state ---------------- */
    var S = {
      headers: [],               // [{key, value, enabled}] custom headers; Authorization always comes from the session
      bodyMode: 'json',          // 'json' | 'raw' | 'none'
      bodyModeTouched: false,
      templateJSON: null, templateIsArrayRoot: false, templateLeaves: [],
      templateHeaderMap: {}, templateGenerated: false,
      pathParams: [],
      cols: [], rows: [],        // bulk input (headers + rows keyed by header)
      fileName: '',
      mapping: {}, pathParamMapping: {},
      plan: [],                  // resolved requests from the last review (what will be sent)
      results: [], running: false, validated: false, stoppedForAuth: false,
      lastRequest: null, lastResponse: null, responseViewMode: 'pretty',
      respCols: [], respRows: [], respSort: null,
      history: lsGet(HISTORY_KEY), saved: lsGet(SAVED_KEY),
      methodAutoManaged: true    // until the user picks a method, POST/PUT follows whether the endpoint ends in an id
    };

    /* ---------------- live readers ---------------- */
    var methodSel = UI.select(METHODS, 'POST'); methodSel.classList.add('aa-method');
    var endpointIn = UI.input({ placeholder: 'attendance/employee/update   (or attendance/shift_template_set/{{id}} for bulk)' }); endpointIn.classList.add('aa-ep');
    var jsonTa = UI.textarea({ placeholder: '{\n  "employeeId": "1128201",\n  "fieldId": "3941",\n  "newValue": "test@example.com"\n}' }); jsonTa.classList.add('aa-mono');
    var rawTa = UI.textarea({ placeholder: 'Raw request body. Use {{variable}} for bulk substitution.' }); rawTa.classList.add('aa-mono');

    function getMethod() { return methodSel.value || 'POST'; }
    // Always a path relative to /api/ — a full URL keeps only its path, a leading "/api/" is dropped.
    function getEndpoint() {
      var ep = endpointIn.value.trim();
      if (/^https?:\/\//i.test(ep)) ep = splitBaseAndPath(ep).path;
      return ep.replace(/^\/+/, '').replace(/^api\//, '');
    }
    function methodSupportsBody(m) { return ['POST', 'PUT', 'PATCH', 'AUTO'].indexOf(m) !== -1; }
    function bodyRequired() { return S.bodyMode !== 'none'; }
    function needsJsonTemplate() { return S.bodyMode === 'json'; }
    function endpointHasIdSegment(ep) { return /\/(\d+|\{\{[A-Za-z_]*[Ii][Dd][A-Za-z_]*\}\})$/.test((ep || '').replace(/\/+$/, '')); }
    function findIdParamName() { return S.pathParams.filter(function (p) { return p.toLowerCase() === 'id'; })[0] || null; }
    function baseUrl() { return (Api.state.base || '').replace(/\/+$/, '') + '/api/'; }
    function fullUrl(path) { return baseUrl() + path; }

    function autoConvertTrailingIdToPlaceholder() {
      var ep = getEndpoint();
      if (/\{\{[A-Za-z_]\w*\}\}\/?$/.test(ep)) return true;
      var m = ep.match(/^(.*\/)(\d+)\/?$/);
      if (m) { endpointIn.value = m[1] + '{{id}}'; return true; }
      return false;
    }
    function autoSuggestMethodFromEndpoint() {
      if (!S.methodAutoManaged) return;
      if (methodSel.value !== 'POST' && methodSel.value !== 'PUT') return;
      methodSel.value = endpointHasIdSegment(getEndpoint()) ? 'PUT' : 'POST';
      applyMethodBodyDefaults();
    }

    /* ---------------- request resolution ---------------- */
    function resolvePathForRow(row) {
      return getEndpoint().replace(/\{\{(\w+)\}\}/g, function (m, name) {
        var col = S.pathParamMapping[name] || name;
        return encodeURIComponent(has(row, col) ? (row[col] == null ? '' : row[col]) : '');
      });
    }
    // AUTO: row with an id → PUT to the full path; row without → POST to the path minus its trailing /{{var}}.
    function resolveMethodAndPathForRow(row) {
      var method = getMethod();
      if (method !== 'AUTO') return { method: method, path: resolvePathForRow(row) };
      var idParam = findIdParamName();
      var idCol = idParam ? S.pathParamMapping[idParam] : '';
      var idVal = idCol ? String(row[idCol] == null ? '' : row[idCol]).trim() : '';
      if (idVal) return { method: 'PUT', path: resolvePathForRow(row) };
      return { method: 'POST', path: getEndpoint().replace(/\/+$/, '').replace(/\/\{\{[A-Za-z_]\w*\}\}$/, '/') };
    }
    function buildBodyForRow(row) {
      if (S.bodyMode === 'raw') {
        return (rawTa.value || '').replace(/\{\{(\w+)\}\}/g, function (m, name) {
          var col = S.pathParamMapping[name] || name;
          return has(row, col) ? (row[col] == null ? '' : row[col]) : '';
        });
      }
      var root = S.templateIsArrayRoot ? [] : {};
      S.templateLeaves.forEach(function (leaf) {
        var col = S.mapping[leaf.path];
        var raw = (col && has(row, col)) ? row[col] : leaf.sample;
        setPath(root, leaf.path, convertValue(raw, leaf.type));
      });
      return root;
    }

    /* ---------------- headers actually sent ---------------- */
    function customHeaders() {
      return S.headers.filter(function (x) { return x.enabled && x.key && x.key.toLowerCase() !== 'authorization'; });
    }
    function contentKind() {
      var ct = customHeaders().filter(function (x) { return x.key.toLowerCase() === 'content-type'; })[0];
      return ct && /vnd\.api\+json/i.test(ct.value) ? 'vnd' : 'json';
    }
    // Headers Api.call sends: its defaults, then the custom ones from opts.headers on top (a custom Content-Type or
    // Accept replaces the default). Authorization and X-Client-Type always come from the session.
    function canonical(k) { var lo = k.toLowerCase(); return lo === 'content-type' ? 'Content-Type' : lo === 'accept' ? 'Accept' : k; }
    function sentHeaderLines(method, hasBody) {
      var hd = { Authorization: 'Bearer ********', Accept: 'application/json', 'X-Client-Type': 'Web' }, custom = {};
      if (!(method === 'GET' && !hasBody)) hd['Content-Type'] = contentKind() === 'vnd' ? 'application/vnd.api+json' : 'application/json';
      customHeaders().forEach(function (x) { if (x.key.toLowerCase() !== 'x-client-type') { var k = canonical(x.key); hd[k] = x.value; custom[k] = 1; } });
      return Object.keys(hd).map(function (k) { return k + ': ' + hd[k] + (custom[k] ? '   (custom)' : ''); });
    }
    // No retries are passed: Api.call retries GETs only, never a write (a resend could duplicate it). Old tool sent once too.
    async function send(method, path, body) {
      var extra = {};
      customHeaders().forEach(function (x) { extra[canonical(x.key)] = x.value; });
      var t0 = performance.now();
      var res = await Api.call(method, '/api/' + path, {
        body: body == null ? undefined : body, module: MOD, contentType: contentKind(), headers: extra
      });
      res.duration = (performance.now() - t0) / 1000;
      res.authExpired = res.status === 401;
      return res;
    }
    // Not counted as audit Created/Updated/Deleted: a hand-typed request is not a known record change (old tool never did).

    /* =====================================================
     * Top bar
     * ===================================================== */
    var urlPreview = h('div.aa-url');
    var autoHint = h('div.dim.small');
    var envWarn = h('div');
    var varsBox = h('div.muted.small', { style: { marginTop: '6px' } });
    var sendBtn = UI.btn('Send', { kind: 'primary', icon: 'play', onClick: sendSingleRequest });
    var topCard = h('div.card.aa-sec',
      h('div.aa-top',
        UI.chip(Api.envLabel(), Api.state.env === 'uat' ? 'upd' : 'new'),
        methodSel, endpointIn, sendBtn,
        UI.btn('History', { icon: 'clock', kind: 'quiet', onClick: openHistory }),
        UI.btn('Save', { icon: 'check', kind: 'quiet', onClick: saveDialog })),
      urlPreview, autoHint, varsBox, envWarn);

    function refreshTopBar() {
      autoSuggestMethodFromEndpoint();
      urlPreview.textContent = getMethod() + '  ' + fullUrl(getEndpoint());
      autoHint.textContent = S.methodAutoManaged ? 'Method follows the endpoint: ends in an id gives PUT, otherwise POST. Pick a method to turn this off.' : '';
      S.pathParams = detectAllVariables();
      varsBox.textContent = S.pathParams.length ? 'Variables found: ' + S.pathParams.map(function (p) { return '{{' + p + '}}'; }).join(', ') + ' — map each one to a column on the Bulk tab.' : '';
      invalidate();
    }
    function detectAllVariables() {
      var all = detectVariables(getEndpoint());
      if (S.bodyMode === 'raw') detectVariables(rawTa.value).forEach(function (v) { if (all.indexOf(v) === -1) all.push(v); });
      return all;
    }
    function applyMethodBodyDefaults() {
      if (S.bodyModeTouched) return;
      var want = methodSupportsBody(getMethod()) ? 'json' : 'none';
      if (S.bodyMode !== want) { S.bodyMode = want; syncBodyModeUI(); }
    }
    methodSel.addEventListener('change', function () { S.methodAutoManaged = false; applyMethodBodyDefaults(); refreshTopBar(); });
    endpointIn.addEventListener('input', refreshTopBar);
    // A pasted full URL keeps only its path, and we say where it will really go.
    endpointIn.addEventListener('change', function () {
      var v = endpointIn.value.trim();
      if (/^https?:\/\//i.test(v)) {
        var info = splitBaseAndPath(v);
        endpointIn.value = info.path;
        showEnvWarning(info);
      }
      refreshTopBar();
    });
    function showEnvWarning(info) {
      var envs = ctx.CONFIG.ENVIRONMENTS;
      if (info.envGuess && info.envGuess !== Api.state.env) {
        U.swap(envWarn, UI.note('warn', 'Different environment', 'This URL belongs to ' + envs[info.envGuess].label + ', but you are signed in to ' + Api.envLabel() + '. Only the path is kept — the request goes to ' + Api.envLabel() + '.'));
      } else if (!info.envGuess && info.host) {
        U.swap(envWarn, UI.note('warn', 'Not a Beeforce address', info.host + ' is not a Beeforce environment. Only the path is kept — the request goes to ' + Api.envLabel() + ', and your session is never sent anywhere else.'));
      } else U.clear(envWarn);
    }

    /* =====================================================
     * History / saved requests
     * ===================================================== */
    function currentRequestConfig() {
      return { method: getMethod(), endpoint: getEndpoint(), bodyMode: S.bodyMode, jsonText: jsonTa.value, rawBody: rawTa.value, headers: S.headers.map(function (x) { return { key: x.key, value: x.value, enabled: x.enabled }; }) };
    }
    function applyRequestConfig(cfg) {
      methodSel.value = cfg.method || 'GET';
      S.methodAutoManaged = false;
      endpointIn.value = cfg.endpoint || '';
      S.bodyModeTouched = true;
      S.bodyMode = cfg.bodyMode || 'none';
      jsonTa.value = cfg.jsonText || '';
      rawTa.value = cfg.rawBody || '';
      S.headers = (cfg.headers || []).filter(function (x) { return String(x.key || '').toLowerCase() !== 'authorization'; }).slice();
      syncBodyModeUI();
      renderHeadersTable();
      if (S.bodyMode === 'json' && cfg.jsonText) validateJSON(true);
      U.clear(envWarn);
      refreshTopBar();
    }
    function pushHistory(method, endpoint) {
      S.history = S.history.filter(function (x) { return !(x.method === method && x.endpoint === endpoint); });
      S.history.unshift({ method: method, endpoint: endpoint, ts: Date.now(), cfg: currentRequestConfig() });
      if (S.history.length > 20) S.history = S.history.slice(0, 20);
      lsSet(HISTORY_KEY, S.history);
    }
    function openHistory() {
      return UI.dialog(function (box, close) {
        var list = h('div');
        function item(x, onDel) {
          return h('div.row', { style: { alignItems: 'center', flexWrap: 'nowrap', gap: '6px' } },
            h('button.it', { type: 'button', onclick: function () { applyRequestConfig(x.cfg); close(); } },
              h('span', h('b', x.cfg.method + ' '), x.name ? x.name + ' — ' + x.cfg.endpoint : x.cfg.endpoint), h('span.dim.small', new Date(x.ts).toLocaleString())),
            onDel ? h('button.aa-mini.bad', { type: 'button', title: 'Delete', onclick: onDel }, 'Delete') : null);
        }
        function draw() {
          U.swap(list,
            h('h3', 'Saved requests'),
            S.saved.length ? h('div.aa-hist', S.saved.map(function (x, i) { return item(x, function () { S.saved.splice(i, 1); lsSet(SAVED_KEY, S.saved); draw(); }); })) : h('p.dim.small', 'Nothing saved yet. Use Save next to Send.'),
            h('h3', 'Recent requests'),
            S.history.length ? h('div.aa-hist', S.history.map(function (x) { return item({ cfg: x.cfg || { method: x.method, endpoint: x.endpoint }, ts: x.ts }); })) : h('p.dim.small', 'No recent requests yet.'));
        }
        draw();
        U.append(box, [h('h2', 'Requests'), list, h('div.acts',
          UI.btn('Clear history', { kind: 'quiet', icon: 'trash', onClick: function () { S.history = []; lsSet(HISTORY_KEY, []); draw(); } }),
          h('button.btn.primary', { type: 'button', onclick: function () { close(); } }, 'Close'))]);
      });
    }
    function saveDialog() {
      return UI.dialog(function (box, close) {
        var inp = UI.input({ placeholder: 'e.g. Update Overtime Policy', value: '' });
        function save() {
          var name = inp.value.trim() || (getMethod() + ' ' + getEndpoint());
          S.saved = S.saved.filter(function (s) { return s.name !== name; });
          S.saved.unshift({ name: name, ts: Date.now(), cfg: currentRequestConfig() });
          lsSet(SAVED_KEY, S.saved);
          UI.toast('Saved as "' + name + '".');
          close();
        }
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') save(); });
        U.append(box, [h('h2', 'Save this request'), h('p.muted.small', 'Method, endpoint, headers and body are saved in this browser. Your session token is never saved.'),
          UI.field('Name', inp), h('div.acts', h('button.btn.quiet', { type: 'button', onclick: function () { close(); } }, 'Cancel'), h('button.btn.primary', { type: 'button', onclick: save }, 'Save'))]);
      });
    }

    /* =====================================================
     * Tab: Import cURL
     * ===================================================== */
    var curlTa = UI.textarea({ placeholder: 'Paste a cURL command here (Chrome DevTools > Copy as cURL, bash or cmd, or plain curl)…' }); curlTa.classList.add('aa-mono');
    var curlStatus = h('div');
    var curlPane = h('div',
      UI.note('info', null, 'The method, path, headers and body are taken from the command. The address part is ignored: the request always goes to ' + Api.envLabel() + ', with your own session. A pasted Authorization header is dropped.'),
      curlTa,
      h('div.row', { style: { marginTop: '10px' } },
        UI.btn('Read cURL', { kind: 'primary', icon: 'check', onClick: importCurl }),
        UI.btn('Clear', { kind: 'quiet', onClick: function () { curlTa.value = ''; U.clear(curlStatus); } })),
      curlStatus);
    function importCurl() {
      var raw = curlTa.value;
      if (!raw.trim()) { U.swap(curlStatus, UI.note('bad', null, 'Paste a cURL command first.')); return; }
      var parsed;
      try { parsed = parseCurl(raw); } catch (e) { U.swap(curlStatus, UI.note('bad', 'Could not read it', e.message)); return; }
      if (!parsed.url) { U.swap(curlStatus, UI.note('bad', null, 'No URL found in that cURL command.')); return; }
      var info = splitBaseAndPath(parsed.url);
      endpointIn.value = info.path;
      if (parsed.method) {
        if (!METHODS.some(function (m) { return m.value === parsed.method; })) methodSel.appendChild(h('option', { value: parsed.method }, parsed.method));
        methodSel.value = parsed.method; S.methodAutoManaged = false;
      }
      var kept = [], ignored = 0;
      parsed.headers.forEach(function (x) {
        if (x.key.toLowerCase() === 'authorization') return; // never import a pasted token
        if (BROWSER_ONLY_HEADERS.indexOf(x.key.toLowerCase()) !== -1) { ignored++; return; }
        kept.push({ key: x.key, value: x.value, enabled: true });
      });
      S.headers = kept;
      renderHeadersTable();
      var bodyMsg = '';
      S.bodyModeTouched = true;
      if (parsed.body) {
        try {
          jsonTa.value = JSON.stringify(JSON.parse(parsed.body), null, 2);
          S.bodyMode = 'json';
          validateJSON(true);
        } catch (e) {
          S.bodyMode = 'raw'; rawTa.value = parsed.body;
          bodyMsg = ' The body is not valid JSON, so it was kept as raw text — check the Body tab.';
        }
      } else S.bodyMode = 'none';
      syncBodyModeUI();
      showEnvWarning(info);
      refreshTopBar();
      var autoGenerated = false;
      if (S.bodyMode === 'json' && S.templateJSON) autoGenerated = generateTemplate();
      U.swap(curlStatus, UI.note('ok', 'cURL read', (ignored ? ignored + ' browser-only header(s) ignored.' : 'All headers kept.') + bodyMsg +
        (autoGenerated ? ' A bulk template is ready on the Bulk tab — download it, fill it in, and upload.' : '')));
      tabsEl.open(autoGenerated ? 'bulk' : 'headers');
    }

    /* =====================================================
     * Tab: Headers
     * ===================================================== */
    var headersWrap = h('div');
    var headersPane = h('div',
      h('div.row', { style: { alignItems: 'center' } },
        UI.btn('Add header', { icon: 'list', sm: true, onClick: function () { S.headers.push({ key: '', value: '', enabled: true }); renderHeadersTable(); } }),
        h('span.dim.small', 'Authorization always comes from your session and cannot be changed here.')),
      UI.note('warn', null, 'Enabled custom headers are sent as typed, including Content-Type and Accept (they replace the defaults application/json). Authorization and X-Client-Type always come from your session.'),
      headersWrap);
    function renderHeadersTable() {
      var tb = h('tbody', h('tr', h('td', 'on'), h('td', 'Authorization'), h('td.dim', 'Bearer ******** (from your session)'), h('td')));
      S.headers.forEach(function (x, idx) {
        var cb = h('input', { type: 'checkbox', checked: !!x.enabled, onchange: function () { x.enabled = cb.checked; invalidate(); } });
        var k = h('input.aa-in', { value: x.key || '' }); UI.stopKeys(k); k.addEventListener('change', function () { x.key = k.value; invalidate(); });
        var v = h('input.aa-in', { value: x.value || '' }); UI.stopKeys(v); v.addEventListener('change', function () { x.value = v.value; invalidate(); });
        tb.appendChild(h('tr', h('td', cb), h('td', k), h('td', v), h('td', h('button.aa-mini.bad', { type: 'button', onclick: function () { S.headers.splice(idx, 1); renderHeadersTable(); invalidate(); } }, 'Remove'))));
      });
      U.swap(headersWrap, h('div.twrap.aa-grid', h('table', h('thead', h('tr', h('th', ''), h('th', 'Key'), h('th', 'Value'), h('th', ''))), tb)));
    }

    /* =====================================================
     * Tab: Body
     * ===================================================== */
    var jsonStatus = h('span.small');
    var seg = h('div.seg.aa-seg');
    var bodyJsonWrap = h('div', jsonTa,
      h('div.row', { style: { marginTop: '8px', alignItems: 'center' } },
        UI.btn('Validate', { sm: true, kind: 'quiet', onClick: function () { validateJSON(true); } }),
        UI.btn('Pretty', { sm: true, kind: 'quiet', onClick: function () { try { jsonTa.value = JSON.stringify(JSON.parse(jsonTa.value), null, 2); validateJSON(true); } catch (e) { setJsonStatus(false, 'Invalid JSON: ' + e.message); } } }),
        UI.btn('Minify', { sm: true, kind: 'quiet', onClick: function () { try { jsonTa.value = JSON.stringify(JSON.parse(jsonTa.value)); validateJSON(true); } catch (e) { setJsonStatus(false, 'Invalid JSON: ' + e.message); } } }),
        UI.btn('Copy', { sm: true, kind: 'quiet', onClick: copyJson }),
        UI.btn('Example', { sm: true, kind: 'quiet', onClick: function () { jsonTa.value = JSON.stringify(EXAMPLE_JSON, null, 2); validateJSON(true); } }),
        UI.btn('Clear', { sm: true, kind: 'quiet', onClick: function () { jsonTa.value = ''; S.templateJSON = null; S.templateLeaves = []; setJsonStatus(true, ''); invalidate(); } }),
        jsonStatus));
    var bodyRawWrap = h('div', rawTa, h('p.dim.small', 'Use {{variable}} anywhere in the text; each one becomes a column for bulk runs.'));
    var bodyNoneWrap = h('div', UI.empty('No body will be sent with this request.'));
    var bodyPane = h('div', seg, bodyJsonWrap, bodyRawWrap, bodyNoneWrap);
    [['json', 'JSON'], ['raw', 'Raw'], ['none', 'None']].forEach(function (m) {
      seg.appendChild(h('button', { type: 'button', 'data-m': m[0], onclick: function () { S.bodyMode = m[0]; S.bodyModeTouched = true; syncBodyModeUI(); refreshTopBar(); } }, m[1]));
    });
    function setJsonStatus(ok, msg) { jsonStatus.textContent = msg; jsonStatus.style.color = ok ? 'var(--ok)' : 'var(--bad)'; }
    function copyJson() {
      var txt = jsonTa.value;
      if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(txt).then(function () { setJsonStatus(true, 'Copied'); }, function () { setJsonStatus(false, 'Copy was blocked by the browser'); });
      jsonTa.select(); try { document.execCommand('copy'); setJsonStatus(true, 'Copied'); } catch (e) {}
    }
    function validateJSON(showStatus) {
      var text = jsonTa.value;
      try {
        if (!text.trim()) throw new Error('JSON body is empty.');
        var parsed = JSON.parse(text);
        S.templateJSON = parsed;
        S.templateIsArrayRoot = Array.isArray(parsed);
        S.templateLeaves = flattenTemplate(parsed);
        if (showStatus !== false) setJsonStatus(true, 'Valid — ' + S.templateLeaves.length + ' field(s)');
        return true;
      } catch (err) {
        S.templateJSON = null; S.templateLeaves = [];
        if (showStatus !== false) setJsonStatus(false, err.message);
        return false;
      } finally { invalidate(); }
    }
    function syncBodyModeUI() {
      Array.prototype.forEach.call(seg.children, function (b) { b.setAttribute('aria-pressed', b.dataset.m === S.bodyMode ? 'true' : 'false'); });
      bodyJsonWrap.hidden = S.bodyMode !== 'json';
      bodyRawWrap.hidden = S.bodyMode !== 'raw';
      bodyNoneWrap.hidden = S.bodyMode !== 'none';
    }
    jsonTa.addEventListener('blur', function () { if (jsonTa.value.trim()) validateJSON(true); });
    rawTa.addEventListener('input', refreshTopBar);

    /* =====================================================
     * Tab: Bulk
     * ===================================================== */
    var steps = UI.steps(['Template', 'Upload & map', 'Validate', 'Review & run', 'Results']);
    var STEP_DONE = [
      function () { return S.templateGenerated; },
      function () { return S.rows.length > 0; },
      function () { return S.validated; },
      function () { return S.results.length > 0; },
      function () { return S.results.length > 0 && !S.running; }
    ];
    function renderSteps() {
      var cur = STEP_DONE.length;
      for (var i = 0; i < STEP_DONE.length; i++) if (!STEP_DONE[i]()) { cur = i; break; }
      steps.set(cur);
    }
    // Anything that changes what would be sent drops the last review.
    function invalidate() {
      if (S.running) return;
      if (S.validated) { S.validated = false; S.plan = []; U.clear(checklist); U.clear(reviewBox); startBtn.disabled = true; }
      if (typeof renderSteps === 'function') renderSteps();
    }

    // ---- Quick ID list ----
    var idListIn = UI.input({ placeholder: 'e.g. 170,171,172' });
    var idListStatus = h('div');
    var quickSec = h('div.card.aa-sec', h('h3', 'Quick id list'),
      h('p.muted.small', 'Shortcut for runs that only need an id per row (DELETE, AUTO create/update, or any endpoint that only varies by {{id}}). An endpoint ending in a number, like …/overtime_policies/97, becomes …/overtime_policies/{{id}}.'),
      h('div.row', h('div', { style: { flex: 3, minWidth: '240px' } }, UI.field('Ids (comma-separated)', idListIn)),
        h('div', { style: { marginBottom: '12px' } }, UI.btn('Use these ids', { icon: 'bolt', onClick: buildFromIds }))),
      idListStatus);
    async function buildFromIds() {
      var ids = idListIn.value.split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; });
      if (!ids.length) { U.swap(idListStatus, UI.note('bad', null, 'Enter at least one id, comma-separated.')); return; }
      if (!autoConvertTrailingIdToPlaceholder()) {
        U.swap(idListStatus, UI.note('bad', null, 'The endpoint has nowhere to put an id. Make it end in a number or {{id}} first (e.g. attendance/overtime_policies/{{id}}).'));
        return;
      }
      refreshTopBar();
      loadInput(['id'], ids.map(function (id) { return { id: id }; }), 'Quick id list');
      await X.download('API_Automation_IDs.xlsx', [{ name: 'IDs', headers: ['id'], rows: ids.map(function (id) { return [id]; }), highlightCols: [0], tabColor: '0B5CC7' }]);
      var note = getMethod() === 'AUTO' ? ' Rows with a blank id would POST (create); every row here has one, so all ' + ids.length + ' will PUT.' : '';
      U.swap(idListStatus, UI.note('ok', null, ids.length + ' row(s) loaded below and saved as API_Automation_IDs.xlsx. Next: Validate.' + note));
    }

    // ---- 1. Template ----
    var tplPreview = h('div');
    var tplDownloadBtn = UI.btn('Download template', { icon: 'download', onClick: downloadTemplate });
    tplDownloadBtn.hidden = true;
    var tplSec = h('div.card.aa-sec', h('h3', '1. Template'),
      h('div.row', UI.btn('Make template', { icon: 'template', kind: 'primary', onClick: function () { generateTemplate(); } }), tplDownloadBtn),
      tplPreview);
    function templateKeys() {
      if (S.bodyMode === 'raw') return S.pathParams.slice();
      return S.pathParams.concat(S.bodyMode === 'json' ? S.templateLeaves.map(function (l) { return l.path; }) : []);
    }
    function ensureHeaderMapKeys(keys) {
      keys.forEach(function (k) { if (S.templateHeaderMap[k] === undefined) S.templateHeaderMap[k] = k; });
      Object.keys(S.templateHeaderMap).forEach(function (k) { if (keys.indexOf(k) === -1) delete S.templateHeaderMap[k]; });
    }
    function sampleFor(key) {
      var leaf = S.templateLeaves.filter(function (l) { return l.path === key; })[0];
      return leaf && leaf.sample !== null ? String(leaf.sample) : '';
    }
    function renderTemplatePreview() {
      var keys = templateKeys();
      if (!keys.length) { U.swap(tplPreview, UI.empty('Nothing to put in a template yet. Add {{variables}} to the endpoint or body, or enter a JSON body.')); return; }
      ensureHeaderMapKeys(keys);
      var hr = h('tr'), br = h('tr');
      keys.forEach(function (key) {
        var inp = h('input.aa-in', { value: S.templateHeaderMap[key] }); UI.stopKeys(inp);
        inp.addEventListener('change', function () { S.templateHeaderMap[key] = inp.value.trim() || key; });
        hr.appendChild(h('th', inp, S.pathParams.indexOf(key) !== -1 ? UI.chip('variable', 'upd') : null));
        br.appendChild(h('td', sampleFor(key)));
      });
      U.swap(tplPreview, h('p.dim.small', 'You can rename any column here before downloading — the upload is matched against these names.'),
        h('div.twrap.aa-grid', h('table', h('thead', hr), h('tbody', br))));
    }
    function generateTemplate() {
      if (needsJsonTemplate()) {
        if (!jsonTa.value.trim()) { setJsonStatus(false, 'A JSON body is needed for the template.'); tabsEl.open('body'); UI.toast('Enter a JSON body first (Body tab).', 'bad'); return false; }
        if (!validateJSON(true)) { tabsEl.open('body'); UI.toast('The JSON body is not valid.', 'bad'); return false; }
      }
      S.pathParams = detectAllVariables();
      renderTemplatePreview();
      tplDownloadBtn.hidden = !templateKeys().length;
      S.templateGenerated = templateKeys().length > 0;
      renderSteps();
      return true;
    }
    function downloadTemplate() {
      var keys = templateKeys();
      var headerRow = keys.map(function (k) { return S.templateHeaderMap[k] || k; });
      // Same as the old tool: one sample row with the JSON body's values (delete or overwrite it).
      return X.download('API_Automation_Template.xlsx', [{ name: 'API_Automation', headers: headerRow, rows: [keys.map(sampleFor)], highlightCols: headerRow.map(function (x, i) { return i; }), tabColor: '0B5CC7' }]);
    }

    // ---- 2. Upload, edit, map ----
    var dropZone = UI.drop({ hint: 'or click to choose · .xlsx, .xls or .csv', onFile: onUpload });
    var mismatchBox = h('div');
    var gridSummary = h('span.dim.small');
    var gridActions = h('div.row', { style: { alignItems: 'center', margin: '10px 0' } },
      UI.btn('Add column', { sm: true, kind: 'quiet', icon: 'list', onClick: addColumn }), gridSummary);
    var gridWrap = h('div');
    var mappingBox = h('div');
    var uploadSec = h('div.card.aa-sec', h('h3', '2. Upload & map'), dropZone, mismatchBox, gridActions, gridWrap, mappingBox);

    async function onUpload(f) {
      var file = await X.read(f);
      var cols = file.headers.filter(Boolean);
      if (!cols.length) throw new Error('The file looks empty.');
      var rows = file.rows.map(function (r) { var o = {}; cols.forEach(function (c) { o[c] = r[c] == null ? '' : r[c]; }); return o; });
      loadInput(cols, rows, f.name, true);
    }
    function loadInput(cols, rows, name, fromFile) {
      if (!fromFile) dropZone.reset();
      S.cols = cols.slice(); S.rows = rows; S.fileName = name || '';
      S.results = []; S.plan = []; S.validated = false;
      autoMap();
      var mm = checkUploadMatchesTemplate();
      U.swap(mismatchBox, mm ? UI.note('warn', 'Columns do not match the template', mm) : null);
      U.clear(resultsBox); U.clear(runHolder); U.clear(checklist); U.clear(reviewBox); startBtn.disabled = true;
      renderGrid(); renderMapping(); renderSteps();
    }
    function findMatch(expectedName, fallbackName) {
      function look(n) {
        return S.cols.filter(function (c) { return c === n; })[0] || S.cols.filter(function (c) { return c.toLowerCase() === n.toLowerCase(); })[0] || '';
      }
      return look(expectedName) || (fallbackName && fallbackName !== expectedName ? look(fallbackName) : '');
    }
    function autoMap(onlyMissing) {
      if (!onlyMissing) { S.mapping = {}; S.pathParamMapping = {}; }
      S.templateLeaves.forEach(function (leaf) { if (!S.mapping[leaf.path]) S.mapping[leaf.path] = findMatch(S.templateHeaderMap[leaf.path] || leaf.path, leaf.path); });
      S.pathParams.forEach(function (p) { if (!S.pathParamMapping[p]) S.pathParamMapping[p] = findMatch(S.templateHeaderMap[p] || p, p); });
    }
    function checkUploadMatchesTemplate() {
      var keys = templateKeys();
      if (!keys.length) return null;
      var expected = keys.map(function (k) { return S.templateHeaderMap[k] || k; });
      if (!expected.some(function (x) { return S.cols.indexOf(x) !== -1; })) {
        return 'None of this file\'s columns (' + S.cols.join(', ') + ') match the template (' + expected.join(', ') + '). Check it is the right file — you can still map columns by hand below.';
      }
      return null;
    }
    function renameCol(idx, newName) {
      var oldName = S.cols[idx];
      newName = newName.trim() || oldName;
      if (newName === oldName) return;
      S.cols[idx] = newName;
      S.rows.forEach(function (row) { row[newName] = row[oldName]; delete row[oldName]; });
      Object.keys(S.mapping).forEach(function (k) { if (S.mapping[k] === oldName) S.mapping[k] = newName; });
      Object.keys(S.pathParamMapping).forEach(function (k) { if (S.pathParamMapping[k] === oldName) S.pathParamMapping[k] = newName; });
    }
    function colAction(idx, act) {
      if (act === 'remove') {
        var name = S.cols[idx];
        S.cols.splice(idx, 1);
        S.rows.forEach(function (row) { delete row[name]; });
        Object.keys(S.mapping).forEach(function (k) { if (S.mapping[k] === name) S.mapping[k] = ''; });
        Object.keys(S.pathParamMapping).forEach(function (k) { if (S.pathParamMapping[k] === name) S.pathParamMapping[k] = ''; });
      } else if (act === 'left' && idx > 0) {
        var t = S.cols[idx - 1]; S.cols[idx - 1] = S.cols[idx]; S.cols[idx] = t;
      } else if (act === 'right' && idx < S.cols.length - 1) {
        var t2 = S.cols[idx + 1]; S.cols[idx + 1] = S.cols[idx]; S.cols[idx] = t2;
      }
      invalidate(); renderGrid(); renderMapping();
    }
    function addColumn() {
      var n = 1, name = 'column_1';
      while (S.cols.indexOf(name) !== -1) { n++; name = 'column_' + n; }
      S.cols.push(name);
      S.rows.forEach(function (row) { row[name] = ''; });
      invalidate(); renderGrid(); renderMapping();
    }
    function renderGrid() {
      gridActions.hidden = !S.cols.length;
      if (!S.cols.length) { U.clear(gridWrap); return; }
      var shown = Math.min(S.rows.length, MAX_EDITABLE_ROWS_SHOWN);
      gridSummary.textContent = (S.fileName ? S.fileName + ' · ' : '') + (S.rows.length > MAX_EDITABLE_ROWS_SHOWN
        ? 'Showing the first ' + shown + ' of ' + S.rows.length + ' rows for editing — all rows will run.'
        : S.rows.length + ' row(s). You can edit cells and rename columns here.');
      var hr = h('tr', h('th', '#'));
      S.cols.forEach(function (c, idx) {
        var inp = h('input.aa-in', { value: c }); UI.stopKeys(inp);
        inp.addEventListener('change', function () { renameCol(idx, inp.value); invalidate(); renderGrid(); renderMapping(); });
        hr.appendChild(h('th', inp, h('div',
          h('button.aa-mini', { type: 'button', title: 'Move left', onclick: function () { colAction(idx, 'left'); } }, '<'),
          h('button.aa-mini', { type: 'button', title: 'Move right', onclick: function () { colAction(idx, 'right'); } }, '>'),
          h('button.aa-mini.bad', { type: 'button', title: 'Remove column', onclick: function () { colAction(idx, 'remove'); } }, 'Remove'))));
      });
      var tb = h('tbody');
      S.rows.slice(0, shown).forEach(function (row, r) {
        var tr = h('tr', h('td.dim', String(r + 1)));
        S.cols.forEach(function (c) {
          var inp = h('input.aa-in', { value: row[c] == null ? '' : String(row[c]) }); UI.stopKeys(inp);
          inp.addEventListener('change', function () { row[c] = inp.value; invalidate(); });
          tr.appendChild(h('td', inp));
        });
        tb.appendChild(tr);
      });
      U.swap(gridWrap, h('div.twrap.aa-grid', { style: { maxHeight: '360px' } }, h('table', h('thead', hr), tb)));
    }
    // Only fields in use count (the old tool also counted leftovers from an earlier body, giving false "used twice").
    function mapCounts() {
      var counts = {};
      function add(c) { if (c) counts[c] = (counts[c] || 0) + 1; }
      (S.bodyMode === 'json' ? S.templateLeaves : []).forEach(function (l) { add(S.mapping[l.path]); });
      S.pathParams.forEach(function (p) { add(S.pathParamMapping[p]); });
      return counts;
    }
    function renderMapping() {
      var leaves = S.bodyMode === 'json' ? S.templateLeaves : [];
      if (!leaves.length && !S.pathParams.length) { U.clear(mappingBox); return; }
      if (!S.cols.length) { U.swap(mappingBox, h('p.dim.small', 'Upload a file to match its columns to the fields.')); return; }
      var counts = mapCounts();
      var grid = h('div.aa-map', h('div.hd', 'Field'), h('div.hd', 'Status'), h('div.hd', 'Column'));
      function line(label, type, cur, onPick) {
        var st = !cur ? UI.chip('Not mapped', 'bad') : counts[cur] > 1 ? UI.chip('Used twice', 'bad') : UI.chip('Mapped', 'ok');
        var sel = UI.select([{ value: '', label: '— not mapped —' }].concat(S.cols.map(function (c) { return { value: c, label: c }; })), cur || '');
        sel.addEventListener('change', function () { onPick(sel.value); invalidate(); renderMapping(); });
        U.append(grid, [h('div', label, ' ', h('span.dim.small', '(' + type + ')')), h('div', st), h('div', sel)]);
      }
      leaves.forEach(function (leaf) { line(leaf.path, leaf.type, S.mapping[leaf.path], function (v) { S.mapping[leaf.path] = v; }); });
      S.pathParams.forEach(function (p) { line('{{' + p + '}}', 'variable', S.pathParamMapping[p], function (v) { S.pathParamMapping[p] = v; }); });
      U.swap(mappingBox, h('h3', { style: { margin: '16px 0 0', fontSize: '14px' } }, 'Column mapping'), grid);
    }

    // ---- 3. Validate ----
    var delaySel = UI.select(DELAYS, 250);
    var checklist = h('ul.aa-check');
    var debugLine = h('div.dim.small.aa-mono', { style: { marginTop: '8px', wordBreak: 'break-all' } });
    var validateSec = h('div.card.aa-sec', h('h3', '3. Validate'),
      h('div.row', h('div', { style: { minWidth: '200px' } }, UI.field('Wait between requests', delaySel)),
        h('div', { style: { marginBottom: '12px' } }, UI.btn('Validate and review', { icon: 'eye', kind: 'primary', onClick: function () { runValidation(); } }))),
      checklist, debugLine);

    function runValidation() {
      if (S.running) return false;
      S.pathParams = detectAllVariables();
      if (needsJsonTemplate() && jsonTa.value.trim()) validateJSON(false);
      autoMap(true); // fill in any field that has no column yet (e.g. body changed after upload)
      renderMapping();
      var method = getMethod(), endpoint = getEndpoint();
      var checks = [], issues = 0;
      function pass(m) { checks.push({ ok: true, msg: m }); }
      function fail(m) { checks.push({ ok: false, msg: m }); issues++; }

      pass('Environment: ' + Api.envLabel() + ' (from your session)');
      pass('Method: ' + method + (method === 'AUTO' ? ' — PUT when a row has an id, POST when it does not' : ''));
      if (!endpoint) fail('Endpoint is empty'); else pass('Endpoint: ' + endpoint);
      if (method === 'AUTO' && !findIdParamName()) fail('AUTO needs an {{id}} variable in the endpoint (e.g. …/overtime_policies/{{id}}) so each row can become PUT or POST');
      if ((method === 'GET' || method === 'HEAD') && bodyRequired()) fail(method + ' requests cannot carry a body — set Body to None');
      if (needsJsonTemplate()) {
        if (!S.templateJSON) fail('JSON body is missing or not valid — check the Body tab');
        else pass('JSON body valid — ' + S.templateLeaves.length + ' field(s)');
      } else if (S.bodyMode === 'raw') pass('Raw body set' + (rawTa.value ? '' : ' (empty)'));
      else pass('No body will be sent');
      if (!S.rows.length) fail('No rows loaded'); else pass(S.rows.length + ' row(s) loaded');
      var leaves = S.bodyMode === 'json' ? S.templateLeaves : [];
      if (leaves.length) {
        var missing = leaves.filter(function (l) { return !S.mapping[l.path]; });
        if (missing.length) fail(missing.length + ' field(s) not mapped: ' + missing.map(function (l) { return l.path; }).join(', '));
        else pass('All JSON fields mapped');
      }
      var missingP = S.pathParams.filter(function (p) { return !S.pathParamMapping[p]; });
      if (missingP.length) fail('Variable(s) not mapped: ' + missingP.map(function (p) { return '{{' + p + '}}'; }).join(', '));
      else if (S.pathParams.length) pass('All variables mapped (' + S.pathParams.map(function (p) { return '{{' + p + '}} → ' + S.pathParamMapping[p]; }).join(', ') + ')');
      var counts = mapCounts();
      var dup = Object.keys(counts).filter(function (c) { return counts[c] > 1; });
      if (dup.length) fail('Same column mapped twice: ' + dup.join(', ')); else pass('No column mapped twice');
      if (Api.minutesLeft() > 0) pass('Session active (' + Api.minutesLeft() + ' min left)');
      else fail('Your session has expired — sign in again before running');

      U.swap(checklist, checks.map(function (c) { return h('li.' + (c.ok ? 'ok' : 'bad'), c.msg); }));
      debugLine.textContent = 'env: ' + Api.state.env + ' · method: ' + method + ' · endpoint: "' + endpoint + '" · body: ' + S.bodyMode +
        ' · rows: ' + S.rows.length + ' · mapped fields: ' + leaves.filter(function (l) { return S.mapping[l.path]; }).length + '/' + leaves.length + ' · checked ' + new Date().toLocaleTimeString();
      S.validated = issues === 0;
      S.plan = S.validated ? buildPlan() : [];
      renderReview();
      startBtn.disabled = !S.validated;
      renderSteps();
      return S.validated;
    }

    // ---- 4. Review & run ----
    var reviewBox = h('div');
    var startBtn = UI.btn('Start', { kind: 'primary', icon: 'play', onClick: function () { return startRun(); } });
    startBtn.disabled = true;
    var runHolder = h('div');
    var runSec = h('div.card.aa-sec', h('h3', '4. Review & run'),
      h('p.dim.small', 'Validate first. The list below is exactly what will be sent, one request per row.'),
      reviewBox, h('div.row', { style: { marginTop: '10px' } }, startBtn), runHolder);

    function bodyText(b) { return b == null ? '' : typeof b === 'string' ? b : JSON.stringify(b); }
    function buildPlan() {
      return S.rows.map(function (row, i) {
        var r = resolveMethodAndPathForRow(row);
        return { rowIndex: i, row: i + 1, method: r.method, path: r.path, url: fullUrl(r.path), body: bodyRequired() ? buildBodyForRow(row) : null };
      });
    }
    function renderReview() {
      if (!S.validated) { U.clear(reviewBox); return; }
      var by = {};
      S.plan.forEach(function (p) { by[p.method] = (by[p.method] || 0) + 1; });
      var first = S.plan[0];
      U.swap(reviewBox,
        UI.counts(Object.keys(by).map(function (m) { return { n: by[m], label: m, kind: READ_METHODS.indexOf(m) >= 0 ? '' : 'new' }; })),
        getMethod() === 'AUTO' ? UI.note('info', null, (by.PUT || 0) + ' row(s) will PUT (update), ' + (by.POST || 0) + ' row(s) will POST (create).') : null,
        h('details', h('summary.small.muted', 'Headers sent with every request'), h('pre.aa-pre', sentHeaderLines(first && first.method, first && first.body != null).join('\n'))),
        UI.table([
          { key: 'row', label: 'Row' },
          { key: 'method', label: 'Method', render: function (p) { return UI.chip(p.method, READ_METHODS.indexOf(p.method) >= 0 ? '' : p.method === 'DELETE' ? 'bad' : 'new'); } },
          { key: 'url', label: 'URL', wrap: true },
          { key: 'body', label: 'Body', wrap: true, render: function (p) { var t = bodyText(p.body); return h('span.aa-mono.small', t.length > 300 ? t.slice(0, 297) + '…' : t || '—'); }, text: function (p) { return bodyText(p.body); } }
        ], S.plan, { rowKey: function (p) { return String(p.rowIndex); }, limit: 300 }));
    }
    async function startRun() {
      if (!runValidation()) { UI.toast('Fix the items marked FIX first.', 'bad'); return; }
      await runPlan(S.plan.slice(), false);
    }
    async function runPlan(plan, isRetry) {
      var writes = plan.filter(function (p) { return p.method !== 'GET'; });
      if (writes.length) {
        var by = {};
        writes.forEach(function (p) { by[p.method] = (by[p.method] || 0) + 1; });
        var ok = await UI.confirm({
          title: 'Send ' + plan.length + ' request' + (plan.length === 1 ? '' : 's') + '?',
          body: h('div', h('p.muted', Object.keys(by).map(function (m) { return by[m] + ' ' + m; }).join(', ') + ' to /api/' + getEndpoint() + '.'),
            h('p.muted.small', 'Every row is sent as shown in the review.')),
          verb: 'Send ' + plan.length, danger: !!by.DELETE
        });
        if (!ok) return;
      }
      S.running = true; S.stoppedForAuth = false;
      if (!isRetry) S.results = [];
      ctx.Audit.newTransaction();
      var delayMs = +delaySel.value || 0;
      var panel = UI.runPanel('Sending ' + plan.length + ' request' + (plan.length === 1 ? '' : 's') + ' to ' + Api.envLabel());
      U.swap(runHolder, panel);
      panel.set(0, plan.length);
      var okN = 0, failN = 0, done = 0;
      for (var i = 0; i < plan.length; i++) {
        while (panel.ctrl.paused && !panel.ctrl.stopped) await U.sleep(200);
        if (panel.ctrl.stopped) { panel.log('Stopped. ' + (plan.length - i) + ' request(s) not sent.', 'w'); break; }
        var p = plan[i];
        var res = await send(p.method, p.path, p.body);
        var rec = {
          rowIndex: p.rowIndex, row: p.row, method: p.method, url: p.url, path: p.path,
          status: res.ok ? 'Success' : 'Failed', httpStatus: res.status, duration: res.duration,
          requestBody: p.body, response: res.text || '',
          error: res.ok ? '' : (res.authExpired ? 'Session expired (401) — sign in again, then use Retry failed.' : Api.parseError(res.text))
        };
        var at = S.results.map(function (r) { return r.rowIndex; }).indexOf(p.rowIndex);
        if (isRetry && at !== -1) S.results[at] = rec; else S.results.push(rec);
        done++;
        if (res.ok) { okN++; panel.log('OK  row ' + p.row + ' · ' + p.method + ' ' + p.path + ' · HTTP ' + res.status, 'o'); }
        else { failN++; panel.log('FAILED  row ' + p.row + ' · ' + p.method + ' ' + p.path + ' · HTTP ' + res.status + ': ' + rec.error, 'e'); }
        panel.set(done, plan.length, okN + ' ok · ' + failN + ' failed');
        if (res.authExpired) { S.stoppedForAuth = true; panel.log('Stopped early: the session expired (401).', 'w'); break; }
        if (delayMs && i < plan.length - 1) await U.sleep(delayMs);
      }
      panel.finish(okN + ' succeeded · ' + failN + ' failed' + (done < plan.length ? ' · ' + (plan.length - done) + ' not sent' : ''));
      S.running = false;
      ctx.Shell && ctx.Shell.noteRun(MOD, okN, failN);
      if (getMethod() === 'GET') buildBulkGetCombinedTable();
      renderResults();
      renderSteps();
    }

    // ---- 5. Results ----
    var resultsBox = h('div');
    var resultsSec = h('div.card.aa-sec', h('h3', '5. Results'), resultsBox);
    function renderResults() {
      if (!S.results.length) { U.swap(resultsBox, h('p.dim.small', 'Results appear here after a run.')); return; }
      var ok = S.results.filter(function (r) { return r.status === 'Success'; }).length, failed = S.results.length - ok;
      U.swap(resultsBox,
        UI.counts([{ n: ok, label: 'Succeeded', kind: 'ok' }, { n: failed, label: 'Failed', kind: 'bad' }]),
        getMethod() === 'GET' && ok ? UI.note('info', null, 'The responses are combined into one table on the Response tab, ready to export or to use as the input of the next request.') : null,
        h('div.acts', { style: { justifyContent: 'flex-start', margin: '6px 0 10px' } },
          UI.btn('Download results', { icon: 'download', kind: 'primary', onClick: downloadResults }),
          failed ? UI.btn('Download failed rows', { icon: 'download', onClick: downloadFailed }) : null,
          failed ? UI.btn('Retry ' + failed + ' failed', { icon: 'retry', onClick: retryFailed }) : null,
          getMethod() === 'GET' && ok ? UI.btn('Open responses', { icon: 'list', kind: 'quiet', onClick: function () { tabsEl.open('response'); } }) : null),
        UI.table([
          { key: 'row', label: 'Row' },
          { key: 'status', label: 'Result', render: function (r) { return UI.chip(r.status === 'Success' ? 'OK' : 'Failed', r.status === 'Success' ? 'ok' : 'bad'); } },
          { key: 'httpStatus', label: 'HTTP' },
          { key: 'method', label: 'Method' },
          { key: 'path', label: 'Path', wrap: true },
          { key: 'duration', label: 'Time', render: function (r) { return r.duration.toFixed(2) + 's'; } },
          { key: 'error', label: 'Message', wrap: true },
          { key: 'd', label: '', render: function (r) { return h('button.aa-mini', { type: 'button', onclick: function () { showDetails(r); } }, 'Details'); } }
        ], S.results, { rowKey: function (r) { return String(r.rowIndex); } }));
    }
    function showDetails(r) {
      var pretty = r.response;
      try { pretty = JSON.stringify(JSON.parse(r.response), null, 2); } catch (e) {}
      UI.dialog(function (box, close) {
        U.append(box, [h('h2', 'Row ' + r.row + ' · ' + r.method + ' · HTTP ' + r.httpStatus),
          h('pre.aa-pre', 'URL: ' + r.url + '\n\nRequest body:\n' + (r.requestBody != null ? (typeof r.requestBody === 'string' ? r.requestBody : JSON.stringify(r.requestBody, null, 2)) : '(none)') +
            '\n\nResponse:\n' + (pretty || '') + (r.error ? '\n\nError: ' + r.error : '')),
          h('div.acts', h('button.btn.primary', { type: 'button', onclick: function () { close(); } }, 'Close'))]);
      });
    }
    function downloadResults() {
      var H = ['RowNumber', 'Status', 'HTTPStatus', 'Method', 'URL', 'Duration', 'Response', 'ErrorMessage', 'RequestBody'];
      return X.download('API_Automation_Result_' + U.stamp() + '.xlsx', [{ name: 'Result', tabColor: '0B5CC7', headers: H,
        rows: S.results.map(function (r) { return [r.row, r.status, r.httpStatus, r.method, r.url, Number(r.duration.toFixed(3)), cellText(r.response), r.error, cellText(r.requestBody)]; }) }]);
    }
    function downloadFailed() {
      var failedRows = S.results.filter(function (r) { return r.status === 'Failed'; }).map(function (r) { return S.rows[r.rowIndex] || {}; });
      if (!failedRows.length) return;
      return X.download('API_Automation_Failed_Records_' + U.stamp() + '.xlsx', [{ name: 'Failed', tabColor: 'DC2626', headers: S.cols.slice(),
        rows: failedRows.map(function (row) { return S.cols.map(function (c) { return cellText(row[c]); }); }), highlightCols: S.cols.map(function (c, i) { return i; }) }]);
    }
    // Like the old tool: rebuild each failed row's request from the CURRENT rows, endpoint, body and mapping
    // (edits after the run are used), not from the plan of the last run.
    async function retryFailed() {
      if (S.running) return;
      if (Api.minutesLeft() <= 0) { UI.toast('Your session has expired. Sign in again before retrying.', 'bad'); return; }
      var idx = S.results.filter(function (r) { return r.status === 'Failed' && r.rowIndex < S.rows.length; }).map(function (r) { return r.rowIndex; });
      if (!idx.length) return;
      if (!runValidation()) { UI.toast('Fix the items marked FIX first, then retry.', 'bad'); return; }
      var plan = S.plan.filter(function (p) { return idx.indexOf(p.rowIndex) !== -1; });
      if (!plan.length) return;
      await runPlan(plan, true);
    }

    function resetBulkSilently() {
      S.templateHeaderMap = {}; S.templateGenerated = false; S.cols = []; S.rows = []; S.fileName = ''; S.mapping = {}; S.pathParamMapping = {};
      S.results = []; S.plan = []; S.validated = false;
      U.clear(tplPreview); tplDownloadBtn.hidden = true; dropZone.reset(); U.clear(mismatchBox); U.clear(checklist); debugLine.textContent = '';
      U.clear(reviewBox); U.clear(runHolder); startBtn.disabled = true; U.swap(idListStatus);
      renderGrid(); renderMapping(); renderResults(); renderSteps();
    }
    function ask(title, text, verb) {
      return UI.dialog(function (box, close) {
        U.append(box, [h('h2', title), h('p.muted', text), h('div.acts',
          h('button.btn.quiet', { type: 'button', onclick: function () { close(false); } }, 'Cancel'),
          h('button.btn.primary', { type: 'button', onclick: function () { close(true); } }, verb))]);
      }).then(function (v) { return v === true; });
    }
    async function resetBulk() {
      if (S.running) { UI.toast('A run is in progress — stop it first.', 'bad'); return; }
      if (await ask('Reset bulk?', 'This clears the uploaded rows, mapping and results. The endpoint, method and body stay.', 'Reset')) resetBulkSilently();
    }
    async function resetEverything() {
      if (S.running) { UI.toast('A run is in progress — stop it first.', 'bad'); return; }
      if (!(await ask('Reset everything?', 'This clears the request, headers, body, uploaded rows and all results.', 'Reset all'))) return;
      curlTa.value = ''; U.clear(curlStatus); endpointIn.value = ''; methodSel.value = 'GET';
      S.headers = []; S.bodyMode = 'json'; S.bodyModeTouched = false;
      jsonTa.value = ''; rawTa.value = ''; S.templateJSON = null; S.templateLeaves = [];
      setJsonStatus(true, ''); renderHeadersTable(); syncBodyModeUI(); U.clear(envWarn);
      S.lastRequest = null; S.lastResponse = null; S.respCols = []; S.respRows = [];
      renderResponse(); renderRespTable();
      resetBulkSilently();
      refreshTopBar();
    }
    var bulkPane = h('div', steps, quickSec, tplSec, uploadSec, validateSec, runSec, resultsSec,
      h('div.row', UI.btn('Reset bulk', { kind: 'quiet', icon: 'retry', onClick: resetBulk })));

    /* =====================================================
     * Single request — Send
     * ===================================================== */
    async function sendSingleRequest() {
      var method = getMethod();
      if (method === 'AUTO') { UI.toast('AUTO is for bulk runs only. Pick PUT or POST for a single request, or use the Bulk tab.', 'bad'); return; }
      var ep = getEndpoint();
      if (!ep) { UI.toast('Enter an endpoint first.', 'bad'); return; }
      if (/\{\{\w+\}\}/.test(ep)) { UI.toast('The endpoint still has {{variables}}. Replace them, or use the Bulk tab.', 'bad'); return; }
      if (S.bodyMode === 'json' && jsonTa.value.trim() && !validateJSON(true)) { tabsEl.open('body'); UI.toast('The JSON body is not valid.', 'bad'); return; }
      var bodyVal = null;
      if (S.bodyMode === 'json' && jsonTa.value.trim()) bodyVal = S.templateJSON;
      else if (S.bodyMode === 'raw') bodyVal = rawTa.value || null;
      if ((method === 'GET' || method === 'HEAD') && bodyVal != null) { UI.toast(method + ' requests cannot carry a body. Set Body to None.', 'bad'); tabsEl.open('body'); return; }
      var url = fullUrl(ep);
      var hdrLines = sentHeaderLines(method, bodyVal != null);
      if (method !== 'GET') {
        var bt = bodyVal == null ? '' : typeof bodyVal === 'string' ? bodyVal : JSON.stringify(bodyVal, null, 2);
        var ok = await UI.confirm({ title: 'Send this ' + method + ' request?',
          body: h('div', h('pre.aa-pre', method + ' ' + url + (bt ? '\n\n' + (bt.length > 1500 ? bt.slice(0, 1500) + '\n…' : bt) : ''))),
          verb: 'Send ' + method, danger: method === 'DELETE' });
        if (!ok) return;
      }
      var res = await send(method, ep, bodyVal);
      S.lastRequest = { method: method, url: url, headerLines: hdrLines, body: bodyVal };
      S.lastResponse = { status: res.status, ok: res.ok, text: res.text || '', duration: res.duration, authExpired: res.authExpired };
      pushHistory(method, ep);
      if (method === 'GET' && res.ok) {
        var arr = null;
        try { var parsed = JSON.parse(res.text); arr = Array.isArray(parsed) ? parsed : (parsed && Array.isArray(parsed.content) ? parsed.content : (parsed && Array.isArray(parsed.data) ? parsed.data : null)); } catch (e) {}
        if (arr && arr.length) buildResponseTable(arr); else { S.respCols = []; S.respRows = []; renderRespTable(); }
      }
      renderResponse();
      tabsEl.open('response');
    }

    /* =====================================================
     * Tab: Response (+ response table)
     * ===================================================== */
    var responseBox = h('div');
    var respSearch = UI.input({ placeholder: 'Search rows' });
    var respTableWrap = h('div');
    var respInfo = h('span.dim.small');
    var respSection = h('div.card.aa-sec', h('h3', 'Response data'),
      h('p.dim.small', 'Tick the columns to keep, rename them in the header, and sort. Downloads include every row.'),
      h('div.tbar', respSearch, respInfo, h('div.acts', { style: { marginLeft: 'auto', marginTop: 0 } },
        UI.btn('Select all', { sm: true, kind: 'quiet', onClick: function () { S.respCols.forEach(function (c) { c.selected = true; }); renderRespTable(); } }),
        UI.btn('Clear all', { sm: true, kind: 'quiet', onClick: function () { S.respCols.forEach(function (c) { c.selected = false; }); renderRespTable(); } }),
        UI.btn('Download CSV', { sm: true, icon: 'download', onClick: function () { return exportResp('csv'); } }),
        UI.btn('Download Excel', { sm: true, icon: 'download', kind: 'primary', onClick: function () { return exportResp('xlsx'); } }),
        UI.btn('Use as bulk input', { sm: true, icon: 'upload', onClick: useRespAsInput }))),
      respTableWrap);
    var responsePane = h('div', responseBox, respSection);
    var tm;
    respSearch.addEventListener('input', function () { clearTimeout(tm); tm = setTimeout(renderRespTable, 120); });

    function renderResponse() {
      if (!S.lastResponse) { U.swap(responseBox, UI.empty('Use Send to make a request. Its response shows here.')); return; }
      var res = S.lastResponse, req = S.lastRequest;
      var pretty = res.text;
      try { pretty = JSON.stringify(JSON.parse(res.text), null, 2); } catch (e) {}
      var toggle = h('button.aa-mini', { type: 'button', onclick: function () { S.responseViewMode = S.responseViewMode === 'pretty' ? 'raw' : 'pretty'; renderResponse(); } }, S.responseViewMode === 'pretty' ? 'Show raw' : 'Show pretty');
      U.swap(responseBox, h('div.card.aa-sec',
        h('div.row', { style: { alignItems: 'center' } }, UI.chip((res.ok ? 'OK' : 'Failed') + ' · HTTP ' + res.status, res.ok ? 'ok' : 'bad'), h('span.muted.small', res.duration.toFixed(2) + 's'),
          res.authExpired ? h('span.small', { style: { color: 'var(--bad)' } }, 'Session expired — sign in again') : null),
        h('h3', { style: { margin: '14px 0 0', fontSize: '14px' } }, 'Request'),
        h('pre.aa-pre', req.method + ' ' + req.url + '\n\nHeaders:\n' + req.headerLines.join('\n') +
          (req.body != null ? '\n\nBody:\n' + (typeof req.body === 'string' ? req.body : JSON.stringify(req.body, null, 2)) : '')),
        h('h3', { style: { margin: '14px 0 0', fontSize: '14px' } }, 'Response ', toggle),
        h('pre.aa-pre', S.responseViewMode === 'pretty' ? pretty : res.text)));
    }
    function buildResponseTable(arrayOfObjects) {
      var seen = {}, paths = [];
      arrayOfObjects.forEach(function (obj) { flattenTemplate(obj).forEach(function (l) { if (!seen[l.path]) { seen[l.path] = 1; paths.push(l.path); } }); });
      S.respCols = paths.map(function (p) { return { path: p, header: p, selected: true }; });
      S.respRows = arrayOfObjects.map(function (obj) {
        var row = {};
        flattenTemplate(obj).forEach(function (l) { row[l.path] = l.sample === null ? '' : l.sample; });
        return row;
      });
      S.respSort = null;
      renderRespTable();
    }
    function buildBulkGetCombinedTable() {
      var combined = S.results.filter(function (r) { return r.status === 'Success'; }).map(function (r) {
        var input = S.rows[r.rowIndex] || {};
        var parsed = null;
        try { parsed = JSON.parse(r.response); } catch (e) {}
        var obj = {};
        Object.keys(input).forEach(function (k) { obj[k] = input[k]; });
        obj.response = parsed !== null ? parsed : r.response;
        return obj;
      });
      if (combined.length) buildResponseTable(combined);
    }
    function sortedRows() {
      var rows = S.respRows;
      if (S.respSort) {
        var sp = S.respSort;
        rows = rows.slice().sort(function (a, b) {
          var av = a[sp.path], bv = b[sp.path];
          if (av === bv) return 0;
          var cmp = (av === undefined || av === null) ? -1 : (bv === undefined || bv === null) ? 1 : (av > bv ? 1 : -1);
          return sp.dir === 'desc' ? -cmp : cmp;
        });
      }
      return rows;
    }
    function renderRespTable() {
      respSection.hidden = !S.respCols.length;
      if (!S.respCols.length) { U.clear(respTableWrap); return; }
      var q = respSearch.value.toLowerCase();
      var cols = S.respCols;
      var rows = sortedRows();
      var shown = q ? rows.filter(function (r) { return cols.some(function (c) { return c.selected && String(r[c.path] == null ? '' : r[c.path]).toLowerCase().indexOf(q) !== -1; }); }) : rows;
      var hr = h('tr');
      cols.forEach(function (c) {
        var cb = h('input', { type: 'checkbox', checked: c.selected, title: 'Keep this column', onchange: function () { c.selected = cb.checked; respInfo.textContent = info(); } });
        var inp = h('input.aa-in', { value: c.header, style: { minWidth: '110px' } }); UI.stopKeys(inp);
        inp.addEventListener('change', function () { c.header = inp.value.trim() || c.path; });
        var ind = S.respSort && S.respSort.path === c.path ? (S.respSort.dir === 'asc' ? ' (asc)' : ' (desc)') : '';
        hr.appendChild(h('th', h('div', { style: { display: 'flex', gap: '6px', alignItems: 'center' } }, cb, inp),
          h('button.aa-mini', { type: 'button', onclick: function () {
            if (S.respSort && S.respSort.path === c.path) S.respSort.dir = S.respSort.dir === 'asc' ? 'desc' : 'asc';
            else S.respSort = { path: c.path, dir: 'asc' };
            renderRespTable();
          } }, 'Sort' + ind)));
      });
      var tb = h('tbody');
      shown.slice(0, 200).forEach(function (row) {
        tb.appendChild(h('tr', cols.map(function (c) { var v = row[c.path] == null ? '' : String(row[c.path]); return h('td', { title: v }, v); })));
      });
      function info() { return S.respRows.length + ' row(s) · ' + cols.filter(function (c) { return c.selected; }).length + ' of ' + cols.length + ' column(s) kept'; }
      respInfo.textContent = info();
      U.swap(respTableWrap, h('div.twrap.aa-grid', h('table', h('thead', hr), tb)),
        shown.length > 200 ? h('div.tmore', 'Showing the first 200 of ' + shown.length + ' matching rows — downloads include all rows.') : null);
    }
    function keptColumns() {
      var cols = S.respCols.filter(function (c) { return c.selected; });
      if (!cols.length) throw new Error('Tick at least one column first.');
      return cols;
    }
    function exportResp(kind) {
      var cols = keptColumns();
      var headers = cols.map(function (c) { return c.header; });
      var rows = sortedRows();
      if (kind === 'csv') {
        downloadCSV('API_Automation_Response.csv', headers, rows.map(function (row) { var r = {}; cols.forEach(function (c) { r[c.header] = row[c.path]; }); return r; }));
        return;
      }
      return X.download('API_Automation_Response.xlsx', [{ name: 'Data', headers: headers, rows: rows.map(function (row) { return cols.map(function (c) { return cellText(row[c.path]); }); }) }]);
    }
    // New in v3: chain requests — the kept columns (with their names) become the rows of the next bulk run.
    function useRespAsInput() {
      var cols = keptColumns();
      var names = cols.map(function (c) { return c.header; });
      var dupe = names.filter(function (n, i) { return names.indexOf(n) !== i; })[0];
      if (dupe) throw new Error('Two columns are named "' + dupe + '". Rename one first.');
      var rows = sortedRows().map(function (row) { var r = {}; cols.forEach(function (c) { r[c.header] = row[c.path] == null ? '' : row[c.path]; }); return r; });
      loadInput(names, rows, 'Response data');
      tabsEl.open('bulk');
      UI.toast(rows.length + ' row(s) loaded as bulk input. Set the next method, endpoint and body, then Validate.');
    }

    /* =====================================================
     * Assemble
     * ===================================================== */
    var tabsEl = UI.tabs([
      { id: 'curl', label: 'Import cURL', render: function (b) { b.appendChild(curlPane); } },
      { id: 'headers', label: 'Headers', render: function (b) { b.appendChild(headersPane); } },
      { id: 'body', label: 'Body', render: function (b) { b.appendChild(bodyPane); } },
      { id: 'bulk', label: 'Bulk', render: function (b) { b.appendChild(bulkPane); } },
      { id: 'response', label: 'Response', render: function (b) { b.appendChild(responsePane); } }
    ]);
    U.append(view, [topCard, tabsEl,
      h('div.row', { style: { marginTop: '18px' } }, UI.btn('Reset everything', { kind: 'quiet', icon: 'retry', onClick: resetEverything }))]);

    renderHeadersTable();
    syncBodyModeUI();
    applyMethodBodyDefaults();
    refreshTopBar();
    renderGrid(); renderMapping(); renderResults(); renderResponse(); renderRespTable(); renderSteps();
  }
});
