# Porting a gist module to BeeForce Tools v3

Old tool (reference, read-only): `$GIST/<module>.js` + `$GIST/common.js`
New tool: `/home/claude/beeforce-tools/modules/<module>.js`

**Rule #1: keep every endpoint, payload shape, query param, header and business rule of the old module.**
The old module is the source of truth for *what* is sent to Beeforce. The new one changes *how* it looks and adds
review-before-write, pause/stop, retry and a downloadable report. Do not invent endpoints. If the old module
does something odd, keep it (and add a short comment).

## File shape

```js
/* modules/<id>.js — <Tool name>. One line per endpoint used:
 * GET /api/attendance/...   POST ...  PUT ...  DELETE ... */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = '<Audit module name, same as old tool>';

ctx.defineTool('<id>', {
  desc: 'One plain sentence of what the tool does.',
  render: function (body, info) { /* build UI into body */ }
});
```
The file runs as `new Function('ctx', code)`. No import/export, no top-level `return`. `var`/functions at the top
level are private to the file. Shell already renders the page header (area, title, desc) — only fill `body`.

## Endpoint registry (required)
Modules never contain `/api/...` strings. Every call has an entry in `core/endpoints.js` (`DEFAULTS`, grouped by area):
`'<tool-id>.<action>': { tool, label, method, path, query?, required? }` — exact trailing slashes, `{id}` placeholders,
constant query params only, `required: false` for optional/fallback calls (the Postman importer won't flag them red).
Call with `ctx.EP.call(key, params, opts)`, `ctx.EP.list(key, params, opts)`, `ctx.EP.listQuiet(...)`; for helpers that
need the raw values use `ctx.EP.method(key)` / `ctx.EP.path(key, params)`. Admins can override method + path per
browser (Admin Settings → API endpoints) or for the team (`endpoints.json`). Registry query params are merged *before*
opts.query, so if order matters keep all params in opts.query.

## ctx APIs

### ctx.Api
- `Api.call(method, path, { query, body, module: MOD, contentType: 'json'|'vnd'|'none', retries })`
  → `{ ok, status, data, text }`. `path` starts with `/api/...` (env base URL prefixed automatically).
  Adds `Authorization: Bearer`, `X-Client-Type: Web`. 401 → re-sign-in prompt and one retry; 429/502-504 retried.
  Use `contentType:'vnd'` where the old code used `apiHV()` (application/vnd.api+json).
  Never call `fetch` directly for Beeforce.
- `Api.list(path, { query, module })` → array (unwraps `content`/`data`/`items`); throws readable Error on failure.
- `Api.listQuiet(path, opts)` → array or `[]` on failure (for reference sheets).
- `Api.parseError(text)` → readable message (violations/message/detail/title/error).
- `Api.state` → `{ env, base, user }`; `Api.envLabel()` → 'Production' | 'UAT'.

### ctx.X (Excel + value coercion)
- `await X.read(file)` → `{ rows:[{header:value, __row:excelRowNo}], headers, sheetNames, sheet(name) }` (first sheet).
- `await X.download(filename, [{ name, headers, rows:[[...]], highlightCols:[idx], tabColor:'RRGGBB' }])`
  Same look as old `downloadExcel` (input columns highlighted). Counts toward audit downloads automatically.
- `X.col(row, 'name')` (case-insensitive header lookup), `X.str`, `X.int`, `X.num`, `X.bool` (null when blank),
  `X.date` (→ yyyy-mm-dd, accepts dd-mm-yyyy, Excel serials), `X.time` (→ HH:mm), `X.fmt(v)` (for writing cells).
- `X.str` also does the old `cleanTaskId`/`formatValue` job ("12.0" → "12").

### ctx.UI
`UI.btn(label, { icon, kind:'primary'|'danger'|'quiet', sm, onClick })` (async onClick → spinner + error toast),
`UI.tabs([{ id, label, render(el) }])`, `UI.field(label, control, hint)`, `UI.input({ type, placeholder, value })`,
`UI.textarea`, `UI.select([{value,label}] | ['a','b'], value)`, `UI.check(label, checked)` (`.input` = checkbox),
`UI.note(kind 'info'|'warn'|'bad'|'ok', title, text)`, `UI.chip(text, 'new'|'upd'|'bad'|'ok')`, `UI.empty(text)`,
`UI.counts([{ n, label, kind }])`, `UI.table(cols, rows, { select, search, onSelect, rowKey, toolbar:[nodes] })`
(cols `[{ key, label, wrap, render(row) }]`), `UI.drop({ onFile(file) })`, `UI.toast(msg, 'bad'?)`,
`await UI.confirm({ title, body, verb, danger })` (always shows the environment), `UI.dialog(build(box, close))`,
`UI.runPanel(title)`, `UI.kv({ label: value })`, `UI.steps([...])`.
CSS classes available: `grid2 grid3 row card note acts spacer muted dim small` (see core/styles.js). Icons: see
`U.ICONS` in core/util.js (`U.icon(name, size)`). **No emoji anywhere in the UI.**

### ctx.Engine — use these instead of hand-written loops
1. **`E.entity(body, cfg)`** — standard config object (list / create / update / delete, one row = one record).
   Gives tabs "Create / update" (template → upload → review diff → apply → report) and "Browse & export"
   (table, export-for-editing, delete selected). cfg:
   `{ module, noun, base, list?(), refs?(), headers (array | fn(refs)), inputCols, flatten(rec, refs) → {header:value},
      build(row, refs, current|null) → payload, validate?(row, payload, refs) → error|null, labelOf(row),
      browse?:[{key,label}], refSheets?(refs, records) → sheets, create?(p), update?(id,p), remove?(id),
      canDelete?, extraTabs?:[{id,label,render}], intro?, idCol? }`
   Upload headers' first column is the id column (blank = create). On update the engine merges the uploaded
   row over `flatten(current)` (blank cells keep current values), diffs, and calls `build(merged)`.
   So `flatten` must output exactly the upload headers and `build(flatten(rec))` must reproduce an equivalent
   payload (round-trip). Keep the old module's upload headers and `build` = old payload builder.
   Records with nested child lists that the old tool edits as several rows (e.g. schedules of an event) can either
   be one row with a JSON/joined column, or use `E.uploadFlow` directly (below) with grouping (see accrual-policy-sets.js).
3. **`E.uploadFlow(cfg)`** → element, for anything else that writes from Excel (operations like punches, timecards).
   `cfg = { module, template: async () => download, parse: async (file) => items, itemLabel, verb, intro, reportCols, blankNote }`
   `blankNote`: say truthfully what a blank cell does on update for this tool (e.g. "Blank cells are sent as empty,
   like the old tool"). Omit it only if the tool has no updates.
   Each item: `{ kind: 'new'|'upd'|'del'|'act'|'same'|'skip'|'bad', row, label, changes:[{field,from,to}], error, note,
   op: 'created'|'updated'|'deleted' (audit), run: async () => Api.call(...) }`.
   Use `kind:'act'` for operational sends (approve, punch, transfer) that are neither create nor update.
   parse() should look things up (employee ids, current values) so the review shows exactly what will be sent,
   and mark rows that cannot work as `bad` with a clear error instead of failing at apply time.
   For multi-step sends (e.g. resolve then POST) put all steps in `run`, return the last `Api.call` result,
   or `{ ok:false, status, text }` on an earlier failure.
4. `E.runDeletes(items, MOD, noun)` — confirm + delete with progress (items `{ kind:'del', label, run }`).
5. `E.runQueue(panel, items)` — low-level, rarely needed.

Forms (single-record actions typed on screen, e.g. "raise one leave") → build with UI.field/UI.input inside
a `.card`, a primary button, then `UI.confirm` before any write, and show the result with UI.note / UI.toast.
Read-only lookups → UI.table.

## Core rules (after review, 2026-10-06)
- `Api.call` retries only GETs. Never pass `retries` on a POST/PUT/DELETE unless the old tool resent it.
- `X.bool` = true/yes/1 → true, false/no/0 → false, else null. `X.int` rejects junk like "12-A".
- `X.read` gives real date cells as yyyy-mm-dd (time HH:mm), CSV as plain text, `__row` = real Excel row.
- entity(): a cell containing CLEAR empties that field; non-numeric id = error.
- The review must show everything that will change on the server. If `build()` forces values (e.g. always
  `allowEdit:false`) or drops fields, diff the payload against the real current record, not `build(current)`.

## Style rules
- Plain, short, friendly English. Say what happens, not how. No emoji. No "Successfully".
- Every write goes through review (uploadFlow/entity) or UI.confirm. Never write on file pick.
- Template sheets: keep old sheet names, headers, highlight cols and reference sheets.
- Audit: Engine already calls onDbOp/newTransaction; X.read/X.download already log files. For custom writes outside
  the engine call `ctx.Audit.onDbOp('created'|'updated'|'deleted', n)`.

## Testing
Mock: `scratchpad/rig3/mock.py PORT seedfile.json` (generic CRUD for `/api/attendance/<coll>[/<id>]`, `.equals`
filters, POST with code "FAIL" → 400). Copy it to your own `mock_<batch>.py` if you need extra routes; do not edit
the shared one. Seed: copy `seed.json` and add data. Playwright helpers in `rig.py` (`MOCK_PORT` env var,
`launch`, `open_tool`, `sr(page, selector)` for shadow-DOM locators). See `t2.py` for a full upload→review→apply test.
Syntax check: `node -e "new Function('ctx', require('fs').readFileSync(F,'utf8'))"`.
