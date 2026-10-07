# APIary (v3.2)

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

Open app.beeforce.in (or UAT), click the bookmark, sign in, choose a module, pick an area, then a tool. `Ctrl K` finds
any tool in any module, arrow keys move between hexagons, `Esc` goes back one level. Closing the overlay keeps you signed in for the rest of the 120-minute
session; clicking the bookmark again in that session goes straight back to your module.

- **Module page** (after sign-in): Attendance, Onboarding, Core. A module without tools yet shows "Coming soon".
  The chosen module becomes the centre cell of its honeycomb: name, minutes left in the session, and "Switch module"
  (click it to come back to the module page). The top-left pill also switches module.
  Tick **"Skip this page next time and open the module I choose"** to go straight to your module at sign-in.
- **Keyboard:** arrow keys move between hexagons, `Enter` opens, `Esc` goes back one level (tool → area → module →
  module page), `Ctrl K` searches.
- **Motion:** cells flow like liquid while they move and settle into crisp hexagons; the one under the pointer tilts
  toward you. Turning on "reduce motion" in Windows / macOS turns these effects off.
- **Views** (top bar): Honeycomb (default), Gallery, Cards, List. The last one you pick is remembered in this browser.
- **Theme** (moon / sun icon): dark, light, or follow your system. Remembered in this browser.

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
with the same password. That adds the Settings area and a **Developer** button on every tool: its endpoints, a
"Send GET" button with the response body, **Copy cURL** (token hidden as `$BEEFORCE_TOKEN`; "cURL with token" asks
first) and a Postman download. Writes are never sent from the Developer panel. Unlock lasts until sign-out or tab close.

Only a hash of the password is stored. This runs in the browser and config.js is public, so it keeps people out of
the screens but is not server-grade security; the real lock is who can commit to the GitHub repository.

- **Layout** — modules (add, rename, hide, order; a module with no areas shows as "Coming soon"), then per module: rename, reorder, hide or move areas and tools,
  add areas, move areas between modules. Collapsible list with search. Limits: 8 areas per module, 6 tools per area.
  "Save to this browser" changes only your browser. "Export layout.json" gives a file for the whole team.
- **Sign-in & audit** — client id/secret and audit webhook for this browser; status: configured / not configured / needs attention.
- **API endpoints** — every Beeforce call the tools make (method + path), editable. "Import Postman collection" (v2.1)
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
