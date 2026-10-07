/* core/util.js — DOM helper, icons, small utilities. */
'use strict';

// h('div.cls#id', {attrs}, ...children)
function h(tag, attrs) {
  var kids = Array.prototype.slice.call(arguments, 2);
  var parts = tag.split(/(?=[.#])/);
  var el = document.createElement(parts[0] || 'div');
  for (var i = 1; i < parts.length; i++) {
    if (parts[i][0] === '.') el.classList.add(parts[i].slice(1));
    else el.id = parts[i].slice(1);
  }
  if (attrs && (typeof attrs !== 'object' || attrs instanceof Node || Array.isArray(attrs))) {
    kids.unshift(attrs);
    attrs = null;
  }
  Object.keys(attrs || {}).forEach(function (k) {
    var v = attrs[k];
    if (v == null || v === false) return;
    if (k.slice(0, 2) === 'on' && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'class') el.className += (el.className ? ' ' : '') + v;
    else if (k === 'style' && typeof v === 'object') Object.keys(v).forEach(function (s) { s.indexOf('--') === 0 ? el.style.setProperty(s, v[s]) : (el.style[s] = v[s]); });
    else if (k === 'html') el.innerHTML = v;
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  });
  append(el, kids);
  return el;
}
function append(el, kids) {
  (function walk(list) {
    list.forEach(function (k) {
      if (k == null || k === false) return;
      if (Array.isArray(k)) return walk(k);
      el.appendChild(k instanceof Node ? k : document.createTextNode(String(k)));
    });
  })(kids);
  return el;
}
function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
function swap(el) { clear(el); return append(el, Array.prototype.slice.call(arguments, 1)); }

var ICONS = {
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  coin: '<rect x="4" y="6" width="16" height="12" rx="3"/><path d="M8 12h8M12 9v6"/>',
  cal: '<rect x="4" y="5.5" width="16" height="14" rx="3"/><path d="M4 10h16M9 3.5v4M15 3.5v4"/>',
  leaf: '<path d="M5 19c0-8 5-13 14-14-1 9-6 14-14 14Z"/><path d="M5 19l7-7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/>',
  shield: '<path d="M12 3.5 19 6v6c0 4.5-3 7.5-7 8.5-4-1-7-4-7-8.5V6l7-2.5Z"/><path d="m9 12 2 2 4-4"/>',
  people: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M16 14.2c2.4.2 4 1.7 4.5 4.3"/>',
  bolt: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6L13 3Z"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>',
  home: '<path d="M4 11 12 4l8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1v-8Z"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  out: '<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h10"/>',
  download: '<path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14"/>',
  upload: '<path d="M12 19V8m0 0-4.5 4.5M12 8l4.5 4.5M5 5h14"/>',
  template: '<path d="M6 3h9l3 3v15H6zM9 9h6M9 13h6M9 17h4"/>',
  trash: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
  list: '<path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/>',
  play: '<path d="M8 5v14l11-7z"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  stop: '<path d="M6 6h12v12H6z"/>',
  retry: '<path d="M4 12a8 8 0 1 0 2.3-5.6M4 4v4h4"/>',
  check: '<path d="M5 12.5 10 17l9-10"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  key: '<circle cx="8" cy="12" r="3.5"/><path d="M11.5 12H20M17 12v3M20 12v2"/>',
  gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',  // gear: lucide "settings" (ISC)
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>'
};
function icon(name, size) {
  var s = size || 20;
  var span = document.createElement('span');
  span.className = 'ic';
  span.innerHTML = '<svg width="' + s + '" height="' + s + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (ICONS[name] || '') + '</svg>';
  return span;
}

function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
function pad(n) { return String(n).padStart(2, '0'); }
function stamp() { var d = new Date(); return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()); }
function timeNow() { return new Date().toTimeString().slice(0, 8); }
function reducedMotion() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }

// Small per-user memory in this browser (recent tools, last runs). Never stores passwords or tokens.
var store = {
  get: function (k, dflt) { try { var v = localStorage.getItem('bft.' + k); return v ? JSON.parse(v) : dflt; } catch (e) { return dflt; } },
  set: function (k, v) { try { localStorage.setItem('bft.' + k, JSON.stringify(v)); } catch (e) {} }
};

ctx.U = { h: h, append: append, clear: clear, swap: swap, icon: icon, ICONS: ICONS, sleep: sleep, stamp: stamp, timeNow: timeNow, pad: pad, reducedMotion: reducedMotion, store: store };
