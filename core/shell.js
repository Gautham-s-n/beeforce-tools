/* core/shell.js — the honeycomb shell: sign-in, module page, home comb, area bloom, tool trail, palette.
 *
 * Every hex on screen is one absolutely positioned button. Moving between levels only changes
 * each cell's transform/opacity, and cells never re-mount. How the change is animated depends on the motion level
 * (Appearance; data-motion on .app, see U.motion()):
 *   full : CSS springs every cell to its new place (staggered); while cells move, the stage gets a "liquid" SVG filter
 *          (cells stretch and bridge into each other) that fades out when they settle. Hovered cells tilt slightly.
 *   calm : cells that stay on screen glide (Web Animations, 380ms, no overshoot); new cells fade in where they belong;
 *          leaving cells fade out in place. Hover lifts a cell by 2px.
 *   off  : no movement; new cells fade in (120ms). Hover still shows the honey edge.
 * The side pane is 320px wide at every screen size; narrow windows scroll sideways.
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
var SIDE = 320;       // the side pane: the same fixed width at every screen size (v3.6.1 layout)
/* hub → area → tool trail in the side pane next to an open tool */
var TRAIL = { tx: 70, ty: 72, step: 106, tw: 64 };
var LEVEL1 = [[0, -1], [1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [2, -1], [-2, 1], [1, 1]]; // 9th slot = Settings (admins)
var RING = [[1, -1], [1, 0], [0, 1], [-1, 1], [-1, 0], [0, -1]];
// Every place an area can take around the hub (1–2 steps out): the classic 8 + Settings first, then the rest of ring 2.
var SLOTS = (function () {
  var out = LEVEL1.slice(), key = function (p) { return p.join(); }, have = out.map(key);
  for (var r = -2; r <= 2; r++) for (var q = -2; q <= 2; q++) {
    var d = (Math.abs(q) + Math.abs(r) + Math.abs(q + r)) / 2;
    if (d >= 1 && d <= 2 && have.indexOf(q + ',' + r) < 0) { out.push([q, r]); have.push(q + ',' + r); }
  }
  return out;
})();
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
  '.gallery{position:absolute;left:320px;right:0;top:0;bottom:0;overflow:auto;padding:30px 40px 60px;z-index:6;opacity:0;pointer-events:none;visibility:hidden;transform:translateY(8px);transition:opacity .3s var(--ease),transform .35s var(--ease),visibility 0s .35s}',
  '.gallery.on{opacity:1;pointer-events:auto;visibility:inherit;transform:none;transition:opacity .3s var(--ease),transform .35s var(--ease),visibility 0s}',
  '.gpage{max-width:1180px}',
  '.gtitle{display:flex;align-items:baseline;gap:14px;margin-bottom:18px}.gtitle h2{margin:0;font-size:26px;letter-spacing:-.01em}',
  '.gsec,.ccard{animation:fadeup .35s var(--ease) both}',
  '.gsec{margin-bottom:26px;border-radius:16px;transition:box-shadow .4s}',
  '.gsh{display:flex;gap:12px;align-items:center;margin-bottom:12px}.gsh h3{margin:0;font-size:16px}.gsh p{margin:2px 0 0;color:var(--ink2);font-size:12.5px}',
  '.ggrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}',
  '.gtile{display:flex;flex-direction:column;align-items:flex-start;gap:6px;padding:16px;border:1px solid var(--line);border-radius:16px;background:var(--panel);text-align:left;transition:transform .2s var(--ease),border-color .2s,box-shadow .2s}',
  '.gtile:hover,.gtile:focus-visible{border-color:var(--blue2);box-shadow:0 14px 30px -18px var(--cellglow)}',
  '.app:not([data-motion=off]) .gtile:hover,.app:not([data-motion=off]) .gtile:focus-visible{transform:translateY(-3px)}',
  '.gtile b{font-size:14.5px}.gtile span{font-size:12.5px;color:var(--ink2)}',
  '.ghex{width:40px;height:46px;clip-path:var(--hex);background:var(--bluebg);display:grid;place-items:center;color:var(--blue3);margin-bottom:4px;transition:transform .25s var(--ease)}',
  '.app[data-motion=full] .gtile:hover .ghex{transform:translateY(-2px) rotate(-6deg)}',
  '.cgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px;align-items:start}',
  '.ccard{border:1px solid var(--line);border-radius:18px;background:var(--panel);padding:16px;transition:border-color .2s,box-shadow .4s}',
  '.ccard:hover{border-color:var(--line2)}',
  '.clist{display:grid;gap:4px}',
  '.crow{display:flex;align-items:center;gap:12px;padding:9px 10px;border:0;border-radius:12px;background:none;text-align:left;transition:background .15s}',
  '.crow:hover,.crow:focus-visible{background:var(--rowhover)}.crow div{flex:1;display:flex;flex-direction:column}.crow b{font-size:14px}.crow div span{font-size:12px;color:var(--ink2)}',
  '.crow>.ic:last-child{transform:rotate(180deg);color:var(--ink3);opacity:0;transition:opacity .15s,transform .2s}.crow:hover>.ic:last-child{opacity:1;transform:rotate(180deg) translateX(-3px)}',
  '.cic{width:30px;height:34px;clip-path:var(--hex);background:var(--toolface);display:grid;place-items:center;color:var(--blue3);flex:none}',
  '.lwrap{border:1px solid var(--line);border-radius:16px;background:var(--panel);overflow:hidden}',
  '.lsec{border-radius:0;transition:box-shadow .4s}',
  '.lsh{display:flex;align-items:center;gap:10px;padding:10px 16px;background:var(--panel2);border-bottom:1px solid var(--line);color:var(--blue3)}.lsh b{color:var(--ink)}.lsh>span:last-child{margin-left:auto;font-size:12px;color:var(--ink3)}',
  '.hexico{width:30px;height:34px;clip-path:var(--hex);background:var(--bluebg);display:grid;place-items:center;color:var(--blue3);flex:none}',
  '.lrow{width:100%;display:grid;grid-template-columns:34px minmax(160px,1fr) minmax(200px,2fr);align-items:center;gap:10px;padding:8px 16px;border:0;border-bottom:1px solid var(--line);background:none;text-align:left;transition:background .12s}',
  '.lrow:hover,.lrow:focus-visible{background:var(--rowhover)}.lrow .hint{color:var(--ink2);font-size:13px}.lrow .ar{color:var(--ink3);font-size:12px;text-align:right}',
  '.flash{box-shadow:0 0 0 2px var(--blue2)}',
  '.envpill.adm i{background:var(--honey);box-shadow:0 0 10px var(--honey)}',
  'pre.code{white-space:pre-wrap;word-break:break-all}',
  '.login{overflow:auto;padding:24px 0}',
  '.lcard code,.page code{font:12px var(--mono);color:var(--ink2);word-break:break-all}',
  /* Appearance dialog */
  '.dlg.appear{width:min(420px,100%)}',
  '.appear .opt{margin-top:16px}',
  '.appear .lab{display:flex;justify-content:space-between;align-items:baseline;gap:10px;font-weight:600;margin-bottom:6px}.appear .lab span{font-weight:400;color:var(--ink3);font-size:12px}',
  '.wseg{display:grid;grid-auto-flow:column;grid-auto-columns:1fr;padding:3px;border:1px solid var(--line);border-radius:12px;background:var(--panel)}',
  '.wseg button{height:32px;border:0;border-radius:9px;background:none;color:var(--ink2);font-weight:600;transition:background .15s,color .15s}',
  '.wseg button:hover{color:var(--ink)}',
  '.wseg button[aria-checked=true]{background:var(--bluebg);color:var(--blue3)}',
  '.optdesc{margin-top:6px;font-size:12.5px;color:var(--ink2);min-height:36px}',
  '.sysnote{display:flex;gap:8px;align-items:flex-start;padding:9px 10px;border-radius:12px;background:var(--warnbg);color:var(--ink);font-size:12.5px;margin-top:8px}.sysnote>.ic{color:var(--honey);margin-top:1px}',
  '.sysnote .linkbtn{font-size:12.5px;margin-left:2px}',
  '.apdemo{position:relative;height:84px;margin-top:10px;border:1px solid var(--line);border-radius:12px;background:var(--bg);overflow:hidden}',
  '.apdemo i{position:absolute;top:12px;width:50px;height:58px;clip-path:var(--hex);background:var(--line2)}',
  '.apdemo i::after{content:"";position:absolute;inset:1.5px;clip-path:var(--hex);background:var(--areaface)}',
  '.apdemo i.h{background:#C98A14}.apdemo i.h::after{background:var(--honeygrad)}',
  '.appear .acts{align-items:center}',
  /* minimize: the overlay steps aside, a small honey button stays on the Beeforce page */
  '.app.min{pointer-events:none}.app.min::before{opacity:0}',
  '.app>:not(.dock):not(.toasts){transition:opacity .25s var(--ease),transform .35s var(--ease),visibility 0s}',
  '.app.min>:not(.dock):not(.toasts){opacity:0;transform:translateY(18px) scale(.98);visibility:hidden;transition:opacity .2s var(--ease),transform .3s var(--ease),visibility 0s .3s}',
  '.dock{position:fixed;z-index:20;width:58px;height:66px;pointer-events:none;opacity:0;transform:scale(.6);transition:opacity .25s var(--ease),transform .4s var(--spring)}',
  '.app.min .dock{pointer-events:auto;opacity:1;transform:none}',
  '.dock .dhex{width:58px;height:66px;border:0;padding:0;background:#C98A14;clip-path:var(--dockhex);display:grid;place-items:center;cursor:pointer;filter:drop-shadow(0 10px 18px #0008);transition:transform .35s var(--spring)}',
  '.dock .dhex>span{width:55px;height:63px;clip-path:var(--dockhex2);background:var(--honeygrad);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1px;color:var(--honeyink);font:800 11px/1 "Schibsted Grotesk",system-ui,sans-serif}',
  '.dock .dhex:hover,.dock .dhex:focus-visible{transform:translateY(-3px) scale(1.06);outline:none}.dock .dhex:focus-visible{filter:drop-shadow(0 0 1px var(--focusring)) drop-shadow(0 0 4px var(--focusring))}',
  '.dock.drag .dhex{cursor:grabbing;transition:none}',
  '.dock .dlabel{position:absolute;right:68px;top:50%;margin-top:-22px;padding:8px 12px;border-radius:12px;background:var(--panel2);border:1px solid var(--line2);color:var(--ink);font:600 13px/1.3 "Schibsted Grotesk",system-ui,sans-serif;white-space:nowrap;box-shadow:0 14px 30px -14px #000a;opacity:0;transform:translateX(8px);transition:opacity .2s,transform .3s var(--spring);pointer-events:none}',
  '.dock .dlabel span{display:block;font-weight:500;font-size:11.5px;color:var(--ink2)}',
  '.dock:hover .dlabel,.dock .dhex:focus-visible+.dlabel{opacity:1;transform:none}',
  '.dock.left .dlabel{right:auto;left:68px;transform:translateX(-8px)}',
  '.dock.low .dhex>span b{color:#B4232F}',
  /* Lightbox: a soft sky-blue light behind the hovered hexagon; the gaps around it glow */
  '.backlight{position:absolute;left:0;top:0;width:520px;height:520px;margin:-260px 0 0 -260px;border-radius:50%;z-index:4;pointer-events:none;opacity:0;transition:opacity .3s var(--ease),transform .25s var(--ease);background:radial-gradient(circle,var(--blcore) 0%,var(--blmid) 38%,transparent 66%);will-change:transform}',
  '.backlight.on{opacity:1}',
  /* arrange mode */
  '.arrbtn[aria-pressed=true]{background:var(--honeybg);color:var(--honey);border-color:var(--honey)}',
  '.slotlayer{position:absolute;inset:0;z-index:5;pointer-events:none}',
  '.slotmark{position:absolute;opacity:0;animation:fadeup .3s var(--ease) forwards}',
  '.slotmark svg{display:block;overflow:visible}.slotmark path{fill:var(--well);fill-opacity:.35;stroke:var(--line2);stroke-width:1.6;stroke-dasharray:6 6;transition:stroke .15s,fill .15s}',
  '.slotmark.hot path{stroke:var(--honey);fill:var(--honeybg);fill-opacity:.8;stroke-dasharray:none;stroke-width:2.2}',
  '.stage.arranging .cell.canmove{cursor:grab;touch-action:none}',
  '.app[data-motion=full] .stage.arranging .cell.canmove .tl{animation:jig 1.6s ease-in-out infinite;animation-delay:var(--jd,0s)}',
  '.stage.arranging .cell.canmove .rim{background:var(--honey)}',
  '@keyframes jig{0%,100%{rotate:-1.1deg}50%{rotate:1.1deg}}',
  '.cell.dragging{transition:none!important;z-index:9;cursor:grabbing;filter:drop-shadow(0 26px 26px var(--cellshadow)) drop-shadow(0 0 22px var(--honeyglow))}',
  '.cell.dragging .tl{animation:none!important}',
  '.cell.swapme .tl{animation:none!important;--k:.9;opacity:.75}',
  '.arrbar{position:absolute;left:50%;bottom:22px;z-index:8;display:flex;align-items:center;gap:10px;padding:8px 10px 8px 16px;border-radius:999px;background:var(--panel2);border:1px solid var(--honey);box-shadow:0 20px 40px -20px var(--shadow);color:var(--ink);font-size:13.5px;transform:translate(-50%,20px);opacity:0;pointer-events:none;transition:opacity .25s var(--ease),transform .4s var(--spring);max-width:calc(100% - 40px)}',
  '.arrbar.on{opacity:1;transform:translate(-50%,0);pointer-events:auto}.arrbar>.ic{color:var(--honey)}',
  /* liquid motion + 3D hover */
  '.stage.goo{filter:url(#bft-goo)}',
  '.cell .tl{width:100%;height:100%;transition:transform .2s var(--ease)}',
  '.app[data-motion=full] .cell .tl{transform:perspective(900px) rotateX(var(--rx,0deg)) rotateY(var(--ry,0deg)) translateZ(var(--z,0px)) scale(var(--k,1));transition:transform .45s var(--spring)}',
  '.app[data-motion=full] .cell:hover:not(.gone) .tl,.app[data-motion=full] .cell:focus-visible .tl{--z:42px;--k:1.05;transition:transform .3s var(--spring)}',
  '.app[data-motion=full] .cell.mini:hover:not(.gone) .tl{--z:0px;--k:1.12}',
  '.app[data-motion=full] .cell.ghost:not(.back):hover .tl{--z:0px;--k:1}',
  '.app[data-motion=calm] .cell:hover:not(.gone):not(.mini):not(.ghost) .tl,.app[data-motion=calm] .cell.ghost.back:hover .tl{transform:translateY(-2px)}',
  '.app[data-motion=calm] .cell.mini:hover:not(.gone) .tl{transform:scale(1.06)}',
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
  '.modfoot.off{opacity:0;transform:translateY(12px);pointer-events:none;visibility:hidden;transition:opacity .4s var(--ease),transform .55s var(--ease),visibility 0s .4s}',
  '.modfoot .check{padding:8px 14px;border:1px solid var(--line);border-radius:999px;background:var(--panel)}',
  '.keyhint{font-size:12px;color:var(--ink3);display:flex;flex-wrap:wrap;gap:4px 12px}.keyhint span{white-space:nowrap}.modfoot .keyhint{justify-content:center}.keyhint kbd{font:600 11px var(--mono);padding:1px 5px;border:1px solid var(--line2);border-radius:5px;color:var(--ink2)}',
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

/* ---------- components kept from the Stage 4 work (menus, toasts, dialogs, palette, tables), in the v3.6.1 look ---------- */
ctx.CSS += '\n' + [
  'kbd{display:inline-grid;place-items:center;min-width:18px;height:18px;padding:0 4px;border-radius:4px;border:1px solid var(--line2);border-bottom-width:2px;background:var(--panel2);font:500 10.5px/1 var(--mono);color:var(--ink2)}',
  '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}',
  /* controls */
  '.btn[aria-disabled=true]{opacity:.45;cursor:not-allowed}',
  '.btn[aria-disabled=true]:hover{background:var(--panel);border-color:var(--line2)}.btn.primary[aria-disabled=true]:hover{background:var(--blue);border-color:var(--blue)}.btn.quiet[aria-disabled=true]:hover{background:none;border-color:transparent}',
  /* menus */
  '.menu{z-index:60}',
  '.menu.up{top:auto;bottom:calc(100% + 8px)}',
  '.menu button:focus-visible{outline:none;background:var(--panel3);box-shadow:inset 0 0 0 2px var(--focusring)}',
  '.menu button[aria-disabled=true]{opacity:.55;cursor:not-allowed}.menu button[aria-disabled=true]:hover{background:none}',
  '.menu button>small{margin-left:auto;padding-left:12px;font-size:var(--t12);color:var(--ink3);white-space:nowrap}',
  '.menu button>div{min-width:0}',
  '.menu .hd{padding:6px 10px 4px;font-size:11.5px;font-weight:600;color:var(--ink3);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:320px}',
  '.menu hr{border:0;height:1px;background:var(--line);margin:4px}',
  '.menu button.danger b,.menu button.danger .ic{color:var(--bad)}',
  '.menu .mchk{width:16px;display:inline-flex;color:var(--blue3);visibility:hidden}.menu button[aria-checked=true] .mchk{visibility:visible}',
  /* toasts: ok = something happened on your computer, warn, bad = error */
  '.toasts{z-index:70}',
  '.toast{border-left:3px solid var(--line2)}.toast.ok{border-left-color:var(--ok)}.toast.warn{border-left-color:var(--honeyedge)}.toast.bad{border-left-color:var(--bad)}',
  /* dialogs */
  '.dlg.codedlg{width:min(700px,100%)}',
  'pre.code.numbered{counter-reset:ln;padding:10px 12px 10px 0;white-space:pre;word-break:normal;max-height:50vh}',
  'pre.code.numbered .ln{display:block;min-height:1.5em;counter-increment:ln}',
  'pre.code.numbered .ln::before{content:counter(ln);display:inline-block;width:34px;margin-right:12px;text-align:right;color:var(--ink3);user-select:none}',
  /* palette */
  '.pal{display:flex;flex-direction:column;max-height:min(580px,82vh)}',
  '.pal ul{flex:1;min-height:0;max-height:none}',
  '.pal .gh{padding:10px 8px 4px;font-size:11.5px;font-weight:600;color:var(--ink3)}',
  '.pal li{position:relative}',
  '.pal li button{position:relative;min-height:38px}',
  '.pal li button .gl{width:24px;height:24px;border-radius:var(--r6);display:grid;place-items:center;background:var(--panel3);color:var(--ink2);flex:none;overflow:visible}',
  '.pal li button .gl.hexg{clip-path:var(--hex);border-radius:0;width:22px;height:25px}',
  '.pal li button b mark{background:none;color:var(--blue3);font-weight:700}',
  '.pal li button[aria-selected=true]{background:var(--panel3)}',
  '.pal li button[aria-selected=true] .gl{background:var(--bluebg);color:var(--blue3)}',
  '.pal li button em{display:flex;align-items:center;gap:4px}.pal li button em kbd{height:16px;font-size:10px}',
  '.pal li button code{font:12px var(--mono);color:var(--ink3)}',
  '.pal .scope{display:inline-flex;align-items:center;gap:5px;height:24px;padding:0 4px 0 8px;border-radius:6px;background:var(--bluebg);color:var(--blue3);font-weight:600;font-size:12.5px;flex:none;white-space:nowrap}',
  '.pal .scope[hidden]{display:none}',
  '.pal .scope button{border:0;background:none;color:inherit;padding:0;width:16px;height:16px;display:grid;place-items:center}',
  '.pal .pf{display:flex;align-items:center;gap:14px;min-height:38px;padding:6px 14px;border-top:1px solid var(--line);background:var(--panel);font-size:var(--t12);color:var(--ink3);flex-wrap:wrap}',
  '.pal .pf span{display:inline-flex;align-items:center;gap:3px}.pal .pf .grow{flex:1}',
  '.pal .uimenu{top:calc(100% + 2px)}',
  '@media (max-width:560px){.pal li button .gl{display:grid}.pal .pf{display:none}}',
  '.m{display:inline-grid;place-items:center;min-width:40px;height:18px;padding:0 4px;border-radius:var(--r4);font:600 10px/1 var(--mono);border:1px solid currentColor}',
  '.m.GET{color:var(--ok)}.m.POST{color:var(--blue3)}.m.PUT,.m.PATCH{color:var(--honey)}.m.DELETE{color:var(--bad)}',
  /* tables */
  '.twrap:focus-visible{outline:2px solid var(--focusring);outline-offset:2px}',
  'th .sortbtn{border:0;background:none;padding:0;color:inherit;font:inherit;display:inline-flex;align-items:center;gap:4px}',
  'th .sortbtn:hover{color:var(--ink)}',
  'th .sarr{opacity:.4;font-size:11px}th[aria-sort=ascending] .sarr,th[aria-sort=descending] .sarr{opacity:1;color:var(--blue3)}',
  '.bool{display:inline-flex;align-items:center;gap:6px;color:var(--ink2)}.bool i{width:6px;height:6px;border-radius:50%;background:var(--line2)}.bool.y{color:var(--ink)}.bool.y i{background:var(--ok)}',
  'tr.none td{padding:0}tr.none:hover{background:none}',
  '.tnone{display:flex;flex-direction:column;align-items:center;gap:6px;padding:28px 16px;color:var(--ink2);white-space:normal}.tnone b{color:var(--ink);font-weight:600}',
  'td.num,th.num{text-align:right}',
  '.iconbtn.rowmenu{width:28px;height:28px;opacity:0}tbody tr:hover .rowmenu,.rowmenu:focus-visible,.rowmenu[aria-expanded=true]{opacity:1}',
  '.tbar .clearsel[hidden],.tbar .acts:empty{display:none}',
  '.skel{border:1px solid var(--line);border-radius:var(--r12);background:var(--panel);padding:12px 16px}',
  '.skelt{display:flex;align-items:center;gap:10px;color:var(--ink2);margin-bottom:6px}',
  '.skr{display:flex;gap:16px;padding:10px 0;border-top:1px solid var(--line)}',
  '.skr i{display:block;height:10px;border-radius:3px;background:var(--panel3);animation:skp 1.4s ease-in-out infinite}',
  '@keyframes skp{50%{opacity:.45}}',
  '.app[data-motion=off] .skr i{animation:none!important}'
].join('\n');

/* ---------- write flow: split buttons, step links, report, run panel ---------- */
ctx.CSS += '\n' + [
  '.split{display:inline-flex;align-items:stretch}',
  '.split>.btn:first-child{border-top-right-radius:0;border-bottom-right-radius:0}',
  '.split>.splitmore{border-top-left-radius:0;border-bottom-left-radius:0;padding:0 7px;margin-left:-1px}',
  '.split>.splitmore.primary{border-left:1px solid rgba(255,255,255,.35)}',
  '.split>.btn.quiet:first-child+.splitmore{border-left:1px solid var(--line)}',
  '.step{position:relative}',
  '.step .steplink{position:absolute;inset:-5px -7px;border:0;background:none;border-radius:var(--r6);padding:0;cursor:pointer}',
  '.step.pick:hover span,.step.pick:focus-within span{color:var(--ink);text-decoration:underline;text-underline-offset:3px}',
  '.step.pick:hover .hx{background:var(--blue3)}',
  '.reportbox{margin-top:12px}',
  '.runt{display:flex;align-items:center;gap:8px;min-width:0}.pchip[hidden]{display:none}',
  '.runh{align-items:center}',
  '.savedrow{display:flex;justify-content:flex-end;margin:-6px 0 6px}.savednote:empty{display:none}.savednote{margin:-2px 0 8px}'
].join('\n');

/* ---------- v3.11 Hive theme: corners and depth for the shell's own parts (tokens in core/styles.js) ---------- */
ctx.CSS += '\n' + [
  '.menu{border-radius:4px;box-shadow:var(--elev)}.menu button,.pal li button,.viewsw button,.wseg button{border-radius:3px}',
  '.viewsw,.wseg,.modpill{border-radius:3px}.modpill{background:transparent}',
  '.gtile,.ccard,.lwrap,.gsec,.arrbar,.tip,.dock .dlabel{border-radius:4px}',
  '.arrbar,.dock .dlabel{box-shadow:var(--elev)}'
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
/* Where each area of this module sits: its saved position (Arrange mode) or the next free classic place. */
function areaSlots() {
  var used = {}, out = {};
  AREAS.forEach(function (a) { if (a.pos && ctx.Layout.validPos(a.pos) && !used[a.pos.join()]) { out[a.id] = a.pos; used[a.pos.join()] = 1; } });
  AREAS.forEach(function (a) { if (!out[a.id]) { var s = SLOTS.filter(function (p) { return !used[p.join()]; })[0]; out[a.id] = s; used[s.join()] = 1; } });
  return out;
}
/* Which of the 6 places around an area each of its tools takes. */
function toolSlots(area) {
  var used = {}, out = {}, ring = area.ring || [];
  area.tools.forEach(function (t) { var i = ring.indexOf(t); if (i >= 0 && i < 6 && !used[i]) { out[t] = i; used[i] = 1; } });
  area.tools.forEach(function (t) { if (out[t] == null) for (var i = 0; i < 6; i++) if (!used[i]) { out[t] = i; used[i] = 1; break; } });
  return out;
}
function initials(n) { n = String(n || '?').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean); return ((n[0] || '?')[0] + ((n[1] || '')[0] || '')).toUpperCase(); }

/* ---------------- appearance: theme (system / light / dark) + motion (full / calm / off) ----------------
 * Stored per browser in bft.theme, bft.motion, bft.motionFollow (core/util.js). A saved theme from earlier versions
 * keeps working; browsers with no saved theme follow the system. */
var Theme = {
  pref: function () { return U.themeChoice(); },
  resolved: function () {
    var p = this.pref();
    if (p !== 'system') return p;
    try { return window.matchMedia && matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'; } catch (e) { return 'dark'; }
  },
  set: function (v) { var ok = U.setPref('theme', v); this.apply(); return ok; },
  apply: function () { if (ctx.appEl) ctx.appEl.setAttribute('data-theme', this.resolved()); }
};
function motion() { return U.motion(); }
function applyMotion() {
  if (!ctx.appEl) return;
  var m = motion(), was = ctx.appEl.getAttribute('data-motion');
  ctx.appEl.setAttribute('data-motion', m);
  if (was && was !== m) {
    Goo.t = 0;
    Object.keys(cells).forEach(function (k) { untilt(cells[k]); stopAnims(cells[k]); });
    if (m === 'off') lightShow();
  }
}
// Both system settings are watched once per page (each bookmark click re-runs this file, so the listeners call
// whatever load is current instead of piling up); an open Appearance dialog redraws with the new state.
window.__bftSys = function (kind) {
  if (kind === 'theme' && Theme.pref() === 'system') Theme.apply();
  if (kind === 'motion') applyMotion();
  if (R.appearDraw) R.appearDraw();
};
if (window.matchMedia && !window.__bftSysOn) {
  window.__bftSysOn = true;
  try { matchMedia('(prefers-color-scheme: light)').addEventListener('change', function () { if (window.__bftSys) window.__bftSys('theme'); }); } catch (e) {}
  try { matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', function () { if (window.__bftSys) window.__bftSys('motion'); }); } catch (e) {}
}
function appearanceButton() {
  return h('button.iconbtn.appearbtn', { type: 'button', title: 'Appearance — theme and motion', 'aria-label': 'Appearance', 'aria-haspopup': 'dialog', onclick: function () { openAppearance(); } }, U.icon('sliders', 18));
}
var MOTION_TXT = {
  full: 'Cells flow on a spring and briefly merge while they move; hexagons lift and tilt slightly under the pointer.',
  calm: 'Short, settled movement: what stays on screen glides into place and new cells fade in where they belong.',
  off: 'No movement. Screens change with a short fade; hover and selection still show the honey edge.'
};
function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
/* Appearance dialog (user menu, top bar, sign-in card). Choosing Full or Calm while the system asks for reduced motion
 * needs an explicit confirmation; "Follow system again" hands control back to the system setting. */
function openAppearance() {
  closeMenus();
  if (R.appearOpen || !ctx.appEl) return;
  R.appearOpen = true;
  // UI.dialog restores focus to document.activeElement, which is the shadow host; remember the real button
  var opener = ctx.root.activeElement;
  return UI.dialog(function (box, close) {
    box.classList.add('appear');
    box.setAttribute('aria-label', 'Appearance');
    var msg = h('div.err', { role: 'status' });
    function saved(ok) { msg.textContent = ok ? '' : 'This browser blocked saving. The choice applies until APIary is closed.'; }
    function seg(key, label, opts, cur, pick) {
      return h('div.wseg', { role: 'radiogroup', 'aria-label': label, 'data-k': key }, opts.map(function (o) {
        return h('button', { type: 'button', role: 'radio', 'aria-checked': o[0] === cur ? 'true' : 'false', onclick: function () { pick(o[0]); } }, o[1]);
      }));
    }
    function refocus(sel) { if (!sel) return; var f = box.querySelector(sel); if (f) f.focus(); }
    function pickMotion(v) {
      if (v !== 'off' && U.osReducedMotion() && U.motionFollow()) return confirmOverride(v);
      saved(U.setMotion(v)); applyMotion(); main('[data-k=motion] [aria-checked=true]');
    }
    function confirmOverride(v) {
      var keep = h('button.btn.quiet', { type: 'button', onclick: function () { main('[data-k=motion] [aria-checked=true]'); } }, 'Keep reduced motion');
      U.swap(box,
        h('h2', 'Your system asks for reduced motion'),
        h('p.muted', 'Your operating system is set to reduce motion. Use ', h('b', cap(v)), ' motion in APIary anyway? You can choose “Follow system again” in Appearance at any time.'),
        h('div.acts', keep, h('button.btn.primary.overridebtn', { type: 'button', onclick: function () { saved(U.setMotion(v, false)); applyMotion(); main('[data-k=motion] [aria-checked=true]'); } }, 'Use ' + cap(v) + ' anyway')));
      keep.focus();
    }
    function main(focusSel) {
      var tp = Theme.pref(), eff = motion(), os = U.osReducedMotion(), follow = U.motionFollow(), choice = U.motionChoice();
      var note = null;
      if (os && follow) note = h('div.sysnote', U.icon('monitor', 16), h('div', 'Your system asks for reduced motion, so APIary uses ', h('b', 'Off'), '. Choosing Full or Calm asks first.'));
      else if (!follow) note = h('div.sysnote', U.icon('monitor', 16), h('div',
        os ? ['You chose ', h('b', cap(choice)), ' although your system asks for reduced motion.'] : ['Your system’s reduced-motion setting is overridden: APIary keeps ', h('b', cap(choice)), ' if the system asks for less motion.'],
        h('button.linkbtn.followbtn', { type: 'button', onclick: function () { saved(U.setPref('motionFollow', true)); applyMotion(); main('[data-k=motion] [aria-checked=true]'); } }, 'Follow system again')));
      var demo = h('div.apdemo', { 'aria-hidden': 'true' });
      for (var i = 0; i < 5; i++) { var el = h('i' + (i === 2 ? '.h' : '')); el.style.left = (40 + i * 58) + 'px'; demo.appendChild(el); }
      U.swap(box,
        h('h2', 'Appearance'),
        h('p.muted', { style: { margin: 0 } }, 'Saved in this browser.'),
        h('div.opt', h('div.lab', 'Theme', h('span', tp === 'system' ? 'Following system · ' + cap(Theme.resolved()) : '')),
          seg('theme', 'Theme', [['system', 'System'], ['light', 'Light'], ['dark', 'Dark']], tp, function (v) { saved(Theme.set(v)); main('[data-k=theme] [aria-checked=true]'); })),
        h('div.opt', h('div.lab', 'Motion', h('span', os && follow ? 'Reduced by your system' : '')),
          seg('motion', 'Motion', [['full', 'Full'], ['calm', 'Calm'], ['off', 'Off']], eff, pickMotion),
          h('div.optdesc', MOTION_TXT[eff]), note, demo),
        msg,
        h('div.acts', h('button.btn.sm', { type: 'button', onclick: function () { playDemo(demo); } }, U.icon('retry', 14), 'Replay'), h('span', { style: { flex: '1' } }),
          h('button.btn.primary', { type: 'button', onclick: function () { close(true); } }, 'Done')));
      playDemo(demo);
      refocus(focusSel);
    }
    R.appearDraw = function () { main(); };
    main();
  }).then(function () {
    R.appearOpen = false; R.appearDraw = null;
    setTimeout(function () { if (opener && opener.isConnected) try { opener.focus(); } catch (e) {} }, 220);
  });
}
function playDemo(d) {
  var m = motion();
  Array.prototype.forEach.call(d.querySelectorAll('i'), function (c, i) {
    if (!c.animate) return;
    if (m === 'full') c.animate([{ transform: 'translateX(' + (2 - i) * 58 + 'px) scale(.3)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 800, easing: 'cubic-bezier(.45,1.35,.4,1)', delay: i * 45, fill: 'backwards' });
    else if (m === 'calm') c.animate([{ transform: 'scale(.94)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 280, easing: 'cubic-bezier(.22,1,.36,1)', delay: 60 + Math.abs(i - 2) * 24, fill: 'backwards' });
    else c.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 120, fill: 'backwards' });
  });
}

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
  // theme and motion are set before the first paint (.app stays transparent until 'in')
  var app = h('div.app', { 'data-theme': Theme.resolved(), 'data-motion': motion() });
  root.appendChild(app);
  ctx.host = host; ctx.root = root; ctx.appEl = app;
  Theme.apply(); applyMotion();
  R.toasts = h('div.toasts');
  app.appendChild(R.toasts);
  app.style.setProperty('--dockhex', 'path("' + hexPath(58, 66) + '")');
  app.style.setProperty('--dockhex2', 'path("' + hexPath(55, 63) + '")');
  buildDock();
  requestAnimationFrame(function () { app.classList.add('in'); });
  return app;
}

/* ---------------- minimize ----------------
 * The overlay stays in the page with everything in it (open tool, loaded file, review, results); only its look
 * steps aside. A honey button (draggable, position remembered) brings it back; so does clicking the bookmark. */
function buildDock() {
  R.dockIco = h('span');
  R.dockHex = h('button.dhex', { type: 'button', 'aria-label': 'Open APIary', tabIndex: -1 }, R.dockIco);   // focusable only while minimized
  R.dockLabel = h('div.dlabel');
  R.dock = h('div.dock', { 'aria-hidden': 'true' }, R.dockHex, R.dockLabel);
  ctx.appEl.appendChild(R.dock);
  var pos = U.store.get('dockPos', null);
  function place(p) {
    var W = window.innerWidth, H = window.innerHeight;
    p = p || { x: W - 84, y: H - 96 };
    p.x = Math.max(8, Math.min(W - 66, p.x)); p.y = Math.max(8, Math.min(H - 74, p.y));
    R.dock.style.left = p.x + 'px'; R.dock.style.top = p.y + 'px';
    R.dock.classList.toggle('left', p.x < W / 2);
    return p;
  }
  R.placeDock = function () { pos = place(pos); };
  R.placeDock();
  var start = null, moved = false;
  R.dockHex.addEventListener('pointerdown', function (e) {
    start = { x: e.clientX, y: e.clientY, px: pos ? pos.x : R.dock.offsetLeft, py: pos ? pos.y : R.dock.offsetTop }; moved = false;
    R.dockHex.setPointerCapture(e.pointerId);
  });
  R.dockHex.addEventListener('pointermove', function (e) {
    if (!start) return;
    var dx = e.clientX - start.x, dy = e.clientY - start.y;
    if (!moved && Math.abs(dx) + Math.abs(dy) < 5) return;
    moved = true; R.dock.classList.add('drag');
    pos = place({ x: start.px + dx, y: start.py + dy });
  });
  R.dockHex.addEventListener('pointerup', function () {
    if (!start) return;
    start = null; R.dock.classList.remove('drag');
    if (moved) U.store.set('dockPos', pos); else restore();
  });
  R.dockHex.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); restore(); } });
}
function dockText() {
  if (!R.dock) return;
  var mod = moduleById(S.module), left = Api.state.token ? Api.minutesLeft() : null;
  var where = S.level === 'tool' && TOOLS[S.tool] ? TOOLS[S.tool].name : S.level === 'area' && areaById(S.area) ? areaById(S.area).name : S.level === 'login' ? 'Sign in' : (mod ? mod.name : 'APIary');
  U.swap(R.dockIco, U.icon(S.level === 'tool' && TOOLS[S.tool] && TOOLS[S.tool].icon ? TOOLS[S.tool].icon : mod ? mod.icon : 'home', 20), h('b', left != null ? left + 'm' : '—'));
  U.swap(R.dockLabel, 'APIary · ' + where, h('span', (left != null ? left + ' min left · ' : ctx.adminConsole ? 'Admin console · ' : 'Signed out · ') + 'click to open, drag to move'));
  R.dock.classList.toggle('low', left != null && left <= 10);
}
function minimize() {
  if (!ctx.appEl || ctx.appEl.classList.contains('min')) return;
  hidePeek(); hideTip(); closeMenus();
  dockText(); R.placeDock();
  ctx.appEl.classList.add('min');
  R.dock.setAttribute('aria-hidden', 'false'); R.dockHex.tabIndex = 0;
  R.minimized = true;
}
function restore() {
  if (!ctx.appEl) return;
  ctx.appEl.classList.remove('min');
  R.dock.setAttribute('aria-hidden', 'true'); R.dockHex.tabIndex = -1;
  R.minimized = false;
  if (S.level !== 'login' && S.level !== 'tool') layout({ instant: true });
}
function isMinimized() { return !!R.minimized; }

/* ---------------- login ---------------- */
/* Browser-saved passwords (Credential Management API: Chrome and Edge). The browser shows its own account picker and
 * hands back the Beeforce password it saved for this site; APIary only fills the sign-in card. It never stores the
 * password itself and never signs in on its own, so the Production / UAT choice stays a deliberate click.
 * Browsers without the API (Firefox, Safari) keep their own autofill, if any. */
var Saved = {
  ok: function () { return !!(window.PasswordCredential && navigator.credentials && navigator.credentials.get); },
  get: function (mediation) {
    if (!this.ok()) return Promise.resolve(null);
    try {
      return navigator.credentials.get({ password: true, mediation: mediation || 'optional' })
        .then(function (c) { return c && c.type === 'password' && c.id && c.password ? c : null; }, function () { return null; });
    } catch (e) { return Promise.resolve(null); }
  },
  /* After a successful sign-in the browser may offer to save or update the password. Skipped when this page belongs to
   * the other Beeforce environment (a UAT password must not be saved for the Production site, or the reverse). */
  store: function (env, id, password) {
    if (!this.ok() || !navigator.credentials.store) return;
    var envs = ctx.CONFIG.ENVIRONMENTS || {}, host = location.host;
    var other = Object.keys(envs).some(function (k) { try { return k !== env && new URL(envs[k].url).host === host; } catch (e) { return false; } });
    if (other) return;
    try { navigator.credentials.store(new PasswordCredential({ id: id, password: password, name: id })).catch(function () {}); } catch (e) {}
  }
};
function showLogin(msg, forceSetup) {
  S.level = 'login';
  var app = ctx.appEl;
  Array.prototype.slice.call(app.children).forEach(function (c) { if (c !== R.toasts && c !== R.dock) c.remove(); });
  R.toolbar = null;

  var env = U.store.get('env', 'production');
  var deco = h('div.lhex'), mo = motion();
  [[0.14, 0.2, ''], [0.22, 0.42, 'b'], [0.08, 0.62, ''], [0.8, 0.18, ''], [0.88, 0.4, 'y'], [0.74, 0.62, 'b'], [0.9, 0.8, ''], [0.18, 0.84, '']].forEach(function (p, i) {
    var el = h('i' + (p[2] ? '.' + p[2] : ''));
    el.style.left = 'calc(' + (p[0] * 100) + '% - 75px)';
    el.style.top = 'calc(' + (p[1] * 100) + '% - 86px)';
    // the background hexagons settle in: full = the original slow bloom, calm = a short fade-in, off = already there
    if (mo !== 'off') {
      el.style.transition = mo === 'full' ? 'transform 1.2s var(--ease), opacity 1.2s' : 'transform .5s var(--settle), opacity .5s';
      el.style.transform = mo === 'full' ? 'scale(.6) rotate(-8deg)' : 'scale(.94)'; el.style.opacity = '0';
      setTimeout(function () { el.style.transform = ''; el.style.opacity = ''; }, mo === 'full' ? 60 + i * 70 : 40 + i * 30);
    }
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
  var err = h('div.err', { role: 'alert' }, msg || '');
  var go = h('button.btn.primary', { type: 'submit', style: { width: '100%', marginTop: '4px' } }, h('span', 'Sign in'));
  // saved password: asked for automatically when the card opens (once per tab if nothing came back), or from the link
  var savedNote = h('div.small.muted.savednote', { role: 'status' });
  var savedLink = Saved.ok() ? h('button.linkbtn.savedpw', { type: 'button', onclick: function () { fetchSaved('required'); } }, 'Use a saved password') : null;
  var filled = false;
  function fetchSaved(mediation) {
    return Saved.get(mediation).then(function (c) {
      if (!c) {
        if (mediation === 'optional') try { sessionStorage.setItem('bft.pwAsked', '1'); } catch (x) {}
        else savedNote.textContent = 'No saved password was picked. Your browser keeps the passwords saved for ' + location.host + '.';
        return;
      }
      if (!card.contains(form) || (mediation === 'optional' && pass.value)) return;   // setup open, or already typing
      user.value = c.id; pass.value = c.password; filled = true;
      savedNote.textContent = 'Filled from the password your browser saved for ' + location.host + '. Check Production / UAT, then sign in.';
      err.textContent = '';
      go.focus();
    });
  }

  var form = h('form', { novalidate: true },
    h('div.brand', h('div.mark'), 'APIary'),
    h('h2', 'Sign in'),
    h('p.muted', { style: { margin: 0 } }, 'Use your Beeforce admin account. Pick where the changes should go.'),
    h('div.seg', segP, segU),
    UI.field('Username', user),
    UI.field('Password', h('div.pw', pass, eye)),
    savedLink ? h('div.savedrow', savedLink) : null, savedNote,
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
        leaveLogin();
        return;
      }
      var su = user.value.trim(), sp = pass.value;
      await Api.signIn(env, su, sp);
      Saved.store(env, su, sp); sp = null;
      U.store.set('env', env); U.store.set('user', su);
      ctx.Audit.startSession(user.value.trim(), Api.envLabel());
      leaveLogin();
    } catch (ex) {
      U.swap(err, ex.message);
      if (ex.code === 'NO_CLIENT' || ex.code === 'BAD_CLIENT') err.appendChild(h('div', h('button.linkbtn', { type: 'button', onclick: function () { openSetup(false); } }, 'Check the sign-in client setup →')));
      go.disabled = false; U.swap(go, h('span', 'Sign in'));
      form.animate && !U.reducedMotion() && form.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-6px)' }, { transform: 'translateX(6px)' }, { transform: 'translateX(0)' }], { duration: 260 });
    }
  });
  var close = h('div', { style: { position: 'absolute', right: '16px', top: '14px', display: 'flex', gap: '6px' } }, appearanceButton(),
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
  else {
    setTimeout(function () { if (!filled) (user.value ? pass : user).focus(); }, 50);
    var asked = null; try { asked = sessionStorage.getItem('bft.pwAsked'); } catch (x) {}
    if (!asked) fetchSaved('optional');
  }
}
function restart(el) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
/* Signed in: the card fades out (not in Off motion), then the main shell is built. */
function leaveLogin() {
  var off = U.reducedMotion();
  if (!off) {
    R.login.style.transition = motion() === 'full' ? 'opacity .35s var(--ease), transform .45s var(--ease)' : 'opacity .2s var(--ease), transform .24s var(--settle)';
    R.login.style.opacity = '0'; R.login.style.transform = 'scale(.98)';
  }
  setTimeout(function () { buildMain(true); }, off ? 0 : motion() === 'full' ? 280 : 180);
}

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
  Array.prototype.slice.call(app.children).forEach(function (c) { if (c !== R.toasts && c !== R.dock) c.remove(); });
  cells = {};
  views = {};
  ctx.Layout.build();
  TOOLS = ctx.TOOLS;
  scope();

  var st = Api.state;
  R.crumb = h('div.crumb');
  R.env = ctx.adminConsole ? h('div.envpill.adm', h('i'), 'Admin console') : h('div.envpill' + (st.env === 'uat' ? '.uat' : ''), h('i'), Api.envLabel());
  var who = h('button.who', { type: 'button', title: 'Signed in as ' + st.user, 'aria-haspopup': 'menu', 'aria-expanded': 'false', onclick: function (e) { e.stopPropagation(); userMenu(who); } }, h('div.av', initials(st.user)), h('span', st.user));
  var whoWrap = h('div.modwrap', who);
  R.modPill = h('div.modwrap.modslot');
  R.viewSw = h('div.viewsw', { role: 'group', 'aria-label': 'View' });
  // v3.6.1 top bar: view switch, environment, user, then Search · Appearance · Arrange · Minimize · Close
  var top = h('div.top',
    h('div.brand', h('div.mark'), 'APIary'),
    R.modPill, R.crumb, h('span.topgap'), R.viewSw, R.env, whoWrap,
    h('button.iconbtn', { type: 'button', title: 'Search tools (Ctrl K)', 'aria-label': 'Search tools', 'aria-keyshortcuts': 'Control+K', onclick: openPalette }, U.icon('search', 18)),
    appearanceButton(),
    R.arrBtn = h('button.iconbtn.arrbtn', { type: 'button', title: 'Arrange — drag hexagons to rearrange', 'aria-label': 'Arrange', 'aria-pressed': 'false', onclick: function () { setArrange(!S.arrange); } }, U.icon('move', 18)),
    h('button.iconbtn.minbtn', { type: 'button', title: 'Minimize — back to Beeforce; everything stays as it is', 'aria-label': 'Minimize', onclick: minimize }, U.icon('minimize', 18)),
    h('button.iconbtn', { type: 'button', title: 'Close APIary (you stay signed in; it reopens where you were)', 'aria-label': 'Close', onclick: hide }, U.icon('x', 18)));

  R.homePane = h('div.sidepane');
  R.areaPane = h('div.sidepane.areapane.off');
  R.toolPane = h('div.sidepane.toolpane.off');
  R.side = h('div.side', R.homePane, R.areaPane, R.toolPane);
  R.peek = h('div.peek', { 'aria-live': 'polite' });   // floating area summary next to the hovered / focused area
  R.stage = h('div.stage');
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
  R.slotLayer = h('div.slotlayer');
  R.light = h('div.backlight');
  R.arrBar = h('div.arrbar');
  S.arrange = false;
  R.body = h('div.body', defs, R.side, R.modHead, R.modFoot, R.light, R.slotLayer, R.stage, R.arrBar, R.gallery, R.peek, R.tip, R.work);
  app.insertBefore(top, R.toasts);
  app.insertBefore(R.body, R.toasts);
  R.lastL = null;

  buildCells();
  wireLight();
  drawModulePill(); drawViewSwitch(); markAdmin();
  S.level = 'home'; S.area = null; S.tool = null;
  drawHomePane();

  // first frame: everything gathered at the hub, then bloom out
  layout({ intro: true });
  // After sign-in: the module page. Re-opening the bookmark in the same session goes straight back to the module.
  var live = (ctx.MODULES || []).some(function (m) { return m.id === S.module; });
  var toModules = fromLogin && !ctx.adminConsole && (ctx.MODULE_LIST || []).length > 0 && !(U.store.get('skipModules', false) && live);
  var then = R.afterBuild; R.afterBuild = null;
  // Re-opened in the same session (after Close): go back to the area / tool you were on.
  if (!then && !fromLogin && !ctx.adminConsole) {
    var pl = null; try { pl = JSON.parse(sessionStorage.getItem('bft.place') || 'null'); } catch (x) {}
    if (pl && (pl.level === 'area' || pl.level === 'tool') && anyAreaById(pl.area) && (pl.level === 'area' || (TOOLS[pl.tool] && areaOf(pl.tool)))) then = [pl.level, pl.area, pl.tool];
  }
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
  c._bw = w; c._bh = hh; c._id = id;
  c.addEventListener('click', function (e) { if (R.justDragged) return; if (!c.classList.contains('gone')) onClick && onClick(e); });
  c.addEventListener('pointerdown', function (e) { if (S.arrange) dragStart(e, c); });
  c.addEventListener('mousemove', function (e) { tilt(c, e); });
  c.addEventListener('mouseenter', function () { lightFor(c); });
  c.addEventListener('mouseleave', function () { untilt(c); lightOff(c); });
  c.addEventListener('focus', function () { if (c.matches(':focus-visible')) lightFor(c); });
  c.addEventListener('blur', function () { lightOff(c); });
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
  if (S.arrange) R.targets = list.map(function (m, i) { return { index: i, x: L['m:' + m.id].x, y: L['m:' + m.id].y, w: tw, occ: 'm:' + m.id }; });
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
    var sl = areaSlots();
    // scale so every used place (or, while arranging, every possible place) fits
    var pts = S.arrange ? SLOTS : AREAS.map(function (a) { return sl[a.id]; }).concat([[1, 0], [0, 1], [-1, 1], [-1, 0], [1, -1], [0, -1]]);
    var mx = 0, mr = 0; pts.forEach(function (p) { mx = Math.max(mx, Math.abs(p[0] + p[1] / 2)); mr = Math.max(mr, Math.abs(p[1])); });
    var k = Math.min(1, (W - SIDE - 60) / (368 * mx + 238), (H - 40) / (319 * mr + 251));
    var w = 168 * k, gap = 16 * k;
    hubAt = { x: cx, y: cy };
    L.hub = place('hub', cx, cy, w);
    if (S.arrange) R.targets = SLOTS.map(function (s) {
      var q = axial(s[0], s[1], w, gap, cx, cy), occ = AREAS.filter(function (a) { return sl[a.id].join() === s.join(); })[0];
      return { slot: s, x: q.x, y: q.y, w: w, occ: occ ? 'a:' + occ.id : null };
    });
    AREAS.forEach(function (a, i) {
      var p = axial(sl[a.id][0], sl[a.id][1], w, gap, cx, cy);
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
    var ts = toolSlots(area), taken = {};
    area.tools.forEach(function (t, i) {
      var s = ts[t]; taken[s] = t;
      L['t:' + t] = place('t:' + t, slots[s].x, slots[s].y, 168 * k2);
      L['t:' + t].d = 140 + i * 55;
    });
    if (S.arrange) R.targets = slots.map(function (p, i) { return { index: i, x: p.x, y: p.y, w: 168 * k2, occ: taken[i] ? 't:' + taken[i] : null }; });
    var gi = 0;
    for (var s = 0; s < 6; s++) {
      if (taken[s] != null || S.arrange) continue;   // while arranging, empty places are drop targets instead
      L['g:' + gi] = place('g:' + gi, slots[s].x, slots[s].y, 168 * k2, gi === 0 ? 1 : 0.55);
      L['g:' + gi].d = 140 + s * 55;
      if (gi === 0) L['g:' + gi].back = 1;
      gi++;
    }
    for (; gi < 6; gi++) { L['g:' + gi] = place('g:' + gi, cx, cy, 40, 0); L['g:' + gi].gone = 1; }
    // mini-map at top of the side panel
    var mcx = SIDE / 2, mcy = 150, mw = 46, mg = 5;
    L.hub = place('hub', mcx, mcy, mw); L.hub.mini = 1;
    var msl = areaSlots();
    AREAS.forEach(function (a, i) {
      var p = axial(msl[a.id][0], msl[a.id][1], mw, mg, mcx, mcy);
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
  var tx = TRAIL.tx, ty = TRAIL.ty, step = TRAIL.step, tw = TRAIL.tw;
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

function cellTf(c, p, k) { return 'translate(' + Math.round(p.x - c._bw / 2) + 'px,' + Math.round(p.y - c._bh / 2) + 'px) scale(' + (p.w / c._bw * (k || 1)).toFixed(4) + ')'; }
/* Cancel this cell's scripted (calm / off) animations; CSS transitions (full) are left alone. */
function stopAnims(c) {
  if (!c || !c.getAnimations) return;
  c.getAnimations().forEach(function (a) {
    if ((window.CSSTransition && a instanceof CSSTransition) || (window.CSSAnimation && a instanceof CSSAnimation)) return;
    a.cancel();
  });
}
var CALM = 'cubic-bezier(.22,1,.36,1)';
function layout(opts) {
  opts = opts || {};
  R.targets = null;
  var prevL = R.lastL || {};
  var L = computeLayout(opts);
  var mo = motion(), rm = mo !== 'full';
  var maxD = 0;
  R.lastL = L;
  Object.keys(cells).forEach(function (id) {
    var c = cells[id], p = L[id];
    if (!p) return;
    stopAnims(c);
    maxD = Math.max(maxD, p.d || 0);
    c.style.transitionDelay = rm || opts.instant ? '0ms' : (p.d || 0) + 'ms';
    var tf = cellTf(c, p);
    c.style.transform = tf;
    c.style.opacity = String(p.o);
    c.classList.toggle('gone', !!p.gone || p.o === 0);
    c.classList.toggle('mini', !!p.mini);
    c.classList.toggle('sel', !!p.sel);
    c.classList.toggle('cur', !!p.cur);
    c.classList.toggle('back', !!p.back);
    c.tabIndex = p.gone || p.o === 0 || (id.indexOf('g:') === 0 && !p.back) ? -1 : 0;
    c.setAttribute('aria-hidden', p.gone || p.o === 0 ? 'true' : 'false');
    // full: the CSS transition on .cell does the move. calm / off: scripted from the previous place.
    var q = prevL[id];
    if (opts.instant || mo === 'full' || !q || !c.animate) return;
    var was = q.o > 0, is = p.o > 0;
    if (mo === 'calm') {
      if (was && is) { if (q.x !== p.x || q.y !== p.y || q.w !== p.w) c.animate([{ transform: cellTf(c, q) }, { transform: tf }], { duration: 380, easing: CALM, delay: Math.min((p.d || 0) * 0.3, 60), fill: 'backwards' }); }
      else if (is) c.animate([{ transform: cellTf(c, p, 0.94), opacity: 0 }, { transform: tf, opacity: p.o }], { duration: 280, easing: CALM, delay: 60 + Math.round(Math.min(p.d || 0, 600) * 0.4), fill: 'backwards' });
      else if (was) c.animate([{ transform: cellTf(c, q), opacity: q.o }, { transform: cellTf(c, q, 0.96), opacity: 0 }], { duration: 160, easing: 'cubic-bezier(.4,0,1,1)' });
    } else if (is && !was) c.animate([{ opacity: 0 }, { opacity: p.o }], { duration: 120, easing: 'linear' });
  });
  markMovable();
  drawSlotMarks();
  if (opts.instant) void R.stage.offsetWidth; // commit, so the next layout animates from here
  else if (!rm) { flow(maxD + 950); R.settleAt = Date.now() + maxD + 650; }
  else R.settleAt = Date.now() + (mo === 'calm' ? 420 : 0);
}

/* ---------------- arrange (drag and drop) ----------------
 * Arrange mode: areas can be dropped on any of the 18 places around the hub (drop on another area = swap), tools on any
 * of the 6 places around their area, module tiles anywhere in the row. Every drop is saved in this browser
 * (core/layout.js: area.pos, area.ring, module order); admins can download it as the team's layout.json. */
function setArrange(on, quiet) {
  if (on && (ctx.adminConsole || S.level === 'tool' || S.level === 'login')) return;
  if (on && S.level === 'home' && S.view !== 'honeycomb') { S.view = 'honeycomb'; U.store.set('view', 'honeycomb'); drawViewSwitch(); R.gallery.classList.remove('on'); }
  S.arrange = !!on;
  hidePeek(); hideTip();
  Object.keys(cells).forEach(function (k) { untilt(cells[k]); });
  R.stage.classList.toggle('arranging', S.arrange);
  lightShow();
  if (R.arrBtn) R.arrBtn.setAttribute('aria-pressed', S.arrange ? 'true' : 'false');
  layout();
  drawArrangeBar();
  if (!quiet && S.arrange && !U.store.get('arrangeTipSeen', false)) { U.store.set('arrangeTipSeen', true); UI.toast('Drag a hexagon to a new place. Changes save in this browser as you go.'); }
}
function movable(id) {
  if (!S.arrange) return false;
  if (S.level === 'home') return id.indexOf('a:') === 0 && id !== 'a:settings';
  if (S.level === 'area') return id.indexOf('t:') === 0 && (areaById(S.area) || { tools: [] }).tools.indexOf(id.slice(2)) >= 0;
  if (S.level === 'modules') return id.indexOf('m:') === 0;
  return false;
}
function markMovable() {
  Object.keys(cells).forEach(function (id) {
    var on = movable(id) && !cells[id].classList.contains('gone');
    cells[id].classList.toggle('canmove', on);
    if (on && !cells[id].style.getPropertyValue('--jd')) cells[id].style.setProperty('--jd', (-Math.random() * 1.6).toFixed(2) + 's');
  });
}
function drawSlotMarks() {
  if (!R.slotLayer) return;
  var list = S.arrange && R.targets ? R.targets.filter(function (t) { return !t.occ; }) : [];
  U.swap(R.slotLayer, list.map(function (t) {
    var w = t.w, hh = w * 1.1547;
    var m = h('div.slotmark', { style: { left: (t.x - w / 2) + 'px', top: (t.y - hh / 2) + 'px', width: w + 'px', height: hh + 'px' } });
    m.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + hh + '" width="' + w + '" height="' + hh + '"><path d="' + hexPath(w - 4, hh - 4) + '" transform="translate(2 2)"/></svg>';
    t.mark = m;
    return m;
  }));
}
function drawArrangeBar() {
  if (!R.arrBar) return;
  var show = S.arrange && S.level !== 'tool';
  R.arrBar.classList.toggle('on', show);
  if (R.arrBtn) R.arrBtn.style.display = ctx.adminConsole || S.level === 'tool' ? 'none' : '';
  if (!show) return;
  var what = S.level === 'modules' ? 'Drag module tiles to change their order.' : S.level === 'area' ? 'Drag tools to any place around ' + ((areaById(S.area) || {}).name || 'the area') + '.' : 'Drag areas to any place around the hub. Drop on another area to swap. Click an area to arrange its tools.';
  U.swap(R.arrBar, U.icon('move', 18), h('span', what),
    UI.btn('Reset', { sm: true, kind: 'quiet', icon: 'retry', onClick: resetArrangement }),
    ctx.Layout.isAdmin() ? UI.btn('Team file', { sm: true, kind: 'quiet', icon: 'download', onClick: downloadTeamLayout }) : null,
    UI.btn('Done', { sm: true, kind: 'primary', icon: 'check', onClick: function () { setArrange(false); } }));
}
var drag = null;
function dragStart(e, c) {
  if (!movable(c._id) || c.classList.contains('gone') || e.button > 0) return;
  var p = R.lastL && R.lastL[c._id]; if (!p) return;
  drag = { c: c, id: c._id, x0: e.clientX, y0: e.clientY, px: p.x, py: p.y, s: p.w / c._bw, moved: false, target: null };
  try { c.setPointerCapture(e.pointerId); } catch (x) {}
  c.addEventListener('pointermove', dragMove);
  c.addEventListener('pointerup', dragEnd);
  c.addEventListener('pointercancel', dragEnd);
}
function dragMove(e) {
  if (!drag) return;
  var dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
  if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 6) return;
  var c = drag.c;
  if (!drag.moved) { drag.moved = true; c.classList.add('dragging'); hidePeek(); }
  var x = drag.px + dx, y = drag.py + dy;
  drag.cx = x; drag.cy = y;
  c.style.transitionDelay = '0ms';
  c.style.transform = 'translate(' + Math.round(x - c._bw / 2) + 'px,' + Math.round(y - c._bh / 2) + 'px) scale(' + (drag.s * 1.08).toFixed(4) + ')';
  var best = null, bd = Infinity;
  (R.targets || []).forEach(function (t) { var d = Math.hypot(t.x - x, t.y - y); if (d < bd) { bd = d; best = t; } });
  if (best && (bd > best.w * 0.75 || best.occ === drag.id)) best = null;
  if (drag.target !== best) {
    if (drag.target) { if (drag.target.mark) drag.target.mark.classList.remove('hot'); if (drag.target.occ && cells[drag.target.occ]) cells[drag.target.occ].classList.remove('swapme'); }
    drag.target = best;
    if (best) { if (best.mark) best.mark.classList.add('hot'); if (best.occ && cells[best.occ]) cells[best.occ].classList.add('swapme'); }
  }
}
function dragEnd() {
  if (!drag) return;
  var d = drag; drag = null;
  d.c.removeEventListener('pointermove', dragMove); d.c.removeEventListener('pointerup', dragEnd); d.c.removeEventListener('pointercancel', dragEnd);
  d.c.classList.remove('dragging');
  Object.keys(cells).forEach(function (k) { cells[k].classList.remove('swapme'); });
  if (!d.moved) return;
  R.justDragged = true; setTimeout(function () { R.justDragged = false; }, 0);
  // the dropped cell settles from where it was let go (calm / off animate from the last layout)
  if (R.lastL && R.lastL[d.id] && d.cx != null) R.lastL[d.id] = place(d.id, d.cx, d.cy, R.lastL[d.id].w * 1.08, 1);
  if (d.target) dropOn(d.id, d.target);
  layout();
}
function saveArrangement(mutate) {
  var m = ctx.Layout.effective();
  mutate(m);
  var errs = ctx.Layout.saveLocal(m);
  if (errs.length) { UI.toast(errs[0], 'bad'); return false; }
  ctx.Layout.build(); TOOLS = ctx.TOOLS; scope();
  return true;
}
function dropOn(id, t) {
  if (S.level === 'home') {
    var sl = areaSlots(), from = sl[id.slice(2)];
    if (t.occ) sl[t.occ.slice(2)] = from;
    sl[id.slice(2)] = t.slot;
    saveArrangement(function (m) { m.areas.forEach(function (a) { if (sl[a.id] && a.module === S.module) a.pos = sl[a.id].slice(); }); });
  } else if (S.level === 'area') {
    var area = areaById(S.area), ts = toolSlots(area), ring = ['', '', '', '', '', ''];
    var tool = id.slice(2), fromI = ts[tool];
    if (t.occ) ts[t.occ.slice(2)] = fromI;
    ts[tool] = t.index;
    Object.keys(ts).forEach(function (k) { ring[ts[k]] = k; });
    saveArrangement(function (m) { m.areas.forEach(function (a) { if (a.id === area.id) a.ring = ring; }); });
  } else if (S.level === 'modules') {
    var ids = (ctx.MODULE_LIST || []).map(function (x) { return x.id; }), mid = id.slice(2);
    ids.splice(ids.indexOf(mid), 1); ids.splice(t.index, 0, mid);
    saveArrangement(function (m) {
      // visible modules take the new order; hidden ones keep their places in between
      var vis = ids.map(function (i) { return m.modules.filter(function (x) { return x.id === i; })[0]; }).filter(Boolean), k = 0;
      m.modules = m.modules.map(function (x) { return ids.indexOf(x.id) >= 0 ? vis[k++] : x; });
    });
  }
}
async function resetArrangement() {
  var what = S.level === 'modules' ? 'the module order' : S.level === 'area' ? 'the tool places in ' + areaById(S.area).name : 'the area places in ' + ((moduleById(S.module) || {}).name || 'this module');
  if (!(await UI.confirm({ title: 'Reset ' + what + '?', body: 'Back to the team / built-in arrangement. Only this browser is affected.', verb: 'Reset' }))) return;
  var base = ctx.Layout.base();
  saveArrangement(function (m) {
    if (S.level === 'modules') {
      var order = base.modules.map(function (x) { return x.id; });
      m.modules.sort(function (a, b) { var i = order.indexOf(a.id), j = order.indexOf(b.id); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j); });
    } else m.areas.forEach(function (a) {
      var b = base.areas.filter(function (x) { return x.id === a.id; })[0] || {};
      if (S.level === 'area' && a.id === S.area) { if (b.ring) a.ring = b.ring.slice(); else delete a.ring; }
      if (S.level === 'home' && a.module === S.module) { if (b.pos) a.pos = b.pos.slice(); else delete a.pos; }
    });
  });
  layout();
  UI.toast('Arrangement reset.');
}
function downloadTeamLayout() {
  var data = ctx.Layout.exportRepo(ctx.Layout.effective());
  var a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2) + '\n'], { type: 'application/json' }));
  a.download = 'layout.json'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  ctx.Audit.onDownload('layout.json');
  UI.toast('layout.json downloaded. Commit it next to index.js to give everyone this arrangement.');
}

/* ---------------- Lightbox (backlight) ----------------
 * A soft sky-blue light switches on behind the hexagon under the pointer (or keyboard focus) and fades out when you
 * leave it. It sits behind the cells, so it shows as a glow through the gaps around that hexagon. It does not follow
 * the pointer anywhere else. */
var LB = { cell: null, x: null, y: null, timer: null };
function lightFor(c) {
  if (!R.light || !c || S.arrange || c.classList.contains('gone') || c.classList.contains('mini') || (c.classList.contains('ghost') && !c.classList.contains('back'))) return;
  if (S.level === 'tool' || ctx.appEl.classList.contains('min') || motion() === 'off') return;
  clearTimeout(LB.timer);
  var r = c.getBoundingClientRect(), b = R.body.getBoundingClientRect();
  var x = r.left - b.left + r.width / 2, y = r.top - b.top + r.height / 2, k = (r.width * 2.7 / 520).toFixed(3);
  // first light of a visit appears in place; moving to a neighbour slides it over quickly
  if (!R.light.classList.contains('on')) { R.light.style.transition = 'none'; R.light.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + k + ')'; void R.light.offsetWidth; R.light.style.transition = ''; }
  R.light.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + k + ')';
  R.light.classList.add('on');
  LB.cell = c;
}
function lightOff(c) {
  if (!R.light || (c && LB.cell !== c)) return;
  clearTimeout(LB.timer);
  LB.timer = setTimeout(function () { R.light.classList.remove('on'); LB.cell = null; }, 60);
}
// Navigation moves the cells away, so the light goes out; it comes back on the next hover.
function lightShow() { if (R.light) { clearTimeout(LB.timer); R.light.classList.remove('on'); LB.cell = null; } }
function wireLight() {}

/* ---------------- liquid motion + hover tilt ---------------- */
var Goo = { v: 0, t: 0, run: false, timer: null };
function flow(ms) {
  if (!R.blur || motion() !== 'full') return;
  Goo.t = 7; clearTimeout(Goo.timer);   // v3.7: softer merge (was 11)
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
  if (S.arrange || c.classList.contains('gone') || c.classList.contains('mini') || (c.classList.contains('ghost') && !c.classList.contains('back')) || motion() !== 'full') return;
  var r = c.getBoundingClientRect();
  var fx = (e.clientX - r.left) / r.width - 0.5, fy = (e.clientY - r.top) / r.height - 0.5;
  c.style.setProperty('--ry', (fx * 10).toFixed(1) + 'deg');   // ±5° (was ±7°)
  c.style.setProperty('--rx', (-fy * 10).toFixed(1) + 'deg');
}
function untilt(c) { c.style.removeProperty('--rx'); c.style.removeProperty('--ry'); }

/* ---------------- navigation ---------------- */
function go(level, areaId, toolId) {
  hidePeek(); hideTip(); closeMenus();
  if (level === 'modules' && !(ctx.MODULE_LIST || []).length) level = 'home';
  if (level === 'tool' && S.arrange) setArrange(false, true);
  var prev = S.level;
  if (level === 'tool' && !areaId) areaId = areaOf(toolId).id;
  // A tool or area in another module: switch module first.
  var tgt = areaId ? anyAreaById(areaId) : null;
  if (tgt && tgt.module !== '*' && S.module && tgt.module !== S.module) { switchModule(tgt.module, true); prev = 'home'; }
  // Outside the honeycomb view there is no area level: show the module page and point at the area.
  var focusArea = null;
  if (level === 'area' && S.view !== 'honeycomb') { focusArea = areaId; level = 'home'; areaId = null; }
  // tools bloom from the centre of their area when entering an area from home
  if (level === 'area' && (prev === 'home' || S.area !== areaId) && motion() === 'full') {
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
  R.stage.setAttribute('data-level', level);
  layout();
  drawArrangeBar();
  lightShow();
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
  if (!ctx.adminConsole) try { sessionStorage.setItem('bft.place', JSON.stringify({ level: level, area: S.area, tool: S.tool })); } catch (x) {}
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
function closeMenus() { UI.closeMenu(); }

/* User menu: admin unlock (inside a Beeforce session) and sign out. */
function canArrange() { return !ctx.adminConsole && S.level !== 'tool' && S.level !== 'login'; }
function userMenu(anchor) {
  var items = [];
  if (!ctx.adminConsole && ctx.AdminLogin.configured()) {
    items.push(ctx.adminUnlocked
      ? { icon: 'key', label: 'Lock admin tools', sub: 'Hide Settings and Developer panels', onClick: lockAdmin }
      : { icon: 'unlock', label: 'Unlock admin tools', sub: 'Settings and Developer panels for this session', onClick: unlockAdmin });
  }
  if (!ctx.adminConsole) items.push({ icon: 'list', label: 'Run journal', sub: 'Every run from this browser, with undo files', onClick: function () { ctx.Engine.openJournal(); } });
  items.push({ icon: 'out', label: 'Sign out', sub: ctx.adminConsole ? 'Leave the admin console' : 'Signed in as ' + Api.state.user, onClick: signOutAsk });
  UI.menu(anchor, items, { right: true, label: 'Account' });
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
  if (many) {
    btn.setAttribute('aria-expanded', 'false');
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      UI.menu(btn, [{ header: 'Modules' }].concat(mods.map(function (x) {
        return { icon: x.icon, label: x.name, sub: x.desc, on: x.id === S.module, right: x.id === S.module ? 'current' : null, onClick: function () { switchModule(x.id); } };
      })), { label: 'Switch module' });
    });
  }
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

/* The top-bar Back button does what Esc does (tool → area → home → modules); hidden where there is nowhere to go. */
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
  var tx = TRAIL.tx, ty = TRAIL.ty, step = TRAIL.step, mo = motion();
  var steps = skipArea(a) ? [['Home', 'home'], [TOOLS[S.tool].name, 'tool']] : [['Home', 'home'], [a.name, 'area'], [TOOLS[S.tool].name, 'tool']];
  var labels = steps.map(function (l, i) {
    var el = h('div.tl' + (i === steps.length - 1 ? '.cur' : ''), l[0]);
    el.style.left = (tx + 46) + 'px'; el.style.top = (ty + step * i) + 'px';
    // full = the original slide-in, calm = a short fade, off = already there
    if (mo !== 'off') {
      var dl = mo === 'full' ? 120 + i * 60 : 60 + i * 30;
      el.style.transition = mo === 'full' ? 'opacity .3s var(--ease) ' + dl + 'ms, transform .4s var(--ease) ' + dl + 'ms' : 'opacity .2s var(--ease) ' + dl + 'ms';
      el.style.opacity = '0'; el.style.transform = mo === 'full' ? 'translate(-8px,-50%)' : 'translate(0,-50%)';
      requestAnimationFrame(function () { requestAnimationFrame(function () { el.style.opacity = '1'; el.style.transform = 'translate(0,-50%)'; }); });
    }
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
    var mo = motion();
    setTimeout(function () { if (S.tool === id) R.work.classList.add('on'); }, mo === 'off' ? 0 : mo === 'calm' ? 60 : 180);
  };
  R.work.onscroll = function () { var v = views[S.tool]; if (v) v.__scroll = R.work.scrollTop; };
  if (views[id]) return show(views[id]);
  var page = h('div.page');
  views[id] = page;
  page.appendChild(h('div.card.loadcard', h('span.spin'), 'Opening ' + TOOLS[id].name + '…'));
  show(page);
  ctx.loadTool(id).then(function (def) {
    U.clear(page);
    var devBtn = id === 'admin-settings' || id === 'api-automation' || id === 'playbooks' || id === 'health' ? null : UI.btn('Developer', { kind: 'quiet', icon: 'code', onClick: function () { return openDev(id); } });
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
function markAdmin() { if (ctx.appEl) { ctx.appEl.classList.toggle('admin', ctx.Layout.isAdmin()); ctx.appEl.classList.toggle('ro', !!ctx.READONLY); } }

/* ---------------- hover peek + tips ---------------- */
function showPeek(a, cell) {
  if (S.arrange) return;
  if (Date.now() < (R.settleAt || 0)) return; // cells are still flowing under the pointer
  var r = cell.getBoundingClientRect(), b = R.body.getBoundingClientRect();
  U.swap(R.peek, h('b', a.name), h('p', a.desc), h('ul', a.tools.map(function (t) { return h('li', TOOLS[t].name); })), h('em', 'Click to open →'));
  var left = r.right - b.left + 14;
  if (left + 280 > b.width) left = r.left - b.left - 284;
  var top = Math.max(10, Math.min(r.top - b.top + r.height / 2 - 90, b.height - 260));
  R.peek.style.left = left + 'px'; R.peek.style.top = top + 'px';
  R.peek.classList.add('on');
}
function hidePeek() { R.peek && R.peek.classList.remove('on'); hideTip(); }
function showTip(cell, text) {
  var r = cell.getBoundingClientRect(), b = R.body.getBoundingClientRect();
  R.tip.textContent = text;
  var left = r.right - b.left + 8;
  if (left + R.tip.offsetWidth > b.width - 8) left = Math.max(8, r.left - b.left - R.tip.offsetWidth - 8);   // keep it on screen
  R.tip.style.left = left + 'px';
  R.tip.style.top = (r.top - b.top + r.height / 2 - 14) + 'px';
  R.tip.classList.add('on');
}
function hideTip() { R.tip && R.tip.classList.remove('on'); }

/* ---------------- palette (Ctrl K) ----------------
 * One search for tools, areas, actions and (admins) API endpoints. Words match the start of words anywhere in the
 * name, hint or area ("acc pol"); a short query also matches initials ("tu" → Timecard Update). Tab on an area searches
 * inside it (Backspace on an empty field leaves); Ctrl Enter opens the actions of the selected row. Endpoints are read
 * from the registry only — nothing is sent. The selection follows the pointer only when the pointer actually moves. */
function palActions() {
  var many = !ctx.adminConsole && (ctx.MODULE_LIST || []).length > 0, out = [];
  var dark = Theme.resolved() === 'dark';
  out.push({ name: 'Appearance', hint: 'Theme and motion', icon: 'sliders', run: openAppearance, kw: 'theme motion dark light reduced' });
  out.push({ name: 'Switch to ' + (dark ? 'light' : 'dark') + ' theme', hint: 'Saved in this browser', icon: dark ? 'sun' : 'moon', run: function () { Theme.set(dark ? 'light' : 'dark'); }, kw: 'theme' });
  if (canArrange()) out.push({ name: S.arrange ? 'Finish arranging' : 'Arrange the honeycomb', hint: 'Drag hexagons to new places', icon: 'move', run: function () { setArrange(!S.arrange); }, kw: 'move drag layout' });
  if (!ctx.adminConsole) VIEWS.forEach(function (v) { if (v[0] !== S.view) out.push({ name: v[2] + ' view', hint: 'How tools are shown on the home page', icon: v[1], run: function () { setView(v[0]); }, kw: 'view layout' }); });
  if (many) out.push({ name: 'Switch module…', hint: 'Back to the module page', icon: 'hexgrid', run: function () { go('modules'); }, kw: 'module' });
  if (!ctx.adminConsole) out.push({ name: 'Run journal', hint: 'Every run from this browser: requests, results, undo files', icon: 'list', run: function () { ctx.Engine.openJournal(); }, kw: 'history log audit undo runs' });
  out.push({ name: 'Minimize', hint: 'Back to Beeforce; everything stays as it is', icon: 'minimize', run: minimize, kw: 'hide dock' });
  if (!ctx.adminConsole && ctx.AdminLogin.configured()) out.push(ctx.adminUnlocked ? { name: 'Lock admin tools', hint: 'Hide Settings and Developer panels', icon: 'key', run: lockAdmin, kw: 'admin' } : { name: 'Unlock admin tools', hint: 'Settings and Developer panels for this session', icon: 'unlock', run: unlockAdmin, kw: 'admin' });
  out.push({ name: 'Sign out…', hint: ctx.adminConsole ? 'Leave the admin console' : 'Signed in as ' + Api.state.user, icon: 'out', run: signOutAsk, kw: 'logout' });
  return out.map(function (x) { x.type = 'action'; return x; });
}
function initialsOf(s) { return String(s).split(/[^A-Za-z0-9]+/).filter(Boolean).map(function (w) { return w[0]; }).join('').toLowerCase(); }
/* Score how well the query words match a row; null = no match. Lower is better. Returns { score, marks:[[start,end]] }. */
function palMatch(x, words) {
  if (!words.length) return { score: 5, marks: [] };
  var name = x.name.toLowerCase(), hay = (x.name + ' ' + (x.hint || '') + ' ' + (x.where || '') + ' ' + (x.kw || '') + ' ' + (x.key || '')).toLowerCase();
  var q = words.join(' ');
  if (words.length === 1 && q.length >= 2 && initialsOf(x.name).indexOf(q) === 0) {
    var ws = [], re = /[A-Za-z0-9]+/g, m;
    while ((m = re.exec(x.name)) && ws.length < q.length) ws.push([m.index, m.index + 1]);
    if (name.indexOf(q) !== 0) return { score: 1.5, marks: ws };
  }
  var marks = [], score = 0;
  for (var i = 0; i < words.length; i++) {
    var w = words[i];
    var start = new RegExp('(^|[^a-z0-9])' + w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    var mn = start.exec(name);
    if (mn) { var at = mn.index + mn[1].length; marks.push([at, at + w.length]); continue; }
    var sub = name.indexOf(w);
    if (sub >= 0) { marks.push([sub, sub + w.length]); score += 1; continue; }
    if (start.test(hay)) { score += 2; continue; }
    if (hay.indexOf(w) >= 0) { score += 3; continue; }
    return null;
  }
  if (name === q) score -= 3; else if (name.indexOf(q) === 0) score -= 2;
  return { score: score, marks: marks };
}
function markText(text, marks) {
  if (!marks || !marks.length) return text;
  var out = [], pos = 0;
  marks.slice().sort(function (a, b) { return a[0] - b[0]; }).forEach(function (m) {
    if (m[0] < pos) return;
    if (m[0] > pos) out.push(text.slice(pos, m[0]));
    out.push(h('mark', text.slice(m[0], m[1]))); pos = m[1];
  });
  if (pos < text.length) out.push(text.slice(pos));
  return out;
}
function openPalette() {
  if (S.level === 'login' || R.pal) return;
  closeMenus();
  var admin = ctx.Layout.isAdmin();
  var manyMods = (ctx.MODULES || []).length > 1;
  var tools = [], areas = [], eps = [];
  ctx.AREAS.forEach(function (a) {
    var where = (manyMods && moduleById(a.module) ? moduleById(a.module).name + ' · ' : '') + a.name;
    (a.allTools || a.tools).forEach(function (t) { if (TOOLS[t] && (!TOOLS[t].hidden || admin)) tools.push({ type: 'tool', t: t, a: a, name: TOOLS[t].name, hint: TOOLS[t].hint + (TOOLS[t].hidden ? ' · hidden' : ''), where: where, icon: TOOLS[t].icon || a.icon }); });
    if (!a.system && a.tools.length && (!a.module || a.module === '*' || moduleById(a.module))) areas.push({ type: 'area', a: a, name: a.name, hint: a.desc || '', where: (manyMods && moduleById(a.module) ? moduleById(a.module).name + ' · ' : '') + a.tools.length + (a.tools.length === 1 ? ' tool' : ' tools'), icon: a.icon });
  });
  if (admin && ctx.EP) try { ctx.EP.all().forEach(function (e) { if (!TOOLS[e.tool] && e.tool !== 'admin-settings') return; eps.push({ type: 'ep', e: e, name: e.label, hint: e.path, where: (TOOLS[e.tool] || {}).name || e.tool, method: e.method, key: e.key, kw: e.method + ' endpoint api', icon: 'code' }); }); } catch (x) {}
  var acts = palActions();
  var q = UI.input({ placeholder: 'Search tools, areas and actions' });
  q.setAttribute('role', 'combobox'); q.setAttribute('aria-expanded', 'true'); q.setAttribute('aria-autocomplete', 'list'); q.setAttribute('aria-label', 'Search tools, areas and actions');
  var ul = h('ul', { role: 'listbox', id: 'bft-pal-list', 'aria-label': 'Results' });
  q.setAttribute('aria-controls', 'bft-pal-list');
  var scopeEl = h('span.scope', { hidden: true });
  var cur = 0, shown = [], scope = null, mouse = null;
  function rowsFor(words) {
    function pick(list, n) {
      var out = [];
      list.forEach(function (x) { var m = palMatch(x, words); if (m) out.push({ x: x, m: m }); });
      out.sort(function (p, r) { return p.m.score - r.m.score; });
      return n ? out.slice(0, n) : out;
    }
    if (scope) return [['Tools in ' + scope.name, pick(tools.filter(function (x) { return x.a.id === scope.id; }))]];
    if (!words.length) {
      var rec = recentList();
      var recent = rec.map(function (t) { return tools.filter(function (x) { return x.t === t; })[0]; }).filter(Boolean).slice(0, 5).map(function (x) { return { x: x, m: { score: 0, marks: [] } }; });
      return [['Recent', recent], ['Areas', pick(areas)], ['Actions', pick(acts, 4)]];
    }
    return [['Tools', pick(tools, 8)], ['Areas', pick(areas, 4)], ['Actions', pick(acts, 5)], ['API endpoints', admin ? pick(eps, 6) : []]];
  }
  function draw() {
    var words = q.value.toLowerCase().split(/\s+/).filter(Boolean);
    var groups = rowsFor(words);
    shown = [];
    var nodes = [];
    groups.forEach(function (g) {
      if (!g[1].length) return;
      nodes.push(h('li.gh', { role: 'presentation' }, g[0]));
      g[1].forEach(function (p) {
        var x = p.x, i = shown.length; shown.push(x);
        var right = x.type === 'ep' ? h('em', h('span.m.' + x.method, x.method), ' ', x.where) : x.type === 'area' ? h('em', x.where, ' · ', h('kbd', 'Tab'), ' search in') : h('em', x.where || '');
        var b = h('button', { type: 'button', role: 'option', id: 'bft-pal-' + i, 'aria-selected': i === cur ? 'true' : 'false', onclick: function () { pick(x); } },
          h('span.gl' + (x.type === 'area' ? '.hexg' : ''), U.icon(x.icon || 'list', 16)), h('b', markText(x.name, p.m.marks)), x.hint ? h('span', x.type === 'ep' ? h('code', x.hint) : x.hint) : null, right);
        b.addEventListener('mousemove', function (e) { if (mouse && mouse[0] === e.clientX && mouse[1] === e.clientY) return; mouse = [e.clientX, e.clientY]; if (cur !== i) { cur = i; mark(false); } });
        nodes.push(h('li', { role: 'presentation' }, b));
      });
    });
    cur = Math.min(cur, Math.max(0, shown.length - 1));
    U.swap(ul, nodes.length ? nodes : h('li', h('div.empty', 'Nothing matches “' + q.value + '”', scope ? h('div', h('button.linkbtn', { type: 'button', onclick: function () { setScope(null); } }, 'Search everywhere')) : null)));
    mark(true);
    foot();
  }
  function mark(scroll) {
    Array.prototype.forEach.call(ul.querySelectorAll('button[role=option]'), function (b, i) { b.setAttribute('aria-selected', i === cur ? 'true' : 'false'); if (i === cur && scroll !== false) b.scrollIntoView({ block: 'nearest' }); });
    if (shown[cur]) q.setAttribute('aria-activedescendant', 'bft-pal-' + cur); else q.removeAttribute('aria-activedescendant');
    foot();
  }
  var footEl = h('div.pf');
  function foot() {
    var x = shown[cur];
    U.swap(footEl, h('span', h('kbd', '↑'), h('kbd', '↓'), ' move'), h('span', h('kbd', 'Enter'), ' ' + (x ? (x.type === 'ep' ? 'Developer panel' : x.type === 'action' ? 'run' : 'open') : 'open')),
      x && x.type === 'area' && !scope ? h('span', h('kbd', 'Tab'), ' search in area') : null,
      x ? h('span', h('kbd', 'Ctrl'), h('kbd', 'Enter'), ' actions') : null, h('span.grow'), h('span', h('kbd', 'Esc'), ' close'));
  }
  function setScope(a) {
    scope = a ? { id: a.id, name: a.name } : null;
    scopeEl.hidden = !a;
    if (a) U.swap(scopeEl, U.icon(a.icon, 14), h('span', a.name), h('button', { type: 'button', 'aria-label': 'Search everywhere', title: 'Search everywhere (Backspace)', onclick: function () { setScope(null); q.focus(); } }, U.icon('x', 12)));
    q.placeholder = a ? 'Search tools in ' + a.name : 'Search tools, areas and actions';
    q.value = ''; cur = 0; draw();
  }
  function actionsFor(x) {
    var list = [];
    if (x.type === 'tool') {
      list.push({ icon: 'play', label: 'Open', right: 'Enter', onClick: function () { pick(x); } });
      if (admin && x.t !== 'admin-settings' && x.t !== 'api-automation' && x.t !== 'playbooks' && x.t !== 'health') list.push({ icon: 'code', label: 'Developer panel', sub: 'Endpoints this tool uses', onClick: function () { close(); go('tool', x.a.id, x.t); setTimeout(function () { openDev(x.t); }, 400); } });
      list.push({ icon: 'search', label: 'Search in ' + x.a.name, onClick: function () { setScope(x.a); q.focus(); } });
    } else if (x.type === 'area') {
      list.push({ icon: 'play', label: 'Open area', right: 'Enter', onClick: function () { pick(x); } });
      list.push({ icon: 'search', label: 'Search in ' + x.a.name, right: 'Tab', onClick: function () { setScope(x.a); q.focus(); } });
    } else if (x.type === 'ep') {
      list.push({ icon: 'copy', label: 'Copy path', sub: x.e.path, onClick: function () { UI.copy(x.e.path, 'Path'); } });
      list.push({ icon: 'code', label: 'Show cURL', sub: 'The token stays a placeholder', onClick: function () { close(); UI.codeDialog(x.e.method + ' · ' + x.e.label, ctx.EP.curlRaw(x.e.method, ctx.EP.url(x.e.key)), { what: 'cURL', note: 'The Authorization header uses $BEEFORCE_TOKEN. Nothing is sent from here.' }); } });
      list.push({ icon: 'code', label: 'Developer panel', sub: x.where, right: 'Enter', onClick: function () { pick(x); } });
    } else list.push({ icon: x.icon, label: x.name, right: 'Enter', onClick: function () { pick(x); } });
    return list;
  }
  function openActions() {
    var x = shown[cur]; if (!x) return;
    var b = ul.querySelector('#bft-pal-' + cur); if (!b) return;
    UI.menu(b, actionsFor(x), { right: true, returnFocus: q, label: 'Actions for ' + x.name });
  }
  function pick(x) {
    if (x.type === 'tool') { close(); go('tool', x.a.id, x.t); }
    else if (x.type === 'area') { close(); go('area', x.a.id); }
    else if (x.type === 'ep') { close(); if (TOOLS[x.e.tool] && areaOf(x.e.tool)) { go('tool', areaOf(x.e.tool).id, x.e.tool); setTimeout(function () { openDev(x.e.tool); }, 400); } else UI.copy(x.e.path, 'Path'); }
    else { close(); setTimeout(x.run, 0); }
  }
  q.addEventListener('input', function () { cur = 0; draw(); });
  q.addEventListener('keydown', function (e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); cur = Math.min(shown.length - 1, cur + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); cur = Math.max(0, cur - 1); mark(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openActions(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[cur]) pick(shown[cur]); }
    else if (e.key === 'Tab' && !e.shiftKey && shown[cur] && shown[cur].type === 'area' && !scope) { e.preventDefault(); setScope(shown[cur].a); }
    else if (e.key === 'Tab') { e.preventDefault(); }
    else if (e.key === 'Backspace' && scope && !q.value) { e.preventDefault(); setScope(null); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (scope) setScope(null); else close(); }
  });
  var pal = h('div.pal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search tools, areas and actions' }, h('div.q', U.icon('search', 20), scopeEl, q, h('span.kbd', 'Esc')), ul, footEl);
  var scrim = h('div.scrim', { style: { background: 'var(--scrim)' } });
  scrim.addEventListener('mousedown', function (e) { if (e.target === scrim) close(); });
  scrim.appendChild(pal);
  var opener = ctx.root.activeElement;
  ctx.appEl.appendChild(scrim);
  R.pal = scrim;
  draw();
  q.focus();
  requestAnimationFrame(function () { scrim.classList.add('on'); pal.classList.add('on'); q.focus(); });
  function close() {
    if (!R.pal) return;
    R.pal = null;
    UI.closeMenu();
    scrim.classList.remove('on'); pal.classList.remove('on');
    setTimeout(function () { scrim.remove(); }, 200);
    if (opener && opener.isConnected && S.level !== 'tool') try { opener.focus({ preventScroll: true }); } catch (x) {}
  }
}

function tickSession() {
  clearInterval(R.timer);
  function upd() {
    if (S.level === 'login' || !Api.state.token) return;
    var left = Api.minutesLeft();
    if (R.minimized) dockText();
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
      if (R.minimized) dockText();
    } else if (left === 10 && !R.warned) {
      R.warned = true;
      UI.toast('10 minutes left in this session. Finish or sign in again soon.');
    }
  }
  upd();
  R.timer = setInterval(upd, 20000);
}

// 401 mid-work: ask for the password again, keep everything on screen. (Named so Compare can put it back.)
Api.setReauth(reauthPrompt);
function reauthPrompt() {
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
}

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
  try { sessionStorage.removeItem('bft.adminUnlock'); sessionStorage.removeItem('bft.place'); } catch (x) {}
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
function keyHint() { return h('div.keyhint', h('span', h('kbd', '←'), ' ', h('kbd', '→'), ' ', h('kbd', '↑'), ' ', h('kbd', '↓'), ' move'), h('span', h('kbd', 'Enter'), ' open'), h('span', h('kbd', 'Esc'), ' back')); }
function onKey(e) {
  if (!ctx.host || !ctx.host.isConnected || R.minimized) return;
  if (UI.menuOpen()) return;   // an open menu handles its own keys (core/ui.js)
  if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) { e.preventDefault(); e.stopPropagation(); openPalette(); return; }
  if (R.pal || S.level === 'login' || !ctx.appEl.isConnected || ctx.appEl.querySelector('.scrim')) return;
  // Nothing below acts while the user types: fields, editable text, text boxes and IME composition.
  var path = e.composedPath ? e.composedPath() : [];
  if (e.isComposing || path.some(function (n) { return n && n.nodeType === 1 && (/^(INPUT|TEXTAREA|SELECT)$/.test(n.tagName) || n.isContentEditable || /^(textbox|combobox|searchbox)$/.test(n.getAttribute && n.getAttribute('role') || '')); })) return;
  if (e.key === 'Escape' && S.arrange) { e.preventDefault(); e.stopPropagation(); setArrange(false); return; }
  if (e.key === 'Escape' && (S.level === 'tool' || S.level === 'area' || (S.level === 'home' && (ctx.MODULE_LIST || []).length))) {
    e.preventDefault(); e.stopPropagation(); back();
    return;
  }
  var plain = !e.altKey && !e.ctrlKey && !e.metaKey;
  if (/^Arrow/.test(e.key) && plain && (S.level === 'modules' || S.level === 'home' || S.level === 'area')) {
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
function onResize() { clearTimeout(rt); rt = setTimeout(function () { if (R.placeDock) R.placeDock(); if (S.level !== 'login' && !R.minimized && R.body) layout({ instant: true }); }, 80); }

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

/* ---------------- Admin Settings → Tools by role (v3.14) ----------------
 * Edits the "access" part of layout.json (see core/layout.js). The draft applies only to this page until the
 * downloaded layout.json is committed; "Preview as" shows the honeycomb as a role would see it. */
ctx.ADMIN_TABS = ctx.ADMIN_TABS || [];
ctx.ADMIN_TABS.push({ id: 'roles', label: 'Tools by role', render: rolesTab });
function rolesTab(el) {
  var L = ctx.Layout;
  var team = L.cleanAccess(ctx.repoLayout && ctx.repoLayout.access);
  var draft = L.draftAccess ? JSON.parse(JSON.stringify(L.draftAccess)) : team ? JSON.parse(JSON.stringify(team)) : { roles: {}, users: {} };
  var holder = h('div');
  el.appendChild(holder);
  var areas = (L.effective().areas || []);
  function toolName(id) { return (ctx.DEFAULT_TOOLS[id] || {}).name || id; }
  function usersText() { return Object.keys(draft.users).map(function (u) { return u + ' = ' + draft.users[u]; }).join('\n'); }
  function readUsers(txt) {
    var out = {}, bad = [];
    String(txt).split(/\n+/).forEach(function (line) {
      line = line.trim(); if (!line) return;
      var m = line.match(/^(.+?)\s*[=:]\s*(.+)$/);
      if (!m || !draft.roles[m[2].trim()]) { bad.push(line); return; }
      out[m[1].trim().toLowerCase()] = m[2].trim();
    });
    return { users: out, bad: bad };
  }
  function draw() {
    var cards = Object.keys(draft.roles).map(function (r) {
      var name = UI.input({ value: r }); name.style.maxWidth = '260px';
      name.addEventListener('change', function () {
        var n = name.value.trim(); if (!n || n === r) { name.value = r; return; }
        if (draft.roles[n]) { UI.toast('A role called “' + n + '” already exists.', 'bad'); name.value = r; return; }
        draft.roles[n] = draft.roles[r]; delete draft.roles[r];
        Object.keys(draft.users).forEach(function (u) { if (draft.users[u] === r) draft.users[u] = n; });
        if (draft.readOnly) draft.readOnly = draft.readOnly.map(function (x) { return x === r ? n : x; });
        draw();
      });
      var groups = areas.filter(function (a) { return a.tools.length; }).map(function (a) {
        return h('div', { style: { marginBottom: '8px' } }, h('div.small.muted', a.name), h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px 16px' } }, a.tools.map(function (t) {
          var c = UI.check(toolName(t), draft.roles[r].indexOf(t) >= 0);
          c.input.addEventListener('change', function () { var l = draft.roles[r]; if (c.input.checked) { if (l.indexOf(t) < 0) l.push(t); } else draft.roles[r] = l.filter(function (x) { return x !== t; }); });
          return c;
        })));
      });
      var ro = UI.check('Read only — browse and export, no changes', !!(draft.readOnly && draft.readOnly.indexOf(r) >= 0));
      ro.classList.add('rocheck');
      ro.input.addEventListener('change', function () {
        var l = (draft.readOnly || []).filter(function (x) { return x !== r; });
        if (ro.input.checked) l.push(r);
        if (l.length) draft.readOnly = l; else delete draft.readOnly;
      });
      return h('div.card', { style: { marginBottom: '12px' } },
        h('div.row', { style: { alignItems: 'center', marginBottom: '10px' } }, h('b', 'Role'), name, ro, h('span', { style: { flex: 1 } }),
          UI.btn('Remove role', { sm: true, kind: 'quiet', icon: 'trash', onClick: function () { delete draft.roles[r]; Object.keys(draft.users).forEach(function (u) { if (draft.users[u] === r) delete draft.users[u]; }); if (draft.readOnly) { draft.readOnly = draft.readOnly.filter(function (x) { return x !== r; }); if (!draft.readOnly.length) delete draft.readOnly; } draw(); } })),
        groups);
    });
    var users = UI.textarea({ value: usersText(), placeholder: 'ops.user = support\n* = support' });
    var usersErr = h('div.err');
    users.addEventListener('change', function () { var x = readUsers(users.value); draft.users = x.users; usersErr.textContent = x.bad.length ? 'Not used (unknown role or no “=”): ' + x.bad.join('; ') : ''; });
    var roleSel = UI.select([{ value: '', label: 'Preview as…' }].concat(Object.keys(draft.roles).map(function (r) { return { value: r, label: r }; })), L.previewRole || '');
    roleSel.style.maxWidth = '200px';
    U.swap(holder,
      UI.note('info', 'Which tools each colleague sees', 'Give each role the tools it should show, then say which Beeforce username has which role (“*” = everyone else). People without a role see every tool; unlocked admins always see everything. ' +
        'A read-only role can open its tools, browse and export, but APIary sends no changes for it. ' +
        'This only changes what APIary does — what an account may change in Beeforce is still decided by Beeforce.'),
      team ? null : UI.note('warn', null, 'The team layout has no roles yet: everyone sees every tool.'),
      cards.length ? cards : UI.empty('No roles yet.'),
      h('div.row', { style: { margin: '4px 0 16px' } }, UI.btn('Add role', { icon: 'plus', onClick: function () { var n = 'role ' + (Object.keys(draft.roles).length + 1); draft.roles[n] = []; draw(); } })),
      UI.field('Users and their roles (one per line: username = role)', users), usersErr,
      h('div.row', { style: { marginTop: '12px', alignItems: 'center' } },
        roleSel,
        UI.btn('Preview', { icon: 'eye', onClick: function () { if (!roleSel.value) return; L.draftAccess = JSON.parse(JSON.stringify(draft)); L.previewRole = roleSel.value; relayout(); draw(); UI.toast('Showing the honeycomb as “' + roleSel.value + '” sees it. Stop the preview here.'); } }),
        L.previewRole ? UI.btn('Stop preview', { kind: 'quiet', onClick: function () { L.previewRole = null; relayout(); draw(); } }) : null,
        h('span', { style: { flex: 1 } }),
        UI.btn('Download layout.json', { kind: 'primary', icon: 'download', onClick: function () {
          var x = readUsers(users.value); draft.users = x.users;
          L.draftAccess = Object.keys(draft.roles).length ? JSON.parse(JSON.stringify(draft)) : null;
          var data = L.exportRepo(L.effective());
          UI.saveText('layout.json', JSON.stringify(data, null, 2) + '\n', 'application/json');
          UI.toast('layout.json downloaded with the roles. Commit it next to index.js; colleagues get it the next time they open APIary.');
        } })));
  }
  draw();
}

/* ---------------- Admin Settings → Safety (v3.15) ----------------
 * The Production guard for this browser: in Production, a run of at least N items, or any delete, asks the person to
 * type PRODUCTION first (UI.confirm with count). Saved in this browser only (bft.prodGuard). */
ctx.ADMIN_TABS.push({ id: 'safety', label: 'Safety', render: safetyTab });
function safetyTab(el) {
  var g = ctx.Engine.guardSettings(), d = ctx.Engine.GUARD_DEFAULT;
  var on = UI.check('Ask to type PRODUCTION before big runs and deletes in Production', g.on);
  var min = UI.input({ value: String(g.min) }); min.inputMode = 'numeric'; min.style.maxWidth = '120px';
  var err = h('div.err');
  U.append(el, [
    UI.note('info', 'Production guard', 'In Production, every delete and every run of at least the number below asks the person to type PRODUCTION before anything is sent. UAT never asks. This setting is kept in this browser only.'),
    h('div', { style: { margin: '8px 0 12px' } }, on),
    UI.field('Ask from this many items (deletes always ask)', min), err,
    h('div.row', { style: { marginTop: '12px' } },
      UI.btn('Save', { kind: 'primary', icon: 'check', onClick: function () {
        var n = parseInt(String(min.value).trim(), 10);
        if (!(n >= 1 && n <= 100000)) { err.textContent = 'Enter a whole number from 1 to 100000.'; return; }
        err.textContent = '';
        U.store.set('prodGuard', { on: on.input.checked, min: n });
        UI.toast(on.input.checked ? 'Production guard on: from ' + n + ' items, and for every delete.' : 'Production guard off in this browser.', on.input.checked ? 'ok' : 'warn');
      } }),
      UI.btn('Back to default', { kind: 'quiet', onClick: function () { try { localStorage.removeItem('bft.prodGuard'); } catch (e) {} on.input.checked = d.on; min.value = String(d.min); err.textContent = ''; UI.toast('Production guard back to the default: on, from ' + d.min + ' items.'); } }))]);
}

ctx.Shell = {
  minimize: minimize, restore: restore, isMinimized: isMinimized,
  relayout: relayout, switchModule: switchModule, setView: setView, chooseModule: chooseModule, adminToBeeforce: adminToBeeforce,
  start: start, go: go, back: back, hide: hide, openPalette: openPalette, openAppearance: openAppearance, secretsPanel: secretsPanel, auditBadge: auditBadge, adminLoginPanel: adminLoginPanel,
  state: S,
  reauth: reauthPrompt,
  noteRun: function (module, ok, failed) {
    var r = U.store.get('runs', []);
    r.unshift({ module: module || 'Tool', ok: ok, failed: failed, at: Date.now() });
    U.store.set('runs', r.slice(0, 8));
  }
};
