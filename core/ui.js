/* core/ui.js — building blocks the tools use: header, tabs, buttons, fields, drop zone,
 * table, counts, steps, notes, run panel, confirm dialog, toasts. */
'use strict';

var U = ctx.U, h = U.h;
function app() { return ctx.appEl; }

/* ---------- basic pieces ---------- */
function btn(label, o) {
  o = o || {};
  var b = h('button.btn' + (o.kind ? '.' + o.kind : '') + (o.sm ? '.sm' : ''), { type: 'button', title: o.title, disabled: o.disabled },
    o.icon ? U.icon(o.icon, o.sm ? 16 : 18) : null, label ? h('span', label) : null);
  if (o.onClick) b.addEventListener('click', function (e) { busy(b, function () { return o.onClick(e); }); });
  return b;
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

/* Hex steps: steps(['Choose file','Review','Apply','Report']) -> el with el.set(i) */
function steps(names) {
  var el = h('div.steps');
  var nodes = [], bars = [];
  names.forEach(function (n, i) {
    if (i) { var b = h('div.bar', h('i')); bars.push(b); el.appendChild(b); }
    var s = h('div.step', h('div.hx', h('b', String(i + 1))), h('span', n));
    nodes.push(s); el.appendChild(s);
  });
  el.set = function (cur) {
    nodes.forEach(function (s, i) {
      s.classList.toggle('done', i < cur); s.classList.toggle('now', i === cur);
      s.querySelector('b').textContent = i < cur ? '✓' : String(i + 1);
    });
    bars.forEach(function (b, i) { b.classList.toggle('done', i < cur); });
  };
  el.set(0);
  return el;
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
 * cols: [{ key, label, wrap, render(row) -> node|string }]
 * o: { select:true, search:true, limit:500, selected:Set, onSelect(set), rowKey(row), toolbar:[nodes] }
 * row.__chg = { key:true } highlights changed cells. */
function table(cols, rows, o) {
  o = o || {};
  var limit = o.limit || 500;
  var key = o.rowKey || function (r, i) { return r.id != null ? String(r.id) : String(i); };
  var sel = o.selected || new Set();
  var q = '';
  var tbody = h('tbody');
  var more = h('div.tmore');
  var allBox = o.select ? h('input', { type: 'checkbox', 'aria-label': 'Select all' }) : null;
  var countEl = h('span.muted.small');

  function cell(c, r) {
    var v = c.render ? c.render(r) : r[c.key];
    var td = h('td' + (c.wrap ? '.wrap' : '') + (r.__chg && r.__chg[c.key] ? '.chg' : ''));
    if (v instanceof Node) td.appendChild(v); else { td.textContent = v == null ? '' : String(ctx.X.fmt(v)); td.title = td.textContent; }
    return td;
  }
  function visible() {
    if (!q) return rows;
    var w = q.toLowerCase();
    return rows.filter(function (r) {
      return cols.some(function (c) { var v = c.text ? c.text(r) : r[c.key]; return v != null && String(typeof v === 'object' ? JSON.stringify(v) : v).toLowerCase().indexOf(w) >= 0; });
    });
  }
  function draw() {
    var list = visible();
    U.clear(tbody);
    list.slice(0, limit).forEach(function (r, i) {
      var k = key(r, rows.indexOf(r));
      var tr = h('tr' + (sel.has(k) ? '.sel' : ''));
      if (o.select) {
        var cb = h('input', { type: 'checkbox', checked: sel.has(k), disabled: !!r.__lock });
        cb.addEventListener('change', function () { cb.checked ? sel.add(k) : sel.delete(k); tr.classList.toggle('sel', cb.checked); sync(); });
        tr.appendChild(h('td', cb));
      }
      cols.forEach(function (c) { tr.appendChild(cell(c, r)); });
      tbody.appendChild(tr);
    });
    more.textContent = list.length > limit ? 'Showing first ' + limit + ' of ' + list.length + ' rows. Search to narrow down.' : '';
    more.hidden = list.length <= limit;
    sync();
  }
  function sync() {
    countEl.textContent = (o.select ? sel.size + ' selected · ' : '') + visible().length + ' rows';
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
    var tm;
    search.addEventListener('input', function () { clearTimeout(tm); tm = setTimeout(function () { q = search.value.trim(); draw(); }, 120); });
  }
  var thead = h('thead', h('tr', o.select ? h('th', allBox) : null, cols.map(function (c) { return h('th', c.label); })));
  var el = h('div',
    h('div.tbar', search, countEl, o.toolbar ? h('div.acts', { style: { marginLeft: 'auto' } }, o.toolbar) : null),
    h('div.twrap', h('table', thead, tbody), more));
  el.selected = sel;
  el.redraw = draw;
  el.setRows = function (r) { rows = r; draw(); };
  draw();
  return el;
}

/* ---------- toast ---------- */
function toast(msg, kind) {
  var host = app() && app().querySelector('.toasts');
  if (!host) { console.log('[BeeForce Tools]', msg); return; }
  var t = h('div.toast' + (kind ? '.' + kind : ''), msg);
  host.appendChild(t);
  setTimeout(function () { t.style.transition = 'opacity .3s'; t.style.opacity = '0'; setTimeout(function () { t.remove(); }, 320); }, kind === 'bad' ? 6500 : 3500);
}

/* ---------- dialogs ---------- */
function dialog(build) {
  return new Promise(function (resolve) {
    var prev = document.activeElement;
    var scrim = h('div.scrim');
    var box = h('div.dlg', { role: 'dialog', 'aria-modal': 'true' });
    scrim.appendChild(box);
    function close(v) {
      scrim.classList.remove('on');
      document.removeEventListener('keydown', onKey, true);
      setTimeout(function () { scrim.remove(); try { prev && prev.focus(); } catch (e) {} }, 200);
      resolve(v);
    }
    function onKey(e) { if (e.key === 'Escape') { e.stopPropagation(); close(null); } }
    build(box, close);
    scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) close(null); });
    document.addEventListener('keydown', onKey, true);
    app().appendChild(scrim);
    requestAnimationFrame(function () { scrim.classList.add('on'); var f = box.querySelector('input,.btn.primary,.btn.danger'); f && f.focus(); });
  });
}

/* confirm({ title, body, verb, danger }) — always names the environment. */
function confirm(o) {
  var uat = ctx.Api.state.env === 'uat';
  return dialog(function (box, close) {
    U.append(box, [
      h('h2', o.title || 'Are you sure?'),
      h('div.envbox' + (uat ? '.uat' : ''), U.icon('shield', 20), h('div', h('span.muted.small', 'This changes data in'), h('br'), h('b', ctx.Api.envLabel()))),
      o.body ? (o.body instanceof Node ? o.body : h('p.muted', o.body)) : null,
      h('div.acts',
        h('button.btn.quiet', { type: 'button', onclick: function () { close(false); } }, 'Cancel'),
        h('button.btn.' + (o.danger ? 'danger' : 'primary'), { type: 'button', onclick: function () { close(true); } }, o.verb || 'Continue'))
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
  pauseBtn.onclick = function () {
    ctrl.paused = !ctrl.paused;
    U.swap(pauseBtn, U.icon(ctrl.paused ? 'play' : 'pause', 16), h('span', ctrl.paused ? 'Resume' : 'Pause'));
    log(ctrl.paused ? 'Paused' : 'Resumed', 'w');
  };
  stopBtn.onclick = function () { ctrl.stopped = true; ctrl.paused = false; log('Stopping after the current item…', 'w'); };
  var acts = h('div.acts', pauseBtn, stopBtn);
  var el = h('div.run', h('div.runh', h('b', title || 'Applying changes'), acts), pb, stat, logEl);
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
    acts.remove();
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
  dialog: dialog, confirm: confirm, runPanel: runPanel, kv: kv, stopKeys: stopKeys
};
