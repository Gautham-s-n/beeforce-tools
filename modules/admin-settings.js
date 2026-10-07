/* modules/admin-settings.js — Admin Settings (Settings area, admins only).
 * Tabs: Honeycomb layout · Sign-in & audit · API endpoints (registry editor + Postman importer).
 * No Beeforce API calls; everything here is stored in this browser or exported as files for the repo. */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, L = ctx.Layout;

ctx.ADMIN_TABS = ctx.ADMIN_TABS || [];   // other core parts can add tabs: { id, label, render(el) }

ctx.defineTool('admin-settings', {
  desc: 'Arrange the honeycomb, set this browser’s sign-in client and audit webhook, and manage API endpoints.',
  render: function (body) {
    if (!L.isAdmin()) { body.appendChild(UI.note('bad', 'Admins only', 'Open Admin Settings from the admin console login.')); return; }
    body.appendChild(UI.tabs([
      { id: 'layout', label: 'Honeycomb', render: layoutTab },
      { id: 'secrets', label: 'Sign-in & audit', render: secretsTab },
      { id: 'endpoints', label: 'API endpoints', render: endpointsTab },
      { id: 'admin', label: 'Admin password', render: function (el) { el.appendChild(h('div.card', ctx.Shell.adminLoginPanel({ change: true }))); } }
    ].concat(ctx.ADMIN_TABS)));
  }
});

/* ======================= Sign-in & audit ======================= */
function secretsTab(el) {
  var status = h('div');
  function drawStatus() {
    var st = ctx.Secrets.auditState(), s = ctx.Secrets.get();
    var txt = { configured: 'Audit events are sent to Google Chat from this browser.', unconfirmed: 'A webhook is saved, but delivery could not be confirmed. Check the Chat space.', 'not-configured': 'Audit events will not be sent from this browser.', failed: 'The last test failed. Audit configuration needs attention.' }[st];
    U.swap(status, h('div.card', { style: { marginBottom: '16px' } },
      UI.kv({ 'Site': location.host, 'Sign-in client': s.clientId + (s.clientSecret ? ' · secret saved (' + ctx.Secrets.mask(s.clientSecret) + ')' : ' · no secret'),
        'Audit webhook': st === 'not-configured' ? 'Not configured' : ctx.Secrets.maskUrl(s.webhookUrl) }),
      h('div', { style: { marginTop: '10px' } }, ctx.Shell.auditBadge(), ' ', h('span.small.muted', txt))));
  }
  drawStatus();
  var holder = h('div.card');
  function drawForm() { U.swap(holder, ctx.Shell.secretsPanel({ inSettings: true, onDone: function () { drawStatus(); drawForm(); } })); }
  drawForm();
  U.append(el, [status, holder,
    h('div.spacer'),
    h('div.card', h('b', 'Remove everything from this browser'), h('p.muted.small', 'Deletes the client secret and webhook saved on ' + location.host + '. You will see the setup screen on the next sign-in.'),
      UI.btn('Remove secrets', { kind: 'danger', icon: 'trash', onClick: async function () {
        if (!(await UI.confirm({ title: 'Remove secrets from this browser?', body: 'The client secret and audit webhook saved on ' + location.host + ' will be deleted.', verb: 'Remove', danger: true }))) return;
        ctx.Secrets.clear(); drawStatus(); drawForm(); UI.toast('Removed. Setup will be asked on next sign-in.');
      } }))]);
}

/* ======================= Honeycomb layout ======================= */
var ICON_CHOICES = ['clock', 'coin', 'cal', 'leaf', 'sun', 'shield', 'people', 'bolt', 'list', 'template', 'key', 'search', 'home'];

function layoutTab(el) {
  var model = L.effective();
  var saved = JSON.stringify(model);
  var root = h('div');
  el.appendChild(root);

  function dirty() { return JSON.stringify(model) !== saved; }
  function slug(name) {
    var b = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'area';
    var id = b, n = 2; while (model.areas.some(function (a) { return a.id === id; })) id = b + '-' + n++;
    return id;
  }
  function counts() {
    var team = ctx.repoLayout ? Object.keys(ctx.repoLayout.areas || {}).length + Object.keys(ctx.repoLayout.tools || {}).length : 0;
    var loc = L.local(); var mine = loc ? Object.keys(loc.areas || {}).length + Object.keys(loc.tools || {}).length : 0;
    return { team: team, mine: mine };
  }

  var checkBox = h('div');
  var saveBtn, discardBtn;
  function check() {
    var errs = L.validate(model);
    U.swap(checkBox, errs.length
      ? h('div.note.bad', h('div', h('b', errs.length === 1 ? '1 problem to fix before saving' : errs.length + ' problems to fix before saving'), h('ul', { style: { margin: '4px 0 0', paddingLeft: '18px' } }, errs.map(function (e) { return h('li', e); }))))
      : h('div.note.ok', h('div', h('b', dirty() ? 'Ready to save' : 'No unsaved changes'), dirty() ? 'Saving updates the honeycomb in this browser right away.' : null)));
    if (saveBtn) saveBtn.disabled = !!errs.length || !dirty();
    if (discardBtn) discardBtn.disabled = !dirty();
    return errs;
  }

  function draw() {
    var c = counts();
    saveBtn = UI.btn('Save to this browser', { kind: 'primary', icon: 'check', onClick: save });
    discardBtn = UI.btn('Discard changes', { kind: 'quiet', icon: 'back', onClick: function () { model = JSON.parse(saved); draw(); } });
    var importInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
    importInput.addEventListener('change', function () { importFile(importInput.files[0]); importInput.value = ''; });
    U.swap(root,
      h('div.row', { style: { marginBottom: '6px' } },
        h('span.muted.small', { style: { flex: '1 1 300px' } }, 'Built-in defaults → team file layout.json (' + (c.team ? c.team + ' change' + (c.team > 1 ? 's' : '') : 'none') + ') → this browser (' + (c.mine ? c.mine + ' change' + (c.mine > 1 ? 's' : '') : 'none') + ').'),
        h('div.acts',
          UI.btn('Export layout.json', { sm: true, icon: 'download', onClick: exportFile }),
          UI.btn('Import', { sm: true, icon: 'upload', kind: 'quiet', onClick: function () { importInput.click(); } }),
          UI.btn('Reset this browser', { sm: true, icon: 'retry', kind: 'quiet', onClick: resetLocal }),
          importInput)),
      checkBox,
      h('div.row', { style: { margin: '6px 0 14px' } }, saveBtn, discardBtn, h('span', { style: { flex: 1 } }),
        UI.btn('Add area', { icon: 'list', onClick: addArea })),
      h('div.areagrid', model.areas.map(areaCard)),
      unplacedCard());
    check();
  }

  function areaCard(a, i) {
    var name = UI.input({ value: a.name });
    name.addEventListener('input', function () { a.name = name.value; check(); });
    var desc = UI.input({ value: a.desc || '', placeholder: 'Short description (shown on hover)' });
    desc.addEventListener('input', function () { a.desc = desc.value; check(); });
    var icon = UI.select(ICON_CHOICES.map(function (k) { return { value: k, label: k }; }), a.icon);
    icon.style.maxWidth = '120px';
    icon.addEventListener('change', function () { a.icon = icon.value; draw(); });
    var vis = UI.check('Visible', !a.hidden);
    vis.input.addEventListener('change', function () { a.hidden = !vis.input.checked; draw(); });
    var isDefault = ctx.DEFAULT_AREAS.some(function (d) { return d.id === a.id; });
    var visibleTools = a.tools.filter(function (t) { return !model.tools[t].hidden; }).length;
    var card = h('div.card' + (a.hidden ? '.dimcard' : ''), { style: { opacity: a.hidden ? '.65' : '1' } },
      h('div.row', { style: { alignItems: 'center', marginBottom: '10px' } },
        h('div.hexico', U.icon(a.icon, 18)), h('div', { style: { flex: 1 } }, name), icon,
        moveBtns(model.areas, i)),
      desc,
      h('div.row', { style: { alignItems: 'center', margin: '8px 0 6px' } }, vis,
        h('span.small' + (visibleTools > L.MAX_TOOLS ? '.badtxt' : '.dim'), visibleTools + ' of ' + L.MAX_TOOLS + ' ring slots used'),
        h('span', { style: { flex: 1 } }),
        !isDefault && !a.tools.length ? UI.btn('Delete area', { sm: true, kind: 'quiet', icon: 'trash', onClick: function () { model.areas.splice(i, 1); draw(); } }) : null),
      a.tools.length ? h('div.tlist', a.tools.map(function (t, j) { return toolRow(a, t, j); })) : h('div.dim.small', 'No tools yet. Place one from “Not in the honeycomb” or move one here.'));
    return card;
  }

  function toolRow(a, t, j) {
    var info = model.tools[t];
    var nm = UI.input({ value: info.name }); nm.addEventListener('input', function () { info.name = nm.value; check(); });
    var hint = UI.input({ value: info.hint || '', placeholder: 'Hint' }); hint.addEventListener('input', function () { info.hint = hint.value; check(); });
    var vis = UI.check('', !info.hidden); vis.title = 'Visible';
    vis.input.addEventListener('change', function () { info.hidden = !vis.input.checked; draw(); });
    var mv = UI.select([{ value: '', label: 'Move to…' }].concat(model.areas.filter(function (x) { return x !== a; }).map(function (x) { return { value: x.id, label: x.name + (x.hidden ? ' (hidden)' : '') }; })).concat([{ value: '__out', label: 'Remove from honeycomb' }]), '');
    mv.style.maxWidth = '150px';
    mv.addEventListener('change', function () {
      if (!mv.value) return;
      a.tools.splice(j, 1);
      if (mv.value !== '__out') model.areas.filter(function (x) { return x.id === mv.value; })[0].tools.push(t);
      draw();
    });
    return h('div.trow' + (info.hidden ? '.off' : ''), vis, h('div.tf', nm, hint), h('code.dim', t), mv, moveBtns(a.tools, j));
  }

  function moveBtns(list, i) {
    function mvTo(d) { var x = list.splice(i, 1)[0]; list.splice(i + d, 0, x); draw(); }
    return h('span.updn',
      h('button.iconbtn', { type: 'button', title: 'Move up', disabled: i === 0, onclick: function () { mvTo(-1); } }, h('span', '↑')),
      h('button.iconbtn', { type: 'button', title: 'Move down', disabled: i === list.length - 1, onclick: function () { mvTo(1); } }, h('span', '↓')));
  }

  function unplacedCard() {
    var list = L.unplaced(model);
    if (!list.length) return null;
    return h('div.card', { style: { marginTop: '14px' } },
      h('b', 'Not in the honeycomb'), h('p.muted.small', { style: { margin: '2px 0 10px' } }, 'These tools exist but are not placed in any area, so nobody can open them.'),
      list.map(function (t) {
        var sel = UI.select([{ value: '', label: 'Place in…' }].concat(model.areas.map(function (x) { return { value: x.id, label: x.name }; })), '');
        sel.style.maxWidth = '200px';
        sel.addEventListener('change', function () { if (!sel.value) return; model.areas.filter(function (x) { return x.id === sel.value; })[0].tools.push(t); draw(); });
        return h('div.trow', h('div.tf', h('b', model.tools[t].name), h('span.dim.small', model.tools[t].hint)), h('code.dim', t), sel);
      }));
  }

  async function addArea() {
    var name = await UI.dialog(function (box, close) {
      var inp = UI.input({ placeholder: 'Area name' });
      var f = h('form', h('h2', 'Add area'), UI.field('Name', inp), h('p.muted.small', 'Then move tools into it. An empty area is not shown.'),
        h('div.acts', h('button.btn.quiet', { type: 'button', onclick: function () { close(null); } }, 'Cancel'), h('button.btn.primary', { type: 'submit' }, 'Add')));
      f.addEventListener('submit', function (e) { e.preventDefault(); if (inp.value.trim()) close(inp.value.trim()); });
      box.appendChild(f);
    });
    if (!name) return;
    model.areas.push({ id: slug(name), name: name, icon: 'list', desc: '', hidden: false, tools: [] });
    draw();
  }

  async function save() {
    var errs = L.saveLocal(model);
    if (errs.length) { UI.toast(errs[0], 'bad'); return; }
    saved = JSON.stringify(model);
    ctx.Shell.relayout();
    draw();
    UI.toast('Saved. The honeycomb in this browser is updated.');
  }

  async function resetLocal() {
    if (!L.local()) { UI.toast('This browser has no layout changes.'); return; }
    if (!(await UI.confirm({ title: 'Reset this browser’s layout?', body: 'Your browser changes are removed. The team layout (layout.json) and built-in defaults stay.', verb: 'Reset', danger: true }))) return;
    L.clearLocal(); model = L.effective(); saved = JSON.stringify(model);
    ctx.Shell.relayout(); draw(); UI.toast('Reset to the team layout.');
  }

  function exportFile() {
    var data = L.exportRepo(model);
    var blob = new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = 'layout.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
    ctx.Audit.onDownload('layout.json');
    UI.toast('layout.json downloaded. Commit it next to index.js so the whole team gets this layout.');
  }

  function importFile(f) {
    if (!f) return;
    f.text().then(function (txt) {
      var o; try { o = JSON.parse(txt); } catch (e) { throw new Error('Not valid JSON: ' + e.message); }
      if (!o || typeof o !== 'object' || (!o.areas && !o.tools)) throw new Error('This is not a layout file (needs "areas" / "tools").');
      model = L.apply(L.defaultsModel(), o);
      draw();
      UI.toast('Loaded ' + f.name + '. Review, then Save to apply it in this browser.');
    }).catch(function (e) { UI.toast(e.message, 'bad'); });
  }

  draw();
}

ctx.addCSS('admin-settings', [
  '.hexico{width:30px;height:34px;clip-path:var(--hex);background:var(--bluebg);display:grid;place-items:center;color:var(--blue3);flex:none}',
  '.areagrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(560px,1fr));gap:14px;align-items:start}',
  '.tlist{display:grid;gap:6px;margin-top:6px}',
  '.trow{display:flex;align-items:center;gap:8px;padding:6px 8px;border:1px solid var(--line);border-radius:12px;background:#0C1626}',
  '.trow.off{opacity:.55}',
  '.trow .tf{flex:1;display:grid;grid-template-columns:minmax(120px,1fr) minmax(120px,1.2fr);gap:6px;min-width:0}',
  '.trow .input{min-height:34px;padding:6px 9px}',
  '.trow code{font-size:11px;max-width:90px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
  '.updn{display:inline-flex;gap:2px}.updn .iconbtn{width:28px;height:28px}.updn .iconbtn[disabled]{opacity:.3;cursor:default}',
  '.badtxt{color:var(--bad)}'
].join('\n'));

/* ======================= API endpoints (registry + Postman importer) ======================= */

/* Postman collection v2.1 → [{ name, folder, method, raw, host, path, query, slash, prefix, error }] */
var Postman = {
  parse: function (json) {
    if (!json || typeof json !== 'object' || !Array.isArray(json.item)) throw new Error('This is not a Postman collection (no root "item" list).');
    var vars = {};
    (json.variable || []).forEach(function (v) { if (v && v.key) vars[v.key] = String(v.value == null ? '' : v.value); });
    var out = [];
    (function walk(items, folder) {
      items.forEach(function (it) {
        if (!it || typeof it !== 'object') return;
        if (Array.isArray(it.item)) return walk(it.item, folder ? folder + ' / ' + (it.name || '') : (it.name || ''));
        if (!it.request) return;
        var req = typeof it.request === 'string' ? { url: it.request, method: 'GET' } : it.request;
        var u = req.url, raw = '';
        if (typeof u === 'string') raw = u;
        else if (u && typeof u === 'object') raw = u.raw || ((Array.isArray(u.host) ? u.host.join('.') : (u.host || '')) + '/' + (Array.isArray(u.path) ? u.path.join('/') : (u.path || '')));
        out.push(Object.assign({ name: it.name || '', folder: folder || '', method: String(req.method || 'GET').toUpperCase(), raw: raw }, Postman.normalise(raw, vars)));
      });
    })(json.item, '');
    return out;
  },
  /* raw URL → { host, path ({id} placeholders, no trailing slash), slash, query, hostKind, error } */
  normalise: function (raw, vars) {
    var s = String(raw || '').trim(), host = '', hostKind = 'none', error = '';
    s = s.replace(/^\{\{([^}]+)\}\}/, function (m, k) { host = '{{' + k + '}}'; hostKind = 'variable'; var v = vars && vars[k]; return v && /^https?:\/\//.test(v) ? v.replace(/\/+$/, '') : ''; });
    var m = s.match(/^(https?:\/\/[^\/?#]+)/i);
    if (m) { host = m[1]; hostKind = /(^|\.)beeforce\.in(:\d+)?$/i.test(m[1].replace(/^https?:\/\//i, '')) ? 'beeforce' : 'other'; s = s.slice(m[1].length); }
    var q = '', qi = s.search(/[?#]/);
    if (qi >= 0) { q = s.slice(qi + 1).replace(/#.*$/, ''); s = s.slice(0, qi); }
    if (s && s[0] !== '/') s = '/' + s;
    var slash = s.length > 1 && /\/$/.test(s);
    var segs = s.replace(/\/+$/, '').split('/').map(function (g) {
      if (/^:[\w-]+$/.test(g) || /^\{\{[^}]+\}\}$/.test(g) || /^\{[\w-]+\}$/.test(g) || /^\d+$/.test(g) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(g)) return '{id}';
      return g;
    });
    var path = segs.join('/') || '/';
    if (hostKind === 'other') error = 'Different host: ' + host.replace(/^https?:\/\//, '');
    else if (!/^\/api\//.test(path)) error = 'Not a Beeforce API path (missing /api/…)';
    return { host: host, hostKind: hostKind, path: path, slash: slash, query: q, error: error };
  },
  /* registry path → comparable form */
  regNorm: function (p) { return { path: p.replace(/\{[a-zA-Z]+\}/g, '{id}').replace(/\/+$/, ''), slash: /\/$/.test(p) && p.length > 1 }; },
  /* put the registry's own placeholder names back into a file path */
  withNames: function (filePath, regPath, slash) {
    var names = regPath.match(/\{[a-zA-Z]+\}/g) || [], i = 0;
    var p = filePath.replace(/\{id\}/g, function () { return names[i++] || '{id}'; });
    return p + (slash ? '/' : '');
  },
  /* Map file endpoints onto registry entries. Returns { rows, extra, prefixes } */
  map: function (fileEps, entries) {
    var prefixes = {};
    entries.forEach(function (e) { prefixes[e.path.split('/').slice(0, 3).join('/')] = 1; });
    var used = fileEps.map(function () { return false; });
    function tail(p, n) { return p.split('/').filter(function (g) { return g && g !== '{id}'; }).slice(-n).join('/'); }
    var rows = entries.map(function (e) {
      var r = Postman.regNorm(e.path), best = null;
      fileEps.forEach(function (f, i) {
        if (f.error || f.method !== e.method) return;
        var score = 0, how = '';
        if (f.path === r.path && f.slash === r.slash) { score = 3; how = 'exact'; }
        else if (f.path === r.path) { score = 2; how = 'slash'; }
        else if (tail(f.path, 2) && tail(f.path, 2) === tail(r.path, 2) && (f.path.match(/\{id\}/g) || []).length === (r.path.match(/\{id\}/g) || []).length) { score = 1; how = 'similar'; }
        if (score >= 2) used[i] = true;   // same route (duplicates in the file count as used too)
        if (score && (!best || score > best.score)) best = { score: score, how: how, i: i, f: f };
      });
      if (best) used[best.i] = true;
      return { key: e.key, entry: e, match: best };
    });
    var extra = fileEps.map(function (f, i) {
      if (used[i]) return null;
      var kind = f.error ? 'bad' : (prefixes[f.path.split('/').slice(0, 3).join('/')] ? 'unused' : 'structure');
      return Object.assign({ kind: kind, msg: f.error || (kind === 'structure' ? 'Doesn’t match the Beeforce API structure (expected ' + Object.keys(prefixes).join(' or ') + '/…)' : 'Not used by any tool') }, f);
    }).filter(Boolean);
    return { rows: rows, extra: extra, prefixes: Object.keys(prefixes) };
  },
  /* Registry → Postman collection v2.1 (for testing the importer or sharing) */
  build: function (entries, name) {
    var byTool = {};
    entries.forEach(function (e) { (byTool[e.tool] = byTool[e.tool] || []).push(e); });
    return {
      info: { name: name || 'BeeForce Tools endpoints', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      variable: [{ key: 'baseUrl', value: ctx.Api.state.base || 'https://app.beeforce.in' }],
      item: Object.keys(byTool).map(function (t) {
        return { name: (ctx.DEFAULT_TOOLS[t] || {}).name || t, item: byTool[t].map(function (e) {
          var p = e.path.replace(/\{([a-zA-Z]+)\}/g, ':$1');
          var q = e.query ? '?' + Object.keys(e.query).map(function (k) { return k + '=' + e.query[k]; }).join('&') : '';
          return { name: e.label || e.key, request: { method: e.method, header: [], url: { raw: '{{baseUrl}}' + p + q, host: ['{{baseUrl}}'], path: p.replace(/^\//, '').split('/') } } };
        }) };
      })
    };
  }
};
ctx.Postman = Postman;

function toolName(t) { return (ctx.TOOLS[t] || ctx.DEFAULT_TOOLS[t] || {}).name || t; }
function saveJson(name, data) {
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  ctx.Audit.onDownload(name);
}

function endpointsTab(el) {
  var EP = ctx.EP;
  var state;           // { key: { method, path, use, match, err } }
  var mapped = null;   // result of Postman.map when a file is loaded
  var fileName = '';
  var filter = 'all';

  function reset() {
    state = {};
    EP.all().forEach(function (e) { state[e.key] = { method: e.method, path: e.path, cur: { method: e.method, path: e.path }, source: e.source, match: null, use: false }; });
    mapped = null; fileName = '';
  }
  reset();

  var root = h('div');
  el.appendChild(root);
  var fileIn = h('input', { type: 'file', accept: '.json,application/json', hidden: true });
  fileIn.addEventListener('change', function () { var f = fileIn.files[0]; fileIn.value = ''; if (f) load(f); });

  function load(f) {
    f.text().then(function (txt) {
      var json; try { json = JSON.parse(txt); } catch (e) { throw new Error('Not valid JSON: ' + e.message); }
      var eps = Postman.parse(json);
      if (!eps.length) throw new Error('No requests found in ' + f.name + '.');
      ctx.Audit.onFileSelected(f.name);
      reset();
      fileName = f.name;
      mapped = Postman.map(eps, EP.all());
      mapped.total = eps.length;
      mapped.rows.forEach(function (r) {
        var s = state[r.key]; s.match = r.match;
        if (r.match) {
          var proposed = Postman.withNames(r.match.f.path, r.entry.path, r.match.f.slash);
          s.file = { method: r.match.f.method, path: proposed, raw: r.match.f.raw, name: r.match.f.name };
          // exact = nothing to change; slash/similar = proposal, admin opts in
          s.use = false;
        }
      });
      filter = 'problems';
      draw();
      UI.toast('Read ' + eps.length + ' requests from ' + f.name + '.');
    }).catch(function (e) { UI.toast(e.message, 'bad'); });
  }

  function status(key) {
    var s = state[key], e = EP.DEFAULTS[key];
    var errs = EP.check(s.method, s.path, e);
    if (errs.length) return { kind: 'bad', chip: 'Invalid', msg: errs.join(' · ') };
    if (!mapped) return { kind: s.source === 'built-in' ? '' : 'upd', chip: s.source === 'built-in' ? 'Built-in' : s.source === 'team' ? 'Team file' : 'This browser', msg: '' };
    var m = s.match;
    if (!m) return e.required === false ? { kind: '', chip: 'Optional', msg: 'Not in the file (optional call — current URL kept)' }
      : { kind: 'bad', chip: 'Missing', msg: 'Missing ' + e.method + ' endpoint for ' + toolName(e.tool) + ' (' + (e.label || key) + ') — current URL kept' };
    if (m.how === 'exact') return { kind: 'ok', chip: 'Matched', msg: '' };
    if (m.how === 'slash') return { kind: 'upd', chip: 'Slash differs', msg: 'File: ' + s.file.path + ' — Beeforce is strict about trailing slashes; keep ours unless the route really changed.' };
    return { kind: 'upd', chip: 'Check', msg: 'Similar path in file: ' + s.file.path + ' (“' + s.file.name + '”)' };
  }
  function changed(key) { var s = state[key]; return s.method !== s.cur.method || s.path !== s.cur.path; }
  function invalidKeys() { return Object.keys(state).filter(function (k) { return EP.check(state[k].method, state[k].path, EP.DEFAULTS[k]).length; }); }

  function draw() {
    var keys = Object.keys(state);
    var st = {}; keys.forEach(function (k) { st[k] = status(k); });
    var n = { ok: 0, check: 0, missing: 0, opt: 0, invalid: 0, changed: 0 };
    keys.forEach(function (k) {
      var x = st[k];
      if (x.chip === 'Matched') n.ok++; else if (x.chip === 'Missing') n.missing++; else if (x.chip === 'Optional') n.opt++;
      else if (x.chip === 'Check' || x.chip === 'Slash differs') n.check++;
      if (x.chip === 'Invalid') n.invalid++;
      if (changed(k)) n.changed++;
    });
    var bad = invalidKeys();
    var saveBtn = UI.btn('Apply & Save', { kind: 'primary', icon: 'check', onClick: save });
    saveBtn.disabled = !!bad.length || !n.changed;
    var groups = {};
    keys.forEach(function (k) {
      var x = st[k];
      var show = filter === 'all' || (filter === 'problems' && (x.kind === 'bad' || x.kind === 'upd')) || (filter === 'changed' && changed(k));
      if (show) (groups[EP.DEFAULTS[k].tool] = groups[EP.DEFAULTS[k].tool] || []).push(k);
    });
    var fchips = h('div.row', { style: { margin: '10px 0 8px' } }, [['all', 'All ' + keys.length], ['problems', 'Needs attention'], ['changed', 'Changed ' + n.changed]].map(function (f) {
      var b = UI.btn(f[1], { sm: true, kind: filter === f[0] ? '' : 'quiet' }); b.onclick = function () { filter = f[0]; draw(); }; return b;
    }));
    U.swap(root,
      h('div.row', { style: { marginBottom: '8px' } },
        h('span.muted.small', { style: { flex: '1 1 320px' } }, 'Built-in → team file endpoints.json (' + Object.keys((ctx.repoEndpoints || {}).endpoints || {}).length + ') → this browser (' + Object.keys((EP.local() || {}).endpoints || {}).length + '). Method and path only; query parameters stay in each tool.'),
        h('div.acts',
          UI.btn('Import Postman collection', { sm: true, icon: 'upload', onClick: function () { fileIn.click(); } }),
          UI.btn('Download endpoints.json', { sm: true, icon: 'download', kind: 'quiet', onClick: function () { saveJson('endpoints.json', EP.exportRepo(current())); UI.toast('endpoints.json downloaded. Commit it next to index.js for the whole team.'); } }),
          UI.btn('Download as Postman', { sm: true, icon: 'download', kind: 'quiet', onClick: function () { saveJson('beeforce-tools.postman_collection.json', Postman.build(EP.all())); } }),
          UI.btn('Reset this browser', { sm: true, icon: 'retry', kind: 'quiet', onClick: resetLocal }),
          fileIn)),
      mapped ? UI.counts([{ n: n.ok, label: 'Matched', kind: 'ok' }, { n: n.check, label: 'Check', kind: 'upd' }, { n: n.missing, label: 'Missing', kind: 'bad' }, { n: mapped.extra.length, label: 'Not used / invalid in file' }]) : null,
      mapped ? h('p.small.muted', 'From ' + fileName + ' (' + mapped.total + ' requests). Postman is only a check: anything missing or unmatched keeps its current URL. Tick “Use file” to take a proposed URL, or edit any row by hand.') : null,
      bad.length ? UI.note('bad', bad.length + ' row' + (bad.length > 1 ? 's are' : ' is') + ' invalid', 'Fix them before saving: ' + bad.slice(0, 4).map(function (k) { return EP.DEFAULTS[k].label || k; }).join(', ') + (bad.length > 4 ? '…' : '')) : null,
      h('div.row', { style: { alignItems: 'center' } }, saveBtn, UI.btn('Undo edits', { kind: 'quiet', icon: 'back', onClick: function () { Object.keys(state).forEach(function (k) { state[k].method = state[k].cur.method; state[k].path = state[k].cur.path; state[k].use = false; }); draw(); } }), h('span', { style: { flex: 1 } }), fchips),
      Object.keys(groups).length ? h('div.twrap', { style: { maxHeight: 'none' } }, h('table.eptable',
        h('thead', h('tr', h('th', 'Endpoint'), h('th', 'Method'), h('th', 'Path'), h('th', 'Status'), mapped ? h('th', 'Use file') : null)),
        h('tbody', Object.keys(groups).map(function (t) {
          return [h('tr.grp', h('td', { colspan: mapped ? 5 : 4 }, toolName(t)))].concat(groups[t].map(function (k) { return row(k, st[k]); }));
        })))) : UI.empty('Nothing to show for this filter.'),
      mapped && mapped.extra.length ? h('div', h('div.label', 'In the file but not mapped to any tool'),
        h('div.twrap', h('table', h('thead', h('tr', h('th', 'Request'), h('th', 'Method'), h('th', 'URL'), h('th', 'Status'))),
          h('tbody', mapped.extra.map(function (f) {
            return h('tr' + (f.kind === 'unused' ? '' : '.badrow'), h('td', (f.folder ? f.folder + ' / ' : '') + f.name), h('td', f.method), h('td.wrap', h('code', f.raw)),
              h('td.wrap', UI.chip(f.kind === 'unused' ? 'Unused' : 'Invalid', f.kind === 'unused' ? '' : 'bad'), ' ', h('span.small', f.msg)));
          }))))) : null);
  }

  function row(k, x) {
    var s = state[k], e = EP.DEFAULTS[k];
    var m = UI.select(EP.METHODS, s.method);
    m.style.width = '96px';
    m.addEventListener('change', function () { s.method = m.value; s.use = false; draw(); });
    var p = UI.input({ value: s.path });
    p.addEventListener('change', function () { s.path = p.value.trim(); s.use = false; draw(); });
    var use = null;
    if (mapped && s.file && s.match.how !== 'exact') {
      use = h('input', { type: 'checkbox', checked: s.use, title: 'Use the URL from the file' });
      use.addEventListener('change', function () { s.use = use.checked; if (s.use) { s.method = s.file.method; s.path = s.file.path; } else { s.method = s.cur.method; s.path = s.cur.path; } draw(); });
    }
    var cls = x.kind === 'bad' ? '.badrow' : x.kind === 'upd' ? '.warnrow' : '';
    return h('tr' + cls + (changed(k) ? '.chgrow' : ''),
      h('td.wrap', h('b', e.label || k), h('div.dim.small', h('code', k))),
      h('td', m),
      h('td', { style: { minWidth: '340px' } }, p, changed(k) ? h('div.small.dim', 'was ' + s.cur.method + ' ' + s.cur.path) : null),
      h('td.wrap', UI.chip(x.chip, x.kind), x.msg ? h('div.small' + (x.kind === 'bad' ? '.badtxt' : '.muted'), { style: { marginTop: '4px' } }, x.msg) : null),
      mapped ? h('td', use) : null);
  }

  function current() { var o = {}; Object.keys(state).forEach(function (k) { o[k] = { method: state[k].method, path: state[k].path }; }); return o; }

  async function save() {
    var bad = invalidKeys();
    if (bad.length) { UI.toast('Fix the invalid rows first.', 'bad'); return; }
    var ch = Object.keys(state).filter(changed);
    var list = h('div.small.muted', { style: { maxHeight: '160px', overflow: 'auto' } }, ch.map(function (k) { return h('div', (EP.DEFAULTS[k].label || k) + ': ' + state[k].cur.method + ' ' + state[k].cur.path + ' → ' + state[k].method + ' ' + state[k].path); }));
    var ok = await UI.dialog(function (box, close) {
      U.append(box, [h('h2', 'Save ' + ch.length + ' endpoint change' + (ch.length > 1 ? 's' : '') + '?'),
        h('p.muted', 'Tools in this browser will call these URLs from now on. Wrong URLs make those tools fail until you fix or reset them.'), list,
        h('div.acts', h('button.btn.quiet', { type: 'button', onclick: function () { close(false); } }, 'Cancel'), h('button.btn.primary', { type: 'button', onclick: function () { close(true); } }, 'Save'))]);
    });
    if (!ok) return;
    try { var nOv = EP.saveLocal(current()); } catch (e) { UI.toast(e.message, 'bad'); return; }
    reset(); filter = 'all'; draw();
    UI.toast('Saved. This browser now has ' + nOv + ' endpoint override' + (nOv === 1 ? '' : 's') + '.');
  }

  async function resetLocal() {
    if (!EP.local()) { UI.toast('This browser has no endpoint changes.'); return; }
    if (!(await UI.confirm({ title: 'Reset this browser’s endpoints?', body: 'Browser overrides are removed. The team file endpoints.json and built-in defaults stay.', verb: 'Reset', danger: true }))) return;
    EP.clearLocal(); reset(); draw(); UI.toast('Endpoints reset to the team / built-in values.');
  }

  draw();
}

ctx.addCSS('admin-endpoints', [
  '.eptable td{vertical-align:middle}',
  '.eptable .input{min-height:34px;padding:6px 9px;font:12.5px ui-monospace,Consolas,monospace}',
  '.eptable select.input{font:inherit}',
  'tr.grp td{background:var(--panel2);font-weight:700;color:var(--ink);padding:8px 14px}',
  'tr.badrow td{background:#2A1216}',
  'tr.badrow:hover td{background:#33161B}',
  'tr.warnrow td{background:#241F10}',
  'tr.chgrow td:first-child{box-shadow:inset 3px 0 0 var(--blue2)}'
].join('\n'));
