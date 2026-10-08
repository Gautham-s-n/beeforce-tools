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
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>',
  monitor: '<rect x="3.5" y="4.5" width="17" height="12" rx="2"/><path d="M8.5 20h7M12 16.5V20"/>',
  sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  tag: '<path d="M3.5 12.5V4.5h8l9 9-8 8-9-9Z"/><circle cx="8" cy="9" r="1.4"/>',
  layers: '<path d="M12 3.5 21 8l-9 4.5L3 8l9-4.5Z"/><path d="m3 12 9 4.5 9-4.5M3 16l9 4.5 9-4.5"/>',
  repeat: '<path d="M17 3.5 20.5 7 17 10.5"/><path d="M4 11V9.5A2.5 2.5 0 0 1 6.5 7h14M7 20.5 3.5 17 7 13.5"/><path d="M20 13v1.5a2.5 2.5 0 0 1-2.5 2.5h-14"/>',
  userplus: '<circle cx="9.5" cy="8.5" r="3.5"/><path d="M3.5 19.5c.6-3.4 3-5.5 6-5.5s5.4 2.1 6 5.5M18.5 8v6M15.5 11h6"/>',
  timer: '<circle cx="12" cy="13.5" r="7"/><path d="M12 10v3.5l2.5 1.5M9.5 3.5h5"/>',
  badge: '<path d="M12 3.5 14.2 5l2.7-.2.9 2.5 2.3 1.4-.6 2.6 1 2.5-2 1.8-.3 2.7-2.6.6-1.6 2.1L12 20l-2.5 1-1.6-2.1-2.6-.6-.3-2.7-2-1.8 1-2.5-.6-2.6 2.3-1.4.9-2.5 2.7.2L12 3.5Z"/><path d="m9 12 2 2 4-4"/>',
  route: '<circle cx="6" cy="18" r="2.2"/><circle cx="18" cy="6" r="2.2"/><path d="M8 18h7.5a3 3 0 0 0 0-6h-7a3 3 0 0 1 0-6H16"/>',
  inbox: '<path d="M4 13.5 6.5 5h11l2.5 8.5V19H4v-5.5Z"/><path d="M4 13.5h5l1 2h4l1-2h5"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 10h16M4 15h16M10 4v16"/>',
  building: '<path d="M5 20.5V5l7-2v17.5M12 8.5l7 2v10M3 20.5h18M8 8h1M8 12h1M8 16h1M15 13h1M15 17h1"/>',
  scale: '<path d="M12 4v16M7 20h10M5 7h14M5 7l-2.5 6a3 3 0 0 0 5 0L5 7ZM19 7l-2.5 6a3 3 0 0 0 5 0L19 7Z"/>',
  code: '<path d="m8.5 7-5 5 5 5M15.5 7l5 5-5 5M13.5 4.5l-3 15"/>',
  cards: '<rect x="3.5" y="4" width="7.5" height="7" rx="1.5"/><rect x="13" y="4" width="7.5" height="7" rx="1.5"/><rect x="3.5" y="13" width="7.5" height="7" rx="1.5"/><rect x="13" y="13" width="7.5" height="7" rx="1.5"/>',
  hexgrid: '<path d="M7 3.5 10.5 5.5v4L7 11.5 3.5 9.5v-4L7 3.5ZM17 3.5l3.5 2v4l-3.5 2-3.5-2v-4l3.5-2ZM12 12.5l3.5 2v4l-3.5 2-3.5-2v-4l3.5-2Z"/>',
  chev: '<path d="m6 9 6 6 6-6"/>',
  edit: '<path d="M16.5 3.5a2.1 2.1 0 1 1 3 3L8 18l-4 1 1-4Z"/><path d="M14 6l3 3"/>',
  power: '<path d="M12 3v9"/><path d="M18.4 6.6a9 9 0 1 1-12.8 0"/>',
  copy: '<rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5"/>',
  unlock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8.5 10.5V7.5a3.5 3.5 0 0 1 6.8-1.2"/>',
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
