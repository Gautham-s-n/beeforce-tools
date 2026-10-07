# Resume point — BeeForce Tools v3 (updated 2026-10-06, evening)

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

## Open decisions for the user
- Lookup tables with two columns of the same title: now mapped by position (old tool copied the first column into both).
- Workflow transfer: "replace" column now really sent (old always sent false because of a header typo).
- Shift template update sends only the old field set; check on UAT whether Beeforce clears fields it doesn't receive.
- Kept from old tool (flagged, not changed): paycode-event updates reset schedule startDate to 2026-01-01; child entries are re-created without ids.

## Waiting on the user
1. Put real Beeforce usernames in ADMIN_USERS (config.js). Rotate the old client secret + Chat webhook (they were in the gist).
2. Hosting: a GitHub repo raw URL for loader.js BASE (gists cannot hold the core/ and modules/ folders).
3. First run on real UAT. The mocks are built from the old code, so real response shapes may need small fixes.

## Test rig (rig3/ in the zip)
mock_X.py PORT seed_X.json + t_X.py per batch; run1.sh X PORT; runall.sh. Needs `npm i xlsx-js-style@1.2.0 @fontsource/schibsted-grotesk@5`.
