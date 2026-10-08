/* core/shell.js — the honeycomb shell: sign-in, module page, home comb, area bloom, tool trail, palette.
 *
 * Every hex on screen is one absolutely positioned button. Moving between levels only changes
 * each cell's transform/opacity, so CSS animates everything (staggered), and cells never re-mount.
 * While cells move, the stage gets a "liquid" SVG filter (cells stretch and bridge into each other);
 * it fades out when they settle, so at rest the hexagons are crisp. Hovered cells tilt toward the pointer.
 *
 *   modules: one big tile per module (Attendance, Onboarding, Core …); modules without areas say "Coming soon".
 *            The chosen tile flows into the centre and becomes the hub.
 *   home  : hub (module name, minutes left, "Switch module") in the middle, 8 areas around it
 *   area  : chosen area moves to the centre, its tools bloom into the ring,
 *           hub + other areas shrink into a mini-map on the left
 *   tool  : hub / area / tool fold into a vertical trail on the left, the workspace slides in
 */
'use strict';

var U = ctx.U, h = U.h, UI = ctx.UI, Api = ctx.Api;
var AREAS = ctx.AREAS, TOOLS = ctx.TOOLS;
var BW = 176, BH = Math.round(BW * 1.1547); // base cell size; real size via scale
var SIDE = 320;
var LEVEL1 = [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [2, -1], [-2, 1], [1, 1]]; // 9th slot = Settings (admins)
var RING = [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]];
var MODW = 260;        // base size of a module tile
var CORNER = 0.07;     // hexagon corner rounding (share of the width)

/* Pointy-top hexagon with rounded corners as an SVG path, for clip-path: path(). */
function hexPath(w, hh, inset) {
  inset = inset || 0;
  var r = w * CORNER, x0 = inset, y0 = inset, W = w - inset * 2, H = hh - inset * 2;
  var v = [[x0 + W / 2, y0], [x0 + W, y0 + H / 4], [x0 + W, y0 + 3 * H / 4], [x0 + W / 2, y0 + H], [x0, y0 + 3 * H / 4], [x0, y0 + H / 4]];
  var d = '';
  for (var i = 0; i < 6; i++) {
    var p = v[i], a = v[(i + 5) % 6], b = v[(i + 1) % 6];
    var la = Math.hypot(a[0] - p[0], a[1] - p[1]), lb = Math.hypot(b[0] - p[0], b[1] - p[1]);
    d += (i ? 'L' : 'M') + (p[0] + (a[0] - p[0]) * r / la).toFixed(2) + ' ' + (p[1] + (a[1] - p[1]) * r / la).toFixed(2) +
      'Q' + p[0].toFixed(2) + ' ' + p[1].toFixed(2) + ' ' + (p[0] + (b[0] - p[0]) * r / lb).toFixed(2) + ' ' + (p[1] + (b[1] - p[1]) * r / lb).toFixed(2);
  }
  return d + 'Z';
}

ctx.CSS += '\n' + [
  '.cell .hico{display:none}',
  '.cell.mini .hico{display:inline-flex}.cell.mini .ring{display:none}',
  '.cell.mini .ic{transform:scale(2.3)}',
  '.cell.mini:hover:not(.gone) .ic{transform:scale(2.5)}',
  '.cell.mini .face{padding:0}',
  '.cell.ghost{cursor:default}.cell.ghost.back{cursor:pointer}',
  '.cell.ghost:not(.back):hover .rim{background:var(--ghostrim);transform:none}.cell.ghost:not(.back):hover{filter:none}',
  '.cell.ghost:not(.back):hover .face{background:var(--well2)}',
  '.tip{position:absolute;z-index:9;padding:5px 10px;border-radius:8px;background:var(--panel3);border:1px solid var(--line2);font-size:12.5px;font-weight:600;pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .15s,transform .15s var(--ease);white-space:nowrap}',
  '.tip.on{opacity:1;transform:none}',
  '.areapane{padding-top:300px}',
  '.toolpane .sib{margin-top:350px}',
  '.loadcard{display:flex;align-items:center;gap:12px;color:var(--ink2)}',
  '.lfoot{margin-top:16px;color:var(--ink3);font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}',
  '.lcard.wide{width:min(620px,94vw)}',
  '.topgap{flex:1}',
  '.devbtn{display:none!important}.app.admin .devbtn{display:inline-flex!important}',
  '.menu.right{left:auto;right:0}',
  '.top .envpill{margin-left:0}',
  '.modwrap{position:relative}',
  '.modpill{display:flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;border:1px solid var(--line2);background:var(--panel);font-weight:700;font-size:13.5px;transition:border-color .15s,background .15s}',
  '.modpill:hover{border-color:var(--blue2);background:var(--panel2)}.modpill .ic{color:var(--blue3)}',
  '.menu{position:absolute;top:calc(100% + 8px);left:0;min-width:280px;background:var(--panel2);border:1px solid var(--line2);border-radius:14px;padding:6px;box-shadow:0 30px 60px -30px var(--shadow);z-index:30;animation:fadeup .18s var(--ease)}',
  '.menu button{width:100%;display:flex;gap:12px;align-items:flex-start;text-align:left;padding:10px 12px;border:0;background:none;border-radius:10px}',
  '.menu button:hover,.menu button.on{background:var(--panel3)}.menu button .ic{color:var(--blue3);margin-top:2px}',
  '.menu b{display:block}.menu span{font-size:12.5px;color:var(--ink2)}',
  '.viewsw{display:flex;gap:2px;padding:3px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}',
  '.viewsw button{width:32px;height:30px;border:0;border-radius:9px;background:none;color:var(--ink3);display:grid;place-items:center;transition:background .15s,color .15s}',
  '.viewsw button:hover{color:var(--ink)}.viewsw button[aria-pressed=true]{background:var(--bluebg);color:var(--blue3)}',
  '.gallery{position:absolute;left:320px;right:0;top:0;bottom:0;overflow:auto;padding:30px 40px 60px;z-index:6;opacity:0;pointer-events:none;transform:translateY(8px);transition:opacity .3s var(--ease),transform .35s var(--ease)}',
  '.gallery.on{opacity:1;pointer-events:auto;transform:none}',
  '.gpage{max-width:1180px}',
  '.gtitle{display:flex;align-items:baseline;gap:14px;margin-bottom:18px}.gtitle h2{margin:0;font-size:26px;letter-spacing:-.01em}',
  '.gsec,.ccard{animation:fadeup .35s var(--ease) both}',
  '.gsec{margin-bottom:26px;border-radius:16px;transition:box-shadow .4s}',
  '.gsh{display:flex;gap:12px;align-items:center;margin-bottom:12px}.gsh h3{margin:0;font-size:16px}.gsh p{margin:2px 0 0;color:var(--ink2);font-size:12.5px}',
  '.ggrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}',
  '.gtile{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:16px;border:1px solid var(--line);border-radius:16px;background:var(--panel);text-align:left;transition:transform .2s var(--ease),border-color .2s,box-shadow .2s}',
  '.gtile:hover,.gtile:focus-visible{transform:translateY(-3px);border-color:var(--blue2);box-shadow:0 14px 30px -18px var(--cellglow);outline:none}',
  '.gtile b{font-size:14.5px}.gtile span{font-size:12.5px;color:var(--ink2)}',
  '.ghex{width:40px;height:46px;clip-path:var(--hex);background:var(--bluebg);display:grid;place-items:center;color:var(--blue3);margin-bottom:4px;transition:transform .25s var(--ease)}',
  '.gtile:hover .ghex{transform:translateY(-2px) rotate(-6deg)}',
  '.cgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;align-items:start}',
  '.ccard{border:1px solid var(--line);border-radius:18px;background:var(--panel);padding:16px;transition:border-color .2s,box-shadow .4s}',
  '.ccard:hover{border-color:var(--line2)}',
  '.clist{display:grid;gap:4px}',
  '.crow{display:flex;align-items:center;gap:12px;padding:9px 10px;border:0;border-radius:12px;background:none;text-align:left;transition:background .15s}',
  '.crow:hover,.crow:focus-visible{background:var(--rowhover);outline:none}.crow div{flex:1;display:flex;flex-direction:column}.crow b{font-size:14px}.crow div span{font-size:12px;color:var(--ink2)}',
  '.crow>.ic:last-child{transform:rotate(180deg);color:var(--ink3);opacity:0;transition:opacity .15s,transform .2s}.crow:hover>.ic:last-child{opacity:1;transform:rotate(180deg) translateX(-3px)}',
  '.cic{width:30px;height:34px;clip-path:var(--hex);background:var(--toolface);display:grid;place-items:center;color:var(--blue3);flex:none}',
  '.lwrap{border:1px solid var(--line);border-radius:16px;background:var(--panel);overflow:hidden}',
  '.lsec{border-radius:0;transition:box-shadow .4s}',
  '.lsh{display:flex;align-items:center;gap:10px;padding:10px 16px;background:var(--panel2);border-bottom:1px solid var(--line);color:var(--blue3)}.lsh b{color:var(--ink)}.lsh>span:last-child{margin-left:auto;font-size:12px;color:var(--ink3)}',
  '.hexico{width:30px;height:34px;clip-path:var(--hex);background:var(--bluebg);display:grid;place-items:center;color:var(--blue3);flex:none}',
  '.lrow{width:100%;display:grid;grid-template-columns:34px minmax(160px,1fr) minmax(200px,2fr);align-items:center;gap:10px;padding:8px 16px;border:0;border-bottom:1px solid var(--line);background:none;text-align:left;transition:background .12s}',
  '.lrow:hover,.lrow:focus-visible{background:var(--rowhover);outline:none}.lrow .hint{color:var(--ink2);font-size:13px}.lrow .ar{color:var(--ink3);font-size:12px;text-align:right}',
  '.flash{box-shadow:0 0 0 2px var(--blue2)}',
  '.envpill.adm i{background:var(--honey);box-shadow:0 0 10px var(--honey)}',
  'pre.code{white-space:pre-wrap;word-break:break-all}',
  '.login{overflow:auto;padding:24px 0}',
  '.lcard code,.page code{font:12px ui-monospace,Consolas,monospace;color:var(--ink2);word-break:break-all}',
  /* liquid motion + 3D hover */
  '.stage.goo{filter:url(#bft-goo)}',
  '.cell .tl{width:100%;height:100%;transform:perspective(900px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg)) translateZ(var(--z,0px)) scale(var(--k,1));transition:transform .45s var(--spring)}',
  '.cell:hover:not(.gone) .tl,.cell:focus-visible .tl{--z:42px;--k:1.05;transition:transform .3s var(--spring)}',
  '.cell.mini:hover:not(.gone) .tl{--z:0px;--k:1.12}',
  '.cell.ghost:not(.back):hover .tl{--z:0px;--k:1}',
  '.cell.nope .tl{animation:nope .45s var(--ease)}',
  '@keyframes nope{20%{translate:-8px 0}40%{translate:7px 0}60%{translate:-4px 0}80%{translate:2px 0}}',
  /* hub = the module */
  '.cell.hub .hn{font-size:19px;font-weight:800;letter-spacing:-.015em;color:var(--honeyink)}',
  '.cell.hub .hs{font-size:12.5px;color:var(--honeyink2)}.cell.hub .hs b{font-weight:800;color:var(--honeyink)}.cell.hub .hs.low b{color:#B4232F}',
  '.cell.hub .hw{font-size:11.5px;font-weight:600;color:var(--honeyink2)}',
  '.cell.hub .face{gap:3px}',
  /* module page */
  '.side{transition:opacity .35s var(--ease),transform .45s var(--ease)}.side.off{opacity:0;transform:translateX(-16px);pointer-events:none}',
  '.modhead{position:absolute;left:0;right:0;top:6vh;text-align:center;z-index:7;pointer-events:none;padding:0 20px;transition:opacity .4s var(--ease),transform .55s var(--ease)}',
  '.modhead.off{opacity:0;transform:translateY(-14px)}',
  '.modhead h1{margin:0;font-size:38px;font-weight:800;letter-spacing:-.025em}.modhead p{margin:8px 0 0;color:var(--ink2);font-size:15px}',
  '.modfoot{position:absolute;left:0;right:0;bottom:5vh;display:flex;flex-direction:column;align-items:center;gap:8px;z-index:7;transition:opacity .4s var(--ease),transform .55s var(--ease)}',
  '.modfoot.off{opacity:0;transform:translateY(12px);pointer-events:none}',
  '.modfoot .check{padding:8px 14px;border:1px solid var(--line);border-radius:999px;background:var(--panel)}',
  '.keyhint{font-size:12px;color:var(--ink3);display:flex;flex-wrap:wrap;gap:4px 12px}.keyhint span{white-space:nowrap}.modfoot .keyhint{justify-content:center}.keyhint kbd{font:600 11px ui-monospace,Consolas,monospace;padding:1px 5px;border:1px solid var(--line2);border-radius:5px;color:var(--ink2)}',
  '.cell.mod .face{background:var(--modface);gap:8px;padding:0 40px}',
  '.cell.mod .nm{font-size:23px;font-weight:800;letter-spacing:-.01em}',
  '.cell.mod .ds{font-size:13px;color:var(--ink2);line-height:1.4;transition:color .2s}',
  '.cell.mod .ic{color:var(--blue3)}',
  '.cell.mod .mpill{margin-top:4px;font-size:12px;font-weight:700;padding:4px 11px;border-radius:999px;background:var(--bluebg);color:var(--blue3);transition:background .2s,color .2s}',
  '.cell.mod.soon{cursor:not-allowed}.cell.mod.soon .mpill{background:var(--chipbg);color:var(--ink2)}',
  '.cell.mod.soon .face>*{opacity:.6;transition:opacity .2s}',
  '.cell.mod:hover:not(.gone) .face,.cell.mod:focus-visible .face{background:var(--honeygrad)}',
  '.cell.mod:hover:not(.gone) .face>*,.cell.mod:focus-visible .face>*{opacity:1}',
  '.cell.mod:hover:not(.gone) .nm,.cell.mod:hover:not(.gone) .ic,.cell.mod:focus-visible .nm,.cell.mod:focus-visible .ic{color:var(--honeyink)}',
  '.cell.mod:hover:not(.gone) .ds,.cell.mod:focus-visible .ds{color:var(--honeyink2)}',
  '.cell.mod:hover:not(.gone) .mpill,.cell.mod:focus-visible .mpill{background:#2A1A0024;color:var(--honeyink)}'
].join('\n');

var VIEWS = [['honeycomb', 'hexgrid', 'Honeycomb'], ['gallery', 'cards', 'Gallery'], ['cards', 'layers', 'Cards'], ['list', 'list', 'List']];
var S = { level: 'login', area: null, tool: null, module: null, view: 'honeycomb' }; // level: login | modules | home | area | tool
var R = {};            // element refs
var cells = {};        // id -> cell element
var views = {};        // tool id -> workspace element (kept so work in progress survives navigation)

// areaOf looks across all modules; areaById only in the current module (what the honeycomb shows).
function areaOf(toolId) { return (ctx.AREAS || []).filter(function (a) { return (a.allTools || a.tools).indexOf(toolId) >= 0; })[0]; }
function anyAreaById(id) { return (ctx.AREAS || []).filter(function (a) { return a.id === id; })[0]; }
function moduleById(id) { return (ctx.MODULES || []).filter(function (m) { return m.id === id; })[0]; }
/* Current module's areas (+ the admin Settings area, which belongs to every module). */
function scope() {
  var mods = ctx.MODULES || [];
  if (!mods.some(function (m) { return m.id === S.module; })) {
    var saved = U.store.get('module', '');
    S.module = (mods.filter(function (m) { return m.id === saved; })[0] || mods[0] || {}).id || null;
  }
  AREAS = ctx.AREAS.filter(function (a) { return !S.module || a.module === S.module || a.module === '*'; });
  var v = U.store.get('view', 'honeycomb');
  S.view = VIEWS.some(function (x) { return x[0] === v; }) ? v : 'honeycomb';
}
function areaById(id) { return AREAS.filter(function (a) { return a.id === id; })[0]; }
function initials(n) { n = String(n || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean); return ((n[0] || '?')[0] + ((n[1] || '')[0] || '')).toUpperCase(); }

/* ---------------- theme (dark / light / system, remembered per browser) ---------------- */
var Theme = {
  pref: function () { var v = U.store.get('theme', 'dark'); return ['dark', 'light', 'system'].indexOf(v) >= 0 ? v : 'dark'; },
  resolved: function () { var p = this.pref(); return p === 'system' ? (window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : p; },
  apply: function () {
    if (!ctx.appEl) return;
    ctx.appEl.setAttribute('data-theme', this.resolved());
    Array.prototype.forEach.call(ctx.root.querySelectorAll('.themebtn'), function (b) { Theme.paint(b); });
  },
  next: function () { var order = ['dark', 'light', 'system']; U.store.set('theme', order[(order.indexOf(this.pref()) + 1) % 3]); this.apply(); UI.toast({ dark: 'Dark mode', light: 'Light mode', system: 'Follows your system setting' }[this.pref()]); },
  paint: function (b) { var p = this.pref(); U.swap(b, U.icon(p === 'dark' ? 'moon' : p === 'light' ? 'sun' : 'monitor', 18)); b.title = 'Theme: ' + p + ' (click to change)'; b.setAttribute('aria-label', b.title); },
  button: function () { var b = h('button.iconbtn.themebtn', { type: 'button', onclick: function () { Theme.next(); } }); this.paint(b); return b; }
};
if (window.matchMedia) try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { if (Theme.pref() === 'system') Theme.apply(); }); } catch (e) {}

/* ---------------- mount ---------------- */
function mount() {
  var host = h('div#bft-host');
  document.body.appendChild(host);
  var root = host.attachShadow({ mode: 'open' });
  R.style = h('style', ctx.CSS);
  root.appendChild(R.style);
  // Tools loaded later add their own styles here (once per key).
  var added = {};
  ctx.addCSS = function (key, css) { if (added[key]) return; added[key] = 1; R.style.textContent += '\n' + css; };
  var app = h('div.app');
  root.appendChild(app);
  ctx.host = host; ctx.root = root; ctx.appEl = app;
  Theme.apply();
  R.toasts = h('div.toasts');
  app.appendChild(R.toasts);
  requestAnimationFrame(function () { app.classList.add('in'); });
  return app;
}

/* ---------------- login ---------------- */
function showLogin(msg, forceSetup) {
  S.level = 'login';
  var app = ctx.appEl;
  Array.prototype.slice.call(app.children).forEach(function (c) { if (c !== R.toasts) c.remove(); });
  R.toolbar = null;

  var env = U.store.get('env', 'production');
  var deco = h('div.lhex');
  [[0.14, 0.2, ''], [0.22, 0.42, 'b'], [0.08, 0.62, ''], [0.8, 0.18, ''], [0.88, 0.4, 'y'], [0.74, 0.62, 'b'], [0.9, 0.8, ''], [0.18, 0.84, '']].forEach(function (p, i) {
    var el = h('i' + (p[2] ? '.' + p[2] : ''));
    el.style.left = 'calc(' + (p[0] * 100) + '% - 75px)';
    el.style.top = 'calc(' + (p[1] * 100) + '% - 86px)';
    el.style.transition = 'transform 1.2s var(--ease), opacity 1.2s';
    el.style.transform = 'scale(.6) rotate(-8deg)'; el.style.opacity = '0';
    setTimeout(function () { el.style.transform = ''; el.style.opacity = ''; }, 60 + i * 70);
    deco.appendChild(el);
  });

  var segP = h('button', { type: 'button', 'aria-pressed': env === 'production' ? 'true' : 'false' }, h('i'), 'Production');
  var segU = h('button.u', { type: 'button', 'aria-pressed': env === 'uat' ? 'true' : 'false' }, h('i'), 'UAT');
  [segP, segU].forEach(function (b, i) { b.onclick = function () { env = i ? 'uat' : 'production'; segP.setAttribute('aria-pressed', String(!i)); segU.setAttribute('aria-pressed', String(!!i)); }; });

  var user = UI.input({ placeholder: 'Beeforce username', value: U.store.get('user', '') });
  user.autocomplete = 'username';
  var pass = UI.input({ type: 'password', placeholder: 'Password' });
  pass.autocomplete = 'current-password';
  var eye = h('button', { type: 'button', title: 'Show password', 'aria-label': 'Show password' }, U.icon('eye', 18));
  eye.onclick = function () { pass.type = pass.type === 'password' ? 'text' : 'password'; pass.focus(); };
  var err = h('div.err', msg || '');
  var go = h('button.btn.primary', { type: 'submit', style: { width: '100%', marginTop: '4px' } }, h('span', 'Sign in'));

  var form = h('form', { novalidate: true },
    h('div.brand', h('div.mark'), 'APIary'),
    h('h2', 'Sign in'),
    h('p.muted', { style: { margin: 0 } }, 'Use your Beeforce admin account. Pick where the changes should go.'),
    h('div.seg', segP, segU),
    UI.field('Username', user),
    UI.field('Password', h('div.pw', pass, eye)),
    err, go,
    h('div.lfoot', h('span', 'v' + ctx.CONFIG.VERSION), auditBadge(),
      h('button.linkbtn', { type: 'button', onclick: function () { openSetup(false); } }, 'Sign-in & audit setup')));
  form.addEventListener('submit', async function (e) {
    e.preventDefault();
    err.textContent = '';
    if (!user.value.trim() || !pass.value) { err.textContent = 'Enter your username and password.'; return; }
    go.disabled = true; U.swap(go, h('span.spin'), h('span', 'Signing in…'));
    try {
      // Admin console login (separate credentials from config.js; never sent anywhere).
      var adm = await ctx.AdminLogin.check(user.value, pass.value);
      if (adm === 'bad-password') { var be = new Error('Wrong admin console password.'); throw be; }
      if (adm === 'setup') { pass.value = ''; go.disabled = false; U.swap(go, h('span', 'Sign in')); openAdminSetup(); return; }
      if (adm === 'ok') {
        pass.value = '';
        ctx.adminConsole = true;
        Api.state.user = ctx.AdminLogin.username() || 'admin'; Api.state.env = null; Api.state.token = null;
        ctx.Audit.startSession('Admin console', 'Admin console (' + location.host + ')');
        R.login.style.transition = 'opacity .35s var(--ease), transform .45s var(--ease)';
        R.login.style.opacity = '0'; R.login.style.transform = 'scale(.98)';
        setTimeout(function () { buildMain(true); }, U.reducedMotion() ? 0 : 280);
        return;
      }
      await Api.signIn(env, user.value.trim(), pass.value);
      U.store.set('env', env); U.store.set('user', user.value.trim());
      ctx.Audit.startSession(user.value.trim(), Api.envLabel());
      R.login.style.transition = 'opacity .35s var(--ease), transform .45s var(--ease)';
      R.login.style.opacity = '0'; R.login.style.transform = 'scale(.98)';
      setTimeout(function () { buildMain(true); }, U.reducedMotion() ? 0 : 280);
    } catch (ex) {
      U.swap(err, ex.message);
      if (ex.code === 'NO_CLIENT' || ex.code === 'BAD_CLIENT') err.appendChild(h('div', h('button.linkbtn', { type: 'button', onclick: function () { openSetup(false); } }, 'Check the sign-in client setup →')));
      go.disabled = false; U.swap(go, h('span', 'Sign in'));
      form.animate && !U.reducedMotion() && form.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 });
    }
  });
  var close = h('div', { style: { position: 'absolute', right: '20px', top: '18px', display: 'flex', gap: '6px' } }, Theme.button(),
    h('button.iconbtn', { type: 'button', title: 'Close', onclick: hide }, U.icon('x', 18)));
  var card = h('div.lcard', form);
  R.login = h('div.login', deco, card, close);
  app.insertBefore(R.login, R.toasts);

  // Setup card swaps in place of the sign-in card (first run, or from the link).
  function openAdminSetup() {
    card.classList.add('wide');
    U.swap(card, adminLoginPanel({ onBack: backToLogin })); restart(card);
  }
  function backToLogin() { card.classList.remove('wide'); U.swap(card, form); restart(card); }
  function openSetup(first) {
    var panel = secretsPanel({ first: first, onSkip: first && ctx.AdminLogin.username() ? backToLogin : null, onDone: function () { card.classList.remove('wide'); U.swap(card, form); restart(card); U.swap(form.querySelector('.lfoot'), h('span', 'v' + ctx.CONFIG.VERSION), auditBadge(), h('button.linkbtn', { type: 'button', onclick: function () { openSetup(false); } }, 'Sign-in & audit setup')); setTimeout(function () { (user.value ? pass : user).focus(); }, 50); } });
    card.classList.add('wide');
    U.swap(card, panel); restart(card);
  }
  if (forceSetup || !ctx.Secrets.hasClient()) openSetup(true);
  else setTimeout(function () { (user.value ? pass : user).focus(); }, 50);
}
function restart(el) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }

/* Small status chip for the audit webhook in this browser. */
function auditBadge() {
  var st = ctx.Secrets.auditState();
  var map = { configured: ['ok', 'Audit on'], unconfirmed: ['ok', 'Audit on (unconfirmed)'], 'not-configured': ['', 'Audit off in this browser'], failed: ['bad', 'Audit needs attention'] };
  var m = map[st] || map['not-configured'];
  return UI.chip(m[1], m[0]);
}

/* Sign-in client + audit webhook form. Used on first run, from the sign-in card, and in Admin Settings.
 * o: { first, onDone(saved), inSettings } */
function secretsPanel(o) {
  o = o || {};
  var cur = ctx.Secrets.get();
  var cid = UI.input({ value: cur.clientId, placeholder: 'admin-client' });
  var sec = UI.input({ type: 'password', placeholder: cur.clientSecret ? 'Saved — leave blank to keep (' + ctx.Secrets.mask(cur.clientSecret) + ')' : 'Client secret' });
  sec.autocomplete = 'off';
  var eye = h('button', { type: 'button', title: 'Show', 'aria-label': 'Show secret' }, U.icon('eye', 18));
  eye.onclick = function () { sec.type = sec.type === 'password' ? 'text' : 'password'; };
  var hook = UI.input({ placeholder: 'https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…' });
  hook.autocomplete = 'off';
  var hookNow = h('div.small.muted', cur.webhookUrl ? ['Saved: ', h('code', ctx.Secrets.maskUrl(cur.webhookUrl)), ' · ', auditBadge()] : 'Not set — audit messages will not be sent from this browser.');
  var testOut = h('div.small');
  var err = h('div.err');
  var testState = null;

  var testBtn = UI.btn('Send test', { sm: true, icon: 'play', onClick: async function () {
    err.textContent = '';
    var url = hook.value.trim() || cur.webhookUrl;
    if (!url) { U.swap(testOut, 'Paste a webhook link first.'); return; }
    U.swap(testOut, h('span.spin'), ' Sending…');
    var r = await ctx.Secrets.testWebhook(url, Api.state.user || U.store.get('user', ''));
    testState = { url: url, state: r.state };
    if (!hook.value.trim() && cur.webhookUrl) { ctx.Secrets.set({ webhookUrl: cur.webhookUrl, webhookState: r.state, webhookCheckedAt: Date.now() }); refreshNow(); }
    U.swap(testOut, UI.chip(r.state === 'ok' ? 'Delivered' : r.state === 'unconfirmed' ? 'Sent — check Chat' : 'Failed', r.state === 'failed' ? 'bad' : 'ok'), ' ', r.msg);
  } });
  var clearHook = UI.btn('Remove webhook', { sm: true, kind: 'quiet', icon: 'trash', onClick: function () { ctx.Secrets.clear('webhook'); cur = ctx.Secrets.get(); refreshNow(); UI.toast('Audit webhook removed from this browser.'); } });
  function refreshNow() { cur = ctx.Secrets.get(); U.swap(hookNow, cur.webhookUrl ? ['Saved: ', h('code', ctx.Secrets.maskUrl(cur.webhookUrl)), ' · ', auditBadge()] : 'Not set — audit messages will not be sent from this browser.'); clearHook.hidden = !cur.webhookUrl; }
  clearHook.hidden = !cur.webhookUrl;

  [cid, sec, hook].forEach(function (i) { i.addEventListener('input', function () { err.textContent = ''; }); });
  var save = h('button.btn.primary', { type: 'submit' }, h('span', o.first ? 'Save and continue' : 'Save'));
  var form = h('form', { novalidate: true },
    o.inSettings ? null : h('div.brand', h('div.mark'), 'APIary'),
    o.inSettings ? null : h('h2', o.first ? 'Set up this browser' : 'Sign-in & audit setup'),
    o.inSettings ? null : h('p.muted', { style: { margin: '0 0 14px' } }, o.first ? 'One-time setup for ' + location.host + '. Ask your APIary admin for these values.' : 'Settings saved in this browser for ' + location.host + '.'),
    h('div.label', { style: { marginTop: 0 } }, 'Sign-in client'),
    h('div.grid2', UI.field('Client id', cid), UI.field('Client secret', h('div.pw', sec, eye))),
    h('div.label', 'Audit webhook (optional)'),
    UI.field('Google Chat webhook link', hook),
    hookNow,
    h('div.row', { style: { margin: '8px 0 4px' } }, testBtn, clearHook),
    testOut,
    UI.note('warn', 'Kept in this browser only', 'Values are stored on ' + location.host + ' in this browser profile. Scripts on this site, browser extensions and anyone using this profile can read them. Don\'t set this up on shared computers.'),
    err,
    h('div.acts', { style: { justifyContent: 'flex-end' } },
      !o.first && o.onDone ? h('button.btn.quiet', { type: 'button', onclick: function () { o.onDone(false); } }, o.inSettings ? 'Reset form' : 'Back to sign in') : null,
      o.onSkip ? h('button.btn.quiet', { type: 'button', onclick: o.onSkip }, 'Admin console sign-in') : null,
      save));
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    err.textContent = '';
    var id = cid.value.trim(), secret = sec.value, url = hook.value.trim();
    if (!id) { err.textContent = 'Enter the client id.'; return; }
    if (!secret && !cur.clientSecret) { err.textContent = 'Enter the client secret.'; return; }
    if (url && !ctx.Secrets.validWebhook(url)) { err.textContent = 'The webhook must be a Google Chat link: https://chat.googleapis.com/v1/spaces/…/messages?key=…&token=…'; return; }
    var patch = { clientId: id };
    if (secret) patch.clientSecret = secret;
    if (url) { patch.webhookUrl = url; if (testState && testState.url === url) { patch.webhookState = testState.state; patch.webhookCheckedAt = Date.now(); } }
    if (!ctx.Secrets.set(patch)) { err.textContent = 'This browser blocked saving (private window or storage disabled).'; return; }
    UI.toast(url ? 'Saved. Audit messages will go to the new webhook.' : 'Saved.');
    sec.value = ''; hook.value = ''; refreshNow();
    o.onDone && o.onDone(true);
  });
  return form;
}

/* ---------------- main shell ---------------- */
function buildMain(fromLogin) {
  var app = ctx.appEl;
  Array.prototype.slice.call(app.children).forEach(function (c) { if (c !== R.toasts) c.remove(); });
  cells = {};
  views = {};
  ctx.Layout.build();
  TOOLS = ctx.TOOLS;
  scope();

  var st = Api.state;
  R.crumb = h('div.crumb');
  R.env = ctx.adminConsole ? h('div.envpill.adm', h('i'), 'Admin console') : h('div.envpill' + (st.env === 'uat' ? '.uat' : ''), h('i'), Api.envLabel());
  var who = h('button.who', { type: 'button', title: 'Signed in as ' + st.user, 'aria-haspopup': 'menu', onclick: function (e) { e.stopPropagation(); userMenu(whoWrap); } }, h('div.av', initials(st.user)), h('span', st.user));
  var whoWrap = h('div.modwrap', who);
  R.modPill = h('div.modwrap');
  R.viewSw = h('div.viewsw', { role: 'group', 'aria-label': 'View' });
  var top = h('div.top',
    h('div.brand', h('div.mark'), 'APIary'),
    R.modPill, R.crumb, h('span.topgap'), R.viewSw, R.env, whoWrap,
    h('button.iconbtn', { type: 'button', title: 'Search tools (Ctrl K)', 'aria-label': 'Search tools', onclick: openPalette }, U.icon('search', 18)),
    Theme.button(),
    h('button.iconbtn', { type: 'button', title: 'Close (session stays signed in)', 'aria-label': 'Close', onclick: hide }, U.icon('x', 18)));

  R.homePane = h('div.sidepane');
  R.areaPane = h('div.sidepane.areapane.off');
  R.toolPane = h('div.sidepane.toolpane.off');
  R.side = h('div.side', R.homePane, R.areaPane, R.toolPane);
  R.stage = h('div.stage');
  R.peek = h('div.peek');
  R.tip = h('div.tip');
  R.work = h('div.work');
  R.gallery = h('div.gallery');
  R.modHead = h('div.modhead.off', h('h1', 'Choose a module'), h('p'));
  // "Remember my module": skip this page at sign-in and open the module chosen here (the hub still brings you back)
  var skip = UI.check('Skip this page next time and open the module I choose', !!U.store.get('skipModules', false));
  skip.input.addEventListener('change', function () { U.store.set('skipModules', skip.input.checked); UI.toast(skip.input.checked ? 'Next sign-in opens your module directly. Click the centre cell to come back here.' : 'The module page will show after every sign-in.'); });
  R.modFoot = h('div.modfoot.off', skip, keyHint());
  // the liquid filter (blur + alpha threshold); its blur is animated by flow()
  var defs = h('div', { style: { position: 'absolute', width: '0', height: '0', overflow: 'hidden' }, 'aria-hidden': 'true' });
  defs.innerHTML = '<svg width="0" height="0"><filter id="bft-goo" filterUnits="userSpaceOnUse" x="-2000" y="-2000" width="8000" height="8000" color-interpolation-filters="sRGB">' +
    '<feGaussianBlur in="SourceGraphic" stdDeviation="0" result="b"/><feColorMatrix in="b" mode="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 24 -11" result="g"/>' +
    '<feComposite in="SourceGraphic" in2="g" operator="atop"/></filter></svg>';
  R.blur = defs.querySelector('feGaussianBlur');
  R.body = h('div.body', defs, R.side, R.modHead, R.modFoot, R.stage, R.gallery, R.peek, R.tip, R.work);
  app.insertBefore(top, R.toasts);
  app.insertBefore(R.body, R.toasts);

  buildCells();
  drawModulePill(); drawViewSwitch(); markAdmin();
  drawHomePane();
  S.level = 'home'; S.area = null; S.tool = null;

  // first frame: everything gathered at the hub, then bloom out
  layout({ intro: true });
  // After sign-in: the module page. Re-opening the bookmark in the same session goes straight back to the module.
  var live = (ctx.MODULES || []).some(function (m) { return m.id === S.module; });
  var toModules = fromLogin && !ctx.adminConsole && (ctx.MODULE_LIST || []).length > 0 && !(U.store.get('skipModules', false) && live);
  var then = R.afterBuild; R.afterBuild = null;
  requestAnimationFrame(function () { requestAnimationFrame(function () {
    if (ctx.adminConsole) go('tool', 'settings', 'admin-settings');
    else if (then) go.apply(null, then);
    else go(toModules ? 'modules' : 'home');
  }); });
  tickSession();
}

function mkCell(id, cls, content, onClick, label, size) {
  var w = size || BW, hh = Math.round(w * 1.1547);
  var c = h('button.cell.' + cls, { type: 'button', 'aria-label': label || id, style: { width: w + 'px', height: hh + 'px' } },
    h('div.tl', h('div.rim', { style: { clipPath: 'path("' + hexPath(w, hh) + '")' } }, h('div.face', { style: { clipPath: 'path("' + hexPath(w - 3, hh - 3) + '")' } }, content))));
  c._bw = w; c._bh = hh;
  c.addEventListener('click', function (e) { if (!c.classList.contains('gone')) onClick && onClick(e); });
  c.addEventListener('mousemove', function (e) { tilt(c, e); });
  c.addEventListener('mouseleave', function () { untilt(c); });
  cells[id] = c;
  R.stage.appendChild(c);
  return c;
}

function buildCells() {
  // module tiles (module page)
  if (!ctx.adminConsole) (ctx.MODULE_LIST || []).forEach(function (m) {
    mkCell('m:' + m.id, 'mod' + (m.soon ? '.soon' : ''), [U.icon(m.icon, 30), h('div.nm', m.name), m.desc ? h('div.ds', m.desc) : null,
      h('div.mpill', m.soon ? 'Coming soon' : m.tools + (m.tools === 1 ? ' tool' : ' tools'))],
      function () { chooseModule(m); }, m.name + (m.soon ? ' (coming soon)' : ''), MODW);
  });
  // hub = the current module: its name, minutes left in the session, and the way back to the module page
  var mod = moduleById(S.module);
  var many = !ctx.adminConsole && (ctx.MODULE_LIST || []).length > 0;
  R.minEl = h('b', '—');
  R.minWrap = h('div.ct.hs', R.minEl, ' min left');
  var hub = mkCell('hub', 'hub', [U.icon(mod ? mod.icon : 'home', 22), h('div.nm.hn', mod ? mod.name : 'APIary'), R.minWrap, many ? h('div.ct.hw', 'Switch module') : null], function () {
    if (S.level === 'home') { if (many) go('modules'); else openPalette(); } else go('home');
  }, mod ? mod.name : 'Home');
  hub.querySelector('.ic').classList.add('hico');
  hub.title = many ? 'Switch module · Ctrl K to search' : 'Home · Ctrl K to search';
  hub.addEventListener('mouseenter', function () { if (S.level !== 'home' && S.level !== 'modules') showTip(hub, (mod ? mod.name + ' · ' : '') + 'Home'); });
  hub.addEventListener('mouseleave', hideTip);

  AREAS.forEach(function (a) {
    var c = mkCell('a:' + a.id, 'area', [U.icon(a.icon, 26), h('div.nm', a.name), h('div.ct', a.tools.length + (a.tools.length === 1 ? ' tool' : ' tools')),
      h('div.pips', a.tools.map(function () { return h('i'); }))], function () {
      if (S.level === 'area' && S.area === a.id) return;
      if (S.level === 'tool' && S.area === a.id) return go('area', a.id);
      go('area', a.id);
    }, a.name);
    c.addEventListener('mouseenter', function () { if (S.level === 'home') showPeek(a, c); else if (c.classList.contains('mini')) showTip(c, a.name); });
    c.addEventListener('mouseleave', function () { hidePeek(); hideTip(); });
    c.addEventListener('focus', function () { if (S.level === 'home') showPeek(a, c); });
    c.addEventListener('blur', hidePeek);

    a.tools.forEach(function (t) {
      var info = TOOLS[t];
      var tc = mkCell('t:' + t, 'tool', [U.icon(info.icon || a.icon, 24), h('div.nm', info.name), h('div.ht', info.hint)], function () {
        if (S.level === 'tool' && S.tool === t) return;
        go('tool', a.id, t);
      }, info.name);
      tc.addEventListener('mouseenter', function () { if (tc.classList.contains('mini')) showTip(tc, info.name); });
      tc.addEventListener('mouseleave', hideTip);
    });
  });
  // ghost slots (fill empty ring places); the first one is "All areas"
  for (var i = 0; i < 6; i++) {
    (function (i) {
      var g = mkCell('g:' + i, 'ghost', i === 0 ? [U.icon('back', 22), h('div.ct', 'All areas')] : [], function () { if (g.classList.contains('back')) go('home'); }, i === 0 ? 'All areas' : 'empty');
      if (i) g.tabIndex = -1;
    })(i);
  }
}

/* ---------------- geometry ---------------- */
function axial(q, r, w, gap, cx, cy) {
  return { x: cx + (w + gap) * (q + r / 2), y: cy + (w * 1.1547 * 0.75 + gap * 0.87) * r };
}
function place(id, x, y, w, o) {
  return { id: id, x: x, y: y, w: w, o: o == null ? 1 : o };
}

/* Module tiles live at the hub when they're not on screen, so the chosen one can flow into it (and back out). */
function computeLayout(opts) {
  var L = S.level === 'modules' ? modulesLayout() : levelLayout(opts);
  if (S.level !== 'modules') {
    var hb = L.hub;
    (ctx.MODULE_LIST || []).forEach(function (m) { var p = place('m:' + m.id, hb.x, hb.y, hb.w, 0); p.gone = 1; L['m:' + m.id] = p; });
  }
  return L;
}
function modulesLayout() {
  var W = R.body.clientWidth, H = R.body.clientHeight;
  var list = ctx.MODULE_LIST || [], n = list.length || 1, gap = 26;
  var tw = Math.max(150, Math.min(MODW, (W - 60) / n - gap, (H - 210) / 1.1547));
  var cx = W / 2, cy = Math.max(H / 2 + 40, 150 + tw * 0.58);
  var L = {}, at = { x: cx, y: cy };
  list.forEach(function (m, i) {
    var p = place('m:' + m.id, cx + (i - (n - 1) / 2) * (tw + gap), cy, tw);
    p.d = 80 + i * 90; L['m:' + m.id] = p;
    if (m.id === S.module) at = p;
  });
  // the hub waits, invisible, inside the current module's tile
  L.hub = place('hub', at.x, at.y, tw, 0); L.hub.gone = 1;
  Object.keys(cells).forEach(function (id) {
    if (L[id]) return;
    L[id] = place(id, at.x, at.y, tw * 0.3, 0); L[id].gone = 1;
  });
  return L;
}

function levelLayout(opts) {
  opts = opts || {};
  var W = R.body.clientWidth, H = R.body.clientHeight;
  var cx = SIDE + (W - SIDE) / 2, cy = H / 2;
  var L = {};
  var hubAt;

  if ((S.level === 'home' || opts.intro) && S.view !== 'honeycomb') {
    // Gallery / cards / list views: the honeycomb waits, gathered and invisible, at the centre.
    Object.keys(cells).forEach(function (id) { L[id] = place(id, cx, cy, 30, 0); L[id].gone = 1; });
    L.hub = place('hub', cx, cy, 170, 0); L.hub.gone = 1;
    return L;
  }
  if (S.level === 'home' || opts.intro) {
    var k = Math.min(1, (W - SIDE - 60) / 790, (H - 40) / 570);
    var w = 168 * k, gap = 16 * k;
    hubAt = { x: cx, y: cy };
    L.hub = place('hub', cx, cy, w);
    AREAS.forEach(function (a, i) {
      var p = axial(LEVEL1[i][0], LEVEL1[i][1], w, gap, cx, cy);
      L['a:' + a.id] = opts.intro ? place('a:' + a.id, cx, cy, w * 0.3, 0) : place('a:' + a.id, p.x, p.y, w);
      L['a:' + a.id].d = opts.intro ? 0 : 60 + i * 35;
      a.tools.forEach(function (t) { L['t:' + t] = place('t:' + t, p.x, p.y, w * 0.3, 0); L['t:' + t].gone = 1; });
    });
    for (var g = 0; g < 6; g++) { L['g:' + g] = place('g:' + g, cx, cy, w * 0.3, 0); L['g:' + g].gone = 1; }
    if (opts.intro) L.hub = place('hub', cx, cy, w * 0.6, 0);
    return L;
  }

  // mini-map (area level) or trail (tool level) for the hub + areas
  var area = areaById(S.area);
  if (S.level === 'area') {
    var k2 = Math.min(1, (W - SIDE - 60) / 600, (H - 40) / 560);
    var unit = 174 * k2, gap2 = 15 * k2;
    L['a:' + area.id] = place('a:' + area.id, cx, cy, 190 * k2);
    L['a:' + area.id].sel = 1;
    var slots = RING.map(function (q) { return axial(q[0], q[1], unit, gap2, cx, cy); });
    area.tools.forEach(function (t, i) {
      L['t:' + t] = place('t:' + t, slots[i].x, slots[i].y, 168 * k2);
      L['t:' + t].d = 140 + i * 55;
    });
    var gi = 0;
    for (var s = area.tools.length; s < 6; s++, gi++) {
      L['g:' + gi] = place('g:' + gi, slots[s].x, slots[s].y, 168 * k2, gi === 0 ? 1 : 0.55);
      L['g:' + gi].d = 140 + s * 55;
      if (gi === 0) L['g:' + gi].back = 1;
    }
    for (; gi < 6; gi++) { L['g:' + gi] = place('g:' + gi, cx, cy, 40, 0); L['g:' + gi].gone = 1; }
    // mini-map at top of the side panel
    var mcx = SIDE / 2, mcy = 150, mw = 46, mg = 5;
    L.hub = place('hub', mcx, mcy, mw); L.hub.mini = 1;
    AREAS.forEach(function (a, i) {
      var p = axial(LEVEL1[i][0], LEVEL1[i][1], mw, mg, mcx, mcy);
      if (a.id !== area.id) { L['a:' + a.id] = place('a:' + a.id, p.x, p.y, mw); L['a:' + a.id].mini = 1; L['a:' + a.id].d = i * 20; }
      else hubAt = p;
      a.tools.forEach(function (t) {
        if (a.id === area.id) return;
        L['t:' + t] = place('t:' + t, p.x, p.y, 10, 0); L['t:' + t].gone = 1;
      });
    });
    // tools of the open area start from the centre (bloom)
    return L;
  }

  // tool level: trail
  var tx = 70, ty = 72, step = 106, tw = 64;
  L.hub = place('hub', tx, ty, tw); L.hub.mini = 1;
  // A one-tool system area (Settings) has no step of its own: Home → tool.
  var skip = skipArea(area);
  if (skip) { L['a:' + area.id] = place('a:' + area.id, tx, ty, 20, 0); L['a:' + area.id].gone = 1; }
  else { L['a:' + area.id] = place('a:' + area.id, tx, ty + step, tw); L['a:' + area.id].mini = 1; L['a:' + area.id].sel = 1; L['a:' + area.id].d = 40; }
  L['t:' + S.tool] = place('t:' + S.tool, tx, ty + step * (skip ? 1 : 2), tw); L['t:' + S.tool].mini = 1; L['t:' + S.tool].cur = 1; L['t:' + S.tool].d = 80;
  AREAS.forEach(function (a) {
    if (a.id !== area.id) { L['a:' + a.id] = place('a:' + a.id, tx, ty + step, 20, 0); L['a:' + a.id].gone = 1; }
    a.tools.forEach(function (t) {
      if (t === S.tool) return;
      L['t:' + t] = place('t:' + t, tx, ty + step * 2, 20, 0); L['t:' + t].gone = 1;
    });
  });
  for (var g2 = 0; g2 < 6; g2++) { L['g:' + g2] = place('g:' + g2, tx, ty + step, 20, 0); L['g:' + g2].gone = 1; }
  return L;
}

function layout(opts) {
  opts = opts || {};
  var L = computeLayout(opts);
  var rm = U.reducedMotion();
  var maxD = 0;
  Object.keys(cells).forEach(function (id) {
    var c = cells[id], p = L[id];
    if (!p) return;
    maxD = Math.max(maxD, p.d || 0);
    c.style.transitionDelay = rm || opts.instant ? '0ms' : (p.d || 0) + 'ms';
    c.style.transform = 'translate(' + Math.round(p.x - c._bw / 2) + 'px,' + Math.round(p.y - c._bh / 2) + 'px) scale(' + (p.w / c._bw).toFixed(4) + ')';
    c.style.opacity = String(p.o);
    c.classList.toggle('gone', !!p.gone || p.o === 0);
    c.classList.toggle('mini', !!p.mini);
    c.classList.toggle('sel', !!p.sel);
    c.classList.toggle('cur', !!p.cur);
    c.classList.toggle('back', !!p.back);
    c.tabIndex = p.gone || p.o === 0 || (id.indexOf('g:') === 0 && !p.back) ? -1 : 0;
    c.setAttribute('aria-hidden', p.gone || p.o === 0 ? 'true' : 'false');
  });
  if (opts.instant) void R.stage.offsetWidth; // commit, so the next layout animates from here
  else if (!rm) { flow(maxD + 950); R.settleAt = Date.now() + maxD + 650; }
}

/* ---------------- liquid motion + hover tilt ---------------- */
var Goo = { v: 0, t: 0, run: false, timer: null };
function flow(ms) {
  if (!R.blur || U.reducedMotion()) return;
  Goo.t = 11; clearTimeout(Goo.timer);
  Goo.timer = setTimeout(function () { Goo.t = 0; }, ms);
  if (!Goo.run) { Goo.run = true; requestAnimationFrame(gooTick); }
}
function gooTick() {
  if (!R.blur || !R.blur.isConnected) { Goo.run = false; Goo.v = 0; return; }
  Goo.v += (Goo.t - Goo.v) * (Goo.t > Goo.v ? 0.35 : 0.1);
  if (Goo.t === 0 && Goo.v < 0.1) Goo.v = 0;
  R.blur.setAttribute('stdDeviation', Goo.v.toFixed(2));
  R.stage.classList.toggle('goo', Goo.v > 0.15);
  if (!Goo.v && !Goo.t) { Goo.run = false; return; }
  requestAnimationFrame(gooTick);
}
function tilt(c, e) {
  if (c.classList.contains('gone') || c.classList.contains('mini') || (c.classList.contains('ghost') && !c.classList.contains('back')) || U.reducedMotion()) return;
  var r = c.getBoundingClientRect();
  var fx = (e.clientX - r.left) / r.width - 0.5, fy = (e.clientY - r.top) / r.height - 0.5;
  c.style.setProperty('--ry', (fx * 14).toFixed(1) + 'deg');
  c.style.setProperty('--rx', (-fy * 14).toFixed(1) + 'deg');
}
function untilt(c) { c.style.removeProperty('--rx'); c.style.removeProperty('--ry'); }

/* ---------------- navigation ---------------- */
function go(level, areaId, toolId) {
  hidePeek(); hideTip(); closeMenus();
  if (level === 'modules' && !(ctx.MODULE_LIST || []).length) level = 'home';
  var prev = S.level;
  if (level === 'tool' && !areaId) areaId = areaOf(toolId).id;
  // A tool or area in another module: switch module first.
  var tgt = areaId ? anyAreaById(areaId) : null;
  if (tgt && tgt.module !== '*' && S.module && tgt.module !== S.module) { switchModule(tgt.module, true); prev = 'home'; }
  // Outside the honeycomb view there is no area level: show the module page and point at the area.
  var focusArea = null;
  if (level === 'area' && S.view !== 'honeycomb') { focusArea = areaId; level = 'home'; areaId = null; }
  // tools bloom from the centre of their area when entering an area from home
  if (level === 'area' && (prev === 'home' || S.area !== areaId)) {
    var a = areaById(areaId);
    var W = R.body.clientWidth, H = R.body.clientHeight;
    var cx = SIDE + (W - SIDE) / 2, cy = H / 2;
    a.tools.forEach(function (t) {
      var c = cells['t:' + t];
      c.style.transitionDelay = '0ms';
      c.style.transition = 'none';
      c.style.transform = 'translate(' + Math.round(cx - BW / 2) + 'px,' + Math.round(cy - BH / 2) + 'px) scale(.4)';
      c.style.opacity = '0';
      void c.offsetWidth;
      c.style.transition = '';
    });
  }
  S.level = level; S.area = areaId || null; S.tool = toolId || null;
  var onMods = level === 'modules';
  if (onMods) drawModHead();
  R.modHead.classList.toggle('off', !onMods);
  R.modFoot.classList.toggle('off', !onMods);
  R.side.classList.toggle('off', onMods);
  R.modPill.style.visibility = onMods ? 'hidden' : '';
  R.viewSw.style.visibility = onMods ? 'hidden' : '';
  layout();
  // keyboard focus must not stay on a cell that just went away (e.g. the module tile you clicked)
  var fe = ctx.root.activeElement;
  if (fe && fe.classList && fe.classList.contains('cell') && fe.classList.contains('gone')) fe.blur();
  drawCrumb();
  R.homePane.classList.toggle('off', level !== 'home');
  R.areaPane.classList.toggle('off', level !== 'area');
  R.toolPane.classList.toggle('off', level !== 'tool');
  if (level === 'area') drawAreaPane();
  if (level === 'tool') { drawToolPane(); openTool(toolId); }
  else R.work.classList.remove('on');
  if (level === 'home') drawHomePane();
  var flat = level === 'home' && S.view !== 'honeycomb';
  if (flat) drawGallery(focusArea);
  R.gallery.classList.toggle('on', flat);
}

/* ---------------- modules ---------------- */
function drawModHead() {
  var soon = (ctx.MODULE_LIST || []).filter(function (m) { return m.soon; }).map(function (m) { return m.name; });
  var names = soon.length > 1 ? soon.slice(0, -1).join(', ') + ' and ' + soon[soon.length - 1] : soon[0];
  R.modHead.querySelector('p').textContent = 'Signed in to ' + (Api.envLabel() || 'Beeforce') + '. ' +
    (soon.length ? names + (soon.length > 1 ? ' open' : ' opens') + ' once ' + (soon.length > 1 ? 'their' : 'its') + ' tools are added.' : 'Each module has its own honeycomb.');
}
function chooseModule(m) {
  var c = cells['m:' + m.id];
  if (m.soon) {
    if (c) { c.classList.remove('nope'); void c.offsetWidth; c.classList.add('nope'); }
    UI.toast(m.name + ' opens once its tools are added.');
    return;
  }
  if (m.id !== S.module) {
    // rebuild the comb for this module, parked on the module page, then let it flow out
    S.module = m.id; U.store.set('module', m.id);
    scope(); rebuildCells();
    layout({ instant: true });
    drawModulePill();
  }
  go('home');
}
function switchModule(id, silent) {
  if (!id || id === S.module) return;
  S.module = id; U.store.set('module', id);
  scope();
  rebuildCells();
  layout({ intro: true, instant: true });
  drawModulePill();
  if (!silent) go('home');
}
function rebuildCells() {
  Array.prototype.slice.call(R.stage.querySelectorAll('.cell')).forEach(function (c) { c.remove(); });
  cells = {};
  buildCells();
}
function closeMenus() { if (R.menu) { R.menu.remove(); R.menu = null; } }

/* User menu: admin unlock (inside a Beeforce session) and sign out. */
function userMenu(anchor) {
  if (R.menu) return closeMenus();
  var items = [];
  if (!ctx.adminConsole && ctx.AdminLogin.configured()) {
    items.push(ctx.adminUnlocked
      ? h('button', { type: 'button', onclick: function () { closeMenus(); lockAdmin(); } }, U.icon('key', 18), h('div', h('b', 'Lock admin tools'), h('span', 'Hide Settings and Developer panels')))
      : h('button', { type: 'button', onclick: function () { closeMenus(); unlockAdmin(); } }, U.icon('unlock', 18), h('div', h('b', 'Unlock admin tools'), h('span', 'Settings and Developer panels for this session'))));
  }
  items.push(h('button', { type: 'button', onclick: function () { closeMenus(); signOutAsk(); } }, U.icon('out', 18), h('div', h('b', 'Sign out'), h('span', ctx.adminConsole ? 'Leave the admin console' : 'Signed in as ' + Api.state.user))));
  R.menu = h('div.menu.right', { role: 'menu' }, items);
  anchor.appendChild(R.menu);
}
function unlockAdmin() {
  return UI.dialog(function (box, close) {
    var pass = UI.input({ type: 'password', placeholder: 'Admin password' }); pass.autocomplete = 'current-password';
    var err = h('div.err');
    var f = h('form', h('h2', 'Unlock admin tools'), h('p.muted', 'Enter the password of ' + ctx.AdminLogin.username() + '. Admin tools stay unlocked until you sign out or close this tab.'), UI.field('Password', pass), err,
      h('div.acts', h('button.btn.quiet', { type: 'button', onclick: function () { close(false); } }, 'Cancel'), h('button.btn.primary', { type: 'submit' }, 'Unlock')));
    f.addEventListener('submit', async function (e) {
      e.preventDefault(); err.textContent = '';
      var r = await ctx.AdminLogin.check(ctx.AdminLogin.username(), pass.value);
      pass.value = '';
      if (r !== 'ok') { err.textContent = 'Wrong admin password.'; return; }
      ctx.adminUnlocked = true;
      try { sessionStorage.setItem('bft.adminUnlock', '1'); } catch (x) {}
      close(true); relayout(); markAdmin(); UI.toast('Admin tools unlocked: Settings area and Developer panels.');
    });
    box.appendChild(f);
  });
}
/* Admin console → signed in to Beeforce from the API explorer: becomes a normal session with admin tools unlocked,
 * reopened on Admin Settings → API explorer. (Api.signIn has already stored the token.) */
function adminToBeeforce() {
  ctx.Audit.endSession('SWITCH');
  ctx.Audit.startSession(Api.state.user + ' (admin)', Api.envLabel());
  ctx.adminConsole = false; ctx.adminUnlocked = true;
  try { sessionStorage.setItem('bft.adminUnlock', '1'); } catch (x) {}
  ctx.ADMIN_TAB = 'explorer';
  R.afterBuild = ['tool', 'settings', 'admin-settings'];
  UI.toast('Signed in to ' + Api.envLabel() + ' as ' + Api.state.user + '. Admin tools stay unlocked.');
  buildMain(false);
}
function lockAdmin() {
  ctx.adminUnlocked = false;
  try { sessionStorage.removeItem('bft.adminUnlock'); } catch (x) {}
  if (S.tool === 'admin-settings') go('home');
  relayout(); markAdmin(); UI.toast('Admin tools locked.');
}
function drawModulePill() {
  if (!R.modPill) return;
  var mods = ctx.MODULES || [];
  var m = moduleById(S.module);
  if (!m) { U.clear(R.modPill); return; }
  var many = mods.length > 1;
  var btn = h('button.modpill', { type: 'button', title: many ? 'Switch module' : m.name, 'aria-haspopup': many ? 'menu' : null },
    U.icon(m.icon, 16), h('span', m.name), many ? U.icon('chev', 14) : null);
  if (many) btn.addEventListener('click', function (e) {
    e.stopPropagation();
    if (R.menu) return closeMenus();
    R.menu = h('div.menu', { role: 'menu' }, mods.map(function (x) {
      return h('button' + (x.id === S.module ? '.on' : ''), { type: 'button', role: 'menuitem', onclick: function () { closeMenus(); switchModule(x.id); } },
        U.icon(x.icon, 18), h('div', h('b', x.name), x.desc ? h('span', x.desc) : null));
    }));
    R.modPill.appendChild(R.menu);
  });
  U.swap(R.modPill, btn);
}

/* ---------------- views: honeycomb / gallery / cards / list (remembered per browser) ---------------- */
function drawViewSwitch() {
  if (!R.viewSw) return;
  R.viewSw.style.display = ctx.adminConsole ? 'none' : '';
  U.swap(R.viewSw, VIEWS.map(function (v) {
    return h('button', { type: 'button', title: v[2] + ' view', 'aria-label': v[2] + ' view', 'aria-pressed': S.view === v[0] ? 'true' : 'false', onclick: function () { setView(v[0]); } }, U.icon(v[1], 17));
  }));
}
function setView(v) {
  if (S.view === v) return;
  S.view = v; U.store.set('view', v);
  drawViewSwitch();
  if (S.level === 'area' || S.level === 'home') go('home');
}
function toolTile(a, t, kind) {
  var info = TOOLS[t];
  var open = function () { go('tool', a.id, t); };
  if (kind === 'gallery') return h('button.gtile', { type: 'button', onclick: open, title: info.hint },
    h('div.ghex', U.icon(info.icon || a.icon, 22)), h('b', info.name), h('span', info.hint));
  if (kind === 'cards') return h('button.crow', { type: 'button', onclick: open },
    h('span.cic', U.icon(info.icon || a.icon, 17)), h('div', h('b', info.name), h('span', info.hint)), U.icon('back', 14));
  return h('button.lrow', { type: 'button', onclick: open },
    h('span.cic', U.icon(info.icon || a.icon, 16)), h('b', info.name), h('span.hint', info.hint));
}
function drawGallery(focusArea) {
  var kind = S.view;
  var list = AREAS.filter(function (a) { return a.tools.length; });
  var body;
  if (kind === 'gallery') {
    body = list.map(function (a, i) {
      return h('section.gsec', { 'data-area': a.id, style: { animationDelay: (i * 40) + 'ms' } },
        h('div.gsh', h('div.hexico', U.icon(a.icon, 18)), h('div', h('h3', a.name), h('p', a.desc))),
        h('div.ggrid', a.tools.map(function (t) { return toolTile(a, t, 'gallery'); })));
    });
  } else if (kind === 'cards') {
    body = h('div.cgrid', list.map(function (a, i) {
      return h('section.ccard', { 'data-area': a.id, style: { animationDelay: (i * 40) + 'ms' } },
        h('div.gsh', h('div.hexico', U.icon(a.icon, 18)), h('div', h('h3', a.name), h('p', a.desc))),
        h('div.clist', a.tools.map(function (t) { return toolTile(a, t, 'cards'); })));
    }));
  } else {
    body = h('div.lwrap', list.map(function (a) {
      return h('section.lsec', { 'data-area': a.id }, h('div.lsh', U.icon(a.icon, 16), h('b', a.name), h('span', a.tools.length + (a.tools.length === 1 ? ' tool' : ' tools'))),
        a.tools.map(function (t) { return toolTile(a, t, 'list'); }));
    }));
  }
  var m = moduleById(S.module);
  U.swap(R.gallery, h('div.gpage', h('div.gtitle', h('h2', m ? m.name : 'Tools'), h('span.muted', AREAS.reduce(function (n, a) { return n + a.tools.length; }, 0) + ' tools · ' + list.length + ' areas')), body));
  R.gallery.scrollTop = 0;
  if (focusArea) {
    var el = R.gallery.querySelector('[data-area="' + focusArea + '"]');
    if (el) { el.scrollIntoView({ block: 'start' }); el.classList.add('flash'); setTimeout(function () { el.classList.remove('flash'); }, 1200); }
  }
}

function back() {
  if (S.level === 'tool') go('area', S.area);
  else if (S.level === 'area') go('home');
  else if (S.level === 'home' && (ctx.MODULE_LIST || []).length) go('modules');
}

function drawCrumb() {
  if (S.level === 'modules') { U.clear(R.crumb); return; }
  var parts = [h('button', { type: 'button', onclick: function () { go('home'); } }, 'Home')];
  if (S.area && !(S.level === 'tool' && skipArea(areaById(S.area)))) { var a = areaById(S.area); parts.push(h('i', '›')); parts.push(S.level === 'area' ? h('b', a.name) : h('button', { type: 'button', onclick: function () { go('area', a.id); } }, a.name)); }
  if (S.tool) { parts.push(h('i', '›')); parts.push(h('b', TOOLS[S.tool].name)); }
  U.swap(R.crumb, parts);
}

/* ---------------- side panes ---------------- */
function recentList() { return U.store.get('recent', []).filter(function (t) { return TOOLS[t] && areaOf(t) && (!TOOLS[t].hidden || ctx.Layout.isAdmin()); }); }
function pushRecent(t) { var r = recentList().filter(function (x) { return x !== t; }); r.unshift(t); U.store.set('recent', r.slice(0, 5)); }

function drawHomePane() {
  var rec = recentList();
  var runs = U.store.get('runs', []).slice(0, 4);
  U.swap(R.homePane,
    h('h1', (moduleById(S.module) || {}).name || 'Configuration'),
    h('p', 'Pick ' + (S.view === 'honeycomb' ? 'an area, then a tool' : 'a tool') + '. Every change is shown for review before it is written to ' + (Api.envLabel() || 'Beeforce') + '.'),
    h('button.searchbtn', { type: 'button', onclick: openPalette }, U.icon('search', 18), 'Find a tool', h('kbd', 'Ctrl K')),
    S.view === 'honeycomb' ? h('div', { style: { marginTop: '10px' } }, keyHint()) : null,
    ctx.Secrets.auditState() === 'configured' ? null : h('div', { style: { marginTop: '12px' } }, auditBadge(),
      h('div.small.dim', { style: { marginTop: '4px' } }, ctx.Secrets.auditState() === 'not-configured' ? 'Audit events will not be sent from this browser.' : ctx.Secrets.auditState() === 'failed' ? 'The last webhook test failed. Audit may not be delivered.' : 'Webhook saved, delivery not confirmed.')),
    rec.length ? h('div.label', 'Recent') : null,
    rec.map(function (t) { var a = areaOf(t); return h('button.rec', { type: 'button', onclick: function () { go('tool', a.id, t); } }, TOOLS[t].name, h('span', a.name)); }),
    runs.length ? h('div.label', 'Last runs') : null,
    runs.length ? h('div.runs', runs.map(function (r) {
      return h('div', h('span', r.module), h('span', h('span.okc', r.ok + ' ok'), r.failed ? h('span.badc', ' · ' + r.failed + ' failed') : null, h('span.dim', ' · ' + ago(r.at))));
    })) : null);
}
function ago(t) { var m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'now' : m < 60 ? m + 'm ago' : m < 1440 ? Math.round(m / 60) + 'h ago' : Math.round(m / 1440) + 'd ago'; }

function drawAreaPane() {
  var a = areaById(S.area);
  U.swap(R.areaPane,
    h('h2', a.name),
    h('p', a.desc),
    a.tools.map(function (t) {
      var b = h('button.rec', { type: 'button', onclick: function () { go('tool', a.id, t); } }, TOOLS[t].name);
      b.addEventListener('mouseenter', function () { cells['t:' + t].classList.add('hl'); cells['t:' + t].dispatchEvent(new Event('bft-hl')); });
      b.addEventListener('mouseleave', function () { cells['t:' + t].classList.remove('hl'); });
      return b;
    }),
    h('div.spacer'),
    h('button.linkbtn', { type: 'button', onclick: function () { go('home'); } }, '← All areas'));
}

function skipArea(a) { return !!(a && a.system && a.tools.length === 1); }
function drawToolPane() {
  var a = areaById(S.area);
  var tx = 70, ty = 72, step = 106;
  var steps = skipArea(a) ? [['Home', 'home'], [TOOLS[S.tool].name, 'tool']] : [['Home', 'home'], [a.name, 'area'], [TOOLS[S.tool].name, 'tool']];
  var labels = steps.map(function (l, i) {
    var el = h('div.tl' + (i === steps.length - 1 ? '.cur' : ''), l[0]);
    el.style.left = (tx + 46) + 'px'; el.style.top = (ty + step * i) + 'px';
    el.style.transition = 'opacity .3s var(--ease) ' + (120 + i * 60) + 'ms, transform .4s var(--ease) ' + (120 + i * 60) + 'ms';
    el.style.opacity = '0'; el.style.transform = 'translate(-8px,-50%)';
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'translate(0,-50%)'; }); });
    return el;
  });
  var lines = steps.slice(1).map(function (x, i) { var ln = h('div.ln'); ln.style.top = (ty + step * i + 37) + 'px'; ln.style.height = (step - 74) + 'px'; return ln; });
  var trail = h('div.trail', lines, labels);
  trail.style.position = 'absolute'; trail.style.left = '0'; trail.style.top = '0'; trail.style.width = '100%';
  var sibs = a.tools.filter(function (t) { return t !== S.tool; });
  U.swap(R.toolPane, trail,
    h('div.sib',
      sibs.length ? h('div.label', 'More in ' + a.name) : null,
      sibs.map(function (t) { return h('button.rec', { type: 'button', onclick: function () { go('tool', a.id, t); } }, TOOLS[t].name); })));
  R.toolPane.style.padding = '0 30px 24px 36px';
}

/* ---------------- tool workspace ---------------- */
function openTool(id) {
  if (!TOOLS[id] || !areaOf(id)) { UI.toast('That tool is not available.', 'bad'); return go('home'); }
  pushRecent(id);
  ctx.Audit.onModuleOpen(TOOLS[id].name);
  var a = areaOf(id);
  R.work.classList.remove('on');
  var show = function (el) {
    Array.prototype.slice.call(R.work.children).forEach(function (c) { c.hidden = c !== el; });
    if (el.parentNode !== R.work) R.work.appendChild(el);
    el.hidden = false;
    R.work.scrollTop = el.__scroll || 0;
    void R.work.offsetWidth;
    setTimeout(function () { if (S.tool === id) R.work.classList.add('on'); }, U.reducedMotion() ? 0 : 180);
  };
  R.work.onscroll = function () { var v = views[S.tool]; if (v) v.__scroll = R.work.scrollTop; };
  if (views[id]) return show(views[id]);
  var page = h('div.page');
  views[id] = page;
  page.appendChild(h('div.card.loadcard', h('span.spin'), 'Opening ' + TOOLS[id].name + '…'));
  show(page);
  ctx.loadTool(id).then(function (def) {
    U.clear(page);
    var devBtn = id === 'admin-settings' || id === 'api-automation' ? null : UI.btn('Developer', { kind: 'quiet', icon: 'code', onClick: function () { return openDev(id); } });
    if (devBtn) devBtn.classList.add('devbtn');
    page.appendChild(UI.header({ area: a.name, title: TOOLS[id].name, desc: def.desc || TOOLS[id].hint, actions: [].concat(def.actions || [], devBtn ? [devBtn] : []) }));
    var body = h('div');
    page.appendChild(body);
    return def.render(body, { id: id, name: TOOLS[id].name, area: a });
  }).catch(function (e) {
    console.error(e);
    delete views[id];
    U.swap(page, UI.header({ area: a.name, title: TOOLS[id].name }), UI.note('bad', 'This tool could not open', e.message),
      UI.btn('Try again', { icon: 'retry', onClick: function () { page.remove(); openTool(id); } }));
  });
}

function openDev(id) { return ctx.loadTool('dev-panel').then(function (d) { d.open(id); }); }
function markAdmin() { if (ctx.appEl) ctx.appEl.classList.toggle('admin', ctx.Layout.isAdmin()); }

/* ---------------- hover peek + tips ---------------- */
function showPeek(a, cell) {
  if (Date.now() < (R.settleAt || 0)) return; // cells are still flowing under the pointer
  var r = cell.getBoundingClientRect(), b = R.body.getBoundingClientRect();
  U.swap(R.peek, h('b', a.name), h('p', a.desc), h('ul', a.tools.map(function (t) { return h('li', TOOLS[t].name); })), h('em', 'Click to open →'));
  var left = r.right - b.left + 14;
  if (left + 280 > b.width) left = r.left - b.left - 284;
  var top = Math.max(10, Math.min(r.top - b.top + r.height / 2 - 90, b.height - 260));
  R.peek.style.left = left + 'px'; R.peek.style.top = top + 'px';
  R.peek.classList.add('on');
}
function hidePeek() { R.peek && R.peek.classList.remove('on'); }
function showTip(cell, text) {
  var r = cell.getBoundingClientRect(), b = R.body.getBoundingClientRect();
  R.tip.textContent = text;
  R.tip.style.left = (r.right - b.left + 8) + 'px';
  R.tip.style.top = (r.top - b.top + r.height / 2 - 14) + 'px';
  R.tip.classList.add('on');
}
function hideTip() { R.tip && R.tip.classList.remove('on'); }

/* ---------------- palette (Ctrl K) ---------------- */
function openPalette() {
  if (S.level === 'login' || R.pal) return;
  var all = [];
  var admin = ctx.Layout.isAdmin();
  var manyMods = (ctx.MODULES || []).length > 1;
  ctx.AREAS.forEach(function (a) { (a.allTools || a.tools).forEach(function (t) { if (TOOLS[t] && (!TOOLS[t].hidden || admin)) all.push({ t: t, a: a, name: TOOLS[t].name, hint: TOOLS[t].hint + (TOOLS[t].hidden ? ' · hidden' : ''), where: (manyMods && moduleById(a.module) ? moduleById(a.module).name + ' · ' : '') + a.name }); }); });
  var q = UI.input({ placeholder: 'Search tools — e.g. "accrual set", "punch"' });
  var ul = h('ul', { role: 'listbox' });
  var cur = 0, shown = [];
  function draw() {
    var words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    shown = all.filter(function (x) { var s = (x.name + ' ' + x.hint + ' ' + x.where + ' ' + x.t).toLowerCase(); return words.every(function (w) { return s.indexOf(w) >= 0; }); });
    if (words.length) {
      var score = function (x) { var n = x.name.toLowerCase(), qq = words.join(' '); return n === qq ? 0 : n.indexOf(qq) === 0 ? 1 : n.indexOf(qq) >= 0 ? 2 : words.every(function (w) { return n.indexOf(w) >= 0; }) ? 3 : 4; };
      shown.sort(function (x, y) { return score(x) - score(y); });
    }
    if (!words.length) { var rec = recentList(); shown.sort(function (x, y) { var i = rec.indexOf(x.t), j = rec.indexOf(y.t); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j); }); }
    cur = Math.min(cur, Math.max(0, shown.length - 1));
    U.swap(ul, shown.length ? shown.map(function (x, i) {
      return h('li', h('button', { type: 'button', role: 'option', 'aria-selected': i === cur ? 'true' : 'false', onclick: function () { pick(x); }, onmouseenter: function () { cur = i; mark(); } },
        U.icon((TOOLS[x.t] || {}).icon || x.a.icon, 18), h('b', x.name), h('span', x.hint), h('em', x.where)));
    }) : h('li', h('div.empty', 'No tool matches “' + q.value + '”')));
  }
  function mark() { Array.prototype.forEach.call(ul.querySelectorAll('button'), function (b, i) { b.setAttribute('aria-selected', i === cur ? 'true' : 'false'); if (i === cur) b.scrollIntoView({ block: 'nearest' }); }); }
  function pick(x) { close(); go('tool', x.a.id, x.t); }
  q.addEventListener('input', function () { cur = 0; draw(); });
  q.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(shown.length - 1, cur + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(0, cur - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[cur]) pick(shown[cur]); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  var pal = h('div.pal', { role: 'dialog', 'aria-label': 'Find a tool' }, h('div.q', U.icon('search', 20), q, h('span.kbd', 'Esc')), ul);
  var scrim = h('div.scrim', { style: { background: 'var(--scrim)' } });
  scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) close(); });
  scrim.appendChild(pal);
  ctx.appEl.appendChild(scrim);
  R.pal = scrim;
  draw();
  q.focus();
  requestAnimationFrame(function () { scrim.classList.add('on'); pal.classList.add('on'); q.focus(); });
  function close() {
    if (!R.pal) return;
    R.pal = null;
    scrim.classList.remove('on'); pal.classList.remove('on');
    setTimeout(function () { scrim.remove(); }, 200);
  }
}

/* ---------------- session ---------------- */
function tickSession() {
  clearInterval(R.timer);
  function upd() {
    if (S.level === 'login' || !Api.state.token) return;
    var left = Api.minutesLeft();
    if (R.minEl) {
      R.minEl.textContent = String(left);
      R.minWrap.classList.toggle('low', left <= 10);
      if (cells.hub) cells.hub.setAttribute('aria-label', ((moduleById(S.module) || {}).name || 'Home') + ', ' + left + ' minutes left in this session');
    }
    if (left <= 0) {
      clearInterval(R.timer);
      ctx.Audit.endSession('TOKEN_EXPIRED');
      Api.signOut();
      showLogin('Your session ended after ' + ctx.CONFIG.TOKEN_VALIDITY_MIN + ' minutes. Sign in again.');
    } else if (left === 10 && !R.warned) {
      R.warned = true;
      UI.toast('10 minutes left in this session. Finish or sign in again soon.');
    }
  }
  upd();
  R.timer = setInterval(upd, 20000);
}

// 401 mid-work: ask for the password again, keep everything on screen.
Api.setReauth(function () {
  var st = Api.state;
  return UI.dialog(function (box, close) {
    var pass = UI.input({ type: 'password', placeholder: 'Password' });
    var err = h('div.err');
    var ok = h('button.btn.primary', { type: 'submit' }, 'Sign in again');
    var form = h('form', h('h2', 'Session expired'), h('p.muted', 'Sign in again as ' + st.user + ' on ' + Api.envLabel() + ' to continue. Your work stays on screen.'), UI.field('Password', pass), err,
      h('div.acts', h('button.btn.quiet', { type: 'button', onclick: function () { close(false); } }, 'Cancel'), ok));
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      ok.disabled = true; err.textContent = '';
      try { await Api.signIn(st.env, st.user, pass.value); R.warned = false; tickSession(); close(true); }
      catch (ex) { err.textContent = ex.message; ok.disabled = false; }
    });
    box.appendChild(form);
  }).then(function (v) { return v === true; });
});

async function signOutAsk() {
  var yes = await UI.dialog(function (box, close) {
    U.append(box, [h('h2', 'Sign out?'), h('p.muted', ctx.adminConsole ? 'You are in the admin console.' : 'You are signed in as ' + Api.state.user + ' on ' + Api.envLabel() + '.'),
      h('div.acts', h('button.btn.quiet', { type: 'button', onclick: function () { close(false); } }, 'Cancel'),
        h('button.btn.primary', { type: 'button', onclick: function () { close(true); } }, U.icon('out', 18), h('span', 'Sign out')))]);
  });
  if (!yes) return;
  ctx.Audit.endSession('LOGOUT');
  Api.signOut();
  ctx.adminConsole = false; ctx.adminUnlocked = false;
  try { sessionStorage.removeItem('bft.adminUnlock'); } catch (x) {}
  clearInterval(R.timer);
  showLogin();
}

/* Create / change the admin console password (username is fixed in config.js).
 * Produces the ADMIN_LOGIN line for config.js — it takes effect after it is committed on GitHub. */
function adminLoginPanel(o) {
  o = o || {};
  var AL = ctx.AdminLogin;
  var change = !!o.change && AL.configured();
  var cur = UI.input({ type: 'password', placeholder: 'Current password' }); cur.autocomplete = 'current-password';
  var p1 = UI.input({ type: 'password', placeholder: 'New password (14+ characters)' }); p1.autocomplete = 'new-password';
  var p2 = UI.input({ type: 'password', placeholder: 'Repeat new password' }); p2.autocomplete = 'new-password';
  var err = h('div.err'), out = h('div');
  var form = h('form', { novalidate: true },
    o.change ? null : h('div.brand', h('div.mark'), 'APIary'),
    h('h2', change ? 'Change admin password' : 'Create admin password'),
    h('p.muted', { style: { margin: '0 0 12px' } }, (change ? '' : 'No admin password is set yet. ') + 'The admin console opens only the Settings screens and never touches Beeforce. Only a scrambled hash of the password goes into config.js.'),
    UI.kv({ 'Admin username': AL.username() + '  (fixed in config.js)' }),
    h('div.spacer'),
    change ? h('div.grid2', UI.field('Current password', cur), h('div')) : null,
    h('div.grid2', UI.field('New password', p1), UI.field('Repeat new password', p2)),
    err,
    h('div.acts', { style: { justifyContent: 'flex-end' } },
      o.onBack ? h('button.btn.quiet', { type: 'button', onclick: o.onBack }, 'Back to sign in') : null,
      h('button.btn.primary', { type: 'submit' }, 'Create config line')),
    out);
  [cur, p1, p2].forEach(function (i) { i.addEventListener('input', function () { err.textContent = ''; }); });
  form.addEventListener('submit', async function (e) {
    e.preventDefault(); err.textContent = ''; U.clear(out);
    if (!window.crypto || !crypto.subtle) { err.textContent = 'This browser can\'t create the hash (needs HTTPS).'; return; }
    if (change && (await AL.check(AL.username(), cur.value)) !== 'ok') { err.textContent = 'Current password is wrong.'; return; }
    if (p1.value.length < 14) { err.textContent = 'Use at least 14 characters — the hash is public, so a short password can be guessed.'; return; }
    if (p1.value !== p2.value) { err.textContent = 'The new passwords don\'t match.'; return; }
    if (change && p1.value === cur.value) { err.textContent = 'The new password is the same as the current one.'; return; }
    var a = await AL.make(p1.value);
    cur.value = ''; p1.value = ''; p2.value = '';
    var line = "  ADMIN_LOGIN: { username: '" + a.username + "', salt: '" + a.salt + "', hash: '" + a.hash + "', iterations: " + a.iterations + " },";
    U.append(out, [h('div.label', 'Paste this into config.js on GitHub (replace the ADMIN_LOGIN line), then commit:'), h('pre.code', line),
      h('div.row', UI.btn('Copy', { sm: true, icon: 'template', onClick: function () { return navigator.clipboard.writeText(line.trim()).then(function () { UI.toast('Copied.'); }); } })),
      UI.note('info', null, (change ? 'The old password keeps working until you commit. ' : '') + 'The new password works from the next bookmark click after the commit. Keep it in a password manager; it can\'t be recovered from the hash.')]);
  });
  return form;
}

function hide() {
  ctx.appEl.classList.remove('in');
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', onResize);
  setTimeout(function () { ctx.host.remove(); }, 260);
}

/* ---------------- keys + resize ---------------- */
document.addEventListener('mousedown', function (e) {
  if (R.menu && ctx.host && e.composedPath && e.composedPath().indexOf(R.menu.parentNode) < 0) closeMenus();
}, true);
function keyHint() { return h('div.keyhint', h('span', h('kbd', '←'), ' ', h('kbd', '→'), ' ', h('kbd', '↑'), ' ', h('kbd', '↓'), ' move'), h('span', h('kbd', 'Enter'), ' open'), h('span', h('kbd', 'Esc'), ' back')); }
function onKey(e) {
  if (!ctx.host || !ctx.host.isConnected) return;
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); e.stopPropagation(); openPalette(); return; }
  if (R.pal || S.level === 'login' || !ctx.appEl.isConnected || ctx.appEl.querySelector('.scrim')) return;
  var path = e.composedPath ? e.composedPath() : [];
  if (path.some(function (n) { return n && (/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName) || n.isContentEditable); })) return;
  if (e.key === 'Escape' && (S.level === 'tool' || S.level === 'area' || (S.level === 'home' && (ctx.MODULE_LIST || []).length))) {
    e.preventDefault(); e.stopPropagation(); back();
    return;
  }
  if (/^Arrow/.test(e.key) && !e.altKey && !e.ctrlKey && !e.metaKey && (S.level === 'modules' || S.level === 'home' || S.level === 'area')) {
    if (arrowNav(e.key)) { e.preventDefault(); e.stopPropagation(); }
  }
}
/* Arrow keys move focus to the nearest hexagon in that direction; Enter / Space open it (they're buttons). */
function arrowNav(key) {
  var dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
  var list = Array.prototype.filter.call(R.stage.querySelectorAll('.cell'), function (c) {
    return !c.classList.contains('gone') && !c.classList.contains('mini') && !(c.classList.contains('ghost') && !c.classList.contains('back'));
  });
  if (!dir || !list.length) return false;
  var cur = ctx.root.activeElement;
  if (list.indexOf(cur) < 0) {
    var first = S.level === 'modules' ? (cells['m:' + S.module] || list[0]) : S.level === 'area' ? (cells['a:' + S.area] || list[0]) : (cells.hub || list[0]);
    if (list.indexOf(first) < 0) first = list[0];
    first.focus({ preventScroll: true });
    return true;
  }
  var mid = function (c) { var r = c.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
  var p = mid(cur), best = null, bestScore = Infinity;
  list.forEach(function (c) {
    if (c === cur) return;
    var q = mid(c), dx = q[0] - p[0], dy = q[1] - p[1];
    var along = dx * dir[0] + dy * dir[1], across = Math.abs(dx * dir[1] - dy * dir[0]);
    if (along <= 4 || across > along * 1.8) return;
    var score = along + across * 2;
    if (score < bestScore) { bestScore = score; best = c; }
  });
  if (best) best.focus({ preventScroll: true });
  return true;
}
var rt;
function onResize() { clearTimeout(rt); rt = setTimeout(function () { if (S.level !== 'login') layout({ instant: true }); }, 80); }

/* ---------------- start ---------------- */
function start() {
  ctx.loadFonts();
  mount();
  document.addEventListener('keydown', onKey, true);
  window.addEventListener('resize', onResize);
  if (Api.restore()) {
    if (!ctx.Audit.active()) ctx.Audit.startSession(Api.state.user, Api.envLabel());
    try { ctx.adminUnlocked = sessionStorage.getItem('bft.adminUnlock') === '1' && ctx.AdminLogin.configured(); } catch (x) {}
    buildMain(false);
  } else showLogin();
}

/* Rebuild the honeycomb after a layout change, keeping the session and open tool views. */
function relayout() {
  ctx.Layout.build();
  TOOLS = ctx.TOOLS;
  scope();
  rebuildCells();
  drawModulePill(); drawViewSwitch(); markAdmin();
  if (S.level === 'home' && S.view !== 'honeycomb') drawGallery();
  if (S.tool && !areaOf(S.tool)) { S.level = 'home'; S.area = null; S.tool = null; }
  if (S.tool && areaOf(S.tool) && areaOf(S.tool).module !== '*' && areaOf(S.tool).module !== S.module) { S.level = 'home'; S.area = null; S.tool = null; }
  if (S.area && !areaById(S.area)) { S.area = S.tool ? areaOf(S.tool).id : null; if (!S.area) S.level = 'home'; }
  layout({ instant: true });
  drawCrumb();
  if (S.level === 'home') drawHomePane(); else if (S.level === 'area') drawAreaPane(); else if (S.level === 'tool') drawToolPane(); else if (S.level === 'modules') drawModHead();
}

ctx.Shell = {
  relayout: relayout, switchModule: switchModule, setView: setView, chooseModule: chooseModule, adminToBeeforce: adminToBeeforce,
  start: start, go: go, back: back, hide: hide, openPalette: openPalette, secretsPanel: secretsPanel, auditBadge: auditBadge, adminLoginPanel: adminLoginPanel,
  state: S,
  noteRun: function (module, ok, failed) {
    var r = U.store.get('runs', []);
    r.unshift({ module: module || 'Tool', ok: ok, failed: failed, at: Date.now() });
    U.store.set('runs', r.slice(0, 8));
  }
};
