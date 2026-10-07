/* modules/shift-templates.js — Shift Templates: times, tolerances, days and paycode bands.
 * Endpoints (core/endpoints.js):
 *   shift-templates.list            ?projection=FULL   (list, view, create template)
 *   shift-templates.listForUpdate   ?projection=FULL   (update download — trailing slash as the old tool)
 *   shift-templates.paycodes        (reference sheet / names)
 *   shift-templates.create / .update {id} / .remove {id}
 * Two upload layouts, kept from the old tool:
 *  - Create: sheet Shift_Templates, one row per paycode band, rows with the same name = one template (POST).
 *  - Update: Shift_Templates_Update / Existing_Shift_Templates_Ref, read by POSITION because two columns are
 *    called "id" (template id, then paycode entry id). Rows with the same template id = one template (PUT). */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Shift Templates';
var DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
var TOLS = ['beforeStartToleranceMinute', 'afterStartToleranceMinute', 'lateInToleranceMinute', 'earlyOutToleranceMinute'];

var ST_HEADERS = ['name', 'description', 'startTime(HH:MM)', 'endTime(HH:MM)', 'startDay', 'endDay',
  'report', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'reportGroup', 'optionalShiftTemplate_id', 'overridePaycode_id',
  'beforeStartToleranceMinute', 'afterStartToleranceMinute', 'lateInToleranceMinute', 'earlyOutToleranceMinute',
  'paycode_id', 'startMinute', 'endMinute', 'max'];
var ST_INPUT_COLS = [0, 2, 3, 21, 22, 24];
var ST_VIEW_HEADERS = ['id', 'name', 'description', 'startTime', 'endTime', 'startDay', 'endDay',
  'report', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'reportGroup', 'optionalShiftTemplate_id', 'overridePaycode_id',
  'beforeStartToleranceMinute', 'afterStartToleranceMinute', 'lateInToleranceMinute', 'earlyOutToleranceMinute',
  'paycode_id', 'startMinute', 'endMinute', 'max'];
var ST_UPDATE_HEADERS = ['id', 'name', 'description', 'startTime', 'endTime',
  'beforeStartToleranceMinute', 'afterStartToleranceMinute', 'lateInToleranceMinute', 'earlyOutToleranceMinute',
  'report', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'id', 'Paycode ID', 'startMinute', 'endMinute', 'max'];
var SU = { ID: 0, NAME: 1, DESC: 2, START: 3, END: 4, TOL: 5, REPORT: 9, MON: 10, ENTRY_ID: 17, PAYCODE_ID: 18, START_MIN: 19, END_MIN: 20, MAX: 21 };
var UPD_SHEET = 'Shift_Templates_Update', UPD_REF_SHEET = 'Existing_Shift_Templates_Ref';

/* ---------- helpers (same rules as the old tool) ---------- */
function loadTemplates(slash) { return ctx.EP.list(slash ? 'shift-templates.listForUpdate' : 'shift-templates.list', null, { module: MOD }); }
function loadPaycodes() { return ctx.EP.listQuiet('shift-templates.paycodes', null, { module: MOD }); }
function byIdOf(list) { var o = {}; list.forEach(function (x) { o[String(x.id)] = x; }); return o; }
function pcName(pcById, id) { var p = pcById[String(id)]; return p ? (p.code || p.description || '#' + id) : '#' + id; }
function pInt(v) { return X.int(v); }                                    // parseIntSafe
function intOr0(v) { var n = X.int(v); return n == null ? 0 : n; }       // parseInt(x) || 0
function stBool(v, def) { var s = X.str(v).toLowerCase(); if (s === '') return def; return ['true', '1', 'yes', 'y'].indexOf(s) >= 0; }
function tb(v) { return v ? 'TRUE' : 'FALSE'; }
function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9]/g, ''); }
function cn(row, name) { var want = norm(name); for (var k in row) if (k !== '__row' && norm(k) === want) return X.str(row[k]); return ''; }

/* "9:5" / "09:05:00" / "9:05 PM" / Excel time fraction -> "HH:mm:ss" or null.
 * The old tool padded H:M:S parts as typed; the extra forms cover cells Excel turned into times. */
function hms(v) {
  var t = X.str(v);
  var m = t.match(/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/);
  if (m) return U.pad(m[1]) + ':' + U.pad(m[2]) + ':' + U.pad(m[3] || '0');
  m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp])\.?[Mm]\.?$/);
  if (m) { var hh = Number(m[1]) % 12 + (/p/i.test(m[4]) ? 12 : 0); return U.pad(hh) + ':' + m[2] + ':' + (m[3] || '00'); }
  if (/^0?\.\d+$/.test(t)) return X.time(t) + ':00';
  return null;
}
// Create: stBuildTime(time, day) — day 2 = 1970-01-02 (night shifts), blank time = 00:00:00.
function buildTime(timeStr, day) {
  var dateStr = day >= 2 ? '1970-01-02' : '1970-01-01';
  if (!X.str(timeStr)) return dateStr + ' 00:00:00';
  var t = hms(timeStr);
  return t ? dateStr + ' ' + t : null;
}
function fmtTime(dt) { if (!dt) return ''; var p = String(dt).split(' '); return p.length > 1 ? p[1].slice(0, 5) : String(dt).slice(0, 5); }
function fmtDay(dt) { if (!dt) return 1; return /-02$/.test(String(dt).split(' ')[0]) ? 2 : 1; }
// Update: "1970-01-01 09:35:00" <-> "01-01-1970 09:35"
function updFmt(api) {
  if (!api) return '';
  var p = String(api).trim().split(' '), d = (p[0] || '').split('-'), t = (p[1] || '00:00:00').split(':');
  return d.length === 3 ? d[2] + '-' + d[1] + '-' + d[0] + ' ' + t[0] + ':' + t[1] : '';
}
function updBuild(display) {
  var s = X.str(display);
  if (!s) return '';
  var m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?:\s+(.+))?$/);   // DD-MM-YYYY HH:MM (old format)
  var y, mo, d, time;
  if (m) { d = m[1]; mo = m[2]; y = m[3]; time = m[4]; }
  else { m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](.+))?$/); if (!m) return null; y = m[1]; mo = m[2]; d = m[3]; time = m[4]; }
  var t = time ? hms(time) : '00:00:00';
  if (!t) return null;
  return y + '-' + U.pad(mo) + '-' + U.pad(d) + ' ' + t.slice(0, 5) + ':00'; // old tool always sent :00 seconds
}
function pcText(list, pcById, markNew) {
  return list.map(function (e) { return pcName(pcById, e.paycode.id) + ' ' + e.startMinute + '–' + (e.max ? 'max' : (e.endMinute == null ? '?' : e.endMinute)) + (markNew && e.id == null ? ' (new)' : ''); }).join(', ');
}
function days(t) { return DAYS.filter(function (d) { return t[d]; }).map(function (d) { return d.slice(0, 2); }).join(' '); }

/* ---------- flatten (old layouts) ---------- */
function viewRows(t) {
  var base = [t.id, t.name || '', t.description || '', fmtTime(t.startTime), fmtTime(t.endTime), fmtDay(t.startTime), fmtDay(t.endTime),
    tb(t.report)].concat(DAYS.map(function (d) { return tb(t[d]); }), [t.reportGroup || '',
    (t.optionalShiftTemplate || {}).id || '', (t.overridePaycode || {}).id || ''],
    TOLS.map(function (k) { return t[k] || ''; }));
  var pcs = t.paycodes || [];
  if (!pcs.length) return [base.concat(['', '', '', ''])];
  return pcs.map(function (pc) { return base.concat([(pc.paycode || {}).id || '', pc.startMinute == null ? 0 : pc.startMinute, pc.max ? '' : (pc.endMinute == null ? '' : pc.endMinute), tb(pc.max)]); });
}
function updRows(t) {
  var base = [t.id, t.name || '', t.description || '', updFmt(t.startTime), updFmt(t.endTime)]
    .concat(TOLS.map(function (k) { return t[k] == null ? '' : t[k]; }), [tb(t.report)], DAYS.map(function (d) { return tb(t[d]); }));
  var pcs = t.paycodes || [];
  if (!pcs.length) return [base.concat(['', '', '', '', ''])];
  return pcs.map(function (pc) { return base.concat([pc.id == null ? '' : pc.id, (pc.paycode || {}).id == null ? '' : pc.paycode.id, pc.startMinute == null ? 0 : pc.startMinute, pc.max ? '' : (pc.endMinute == null ? '' : pc.endMinute), tb(pc.max)]); });
}
function flatMap(list, fn) { var out = []; list.forEach(function (x) { fn(x).forEach(function (r) { out.push(r); }); }); return out; }
function pcMaster(pcs) { return { name: 'Paycodes_Master', tabColor: '059669', headers: ['id', 'code', 'description'], rows: pcs.map(function (p) { return [p.id, p.code || '', p.description || '']; }) }; }

/* ---------- downloads ---------- */
async function createTemplate() {
  var res = await Promise.all([loadTemplates().catch(function () { return []; }), loadPaycodes()]);
  await X.download('shift_templates_template.xlsx', [
    { name: 'Shift_Templates', tabColor: '1D4ED8', headers: ST_HEADERS, rows: [], highlightCols: ST_INPUT_COLS },
    { name: 'Existing_Templates_Ref', tabColor: '7C3AED', headers: ST_VIEW_HEADERS, rows: flatMap(res[0], viewRows) },
    pcMaster(res[1])
  ]);
}
// Old "Download Existing Shift Templates": sheet 1 blank to fill, sheet 2 has every template. Either sheet can be uploaded.
async function updateDownload() {
  var list = await loadTemplates(true);
  await X.download('shift_templates_update_' + new Date().toISOString().slice(0, 10) + '.xlsx', [
    { name: UPD_SHEET, tabColor: '16A34A', headers: ST_UPDATE_HEADERS, rows: [] },
    { name: UPD_REF_SHEET, tabColor: '7C3AED', headers: ST_UPDATE_HEADERS, rows: flatMap(list, updRows) }
  ]);
}
async function fullView() {
  var list = await loadTemplates();
  await X.download('shift_templates_' + new Date().toISOString().slice(0, 10) + '.xlsx', [{ name: 'Shift_Templates', tabColor: '1D4ED8', headers: ST_VIEW_HEADERS, rows: flatMap(list, viewRows) }]);
}

/* ---------- create ---------- */
async function parseCreate(file) {
  if (!file.headers.some(function (k) { return String(k).trim().toLowerCase() === 'name'; })) throw new Error('Required column “name” not found. Use the Create template.');
  var res = await Promise.all([loadTemplates(), loadPaycodes()]);
  var existing = res[0], pcs = res[1], pcById = byIdOf(pcs), tById = byIdOf(existing);
  var groups = {}, order = [], items = [];
  file.rows.forEach(function (row) {
    var name = cn(row, 'name');
    if (!name) { items.push({ kind: 'bad', row: row.__row, label: '(no name)', error: '“name” is empty' }); return; }
    if (!groups[name]) { groups[name] = []; order.push(name); }
    groups[name].push(row);
  });
  order.forEach(function (name) {
    var g = groups[name], first = g[0], errs = [];
    var it = { row: g.map(function (r) { return r.__row; }).join(', '), label: name };
    var startDay = intOr0(cn(first, 'startDay')) || 1, endDay = intOr0(cn(first, 'endDay')) || 1;
    var st = cn(first, 'startTimeHHMM') || cn(first, 'startTime'), et = cn(first, 'endTimeHHMM') || cn(first, 'endTime');
    var p = {
      name: name, description: cn(first, 'description') || name,
      startTime: buildTime(st, startDay), endTime: buildTime(et, endDay),
      startDay: startDay, endDay: endDay,
      report: stBool(cn(first, 'report'), true)
    };
    if (!p.startTime) errs.push('startTime “' + st + '” is not HH:MM');
    if (!p.endTime) errs.push('endTime “' + et + '” is not HH:MM');
    DAYS.forEach(function (d) { p[d] = stBool(cn(first, d), true); });
    p.reportGroup = cn(first, 'reportGroup');
    TOLS.forEach(function (k) { p[k] = intOr0(cn(first, k)); });
    p.paycodes = [];
    var optId = pInt(cn(first, 'optionalShiftTemplate_id')), overId = pInt(cn(first, 'overridePaycode_id'));
    if (optId != null) p.optionalShiftTemplate = { id: optId };
    if (overId != null) p.overridePaycode = { id: overId };
    if (optId != null && existing.length && !tById[String(optId)]) errs.push('optionalShiftTemplate_id ' + optId + ' not found');
    if (overId != null && pcs.length && !pcById[String(overId)]) errs.push('overridePaycode_id ' + overId + ' not found');
    g.forEach(function (row) {
      var pcId = pInt(cn(row, 'paycode_id'));
      if (pcId == null) return;
      if (pcs.length && !pcById[String(pcId)]) errs.push('paycode_id ' + pcId + ' not found (row ' + row.__row + ')');
      var isMax = stBool(cn(row, 'max'), false), sm = pInt(cn(row, 'startMinute')), em = pInt(cn(row, 'endMinute'));
      var e = { paycode: { id: pcId }, startMinute: sm == null ? 0 : sm, max: isMax };
      if (!isMax && em != null) e.endMinute = em;
      p.paycodes.push(e);
    });
    if (!p.paycodes.length) errs.push('No paycode rows found');
    if (errs.length) { it.kind = 'bad'; it.error = errs.join('; '); items.push(it); return; }
    if (existing.some(function (t) { return String(t.name || '') === name; })) it.note = 'A shift template with this name already exists — a second one will be created.';
    it.kind = 'new'; it.payload = p;
    it.changes = [
      { field: 'time', from: '', to: fmtTime(p.startTime) + ' (day ' + startDay + ') – ' + fmtTime(p.endTime) + ' (day ' + endDay + ')' },
      { field: 'paycodes', from: '', to: pcText(p.paycodes, pcById) }
    ];
    it.run = function () { return ctx.EP.call('shift-templates.create', null, { body: p, module: MOD }); };
    items.push(it);
  });
  return items;
}

/* ---------- update (positional) ---------- */
async function readPositional(f) {
  var XL = await X.xlsx();
  var wb = /\.(csv|txt)$/i.test(f.name) ? XL.read(await f.text(), { type: 'string', raw: true }) : XL.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' });
  function rows(name) {
    var ws = wb.Sheets[name];
    if (!ws) return null;
    var aoa = XL.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: true });
    var data = aoa.slice(1).map(function (r, i) { r = r.slice(); r.__row = i + 2; return r; })
      .filter(function (r) { return r.some(function (c) { return String(c).trim() !== ''; }); });
    return { header: aoa[0] || [], rows: data };
  }
  // Old rule (old :459-465): Shift_Templates_Update first, then Existing_Shift_Templates_Ref, then the first sheet.
  // A sheet that is missing or has no rows is passed over.
  var order = [UPD_SHEET, UPD_REF_SHEET, wb.SheetNames[0]];
  for (var i = 0; i < order.length; i++) { var s = rows(order[i]); if (s && s.rows.length) { s.name = order[i]; return s; } }
  return { header: [], rows: [], name: '' };
}

// Payload as the old stBuildUpdatePayload(group).
function buildUpdate(group) {
  var first = group[0];
  var p = {
    id: pInt(first[SU.ID]), name: X.str(first[SU.NAME]), description: X.str(first[SU.DESC]),
    startTime: updBuild(first[SU.START]), endTime: updBuild(first[SU.END])
  };
  TOLS.forEach(function (k, i) { p[k] = intOr0(first[SU.TOL + i]); });
  p.report = stBool(first[SU.REPORT], false);
  DAYS.forEach(function (d, i) { p[d] = stBool(first[SU.MON + i], false); });
  p.paycodes = [];
  group.forEach(function (row) {
    var pcId = pInt(row[SU.PAYCODE_ID]);
    if (pcId == null) return;
    var entryId = pInt(row[SU.ENTRY_ID]), isMax = stBool(row[SU.MAX], false), sm = pInt(row[SU.START_MIN]), em = pInt(row[SU.END_MIN]);
    var e = { paycode: { id: pcId }, startMinute: sm == null ? 0 : sm, max: isMax };
    if (entryId != null) e.id = entryId; // keep the entry; blank = add a new paycode band
    if (!isMax && em != null) e.endMinute = em;
    p.paycodes.push(e);
  });
  return p;
}
var SCALARS = ['name', 'description', 'startTime', 'endTime'].concat(TOLS, ['report'], DAYS);
// Fields the old update never sent. They are left out of the PUT (old payload); the review says so.
var NOT_SENT = ['reportGroup', 'optionalShiftTemplate', 'overridePaycode', 'exceptions', 'startDay', 'endDay'];
function pcSig(list) { return list.map(function (e) { return [e.id == null ? '' : e.id, (e.paycode || {}).id, e.startMinute == null ? '' : e.startMinute, e.max ? 'max' : (e.endMinute == null ? '' : e.endMinute)].join('|'); }).sort().join(','); }
function curBands(cur) { return (cur.paycodes || []).map(function (e) { return { id: e.id, paycode: { id: (e.paycode || {}).id }, startMinute: e.startMinute, max: !!e.max, endMinute: e.endMinute }; }); }
function sv(v) { return v == null ? '' : String(v); }
function notSentText(k, v) {
  if (Array.isArray(v)) return v.length ? v.length + ' entr' + (v.length === 1 ? 'y' : 'ies') : '';
  if (v && typeof v === 'object') return v.id == null ? '' : 'id ' + v.id;
  return sv(v);
}

function makeParseUpdate(box) {
  return async function (file) {
    if (!box.file || box.file.name !== file.fileName || !box.sheetData) throw new Error('Could not read the file again. Choose it once more.');
    var sheet = box.sheetData;
    var hdr = sheet.header.map(norm);
    if (!sheet.rows.length) throw new Error('No data rows found in ' + file.fileName);
    if (hdr[SU.ID] !== 'id' || hdr[SU.ENTRY_ID] !== 'id' || hdr[SU.PAYCODE_ID] !== 'paycodeid')
      throw new Error('Sheet “' + sheet.name + '” is not in the update layout (columns id … id, Paycode ID). Use “Download existing for update”.');
    var res = await Promise.all([loadTemplates(true), loadPaycodes()]);
    var tById = byIdOf(res[0]), pcById = byIdOf(res[1]);
    var groups = {}, order = [], items = [];
    sheet.rows.forEach(function (r) {
      var id = pInt(r[SU.ID]);
      if (id == null) { items.push({ kind: 'bad', row: r.__row, label: X.str(r[SU.NAME]) || '(no id)', error: 'Shift template id is required' }); return; }
      if (!groups[id]) { groups[id] = []; order.push(id); }
      groups[id].push(r);
    });
    order.forEach(function (id) {
      var g = groups[id], cur = tById[String(id)];
      var it = { row: g.map(function (r) { return r.__row; }).join(', '), ref: id, label: (X.str(g[0][SU.NAME]) || (cur && cur.name) || '') + ' (id ' + id + ')' };
      if (!cur) { it.kind = 'bad'; it.error = 'No shift template with id ' + id + ' in ' + Api.envLabel(); items.push(it); return; }
      var curRows = updRows(cur);
      // Template-level cells left blank keep the current value (columns 1–16); paycode rows are taken as uploaded.
      var merged = g.map(function (r, i) {
        var m = r.slice(); m.__row = r.__row;
        if (i === 0) for (var c = 1; c < SU.ENTRY_ID; c++) if (X.str(m[c]) === '') m[c] = curRows[0][c];
        return m;
      });
      var p = buildUpdate(merged); // exactly the old stBuildUpdatePayload field set
      var errs = [];
      if (p.startTime === null) errs.push('startTime “' + X.str(merged[0][SU.START]) + '” is not DD-MM-YYYY HH:MM');
      if (p.endTime === null) errs.push('endTime “' + X.str(merged[0][SU.END]) + '” is not DD-MM-YYYY HH:MM');
      var curEntryIds = {}; (cur.paycodes || []).forEach(function (e) { if (e.id != null) curEntryIds[String(e.id)] = 1; });
      p.paycodes.forEach(function (e) {
        if (res[1].length && !pcById[String(e.paycode.id)]) errs.push('Paycode ID ' + e.paycode.id + ' not found');
        if (e.id != null && !curEntryIds[String(e.id)]) errs.push('paycode entry id ' + e.id + ' does not belong to this template (clear it to add a new band)');
      });
      if (errs.length) { it.kind = 'bad'; it.error = errs.join('; '); items.push(it); return; }
      // Diff the payload against the real record: values the builder forces (blank tolerance -> 0, seconds -> :00,
      // blank flag -> FALSE) show up here too.
      var ch = SCALARS.filter(function (k) { return sv(cur[k]) !== sv(p[k]); }).map(function (k) { return { field: k, from: cur[k], to: p[k] }; });
      var cb = curBands(cur);
      if (pcSig(cb) !== pcSig(p.paycodes)) ch.push({ field: 'paycodes', from: pcText(cb, pcById), to: pcText(p.paycodes, pcById, true) });
      if (!ch.length) { it.kind = 'same'; items.push(it); return; }
      NOT_SENT.forEach(function (k) { var t = notSentText(k, cur[k]); if (t) ch.push({ field: k, from: t, to: 'not sent (the old update never sent it)' }); });
      it.kind = 'upd'; it.changes = ch; it.payload = p;
      it.run = function () { return ctx.EP.call('shift-templates.update', { id: id }, { body: p, module: MOD }); };
      items.push(it);
    });
    return items;
  };
}

/* ---------- browse ---------- */
function browse(bodyEl) {
  var holder = h('div', h('div.card', h('span.spin'), '  Loading shift templates from ' + Api.envLabel() + '…'));
  bodyEl.appendChild(holder);
  async function draw() {
    var res = await Promise.all([loadTemplates(), loadPaycodes()]);
    var pcById = byIdOf(res[1]);
    var rows = res[0].map(function (t) {
      return { id: t.id, name: t.name, description: t.description,
        time: fmtTime(t.startTime) + ' – ' + fmtTime(t.endTime) + (fmtDay(t.endTime) > fmtDay(t.startTime) ? ' (+1)' : ''),
        days: days(t), tol: TOLS.map(function (k) { return t[k] == null ? 0 : t[k]; }).join(' / '),
        pcs: (t.paycodes || []).map(function (e) { return pcName(pcById, (e.paycode || {}).id) + ' ' + (e.startMinute || 0) + '–' + (e.max ? 'max' : e.endMinute); }).join(', '),
        exc: (t.exceptions || []).length };
    });
    var delBtn = UI.btn('Delete selected', { icon: 'trash', kind: 'quiet', sm: true }); delBtn.disabled = true;
    var tbl = UI.table([{ key: 'id', label: 'Id' }, { key: 'name', label: 'Name' }, { key: 'description', label: 'Description' }, { key: 'time', label: 'Time' },
      { key: 'days', label: 'Days' }, { key: 'tol', label: 'Tolerances (before/after/late/early)' }, { key: 'pcs', label: 'Paycodes', wrap: true }, { key: 'exc', label: 'Exceptions' }], rows, {
      select: true,
      onSelect: function (s) { delBtn.disabled = !s.size; U.swap(delBtn, U.icon('trash', 16), h('span', s.size ? 'Delete ' + s.size : 'Delete selected')); },
      toolbar: [
        UI.btn('Refresh', { icon: 'retry', sm: true, kind: 'quiet', onClick: draw }),
        UI.btn('Full detail', { icon: 'list', sm: true, kind: 'quiet', title: 'One row per paycode band (old “View Existing” file)', onClick: fullView }),
        UI.btn('Export for editing', { icon: 'download', sm: true, title: 'Update layout — edit and upload in the Update tab', onClick: updateDownload }),
        delBtn]
    });
    delBtn.onclick = function () {
      var todo = Array.from(tbl.selected).map(function (id) {
        var r = rows.filter(function (x) { return String(x.id) === id; })[0] || {};
        return { kind: 'del', ref: id, label: (r.name || '') + ' (id ' + id + ')', run: function () { return ctx.EP.call('shift-templates.remove', { id: id }, { module: MOD }); } };
      });
      E.runDeletes(todo, MOD, 'shift template').then(function (r) { if (r) draw(); });
    };
    U.swap(holder, rows.length ? tbl : UI.empty('No shift templates in ' + Api.envLabel() + ' yet.'));
  }
  draw().catch(function (e) { U.swap(holder, UI.note('bad', 'Could not load shift templates', e.message)); });
}

ctx.defineTool('shift-templates', {
  desc: 'Shift times, tolerances, working days and paycode bands. Create or update from Excel, export, or delete.',
  render: function (view) {
    view.appendChild(UI.tabs([
      { id: 'create', label: 'Create', render: function (b) {
        b.appendChild(E.uploadFlow({ module: MOD, template: createTemplate, parse: parseCreate, itemLabel: 'Shift template', verb: 'new template',
          intro: UI.note('info', null, h('div',
            h('div', 'Each row is one paycode band. Rows with the same name become one shift template with several paycodes.'),
            h('div', 'Pink columns are needed. Leave endMinute blank when max is TRUE. Blank day / report columns mean TRUE.'),
            h('div', 'startDay / endDay: 1 = same day, 2 = next day (night shifts that cross midnight).'))) }));
      } },
      { id: 'update', label: 'Update', render: function (b) {
        var box = { file: null, sheetData: null, sheet: undefined, pass: false };
        var cfg = { module: MOD, template: updateDownload, parse: makeParseUpdate(box), itemLabel: 'Shift template', verb: 'template change',
          blankNote: 'Template-level cells left blank keep the current value; a blank tolerance is sent as 0 and a blank report / day as FALSE. Paycode rows are taken exactly as uploaded: a band left out is removed. reportGroup, optional shift template, override paycode, exceptions and start/end day are not sent (as in the old tool).',
          intro: UI.note('info', null, h('div',
            h('div', 'Download existing: sheet 1 (Shift_Templates_Update) is blank, sheet 2 (Existing_Shift_Templates_Ref) has every template, one row per paycode band. Copy rows to sheet 1 or edit sheet 2 — sheet 1 is read first if it has rows, then sheet 2, then the first sheet.'),
            h('div', 'The first id is the shift template. The second id is the paycode band — keep it to change that band, clear it to add a new band. Leave out a band’s row to remove it.'),
            h('div', 'Dates are DD-MM-YYYY HH:MM (e.g. 01-01-1970 09:35; use 02-01-1970 for the next day).'))) };
        // uploadFlow reads one sheet and stops when it is empty; the sheet to use is only known after reading the file.
        Object.defineProperty(cfg, 'sheet', { get: function () { return box.sheet; } });
        var flow = E.uploadFlow(cfg);
        // The update sheet has two "id" columns, so the file is read here by position first (old reader, old sheet
        // order). Then the same file is handed on to uploadFlow, told to read the sheet that has the rows.
        function intercept(e, f) {
          if (box.pass || !f) return;
          e.stopPropagation(); e.preventDefault();
          var zone = flow.querySelector('.drop'); if (zone) zone.classList.remove('over');
          readPositional(f).then(function (data) {
            box.file = f; box.sheetData = data; box.sheet = data.name || undefined;
            var inp = flow.querySelector('input[type=file]');
            if (!inp) return;
            if (inp.files[0] !== f) { var dt = new DataTransfer(); dt.items.add(f); inp.files = dt.files; }
            box.pass = true;
            try { inp.dispatchEvent(new Event('change')); } finally { box.pass = false; }
          }).catch(function (err) { var inp = flow.querySelector('input[type=file]'); if (inp) inp.value = ''; UI.toast('Could not read ' + f.name + ': ' + err.message, 'bad'); });
        }
        flow.addEventListener('change', function (e) { var t = e.target; if (t && t.files) intercept(e, t.files[0]); }, true);
        flow.addEventListener('drop', function (e) { if (e.dataTransfer && e.dataTransfer.files) intercept(e, e.dataTransfer.files[0]); }, true);
        b.appendChild(flow);
      } },
      { id: 'browse', label: 'Browse & export', render: browse }
    ]));
  }
});
