# Resume point — APIary (BeeForce Tools v3) (updated 2026-10-16)

## Done
- Core (shell, engine, UI kit, Excel, API, audit) and all tools ported (26 tools in 8 areas).
- Test suites rig3/t_A … t_F plus t2 pass against mock servers (runall.sh).
- Api.call accepts extra `headers` (cannot override Authorization / X-Client-Type) and refuses any URL outside the signed-in environment.
- Old "regularization-policy-sets.js" was really Employee Bulk Create. It is now `employee-bulk-create` under People & access.
  The empty "Regularization Policies" placeholder was removed. Policies area = outpass policies + sets.
- README.md with setup + bookmark snippet.

## Review pass (2026-10-06 night)
- Independent review compared every module with the old code; fixes applied, all suites (A–F + t2) pass.
- Core: GET-only auto retry; strict X.bool / X.int; date cells → yyyy-mm-dd; AM/PM times; CSV read raw; real Excel row numbers;
  CLEAR empties a field; non-numeric id = error; retry keeps the full report; review notes say truthfully what blanks do.
- Modules: review diffs against the real server record (forced values now visible); lookups that the payload doesn't need only warn.

## Configuration & security phase (2026-10-07)
- Phase 1: secrets out of config.js → core/secrets.js (localStorage 'bft.secrets'); first-run setup screen; webhook test;
  audit states (configured / not configured / needs attention); README security notes. Test: t_setup.py.
- Phase 2: core/layout.js (defaults → layout.json → 'bft.layout'); ADMIN_USERS in config.js; Settings area (9th slot);
  Admin Settings → Honeycomb editor (rename/reorder/hide/move/add, limits 8 areas / 6 tools), export/import, reset. Test: t_layout.py.
- Phase 3: core/endpoints.js registry (128 calls, 25 tools); all modules call ctx.EP; request logs identical to baseline
  (cmpcalls.py baseline final); Admin Settings → API endpoints (Postman v2.1 import, auto-map, red missing, edit, save,
  endpoints.json export, Postman export, reset). Test: t_endpoints.py. Dead code removed: Engine.policySet, Api.employeeId.

## Admin console (2026-10-07)
- ADMIN_USERS replaced: users sign in with per-client Beeforce admin accounts, so a username list can't single out people.
  Admin console login: fixed username bft.admin in config.js ADMIN_LOGIN + PBKDF2 hash (210k) of the password; opens only
  Settings, no Beeforce call. First login without hash → create-password screen; Admin Settings → Admin password to change.
  Tests: t_layout.py, t_endpoints.py, t_adminlogin.py (rig.py injects a test ADMIN_LOGIN: bt-console / correct horse battery staple).

## v3.1 (2026-10-07 afternoon) — name APIary
- Phase 1: rename; light/dark/system theme (tokens in styles.js, `.app[data-theme=light]`); per-tool icons; trail Home → tool
  for one-tool system areas; Admin Settings layout = collapsible accordions + search, fixed row grid.
- Phase 2: modules (index.js DEFAULT_MODULES, area.module; layout.json v2 with `modules`); top-bar module pill/menu;
  views honeycomb/gallery/cards/list remembered ('bft.view'); palette across modules (switches module).
- Phase 3: admin unlock inside a Beeforce session (user menu, sessionStorage 'bft.adminUnlock'); Developer panel
  (modules/dev-panel.js): endpoints, Send GET + response, copy cURL (token hidden / with token after confirm), Postman.
- Tests: t_theme, t_views, t_modules, t_dev (+ all older suites pass; tool request logs identical to before).
- Next (waiting on APIs): no-code components from API details for Onboarding / Core.

## v3.2 (2026-10-07 evening) — module page + "liquid hive" design (direction B2, chosen by the user)
- Module page after a fresh sign-in (bookmark re-open in the same session goes to the module). Onboarding and Core are
  built-in modules with no areas → "Coming soon" tiles (click = shake + toast). ctx.MODULE_LIST in core/layout.js.
- Hub = the module: name, minutes left, "Switch module" (→ module page). The chosen tile flows into the hub.
- Area "Attendance" renamed "Timecards & approvals" (id unchanged, so saved layouts still apply).
- Rounded hexagons (clip-path path(), CORNER 0.07); springy motion; SVG "goo" filter on the stage only while cells move
  (flow() in shell.js, off with reduced motion); 3D hover lift + pointer tilt (.cell .tl); honey hover on every cell.
- Tests: t_modpage.py (new); rig.pick_module() after sign-in; t_modules / t_layout updated for 3 built-in modules;
  rig PLAIN_CONFIG = fresh repo (username, no hash). All suites pass; tool request logs identical to v3.1.
- Design mocks: scratchpad design3/ (a_soft, b_liquid, b2_liquid, c_orbit).
- "Skip this page next time" on the module page (localStorage 'bft.skipModules'; sign-in then opens the saved module if
  it is live). Arrow keys move focus to the nearest hexagon in that direction (arrowNav), Enter opens, Esc on the module
  comb → module page. Hint shown on the module page and in the home pane. Test: t_keys.py.

## v3.3 (2026-10-08) — API console
- core/endpoints.js: overrides may carry off:true (optional entries only) → EP.call returns {ok:false, off:true} without
  a request, EP.list rejects (listQuiet → []). EP.setOne / resetOne / team / canOff / curlRaw. endpoints.json keeps off.
- modules/dev-panel.js rewritten as the API console: endpointCard (edit / reset / turn off / send GET / all pages /
  part picker / JSON-Excel-CSV / cURL / Postman), customCard (any /api/ path, same-origin only), explorer (Admin Settings
  tab "API explorer": search, tool + kind filters, Postman / cURL script / endpoints.json of what's shown).
- Admin console → "Sign in to Beeforce" in the explorer → Shell.adminToBeeforce(): audit SWITCH, normal session with
  admin unlocked, reopens on Settings → API explorer.
- Tests: t_api.py (new); t_dev.py labels updated. All suites pass; tool request logs identical to v3.1.

## v3.4 (2026-10-08) — minimize
- Top bar "Minimize": .app.min hides the overlay (state untouched, pointer-events none) and shows a draggable honey dock
  (position 'bft.dockPos'; label = open tool + minutes left). Dock click / bookmark (index.js: if minimized → restore)
  brings it back. Keys ignored while minimized. Background moved to .app::before so it can fade.
- Close + bookmark in the same session reopens the last area / tool (sessionStorage 'bft.place'; cleared on sign-out).
- Test: t_min.py. All suites pass; tool request logs identical to v3.1.
- Next (user asked): single-employee fetch & execute (e.g. Timecard: employee + date → current paycode and details);
  the user has an earlier build to share as reference.

## v3.5 (2026-10-08) — arrange by drag and drop
- core/layout.js: area.pos [q,r] (1–2 steps from the hub, validPos) and area.ring [toolId|'' ×6] in model, overrides,
  diff and build. Module order already existed.
- core/shell.js: SLOTS (18 places: classic 9 first), areaSlots(), toolSlots(); home scale fits the used places (all 18
  while arranging); mini-map follows. Arrange mode (top-bar button, Esc/Done): jiggle, dashed slot marks, pointer drag
  (dragStart/Move/End), drop = move or swap, saved via Layout.saveLocal (saveArrangement); Reset per level; admins
  download layout.json ("Team file"). Tools, palette and admin console unaffected.
- Test: t_arrange.py. All suites pass; tool request logs identical to v3.1.

## v3.6 (2026-10-08) — Lightbox backlight (user's pick: option 3 = blue light + honey focus)
- .backlight layer in .body behind the stage (z 4): radial --blcore/--blmid (sky blue; lighter in light theme), eased
  toward the pointer with rAF only while moving (wireLight / lightTick); shown on modules / honeycomb / area, hidden on
  tools and gallery views; reduced motion = no easing. Hover honey edge unchanged. Mocks: design3/e_backlit*.html.
- Test: t_light.py. All suites pass; tool request logs identical to v3.1.
- v3.6.1: user didn't want the light following the cursor → light only behind the hovered / keyboard-focused hexagon
  (lightFor / lightOff on cell enter/leave/focus; off on navigation and in arrange mode). No pointer tracking.

## v3.7.0 (2026-10-14) — design refinement (Stage 3 of the redesign; approved direction D)
- Files: core/styles.js (rewritten: flat tokens, type scale --t12…--t32, radii --r6/10/14, --mono, --focusring,
  --fieldline, --honeyedge; every pre-3.7 variable name kept), core/util.js (U.motion / setMotion / themeChoice /
  motionChoice / motionFollow / osReducedMotion / setPref; store.set returns saved?), core/shell.js, config.js (VERSION).
- Motion levels on .app[data-motion]: full (original choreography, softer: goo stdDeviation 7, tilt ±5°, lift 14px, no
  honey glow), calm (default; WAAPI in layout() from R.lastL: 380ms glide, entering cells fade/scale .94 in place,
  leaving 160ms), off (no movement, 120ms fades, colour feedback). OS reduce → off unless the user confirmed an override
  (bft.motionFollow=false); "Follow system again" restores it. Keys: bft.motion, bft.motionFollow, bft.theme (default
  now 'system' when unset; saved values kept; invalid → defaults; blocked storage → session memory + message).
- Appearance dialog (openAppearance) replaces the theme cycle button (top bar, sign-in card, user menu).
- Screen sizes on .app[data-vp]: desk ≥1180 (side 264px), tab 761–1179 (72px rail), narrow ≤760 (no side pane; Back
  button, crumb = current item, views in the user menu). sideW()/trailGeom() replace SIDE=320.
- Area hover details moved from the floating peek into the side pane (desk) / a tooltip (tab, narrow).
- Accessibility: focus ring on hexagons (blue, distinct from honey hover), dock and hidden module-page footer no longer
  tabbable, workspace/gallery hidden from focus when off, field borders ≥3:1, text tokens ≥4.5:1 (t_contrast.py).
- Tests: t_appearance, t_responsive, t_contrast, t_a11y (new); t_theme / t_modpage / t_light use rig.appearance().
  rig.launch(reduced_motion, color_scheme, init) and BFT_MOTION=full|calm|off. All suites pass at all three motion
  levels; tool request logs (method, path, query, body) identical to v3.6.1 (cmpcalls.py v361b v370*).

## v3.8.0 (2026-10-15) — Stage 4 design, part 1 (visual system and high-traffic surfaces)
- Decisions recorded with the user: mono stays the system stack (no font change); number keys 1–8 approved with
  conditions; CSV approved next to Excel (v3.9).
- core/ui.js: dialogs stack (OVS; Esc and Tab belong to the top one), focus trap, focus returns to the opener inside the
  shadow root, safe default focus (Cancel when there is a danger button), aria-labelledby from the h2; UI.codeDialog
  (numbered lines, Copy = text shown, Download); UI.menu (rendered at the app root so tables and panels never clip it;
  opens focused; ↑ ↓ Home End, type-ahead, Esc returns focus; disabled items with a reason; checkable items);
  UI.copy (ok toast, copy-by-hand dialog when the clipboard is blocked), UI.saveText, UI.setReason / btn({reason})
  (aria-disabled + tooltip), UI.skeleton; toasts ok / warn / bad; UI.table: header sort (aria-sort), Columns menu (first
  column locked; display only), empty state with Clear search, Clear selection, focusable scroll region, row ⋯ menu
  (default for selectable tables with an id: Copy id, Show row as JSON), flags shown Yes / No (files keep TRUE / FALSE).
- core/shell.js: top-bar search field (aria-label "Search tools"), Minimize + Close in a window-controls group, Arrange
  and the view switch on the honeycomb toolbar (.combar; narrow: user menu); user / module menus via UI.menu; palette
  rewrite (tools, areas, actions, admin endpoints from ctx.EP — read only; word-start and initials matching with marks;
  Tab = search inside an area, Backspace leaves; Ctrl Enter = actions; selection follows the pointer only when it moves);
  Keyboard shortcuts dialog (?); 1–8 open the numbered areas (numberedAreas(): the module's areas with tools, Settings
  excluded) on the home honeycomb only, never while typing (input / textarea / select / contenteditable /
  role=textbox|combobox|searchbox / IME) or with Ctrl / Alt / Meta (Shift allowed for AZERTY); badges on hover / focus,
  always with bft.areaKeyBadges; Appearance → Keyboard (bft.areaKeys default true, bft.areaKeyBadges default false;
  invalid values fall back); `/` focuses the table search. v3.8 CSS block at the end of the shell CSS (radii 4/6/8/12 —
  --r10/--r14 now 8/12 —, controls 26/32/36, titles 22px, honey = selection, blue = action).
- core/util.js: icons dots / columns / keyboard; U.areaKeys(), U.areaKeyBadges(). core/engine.js: entity browse uses
  UI.skeleton and a row menu with the raw record (Copy id, Show JSON, Delete…).
- Tests (rig4): every v3.7 suite at Calm / Full / Off + t_v38.py (top bar, keys incl. typing guards, shortcuts,
  Appearance, palette, menus, dialogs, tables, narrow); request logs identical to v3.7.0 (cmpcalls / cmpset).

## v3.9.0 (2026-10-15) — Stage 4 design, part 2 (write flow, CSV, developer tools)
- core/engine.js uploadFlow: clickable steps (UI.steps canPick / onPick), Alt ← / Alt → (window.__bftFlowKey, one
  listener per page), "Still loaded · Back to review" on step 1, Back to review from the Report and from a paused or
  running apply (confirmation; runQueue stop after the current item). Going back re-runs cfg.parse on the same file
  (same GETs) and marks applied rows by identity (row number(s) or label + occurrence) as kind 'done' — locked, and
  stepApply filters them out again before sending. Report: counts, note for rows applied earlier, Download report
  (Excel unchanged; CSV), Download errors, Retry N failed, Back to review, Start over.
- Error files (option c): cfg.errorRows tools get an Excel file with Errors (uploaded rows with every column +
  Error, Stage, Row in file; row lists like "2, 3" supported) and Result (v3.7 reportSheet); CSV = Errors; Copy errors
  (TSV). Other tools: Result only. Re-upload: the three extra columns are ignored without the "Ignored column(s)" toast
  (engine.entity parse, paycodes parse). errorRows / csv on: paycodes, punch, timeoff-raise, workflow-transfer, tasks,
  roles, employee-bulk-create (errorRows only), engine.entity tools (accrual, paycode-combinations).
- CSV (X.csvText / X.downloadCsv: UTF-8 BOM, CRLF, quoting): Download template / Export for editing take the tool's own
  Excel builder's first sheet (captureCsv swaps X.download while it runs). Excel stays the one-click default
  (UI.splitBtn: main button + chevron menu).
- dev-panel.js: explorer split view ≥940px (list + detail, method filter with counts, status dots, empty state),
  endpoint ⋯ menu (Copy path, Show cURL dialog), fold in the Developer panel, part picker Clear, Esc order (menu /
  dialog before the panel), copy via UI.copy. admin-settings.js: sticky save bar, area preview. shell.js: Caps Lock
  hint, eye button state, sign-in error role=alert. ui.js: run panel paused chip + Back to review, thin progress bar.
- Tests: t_steps.py (pause → back → applied never re-sent, each POST once, report / error files Excel + CSV, error file
  and CSV export re-upload), t_v39.py; t_api.py selectors follow the split view (helper C()).

## v3.10.0 (2026-10-15) — v3.6.1 look and layout with the chosen Stage 3–4 features
User kept: Appearance dialog, three motion levels, reduced motion, search (Ctrl K), dialogs, code dialog, menus,
tables, toasts, write flow, error files, CSV next to Excel, API explorer, Developer panel, run panel; plus the
accessibility fixes (focus rings, contrast ≥ 4.5:1, hidden panes out of the Tab order). Everything else went back to
v3.6.1 ("I especially hated how the three buttons — Arrange, etc. — were displayed in the left nav bar").
- Narrow windows: .top / .body min-width 980px and .app scrolls sideways (v3.6.1 cut the right side off); .app::before,
  .scrim and .toasts are position:fixed so they stay on screen while scrolled.
- core/styles.js = v3.6.1 styles + v3.7 motion block (calm / off) + a11y tokens (--focusring, --fieldline, --ink3,
  light --honey) + compatibility tokens for the kept components (--r*, --t*, --mono, --settle).
- core/shell.js: fixed 320px side pane at every width (SIDE, TRAIL = v3.6.1 trail geometry), no data-vp / rail /
  top-bar Back / combar / search field / window-controls group; v3.6.1 top bar (views, env, user, Search, Appearance,
  Arrange, Minimize, Close) and floating area peek; user menu = Unlock / Lock admin, Sign out (UI.menu). Removed:
  number keys 1–8 and badges, `?` shortcuts dialog, `/` table search key, Caps Lock hint, eye state label,
  Appearance keyboard section, v3.8 look CSS (radii, control heights, honey tabs / selection). Kept the v3.7 motion
  code, Appearance, palette rewrite, menus / dialogs / tables / write-flow CSS (palette and menus in v3.6.1 blue).
- core/util.js: areaKeys / areaKeyBadges and the keyboard icon removed (old bft.areaKeys values are ignored).
- core/ui.js: no aria-keyshortcuts="/" on table search. modules/admin-settings.js back to v3.7.0 (no save bar /
  preview). engine, excel, dev-panel and the 7 tool modules unchanged from v3.9.0.
- Tests: t_v310.py (layout, removed keys, palette, menus, dialogs, tables, explorer, Developer panel); t_a11y.py
  without the Back button (Esc instead); t_appearance.py without data-vp; t_responsive, t_v38, t_v39 retired.

## v3.11.0 (2026-10-16) — "Hive" theme (feedback: the dark mode looked AI-generated)
- The user compared 4 directions rendered on the real screens: IBM Carbon, GitHub Primer, warm workshop, and Atlassian
  light. They chose warm workshop for dark and the Atlassian structure, warm-tuned, for light, borrowing Carbon's flat
  tables and square fields and Primer's outlined badges.
- core/styles.js: a "Hive" block at the end, with tokens for both themes and component rules:
  - flat background (no radial glow), no top accent line, no blur;
  - 3px controls / 4px containers;
  - primary button = ink (--blue now means "ink action"; --blue2 = honey selection / focus);
  - fields with only a bottom line and an inset focus outline;
  - flat tables (filled header, row lines), outlined chips (color-mix border);
  - neutral done-steps (honey = current);
  - flat 4px progress bar;
  - a warm, faint backlight;
  - hexagon faces flat (the hub keeps its honey gradient).
- core/shell.js: a small block for the shell's own corners (menus, view switch, gallery tiles, arrange bar, dock label).
- No layout, behaviour, API or configuration changes. The theme default is still System.
- Tests: t_contrast treats transparent surfaces as the panel under them; t_v310 accepts 3.11.0.

## v3.12.0 (2026-10-16) — saved passwords on the sign-in card
- User's goal for the product: bulk actions / updates in Beeforce and quick data and endpoint extraction; circulated
  to colleagues, admin access stays with the user. They asked for credentials to be fetched automatically; they chose
  the browser-saved password (not reusing the Beeforce tab's session), and decided colleagues should get read-only
  exports (next feature).
- core/shell.js: `Saved` uses the Credential Management API (`navigator.credentials.get({password:true})`,
  `mediation:'optional'` when the card opens, `'required'` from the "Use a saved password" link).
  - It fills the card only: no auto sign-in, and it never overwrites typed values.
  - When nothing comes back, `sessionStorage bft.pwAsked` stops further asks in that tab.
  - After a successful Beeforce sign-in, `navigator.credentials.store(new PasswordCredential)` runs, except when the
    page belongs to the other environment.
  - Never for the admin console.
  - The sign-in API is unchanged.
- Test: t_savedpw.py (Credential API stubbed; headless Chromium has no password manager).

## v3.13.0 (2026-10-16) — roadmap stage 1: undo, run journal, Compare, Playbooks
- The user asked to implement the roadmap in stages with as few sessions as possible. Stage 1 = Tier 1 (undo, Compare,
  run journal) + Playbooks with cross-sheet checks. The two-environment sign-in for Compare was approved together with
  the roadmap.
- core/engine.js:
  - **Journal:** IndexedDB `apiary`/`runs`, keeps 300. `recordCalls` wraps `Api.call` during a run; `saveRun`;
    `runAndRecord(panel, todo, cfg, meta)` replaces `runQueue` in `stepApply`, `runDeletes` and Playbooks.
  - **Undo:** `undoOf`, `undoFile`, `deleteCreated`. Items carry `before` + `undoCols`; the flow carries
    `cfg.removeEp`.
  - **Upload flow:** `el.loadData(rd, name)`; `capture()` / `captureSheets()` for Playbooks.
  - **Compare:** `compareTab()`, `signInOther()`, `withOther()`. The second session lives in memory only; non-GET
    calls are refused while it is active. The sign-in uses `Api.signIn`, then the main state and sessionStorage are
    restored.
  - **Journal screen:** `openJournal()`, `runDetails`, Excel / JSON export.
- **Tools:**
  - `entity()`: `it.before` / `it.undoCols`, `cfg.removeEp`, `cfg.compare` → Compare tab.
  - paycodes.js: undo data, removeEp, Compare (`compareLoad` / `compareRow`, the linked paycode as a code).
  - accrual.js and paycode-combinations.js: removeEp + compare config.
  - modules/playbooks.js: new tool in Automation (index.js).
- **shell.js:** "Run journal" in the user menu and in search; the reauth prompt is named (`ctx.Shell.reauth`) so
  Compare can restore it.
- **Test:** t_v313.py (two mocks: Production seed.json, UAT seed_uat.json).

## v3.14.0 (2026-10-16) — roadmap stage 2: column mapping, Health check, Tools by role
- **engine.js:** `applyMap` / `savedMap` / `saveMap` (`localStorage bft.colmap`, keyed by tool, normalized file
  header → template header). `loadData` keeps the raw file and applies the map. `mapDialog` reads the tool's template
  headers with `captureSheets`.
- **modules/health.js** (new tool, Automation): GET-only lists via existing endpoint keys; checks broken references,
  duplicates, inactive-but-used paycodes and unused setup.
- **layout.js:** `access` in the team file only (`cleanAccess` / `access` / `roleOf`). `build()` hides tools outside
  the user's role and drops areas left empty. Admins are exempt; `previewRole` / `draftAccess` serve the admin
  preview. `exportRepo` keeps `access`.
- **shell.js:** Admin Settings tab "Tools by role" via `ctx.ADMIN_TABS`, so admin-settings.js is unchanged.
- **util.js:** `plus` icon.
- **Not done:** the tool generator (Tier 3 #8). API Automation already runs any endpoint from a sheet; a generator
  needs per-endpoint field metadata that the registry doesn't have.
- **Test:** t_v314.py.

## v3.15.0 (2026-10-16) — read-only roles, Data Export, Production guard, undo for two more tools
- The user asked to build the proposals that fit. Picked: the approved read-only export for colleagues, saved
  extractions, a Production guard, and undo for more tools. "Retry failed rows" already existed (Report → Retry N
  failed), so nothing was built for it. Compare for the policy tools was not built: their rows are one per approval
  level, which compareTab does not handle.
- **core/layout.js:** `access.readOnly` (role names) kept by `cleanAccess`; `isReadOnly(role)`; `build()` sets
  `ctx.READONLY`.
- **core/engine.js:**
  - `Api.call` wrapper (installed once): with `ctx.READONLY`, any method other than GET returns
    `{ ok:false, status:0, text: RO_TEXT }` without a request, except `READ_POSTS`
    (`employee-bulk-create.org-level-entries-next`). Without read only, the original `Api.call` runs with the same
    arguments.
  - `runQueue` sends nothing for a read-only role (covers roles.js, which uses its own fetch).
  - `uploadFlow` step 1 shows `readOnlyNote()` instead of the drop zone; `stepApply` and `runDeletes` refuse;
    entity browse hides Delete.
  - `guardSettings()` (`bft.prodGuard` = { on, min }, default on / 20); confirm calls pass `count`.
  - `undoOf` also takes `it.undoRows` + `it.undoHeaders` (several rows per record); the undo summary counts records.
  - CSS: `.guard`, `.app.ro .btn.delsel`, `.app.ro .envpill::after` ("Read only").
- **core/ui.js:** `UI.confirm` with `o.count` (= sends writes): read-only → toast and false; Production + guard on +
  (danger or count ≥ min) → type PRODUCTION (button off until typed; Enter confirms). `btn('Delete selected')` gets
  class `delsel`.
- **core/shell.js:** `markAdmin` toggles `.app.ro`; Tools by role has a "Read only" tick per role (rename / remove keep
  `readOnly` in step); new admin tab **Safety** (`ctx.ADMIN_TABS`, so admin-settings.js stays v3.7.0).
- **modules/data-export.js** (new, Automation): datasets = registry GETs without placeholders, one per path (projection
  FULL preferred), "Get …" / "Find …" lookups left out; Excel (one sheet per list + About), CSV / JSON per list; All
  pages (page/size 200, stops like the API explorer); saved sets in `bft.extractions`.
- **outpass-policies.js / timeoff-policy-config.js:** `undoRowsOf(id, curRows)` (export rows, empty → CLEAR),
  `removeEp`, Delete hidden for read only.
- **playbooks.js, tasks.js, api-automation.js:** `count` on their write confirms (guard + read only).
- **index.js:** `data-export` in Automation; **config.js:** VERSION only.
- **Rig:** `rig.launch` sets `bft.prodGuard` off unless `BFT_PRODGUARD=on`, so the older suites click through as
  before; t_v315.py covers the guard. New: t_v315.py, mkro.py, run315.sh, runlvl314.sh, runall315.sh.

## v3.16.0 (2026-10-16) — access control before sharing, lookup forms, plain errors, Light default
- From the user's proposal list they picked P21, P19, P16, P1, P3, P18 and decided P12 = Light. P13: colleagues
  will share one Beeforce username (e.g. LNTBTADMIN) on their own browsers; only the user has the admin login.
  The rest of the list (P2, P4–P11, P20, P22) waits; P23 (usage log) and P24 (hosted APIary) are phase two.
- **core/layout.js:** `cleanAccess` no longer needs roles; keeps `allowedUsers` (lower case), `approval`, `devices`
  ({ "XXXX-XXXX": { name, user, role, at } }). `deviceId()` (localStorage `bft.device`), `deviceEntry(user)`,
  `userAllowed(user)`, `deviceApproved(user)`. `roleOf`: an approved browser's role comes before the username's.
- **core/shell.js:** sign-in card refuses users not in `allowedUsers` before `Api.signIn`; after sign-in an unapproved
  browser gets `requestPanel` (request code `APIARY-REQ-` + base64url JSON {v,n,u,d,e,h,t}); the Beeforce session is
  dropped; "I am the APIary admin" + admin password lets the admin in. `start()` re-checks a restored session.
  `whoLabel` adds the approved name to audit messages. Admin tab **Access** (allowed accounts, approval switch,
  paste/approve requests with a role, approved browsers with role / Remove, "Approve this browser", download).
  Tools by role: folding cards (`.rolecard`, `.rolefold`, `.rolecount`); both tabs share one draft (`mergeDraft`).
- **core/engine.js:** `plainError(status, text)` (used by runQueue, Developer panel, Data Export, lookups);
  `LOOKUPS` (timecards, accrual balances, employee by number), `lookupFields`, `lookupQuery` (employee number → id
  for balances), `employeeId`; journal records `device` and `person`. Compare's second sign-in follows the list.
- **core/util.js:** theme default Light. **modules/dev-panel.js:** lookup fields, URL preview + cURL follow them,
  async request builder, plain error line. **modules/data-export.js:** "Look up one employee" card.
- **README:** v3.16 section and "Share APIary with a colleague" (bookmark name `⬢ APIary`).
- **Rig:** t_v316.py (+ run316.sh, seed_v316.json, runall316.sh).

## Open decisions for the user
- Lookup tables with two columns of the same title: now mapped by position (old tool copied the first column into both).
- Workflow transfer: "replace" column now really sent (old always sent false because of a header typo).
- Shift template update sends only the old field set; check on UAT whether Beeforce clears fields it doesn't receive.
- Kept from old tool (flagged, not changed): paycode-event updates reset schedule startDate to 2026-01-01; child entries are re-created without ids.

## Waiting on the user
1. Sign in as bft.admin → create the admin password → commit the ADMIN_LOGIN line. Rotate the old client secret + Chat webhook (they were in the gist).
2. Hosting: a GitHub repo raw URL for loader.js BASE (gists cannot hold the core/ and modules/ folders).
3. First run on real UAT. The mocks are built from the old code, so real response shapes may need small fixes.

## Test rig (rig3/ in the zip)
mock_X.py PORT seed_X.json + t_X.py per batch; run1.sh X PORT; runall.sh. Needs `npm i xlsx-js-style@1.2.0 @fontsource/schibsted-grotesk@5`.
