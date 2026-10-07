/* BeeForce Tools loader — the bookmark loads this file. Change BASE if the files move. */
(function () {
  'use strict';
  var BASE = (window.BFT_BASE_OVERRIDE || 'https://REPLACE-WITH-YOUR-RAW-URL/');
  if (window.__BFT_LOADING__) return;
  window.__BFT_LOADING__ = true;
  fetch(BASE + 'index.js?t=' + Date.now())
    .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status + ' loading index.js'); return r.text(); })
    .then(function (code) { window.BFT_BASE = BASE; (0, eval)(code); })
    .catch(function (e) { alert('BeeForce Tools could not load: ' + e.message); })
    .then(function () { window.__BFT_LOADING__ = false; });
})();
