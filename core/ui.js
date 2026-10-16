/* core/ui.js — building blocks the tools use: header, tabs, buttons, fields, drop zone,
 * table, counts, steps, notes, run panel, confirm dialog, toasts.
 *
 * v3.8: dialogs stack (Esc closes only the top one), trap Tab, return focus to the control that opened them and start on
 * the safe choice when the action is destructive; menus open focused and work with the arrow keys; code dialog for
 * copyable text; buttons can be disabled with a reason (aria-disabled + tooltip); toasts come in ok / warn / bad kinds;
 * tables sort, hide columns, show an empty state, offer row menus and scroll by keyboard. */
'use strict';

var U = ctx.U, h = U.h;
function app() { return ctx.appEl; }

/* ---------- basic pieces ---------- */
function btn(label, o) {
  o = o || {};
  var b = h('button.btn' + (o.kind ? '.' + o.kind : '') + (o.sm ? '.sm' : ''), { type: 'button', title: o.title, disabled: o.disabled, 'aria-label': o.aria },
    o.icon ? U.icon(o.icon, o.sm ? 16 : 18) : null, label ? h('span', label) : null);
  if (o.reason) setReason(b, o.reason);
  if (label === 'Delete selected') b.classList.add('delsel');   // v3.15: hidden for a read-only role (.app.ro, core/engine.js)
  if (o.onClick) b.addEventListener('click', function (e) { if (b.getAttribute('aria-disabled') === 'true') return; busy(b, function () { return o.onClick(e); }); });
  return b;
}
/* Disabled with a reason: stays focusable and shows why (tooltip); reason null enables it again. */
function setReason(b, reason) {
  if (reason) { b.setAttribute('aria-disabled', 'true'); if (b.__title == null) b.__title = b.title || ''; b.title = reason; }
  else if (b.getAttribute('aria-disabled') === 'true') { b.removeAttribute('aria-disabled'); b.title = b.__title || ''; }
}
/* Disables the button and shows a spinner while fn runs; errors become a toast. */
async function busy(b, fn) {
  if (b.disabled) return;
  var old = Array.prototype.slice.call(b.childNodes);
  b.disabled = true;
  var sp = h('span.spin');
  if (b.firstChild && b.firstChild.classList && b.firstChild.classList.contains('ic')) b.replaceChild(sp, b.firstChild); else b.insertBefore(sp, b.firstChild);
  try { return await fn(); }
  catch (e) { console.error(e); toast(e.message || String(e), 'bad'); }
  finally { b.disabled = false; U.clear(b); old.forEach(function (n) { if (n !== sp) b.appendChild(n); }); }
}

function header(o) {
  return h('div.ph',
    h('div.t', h('div.ar', o.area || ''), h('h1', o.title), o.desc ? h('p', o.desc) : null),
    o.actions && o.actions.length ? h('div.acts', o.actions) : null);
}

/* tabs: [{ id, label, render(body) }] -> element. Bodies are built on first open. */
function tabs(list, initial) {
  var bar = h('div.tabs', { role: 'tablist' });
  var holder = h('div');
  var built = {};
  var cur = null;
  function open(id) {
    if (cur === id) return;
    cur = id;
    Array.prototype.forEach.call(bar.children, function (b) { b.setAttribute('aria-selected', b.dataset.id === id ? 'true' : 'false'); });
    Object.keys(built).forEach(function (k) { built[k].hidden = k !== id; });
    if (!built[id]) {
      var t = list.filter(function (x) { return x.id === id; })[0];
      built[id] = h('div.tabbody');
      holder.appendChild(built[id]);
      try { var r = t.render(built[id]); if (r && r.catch) r.catch(function (e) { built[id].appendChild(note('bad', 'Could not open this tab', e.message)); }); }
      catch (e) { built[id].appendChild(note('bad', 'Could not open this tab', e.message)); }
    } else {
      built[id].classList.remove('tabbody'); void built[id].offsetWidth; built[id].classList.add('tabbody');
    }
  }
  list.forEach(function (t) {
    bar.appendChild(h('button.tab', { type: 'button', role: 'tab', 'data-id': t.id, onclick: function () { open(t.id); } }, t.label));
  });
  var el = h('div', bar, holder);
  el.open = open;
  open(initial || list[0].id);
  return el;
}

function field(label, control, hint) {
  return h('label.field', h('span', label), control, hint ? h('small.dim', hint) : null);
}
function input(o) {
  o = o || {};
  var el = h('input.input', { type: o.type || 'text', placeholder: o.placeholder || '', value: o.value == null ? '' : o.value });
  // Beeforce has global key handlers; keep typing inside our inputs.
  stopKeys(el);
  return el;
}
function textarea(o) { o = o || {}; var el = h('textarea.input', { placeholder: o.placeholder || '' }); el.value = o.value || ''; stopKeys(el); return el; }
function select(options, value) {
  var el = h('select.input');
  options.forEach(function (op) {
    if (typeof op !== 'object') op = { value: op, label: op };
    el.appendChild(h('option', { value: op.value, selected: String(op.value) === String(value) }, op.label));
  });
  stopKeys(el);
  return el;
}
function check(label, checked) {
  var cb = h('input', { type: 'checkbox', checked: !!checked });
  var el = h('label.check', cb, h('span', label));
  el.input = cb;
  return el;
}
function stopKeys(el) {
  ['keydown', 'keyup', 'keypress'].forEach(function (ev) { el.addEventListener(ev, function (e) { if (e.key !== 'Escape') e.stopPropagation(); }); });
}

function note(kind, title, text) {
  return h('div.note' + (kind ? '.' + kind : ''), h('div', title ? h('b', title) : null, text || null));
}
function chip(text, kind) { return h('span.chip' + (kind ? '.' + kind : ''), text); }
function empty(text) { return h('div.empty', text); }

function counts(list) {
  return h('div.counts', list.map(function (c) { return h('div.count' + (c.kind ? '.' + c.kind : ''), h('b', String(c.n)), h('span', c.label)); }));
}

/* Hex steps: steps(['Choose file','Review','Apply','Report'], o) -> el with el.set(i)
 * o.canPick(i) -> true | 'reason' | false and o.onPick(i): steps you can go to become buttons (v3.9 step navigation). */
function steps(names, o) {
  o = o || {};
  var el = h('nav.steps', { 'aria-label': 'Steps' });
  var nodes = [], bars = [], cur = 0;
  names.forEach(function (n, i) {
    if (i) { var b = h('div.bar', h('i')); bars.push(b); el.appendChild(b); }
    var s = h('div.step', h('div.hx', h('b', String(i + 1))), h('span', n));
    nodes.push(s); el.appendChild(s);
  });
  el.set = function (c) {
    if (c != null) cur = c;
    nodes.forEach(function (s, i) {
      s.classList.toggle('done', i < cur); s.classList.toggle('now', i === cur);
      if (i === cur) s.setAttribute('aria-current', 'step'); else s.removeAttribute('aria-current');
      s.querySelector('b').textContent = i < cur ? '✓' : String(i + 1);
      var ok = i !== cur && o.canPick ? o.canPick(i) : false;
      var link = s.querySelector('.steplink');
      if (ok === true && !link) {
        var lb = h('button.steplink', { type: 'button', title: 'Go to ' + names[i] + (i === cur - 1 ? ' (Alt ←)' : i === cur + 1 ? ' (Alt →)' : ''), 'aria-label': 'Go to step ' + (i + 1) + ': ' + names[i], onclick: function () { o.onPick && o.onPick(i); } });
        s.appendChild(lb); s.classList.add('pick');
      } else if (ok !== true && link) { link.remove(); s.classList.remove('pick'); }
    });
    bars.forEach(function (b, i) { b.classList.toggle('done', i < cur); });
  };
  el.refresh = function () { el.set(); };
  el.set(0);
  return el;
}

/* Split button: the main button keeps its one-click default (Excel), the chevron offers other formats. */
function splitBtn(main, items, label) {
  var more = h('button.btn.splitmore' + (main.classList.contains('primary') ? '.primary' : '') + (main.classList.contains('quiet') ? '.quiet' : '') + (main.classList.contains('sm') ? '.sm' : ''),
    { type: 'button', 'aria-haspopup': 'menu', 'aria-label': 'More formats: ' + (label || main.textContent.trim()), title: 'Other formats' }, U.icon('chev', 14));
  more.addEventListener('click', function (e) { e.stopPropagation(); menu(more, typeof items === 'function' ? items() : items, { right: true, label: label || 'Formats' }); });
  return h('span.split', main, more);
}

/* Drop zone. o: { title, hint, accept, onFile(file) } -> el with el.reset() */
function drop(o) {
  o = o || {};
  var inp = h('input', { type: 'file', accept: o.accept || '.xlsx,.xls,.csv', hidden: true });
  var zone = h('div.drop', { tabindex: '0', role: 'button' },
    h('div.dh', U.icon('upload', 22)),
    h('strong', o.title || 'Drop your Excel file here'),
    h('span.muted.small', o.hint || 'or click to choose · .xlsx, .xls or .csv'));
  var wrap = h('div', zone, inp);
  function pick(f) {
    if (!f) return;
    U.swap(wrap, h('div.chipfile', U.icon('template', 18), h('b', f.name), h('span.dim.small', Math.max(1, Math.round(f.size / 1024)) + ' KB'),
      h('button.btn.quiet.sm', { type: 'button', onclick: function () { reset(); o.onClear && o.onClear(); } }, 'Change')));
    Promise.resolve(o.onFile && o.onFile(f)).catch(function (e) { toast(e.message, 'bad'); reset(); });
  }
  function reset() { inp.value = ''; U.swap(wrap, zone, inp); }
  zone.addEventListener('click', function () { inp.click(); });
  zone.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
  inp.addEventListener('change', function () { pick(inp.files[0]); });
  ['dragenter', 'dragover'].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.add('over'); }); });
  ['dragleave', 'drop'].forEach(function (ev) { zone.addEventListener(ev, function (e) { e.preventDefault(); zone.classList.remove('over'); }); });
  zone.addEventListener('drop', function (e) { pick(e.dataTransfer.files[0]); });
  wrap.reset = reset;
  return wrap;
}

/* Table.
 * cols: [{ key, label, wrap, render(row) -> node|string, text(row) -> searchable/sortable text, sort:false }]
 * o: { select:true, search:true, limit:500, selected:Set, onSelect(set), rowKey(row), toolbar:[nodes],
 *      columns:false (no Columns menu), rowMenu(row) -> menu items, label (name of the scroll region) }
 * row.__chg = { key:true } highlights changed cells. Sorting, hidden columns and Yes / No for booleans only change
 * what is shown: rows, selection keys and every export keep the original values. */
function table(cols, rows, o) {
  o = o || {};
  var limit = o.limit || 500;
  var key = o.rowKey || function (r, i) { return r.id != null ? String(r.id) : String(i); };
  var sel = o.selected || new Set();
  var q = '';
  var sortBy = null, sortDir = 1;          // column index, 1 asc / -1 desc
  var hiddenCols = {};
  var tbody = h('tbody');
  var more = h('div.tmore');
  var allBox = o.select ? h('input', { type: 'checkbox', 'aria-label': 'Select all' }) : null;
  var countEl = h('span.muted.small', { 'aria-live': 'polite' });
  var clearSel = o.select ? h('button.btn.quiet.sm.clearsel', { type: 'button', hidden: true, onclick: function () { sel.clear(); draw(); } }, U.icon('x', 14), h('span', 'Clear selection')) : null;

  // Browse tables (selectable rows with an id) get a row menu by default: copy the id, show the row as JSON.
  if (o.rowMenu == null && o.select && rows.length && rows[0].id != null) o.rowMenu = function (r) {
    var id = String(r.id), plain = {};
    Object.keys(r).forEach(function (k) { if (k.indexOf('__') !== 0) plain[k] = r[k]; });
    return [{ header: 'Id ' + id },
      { icon: 'copy', label: 'Copy id', onClick: function () { copy(id, 'Id'); } },
      { icon: 'code', label: 'Show row as JSON', sub: 'The values in this table', onClick: function () { codeDialog('Row ' + id + ' · JSON', JSON.stringify(plain, null, 2), { what: 'JSON', note: 'The values shown in this table. Copying sends nothing.' }); } }];
  };
  function raw(c, r) { return c.text ? c.text(r) : r[c.key]; }
  function asBool(v) { return v === true || v === false ? v : v === 'TRUE' ? true : v === 'FALSE' ? false : null; }
  function shownText(v) { var b = asBool(v); return b != null ? (b ? 'Yes' : 'No') : v == null ? '' : String(typeof v === 'object' ? JSON.stringify(v) : v); }
  function cell(c, r) {
    var v = c.render ? c.render(r) : r[c.key];
    var td = h('td' + (c.wrap ? '.wrap' : '') + (r.__chg && r.__chg[c.key] ? '.chg' : ''));
    if (v instanceof Node) td.appendChild(v);
    else if (asBool(v) != null) { var bv = asBool(v); td.appendChild(h('span.bool' + (bv ? '.y' : ''), h('i'), bv ? 'Yes' : 'No')); td.title = bv ? 'Yes (TRUE)' : 'No (FALSE)'; }
    else { td.textContent = v == null ? '' : String(ctx.X.fmt(v)); td.title = td.textContent; }
    return td;
  }
  function visible() {
    var list = rows;
    if (q) {
      var w = q.toLowerCase();
      list = rows.filter(function (r) {
        return cols.some(function (c) { var v = raw(c, r); return v != null && (shownText(v) + (asBool(v) != null ? ' ' + ctx.X.fmt(v) : '')).toLowerCase().indexOf(w) >= 0; });
      });
    }
    if (sortBy != null) {
      var c = cols[sortBy];
      list = list.map(function (r, i) { return [r, i]; }).sort(function (x, y) {
        var a = raw(c, x[0]), b = raw(c, y[0]);
        var na = typeof a === 'number' ? a : (a !== '' && a != null && !isNaN(+a) ? +a : null), nb = typeof b === 'number' ? b : (b !== '' && b != null && !isNaN(+b) ? +b : null);
        var d = na != null && nb != null ? na - nb : shownText(a).localeCompare(shownText(b), undefined, { numeric: true, sensitivity: 'base' });
        return d * sortDir || x[1] - y[1];
      }).map(function (x) { return x[0]; });
    }
    return list;
  }
  function shownCols() { return cols.filter(function (c, i) { return !hiddenCols[i]; }); }
  function draw() {
    var list = visible();
    U.clear(tbody);
    var sc = shownCols();
    list.slice(0, limit).forEach(function (r) {
      var k = key(r, rows.indexOf(r));
      var tr = h('tr' + (sel.has(k) ? '.sel' : ''));
      if (o.select) {
        var cb = h('input', { type: 'checkbox', checked: sel.has(k), disabled: !!r.__lock, 'aria-label': 'Select row' });
        cb.addEventListener('change', function () { cb.checked ? sel.add(k) : sel.delete(k); tr.classList.toggle('sel', cb.checked); sync(); });
        tr.appendChild(h('td', cb));
      }
      sc.forEach(function (c) { tr.appendChild(cell(c, r)); });
      if (o.rowMenu) {
        var mb = h('button.iconbtn.rowmenu', { type: 'button', 'aria-label': 'Actions for row ' + k, 'aria-haspopup': 'menu', title: 'Row actions' }, U.icon('dots', 16));
        mb.addEventListener('click', function (e) { e.stopPropagation(); menu(mb, o.rowMenu(r), { right: true }); });
        tr.appendChild(h('td.num', mb));
      }
      tbody.appendChild(tr);
    });
    if (!list.length) {
      var span = sc.length + (o.select ? 1 : 0) + (o.rowMenu ? 1 : 0);
      tbody.appendChild(h('tr.none', h('td', { colSpan: span }, h('div.tnone',
        q ? [h('b', 'No rows match “' + q + '”'), h('button.linkbtn', { type: 'button', onclick: function () { if (search) { search.value = ''; q = ''; draw(); search.focus(); } } }, 'Clear search')] : h('b', 'No rows')))));
    }
    more.textContent = list.length > limit ? 'Showing first ' + limit + ' of ' + list.length + ' rows. Search to narrow down.' : '';
    more.hidden = list.length <= limit;
    sync();
  }
  function sync() {
    countEl.textContent = (o.select ? sel.size + ' selected · ' : '') + visible().length + ' rows';
    if (clearSel) clearSel.hidden = !sel.size;
    if (allBox) { var v = visible().filter(function (r) { return !r.__lock; }); allBox.checked = v.length > 0 && v.every(function (r) { return sel.has(key(r, rows.indexOf(r))); }); }
    o.onSelect && o.onSelect(sel);
  }
  if (allBox) allBox.addEventListener('change', function () {
    visible().forEach(function (r) { if (r.__lock) return; var k = key(r, rows.indexOf(r)); allBox.checked ? sel.add(k) : sel.delete(k); });
    draw();
  });
  var search = null;
  if (o.search !== false) {
    search = input({ placeholder: 'Search rows' });
    search.classList.add('tsearch');
    search.setAttribute('aria-label', 'Search rows');
    var tm;
    search.addEventListener('input', function () { clearTimeout(tm); tm = setTimeout(function () { q = search.value.trim(); draw(); }, 120); });
  }
  var headRow = h('tr');
  function drawHead() {
    U.clear(headRow);
    if (o.select) headRow.appendChild(h('th', allBox));
    cols.forEach(function (c, i) {
      if (hiddenCols[i]) return;
      var th = h('th');
      if (c.sort === false || !c.label) th.textContent = c.label || '';
      else {
        var on = sortBy === i;
        th.setAttribute('aria-sort', on ? (sortDir > 0 ? 'ascending' : 'descending') : 'none');
        th.appendChild(h('button.sortbtn', { type: 'button', title: 'Sort by ' + c.label, onclick: function () {
          if (sortBy !== i) { sortBy = i; sortDir = 1; } else if (sortDir > 0) sortDir = -1; else { sortBy = null; sortDir = 1; }
          drawHead(); draw();
        } }, c.label, h('span.sarr', { 'aria-hidden': 'true' }, on ? (sortDir > 0 ? '↑' : '↓') : '↕')));
      }
      headRow.appendChild(th);
    });
    if (o.rowMenu) headRow.appendChild(h('th', h('span.sr', 'Actions')));
  }
  drawHead();
  var colBtn = null;
  if (o.columns !== false && cols.length > 3) {
    colBtn = h('button.btn.quiet.sm.colbtn', { type: 'button', 'aria-haspopup': 'menu', title: 'Show or hide columns' }, U.icon('columns', 16), h('span', 'Columns'));
    colBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      menu(colBtn, [{ header: 'Columns shown' }].concat(cols.map(function (c, i) {
        return { label: c.label || c.key, check: !hiddenCols[i], disabled: i === 0 ? 'Always shown' : null, keep: true,
          onClick: function () { hiddenCols[i] = !hiddenCols[i]; drawHead(); draw(); return { check: !hiddenCols[i] }; } };
      })).concat(['hr', { label: 'Show all columns', icon: 'retry', onClick: function () { hiddenCols = {}; drawHead(); draw(); } }]));
    });
  }
  var thead = h('thead', headRow);
  var wrap = h('div.twrap', { tabindex: '0', role: 'region', 'aria-label': o.label || 'Table' }, h('table', thead, tbody), more);
  var el = h('div',
    h('div.tbar', search, countEl, clearSel, h('div.acts', { style: { marginLeft: 'auto' } }, colBtn, o.toolbar || null)),
    wrap);
  el.selected = sel;
  el.redraw = draw;
  el.setRows = function (r) { rows = r; draw(); };
  el.search = search;
  draw();
  return el;
}

/* Loading placeholder: a few grey rows while data is on its way. */
function skeleton(text, n) {
  return h('div.skel', { role: 'status' }, h('div.skelt', h('span.spin'), h('span', text || 'Loading…')),
    Array.apply(null, Array(n || 5)).map(function (x, i) { return h('div.skr', h('i', { style: { width: (30 + (i * 17) % 40) + '%' } }), h('i', { style: { width: (18 + (i * 11) % 25) + '%' } })); }));
}

/* ---------- menus ----------
 * menu(anchor, items, o) opens a menu under anchor (the anchor's parent is used as the positioning box).
 * items: [{ icon, label, sub, right, onClick, disabled: 'reason', danger, check: true|false, keep }, 'hr', { header }]
 * Opens focused on the current / first item; ↑ ↓ Home End move, Enter / Space choose, Esc closes and returns focus. */
var MENU = null;
function closeMenu(refocus) {
  if (!MENU) return;
  var m = MENU; MENU = null;
  document.removeEventListener('keydown', m.onKey, true);
  document.removeEventListener('mousedown', m.onDown, true);
  ctx.appEl && ctx.appEl.removeEventListener('scroll', m.onScroll, true);
  window.removeEventListener('resize', m.onScroll);
  m.el.remove();
  if (m.anchor) m.anchor.setAttribute('aria-expanded', 'false');
  var back = m.ret || m.anchor;
  if (refocus && back && back.isConnected) try { back.focus(); } catch (e) {}
}
function menuOpen() { return !!MENU; }
function menu(anchor, items, o) {
  o = o || {};
  if (MENU && MENU.anchor === anchor) { closeMenu(true); return null; }
  closeMenu();
  var el = h('div.menu.uimenu', { role: 'menu', 'aria-label': o.label || null });
  function itemEl(it) {
    if (it === 'hr') return h('hr', { role: 'separator' });
    if (it.node) return it.node;
    if (it.header) return h('div.hd', { role: 'presentation' }, it.header);
    var role = it.check != null ? 'menuitemcheckbox' : 'menuitem';
    var b = h('button' + (it.danger ? '.danger' : '') + (it.on ? '.on' : ''), { type: 'button', role: role, tabindex: '-1' },
      it.check != null ? h('span.mchk', { 'aria-hidden': 'true' }, U.icon('check', 15)) : it.icon ? U.icon(it.icon, 16) : null,
      h('div', h('b', it.label), it.sub ? h('span', it.sub) : null),
      it.disabled ? h('small', it.disabled) : it.right ? h('small', it.right) : null);
    if (it.check != null) b.setAttribute('aria-checked', it.check ? 'true' : 'false');
    if (it.disabled) { b.setAttribute('aria-disabled', 'true'); b.title = it.disabled; }
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      if (it.disabled) return;
      if (it.keep) { var r = it.onClick && it.onClick(); if (r && r.check != null) b.setAttribute('aria-checked', r.check ? 'true' : 'false'); return; }
      closeMenu(true);
      it.onClick && it.onClick();
    });
    return b;
  }
  items.filter(Boolean).forEach(function (it) { el.appendChild(itemEl(it)); });
  // Menus live at the top of APIary (never clipped by a table or a scrolling panel) and are placed under the anchor:
  // right-aligned when asked, flipped up when there is no room below, always kept inside the window.
  var host = ctx.appEl;
  el.style.visibility = 'hidden';
  host.appendChild(el);
  function place() {
    var r = anchor.getBoundingClientRect(), A = host.getBoundingClientRect(), w = el.offsetWidth, hh = el.offsetHeight;
    var left = o.right ? r.right - A.left - w : r.left - A.left;
    left = Math.max(8, Math.min(left, A.width - w - 8));
    var top = r.bottom - A.top + 6;
    if (top + hh > A.height - 8 && r.top - A.top - 6 - hh >= 8) top = r.top - A.top - 6 - hh;
    top = Math.max(8, Math.min(top, A.height - hh - 8));
    el.style.left = left + 'px'; el.style.top = top + 'px';
  }
  place();
  el.style.visibility = '';
  anchor.setAttribute('aria-expanded', 'true');
  function enabled() { return Array.prototype.filter.call(el.querySelectorAll('button'), function (b) { return b.getAttribute('aria-disabled') !== 'true'; }); }
  function all() { return Array.prototype.slice.call(el.querySelectorAll('button')); }
  var start = el.querySelector('button.on:not([aria-disabled=true])') || enabled()[0] || all()[0];
  if (start) start.focus();
  var m = { el: el, anchor: anchor, ret: o.returnFocus || null };
  m.onKey = function (e) {
    if (MENU !== m) return;
    var list = all(), cur = list.indexOf(ctx.root.activeElement), k = e.key;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); closeMenu(true); return; }
    if (k === 'Tab') { closeMenu(false); return; }
    if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'Home' || k === 'End') {
      e.preventDefault(); e.stopPropagation();
      if (!list.length) return;
      var n = k === 'Home' ? 0 : k === 'End' ? list.length - 1 : (cur + (k === 'ArrowDown' ? 1 : -1) + list.length) % list.length;
      if (cur < 0 && k === 'ArrowUp') n = list.length - 1;
      list[n].focus();
      return;
    }
    if ((k === 'Enter' || k === ' ') && cur >= 0) { e.preventDefault(); e.stopPropagation(); list[cur].click(); return; }
    if (k.length === 1 && /\S/.test(k)) {   // type-ahead: first item starting with the letter
      var t = k.toLowerCase(), from = cur + 1;
      for (var i = 0; i < list.length; i++) { var b = list[(from + i) % list.length]; var lb = b.querySelector('b'); if (lb && lb.textContent.trim().toLowerCase().indexOf(t) === 0) { b.focus(); break; } }
      e.stopPropagation();
    }
  };
  m.onDown = function (e) { var p = e.composedPath ? e.composedPath() : []; if (p.indexOf(el) < 0 && p.indexOf(anchor) < 0) closeMenu(false); };
  m.onScroll = function (e) { var p = e.composedPath ? e.composedPath() : []; if (p.indexOf(el) < 0) closeMenu(false); };
  document.addEventListener('keydown', m.onKey, true);
  document.addEventListener('mousedown', m.onDown, true);
  host.addEventListener('scroll', m.onScroll, true);
  window.addEventListener('resize', m.onScroll);
  MENU = m;
  return el;
}

/* ---------- toast ----------
 * kind: undefined (neutral), 'ok' (something happened: a file was saved, text was copied), 'warn', 'bad' (error). */
function toast(msg, kind) {
  var host = app() && app().querySelector('.toasts');
  if (!host) { console.log('[APIary]', msg); return; }
  var t = h('div.toast' + (kind ? '.' + kind : ''), { role: kind === 'bad' ? 'alert' : 'status' }, msg);
  host.appendChild(t);
  setTimeout(function () { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 320); }, kind === 'bad' ? 6500 : 3500);
}

/* ---------- copy + save (local only) ---------- */
function copy(text, what) {
  what = what || 'Text';
  function fallback() {
    toast('The browser blocked the clipboard. Select the text and press Ctrl C.', 'warn');
    return codeDialog('Copy ' + what.toLowerCase(), text, { noCopy: true, note: 'Select the text and press Ctrl C (Cmd C on a Mac).' });
  }
  try {
    if (!navigator.clipboard || !navigator.clipboard.writeText) return fallback();
    return navigator.clipboard.writeText(text).then(function () { toast(what + ' copied.', 'ok'); }, fallback);
  } catch (e) { return fallback(); }
}
function saveText(name, text, mime) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  if (ctx.Audit && ctx.Audit.onDownload) ctx.Audit.onDownload(name);
  toast(name + ' downloaded.', 'ok');
}

/* ---------- dialogs ----------
 * A stack: a dialog can open over another (or over the Developer panel); Esc and Tab belong to the top one only.
 * Focus starts on [data-autofocus], else the first field, else the safe button (Cancel when the dialog has a danger
 * button), else the primary button; it returns to the control that opened the dialog when it closes. */
var OVS = [];
function focusables(box) {
  return Array.prototype.filter.call(box.querySelectorAll('button,[href],input,select,textarea,[tabindex]'), function (el) {
    return !el.disabled && el.getAttribute('tabindex') !== '-1' && !el.closest('[hidden]') && (el.offsetWidth || el.offsetHeight || el.getClientRects().length);
  });
}
function dialog(build, cls) {
  return new Promise(function (resolve) {
    var prev = (ctx.root && ctx.root.activeElement) || null;
    var scrim = h('div.scrim');
    var box = h('div.dlg' + (cls ? '.' + cls : ''), { role: 'dialog', 'aria-modal': 'true' });
    scrim.appendChild(box);
    var me = { box: box, scrim: scrim }, done = false;
    function close(v) {
      if (done) return; done = true;
      scrim.classList.remove('on');
      document.removeEventListener('keydown', onKey, true);
      var i = OVS.indexOf(me); if (i >= 0) OVS.splice(i, 1);
      closeMenu();
      setTimeout(function () { scrim.remove(); try { if (prev && prev.isConnected && prev.focus) prev.focus(); } catch (e) {} }, 200);
      resolve(v);
    }
    me.close = close;
    function onKey(e) {
      if (OVS[OVS.length - 1] !== me || MENU) return;
      if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(null); return; }
      if (e.key === 'Tab') {
        var list = focusables(box), act = ctx.root.activeElement;
        if (!list.length) { e.preventDefault(); return; }
        var i = list.indexOf(act);
        if (i < 0) { e.preventDefault(); list[e.shiftKey ? list.length - 1 : 0].focus(); }
        else if (e.shiftKey && i === 0) { e.preventDefault(); list[list.length - 1].focus(); }
        else if (!e.shiftKey && i === list.length - 1) { e.preventDefault(); list[0].focus(); }
      }
    }
    build(box, close);
    if (!box.getAttribute('aria-label') && !box.getAttribute('aria-labelledby')) {
      var t = box.querySelector('h2'); if (t) { t.id = t.id || 'dlg' + Math.random().toString(36).slice(2, 8); box.setAttribute('aria-labelledby', t.id); }
    }
    scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) close(null); });
    document.addEventListener('keydown', onKey, true);
    OVS.push(me);
    app().appendChild(scrim);
    requestAnimationFrame(function () {
      scrim.classList.add('on');
      var f = box.querySelector('[data-autofocus]') || box.querySelector('input:not([type=hidden]):not([disabled]),select,textarea');
      if (!f) f = box.querySelector('.btn.danger') ? (box.querySelector('.btn.quiet') || box.querySelector('.btn.danger')) : box.querySelector('.btn.primary');
      f && f.focus();
    });
  });
}
function topDialog() { return OVS.length ? OVS[OVS.length - 1].box : null; }

/* Code dialog: a title, an optional note, numbered mono lines; Copy (exactly what is shown), Download, Close. */
function codeDialog(title, text, o) {
  o = o || {};
  return dialog(function (box, close) {
    var lines = String(text).split('\n');
    var pre = h('pre.code.numbered', { tabindex: '0', 'aria-label': title }, lines.map(function (l) { return h('span.ln', l); }));
    U.append(box, [
      h('h2', title),
      o.note ? note(o.warn ? 'warn' : 'info', null, o.note) : null,
      pre,
      h('div.acts',
        o.filename ? btn('Download', { icon: 'download', kind: 'quiet', onClick: function () { saveText(o.filename, text, o.mime); } }) : null,
        h('button.btn.quiet', { type: 'button', onclick: function () { close(null); } }, 'Close'),
        o.noCopy ? null : (function () { var c = btn('Copy', { kind: 'primary', icon: 'copy', onClick: function () { return copy(text, o.what || 'Text'); } }); c.setAttribute('data-autofocus', ''); return c; })())
    ]);
    if (o.noCopy) setTimeout(function () { try { var r = document.createRange(); r.selectNodeContents(pre); var s = window.getSelection(); s.removeAllRanges(); s.addRange(r); pre.focus(); } catch (e) {} }, 60);
  }, 'codedlg');
}

/* confirm({ title, body, verb, danger }) — always names the environment. */
/* o.count (v3.15) marks a confirm that sends writes to Beeforce (number of items). Then:
 *  - a read-only role gets a message instead (nothing is sent);
 *  - in Production, a run of at least the guard's minimum, or any danger run (delete), asks to type PRODUCTION. */
var GUARD_WORD = 'PRODUCTION';
function guardFor(o) {
  if (o.count == null || ctx.Api.state.env !== 'production') return null;
  var g = ctx.Engine && ctx.Engine.guardSettings ? ctx.Engine.guardSettings() : { on: true, min: 20 };
  return g.on && (o.danger || o.count >= g.min) ? GUARD_WORD : null;
}
function confirm(o) {
  var uat = ctx.Api.state.env === 'uat';
  if (o.count != null && ctx.READONLY) { toast('Your APIary role is read only: nothing was sent.', 'bad'); return Promise.resolve(false); }
  var word = guardFor(o);
  return dialog(function (box, close) {
    var go = h('button.btn.' + (o.danger ? 'danger' : 'primary'), { type: 'button', onclick: function () { if (!go.disabled) close(true); } }, o.verb || 'Continue');
    var typed = null;
    if (word) {
      typed = input({ placeholder: word });
      typed.setAttribute('aria-label', 'Type ' + word + ' to confirm');
      typed.autocomplete = 'off'; typed.spellcheck = false; typed.classList.add('guardin');
      go.disabled = true;
      typed.addEventListener('input', function () { go.disabled = typed.value.trim().toUpperCase() !== word; });
      typed.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !go.disabled) { e.preventDefault(); close(true); } });
    }
    U.append(box, [
      h('h2', o.title || 'Are you sure?'),
      h('div.envbox' + (uat ? '.uat' : ''), U.icon('shield', 20), h('div', h('span.muted.small', 'This changes data in'), h('br'), h('b', ctx.Api.envLabel()))),
      o.body ? (o.body instanceof Node ? o.body : h('p.muted', o.body)) : null,
      word ? h('div.guard', h('label.small', 'This is ' + ctx.Api.envLabel() + (o.danger ? ' and it deletes data' : ' and ' + o.count + ' items') + '. Type ', h('b', word), ' to continue.'), typed) : null,
      h('div.acts',
        h('button.btn.quiet', { type: 'button', onclick: function () { close(false); } }, 'Cancel'),
        go)
    ]);
  }).then(function (v) { return v === true; });
}

/* ---------- run panel (progress + log + pause/stop) ---------- */
function runPanel(title) {
  var bar = h('i');
  var pb = h('div.pbar', bar);
  var stat = h('span.muted.small', '');
  var logEl = h('div.log');
  var ctrl = { paused: false, stopped: false };
  var pauseBtn = btn('Pause', { icon: 'pause', sm: true, kind: 'quiet' });
  var stopBtn = btn('Stop', { icon: 'stop', sm: true, kind: 'quiet' });
  var pausedChip = h('span.chip.upd.pchip', { hidden: true }, 'Paused');
  var backBtn = null;
  pauseBtn.onclick = function () {
    ctrl.paused = !ctrl.paused;
    U.swap(pauseBtn, U.icon(ctrl.paused ? 'play' : 'pause', 16), h('span', ctrl.paused ? 'Resume' : 'Pause'));
    pausedChip.hidden = !ctrl.paused;
    log(ctrl.paused ? 'Paused' : 'Resumed', 'w');
  };
  stopBtn.onclick = function () { ctrl.stopped = true; ctrl.paused = false; log('Stopping after the current item…', 'w'); };
  var acts = h('div.acts', pauseBtn, stopBtn);
  var el = h('div.run', h('div.runh', h('div.runt', h('b', title || 'Applying changes'), pausedChip), acts), pb, stat, logEl);
  /* v3.9: "Back to review" next to Pause / Stop (the flow asks first and stops the run after the current item). */
  el.addBack = function (fn) {
    backBtn = btn('Back to review', { icon: 'back', sm: true, kind: 'quiet', title: 'Stop after the current item and go back to the review (Alt ←)', onClick: fn });
    acts.insertBefore(backBtn, acts.firstChild);
  };
  function log(msg, kind) {
    var line = h('div' + (kind ? '.' + kind : ''), U.timeNow() + '  ' + msg);
    logEl.appendChild(line);
    if (logEl.children.length > 1500) logEl.removeChild(logEl.firstChild);
    logEl.scrollTop = logEl.scrollHeight;
  }
  el.ctrl = ctrl;
  el.log = log;
  el.set = function (done, total, extra) {
    bar.style.width = (total ? Math.round(done / total * 100) : 0) + '%';
    stat.textContent = done + ' of ' + total + (extra ? ' · ' + extra : '');
  };
  el.finish = function (summary) {
    pb.classList.add('done'); bar.style.width = '100%';
    acts.remove(); pausedChip.hidden = true;
    if (summary) stat.textContent = summary;
  };
  return el;
}

/* Small key/value list */
function kv(obj) {
  return h('dl.kv', Object.keys(obj).map(function (k) { return [h('dt', k), h('dd', obj[k] == null || obj[k] === '' ? '—' : String(obj[k]))]; }));
}

ctx.UI = {
  btn: btn, busy: busy, header: header, tabs: tabs, field: field, input: input, textarea: textarea, select: select, check: check,
  note: note, chip: chip, empty: empty, counts: counts, steps: steps, drop: drop, table: table, toast: toast,
  dialog: dialog, confirm: confirm, runPanel: runPanel, kv: kv, stopKeys: stopKeys,
  setReason: setReason, menu: menu, closeMenu: closeMenu, menuOpen: menuOpen, codeDialog: codeDialog, copy: copy, saveText: saveText,
  skeleton: skeleton, topDialog: topDialog, splitBtn: splitBtn
};
