# APIary (v3.9.0)

APIary is a bookmark that opens a full-screen honeycomb toolkit on top of Beeforce (Production or UAT). Every write is shown
for review first, then applied with pause / stop, retry for failed rows, and a downloadable Excel report.

## Set up (once)

1. Put the contents of this folder in a **public** GitHub repository (folders are needed, so a gist will not work).
2. Make a browser bookmark whose URL is this one line (replace `<you>` and `<repo>`):

```
javascript:(function(){var B='https://raw.githubusercontent.com/<you>/<repo>/main/';window.BFT_BASE_OVERRIDE=B;fetch(B+'loader.js?t='+Date.now()).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.text()}).then(function(c){(0,eval)(c)}).catch(function(e){alert('BeeForce Tools could not load: '+e.message)})})()
```

The bookmark fetches the files and runs them. Don't use a `<script src>` bookmark: GitHub serves raw files as
plain text, and browsers refuse to run them that way.

Every click loads the latest files, so a commit on GitHub reaches everyone on their next click (GitHub's raw
cache can delay it by a few minutes). Nothing to rebuild or redeploy.

## First run in each browser

The first time the bookmark opens on a site (Production and UAT count separately), a setup screen asks for:

- **Sign-in client id and secret** — needed to sign in. Get them from the BeeForce Tools admin (share through a password manager, not chat or email).
- **Google Chat audit webhook** (optional) — where the login message and session summary go. "Send test" checks it.
  Without it, the tool works but sends no audit from that browser; the home screen says "Audit off in this browser".

Change these later from the sign-in card ("Sign-in & audit setup") or Admin Settings.

### Security notes — read before rollout

- Secrets are no longer in the code or the repository. They are kept in `localStorage` on the Beeforce site, in that browser.
- That is **not** a vault. Any script running on the Beeforce page, browser extensions, and anyone using the same browser profile can read them. Don't set it up on shared computers.
- Every user who signs in needs the client secret, so it is effectively shared with all tool users. If Beeforce's own login page sends the same client header (check the Network tab on the Beeforce login), it is already visible to every Beeforce user.
- Audit is per browser and cannot be enforced by a client-side tool. Treat Google Chat audit as a convenience log, not a control.
- The old secrets were published in a gist and shared in chat: **rotate the client secret with Beeforce and create a new Chat webhook** before production use.

## Use

Open app.beeforce.in (or UAT), click the bookmark, sign in, choose a module, pick an area, then a tool.

**Arrange** (the button at the top right of the honeycomb, or Arrange in the user menu) to make the honeycomb your own: movable hexagons get a honey outline (and wiggle in Full motion), empty places show as
dashed outlines. Drag an area to any of the 18 places around the centre cell (drop it on another area to swap), click
an area and drag its tools to any of its 6 places, or drag module tiles on the module page to change their order.
Every drop is saved in this browser straight away; **Reset** puts the current level back, **Done** (or `Esc`) ends it.
Admins also get **Team file** — a layout.json with this arrangement to commit for everyone.

**Minimize** (the `—` button, top right) to use Beeforce alongside: APIary steps aside and a small honey button stays
on the page (drag it anywhere; it shows the open tool and minutes left). Click it — or the bookmark — to come back
exactly where you were, with any loaded file, review or results still there. **Close** (`×`) removes APIary; the
bookmark then reopens it on the same tool (files you had loaded are gone). While APIary is minimized, the bookmark
restores it instead of loading updates; close it with `×` first to pick up a new version. A full page reload in
Beeforce also removes it (the bookmark then reopens on the same tool). `Ctrl K` finds
any tool, area or action in any module (the search field in the top bar does the same), arrow keys move between hexagons, `1`–`8` open areas, `Esc` goes back one level. Closing the overlay keeps you signed in for the rest of the 120-minute
session; clicking the bookmark again in that session goes straight back to your module.

- **Module page** (after sign-in): Attendance, Onboarding, Core. A module without tools yet shows "Coming soon".
  The chosen module becomes the centre cell of its honeycomb: name, minutes left in the session, and "Switch module"
  (click it to come back to the module page). The top-left pill also switches module.
  Tick **"Skip this page next time and open the module I choose"** to go straight to your module at sign-in.
- **Keyboard:** arrow keys move between hexagons, `Enter` opens, `Esc` goes back one level (tool → area → module →
  module page), `Ctrl K` searches, `?` lists every key.
  - `1`–`8` open the areas of the home honeycomb (the numbers show when you point at an area). They never act while you
    type in a field. Turn them off in **Appearance → Area number shortcuts**; "Always show numbers on hexagons" keeps the
    numbers visible.
  - `/` jumps to the search of the table on screen.
  - `Alt ←` / `Alt →` step back and forward in Create / update (see "Write flow" below).
- **Back** (`‹` next to the logo) does the same as `Esc`: tool → area → all areas → module page. Its tooltip says where it goes.
- **Appearance** (sliders icon in the top bar, on the sign-in card, and in the user menu): theme and motion, saved in
  this browser.
  - **Theme:** System (follows Windows / macOS; the default for browsers without a saved choice), Light or Dark. A theme
    chosen in an earlier version is kept.
  - **Motion:** **Full** — cells flow on a spring and briefly merge while they move, hexagons lift and tilt slightly under
    the pointer; **Calm** (default) — short, settled movement: what stays on screen glides into place, new cells fade in
    where they belong, hover lifts a cell by 2px; **Off** — no movement, screens change with a short fade, hover still
    shows the honey edge. In Full and Calm a soft sky-blue light switches on behind the hovered (or keyboard-focused)
    hexagon ("Lightbox"); it never follows the pointer.
  - When Windows / macOS is set to **reduce motion**, APIary uses Off. Choosing Full or Calm then asks for confirmation
    first; **Follow system again** hands control back to the system setting.
- **Screen sizes:** at 1180px and wider the left pane shows the module, search, recent tools, area details on hover and
  the Home → area → tool trail. From 761 to 1179px it becomes a narrow rail (search, recent, arrange; the trail as
  icons with names as tooltips; area details as a tooltip). At 760px and below the pane is hidden: the workspace uses
  the full width, the top bar shows the current place only, the Back button walks back, and the views move into the
  user menu. Below 480px the module switch and Appearance are reached from the hub and the user menu.
- **Views** (top right of the honeycomb, next to Arrange): Honeycomb (default), Gallery, Cards, List. The last one you pick is remembered in this browser.
- **Search** (`Ctrl K` or the search field in the top bar): tools, areas and actions (Appearance, theme, views, Arrange,
  sign out …). Words match the start of words ("acc pol"); short queries also match initials ("tu" → Timecard Update).
  `Tab` on an area searches inside it; `Ctrl Enter` opens the actions of the selected row. Admins also find API endpoints
  (copy the path, show cURL, open the Developer panel) — nothing is sent from the search.
- **Tables:** click a column title to sort, **Columns** hides columns (only on screen), `/` searches, and the `⋯` on a
  row copies its id or shows it as JSON. Flags show as Yes / No; files keep TRUE / FALSE.

## Write flow (Create / update)

Choose file → Review → Apply → Report. The step bar is clickable for steps you can go back to, and `Alt ←` / `Alt →`
step back and forward.

- **Back to the review** from the Report, or while a run is paused ("Back to review" next to Pause / Stop; it asks
  first and stops after the item in progress). APIary reads Beeforce again with the same checks and marks the rows
  already applied in this run: they are locked and are never sent again. Rows that failed or were not sent can be applied again.
- **Downloads keep Excel as the one-click default.** The small arrow next to a download offers the other formats.
  - *Download report*: Excel (the same Result sheet as before) or CSV.
  - *Download errors* (Review and Report): for tools where each row stands alone (Paycodes, Punch, Timeoff Raise,
    Workflow Transfer, Tasks, Roles & Positions, Employee Bulk Create, Accrual, Combinations) the Excel file has an
    **Errors** sheet — the failed rows with all their columns plus Error, Stage and Row in file, ready to fix and
    upload again — and the **Result** sheet as before. CSV gives the Errors sheet. Tools that group several rows per
    item keep the Result list only. *Copy errors* puts the same rows on the clipboard, tab-separated.
  - *Download template* and *Export for editing*: CSV of the upload sheet for the tools above (Employee Bulk Create
    keeps its Excel-only template, which formats the id columns as text).
    Reference sheets stay in the Excel version. CSV files are UTF-8; Excel may drop leading zeros from codes when it
    opens a CSV directly (use Data → From Text, or keep the Excel file).

## Admin console (Settings)

The Settings screens open only through the **admin console login**: username `bft.admin` (fixed in `config.js`)
and its own password — not a Beeforce account. Type them on the normal sign-in card; the tool opens Admin Settings
without calling Beeforce. Admin-username attempts (right or wrong password) are never sent to Beeforce.
Normal Beeforce logins never see Settings.

- **First time:** sign in as `bft.admin` with any password → "Create admin password" → choose 14+ characters →
  copy the generated `ADMIN_LOGIN: {…}` line into `config.js` on GitHub (replace that line) and commit.
- **Change password:** Admin Settings → **Admin password** → current + new password → copy the new line → commit.
  The old password keeps working until the commit.
- To rename the admin user, edit `username` in that line (then create a new password, since the hash includes it).

**Inside a normal Beeforce session** an admin can open the user menu (your name, top right) → **Unlock admin tools**
with the same password. That adds the Settings area and a **Developer** button on every tool. Unlock lasts until
sign-out or tab close. **From the admin console** you can do the same: Admin Settings → **API explorer** → "Sign in to
Beeforce" (a normal Beeforce login); the page reopens as a full session with admin tools unlocked.

**Developer panel** (one tool) and **API explorer** (every endpoint, plus any Beeforce `/api/…` path):
- **Edit** method / path (checked before saving), **Reset** to the team / built-in value, **Turn off** optional calls
  (reference lists and review checks — the tool then skips them). Calls a tool needs can be changed, not turned off.
  Changes are saved in this browser; "endpoints.json" shares them with the team.
- **Send GET** with the response body. **All pages** follows `page=0,1,2…` and combines the list. **Part** narrows the
  response (`content`, `code`, `content.{id,code,description}`, `[0]` — click a suggestion).
- Download the response (or the part) as **JSON, Excel or CSV**; copy it.
- **cURL** (token hidden as `$BEEFORCE_TOKEN`; "cURL + token" asks first), **Postman** per endpoint / tool / filtered
  list, and a **cURL script** (.sh) of every shown endpoint.
- Writes (POST / PUT / DELETE) are never sent from here — copy them as cURL or Postman.
- The API explorer shows the list and the chosen endpoint side by side on wide screens, with a method filter
  (All / GET / Writes / Changed or off, with counts) and a dot for changed (honey), team (blue) and turned-off (red)
  endpoints. `⋯` on an endpoint: Copy path, Show cURL. Endpoints in the Developer panel fold.

Only a hash of the password is stored. This runs in the browser and config.js is public, so it keeps people out of
the screens but is not server-grade security; the real lock is who can commit to the GitHub repository.

- **Layout** — modules (add, rename, hide, order; a module with no areas shows as "Coming soon"), then per module: rename, reorder, hide or move areas and tools,
  add areas, move areas between modules. Collapsible list with search. Limits: 8 areas per module, 6 tools per area.
  "Save to this browser" changes only your browser. "Export layout.json" gives a file for the whole team.
  A save bar stays at the top while there are unsaved changes, and a preview shows the module's areas as they will appear.
- **Sign-in & audit** — client id/secret and audit webhook for this browser; status: configured / not configured / needs attention.
- **API explorer** — see above: test, edit, turn off and download any endpoint; send a GET to any Beeforce path.
- **API endpoints** — every Beeforce call the tools make (method + path), editable as a table. "Import Postman collection" (v2.1)
  checks a collection against the registry: matched (green), check (amber), missing (red — keeps the current URL),
  and file requests that don't fit. Only invalid edits block "Apply & Save". "Download endpoints.json" gives the team file.

Settings are merged in this order: built-in defaults → team files in the repo (`layout.json`, `endpoints.json`) → this browser.
To change the team default, export the file from Admin Settings and commit it next to `index.js`.

## Files

- `loader.js` → `index.js` (area / tool list) → `core/*` (shell, engine, UI kit, Excel, API, audit) → `modules/<tool>.js` (loaded when opened).
- `config.js` — environments, sign-in client id (not the secret), admin console login hash, library URLs. No secrets.
- `layout.json`, `endpoints.json` — team defaults for modules/areas/tools and API endpoints (empty = built-in).
- `core/endpoints.js` — the endpoint registry: every API call, once.
- `PORTING.md` — how tools are built on the shared engine.

Pushing to the repository updates everyone on their next click (files are fetched fresh each time).
