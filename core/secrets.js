/* core/secrets.js — sign-in client credentials and the audit webhook, kept in this browser only.
 *
 * Stored in localStorage['bft.secrets'] on the Beeforce site (Production and UAT are separate sites,
 * so each has its own copy). NOT a vault: any script running on the Beeforce page, browser extensions,
 * and anyone using this browser profile can read it. It keeps the values out of the code repository.
 *
 * Shape: { clientId, clientSecret, webhookUrl, webhookState: 'untested'|'ok'|'unconfirmed'|'failed', webhookCheckedAt } */
'use strict';

var KEY = 'bft.secrets';
var WEBHOOK_RE = /^https:\/\/chat\.googleapis\.com\/v1\/spaces\/[^\/?#]+\/messages\?(?=.*\bkey=)(?=.*\btoken=)/;

function read() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; }
}
function write(o) {
  try { localStorage.setItem(KEY, JSON.stringify(o)); return true; } catch (e) { return false; }
}

var Secrets = {
  get: function () {
    var s = read();
    return { clientId: s.clientId || ctx.CONFIG.OAUTH_CLIENT_ID || '', clientSecret: s.clientSecret || '', webhookUrl: s.webhookUrl || '',
      webhookState: s.webhookState || (s.webhookUrl ? 'untested' : ''), webhookCheckedAt: s.webhookCheckedAt || 0 };
  },
  set: function (patch) {
    var s = read();
    Object.keys(patch).forEach(function (k) { if (patch[k] == null || patch[k] === '') delete s[k]; else s[k] = patch[k]; });
    if ('webhookUrl' in patch) { delete s.webhookState; delete s.webhookCheckedAt; if (patch.webhookState) s.webhookState = patch.webhookState; }
    return write(s);
  },
  clear: function (which) {
    var s = read();
    if (which === 'client') { delete s.clientSecret; }
    else if (which === 'webhook') { delete s.webhookUrl; delete s.webhookState; delete s.webhookCheckedAt; }
    else s = {};
    return write(s);
  },
  hasClient: function () { var s = this.get(); return !!(s.clientId && s.clientSecret); },
  basicAuth: function () {
    var s = this.get();
    if (!s.clientId || !s.clientSecret) return null;
    return 'Basic ' + btoa(unescape(encodeURIComponent(s.clientId + ':' + s.clientSecret)));
  },
  webhook: function () { return this.get().webhookUrl; },
  /* 'configured' | 'not-configured' | 'failed' (+ 'unconfirmed' when the browser could not read Google's reply) */
  auditState: function () {
    var s = this.get();
    if (!s.webhookUrl) return 'not-configured';
    if (s.webhookState === 'failed') return 'failed';
    if (s.webhookState === 'unconfirmed') return 'unconfirmed';
    return 'configured';
  },
  validWebhook: function (url) { return WEBHOOK_RE.test(String(url || '').trim()); },
  mask: function (v) { v = String(v || ''); return v ? (v.length <= 6 ? '••••' : v.slice(0, 3) + '••••••' + v.slice(-2)) : ''; },
  maskUrl: function (u) { return String(u || '').replace(/(key=)[^&]+/, '$1••••').replace(/(token=)[^&]+/, '$1••••'); },

  /* Sends one test message. Resolves { state, msg }. Google may not let the page read its reply (CORS);
   * then the message is usually delivered but we can't confirm it -> 'unconfirmed'. */
  testWebhook: function (url, who) {
    return new Promise(function (resolve) {
      if (!Secrets.validWebhook(url)) return resolve({ state: 'failed', msg: 'This is not a Google Chat webhook link (https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…).' });
      var x = new XMLHttpRequest();
      x.open('POST', url, true);
      x.setRequestHeader('Content-Type', 'application/json; charset=UTF-8');
      x.timeout = 10000;
      x.onload = function () {
        if (x.status >= 200 && x.status < 300) resolve({ state: 'ok', msg: 'Test message delivered.' });
        else resolve({ state: 'failed', msg: 'Google Chat answered HTTP ' + x.status + '. Check the link.' });
      };
      x.onerror = function () { resolve({ state: 'unconfirmed', msg: 'Sent, but this browser could not read Google\'s reply. Check the Chat space for the test message.' }); };
      x.ontimeout = function () { resolve({ state: 'failed', msg: 'No reply from Google Chat after 10 seconds.' }); };
      try { x.send(JSON.stringify({ text: '✅ BeeForce Tools audit test from ' + (who || 'setup') + ' on ' + location.host })); }
      catch (e) { resolve({ state: 'failed', msg: e.message }); }
    });
  }
};

ctx.Secrets = Secrets;
