/* core/api.js — session state, sign-in and every call to Beeforce. */
'use strict';

var C = ctx.CONFIG;
var SKEY = 'bft.session';

var state = {
  env: null,       // 'production' | 'uat'
  base: null,      // e.g. https://app.beeforce.in
  token: null,
  issued: 0,
  user: null
};

function save() {
  try { sessionStorage.setItem(SKEY, JSON.stringify(state)); } catch (e) {}
}
function restore() {
  try {
    var s = JSON.parse(sessionStorage.getItem(SKEY) || 'null');
    if (s && s.token && minutesLeft(s) > 1) { Object.assign(state, s); return true; }
  } catch (e) {}
  return false;
}
function minutesLeft(s) {
  s = s || state;
  return Math.max(0, Math.round(C.TOKEN_VALIDITY_MIN - (Date.now() - (s.issued || 0)) / 60000));
}

function envLabel() { return (C.ENVIRONMENTS[state.env] || {}).label || state.env || ''; }

async function signIn(env, username, password) {
  var cfg = C.ENVIRONMENTS[env];
  var url = cfg.url + '/api/authorization/oauth/token?username=' + encodeURIComponent(username) + '&password=' + encodeURIComponent(password) + '&grant_type=password';
  var basic = ctx.Secrets.basicAuth();
  if (!basic) { var ne = new Error('Sign-in client is not set up in this browser.'); ne.code = 'NO_CLIENT'; throw ne; }
  var r;
  try {
    r = await fetch(url, { method: 'POST', headers: { Authorization: basic, 'Content-Type': 'application/x-www-form-urlencoded' } });
  } catch (e) {
    throw new Error('Could not reach ' + cfg.label + '. Check your connection.');
  }
  var body = {};
  try { body = await r.json(); } catch (e) {}
  if (!r.ok || !body.access_token) {
    if (body.error === 'invalid_grant' || /bad.credentials/i.test(body.error_description || '')) throw new Error('Username or password is wrong.');
    if (r.status === 401 || body.error === 'invalid_client' || body.error === 'unauthorized') { var ce = new Error('Beeforce rejected the sign-in (HTTP ' + r.status + '). If your password is right, the sign-in client secret saved in this browser may be wrong.'); ce.code = 'BAD_CLIENT'; throw ce; }
    throw new Error(body.error_description || body.error || ('Sign-in failed (HTTP ' + r.status + ')'));
  }
  state.env = env;
  state.base = cfg.url;
  state.token = body.access_token;
  state.issued = Date.now();
  state.user = username;
  save();
  return state;
}

function signOut() {
  state.token = null; state.user = null; state.env = null; state.base = null; state.issued = 0;
  try { sessionStorage.removeItem(SKEY); } catch (e) {}
}

function headers(kind) {
  var h = { Authorization: 'Bearer ' + state.token, Accept: 'application/json', 'X-Client-Type': 'Web' };
  if (kind !== 'none') h['Content-Type'] = kind === 'vnd' ? 'application/vnd.api+json' : 'application/json';
  return h;
}

// Re-sign-in prompt (set by the shell). Returns true if a new token was obtained.
var reauth = null;
function setReauth(fn) { reauth = fn; }

/*
 * call(method, path, { query, body, module, contentType:'json'|'vnd'|'none', headers, retries })
 * path may be absolute or start with "/" (prefixed with the environment URL).
 * Returns { ok, status, data, text }. GETs are retried on network errors, 429 and 502-504 (writes only if opts.retries is set).
 * A 401 opens the sign-in prompt once and repeats the call.
 */
async function call(method, path, opts) {
  opts = opts || {};
  var url = new URL(/^https?:/.test(path) ? path : state.base + path);
  // Never send the Beeforce token anywhere except the signed-in environment.
  if (url.origin !== new URL(state.base).origin) return { ok: false, status: 0, data: null, text: 'Blocked: ' + url.origin + ' is not the signed-in Beeforce environment.' };
  Object.keys(opts.query || {}).forEach(function (k) {
    var v = opts.query[k];
    if (v != null && v !== '') url.searchParams.set(k, v);
  });
  // Only reads are retried automatically. A write that timed out may already be saved; resending could duplicate it.
  var retries = opts.retries == null ? (method === 'GET' ? 2 : 0) : opts.retries;
  var renewed = false;
  for (var attempt = 0; ; attempt++) {
    var hd = headers(opts.body === undefined && method === 'GET' ? 'none' : opts.contentType || 'json');
    // Extra headers from a tool; they can never replace the token or client type.
    Object.keys(opts.headers || {}).forEach(function (k) { if (!/^(authorization|x-client-type)$/i.test(k)) hd[k] = opts.headers[k]; });
    var init = { method: method, headers: hd };
    if (opts.body !== undefined) init.body = typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body);
    var t0 = performance.now();
    var r;
    try {
      r = await fetch(url.toString(), init);
    } catch (e) {
      if (attempt < retries) { await ctx.U.sleep(800 * Math.pow(2, attempt)); continue; }
      ctx.Audit && ctx.Audit.onApiCall(opts.module, method, url.pathname, 0, performance.now() - t0);
      return { ok: false, status: 0, data: null, text: 'Network error: ' + e.message };
    }
    ctx.lastCallMs = Math.round(performance.now() - t0);
    ctx.Audit && ctx.Audit.onApiCall(opts.module, method, url.pathname, r.status, ctx.lastCallMs);
    if (r.status === 401 && !renewed && reauth) {
      renewed = true;
      if (await reauth()) continue;
    }
    if ([429, 502, 503, 504].indexOf(r.status) >= 0 && attempt < retries) {
      var ra = Number(r.headers.get('retry-after'));
      await ctx.U.sleep((ra > 0 ? ra : Math.pow(2, attempt + 1)) * 1000);
      continue;
    }
    var text = await r.text();
    var data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    return { ok: r.ok, status: r.status, data: data, text: text };
  }
}

function asList(d) {
  if (Array.isArray(d)) return d;
  if (!d || typeof d !== 'object') return [];
  var keys = ['content', 'data', 'items', 'results'];
  for (var i = 0; i < keys.length; i++) if (Array.isArray(d[keys[i]])) return d[keys[i]];
  return [];
}

// GET a list; throws a readable error on failure.
async function list(path, opts) {
  var r = await call('GET', path, opts);
  if (!r.ok) throw new Error('Could not load ' + path.split('?')[0] + ' (HTTP ' + r.status + '): ' + parseError(r.text));
  return asList(r.data);
}

// Best-effort list (empty on failure) for reference sheets.
async function listQuiet(path, opts) {
  try { return await list(path, opts); } catch (e) { return []; }
}

function parseError(text) {
  if (!text) return 'No details';
  var s = typeof text === 'string' ? text : JSON.stringify(text);
  try {
    var o = JSON.parse(s);
    if (Array.isArray(o.violations) && o.violations.length) return o.violations.map(function (v) { return v.message || v.field || ''; }).filter(Boolean).join(', ');
    if (o.message && o.message !== 'error.validation') return o.message;
    return o.detail || o.title || o.error_description || o.error || s.slice(0, 220);
  } catch (e) {}
  return s.slice(0, 220).trim();
}

ctx.Api = {
  state: state, restore: restore, signIn: signIn, signOut: signOut, minutesLeft: minutesLeft, envLabel: envLabel,
  call: call, list: list, listQuiet: listQuiet, asList: asList, parseError: parseError,
  headers: headers, setReauth: setReauth
};
