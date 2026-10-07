/* modules/accrual-policies.js — Accrual Policies, relational 8-sheet format.
 * Endpoints (core/endpoints.js):
 * accrual-policies.list           ?projection=FULL — list (falls back to accrual-policies.list-fallback, no query)
 * accrual-policies.get            ?attributes=paycodes,grantPaycodes,cascades — full record (8 at a time)
 * accrual-policies.paycodes       reference (Paycodes_Master)
 * accrual-policies.accruals       reference (Accruals_Master)
 * accrual-policies.create         create
 * accrual-policies.update         ?attributes=paycodes,grantPaycodes,cascades — update
 * accrual-policies.remove         delete
 *
 * Sheets (exact old names and headers): Accrual_Policy (one row per policy; ID blank = create) and seven child
 * sheets linked by "Policy Key" = the policy's Name. The whole uploaded file is the policy definition: on update,
 * child rows replace the current ones (as in the old tool) — the review shows exactly what changes. */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Accrual Policies';

// Every header copied verbatim from the old ACCRPOL_HEADERS — never rename.
var AH = [
  'ID', 'Name', 'Accrual ID', 'Description',
  'Grant Information - Type', 'Grant Information - Frequency', 'Grant Information - Start Date(YYYY-MM-DD)', 'Grant Information - Force Avail',
  'Grant Expiration - Expiration', 'Grant Expiration - Expired After',
  'Grant Amounts - Start', 'Grant Amounts - End', 'Grant Amounts - Amount', 'Grant Amounts - Max',
  'Grant Amount Rules - Condition', 'Grant Amount Rules - Value',
  'Grant Prorations - Start Date(MM/DD)', 'Grant Prorations - End Date(MM/DD)', 'Grant Prorations - Amount',
  'Termination Prorations - Start Date(MM/DD)', 'Termination Prorations - End Date(MM/DD)', 'Termination Prorations - Amount',
  'Grant Roundings - Start', 'Grant Roundings - End', 'Grant Roundings - Value',
  'Grant Paycodes - Paycode ID', 'Grant Paycodes - Amount',
  'Taking Paycodes - Paycode ID', 'Taking Paycodes - Amount',
  'Accrual Cascades - Accrual ID', 'Accrual Cascades - Priority'
];
// key = field in the "sheets" object the payload builder reads; tab colours as old.
var SHEETS = [
  { key: 'policy', name: 'Accrual_Policy', tab: '0369A1', headers: AH.slice(0, 10), input: [1, 2, 3, 4, 5, 6] },
  { key: 'grantAmounts', name: 'Grant_Amounts', tab: '7C3AED', headers: ['Policy Key'].concat(AH.slice(10, 14)), input: [0] },
  { key: 'grantAmountRules', name: 'Grant_Amount_Rules', tab: '7C3AED', headers: ['Policy Key'].concat(AH.slice(14, 16)), input: [0] },
  { key: 'grantProrations', name: 'Grant_Prorations', tab: 'D97706', headers: ['Policy Key'].concat(AH.slice(16, 19)), input: [0] },
  { key: 'terminationProrations', name: 'Termination_Prorations', tab: 'DB2777', headers: ['Policy Key'].concat(AH.slice(19, 22)), input: [0] },
  { key: 'grantRoundings', name: 'Grant_Roundings', tab: '0D9488', headers: ['Policy Key'].concat(AH.slice(22, 25)), input: [0] },
  { key: 'paycodes', name: 'Paycodes', tab: '4F46E5', headers: ['Policy Key', 'Type'].concat(AH.slice(25, 29)), input: [0, 1] },
  { key: 'cascades', name: 'Accrual_Cascades', tab: 'DC2626', headers: ['Policy Key'].concat(AH.slice(29, 31)), input: [0] }
];
var FORCED_FALSE = ['carryoverAmountMax', 'prioritizeCarryoverBalance', 'carryoverEncashmentAmountMax', 'terminationEncashmentAmountMax', 'manualEncashmentAmountMax'];
var LABELS = {
  name: 'Name', description: 'Description', accrual: 'Accrual ID', grantType: 'Grant type', grantFrequency: 'Grant frequency',
  grantStartDate: 'Grant start date', forceAvail: 'Force avail', grantExpiration: 'Expiration', grantExpiredAfter: 'Expired after',
  grantAmounts: 'Grant Amounts', grantAmountRules: 'Grant Amount Rules', grantProrations: 'Grant Prorations',
  grantTerminationProrations: 'Termination Prorations', grantRoundings: 'Grant Roundings', grantPaycodes: 'Grant Paycodes',
  paycodes: 'Taking Paycodes', cascades: 'Accrual Cascades'
};

/* ---------- old helpers, same behaviour ---------- */
function norm(s) { return String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function col(row, name) {
  var n = norm(name);
  var k = Object.keys(row).filter(function (k) { return k !== '__row' && norm(k) === n; })[0];
  return k ? String(row[k] == null ? '' : row[k]).trim() : '';
}
function toBool(v) { return ['true', '1', 'yes'].indexOf(String(v || '').toLowerCase().trim()) >= 0; }
function toNum(v) { var n = parseFloat(v); return isNaN(n) ? null : n; }
function pInt(x) { var n = parseInt(parseFloat(x), 10); return isNaN(n) ? null : n; }
function ts(v) { return v === null || v === undefined ? '' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : String(v); }

/* One policy -> rows (arrays) for each of the 8 sheets. */
function flattenPolicy(p) {
  var acc = p.accrual || {}, key = p.name || '';
  return {
    policy: [[ts(p.id), ts(p.name), ts(acc.id), ts(p.description), ts(p.grantType), ts(p.grantFrequency), p.grantStartDate || '', ts(p.forceAvail), ts(p.grantExpiration), ts(p.grantExpiredAfter)]],
    grantAmounts: (p.grantAmounts || []).map(function (a) { return [key, ts(a.start), ts(a.end), ts(a.amount), ts(a.max)]; }),
    grantAmountRules: (p.grantAmountRules || []).map(function (r) { return [key, ts(r.condition), ts(r.value)]; }),
    grantProrations: (p.grantProrations || []).map(function (r) { return [key, r.startDate || '', r.endDate || '', ts(r.amount)]; }),
    terminationProrations: (p.grantTerminationProrations || []).map(function (r) { return [key, r.startDate || '', r.endDate || '', ts(r.amount)]; }),
    grantRoundings: (p.grantRoundings || []).map(function (r) { return [key, ts(r.start), ts(r.end), ts(r.value)]; }),
    paycodes: (p.grantPaycodes || []).map(function (g) { return [key, 'GRANT', ts(g.paycode && g.paycode.id), ts(g.amount), '', '']; })
      .concat((p.paycodes || []).map(function (t) { return [key, 'TAKING', '', '', ts(t.paycode && t.paycode.id), ts(t.amount)]; })),
    cascades: (p.cascades || []).map(function (c) { return [key, ts(c.accrual && c.accrual.id), ts(c.priority)]; })
  };
}
function flattenAll(list) {
  var out = {}; SHEETS.forEach(function (s) { out[s.key] = []; });
  list.forEach(function (p) { var f = flattenPolicy(p); SHEETS.forEach(function (s) { out[s.key] = out[s.key].concat(f[s.key]); }); });
  return out;
}
function toObjs(sheetDef, rows) { return rows.map(function (r) { var o = {}; sheetDef.headers.forEach(function (hd, i) { o[hd] = r[i]; }); return o; }); }

/* Exact port of the old buildPayloadForPolicy (payload shape, defaults and quirks kept). */
function buildPayload(polRow, sheets) {
  var key = col(polRow, 'Name');
  function matches(rows) { return rows.filter(function (r) { return col(r, 'Policy Key') === key; }); }
  var grantAmounts = matches(sheets.grantAmounts).map(function (r) {
    var o = { start: col(r, 'Grant Amounts - Start'), end: col(r, 'Grant Amounts - End') };
    var amt = col(r, 'Grant Amounts - Amount'); if (amt) o.amount = amt;
    o.max = toBool(col(r, 'Grant Amounts - Max'));
    return o;
  });
  var grantAmountRules = matches(sheets.grantAmountRules).map(function (r) { return { condition: col(r, 'Grant Amount Rules - Condition'), value: col(r, 'Grant Amount Rules - Value') }; }).filter(function (r) { return r.condition; });
  var grantProrations = matches(sheets.grantProrations).map(function (r) { return { startDate: col(r, 'Grant Prorations - Start Date(MM/DD)'), endDate: col(r, 'Grant Prorations - End Date(MM/DD)'), amount: toNum(col(r, 'Grant Prorations - Amount')) || 0 }; });
  var grantTerminationProrations = matches(sheets.terminationProrations).map(function (r) { return { startDate: col(r, 'Termination Prorations - Start Date(MM/DD)'), endDate: col(r, 'Termination Prorations - End Date(MM/DD)'), amount: toNum(col(r, 'Termination Prorations - Amount')) || 0 }; });
  var grantRoundings = matches(sheets.grantRoundings).map(function (r) { return { start: col(r, 'Grant Roundings - Start'), end: col(r, 'Grant Roundings - End'), value: col(r, 'Grant Roundings - Value') }; });
  var pcRows = matches(sheets.paycodes);
  var grantPaycodes = pcRows.filter(function (r) { return col(r, 'Type').toUpperCase() === 'GRANT'; })
    .map(function (r) { return { paycode: { id: pInt(col(r, 'Grant Paycodes - Paycode ID')) }, amount: toNum(col(r, 'Grant Paycodes - Amount')) || 0 }; }).filter(function (x) { return x.paycode.id !== null; });
  var takingPaycodes = pcRows.filter(function (r) { return col(r, 'Type').toUpperCase() === 'TAKING'; })
    .map(function (r) { return { paycode: { id: pInt(col(r, 'Taking Paycodes - Paycode ID')) }, amount: toNum(col(r, 'Taking Paycodes - Amount')) || 0 }; }).filter(function (x) { return x.paycode.id !== null; });
  var cascades = matches(sheets.cascades).map(function (r) { return { accrual: { id: pInt(col(r, 'Accrual Cascades - Accrual ID')) }, priority: pInt(col(r, 'Accrual Cascades - Priority')) || 1 }; }).filter(function (x) { return x.accrual.id !== null; });

  var payload = {
    name: key,
    description: col(polRow, 'Description') || key,
    accrual: { id: pInt(col(polRow, 'Accrual ID')) },
    grantType: col(polRow, 'Grant Information - Type') || 'FIXED_EARNED',
    grantFrequency: col(polRow, 'Grant Information - Frequency') || 'MONTHLY',
    grantStartDate: col(polRow, 'Grant Information - Start Date(YYYY-MM-DD)'),
    forceAvail: toBool(col(polRow, 'Grant Information - Force Avail')),
    grantExpiration: col(polRow, 'Grant Expiration - Expiration')
  };
  // Not covered by any column: always sent as false (old behaviour).
  FORCED_FALSE.forEach(function (k) { payload[k] = false; });
  var expiredAfter = col(polRow, 'Grant Expiration - Expired After');
  if (expiredAfter) payload.grantExpiredAfter = pInt(expiredAfter);
  if (grantAmounts.length) payload.grantAmounts = grantAmounts;
  if (grantAmountRules.length) payload.grantAmountRules = grantAmountRules;
  if (grantProrations.length) payload.grantProrations = grantProrations;
  if (grantTerminationProrations.length) payload.grantTerminationProrations = grantTerminationProrations;
  if (grantRoundings.length) payload.grantRoundings = grantRoundings;
  if (grantPaycodes.length) payload.grantPaycodes = grantPaycodes;
  if (takingPaycodes.length) payload.paycodes = takingPaycodes;
  if (cascades.length) payload.cascades = cascades;
  return { key: key, polId: pInt(col(polRow, 'ID')), payload: payload };
}

/* Review baseline.
 * - Top-level fields: the REAL current values. The builder forces some (five flags always false, blank Grant Type /
 *   Frequency -> FIXED_EARNED / MONTHLY, blank Description -> Name), so diffing against build(current) would hide them.
 * - Child lists: the current list read through the same builder, so number/text forms ("5" vs 5) and entry ids do not
 *   show as changes; a different row count is always shown. */
var CHILD = ['grantAmounts', 'grantAmountRules', 'grantProrations', 'grantTerminationProrations', 'grantRoundings', 'grantPaycodes', 'paycodes', 'cascades'];
function baseline(cur) {
  var f = flattenPolicy(cur), sh = {};
  SHEETS.forEach(function (s) { sh[s.key] = toObjs(s, f[s.key]); });
  var built = buildPayload(sh.policy[0], sh).payload, b = {};
  Object.keys(cur).forEach(function (k) { if (CHILD.indexOf(k) < 0) b[k] = cur[k]; });
  CHILD.forEach(function (k) { if (built[k]) b[k] = built[k]; });
  return b;
}
function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(function (k) { return k + ':' + canon(v[k]); }).join(',') + '}';
  return v === undefined ? '' : JSON.stringify(v);
}
function show(v) {
  if (v === undefined || v === null || v === '') return '';
  if (Array.isArray(v)) return v.length ? v.length + ' row(s): ' + v.map(show).join('; ') : '';
  if (typeof v === 'object') return Object.keys(v).map(function (k) { var x = v[k]; return k + ' ' + (x && typeof x === 'object' ? x.id : ts(x)); }).join(', ');
  return ts(v);
}
function sameScalar(a, b) {
  if ((a == null || a === '') && (b == null || b === '')) return true;
  if (typeof a === 'boolean' || typeof b === 'boolean') return a === b;   // 0 / 1 / "false" on the server is not the same as false
  return E.same(a, b);
}
// before = baseline(current), after = payload. Only keys that are sent are compared; a child list that is not
// sent (no rows in its sheet) is reported as "unchanged (not sent)" when the policy has entries there.
function diff(before, after, cur) {
  var out = [];
  Object.keys(after).forEach(function (k) {
    if (k === 'id') return;
    var label = LABELS[k] || k;
    if (k === 'accrual') { if (!sameScalar((before[k] || {}).id, (after[k] || {}).id)) out.push({ field: label, from: (before[k] || {}).id, to: (after[k] || {}).id }); return; }
    if (CHILD.indexOf(k) >= 0) {
      var real = Array.isArray(cur[k]) ? cur[k].length : 0;
      if (canon(before[k] || []) !== canon(after[k]) || real !== after[k].length) out.push({ field: label, from: show(cur[k] && real ? before[k] || cur[k] : ''), to: show(after[k]) });
      return;
    }
    if (!sameScalar(before[k], after[k])) out.push({ field: label, from: show(before[k]) || '∅', to: show(after[k]) || '∅' });
  });
  return out;
}
function notSent(cur, after) {
  var out = CHILD.filter(function (k) { return !(k in after) && Array.isArray(cur[k]) && cur[k].length; })
    .map(function (k) { return { field: LABELS[k] || k, from: cur[k].length + ' row(s)', to: 'unchanged (not sent)' }; });
  if (!('grantExpiredAfter' in after) && cur.grantExpiredAfter != null && cur.grantExpiredAfter !== '') out.push({ field: LABELS.grantExpiredAfter, from: ts(cur.grantExpiredAfter), to: 'unchanged (not sent)' });
  return out;
}

/* ---------- API ---------- */
async function fetchSummary() {
  var r = await ctx.EP.call('accrual-policies.list', null, { module: MOD });
  if (!r.ok) r = await ctx.EP.call('accrual-policies.list-fallback', null, { module: MOD });
  if (!r.ok) throw new Error('Could not load accrual policies (HTTP ' + r.status + '): ' + Api.parseError(r.text));
  return Api.asList(r.data);
}
function fetchOne(id) { return ctx.EP.call('accrual-policies.get', { id: id }, { module: MOD }); }
// Old accrPolFetchAll: summary list, then each policy with its child lists, 8 at a time (summary kept if a GET fails).
async function fetchAllFull() {
  var summary = await fetchSummary(), full = [];
  for (var i = 0; i < summary.length; i += 8) {
    var got = await Promise.all(summary.slice(i, i + 8).map(function (p) {
      return fetchOne(p.id).then(function (r) { return r.ok && r.data ? r.data : p; }).catch(function () { return null; });
    }));
    full = full.concat(got.filter(Boolean));
  }
  return full;
}
function fetchPaycodes() { return ctx.EP.listQuiet('accrual-policies.paycodes', null, { module: MOD }); }
function fetchAccruals() { return ctx.EP.listQuiet('accrual-policies.accruals', null, { module: MOD }); }

/* ---------- template / export ---------- */
async function template() {
  var res = await Promise.all([fetchAllFull().catch(function () { return []; }), fetchPaycodes(), fetchAccruals()]);
  var ex = flattenAll(res[0]);
  var sheets = SHEETS.map(function (s) { return { name: s.name, tabColor: s.tab, headers: s.headers, rows: [], highlightCols: s.input }; })
    .concat(SHEETS.map(function (s) { return { name: s.name + '_Existing', tabColor: '94A3B8', headers: s.headers, rows: ex[s.key] }; }))
    .concat([
      { name: 'Paycodes_Master', tabColor: '059669', headers: ['id', 'code', 'description'], rows: res[1].map(function (p) { return [p.id, p.code || '', p.description || '']; }) },
      { name: 'Accruals_Master', tabColor: '1D4ED8', headers: ['id', 'name', 'description'], rows: res[2].map(function (a) { return [a.id, a.name || '', a.description || '']; }) }
    ]);
  await X.download('accrual_policies_template.xlsx', sheets);
  UI.toast('Template downloaded — ' + res[0].length + ' existing polic' + (res[0].length === 1 ? 'y' : 'ies') + ', ' + res[1].length + ' paycode(s), ' + res[2].length + ' accrual(s).');
}
// Old "View Existing": the same 8 sheets, populated — upload it back after editing.
async function exportAll() {
  var list = await fetchAllFull();
  if (!list.length) { UI.toast('No accrual policies found.'); return; }
  var ex = flattenAll(list);
  await X.download('accrual_policies_' + new Date().toISOString().slice(0, 10) + '.xlsx',
    SHEETS.map(function (s) { return { name: s.name, tabColor: s.tab, headers: s.headers, rows: ex[s.key], highlightCols: s.input }; }));
}

/* ---------- upload ---------- */
async function parse(file) {
  if (file.sheetNames.indexOf('Accrual_Policy') < 0) throw new Error('The file has no “Accrual_Policy” sheet. Use the template from this tool.');
  var sheets = {};
  SHEETS.forEach(function (s) { sheets[s.key] = file.sheet(s.name).rows; });
  if (!sheets.policy.length) throw new Error('“Accrual_Policy” sheet is empty — nothing to submit.');
  var refs = await Promise.all([fetchPaycodes(), fetchAccruals()]);
  var payIds = {}, accIds = {};
  refs[0].forEach(function (p) { payIds[String(p.id)] = 1; });
  refs[1].forEach(function (a) { accIds[String(a.id)] = 1; });

  var built = sheets.policy.map(function (row) { var b = buildPayload(row, sheets); b.row = row.__row; b.raw = row; return b; });
  // Current records for the rows that update (with child lists).
  var ids = built.filter(function (b) { return b.key && b.polId != null; }).map(function (b) { return b.polId; })
    .filter(function (id, i, a) { return a.indexOf(id) === i; });
  var cur = {};
  for (var i = 0; i < ids.length; i += 8) {
    var got = await Promise.all(ids.slice(i, i + 8).map(function (id) { return fetchOne(id).then(function (r) { return { id: id, r: r }; }); }));
    got.forEach(function (g) { cur[String(g.id)] = g.r; });
  }

  var keys = {}, seenId = {}, items = [];
  built.forEach(function (b) {
    var p = b.payload;
    var it = { row: b.row, label: b.key ? b.key + (b.polId != null ? ' (id ' + b.polId + ')' : '') : 'Row ' + b.row, ref: b.polId };
    items.push(it);
    if (!b.key) { it.kind = 'skip'; it.note = 'No Name — row ignored'; return; }
    keys[b.key] = 1;
    var errs = [];
    if (p.accrual.id == null) errs.push('Accrual ID is required');
    else if (refs[1].length && !accIds[String(p.accrual.id)]) errs.push('Accrual ID ' + p.accrual.id + ' not found');
    var badPay = (p.grantPaycodes || []).concat(p.paycodes || []).map(function (x) { return x.paycode.id; }).filter(function (id) { return refs[0].length && !payIds[String(id)]; });
    if (badPay.length) errs.push('Paycode id(s) not found: ' + badPay.join(', '));
    var badCas = (p.cascades || []).map(function (x) { return x.accrual.id; }).filter(function (id) { return refs[1].length && !accIds[String(id)]; });
    if (badCas.length) errs.push('Cascade accrual id(s) not found: ' + badCas.join(', '));
    var badType = sheets.paycodes.filter(function (r) { return col(r, 'Policy Key') === b.key && ['GRANT', 'TAKING'].indexOf(col(r, 'Type').toUpperCase()) < 0; });
    if (badType.length) errs.push('Paycodes sheet row(s) ' + badType.map(function (r) { return r.__row; }).join(', ') + ': Type must be GRANT or TAKING');
    if (b.polId != null) {
      if (seenId[b.polId]) errs.push('Same ID ' + b.polId + ' appears again on row ' + seenId[b.polId]);
      else seenId[b.polId] = b.row;
    }
    if (errs.length) { it.kind = 'bad'; it.error = errs.join('; '); return; }

    if (b.polId != null) {
      var r = cur[String(b.polId)];
      if (!r || !r.ok || !r.data) { it.kind = 'bad'; it.error = r && r.status && r.status !== 404 ? 'Could not load policy ' + b.polId + ' (HTTP ' + r.status + ')' : 'No accrual policy with id ' + b.polId + ' in ' + Api.envLabel(); return; }
      var send = Object.assign({}, p, { id: b.polId });
      it.changes = diff(baseline(r.data), send, r.data);
      if (!it.changes.length) { it.kind = 'same'; return; }
      it.changes = it.changes.concat(notSent(r.data, send));
      it.kind = 'upd'; it.payload = send;
      it.run = function () { return ctx.EP.call('accrual-policies.update', { id: b.polId }, { body: send, module: MOD }); };
    } else {
      it.kind = 'new'; it.payload = p;
      var parts = ['Accrual ' + p.accrual.id];
      ['grantAmounts', 'grantAmountRules', 'grantProrations', 'grantTerminationProrations', 'grantRoundings', 'grantPaycodes', 'paycodes', 'cascades']
        .forEach(function (k) { if (p[k]) parts.push(p[k].length + ' ' + LABELS[k].toLowerCase()); });
      it.note = 'New policy · ' + parts.join(' · ');
      it.run = function () { return ctx.EP.call('accrual-policies.create', null, { body: p, module: MOD }); };
    }
  });
  // Child rows whose Policy Key matches no policy row are ignored (old behaviour) — say so.
  SHEETS.slice(1).forEach(function (s) {
    var orphan = {};
    sheets[s.key].forEach(function (r) { var k = col(r, 'Policy Key'); if (!keys[k]) (orphan[k] = orphan[k] || []).push(r.__row); });
    Object.keys(orphan).forEach(function (k) {
      items.push({ kind: 'skip', row: s.name + ' ' + orphan[k].join(', '), label: k ? 'Policy Key “' + k + '”' : 'Blank Policy Key', note: 'No policy with this Name in Accrual_Policy — ' + s.name + ' row(s) ignored' });
    });
  });
  return items;
}

/* ---------- browse ---------- */
function browse(bodyEl) {
  var holder = h('div', h('div.card', h('span.spin'), '  Loading accrual policies from ' + Api.envLabel() + '…'));
  bodyEl.appendChild(holder);
  async function draw() {
    var res = await Promise.all([fetchSummary(), fetchAccruals()]);
    var accName = {}; res[1].forEach(function (a) { accName[String(a.id)] = a.name; });
    var rows = res[0].map(function (p) {
      var aid = (p.accrual || {}).id;
      return { id: p.id, name: p.name, description: p.description, accrual: aid == null ? '' : (accName[String(aid)] ? accName[String(aid)] + ' (' + aid + ')' : aid),
        grantType: p.grantType, grantFrequency: p.grantFrequency, grantStartDate: p.grantStartDate };
    });
    var delBtn = UI.btn('Delete selected', { icon: 'trash', kind: 'quiet', sm: true }); delBtn.disabled = true;
    var tbl = UI.table([{ key: 'id', label: 'Id' }, { key: 'name', label: 'Name' }, { key: 'description', label: 'Description' }, { key: 'accrual', label: 'Accrual' },
      { key: 'grantType', label: 'Grant type' }, { key: 'grantFrequency', label: 'Frequency' }, { key: 'grantStartDate', label: 'Start date' }], rows, {
      select: true,
      onSelect: function (s) { delBtn.disabled = !s.size; U.swap(delBtn, U.icon('trash', 16), h('span', s.size ? 'Delete ' + s.size : 'Delete selected')); },
      toolbar: [UI.btn('Refresh', { icon: 'retry', sm: true, kind: 'quiet', onClick: draw }), UI.btn('Export for editing', { icon: 'download', sm: true, onClick: exportAll }), delBtn]
    });
    delBtn.onclick = function () {
      var todo = Array.from(tbl.selected).map(function (id) {
        var r = rows.filter(function (x) { return String(x.id) === id; })[0] || {};
        return { kind: 'del', ref: id, label: (r.name || '') + ' (id ' + id + ')', run: function () { return ctx.EP.call('accrual-policies.remove', { id: id }, { module: MOD }); } };
      });
      E.runDeletes(todo, MOD, 'accrual policy').then(function (r) { if (r) draw(); });
    };
    U.swap(holder, rows.length ? tbl : UI.empty('No accrual policies in ' + Api.envLabel() + ' yet.'));
  }
  draw().catch(function (e) { U.swap(holder, UI.note('bad', 'Could not load accrual policies', e.message)); });
}

ctx.defineTool('accrual-policies', {
  desc: 'Create and update accrual policies — grants, prorations, roundings, paycodes and cascades — from one Excel file, export them for editing, or delete them.',
  render: function (view) {
    var intro = h('div', UI.note('info', null, 'Upload the file with all 8 sheets: Accrual_Policy, Grant_Amounts, Grant_Amount_Rules, Grant_Prorations, Termination_Prorations, Grant_Roundings, Paycodes and Accrual_Cascades. ' +
      'In Accrual_Policy, leave ID blank to create a policy or fill it to update one. Every child sheet’s Policy Key must match the policy’s Name exactly. ' +
      'In Paycodes, set Type to GRANT or TAKING and fill only the matching pair of columns.'),
      UI.note('warn', null, 'On update, the row in Accrual_Policy replaces the policy as a whole, and a child sheet that has rows for the policy replaces those entries. A child sheet with no rows for the policy is not sent, so those entries stay as they are. Start from “Export for editing” to keep what is there.'));
    view.appendChild(UI.tabs([
      { id: 'upload', label: 'Create / update', render: function (b) {
        b.appendChild(E.uploadFlow({ module: MOD, sheet: 'Accrual_Policy', template: template, parse: parse, itemLabel: 'Policy', verb: 'policy change', blankNote: 'The Accrual_Policy row replaces the whole policy — blank cells do not keep the current value (as in the old tool): a blank Description becomes the Name, blank Grant Type / Frequency become FIXED_EARNED / MONTHLY, a blank Force Avail is FALSE, a blank Expired After is left out and other blank cells are sent empty. The five carry-over / encashment “max” flags are always sent as FALSE. Child sheets with no rows for a policy are not sent, so those entries stay as they are.', intro: intro }));
      } },
      { id: 'browse', label: 'Browse & export', render: browse }
    ]));
  }
});
