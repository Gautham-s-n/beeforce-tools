/* core/audit.js — Google Chat audit messages (same content as the old tool):
 * an immediate LOGIN message, and one summary at sign-out / tab close / token expiry.
 * Webhook URL comes from config.js; empty = off. */
'use strict';

// Webhook comes from this browser's settings (core/secrets.js). Not set = audit off for this browser.
function URL_() { return ctx.Secrets.webhook(); }
function p2(n) { return String(n).padStart(2, '0'); }
function ts(d) { d = new Date(d || Date.now()); return d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '-' + p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds()); }
var IND = { timeZone: 'Asia/Kolkata', hour12: true, hour: '2-digit', minute: '2-digit' };
function hm(d) { return new Date(d).toLocaleTimeString('en-IN', IND); }
function dateStr(d) { return new Date(d).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', month: 'short', day: 'numeric', year: 'numeric' }); }
function dur(ms) {
  var s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
  if (h > 0) return h + 'h ' + (m % 60) + 'm ' + (s % 60) + 's';
  if (m > 0) return m + 'm ' + (s % 60) + 's';
  return s + 's';
}

function send(text, attempt) {
  var url = URL_();
  if (!url) return;
  attempt = attempt || 1;
  var x = new XMLHttpRequest();
  x.open('POST', url, true);
  x.setRequestHeader('Content-Type', 'application/json');
  x.onload = function () { if ((x.status < 200 || x.status >= 300) && attempt < 3) setTimeout(function () { send(text, attempt + 1); }, 800 * attempt * attempt); };
  x.onerror = function () { if (attempt < 3) setTimeout(function () { send(text, attempt + 1); }, 800 * attempt * attempt); };
  try { x.send(JSON.stringify({ text: text })); } catch (e) {}
}
function sendChunked(full) {
  var LIMIT = 3800;
  if (full.length <= LIMIT) return send(full);
  var chunk = '';
  full.split('\n').forEach(function (line) {
    if ((chunk + line + '\n').length > LIMIT) { send(chunk); chunk = ''; }
    chunk += line + '\n';
  });
  if (chunk.trim()) send(chunk);
}

function fresh() {
  return { sessionId: null, username: null, environment: null, loginTime: null, logoutTime: null,
    modulesVisited: [], uploadedFiles: [], downloads: { templates: 0, reports: 0, data: 0 },
    dbOperations: { created: 0, updated: 0, deleted: 0 }, api: { GET: [], POST: [], PUT: [], PATCH: [], DELETE: [] },
    validationErrors: [], apiErrors: [], transactions: [] };
}
// Kept on window so re-clicking the bookmark continues the same audit session (one LOGIN, one summary).
var S = window.__BFT_AUDIT_S__ || (window.__BFT_AUDIT_S__ = fresh());
function reset() { S = window.__BFT_AUDIT_S__ = fresh(); }
var LINE = '━━━━━━━━━━━━━━━━━━━━━━';

function loginReport() {
  return ['🔴 LOGIN', LINE, '👤 ' + S.username, '🌐 ' + S.environment, '🆔 ' + S.sessionId, '🕐 Login ' + hm(S.loginTime) + ' — ' + dateStr(S.loginTime)].join('\n');
}
function summary(label) {
  var c = function (m) { return S.api[m].length; };
  var total = c('GET') + c('POST') + c('PUT') + c('PATCH') + c('DELETE');
  var L = [label, LINE, '👤 ' + S.username, '🌐 ' + S.environment, '🆔 ' + S.sessionId,
    '🕐 Login', hm(S.loginTime), '🕐 Logout', hm(S.logoutTime), '⏱ Duration', dur(S.logoutTime - S.loginTime), LINE,
    'Modules Visited', S.modulesVisited.length ? S.modulesVisited.map(function (m) { return '• ' + m; }).join('\n') : '—', LINE,
    'Uploaded Files', S.uploadedFiles.length ? S.uploadedFiles.join('\n') : '—', LINE,
    'Downloads', 'Templates : ' + S.downloads.templates, 'Reports : ' + S.downloads.reports, 'Data : ' + S.downloads.data, LINE,
    'Database Operations', 'Created : ' + S.dbOperations.created, 'Updated : ' + S.dbOperations.updated, 'Deleted : ' + S.dbOperations.deleted, LINE,
    'API Summary', 'GET : ' + c('GET'), 'POST : ' + c('POST'), 'PUT : ' + c('PUT'), 'PATCH : ' + c('PATCH'), 'DELETE : ' + c('DELETE'), LINE,
    'Validation Errors', String(S.validationErrors.length), LINE, 'API Errors', String(S.apiErrors.length), LINE, 'Transactions', String(S.transactions.length)];
  if (total) {
    L.push(LINE, 'API DETAILS');
    ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].forEach(function (m) { S.api[m].forEach(function (e) { L.push(m + ' ' + e.endpoint, String(e.status), e.elapsed + ' ms'); }); });
  }
  return L.join('\n');
}

var Audit = {
  active: function () { return !!S.sessionId; },
  startSession: function (user, env) {
    if (this.active()) return S.sessionId;
    reset();
    S.sessionId = 'SID-' + ts() + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
    S.username = user || 'Unknown user';
    S.environment = env || 'Unknown';
    S.loginTime = Date.now();
    sendChunked(loginReport());
    return S.sessionId;
  },
  endSession: function (reason) {
    if (!this.active()) return;
    S.logoutTime = Date.now();
    var label = reason === 'TOKEN_EXPIRED' ? '⚠️ TOKEN EXPIRED' : reason === 'TIMEOUT' ? '⏳ SESSION TIMEOUT' : '🔴 LOGOUT';
    sendChunked(summary(label));
    reset();
  },
  newTransaction: function () { var id = 'TXN-' + ts() + '-' + String(S.transactions.length + 1).padStart(3, '0'); S.transactions.push(id); return id; },
  onModuleOpen: function (name) { if (this.active() && name && S.modulesVisited.indexOf(name) < 0) S.modulesVisited.push(name); },
  onFileSelected: function (name) { if (this.active() && name && S.uploadedFiles.indexOf(name) < 0) S.uploadedFiles.push(name); },
  onDownload: function (name) {
    if (!this.active() || !name) return;
    var f = name.toLowerCase();
    if (f.indexOf('template') >= 0) S.downloads.templates++;
    else if (/report|success|failed|result/.test(f)) S.downloads.reports++;
    else S.downloads.data++;
  },
  onDbOp: function (kind, n) { if (this.active() && S.dbOperations[kind] != null) S.dbOperations[kind] += n || 1; },
  onValidationError: function (m) { if (this.active()) S.validationErrors.push(m || 'Validation error'); },
  onApiCall: function (module, method, path, status, ms) {
    if (!this.active()) return;
    var m = String(method || 'GET').toUpperCase();
    if (!S.api[m]) S.api[m] = [];
    var ep = String(path).replace(/^\/api/, '');
    S.api[m].push({ endpoint: ep, status: status || 'NET_ERR', elapsed: Math.round(ms || 0) });
    if (!status || status >= 400) S.apiErrors.push(m + ' ' + ep + ' → HTTP ' + (status || 'NET_ERR'));
  }
};

// One listener per page, always calling the latest loaded Audit.
window.__BFT_AUDIT_END__ = function () { Audit.endSession('LOGOUT'); };
if (!window.__BFT_AUDIT_HOOKED__) {
  window.__BFT_AUDIT_HOOKED__ = true;
  window.addEventListener('beforeunload', function () { try { window.__BFT_AUDIT_END__(); } catch (e) {} });
}
ctx.Audit = Audit;
