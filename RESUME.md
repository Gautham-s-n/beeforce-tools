# Resume point — APIary (BeeForce Tools v3) (updated 2026-10-07, evening)

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
