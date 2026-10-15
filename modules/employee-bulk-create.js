/* modules/employee-bulk-create.js — Employee Bulk Create.
 * NOTE: in the old portal the file regularization-policy-sets.js did NOT contain regularization policy sets — it
 * contained "Employee Bulk Create" (it says it "replaces the old Regularization Policies placeholder"). This is a
 * faithful port of that code. No regularization endpoints exist in the old tool.
 *
 * Endpoints (core/endpoints.js), all under the Data Management employees API:
 * employee-bulk-create.org-levels
 * employee-bulk-create.org-level-entries-next   { id: <level SEQUENCE>, name: "" }  (POST, read-only lookup, one per level)
 * employee-bulk-create.locations                (object id -> name)
 * employee-bulk-create.dropdown-values          (object dropdownId -> [values])
 * employee-bulk-create.create                   (one per valid row) */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Employee Bulk Create';

// Fixed configuration (never overridden by the uploaded file) — same values as the old tool.
var EMPLOYEE_TYPE_ID = 321;
var IDENTIFICATION_PROFILE_ID = 178;
var CONTRACTOR_COMPANY_ID = '11823';
var MAX_PAYLOAD_LEVELS = 15;
var TEMPLATE_TEXT_ROWS = 500; // rows pre-formatted as Text for ID-like columns

var FIXED_COLUMNS = ['employeeNumber', 'firstName', 'fatherName', 'email', 'sex', 'dob', 'joiningDate', 'identificationNumber', 'contractorCompanyId', 'locationId', 'mobileNumber'];
var REQUIRED_COLUMNS = ['employeeNumber', 'firstName', 'fatherName', 'email', 'sex', 'dob', 'joiningDate', 'identificationNumber', 'locationId', 'mobileNumber'];
var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ---------- helpers (old tool, unchanged) ---------- */
function getCol(row, name) { var v = X.col(row, String(name)); return v == null ? '' : String(v).trim(); }
function normalizeIdString(val) {
  if (val == null) return '';
  var s = String(val).trim();
  if (!s) return '';
  if (/^[+-]?\d+(\.\d+)?e[+-]?\d+$/i.test(s)) { var num = Number(s); if (isFinite(num)) return Math.round(num).toString(); }
  if (/^-?\d+\.0+$/.test(s)) return s.split('.')[0];
  return s;
}
function pad2(n) { return n < 10 ? '0' + n : '' + n; }
function validateYMD(y, m, d) {
  if (!y || !m || !d || m < 1 || m > 12) return null;
  var dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return y + '-' + pad2(m) + '-' + pad2(d);
}
/* Accepts DD-MM-YYYY, DD/MM/YYYY, YYYY-MM-DD, or an Excel date serial. */
function parseFlexibleDate(raw) {
  if (raw == null) return null;
  var s = String(raw).trim();
  if (!s) return null;
  var m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return validateYMD(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})$/);
  if (m) return validateYMD(+m[3], +m[2], +m[1]);
  if (/^\d+(\.\d+)?$/.test(s)) {
    var serial = parseFloat(s);
    if (serial > 20000 && serial < 60000) {
      var dt = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000);
      return validateYMD(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
    }
  }
  return null;
}
function calcAge(iso) {
  var p = iso.split('-').map(Number);
  var dob = new Date(Date.UTC(p[0], p[1] - 1, p[2]));
  var now = new Date();
  var today = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  var age = today.getUTCFullYear() - dob.getUTCFullYear();
  var had = today.getUTCMonth() > dob.getUTCMonth() || (today.getUTCMonth() === dob.getUTCMonth() && today.getUTCDate() >= dob.getUTCDate());
  return had ? age : age - 1;
}
function pInt(x) { var n = parseInt(parseFloat(x), 10); return isNaN(n) ? null : n; }
function apiErrorMessage(status, text) {
  if (status === 401) return 'Session expired. Please sign in again.';
  if (status === 403) return 'You do not have permission to create employees.';
  if (status === 409) return 'Employee already exists or duplicate data.';
  if (status === 500) return 'Server error while creating employee.';
  return Api.parseError(text) || ('HTTP ' + status);
}
function extractEntriesArray(raw) {
  if (Array.isArray(raw)) return raw;
  if (!raw || typeof raw !== 'object') return [];
  var keys = ['content', 'data', 'items', 'results', 'entries', 'list', 'records', 'orgLevelEntries'];
  for (var i = 0; i < keys.length; i++) if (Array.isArray(raw[keys[i]])) return raw[keys[i]];
  var outer = Object.keys(raw);
  for (var j = 0; j < outer.length; j++) {
    var v = raw[outer[j]];
    if (v && typeof v === 'object' && !Array.isArray(v)) for (var k = 0; k < keys.length; k++) if (Array.isArray(v[keys[k]])) return v[keys[k]];
  }
  return [];
}

/* ---------- reference data ---------- */
// action = the registry key's last part (same as the path's last part, used in the error text as before).
async function getJson(action, body) {
  var r = await ctx.EP.call('employee-bulk-create.' + action, null, { body: body, module: MOD });
  if (!r.ok) throw new Error(action + ' HTTP ' + r.status + (r.text ? ': ' + Api.parseError(r.text) : ''));
  return r.data;
}
async function loadReferenceData() {
  var debugRaw = null;
  var orgLevels = ((await getJson('org-levels')) || []).slice().sort(function (a, b) { return (a.sequence || 0) - (b.sequence || 0); });
  // The API wants the level's SEQUENCE in the "id" field, not its id (confirmed in the old tool).
  var entryResults = await Promise.all(orgLevels.map(function (lvl) {
    return getJson('org-level-entries-next', { id: lvl.sequence, name: '' }).then(function (raw) {
      var entries = extractEntriesArray(raw);
      if (!entries.length && debugRaw === null) debugRaw = { levelId: lvl.sequence, raw: raw };
      return { levelId: lvl.id, entries: entries };
    });
  }));
  var orgLevelEntries = {};
  entryResults.forEach(function (r) { orgLevelEntries[r.levelId] = r.entries; });
  var locRaw = (await getJson('locations')) || {};
  var locations = {};
  Object.keys(locRaw).forEach(function (id) { locations[String(id)] = locRaw[id]; });
  var locationsSorted = Object.keys(locRaw).map(function (id) { return { id: String(id), name: locRaw[id] }; }).sort(function (a, b) { return Number(a.id) - Number(b.id); });
  var dropdowns = (await getJson('dropdown-values')) || {};
  var dropdownIdsSorted = Object.keys(dropdowns).sort(function (a, b) { return Number(a) - Number(b); });
  var maxSeq = orgLevels.reduce(function (m, l) { return Math.max(m, l.sequence || 0); }, 0);
  var levelColumns = [];
  for (var i = 1; i <= maxSeq; i++) {
    var lvl = orgLevels.filter(function (l) { return l.sequence === i; })[0];
    levelColumns.push({ index: i, levelId: lvl ? lvl.id : null, levelName: lvl ? lvl.name : 'Level ' + i, code: lvl ? lvl.code : '' });
  }
  return { orgLevels: orgLevels, orgLevelEntries: orgLevelEntries, entryResults: entryResults, locations: locations, locationsSorted: locationsSorted,
    dropdowns: dropdowns, dropdownIdsSorted: dropdownIdsSorted, levelColumns: levelColumns, debugRaw: debugRaw };
}

/* ---------- template (same workbook as the old tool: coloured headers, Text-formatted ID columns, stacked Reference sheet) ---------- */
function styleCell(XL, ws, r, c, text, bg, font, bold) {
  var ref = XL.utils.encode_cell({ r: r, c: c });
  ws[ref] = { t: 's', v: text, s: { fill: { patternType: 'solid', fgColor: { rgb: bg } }, font: { bold: !!bold, color: { rgb: font } }, alignment: { horizontal: 'center', vertical: 'center' } } };
}
function uploadSheet(XL, ref) {
  var levelCols = ref.levelColumns.map(function (lc) { return 'level' + lc.index; });
  var headers = FIXED_COLUMNS.concat(ref.dropdownIdsSorted).concat(levelCols);
  var ws = XL.utils.aoa_to_sheet([headers]);
  headers.forEach(function (hd, c) {
    var bg = hd === 'contractorCompanyId' ? '9CA3AF' : REQUIRED_COLUMNS.indexOf(hd) !== -1 ? 'DC2626' : '7C3AED';
    styleCell(XL, ws, 0, c, hd, bg, 'FFFFFF', true);
  });
  var textCols = ['employeeNumber', 'identificationNumber', 'mobileNumber', 'locationId'].concat(levelCols).concat(ref.dropdownIdsSorted.map(String));
  headers.forEach(function (hd, c) {
    if (textCols.indexOf(hd) === -1) return;
    for (var r = 1; r <= TEMPLATE_TEXT_ROWS; r++) { var cr = XL.utils.encode_cell({ r: r, c: c }); if (!ws[cr]) ws[cr] = { t: 's', v: '', z: '@' }; }
  });
  ws['!cols'] = headers.map(function (hd) { return { wch: Math.max(hd.length + 4, 14) }; });
  ws['!ref'] = XL.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: TEMPLATE_TEXT_ROWS, c: headers.length - 1 } });
  return ws;
}
function referenceSheet(XL, ref) {
  var aoa = [], marks = [];
  function section(title, head, rows, color) {
    marks.push({ row: aoa.length, cols: head.length, color: color, title: true }); aoa.push([title]);
    marks.push({ row: aoa.length, cols: head.length, color: color, head: true }); aoa.push(head);
    rows.forEach(function (r) { aoa.push(r); });
    aoa.push([]);
  }
  section('SECTION A — ORGANIZATION LEVELS', ['Sequence', 'Level ID', 'Level Name', 'Code'], ref.orgLevels.map(function (l) { return [l.sequence, l.id, l.name, l.code || '']; }), 'D9C9A3');
  var er = [];
  ref.orgLevels.forEach(function (l) { (ref.orgLevelEntries[l.id] || []).forEach(function (e) { er.push([l.sequence, l.id, l.name, e.id, e.name]); }); });
  section('SECTION B — ORGANIZATION LEVEL ENTRIES', ['Sequence', 'Level ID', 'Level Name', 'Entry ID', 'Entry Name'], er, 'BFDBFE');
  section('SECTION C — LOCATIONS', ['Location ID', 'Location Name'], ref.locationsSorted.map(function (l) { return [l.id, l.name]; }), 'BBF7D0');
  var dr = [];
  ref.dropdownIdsSorted.forEach(function (id) { (ref.dropdowns[id] || []).forEach(function (v) { dr.push([id, v]); }); });
  section('SECTION D — DROPDOWN VALUES', ['Dropdown ID', 'Value'], dr, 'FDE68A');
  var ws = XL.utils.aoa_to_sheet(aoa);
  marks.forEach(function (m) {
    if (m.title) styleCell(XL, ws, m.row, 0, aoa[m.row][0], m.color, '3F3117', true);
    else for (var c = 0; c < m.cols; c++) styleCell(XL, ws, m.row, c, aoa[m.row][c] || '', '1D4ED8', 'FFFFFF', true);
  });
  ws['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 26 }, { wch: 14 }, { wch: 32 }];
  return ws;
}
async function downloadTemplate(ref) {
  if (!ref) throw new Error('Reference data is not loaded yet.');
  var XL = await X.xlsx();
  var wb = XL.utils.book_new();
  XL.utils.book_append_sheet(wb, uploadSheet(XL, ref), 'Employee Upload');
  XL.utils.book_append_sheet(wb, referenceSheet(XL, ref), 'Reference');
  var name = 'BeeForce_Employee_Bulk_Upload_Template.xlsx';
  XL.writeFile(wb, name);
  ctx.Audit.onDownload(name);
}

/* ---------- validation + payload (old tool, unchanged rules) ---------- */
function validateRow(row, ref, seen) {
  var errors = [];
  var employeeNumber = normalizeIdString(getCol(row, 'employeeNumber'));
  var firstName = getCol(row, 'firstName'), fatherName = getCol(row, 'fatherName'), email = getCol(row, 'email'), sex = getCol(row, 'sex');
  var dobRaw = getCol(row, 'dob'), joinRaw = getCol(row, 'joiningDate');
  var identificationNumber = normalizeIdString(getCol(row, 'identificationNumber'));
  var locationIdRaw = normalizeIdString(getCol(row, 'locationId'));
  var mobileNumber = normalizeIdString(getCol(row, 'mobileNumber'));
  if (!employeeNumber) errors.push('employeeNumber is required');
  if (!firstName) errors.push('firstName is required');
  if (!fatherName) errors.push('fatherName is required');
  if (!email) errors.push('email is required'); else if (!EMAIL_RE.test(email)) errors.push('email format is invalid');
  if (!sex) errors.push('sex is required');
  if (!mobileNumber) errors.push('mobileNumber is required');
  if (!identificationNumber) errors.push('identificationNumber is required');
  var dobIso = null;
  if (!dobRaw) errors.push('dob is required'); else { dobIso = parseFlexibleDate(dobRaw); if (!dobIso) errors.push('dob is not a valid date: "' + dobRaw + '"'); }
  var joinIso = null;
  if (!joinRaw) errors.push('joiningDate is required'); else { joinIso = parseFlexibleDate(joinRaw); if (!joinIso) errors.push('joiningDate is not a valid date: "' + joinRaw + '"'); }
  if (!locationIdRaw) errors.push('locationId is required');
  else if (!ref.locations[locationIdRaw]) errors.push('locationId "' + locationIdRaw + '" not found in Locations reference');
  if (employeeNumber) { if (seen.has(employeeNumber)) errors.push('Duplicate employeeNumber within uploaded file'); else seen.add(employeeNumber); }
  var levelValues = {};
  ref.levelColumns.forEach(function (lc) {
    var raw = normalizeIdString(getCol(row, 'level' + lc.index));
    if (!raw) { levelValues[lc.index] = 0; return; }
    if (lc.levelId) {
      var ok = (ref.orgLevelEntries[lc.levelId] || []).map(function (e) { return String(e.id); }).indexOf(raw) !== -1;
      if (!ok) { errors.push('level' + lc.index + ' ("' + raw + '") is not a valid entry for ' + lc.levelName); levelValues[lc.index] = 0; }
      else levelValues[lc.index] = pInt(raw) || 0;
    } else levelValues[lc.index] = pInt(raw) || 0;
  });
  var dropdownValues = {};
  ref.dropdownIdsSorted.forEach(function (dId) {
    var raw = getCol(row, String(dId));
    if (!raw) return;
    if ((ref.dropdowns[dId] || []).indexOf(raw) === -1) errors.push('Dropdown ' + dId + ' value "' + raw + '" is not in the allowed list');
    else dropdownValues[dId] = raw;
  });
  return { employeeNumber: employeeNumber, firstName: firstName, fatherName: fatherName, email: email, sex: sex, dobRaw: dobRaw, dobIso: dobIso,
    joinIso: joinIso, identificationNumber: identificationNumber, locationIdRaw: locationIdRaw, locationName: ref.locations[locationIdRaw] || '',
    mobileNumber: mobileNumber, age: dobIso ? calcAge(dobIso) : null, levelValues: levelValues, dropdownValues: dropdownValues, errors: errors };
}
function buildPayload(rr) {
  var dyn = {}, org = {};
  for (var i = 1; i <= MAX_PAYLOAD_LEVELS; i++) { var v = rr.levelValues[i] !== undefined ? rr.levelValues[i] : 0; dyn['level' + i] = v; org['level' + i] = v; }
  var dynamicFields = Object.assign({}, dyn, { orgStructure: org, age: String(rr.age), employeeType: EMPLOYEE_TYPE_ID });
  Object.keys(rr.dropdownValues).forEach(function (k) { dynamicFields[k] = rr.dropdownValues[k]; });
  return {
    employeeStatus: 'Approved', employeeNumber: rr.employeeNumber, firstName: rr.firstName, fatherName: rr.fatherName, email: rr.email,
    mobileNumber: rr.mobileNumber, dob: rr.dobIso, sex: rr.sex, joiningDate: rr.joinIso, identificationNumber: rr.identificationNumber,
    contractorCompanyId: CONTRACTOR_COMPANY_ID, locationId: rr.locationIdRaw, identificationProfileId: IDENTIFICATION_PROFILE_ID,
    requestId: '', employeeTypeId: EMPLOYEE_TYPE_ID, dynamicFields: dynamicFields, orgStructure: org
  };
}

ctx.defineTool('employee-bulk-create', {
  desc: 'Employee Bulk Create: create many employees from one Excel file, checked against your org levels, locations and dropdown values first.',
  render: function (view) {
    var state = { ref: null, expired: false };
    var refBox = h('div');
    var tplBtn = UI.btn('Download template', { icon: 'template', onClick: function () { return downloadTemplate(state.ref); } });
    tplBtn.disabled = true;

    async function loadRef() {
      tplBtn.disabled = true;
      U.swap(refBox, h('div.card', h('span.spin'), '  Loading reference data from ' + Api.envLabel() + '…'));
      try {
        var ref = await loadReferenceData();
        state.ref = ref;
        var entryCount = ref.entryResults.reduce(function (n, r) { return n + r.entries.length; }, 0);
        var breakdown = ref.entryResults.map(function (r) { var l = ref.orgLevels.filter(function (x) { return x.id === r.levelId; })[0]; return (l ? l.name : r.levelId) + ': ' + r.entries.length; }).join(' · ');
        U.swap(refBox,
          UI.note('ok', 'Reference data loaded. ', ref.orgLevels.length + ' organization level(s), ' + entryCount + ' org entries, ' + ref.locationsSorted.length + ' location(s), ' + ref.dropdownIdsSorted.length + ' dropdown list(s).'),
          breakdown ? h('p.small.muted', breakdown) : null,
          entryCount === 0 ? UI.note('warn', 'No org-level entries came back for any level. ', 'Raw response for level ' + (ref.debugRaw ? ref.debugRaw.levelId : '?') + ': ' + (ref.debugRaw ? JSON.stringify(ref.debugRaw.raw).slice(0, 600) : '(no sample)')) : null);
        tplBtn.disabled = false;
      } catch (e) {
        state.ref = null;
        U.swap(refBox, UI.note('bad', 'Could not load reference data. ', e.message), h('div.acts', UI.btn('Retry', { icon: 'retry', onClick: loadRef })));
      }
    }

    async function parse(file) {
      if (!state.ref) throw new Error('Reference data is not loaded yet — wait for it to finish loading (or retry) above.');
      var ref = state.ref, seen = new Set();
      state.expired = false;
      return file.rows.map(function (row) {
        var rr = validateRow(row, ref, seen);
        var it = { row: row.__row, label: (rr.employeeNumber || '(no number)') + (rr.firstName ? ' — ' + rr.firstName : ''), emp: rr };
        if (rr.errors.length) { it.kind = 'bad'; it.error = rr.errors.join('; '); return it; }
        var p = buildPayload(rr);
        it.kind = 'new'; it.payload = p;
        it.changes = [{ field: 'DOB', from: '', to: rr.dobIso + ' (age ' + rr.age + ')' }, { field: 'Joining', from: '', to: rr.joinIso }, { field: 'Location', from: '', to: rr.locationName || rr.locationIdRaw }];
        it.run = async function () {
          if (state.expired) return { ok: false, status: 401, msg: 'Not sent — session expired' };
          var r = await ctx.EP.call('employee-bulk-create.create', null, { body: p, module: MOD });
          var ok = r.status === 200 || r.status === 201; // old tool: only 200/201 count as created
          if (r.status === 401) state.expired = true; // old tool stops the run on 401
          return { ok: ok, status: r.status, data: r.data, text: r.text, msg: ok ? 'Created' : apiErrorMessage(r.status, r.text) };
        };
        return it;
      });
    }

    view.appendChild(h('div.card', { style: { marginBottom: '16px' } }, h('b', 'Reference data'), refBox));
    view.appendChild(E.uploadFlow({
      module: MOD, parse: parse, itemLabel: 'Employee', verb: 'employee',
      extraActions: tplBtn,
      intro: UI.note('info', null, 'Download the template (it is built live from your org levels, locations and dropdown lists), fill one row per employee and upload it. Every row is checked first — required fields, dates (DD-MM-YYYY, DD/MM/YYYY or YYYY-MM-DD), location, org-level entries, dropdown values and duplicate employee numbers. Only valid rows are created.'),
      reportCols: [{ label: 'employee_number', get: function (it) { return it.emp ? it.emp.employeeNumber : ''; } }, { label: 'first_name', get: function (it) { return it.emp ? it.emp.firstName : ''; } }]
    }));
    loadRef();
  }
});
