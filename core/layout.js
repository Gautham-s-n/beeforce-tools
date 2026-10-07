/* core/layout.js — which areas and tools appear in the honeycomb.
 *
 * Three layers, merged in this order:
 *   1. built-in defaults   (index.js: ctx.DEFAULT_AREAS / ctx.DEFAULT_TOOLS)
 *   2. team file           (layout.json in the repo, fetched by index.js → ctx.repoLayout)
 *   3. this browser        (localStorage 'bft.layout')
 * Layers 2 and 3 use the same "overrides" format:
 *   { version: 1,
 *     areas: { <areaId>: { name, icon, desc, hidden, order, tools: [toolId, …] } },   // new areas need a name
 *     tools: { <toolId>: { name, hint, hidden } } }
 * A tool listed in an area's `tools` is moved there (removed from any other area).
 * Tools can only be placed, renamed or hidden — a tool needs its modules/<id>.js file to work.
 *
 * Admin access is a convenience gate for the UI, not a security boundary (everything runs in the page). */
'use strict';

var LKEY = 'bft.layout';
var MAX_AREAS = 8;            // user areas around the hub (Settings takes a 9th slot for admins)
var MAX_TOOLS = 6;            // one ring
var SETTINGS = { id: 'settings', name: 'Settings', icon: 'gear', desc: 'Admin only: honeycomb layout, sign-in and audit setup, API endpoints.', tools: ['admin-settings'], system: true };
var SETTINGS_TOOL = { name: 'Admin Settings', hint: 'Layout, secrets, endpoints', system: true };

function clone(o) { return JSON.parse(JSON.stringify(o)); }
function readLocal() { try { return JSON.parse(localStorage.getItem(LKEY) || 'null'); } catch (e) { return null; } }

/* Model = { areas: [ { id, name, icon, desc, hidden, tools:[ids] } ], tools: { id: { name, hint, hidden } } } (ordered) */
function defaultsModel() {
  return {
    areas: ctx.DEFAULT_AREAS.map(function (a) { return { id: a.id, name: a.name, icon: a.icon, desc: a.desc, hidden: false, tools: a.tools.slice() }; }),
    tools: Object.keys(ctx.DEFAULT_TOOLS).reduce(function (m, k) { m[k] = { name: ctx.DEFAULT_TOOLS[k].name, hint: ctx.DEFAULT_TOOLS[k].hint, hidden: false }; return m; }, {})
  };
}
function known(id) { return !!ctx.DEFAULT_TOOLS[id]; }

/* Apply an overrides object onto a model (returns a new model). Unknown tools are ignored. */
function apply(model, ov) {
  var m = clone(model);
  if (!ov || typeof ov !== 'object') return m;
  var A = ov.areas || {}, T = ov.tools || {};
  Object.keys(T).forEach(function (id) {
    if (!known(id) || !m.tools[id]) return;
    ['name', 'hint'].forEach(function (k) { if (typeof T[id][k] === 'string' && T[id][k].trim()) m.tools[id][k] = T[id][k].trim(); });
    if (typeof T[id].hidden === 'boolean') m.tools[id].hidden = T[id].hidden;
  });
  Object.keys(A).forEach(function (id) {
    if (id === SETTINGS.id || !/^[a-z0-9-]{1,40}$/.test(id)) return;
    var o = A[id], a = m.areas.filter(function (x) { return x.id === id; })[0];
    if (!a) {
      if (typeof o.name !== 'string' || !o.name.trim()) return;
      a = { id: id, name: '', icon: 'list', desc: '', hidden: false, tools: [] };
      m.areas.push(a);
    }
    ['name', 'desc'].forEach(function (k) { if (typeof o[k] === 'string' && (k === 'desc' || o[k].trim())) a[k] = o[k].trim(); });
    if (typeof o.icon === 'string' && ctx.U.ICONS[o.icon]) a.icon = o.icon;
    if (typeof o.hidden === 'boolean') a.hidden = o.hidden;
    if (typeof o.order === 'number') a.order = o.order;
    if (Array.isArray(o.tools)) {
      var list = o.tools.filter(function (t, i, arr) { return known(t) && arr.indexOf(t) === i; });
      m.areas.forEach(function (x) { if (x !== a) x.tools = x.tools.filter(function (t) { return list.indexOf(t) < 0; }); });
      a.tools = list;
    }
  });
  // order: explicit `order` wins, otherwise current position
  m.areas.forEach(function (a, i) { if (typeof a.order !== 'number') a.order = i; });
  m.areas.sort(function (x, y) { return x.order - y.order; });
  m.areas.forEach(function (a) { delete a.order; });
  return m;
}

/* Overrides that turn `base` into `model` (smallest diff). */
function diff(base, model) {
  var out = { version: 1, areas: {}, tools: {} };
  var byId = {}; base.areas.forEach(function (a) { byId[a.id] = a; });
  var baseOrder = base.areas.map(function (a) { return a.id; }).filter(function (id) { return model.areas.some(function (a) { return a.id === id; }); });
  var orderChanged = model.areas.map(function (a) { return a.id; }).filter(function (id) { return byId[id]; }).join() !== baseOrder.join() || model.areas.some(function (a) { return !byId[a.id]; });
  model.areas.forEach(function (a, i) {
    var b = byId[a.id], o = {};
    if (!b) { o = { name: a.name, icon: a.icon, desc: a.desc, hidden: !!a.hidden, tools: a.tools.slice() }; }
    else {
      ['name', 'icon', 'desc'].forEach(function (k) { if ((a[k] || '') !== (b[k] || '')) o[k] = a[k]; });
      if (!!a.hidden !== !!b.hidden) o.hidden = !!a.hidden;
      if (a.tools.join() !== b.tools.join()) o.tools = a.tools.slice();
    }
    if (orderChanged) o.order = i;
    if (Object.keys(o).length) out.areas[a.id] = o;
  });
  Object.keys(model.tools).forEach(function (id) {
    var t = model.tools[id], b = base.tools[id] || {}, o = {};
    ['name', 'hint'].forEach(function (k) { if (t[k] !== b[k]) o[k] = t[k]; });
    if (!!t.hidden !== !!b.hidden) o.hidden = !!t.hidden;
    if (Object.keys(o).length) out.tools[id] = o;
  });
  return out;
}

/* Problems that block saving. */
function validate(model) {
  var errs = [];
  var vis = model.areas.filter(function (a) { return !a.hidden; });
  if (vis.length > MAX_AREAS) errs.push(vis.length + ' visible areas — the honeycomb has room for ' + MAX_AREAS + '. Hide or merge ' + (vis.length - MAX_AREAS) + '.');
  if (!vis.length) errs.push('At least one area must be visible.');
  var names = {};
  model.areas.forEach(function (a) {
    if (!a.name || !a.name.trim()) errs.push('An area has no name.');
    var n = (a.name || '').trim().toLowerCase(); if (names[n]) errs.push('Two areas are called “' + a.name + '”.'); names[n] = 1;
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

function isAdmin(user) {
  var u = String(user || (ctx.Api && ctx.Api.state.user) || '').trim().toLowerCase();
  return !!u && (ctx.CONFIG.ADMIN_USERS || []).some(function (a) { return String(a).trim().toLowerCase() === u; });
}

/* Builds ctx.AREAS / ctx.TOOLS for the shell. AREAS holds visible areas only; each has
 * `tools` (visible) and `allTools` (incl. hidden, reachable from Ctrl+K for admins). */
function build(user) {
  var admin = isAdmin(user);
  var m = effective();
  var problems = validate(m);
  if (problems.length) { console.warn('[BeeForce Tools] layout problems, using team layout instead:', problems); m = base(); if (validate(m).length) m = defaultsModel(); }
  var TOOLS = {};
  Object.keys(m.tools).forEach(function (id) { TOOLS[id] = { name: m.tools[id].name, hint: m.tools[id].hint, hidden: !!m.tools[id].hidden }; });
  var AREAS = m.areas.filter(function (a) { return !a.hidden; }).slice(0, MAX_AREAS).map(function (a) {
    return { id: a.id, name: a.name, icon: a.icon, desc: a.desc, tools: a.tools.filter(function (t) { return !TOOLS[t].hidden; }), allTools: a.tools.slice() };
  });
  if (admin) {
    TOOLS['admin-settings'] = clone(SETTINGS_TOOL);
    AREAS.push({ id: SETTINGS.id, name: SETTINGS.name, icon: SETTINGS.icon, desc: SETTINGS.desc, tools: ['admin-settings'], allTools: ['admin-settings'], system: true });
  }
  ctx.AREAS = AREAS; ctx.TOOLS = TOOLS;
  return { areas: AREAS, tools: TOOLS, admin: admin };
}

ctx.Layout = {
  KEY: LKEY, MAX_AREAS: MAX_AREAS, MAX_TOOLS: MAX_TOOLS,
  defaultsModel: defaultsModel, base: base, effective: effective, apply: apply, diff: diff, validate: validate, unplaced: unplaced,
  build: build, isAdmin: isAdmin, clone: clone,
  local: readLocal,
  saveLocal: function (model) {
    var errs = validate(model); if (errs.length) return errs;
    var d = diff(base(), model);
    try {
      if (!Object.keys(d.areas).length && !Object.keys(d.tools).length) localStorage.removeItem(LKEY);
      else localStorage.setItem(LKEY, JSON.stringify(d));
    } catch (e) { return ['This browser blocked saving: ' + e.message]; }
    return [];
  },
  clearLocal: function () { try { localStorage.removeItem(LKEY); } catch (e) {} },
  exportRepo: function (model) { return diff(defaultsModel(), model); }  // layout.json for the team
};
build(null);
