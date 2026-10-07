/* modules/employee-lookup.js — Employee Lookup Table: download every lookup table (one sheet each, with
 * dropdowns from a shared Reference_Data sheet), edit, upload, review row by row, save.
 * Endpoints (core/endpoints.js), keys prefixed with CFG.id:
 * <id>.tables    (entityType, column catalog, list of tables)
 * <id>.table     (one table: columns, headers, data)
 * <id>.save      (PUT — the WHOLE table object: id, entityType, name, columns, headers, data)
 * <id>.ref-…     outpass / time off / accrual / regularization policy sets, overtime policies, shift template sets,
 *                schedule pattern sets, schedule patterns, paycode event sets, known locations (Reference_Data dropdown values)
 * NOTE: org-lookup.js is the same code with a different CFG block. Keep the two in step. */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;

var CFG = {
  id: 'employee-lookup',
  MOD: 'Employee Lookup',
  entityType: 'EMPLOYEE',
  file: 'employee_lookup_data.xlsx',
  desc: 'Download the employee lookup tables, edit them in Excel and upload them back. You see every added, changed and removed row before anything is saved.'
};
var MOD = CFG.MOD;

/* ---------- Reference_Data (unchanged from the old tool) ---------- */
var REF_CATEGORIES = [
  { label: 'Outpass Policy Sets', ep: 'ref-outpass-policy-sets', fields: ['name', 'setName'] },
  { label: 'Timeoff Policy Sets', ep: 'ref-timeoff-policy-sets', fields: ['name', 'setName'] },
  { label: 'Accrual Policy Sets', ep: 'ref-accrual-policy-sets', fields: ['name', 'setName'] },
  { label: 'Regularization Policy Sets', ep: 'ref-regularization-policy-sets', fields: ['name', 'setName'] },
  { label: 'Overtime Policies', ep: 'ref-overtime-policies', fields: ['name'] },
  { label: 'Shift Template Sets', ep: 'ref-shift-template-sets', fields: ['name', 'setName'] },
  { label: 'Schedule Pattern Sets', ep: 'ref-schedule-pattern-sets', fields: ['name', 'setName'] },
  { label: 'Schedule Patterns', ep: 'ref-schedule-patterns', fields: ['name'] },
  { label: 'Paycode Event Sets', ep: 'ref-paycode-event-sets', fields: ['name', 'setName'] },
  { label: 'Known Locations', ep: 'ref-known-locations', fields: ['name'] }
];
var REF_COLUMN_KEYWORDS = [
  { label: 'Outpass Policy Sets', keywords: ['outpass policy set', 'outpass policy'] },
  { label: 'Timeoff Policy Sets', keywords: ['timeoff policy set', 'time off policy set', 'timeoff policy', 'time off policy'] },
  { label: 'Accrual Policy Sets', keywords: ['accrual policy set', 'accrual policy'] },
  { label: 'Regularization Policy Sets', keywords: ['regularization policy set', 'regularization policy'] },
  { label: 'Overtime Policies', keywords: ['overtime policy', 'ot policy'] },
  { label: 'Shift Template Sets', keywords: ['shift template set', 'shift template'] },
  // "Schedule Pattern Sets" must be checked before plain "Schedule Patterns".
  { label: 'Schedule Pattern Sets', keywords: ['schedule pattern set'] },
  { label: 'Schedule Patterns', keywords: ['schedule pattern'] },
  { label: 'Paycode Event Sets', keywords: ['paycode event set', 'paycode event'] },
  { label: 'Known Locations', keywords: ['location'] }
];
function matchColumnToCategory(title) {
  var n = String(title || '').toLowerCase();
  for (var i = 0; i < REF_COLUMN_KEYWORDS.length; i++) {
    var e = REF_COLUMN_KEYWORDS[i];
    for (var j = 0; j < e.keywords.length; j++) if (n.indexOf(e.keywords[j]) !== -1) return e.label;
  }
  return null;
}
function cleanValues(list, fields) {
  var seen = {}, out = [];
  (list || []).forEach(function (item) {
    if (!item) return;
    var v;
    for (var i = 0; i < fields.length; i++) { var x = item[fields[i]]; if (x != null && String(x).trim() !== '') { v = x; break; } }
    if (v === undefined) return;
    v = String(v).trim();
    if (v === '' || seen[v]) return;
    seen[v] = true; out.push(v);
  });
  return out;
}
// Old extractList: like Api.asList, plus a { list: [...] } wrapper that some reference endpoints use.
function extractList(raw) {
  var l = Api.asList(raw);
  if (l.length || !raw || typeof raw !== 'object' || Array.isArray(raw)) return l;
  return Array.isArray(raw.list) ? raw.list : [];
}
async function fetchAllReferenceData() {
  var res = await Promise.all(REF_CATEGORIES.map(async function (cat) {
    var r = await ctx.EP.call(CFG.id + '.' + cat.ep, null, { module: MOD });
    if (!r.ok) return { label: cat.label, values: [], ok: false, error: 'HTTP ' + r.status };
    return { label: cat.label, values: cleanValues(extractList(r.data), cat.fields), ok: true };
  }));
  var columns = [], failures = [];
  res.forEach(function (r) {
    if (r.values.length) columns.push({ label: r.label, values: r.values });
    else failures.push(r.label + (r.ok ? ' (no data)' : ' (could not load)'));
  });
  return { columns: columns, failures: failures };
}

/* ---------- table helpers (same rules as the old tool) ---------- */
// Old formatValue: trims, "12.0" -> "12".
function formatValue(v) {
  if (v === null || v === undefined) return '';
  var s = String(v).trim();
  if (s.indexOf('.0', s.length - 2) !== -1) { var n = parseFloat(s); if (!isNaN(n) && Number.isInteger(n)) return String(parseInt(n, 10)); }
  return s;
}
function headerLabel(hd) { return hd.type === 'INPUT' ? hd.title + ' *' : hd.title; }
function candidateLabels(hd) { var s = headerLabel(hd); return hd.type === 'INPUT' && s !== hd.title ? [s, hd.title] : [hd.title]; }
/* A sheet can carry the same header text twice (two table headers with the same title). The reader keeps the
 * first column as "Title" and renames later copies "Title_1", "Title_2" (same as the old reader). So the n-th
 * header with a given label reads the n-th column with that label — by position, never the first one twice. */
var OCC = new WeakMap();
function occurrence(t, hd) {
  var m = OCC.get(t);
  if (!m) {
    m = new Map(); var seen = {};
    (t.headers || []).forEach(function (x) { var l = headerLabel(x); seen[l] = seen[l] == null ? 0 : seen[l] + 1; m.set(x, seen[l]); });
    OCC.set(t, m);
  }
  return m.get(hd) || 0;
}
function cellForHeader(row, hd, t) {
  var n = t ? occurrence(t, hd) : 0;
  var labels = candidateLabels(hd).map(function (l) { return (String(l).trim() + (n ? '_' + n : '')).toLowerCase(); });
  var key = Object.keys(row).filter(function (k) { return k !== '__row' && labels.indexOf(k.trim().toLowerCase()) !== -1; })[0];
  return key ? row[key] : undefined;
}
function sanitizeSheetName(name) {
  var s = String(name || 'Sheet').replace(/[\\/*?:\[\]]/g, '-').trim();
  return (s || 'Sheet').slice(0, 31);
}
// Same naming as the download: a repeated name gets "_<id>".
function sheetNames(tables) {
  var used = {}, out = {};
  tables.forEach(function (t) {
    var n = sanitizeSheetName(t.name);
    if (used[n]) n = sanitizeSheetName(t.name + '_' + t.id);
    used[n] = true; out[t.id] = n;
  });
  return out;
}
function rowIsBlank(row, t) {
  return t.headers.every(function (hd) { var v = cellForHeader(row, hd, t); return v == null || String(v).trim() === ''; });
}
function inputHeaders(t) { var i = t.headers.filter(function (hd) { return hd.type === 'INPUT'; }); return i.length ? i : t.headers; }
function rowKey(t, rec) { return inputHeaders(t).map(function (hd) { return formatValue(rec[hd.data]).toLowerCase(); }).join('\u0001'); }
function rowName(t, rec) { return inputHeaders(t).map(function (hd) { return formatValue(rec[hd.data]); }).filter(Boolean).join(' / ') || '(blank)'; }

async function fetchTableList() {
  var r = await ctx.EP.call(CFG.id + '.tables', null, { module: MOD });
  if (!r.ok) throw new Error('Could not load the lookup table list (HTTP ' + r.status + '): ' + Api.parseError(r.text));
  var raw = r.data || {};
  if (raw.entityType) CFG.entityType = raw.entityType; // live value wins over the constant
  return { entityType: raw.entityType, columns: raw.columns || [], tables: raw.tables || [] };
}
async function fetchTable(id) {
  var r = await ctx.EP.call(CFG.id + '.table', { id: id }, { module: MOD });
  if (!r.ok) throw new Error('Could not load table ' + id + ' (HTTP ' + r.status + '): ' + Api.parseError(r.text));
  var raw = r.data || {};
  if (raw.entityType) CFG.entityType = raw.entityType;
  return {
    id: raw.id != null ? raw.id : id,
    entityType: raw.entityType || CFG.entityType,
    name: raw.name,
    columns: raw.columns || [],
    headers: (raw.headers || []).slice().sort(function (a, b) { return (a.sequence || 999) - (b.sequence || 999); }),
    data: raw.data || []
  };
}
async function fetchAllTables() {
  var list = await fetchTableList();
  if (!list.tables.length) throw new Error('No lookup tables were returned by ' + Api.envLabel() + '.');
  return Promise.all(list.tables.map(function (t) { return fetchTable(t.id); }));
}
function buildPutPayload(t, dataRows) {
  return { id: t.id, entityType: t.entityType || CFG.entityType, name: t.name, columns: t.columns, headers: t.headers, data: dataRows };
}

/* ---------- download: one sheet per table + Reference_Data with native dropdowns (ExcelJS) ---------- */
function colLetter(n) { var s = ''; while (n > 0) { var r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); } return s; }
async function downloadWorkbook() {
  var tables = await fetchAllTables();
  var ref = await fetchAllReferenceData();
  var ExcelJS = await X.exceljs();
  var wb = new ExcelJS.Workbook();
  var names = sheetNames(tables);
  var letter = {};
  ref.columns.forEach(function (c, i) { letter[c.label] = colLetter(i + 1); });
  tables.forEach(function (t) {
    var ws = wb.addWorksheet(names[t.id]);
    ws.addRow(t.headers.map(headerLabel));
    ws.getRow(1).eachCell(function (cell, n) {
      var hd = t.headers[n - 1];
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: hd && hd.type === 'INPUT' ? 'FFDC2626' : 'FF0B5CC7' } };
      cell.alignment = { horizontal: 'center' };
    });
    (t.data || []).forEach(function (rec) { ws.addRow(t.headers.map(function (hd) { return formatValue(rec[hd.data]); })); });
    ws.columns.forEach(function (col, i) {
      var hd = t.headers[i]; if (!hd) return;
      var max = (t.data || []).reduce(function (m, r) { return Math.max(m, formatValue(r[hd.data]).length); }, headerLabel(hd).length);
      col.width = Math.min(Math.max(max + 2, 12), 45);
    });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    var upto = Math.max((t.data || []).length + 1, 200) + 1;
    t.headers.forEach(function (hd, ci) {
      var lab = matchColumnToCategory(hd.title);
      var rc = lab && ref.columns.filter(function (c) { return c.label === lab; })[0];
      if (!rc || !rc.values.length) return;
      var f = "'Reference_Data'!$" + letter[lab] + '$2:$' + letter[lab] + '$' + (rc.values.length + 1);
      for (var r = 2; r <= upto; r++) {
        ws.getCell(r, ci + 1).dataValidation = { type: 'list', allowBlank: true, formulae: [f], showErrorMessage: true, errorStyle: 'warning', errorTitle: 'Invalid entry', error: 'Please choose a value from the dropdown list.' };
      }
    });
  });
  var ws2 = wb.addWorksheet('Reference_Data');
  ref.columns.forEach(function (c, i) {
    var hc = ws2.getCell(1, i + 1);
    hc.value = c.label;
    hc.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    hc.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF7C3AED' } };
    hc.alignment = { horizontal: 'center' };
    c.values.forEach(function (v, r) { ws2.getCell(r + 2, i + 1).value = v; });
    ws2.getColumn(i + 1).width = Math.min(Math.max(c.label.length + 2, 14), 40);
  });
  var buf = await wb.xlsx.writeBuffer();
  var url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  var a = h('a', { href: url, download: CFG.file });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
  ctx.Audit.onDownload(CFG.file);
  var rows = tables.reduce(function (s, t) { return s + (t.data || []).length; }, 0);
  UI.toast(tables.length + ' table(s), ' + rows + ' row(s) downloaded — one sheet per table.');
  if (ref.failures.length) UI.toast('No dropdown values for: ' + ref.failures.join(', '));
}

/* ---------- upload → row-level review ---------- */
// Each table is saved with one PUT of the whole table. Rows are shown one by one in the review, but they are
// sent together, so they cannot be ticked off individually (locked), and every row of a table shares one PUT.
function lock(it) { Object.defineProperty(it, '__lock', { get: function () { return true; }, set: function () {}, configurable: true }); }
function tableJob(t, records) {
  var job = { promise: null, used: null };
  var payload = buildPutPayload(t, records);
  job.run = function (it) {
    // First row of a run sends the PUT; the other rows reuse its answer. A retried row sends it again.
    if (!job.promise || job.used.has(it)) {
      job.used = new Set();
      job.promise = ctx.EP.call(CFG.id + '.save', { id: t.id }, { body: payload, module: MOD });
    }
    job.used.add(it);
    return job.promise.then(function (r) { return { ok: r.ok, status: r.status, text: r.text, msg: r.ok ? 'Saved with table ' + t.name : null }; });
  };
  return job;
}

async function parse(file) {
  var tables = await fetchAllTables();
  var names = sheetNames(tables);
  var byName = {};
  tables.forEach(function (t) { byName[names[t.id].toLowerCase()] = t; });
  var sheets = file.sheetNames.filter(function (n) { return n !== 'Reference_Data'; });
  var known = sheets.filter(function (n) { return byName[n.toLowerCase()]; });
  var unknown = sheets.filter(function (n) { return !byName[n.toLowerCase()]; });
  if (!known.length) throw new Error('None of the sheets in this file match a lookup table (' + tables.map(function (t) { return names[t.id]; }).join(', ') + ').');
  if (unknown.length) UI.toast('Ignored sheet(s) that are not a lookup table: ' + unknown.join(', '));

  var items = [], total = 0, errors = 0;
  known.forEach(function (sn) {
    var t = byName[sn.toLowerCase()];
    var rows = file.sheet(sn).rows.filter(function (r) { return !rowIsBlank(r, t); });
    var records = [], tItems = [];
    // current rows by key (a key can repeat — matched in order)
    var cur = {};
    (t.data || []).forEach(function (rec, i) { var k = rowKey(t, rec); (cur[k] = cur[k] || []).push(i); });
    var matched = {};
    rows.forEach(function (r) {
      var missing = t.headers.filter(function (hd) { if (hd.type !== 'INPUT') return false; var v = cellForHeader(r, hd, t); return v === undefined || formatValue(v) === ''; });
      var rec = {};
      t.headers.forEach(function (hd) { var v = cellForHeader(r, hd, t); if (v === undefined) return; var f = formatValue(v); if (f !== '') rec[hd.data] = f; });
      var it = { row: r.__row, label: t.name + ' · ' + rowName(t, rec), op: 'updated' };
      if (missing.length) {
        it.kind = 'bad'; it.error = 'INPUT field cannot be empty: ' + missing.map(function (hd) { return hd.title; }).join(', ');
        errors++;
        ctx.Audit.onValidationError(MOD + ' [' + t.name + '] row ' + r.__row + ': ' + it.error);
        tItems.push(it); return;
      }
      if (!Object.keys(rec).length) return;
      records.push(rec);
      var k = rowKey(t, rec);
      var idx = (cur[k] || []).shift();
      if (idx == null) {
        it.kind = 'new';
        it.changes = t.headers.filter(function (hd) { return rec[hd.data] != null; }).map(function (hd) { return { field: hd.title, from: '', to: rec[hd.data] }; });
      } else {
        matched[idx] = 1;
        var old = t.data[idx];
        it.changes = t.headers.filter(function (hd) { return formatValue(old[hd.data]) !== formatValue(rec[hd.data]); })
          .map(function (hd) { return { field: hd.title, from: formatValue(old[hd.data]), to: formatValue(rec[hd.data]) }; });
        it.kind = it.changes.length ? 'upd' : 'same';
      }
      tItems.push(it);
    });
    (t.data || []).forEach(function (old, i) {
      if (matched[i]) return;
      tItems.push({ row: '', kind: 'del', op: 'updated', label: t.name + ' · ' + rowName(t, old) + ' (not in file)',
        changes: t.headers.filter(function (hd) { return formatValue(old[hd.data]) !== ''; }).map(function (hd) { return { field: hd.title, from: formatValue(old[hd.data]), to: '' }; }) });
    });
    total += records.length;
    var job = tableJob(t, records);
    tItems.forEach(function (it) { if (E.applicable(it)) { it.run = function () { return job.run(it); }; lock(it); } });
    items = items.concat(tItems);
  });
  if (!total && !errors) throw new Error('No rows to upload in the lookup table sheets.');
  // All-or-nothing, like the old tool: one error anywhere and nothing is saved.
  if (errors) items.forEach(function (it) {
    if (!E.applicable(it)) return;
    var was = it.kind === 'new' ? 'add' : it.kind === 'del' ? 'remove' : 'change';
    it.kind = 'skip'; it.note = 'Would ' + was + ' this row — nothing is saved until the ' + errors + ' error row(s) are fixed.';
    delete it.run;
  });
  return items;
}

/* ---------- browse ---------- */
function browse(el) {
  var holder = h('div', h('div.card', h('span.spin'), '  Loading lookup tables from ' + Api.envLabel() + '…'));
  el.appendChild(holder);
  async function draw() {
    var tables = await fetchAllTables();
    var pick = UI.select(tables.map(function (t) { return { value: t.id, label: t.name + ' (' + (t.data || []).length + ' rows)' }; }), tables[0].id);
    var area = h('div');
    function show() {
      var t = tables.filter(function (x) { return String(x.id) === String(pick.value); })[0];
      var cols = t.headers.map(function (hd) { return { key: hd.data, label: headerLabel(hd), render: function (r) { return formatValue(r[hd.data]); }, text: function (r) { return formatValue(r[hd.data]); } }; });
      U.swap(area, t.headers.length ? UI.table(cols, (t.data || []).map(function (r, i) { var o = Object.assign({}, r); o.__i = i; return o; }), { rowKey: function (r) { return String(r.__i); } }) : UI.empty('This table has no columns.'));
    }
    pick.addEventListener('change', show);
    U.swap(holder,
      h('div.row', { style: { marginBottom: '10px' } }, UI.field('Table', pick), h('span', { style: { flex: 1 } }),
        UI.btn('Refresh', { icon: 'retry', sm: true, kind: 'quiet', onClick: draw }),
        UI.btn('Download all tables', { icon: 'download', sm: true, onClick: downloadWorkbook })),
      UI.note('info', null, 'Columns marked * are INPUT columns (every row needs a value). The others are OUTPUT and may be blank.'),
      area);
    show();
  }
  draw().catch(function (e) { U.swap(holder, UI.note('bad', 'Could not load lookup tables', e.message)); });
}

ctx.defineTool(CFG.id, {
  desc: CFG.desc,
  render: function (body) {
    body.appendChild(UI.tabs([
      { id: 'upload', label: 'Upload', render: function (b) {
        b.appendChild(E.uploadFlow({
          module: MOD, parse: parse, itemLabel: 'Table · row', verb: 'row change',
          extraActions: UI.btn('Download current data', { icon: 'download', onClick: downloadWorkbook }),
          intro: UI.note('info', 'How it works', 'Download the current data: one sheet per lookup table, plus Reference_Data for the dropdowns. ' +
            'Red columns marked * are INPUT (mandatory). Each uploaded sheet replaces that whole table, so rows you delete from a sheet are removed. ' +
            'Sheets you leave out are not touched. If any row has an error, nothing is saved. ' +
            'Unlike other tools, a blank cell here clears that value — the sheet is saved exactly as it is.'),
          blankNote: 'A blank cell clears that value: each sheet is saved exactly as it is, like the old tool.',
          reportCols: [{ label: 'changes', get: function (it) { return (it.changes || []).map(function (c) { return c.field + ': ' + X.fmt(c.from) + ' -> ' + X.fmt(c.to); }).join('; '); } }]
        }));
      } },
      { id: 'browse', label: 'Browse', render: browse }
    ]));
  }
});
