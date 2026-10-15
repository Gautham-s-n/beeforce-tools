/* modules/roles.js — Roles & Positions (SUPERADMIN, Data Management API, per tenant).
 * Endpoints (core/endpoints.js), all on the Data Management API:
 * roles.tenants    (tenant list)
 * roles.positions  (position list; also the "connect" check)
 * roles.position   (one position, fetched 10 at a time)
 * roles.roles      (roles master)
 * roles.save       (POST — create AND update — "id" in the body makes it an update)
 * Every call carries "x-organization-id: <tenant id>" once a tenant is selected — that is the whole
 * "connect to tenant" mechanism (no separate token). */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Roles & Positions';

var POS_HEADERS = ['id (blank=create)', 'positionName', 'activeStatus', 'personType_id', 'personType_description',
  'locationAccess', 'positionAccessRequired', 'positionRequiredForDelegation', 'roles (comma-separated)'];
var POS_INPUT = [1, 2, 3, 4];
var VIEW_HEADERS = ['id', 'personType_description', 'personType_id', 'positionAccessRequired', 'positionName', 'positionRequiredForDelegation', 'role_id'];
var ROLE_HEADERS = ['id', 'roleName', 'description', 'onboarding', 'attendance', 'compliance', 'core'];

var S = { tenants: null, orgId: null, orgName: '', connected: false };

/* Every Data Management call needs x-organization-id, and the old tool (rolH, old roles.js:84-92) sent exactly
 * Authorization, Content-Type: application/json, Accept: application/json and that header — no X-Client-Type,
 * which Api.call always adds. So this sends the old headers itself, with Api.call's audit logging.
 * Reads are retried on network errors / 429 / 502-504 like Api.call; writes (POST) are sent once, as the old tool
 * did — a POST that timed out may already be saved. A 401 is reported instead of opening the sign-in prompt. */
function dmHeaders() {
  var hd = { Authorization: 'Bearer ' + Api.state.token, 'Content-Type': 'application/json', Accept: 'application/json' };
  if (S.orgId) hd['x-organization-id'] = String(S.orgId);
  return hd;
}
// key = registry key; method and path come from the registry, headers / retries / audit stay as above.
async function dm(key, params, opts) {
  opts = opts || {};
  var method = ctx.EP.method(key), path = ctx.EP.path(key, params);
  var url = Api.state.base + path;
  var retries = method === 'GET' ? 2 : 0;
  for (var attempt = 0; ; attempt++) {
    var t0 = performance.now(), r;
    try { r = await fetch(url, { method: method, headers: dmHeaders(), body: opts.body === undefined ? undefined : JSON.stringify(opts.body) }); }
    catch (e) {
      if (attempt < retries) { await U.sleep(800 * Math.pow(2, attempt)); continue; }
      ctx.Audit.onApiCall(MOD, method, path, 0, Math.round(performance.now() - t0));
      return { ok: false, status: 0, data: null, text: 'Network error: ' + e.message };
    }
    ctx.Audit.onApiCall(MOD, method, path, r.status, Math.round(performance.now() - t0));
    if ([429, 502, 503, 504].indexOf(r.status) >= 0 && attempt < retries) { await U.sleep(Math.pow(2, attempt + 1) * 1000); continue; }
    var text = await r.text(), data = null;
    try { data = text ? JSON.parse(text) : null; } catch (e) {}
    if (r.status === 401) text = 'Not allowed (HTTP 401). This tool needs a SUPERADMIN login. ' + Api.parseError(text);
    return { ok: r.ok, status: r.status, data: data, text: text };
  }
}
async function dmList(key) {
  var r = await dm(key);
  if (!r.ok) throw new Error('HTTP ' + r.status + ': ' + Api.parseError(r.text));
  return Array.isArray(r.data) ? r.data : (r.data && r.data.data) || [];
}
async function dmListQuiet(key) { try { return await dmList(key); } catch (e) { return []; } }

/* ---------- helpers (same as the old tool) ---------- */
function tenantText(t) { return Object.keys(t || {}).map(function (k) { var v = t[k]; return typeof v === 'string' || typeof v === 'number' ? String(v) : ''; }).join(' ').toLowerCase(); }
function tenantLabel(t) { return t.detailedDescription || t.name || t.organizationName || t.orgName || t.description || ('Org ' + t.id); }
function personType(id, desc) {
  return { createUser: null, created: null, description: desc || (parseInt(id, 10) === 2 ? 'Contractor' : 'Employee'),
    id: parseInt(id, 10) || 1, lastUpdateUser: null, lastUpdated: null, personType: null };
}
function tb(v) { return v ? 'TRUE' : 'FALSE'; }
function roleVal(r) { return r && typeof r === 'object' ? String(r.id != null ? r.id : r.roleName || '') : String(r); }
function flatView(pos) { // old "View Positions" rows: one row per role
  var base = [pos.id || '', (pos.personType && pos.personType.description) || '', (pos.personType && pos.personType.id) || '',
    tb(pos.positionAccessRequired), pos.positionName || '', tb(pos.positionRequiredForDelegation)];
  var roles = pos.roles || [];
  if (!roles.length) return [base.concat([''])];
  return roles.map(function (r) { return base.concat([roleVal(r)]); });
}
function flatUpload(pos) { // upload-format row (one row per position, roles joined) — for "export for editing"
  return [pos.id, pos.positionName || '', tb(pos.activeStatus), (pos.personType && pos.personType.id) || '', (pos.personType && pos.personType.description) || '',
    pos.locationAccess || '', tb(pos.positionAccessRequired), tb(pos.positionRequiredForDelegation), (pos.roles || []).map(roleVal).join(', ')];
}
function roleRows(roles) { return roles.map(function (r) { return [r.id || '', r.roleName || r.name || '', r.description || '', tb(r.onboarding), tb(r.attendance), tb(r.compliance), tb(r.core)]; }); }

async function fetchPositions(ids) { // 10 at a time, failures dropped — as the old tool
  var out = [];
  for (var i = 0; i < ids.length; i += 10) {
    var res = await Promise.all(ids.slice(i, i + 10).map(function (id) { return dm('roles.position', { id: id }).catch(function () { return null; }); }));
    res.forEach(function (r) { var p = r && r.ok && r.data ? (r.data.data || r.data) : null; if (p && p.id) out.push(p); });
  }
  return out;
}
async function allPositions() {
  var list = await dmList('roles.positions');
  return fetchPositions(list.map(function (p) { return p.id; }).filter(Boolean));
}
function roles() { return dmListQuiet('roles.roles'); }

/* ---------- downloads ---------- */
async function template() {
  var res = await Promise.all([roles(), dmListQuiet('roles.positions')]);
  var det = await fetchPositions(res[1].map(function (p) { return p.id; }).filter(Boolean));
  var rows = []; det.forEach(function (p) { rows = rows.concat(flatView(p)); });
  await X.download('roles_positions_template.xlsx', [
    { name: 'Positions_Upload', tabColor: '1D4ED8', headers: POS_HEADERS, rows: [], highlightCols: POS_INPUT },
    { name: 'Roles_Master', tabColor: '059669', headers: ROLE_HEADERS, rows: roleRows(res[0]) },
    { name: 'Existing_Positions', tabColor: '7C3AED', headers: VIEW_HEADERS, rows: rows }
  ]);
}
async function exportForEditing() {
  var res = await Promise.all([allPositions(), roles()]);
  await X.download('roles_positions_export_' + U.stamp() + '.xlsx', [
    { name: 'Positions_Upload', tabColor: '1D4ED8', headers: POS_HEADERS, rows: res[0].map(flatUpload), highlightCols: POS_INPUT },
    { name: 'Roles_Master', tabColor: '059669', headers: ROLE_HEADERS, rows: roleRows(res[1]) }
  ]);
}
async function downloadAll() { // old "View Positions → Download All Positions"
  var det = await allPositions();
  if (!det.length) { UI.toast('No positions found.'); return; }
  var rows = []; det.forEach(function (p) { rows = rows.concat(flatView(p)); });
  await X.download('positions_' + new Date().toISOString().slice(0, 10) + '.xlsx', [
    { name: 'Positions', tabColor: '1D4ED8', headers: VIEW_HEADERS, rows: rows },
    { name: 'Roles_Master', tabColor: '059669', headers: ROLE_HEADERS, rows: roleRows(await roles()) }
  ]);
  UI.toast(det.length + ' position(s), ' + rows.length + ' row(s) downloaded.');
}

/* ---------- upload ---------- */
function col(row, name) { // old matcher: letters/digits only, case-insensitive
  var norm = function (s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); };
  var k = Object.keys(row).filter(function (k) { return k !== '__row' && norm(k) === norm(name); })[0];
  return k ? String(row[k] == null ? '' : row[k]).trim() : '';
}
function toBool(v) { return ['true', '1', 'yes'].indexOf(String(v || '').toLowerCase().trim()) !== -1; }
function same(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
/* The old POST sent positionAccessIds / mandatoryLevels as flat id lists. A GET may return them as objects
 * ({ id, ... }); send only the ids so an update posts the same shape the old tool did. */
function idList(list) {
  return (Array.isArray(list) ? list : []).map(function (x) { return x && typeof x === 'object' ? x.id : x; })
    .filter(function (x) { return x != null && x !== ''; });
}

async function parse(file) {
  var rows = file.rows;
  var list = await dmList('roles.positions');
  var roleList = await roles();
  var roleIds = {}; roleList.forEach(function (r) { roleIds[String(r.id)] = 1; if (r.roleName) roleIds[String(r.roleName).toLowerCase()] = 1; });
  var updates = {}, creates = {}, order = [], items = [];
  rows.forEach(function (row) {
    var pid = X.int(col(row, 'id') || col(row, 'id blankcreate'));
    var name = col(row, 'positionName');
    if (!name) { items.push({ row: row.__row, kind: 'skip', label: pid != null ? 'id ' + pid : '(no name)', note: 'No positionName — row skipped' }); return; }
    var key = pid != null ? 'id:' + pid : 'name:' + name;
    var g = pid != null ? updates : creates;
    if (!g[key]) { g[key] = { id: pid, rows: [] }; order.push(key); }
    g[key].rows.push(row);
  });
  var upIds = order.filter(function (k) { return updates[k]; }).map(function (k) { return updates[k].id; });
  var cur = {}; (await fetchPositions(upIds)).forEach(function (p) { cur[String(p.id)] = p; });

  order.forEach(function (key) {
    var g = updates[key] || creates[key], isUpd = !!updates[key], first = g.rows[0];
    var name = col(first, 'positionName');
    var it = { row: g.rows.map(function (r) { return r.__row; }).join(', '), label: name + (isUpd ? ' (id ' + g.id + ')' : '') };
    var rolesSet = {};
    g.rows.forEach(function (r) {
      (col(r, 'roles') || col(r, 'rolescommaseparated')).split(',').map(function (x) { return x.trim(); }).filter(Boolean).forEach(function (x) { rolesSet[x] = true; });
    });
    var roleArr = Object.keys(rolesSet);
    var bad = roleList.length ? roleArr.filter(function (x) { return !roleIds[x] && !roleIds[x.toLowerCase()]; }) : [];
    if (bad.length) { it.kind = 'bad'; it.error = 'Unknown role id(s): ' + bad.join(', ') + ' (see Roles_Master)'; items.push(it); return; }
    var ptId = col(first, 'personType_id') || col(first, 'persontypeid');
    var ptDesc = col(first, 'personType_description') || col(first, 'persontypedescription');
    var c = isUpd ? cur[String(g.id)] : null;
    if (isUpd && !c) { it.kind = 'bad'; it.error = 'No position with id ' + g.id + ' in this tenant'; items.push(it); return; }
    // Create: the old defaults (activeStatus TRUE, flags FALSE, person type 1). Update: a blank cell keeps the current value.
    function pick(colName, curVal, dflt) { var v = col(first, colName); return v !== '' ? v : isUpd ? curVal : dflt; }
    var p = {
      positionName: name,
      activeStatus: toBool(pick('activeStatus', c && tb(c.activeStatus), 'true')),
      deleted: false,
      personType: ptId || !isUpd ? personType(ptId || '1', ptDesc) : personType((c.personType || {}).id || '1', ptDesc || (c.personType || {}).description),
      roles: roleArr.length || !isUpd ? roleArr : (c.roles || []).map(roleVal),
      locationAccess: pick('locationAccess', c && c.locationAccess, '') || '',
      // The old tool always sent [] here, which wiped them on update. Create still sends []; update keeps the current list.
      positionAccessIds: isUpd ? idList(c.positionAccessIds) : [],
      positionAccessRequired: toBool(pick('positionAccessRequired', c && tb(c.positionAccessRequired), '')),
      positionRequiredForDelegation: toBool(pick('positionRequiredForDelegation', c && tb(c.positionRequiredForDelegation), '')),
      mandatoryLevels: isUpd ? idList(c.mandatoryLevels) : []
    };
    if (isUpd) p.id = g.id; // same URL for create and update — "id" in the body makes it an update
    it.payload = p;
    if (isUpd) {
      var ch = [];
      var cmp = function (f, a, b) { if (!same(a, b)) ch.push({ field: f, from: a, to: b }); };
      cmp('positionName', c.positionName || '', p.positionName);
      cmp('activeStatus', !!c.activeStatus, p.activeStatus);
      cmp('personType', (c.personType || {}).id + ' ' + ((c.personType || {}).description || ''), p.personType.id + ' ' + p.personType.description);
      cmp('locationAccess', c.locationAccess || '', p.locationAccess);
      cmp('positionAccessRequired', !!c.positionAccessRequired, p.positionAccessRequired);
      cmp('positionRequiredForDelegation', !!c.positionRequiredForDelegation, p.positionRequiredForDelegation);
      cmp('roles', (c.roles || []).map(roleVal).sort().join(', '), p.roles.slice().sort().join(', '));
      if (!ch.length) { it.kind = 'same'; items.push(it); return; }
      it.kind = 'upd'; it.changes = ch;
    } else {
      it.kind = 'new';
      if (list.some(function (x) { return String(x.positionName || '').toLowerCase() === name.toLowerCase(); })) it.note = 'A position with this name already exists — a second one will be created.';
      it.changes = [{ field: 'roles', from: '', to: p.roles.join(', ') }, { field: 'personType', from: '', to: p.personType.description }];
    }
    it.run = async function () {
      var r = await dm('roles.save', null, { body: p });
      if (r.ok && r.data && r.data.data && r.data.data.id != null) r.data = r.data.data; // id may be wrapped in data
      return r;
    };
    items.push(it);
  });
  return items.sort(function (a, b) { return parseInt(a.row, 10) - parseInt(b.row, 10); });
}

/* ---------- screens ---------- */
function actions(area) {
  U.swap(area,
    UI.note('ok', 'Connected to ' + S.orgName, 'Tenant id ' + S.orgId + '. Every change below goes to this tenant.'),
    UI.tabs([
      { id: 'upload', label: 'Create / update', render: function (b) {
        b.appendChild(E.uploadFlow({
          module: MOD, template: template, parse: parse, itemLabel: 'Position', verb: 'position change',
          intro: UI.note('info', null, 'Leave the id blank to create a position, fill it to update one. Rows with the same positionName (create) or id (update) are merged and their roles collected. Roles are role ids from Roles_Master, comma-separated.'),
          blankNote: 'On update a blank cell keeps the current value, including roles, person type and location access (the old tool reset blank cells to its create defaults). Position access and mandatory levels are always kept as they are.',
          reportCols: [{ label: 'roles', get: function (it) { return it.payload ? it.payload.roles.join(', ') : ''; } }]
        }));
      } },
      { id: 'browse', label: 'Browse & export', render: browsePositions },
      { id: 'roles', label: 'Roles', render: browseRoles }
    ]));
}
function browsePositions(el) {
  var holder = h('div', h('div.card', h('span.spin'), '  Loading positions…'));
  el.appendChild(holder);
  async function draw() {
    var det = await allPositions();
    var rows = det.map(function (p) { return { id: p.id, positionName: p.positionName, activeStatus: tb(p.activeStatus), personType: (p.personType || {}).description || '', locationAccess: p.locationAccess || '', roles: (p.roles || []).map(roleVal).join(', ') }; });
    U.swap(holder, UI.table([{ key: 'id', label: 'Id' }, { key: 'positionName', label: 'Position' }, { key: 'activeStatus', label: 'Active' }, { key: 'personType', label: 'Person type' }, { key: 'locationAccess', label: 'Location access' }, { key: 'roles', label: 'Roles', wrap: true }], rows, {
      toolbar: [UI.btn('Refresh', { icon: 'retry', sm: true, kind: 'quiet', onClick: draw }),
        UI.btn('Export for editing', { icon: 'download', sm: true, onClick: exportForEditing }),
        UI.btn('Download all positions', { icon: 'download', sm: true, kind: 'quiet', onClick: downloadAll })]
    }));
  }
  draw().catch(function (e) { U.swap(holder, UI.note('bad', 'Could not load positions', e.message)); });
}
function browseRoles(el) {
  var holder = h('div', h('div.card', h('span.spin'), '  Loading roles…'));
  el.appendChild(holder);
  roles().then(function (list) {
    U.swap(holder, list.length ? UI.table(ROLE_HEADERS.map(function (k) { return { key: k, label: k }; }), roleRows(list).map(function (r) { var o = {}; ROLE_HEADERS.forEach(function (k, i) { o[k] = r[i]; }); return o; })) : UI.empty('No roles returned for this tenant.'));
  });
}

ctx.defineTool('roles', {
  desc: 'Pick a tenant, then create and update its positions and their roles from Excel. Needs a SUPERADMIN login.',
  render: function (body) {
    var status = h('div');
    var listEl = h('div');
    var selEl = h('div');
    var area = h('div', { style: { marginTop: '16px' } });
    var search = UI.input({ placeholder: 'Search tenant name or id' });
    var tenantBox = h('div', { hidden: true }, UI.field('Tenant', search), listEl, selEl);

    function drawList() {
      var q = search.value.toLowerCase().trim();
      var shown = (S.tenants || []).filter(function (t) { return !q || tenantText(t).indexOf(q) !== -1; });
      U.swap(listEl, UI.table([{ key: 'label', label: 'Tenant' }, { key: 'id', label: 'Id' },
        { key: 'pick', label: '', render: function (r) { return UI.btn(String(r.id) === String(S.orgId) ? 'Selected' : 'Select', { sm: true, kind: String(r.id) === String(S.orgId) ? '' : 'quiet', onClick: function () { select(r.t); } }); } }],
        shown.map(function (t) { return { id: t.id, label: tenantLabel(t), t: t }; }), { search: false, limit: 200 }));
    }
    function select(t) {
      S.orgId = t.id; S.orgName = tenantLabel(t); S.connected = false;
      U.clear(area);
      drawList();
      U.swap(selEl, h('div.row', { style: { marginTop: '10px' } }, h('span', 'Selected: ', h('b', S.orgName), h('span.muted', ' (id ' + S.orgId + ')')), h('span', { style: { flex: 1 } }),
        UI.btn('Connect to tenant', { kind: 'primary', icon: 'key', onClick: connect })));
    }
    async function connect() {
      if (!S.orgId) { UI.toast('Select a tenant first', 'bad'); return; }
      var r = await dm('roles.positions'); // just proves the x-organization-id header works — no token exchange
      if (!r.ok) { U.swap(status, UI.note('bad', 'Could not connect to ' + S.orgName, 'HTTP ' + r.status + ': ' + Api.parseError(r.text))); return; }
      S.connected = true;
      U.clear(status);
      actions(area);
    }
    search.addEventListener('input', drawList);
    var loadBtn = UI.btn('Load tenants', { icon: 'retry', onClick: async function () {
      var r = await dm('roles.tenants');
      if (!r.ok) { U.swap(status, UI.note('bad', 'Could not load tenants', 'HTTP ' + r.status + ': ' + Api.parseError(r.text))); return; }
      var raw = r.data;
      var list = Array.isArray(raw) ? raw : (raw && (raw.data || raw.result || raw.organizations || raw.content)) || [];
      if (!list.length) { U.swap(status, UI.note('bad', 'No tenants returned', '')); return; }
      S.tenants = list;
      U.swap(status, UI.note('ok', null, list.length + ' tenant(s) loaded.'));
      tenantBox.hidden = false;
      drawList();
    } });

    U.append(body, [
      UI.note('warn', 'SUPERADMIN access required', 'This tool uses the Data Management API. A normal tenant login will not work here.'),
      h('div.card', h('div.row', { style: { marginBottom: '10px' } }, h('b', '1. Choose a tenant'), h('span', { style: { flex: 1 } }), loadBtn), status, tenantBox),
      area
    ]);
    if (S.tenants) { tenantBox.hidden = false; drawList(); if (S.orgId) select({ id: S.orgId, detailedDescription: S.orgName }); }
  }
});
