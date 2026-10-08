/* core/layout.js — which modules, areas and tools appear.
 *
 *   module (Attendance, Onboarding, Core, …) → area (Pay rules, Accruals, …) → tool (Paycodes, …)
 *
 * Three layers, merged in this order:
 *   1. built-in defaults   (index.js: ctx.DEFAULT_MODULES / DEFAULT_AREAS / DEFAULT_TOOLS)
 *   2. team file           (layout.json in the repo, fetched by index.js → ctx.repoLayout)
 *   3. this browser        (localStorage 'bft.layout')
 * Layers 2 and 3 use the same "overrides" format:
 *   { version: 2,
 *     modules: { <moduleId>: { name, icon, desc, hidden, order } },                       // new modules need a name
 *     areas:   { <areaId>: { module, name, icon, desc, hidden, order, tools: [toolId, …], pos: [q, r], ring: [toolId|'', …6] } },
 *              // new areas need a name. pos = hex position around the hub (axial, 1–2 steps out; set by dragging in
 *              // Arrange mode); ring = which of the 6 places around the area each tool takes ('' = empty place).
 *     tools:   { <toolId>: { name, hint, hidden } } }
 * A tool listed in an area's `tools` is moved there (removed from any other area).
 * Tools can only be placed, renamed or hidden — a tool needs its modules/<id>.js file to work.
 * Version-1 files (no modules) still load: their areas stay in their current module (Attendance by default).
 *
 * Admin: the admin console (separate login, no Beeforce token) shows only Settings. An admin who unlocks inside a
 * Beeforce session (ctx.adminUnlocked) sees everything plus the Settings area. See core/secrets.js. */
'use strict';

var LKEY = 'bft.layout';
var MAX_AREAS = 8;            // areas per module around the hub (Settings takes a 9th slot for admins)
var MAX_TOOLS = 6;            // one ring
var SETTINGS = { id: 'settings', name: 'Settings', icon: 'gear', desc: 'Admin only: layout, sign-in and audit setup, API endpoints.', tools: ['admin-settings'], system: true };
var SETTINGS_TOOL = { name: 'Admin Settings', hint: 'Layout, secrets, endpoints', icon: 'sliders', system: true };
var ID_RE = /^[a-z0-9-]{1,40}$/;

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function readLocal() { try { return JSON.parse(localStorage.getItem(LKEY) || 'null'); } catch (e) { return null; } }
function firstModule() { return (ctx.DEFAULT_MODULES[0] || { id: 'attendance' }).id; }

/* Model = { modules:[{id,name,icon,desc,hidden}], areas:[{id,module,name,icon,desc,hidden,tools}], tools:{id:{name,hint,hidden}} } */
function defaultsModel() {
  return {
    modules: ctx.DEFAULT_MODULES.map(function (m) { return { id: m.id, name: m.name, icon: m.icon, desc: m.desc || '', hidden: false }; }),
    areas: ctx.DEFAULT_AREAS.map(function (a) { return { id: a.id, module: a.module || firstModule(), name: a.name, icon: a.icon, desc: a.desc, hidden: false, tools: a.tools.slice() }; }),
    tools: Object.keys(ctx.DEFAULT_TOOLS).reduce(function (m, k) { m[k] = { name: ctx.DEFAULT_TOOLS[k].name, hint: ctx.DEFAULT_TOOLS[k].hint, hidden: false }; return m; }, {})
  };
}
function known(id) { return !!ctx.DEFAULT_TOOLS[id]; }
function ringDist(q, r) { return (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2; }
function validPos(p) { return Array.isArray(p) && p.length === 2 && p.every(function (n) { return Number.isInteger(n); }) && ringDist(p[0], p[1]) >= 1 && ringDist(p[0], p[1]) <= 2; }
function sortByOrder(list) {
  list.forEach(function (x, i) { if (typeof x.order !== 'number') x.order = i; });
  list.sort(function (a, b) { return a.order - b.order; });
  list.forEach(function (x) { delete x.order; });
}

/* Apply an overrides object onto a model (returns a new model). Unknown tools are ignored. */
function apply(model, ov) {
  var m = clone(model);
  if (!ov || typeof ov !== 'object') return m;
  var M = ov.modules || {}, A = ov.areas || {}, T = ov.tools || {};
  Object.keys(M).forEach(function (id) {
    if (!ID_RE.test(id)) return;
    var o = M[id], x = m.modules.filter(function (y) { return y.id === id; })[0];
    if (!x) {
      if (typeof o.name !== 'string' || !o.name.trim()) return;
      x = { id: id, name: '', icon: 'list', desc: '', hidden: false };
      m.modules.push(x);
    }
    if (typeof o.name === 'string' && o.name.trim()) x.name = o.name.trim();
    if (typeof o.desc === 'string') x.desc = o.desc.trim();
    if (typeof o.icon === 'string' && ctx.U.ICONS[o.icon]) x.icon = o.icon;
    if (typeof o.hidden === 'boolean') x.hidden = o.hidden;
    if (typeof o.order === 'number') x.order = o.order;
  });
  sortByOrder(m.modules);
  Object.keys(T).forEach(function (id) {
    if (!known(id) || !m.tools[id]) return;
    ['name', 'hint'].forEach(function (k) { if (typeof T[id][k] === 'string' && T[id][k].trim()) m.tools[id][k] = T[id][k].trim(); });
    if (typeof T[id].hidden === 'boolean') m.tools[id].hidden = T[id].hidden;
  });
  Object.keys(A).forEach(function (id) {
    if (id === SETTINGS.id || !ID_RE.test(id)) return;
    var o = A[id], a = m.areas.filter(function (x) { return x.id === id; })[0];
    if (!a) {
      if (typeof o.name !== 'string' || !o.name.trim()) return;
      a = { id: id, module: firstModule(), name: '', icon: 'list', desc: '', hidden: false, tools: [] };
      m.areas.push(a);
    }
    if (typeof o.module === 'string' && m.modules.some(function (x) { return x.id === o.module; })) a.module = o.module;
    ['name', 'desc'].forEach(function (k) { if (typeof o[k] === 'string' && (k === 'desc' || o[k].trim())) a[k] = o[k].trim(); });
    if (typeof o.icon === 'string' && ctx.U.ICONS[o.icon]) a.icon = o.icon;
    if (typeof o.hidden === 'boolean') a.hidden = o.hidden;
    if (typeof o.order === 'number') a.order = o.order;
    if (o.pos === null) delete a.pos; else if (validPos(o.pos)) a.pos = [o.pos[0], o.pos[1]];
    if (o.ring === null) delete a.ring; else if (Array.isArray(o.ring) && o.ring.length <= MAX_TOOLS) a.ring = o.ring.map(function (t) { return typeof t === 'string' && known(t) ? t : ''; });
    if (Array.isArray(o.tools)) {
      var list = o.tools.filter(function (t, i, arr) { return known(t) && arr.indexOf(t) === i; });
      m.areas.forEach(function (x) { if (x !== a) x.tools = x.tools.filter(function (t) { return list.indexOf(t) < 0; }); });
      a.tools = list;
    }
  });
  sortByOrder(m.areas);
  return m;
}

/* Overrides that turn `base` into `model` (smallest diff). */
function diffList(baseList, list, fields, extra) {
  var out = {};
  var byId = {}; baseList.forEach(function (x) { byId[x.id] = x; });
  var baseOrder = baseList.map(function (x) { return x.id; }).filter(function (id) { return list.some(function (x) { return x.id === id; }); });
  var orderChanged = list.map(function (x) { return x.id; }).filter(function (id) { return byId[id]; }).join() !== baseOrder.join() || list.some(function (x) { return !byId[x.id]; });
  list.forEach(function (x, i) {
    var b = byId[x.id], o = {};
    if (!b) { fields.forEach(function (k) { o[k] = x[k]; }); o.hidden = !!x.hidden; extra && extra(x, null, o); }
    else {
      fields.forEach(function (k) { if ((x[k] || '') !== (b[k] || '')) o[k] = x[k]; });
      if (!!x.hidden !== !!b.hidden) o.hidden = !!x.hidden;
      extra && extra(x, b, o);
    }
    if (orderChanged) o.order = i;
    if (Object.keys(o).length) out[x.id] = o;
  });
  return out;
}
function diff(base, model) {
  var out = { version: 2, modules: {}, areas: {}, tools: {} };
  out.modules = diffList(base.modules, model.modules, ['name', 'icon', 'desc']);
  out.areas = diffList(base.areas, model.areas, ['module', 'name', 'icon', 'desc'], function (a, b, o) {
    if (!b || a.tools.join() !== b.tools.join()) o.tools = a.tools.slice();
    var bp = b && b.pos ? b.pos.join() : '', ap = a.pos ? a.pos.join() : '';
    if (ap !== bp) o.pos = a.pos ? a.pos.slice() : null;
    var br = b && b.ring ? b.ring.join() : '', ar = a.ring ? a.ring.join() : '';
    if (ar !== br) o.ring = a.ring ? a.ring.slice() : null;
  });
  Object.keys(model.tools).forEach(function (id) {
    var t = model.tools[id], b = base.tools[id] || {}, o = {};
    ['name', 'hint'].forEach(function (k) { if (t[k] !== b[k]) o[k] = t[k]; });
    if (!!t.hidden !== !!b.hidden) o.hidden = !!t.hidden;
    if (Object.keys(o).length) out.tools[id] = o;
  });
  return out;
}
function isEmpty(d) { return !Object.keys(d.modules || {}).length && !Object.keys(d.areas || {}).length && !Object.keys(d.tools || {}).length; }

/* Problems that block saving. */
function validate(model) {
  var errs = [];
  var mnames = {};
  model.modules.forEach(function (x) {
    if (!x.name || !x.name.trim()) errs.push('A module has no name.');
    var n = (x.name || '').trim().toLowerCase(); if (mnames[n]) errs.push('Two modules are called “' + x.name + '”.'); mnames[n] = 1;
    var vis = model.areas.filter(function (a) { return a.module === x.id && !a.hidden; });
    if (vis.length > MAX_AREAS) errs.push('“' + x.name + '” has ' + vis.length + ' visible areas — the honeycomb has room for ' + MAX_AREAS + '. Hide or merge ' + (vis.length - MAX_AREAS) + '.');
  });
  if (!model.areas.some(function (a) { return !a.hidden && !(model.modules.filter(function (x) { return x.id === a.module; })[0] || { hidden: true }).hidden; })) errs.push('At least one area must be visible.');
  var names = {};
  model.areas.forEach(function (a) {
    if (!a.name || !a.name.trim()) errs.push('An area has no name.');
    var n = a.module + '|' + (a.name || '').trim().toLowerCase(); if (names[n]) errs.push('Two areas in one module are called “' + a.name + '”.'); names[n] = 1;
    var vt = a.tools.filter(function (t) { return !model.tools[t].hidden; });
    if (vt.length > MAX_TOOLS) errs.push('“' + a.name + '” shows ' + vt.length + ' tools — one ring holds ' + MAX_TOOLS + '. Hide or move ' + (vt.length - MAX_TOOLS) + '.');
    if (!a.hidden && !vt.length) errs.push('“' + a.name + '” is visible but has no visible tools.');
  });
  Object.keys(model.tools).forEach(function (id) { if (!model.tools[id].name || !model.tools[id].name.trim()) errs.push('Tool ' + id + ' has no name.'); });
  return errs;
}

function base() { return apply(defaultsModel(), ctx.repoLayout); }
function effective() { return apply(base(), readLocal()); }
function unplaced(model) {
  var placed = {}; model.areas.forEach(function (a) { a.tools.forEach(function (t) { placed[t] = 1; }); });
  return Object.keys(model.tools).filter(function (t) { return !placed[t]; });
}

// Admin = admin console login, or an admin unlocked inside a Beeforce session (core/secrets.js AdminLogin).
function isAdmin() { return !!(ctx.adminConsole || ctx.adminUnlocked); }

/* Builds ctx.MODULES / ctx.AREAS / ctx.TOOLS for the shell.
 * MODULES: visible modules that have at least one visible area. AREAS: visible areas of those modules, each with
 * `module`, `tools` (visible) and `allTools` (incl. hidden — reachable from Ctrl+K for admins). */
function build() {
  var m = effective();
  var problems = validate(m);
  if (problems.length) { console.warn('[APIary] layout problems, using team layout instead:', problems); m = base(); if (validate(m).length) m = defaultsModel(); }
  var TOOLS = {};
  Object.keys(m.tools).forEach(function (id) { TOOLS[id] = { name: m.tools[id].name, hint: m.tools[id].hint, hidden: !!m.tools[id].hidden, icon: (ctx.DEFAULT_TOOLS[id] || {}).icon }; });
  var visMods = m.modules.filter(function (x) { return !x.hidden; }).map(function (x) { return x.id; });
  var AREAS = [];
  var count = {};
  m.areas.forEach(function (a) {
    if (a.hidden || visMods.indexOf(a.module) < 0) return;
    count[a.module] = (count[a.module] || 0) + 1;
    if (count[a.module] > MAX_AREAS) return;
    AREAS.push({ id: a.id, module: a.module, name: a.name, icon: a.icon, desc: a.desc, tools: a.tools.filter(function (t) { return !TOOLS[t].hidden; }), allTools: a.tools.slice(),
      pos: a.pos ? a.pos.slice() : null, ring: a.ring ? a.ring.slice() : null });
  });
  var MODULES = m.modules.filter(function (x) { return !x.hidden && AREAS.some(function (a) { return a.module === x.id; }); })
    .map(function (x) { return { id: x.id, name: x.name, icon: x.icon, desc: x.desc }; });
  // Module page: every visible module in order; one without areas yet is "Coming soon".
  var MODULE_LIST = m.modules.filter(function (x) { return !x.hidden; }).map(function (x) {
    var tools = AREAS.filter(function (a) { return a.module === x.id; }).reduce(function (n, a) { return n + a.tools.length; }, 0);
    return { id: x.id, name: x.name, icon: x.icon, desc: x.desc, tools: tools, soon: !MODULES.some(function (y) { return y.id === x.id; }) };
  });
  var settings = { id: SETTINGS.id, module: '*', name: SETTINGS.name, icon: SETTINGS.icon, desc: SETTINGS.desc, tools: ['admin-settings'], allTools: ['admin-settings'], system: true };
  if (ctx.adminConsole) {
    // Admin console: only the Settings area (no Beeforce token, so the tools can't run).
    TOOLS = { 'admin-settings': clone(SETTINGS_TOOL) };
    AREAS = [settings];
    MODULES = []; MODULE_LIST = [];
  } else if (ctx.adminUnlocked) {
    TOOLS['admin-settings'] = clone(SETTINGS_TOOL);
    AREAS.push(settings);
  }
  ctx.MODULES = MODULES; ctx.MODULE_LIST = MODULE_LIST; ctx.AREAS = AREAS; ctx.TOOLS = TOOLS;
  return { modules: MODULES, areas: AREAS, tools: TOOLS, admin: isAdmin() };
}

ctx.Layout = {
  KEY: LKEY, MAX_AREAS: MAX_AREAS, MAX_TOOLS: MAX_TOOLS, ID_RE: ID_RE,
  defaultsModel: defaultsModel, base: base, effective: effective, apply: apply, diff: diff, validate: validate, unplaced: unplaced,
  build: build, isAdmin: isAdmin, clone: clone, validPos: validPos, ringDist: ringDist,
  local: readLocal,
  saveLocal: function (model) {
    var errs = validate(model); if (errs.length) return errs;
    var d = diff(base(), model);
    try {
      if (isEmpty(d)) localStorage.removeItem(LKEY);
      else localStorage.setItem(LKEY, JSON.stringify(d));
    } catch (e) { return ['This browser blocked saving: ' + e.message]; }
    return [];
  },
  clearLocal: function () { try { localStorage.removeItem(LKEY); } catch (e) {} },
  exportRepo: function (model) { return diff(defaultsModel(), model); }  // layout.json for the team
};
build();
