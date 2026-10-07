/* core/shell.js — the honeycomb shell: sign-in, home comb, area bloom, tool trail, palette.
 *
 * Every hex on screen is one absolutely positioned button. Moving between levels only changes
 * each cell's transform/opacity, so CSS animates everything (staggered), and cells never re-mount.
 *
 *   home  : hub in the middle, 8 areas around it
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

ctx.CSS += '\n' + [
  '.cell .hico{display:none}',
  '.cell.mini .hico{display:inline-flex}.cell.mini .ring{display:none}',
  '.cell.mini .ic{transform:scale(2.3)}',
  '.cell.mini:hover:not(.gone) .ic{transform:scale(2.5)}',
  '.cell.mini .face{padding:0}',
  '.cell.ghost{cursor:default}.cell.ghost.back{cursor:pointer}',
  '.cell.ghost:not(.back):hover .rim{background:#1A263B;transform:none}.cell.ghost:not(.back):hover{filter:none}',
  '.cell.ghost:not(.back):hover .face{background:#0C1526}',
  '.tip{position:absolute;z-index:9;padding:5px 10px;border-radius:8px;background:var(--panel3);border:1px solid var(--line2);font-size:12.5px;font-weight:600;pointer-events:none;opacity:0;transform:translateY(4px);transition:opacity .15s,transform .15s var(--ease);white-space:nowrap}',
  '.tip.on{opacity:1;transform:none}',
  '.areapane{padding-top:300px}',
  '.toolpane .sib{margin-top:350px}',
  '.loadcard{display:flex;align-items:center;gap:12px;color:var(--ink2)}',
  '.lfoot{margin-top:16px;color:var(--ink3);font-size:12px;display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap}',
  '.lcard.wide{width:min(620px,94vw)}',
  '.login{overflow:auto;padding:24px 0}',
  '.lcard code,.page code{font:12px ui-monospace,Consolas,monospace;color:var(--ink2);word-break:break-all}'
].join('\n');

var S = { level: 'login', area: null, tool: null };
var R = {};            // element refs
var cells = {};        // id -> cell element
var views = {};        // tool id -> workspace element (kept so work in progress survives navigation)

function areaOf(toolId) { return AREAS.filter(function (a) { return (a.allTools || a.tools).indexOf(toolId) >= 0; })[0]; }
function areaById(id) { return AREAS.filter(function (a) { return a.id === id; })[0]; }
function initials(n) { n = String(n || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean); return ((n[0] || '?')[0] + ((n[1] || '')[0] || '')).toUpperCase(); }

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
    h('div.brand', h('div.mark'), 'BeeForce Tools'),
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
  var close = h('button.iconbtn', { type: 'button', title: 'Close', style: { position: 'absolute', right: '20px', top: '18px' }, onclick: hide }, U.icon('x', 18));
  var card = h('div.lcard', form);
  R.login = h('div.login', deco, card, close);
  app.insertBefore(R.login, R.toasts);

  // Setup card swaps in place of the sign-in card (first run, or from the link).
  function openSetup(first) {
    var panel = secretsPanel({ first: first, onDone: function () { card.classList.remove('wide'); U.swap(card, form); restart(card); U.swap(form.querySelector('.lfoot'), h('span', 'v' + ctx.CONFIG.VERSION), auditBadge(), h('button.linkbtn', { type: 'button', onclick: function () { openSetup(false); } }, 'Sign-in & audit setup')); setTimeout(function () { (user.value ? pass : user).focus(); }, 50); } });
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
    o.inSettings ? null : h('div.brand', h('div.mark'), 'BeeForce Tools'),
    o.inSettings ? null : h('h2', o.first ? 'Set up this browser' : 'Sign-in & audit setup'),
    o.inSettings ? null : h('p.muted', { style: { margin: '0 0 14px' } }, o.first ? 'One-time setup for ' + location.host + '. Ask your BeeForce Tools admin for these values.' : 'Settings saved in this browser for ' + location.host + '.'),
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
  ctx.Layout.build(Api.state.user);
  AREAS = ctx.AREAS; TOOLS = ctx.TOOLS;

  var st = Api.state;
  R.crumb = h('div.crumb');
  R.env = h('div.envpill' + (st.env === 'uat' ? '.uat' : ''), h('i'), Api.envLabel());
  var who = h('button.who', { type: 'button', title: 'Signed in as ' + st.user + ' · click to sign out', onclick: signOutAsk }, h('div.av', initials(st.user)), h('span', st.user));
  var top = h('div.top',
    h('div.brand', h('div.mark'), 'BeeForce Tools'),
    R.crumb, R.env, who,
    h('button.iconbtn', { type: 'button', title: 'Search tools (Ctrl K)', 'aria-label': 'Search tools', onclick: openPalette }, U.icon('search', 18)),
    h('button.iconbtn', { type: 'button', title: 'Close (session stays signed in)', 'aria-label': 'Close', onclick: hide }, U.icon('x', 18)));

  R.homePane = h('div.sidepane');
  R.areaPane = h('div.sidepane.areapane.off');
  R.toolPane = h('div.sidepane.toolpane.off');
  R.side = h('div.side', R.homePane, R.areaPane, R.toolPane);
  R.stage = h('div.stage');
  R.peek = h('div.peek');
  R.tip = h('div.tip');
  R.work = h('div.work');
  R.body = h('div.body', R.side, R.stage, R.peek, R.tip, R.work);
  app.insertBefore(top, R.toasts);
  app.insertBefore(R.body, R.toasts);

  buildCells();
  drawHomePane();
  S.level = 'home'; S.area = null; S.tool = null;

  // first frame: everything gathered at the hub, then bloom out
  layout({ intro: true });
  requestAnimationFrame(function () { requestAnimationFrame(function () { go('home'); }); });
  tickSession();
}

function mkCell(id, cls, content, onClick, label) {
  var c = h('button.cell.' + cls, { type: 'button', 'aria-label': label || id, style: { width: BW + 'px', height: BH + 'px' } },
    h('div.rim', h('div.face', content)));
  c.addEventListener('click', function (e) { if (!c.classList.contains('gone')) onClick && onClick(e); });
  cells[id] = c;
  R.stage.appendChild(c);
  return c;
}

function buildCells() {
  // hub
  R.ringEl = h('div.ring', h('b', '—'));
  var hub = mkCell('hub', 'hub', [R.ringEl, U.icon('home', 22), h('div.ct', 'min left')], function () {
    if (S.level === 'home') openPalette(); else go('home');
  }, 'Home');
  hub.querySelector('.ic').classList.add('hico');
  hub.title = 'Home · Ctrl K to search';
  hub.addEventListener('mouseenter', function () { if (S.level !== 'home') showTip(hub, 'Home'); });
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
      var tc = mkCell('t:' + t, 'tool', [U.icon(a.icon, 24), h('div.nm', info.name), h('div.ht', info.hint)], function () {
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
  return { id: id, x: x, y: y, s: w / BW, o: o == null ? 1 : o };
}

function computeLayout(opts) {
  opts = opts || {};
  var W = R.body.clientWidth, H = R.body.clientHeight;
  var cx = SIDE + (W - SIDE) / 2, cy = H / 2;
  var L = {};
  var hubAt;

  if (S.level === 'home' || opts.intro) {
    var k = Math.min(1, (W - SIDE - 60) / 790, (H - 40) / 570);
    var w = 170 * k, gap = 10 * k;
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
    var unit = 176 * k2, gap2 = 10 * k2;
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
  L['a:' + area.id] = place('a:' + area.id, tx, ty + step, tw); L['a:' + area.id].mini = 1; L['a:' + area.id].sel = 1; L['a:' + area.id].d = 40;
  L['t:' + S.tool] = place('t:' + S.tool, tx, ty + step * 2, tw); L['t:' + S.tool].mini = 1; L['t:' + S.tool].cur = 1; L['t:' + S.tool].d = 80;
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
  Object.keys(cells).forEach(function (id) {
    var c = cells[id], p = L[id];
    if (!p) return;
    c.style.transitionDelay = rm || opts.instant ? '0ms' : (p.d || 0) + 'ms';
    c.style.transform = 'translate(' + Math.round(p.x - BW / 2) + 'px,' + Math.round(p.y - BH / 2) + 'px) scale(' + p.s.toFixed(4) + ')';
    c.style.opacity = String(p.o);
    c.classList.toggle('gone', !!p.gone || p.o === 0);
    c.classList.toggle('mini', !!p.mini);
    c.classList.toggle('sel', !!p.sel);
    c.classList.toggle('cur', !!p.cur);
    c.classList.toggle('back', !!p.back);
    c.tabIndex = p.gone || p.o === 0 || (id.indexOf('g:') === 0 && !p.back) ? -1 : 0;
    c.setAttribute('aria-hidden', p.gone || p.o === 0 ? 'true' : 'false');
  });
}

/* ---------------- navigation ---------------- */
function go(level, areaId, toolId) {
  hidePeek(); hideTip();
  var prev = S.level;
  if (level === 'tool' && !areaId) areaId = areaOf(toolId).id;
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
  layout();
  drawCrumb();
  R.homePane.classList.toggle('off', level !== 'home');
  R.areaPane.classList.toggle('off', level !== 'area');
  R.toolPane.classList.toggle('off', level !== 'tool');
  if (level === 'area') drawAreaPane();
  if (level === 'tool') { drawToolPane(); openTool(toolId); }
  else R.work.classList.remove('on');
  if (level === 'home') drawHomePane();
}

function back() {
  if (S.level === 'tool') go('area', S.area);
  else if (S.level === 'area') go('home');
}

function drawCrumb() {
  var parts = [h('button', { type: 'button', onclick: function () { go('home'); } }, 'Home')];
  if (S.area) { var a = areaById(S.area); parts.push(h('i', '›')); parts.push(S.level === 'area' ? h('b', a.name) : h('button', { type: 'button', onclick: function () { go('area', a.id); } }, a.name)); }
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
    h('h1', 'Configuration'),
    h('p', 'Pick an area, then a tool. Every change is shown for review before it is written to ' + Api.envLabel() + '.'),
    h('button.searchbtn', { type: 'button', onclick: openPalette }, U.icon('search', 18), 'Find a tool', h('kbd', 'Ctrl K')),
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

function drawToolPane() {
  var a = areaById(S.area);
  var tx = 70, ty = 72, step = 106;
  var labels = [['Home', 'home'], [a.name, 'area'], [TOOLS[S.tool].name, 'tool']].map(function (l, i) {
    var el = h('div.tl' + (i === 2 ? '.cur' : ''), l[0]);
    el.style.left = (tx + 46) + 'px'; el.style.top = (ty + step * i) + 'px';
    el.style.transition = 'opacity .3s var(--ease) ' + (120 + i * 60) + 'ms, transform .4s var(--ease) ' + (120 + i * 60) + 'ms';
    el.style.opacity = '0'; el.style.transform = 'translate(-8px,-50%)';
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'translate(0,-50%)'; }); });
    return el;
  });
  var lines = [0, 1].map(function (i) { var ln = h('div.ln'); ln.style.top = (ty + step * i + 37) + 'px'; ln.style.height = (step - 74) + 'px'; return ln; });
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
    page.appendChild(UI.header({ area: a.name, title: TOOLS[id].name, desc: def.desc || TOOLS[id].hint, actions: def.actions }));
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

/* ---------------- hover peek + tips ---------------- */
function showPeek(a, cell) {
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
  AREAS.forEach(function (a) { (a.allTools || a.tools).forEach(function (t) { if (TOOLS[t] && (!TOOLS[t].hidden || admin)) all.push({ t: t, a: a, name: TOOLS[t].name, hint: TOOLS[t].hint + (TOOLS[t].hidden ? ' · hidden' : '') }); }); });
  var q = UI.input({ placeholder: 'Search tools — e.g. "accrual set", "punch"' });
  var ul = h('ul', { role: 'listbox' });
  var cur = 0, shown = [];
  function draw() {
    var words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    shown = all.filter(function (x) { var s = (x.name + ' ' + x.hint + ' ' + x.a.name + ' ' + x.t).toLowerCase(); return words.every(function (w) { return s.indexOf(w) >= 0; }); });
    if (words.length) {
      var score = function (x) { var n = x.name.toLowerCase(), qq = words.join(' '); return n === qq ? 0 : n.indexOf(qq) === 0 ? 1 : n.indexOf(qq) >= 0 ? 2 : words.every(function (w) { return n.indexOf(w) >= 0; }) ? 3 : 4; };
      shown.sort(function (x, y) { return score(x) - score(y); });
    }
    if (!words.length) { var rec = recentList(); shown.sort(function (x, y) { var i = rec.indexOf(x.t), j = rec.indexOf(y.t); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j); }); }
    cur = Math.min(cur, Math.max(0, shown.length - 1));
    U.swap(ul, shown.length ? shown.map(function (x, i) {
      return h('li', h('button', { type: 'button', role: 'option', 'aria-selected': i === cur ? 'true' : 'false', onclick: function () { pick(x); }, onmouseenter: function () { cur = i; mark(); } },
        U.icon(x.a.icon, 18), h('b', x.name), h('span', x.hint), h('em', x.a.name)));
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
  var scrim = h('div.scrim', { style: { background: '#050a1288' } });
  scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) close(); });
  scrim.appendChild(pal);
  ctx.appEl.appendChild(scrim);
  R.pal = scrim;
  draw();
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
    var pct = Math.max(0, Math.min(100, left / ctx.CONFIG.TOKEN_VALIDITY_MIN * 100));
    if (R.ringEl) {
      R.ringEl.style.background = 'conic-gradient(' + (left <= 10 ? 'var(--bad)' : 'var(--honey)') + ' ' + pct + '%, #2A2512 0)';
      R.ringEl.firstChild.textContent = String(left);
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
    U.append(box, [h('h2', 'Sign out?'), h('p.muted', 'You are signed in as ' + Api.state.user + ' on ' + Api.envLabel() + '.'),
      h('div.acts', h('button.btn.quiet', { type: 'button', onclick: function () { close(false); } }, 'Cancel'),
        h('button.btn.primary', { type: 'button', onclick: function () { close(true); } }, U.icon('out', 18), h('span', 'Sign out')))]);
  });
  if (!yes) return;
  ctx.Audit.endSession('LOGOUT');
  Api.signOut();
  clearInterval(R.timer);
  showLogin();
}

function hide() {
  ctx.appEl.classList.remove('in');
  document.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', onResize);
  setTimeout(function () { ctx.host.remove(); }, 260);
}

/* ---------------- keys + resize ---------------- */
function onKey(e) {
  if (!ctx.host || !ctx.host.isConnected) return;
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); e.stopPropagation(); openPalette(); return; }
  if (e.key === 'Escape' && !R.pal && !ctx.appEl.querySelector('.scrim') && (S.level === 'tool' || S.level === 'area')) {
    var path = e.composedPath ? e.composedPath() : [];
    var inField = path.some(function (n) { return n && /^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName); });
    if (inField) return;
    e.preventDefault(); e.stopPropagation(); back();
  }
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
    buildMain(false);
  } else showLogin();
}

/* Rebuild the honeycomb after a layout change, keeping the session and open tool views. */
function relayout() {
  ctx.Layout.build(Api.state.user);
  AREAS = ctx.AREAS; TOOLS = ctx.TOOLS;
  Array.prototype.slice.call(R.stage.querySelectorAll('.cell')).forEach(function (c) { c.remove(); });
  cells = {};
  buildCells();
  if (S.tool && !areaOf(S.tool)) { S.level = 'home'; S.area = null; S.tool = null; }
  if (S.area && !areaById(S.area)) { S.area = S.tool ? areaOf(S.tool).id : null; if (!S.area) S.level = 'home'; }
  layout({ instant: true });
  drawCrumb();
  if (S.level === 'home') drawHomePane(); else if (S.level === 'area') drawAreaPane(); else drawToolPane();
}

ctx.Shell = {
  relayout: relayout,
  start: start, go: go, back: back, hide: hide, openPalette: openPalette, secretsPanel: secretsPanel, auditBadge: auditBadge,
  state: S,
  noteRun: function (module, ok, failed) {
    var r = U.store.get('runs', []);
    r.unshift({ module: module || 'Tool', ok: ok, failed: failed, at: Date.now() });
    U.store.set('runs', r.slice(0, 8));
  }
};
