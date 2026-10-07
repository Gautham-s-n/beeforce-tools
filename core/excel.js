/* core/excel.js — read and write Excel files (xlsx-js-style, loaded on first use). */
'use strict';

var libs = {};
function loadScript(url, globalName) {
  if (window[globalName]) return Promise.resolve(window[globalName]);
  if (libs[url]) return libs[url];
  libs[url] = new Promise(function (res, rej) {
    var s = document.createElement('script');
    s.src = url;
    s.onload = function () { window[globalName] ? res(window[globalName]) : rej(new Error(globalName + ' did not load')); };
    s.onerror = function () { delete libs[url]; rej(new Error('Could not load the Excel library. Check your connection.')); };
    document.head.appendChild(s);
  });
  return libs[url];
}
function xlsx() { return loadScript(ctx.CONFIG.LIBS.XLSX, 'XLSX'); }
function exceljs() { return loadScript(ctx.CONFIG.LIBS.EXCELJS, 'ExcelJS'); }

/* Read first sheet (or named sheet) -> array of row objects keyed by header text.
 * Returns { rows, headers, sheetNames, sheet(name) }
 * - Real Excel date/time cells come back as yyyy-mm-dd / yyyy-mm-dd HH:mm:ss / HH:mm (never locale text).
 * - CSV is read as plain text, so values arrive exactly as written.
 * - __row is the real Excel row number (blank rows are skipped but still counted).
 * - A repeated header keeps the first column; later copies become "name_1", "name_2". */
async function read(file, opts) {
  opts = opts || {};
  var X = await xlsx();
  var wb;
  if (/\.(csv|txt)$/i.test(file.name)) {
    wb = X.read(await file.text(), { type: 'string', raw: true });
  } else {
    wb = X.read(new Uint8Array(await file.arrayBuffer()), { type: 'array', cellNF: true });
    wb.SheetNames.forEach(function (n) { fixDates(X, wb.Sheets[n]); });
  }
  function sheet(name) {
    var ws = wb.Sheets[name];
    if (!ws) return { rows: [], headers: [] };
    var aoa = X.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false, blankrows: true });
    var seen = {};
    var headers = (aoa[0] || []).map(function (h) {
      h = String(h == null ? '' : h).trim();
      if (!h) return '';
      if (seen[h] != null) { seen[h]++; return h + '_' + seen[h]; }
      seen[h] = 0; return h;
    });
    var rows = [];
    aoa.slice(1).forEach(function (r, i) {
      if (!r.some(function (v) { return String(v).trim() !== ''; })) return;
      var o = { __row: i + 2 };
      headers.forEach(function (h, c) { if (h) o[h] = r[c] == null ? '' : r[c]; });
      rows.push(o);
    });
    return { rows: rows, headers: headers };
  }
  var name = opts.sheet && wb.Sheets[opts.sheet] ? opts.sheet : wb.SheetNames[0];
  var first = sheet(name);
  ctx.Audit.onFileSelected(file.name);
  return { rows: first.rows, headers: first.headers, sheetNames: wb.SheetNames, sheet: sheet, fileName: file.name };
}
function fixDates(X, ws) {
  Object.keys(ws).forEach(function (k) {
    if (k[0] === '!') return;
    var c = ws[k];
    if (!c || c.t !== 'n' || !c.z || !X.SSF.is_date(c.z)) return;
    var v = c.v, f = v < 1 ? 'hh:mm' : (v % 1 ? 'yyyy-mm-dd hh:mm:ss' : 'yyyy-mm-dd');
    c.w = X.SSF.format(f, v);
  });
}

/* Same style as the old tool: blue header, pink header on input columns, tab colours, auto widths.
 * sheets: [{ name, headers, rows (array of arrays), highlightCols:[idx], tabColor:'RRGGBB' }] */
async function download(filename, sheets) {
  var X = await xlsx();
  var wb = X.utils.book_new();
  wb.Workbook = { Sheets: [] };
  sheets.forEach(function (sheet, si) {
    var ws = X.utils.aoa_to_sheet([sheet.headers].concat(sheet.rows || []));
    sheet.headers.forEach(function (h, c) {
      var ref = X.utils.encode_cell({ r: 0, c: c });
      if (!ws[ref]) ws[ref] = { t: 's', v: h };
      var inp = sheet.highlightCols && sheet.highlightCols.indexOf(c) >= 0;
      ws[ref].s = {
        fill: { patternType: 'solid', fgColor: { rgb: inp ? 'FFC7CE' : '0B5CC7' } },
        font: { bold: true, color: { rgb: inp ? '000000' : 'FFFFFF' } },
        alignment: { horizontal: 'center' }
      };
    });
    ws['!cols'] = sheet.headers.map(function (h, i) {
      var max = String(h || '').length;
      (sheet.rows || []).forEach(function (r) { var l = String(r[i] == null ? '' : r[i]).length; if (l > max) max = l; });
      return { wch: Math.min(Math.max(max + 2, 10), 45) };
    });
    if (sheet.headers.length) ws['!autofilter'] = { ref: X.utils.encode_range({ r: 0, c: 0 }, { r: Math.max((sheet.rows || []).length, 1), c: sheet.headers.length - 1 }) };
    wb.Workbook.Sheets[si] = sheet.tabColor ? { TabColor: { rgb: sheet.tabColor } } : {};
    X.utils.book_append_sheet(wb, ws, String(sheet.name || 'Sheet' + (si + 1)).replace(/[\\\/?*\[\]:]/g, ' ').slice(0, 31));
  });
  X.writeFile(wb, filename);
  ctx.Audit.onDownload(filename);
}

/* ---- value helpers ---- */
function col(row, name) {
  if (!row) return '';
  if (name in row) return row[name];
  var want = String(name).trim().toLowerCase();
  for (var k in row) if (k.trim().toLowerCase() === want) return row[k];
  return undefined;
}
function has(row, name) { return col(row, name) !== undefined; }
function str(v) {
  if (v == null) return '';
  var s = String(v).trim();
  if (/^-?\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
  return s;
}
// "1,234" / "1,23,456" (Indian grouping) -> "1234"; anything else unchanged
function ungroup(s) { return /^-?\d{1,3}(,\d{2,3})+(\.\d+)?$/.test(s) ? s.replace(/,/g, '') : s; }
// "12", "12.0", "1,234" -> number; "1.9" -> 1 (old tool truncated too); "12-A", "N/A" -> null (old read "12-A" as 12)
function int(v) { var s = ungroup(str(v)); return /^-?\d+(\.\d+)?$/.test(s) ? parseInt(s, 10) : null; }
function num(v) { var s = ungroup(str(v)); if (s === '' || !/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return null; return parseFloat(s); }
// Same words the old tool accepted (true/1/yes), plus their opposites. Anything else -> null.
function bool(v) {
  var s = str(v).toLowerCase();
  if (['true', 'yes', '1'].indexOf(s) >= 0) return true;
  if (['false', 'no', '0'].indexOf(s) >= 0) return false;
  return null;
}
/* Dates: yyyy-mm-dd, dd-mm-yyyy, dd/mm/yyyy, Excel serials -> yyyy-mm-dd ('' if unreadable).
 * For a/b/yyyy text: day first (India); if the second part is > 12 it must be month/day, so it is swapped. */
function date(v) {
  var s = str(v);
  if (!s) return '';
  if (/^\d{5}(\.\d+)?$/.test(s)) return new Date(Math.round((parseFloat(s) - 25569) * 86400000)).toISOString().slice(0, 10);
  var m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})(?:\D|$)/);
  if (m) return valid(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})(?:\D|$)/);
  if (m) { var a = +m[1], b = +m[2]; return b > 12 && a <= 12 ? valid(+m[3], a, b) : valid(+m[3], b, a); }
  return '';
}
function valid(y, mo, d) {
  var dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d ? y + '-' + ctx.U.pad(mo) + '-' + ctx.U.pad(d) : '';
}
/* Time "9:5" / "09:05:00" / "5:30 PM" / Excel fraction -> "HH:mm" ('' if unreadable) */
function time(v) {
  var s = str(v);
  if (!s) return '';
  if (/^0?\.\d+$/.test(s)) { var mins = Math.round(parseFloat(s) * 1440); return ctx.U.pad(Math.floor(mins / 60) % 24) + ':' + ctx.U.pad(mins % 60); }
  var m = s.match(/(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?m?\.?/i);
  if (!m) return '';
  var hh = +m[1], mm = +m[2];
  if (m[3]) { var pm = m[3].toLowerCase() === 'p'; if (hh < 1 || hh > 12) return ''; hh = hh % 12 + (pm ? 12 : 0); }
  if (hh > 23 || mm > 59) return '';
  return ctx.U.pad(hh) + ':' + ctx.U.pad(mm);
}
function fmt(v) {
  if (v == null) return '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') return JSON.stringify(v);
  return v;
}

ctx.X = { xlsx: xlsx, exceljs: exceljs, read: read, download: download, col: col, has: has, str: str, int: int, num: num, bool: bool, date: date, time: time, fmt: fmt };
