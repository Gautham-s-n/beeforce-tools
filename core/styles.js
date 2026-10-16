/* core/styles.js — all styling. Lives inside a shadow root, so it cannot leak into Beeforce (or the reverse).
 *
 * v3.10: the v3.6.1 look and layout (320px side pane at every width), plus
 *   - motion levels on .app as data-motion="full|calm|off" (Appearance; see U.motion() in core/util.js): full = the
 *     original choreography, calm = short and settled (default), off = no movement, short fades only. The operating
 *     system's "reduce motion" setting selects off unless the user explicitly overrode it in Appearance;
 *   - accessibility fixes: a focus ring on hexagons distinct from the honey hover, text ≥4.5:1, field borders ≥3:1,
 *     hidden panes out of the Tab order;
 *   - shared tokens used by the components (menus, dialogs, tables, search, write flow): --r*, --t*, --mono,
 *     --focusring, --honeyedge, --fieldline, --settle, with values that match the v3.6.1 look. */
'use strict';

var HEX = 'polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)';

ctx.CSS = [
':host{all:initial}',
'*{box-sizing:border-box}',
'.app{--bg:#0A1220;--panel:#101B2D;--panel2:#14223A;--panel3:#1A2A46;--line:#1E2B42;--line2:#2A3A58;--ink:#E7EDF6;--ink2:#8FA0B8;--ink3:#5E6F88;',
'  --blue:#0B5CC7;--blue2:#2F7BEA;--blue3:#9CC3FF;--bluebg:#0E2A55;--honey:#F2B544;--honeybg:#262212;--prod:#3FD08B;--uat:#F5A524;--bad:#FF8A8A;--badbg:#3A1616;--ok:#3FD08B;--okbg:#12301F;--warnbg:#3A2E10;',
'  --well:#0C1626;--well2:#0C1526;--glow:#122039;--topbg:#0A1220cc;--cellglow:#2F7BEA66;--cellhover:#12264A;--pip:#6EA6F5;--hubface:#1E1B10;--hubhover:#2A2512;--toolface:#12203A;--ghostrim:#1A263B;--peekline:#2F7BEA55;--shadow:#000;--onaccent:#fff;--bluehover:#0D6AE6;--danger:#B4232F;--dangerhover:#C92A37;--inputhover:#3A4C70;--focus:#2F7BEA33;--dropover:#0F203D;--chipbg:#1A2436;--rowhover:#13233D;--rowsel:#0F2448;--scrim:#050a12b3;--badline:#FF8A8A66;--lcardbg:#0F1A2Ccc;--badrow:#2A1216;--badrowh:#33161B;--warnrow:#241F10;--ringtrack:#2A2512;',
'  --ease:cubic-bezier(.2,.8,.2,1);--spring:cubic-bezier(.34,1.5,.5,1);--flow:cubic-bezier(.45,1.35,.4,1);--hex:' + HEX + ';',
'  --honeygrad:linear-gradient(180deg,#FFD683,#EEA526);--blcore:rgba(120,190,255,.62);--blmid:rgba(80,160,255,.22);--honeyink:#2A1A00;--honeyink2:#5A4513;--honeyglow:#F4B74066;--cellshadow:#02060Eb3;--modface:linear-gradient(180deg,#1B3459,#0F1E38);--areaface:linear-gradient(180deg,#19325A,#0F203D);--toolface2:linear-gradient(180deg,#1F4072,#132B50);--hoverface:linear-gradient(180deg,#24497F,#163866);',
'  color-scheme:dark;position:fixed;inset:0;z-index:2147483646;color:var(--ink);font:400 14px/1.45 "Schibsted Grotesk",system-ui,-apple-system,"Segoe UI",sans-serif;',
'  display:flex;flex-direction:column;overflow:hidden;opacity:0;transition:opacity .25s var(--ease)}',
'.app::before{content:"";position:absolute;inset:0;z-index:-1;background:radial-gradient(1100px 700px at 62% 55%,var(--glow) 0%,var(--bg) 62%);transition:opacity .3s var(--ease)}',
'.app[data-theme=light]{color-scheme:light;--bg:#F4F6FA;--panel:#FFFFFF;--panel2:#FFFFFF;--panel3:#EEF2F8;--line:#E1E6EF;--line2:#CBD3E1;--ink:#13213A;--ink2:#4A5A75;--ink3:#7A889E;--blue:#0B5CC7;--blue2:#2F7BEA;--blue3:#0B5CC7;--bluebg:#E6F0FD;--honey:#D99412;--honeybg:#FDF3DD;--prod:#13965F;--uat:#C97A06;--bad:#C62828;--badbg:#FDECEC;--ok:#13965F;--okbg:#E6F6EE;--warnbg:#FDF3DD;--well:#F7F9FC;--well2:#F3F6FA;--glow:#E6EEFA;--topbg:#FFFFFFd9;--cellglow:#2F7BEA45;--cellhover:#EAF2FE;--pip:#2F7BEA;--hubface:#FFF6E2;--hubhover:#FDEFCF;--toolface:#F6F9FF;--ghostrim:#E6EAF1;--peekline:#2F7BEA55;--shadow:#1B2A4A40;--onaccent:#fff;--bluehover:#0A50AE;--danger:#C62828;--dangerhover:#A91F1F;--inputhover:#AEB9CC;--focus:#2F7BEA33;--dropover:#EEF4FE;--chipbg:#EEF2F8;--rowhover:#F3F7FD;--rowsel:#E6F0FD;--scrim:#1B2A4A59;--badline:#C6282866;--lcardbg:#FFFFFFee;--badrow:#FDEEEE;--badrowh:#FBE3E3;--warnrow:#FFF8E6;--ringtrack:#F2E6C8;--honeyglow:#D9941259;--cellshadow:#1B2A4A47;--modface:linear-gradient(180deg,#FFFFFF,#F2F6FC);--blcore:rgba(70,150,255,.36);--blmid:rgba(70,150,255,.13);--areaface:linear-gradient(180deg,#FFFFFF,#F5F8FD);--toolface2:linear-gradient(180deg,#F8FBFF,#EDF3FD);--hoverface:linear-gradient(180deg,#FFFFFF,#EAF2FE)}',
'.app.in{opacity:1}',
'button{font:inherit;color:inherit;cursor:pointer}',
'input,select,textarea{font:inherit;color:inherit}',
':focus-visible{outline:2px solid var(--blue2);outline-offset:2px}',
'.ic{display:inline-flex;line-height:0}',
'.muted{color:var(--ink2)}.dim{color:var(--ink3)}.small{font-size:12.5px}',

/* ---------- top bar ---------- */
'.top{position:relative;height:64px;flex:none;display:flex;align-items:center;gap:20px;padding:0 28px;border-bottom:1px solid var(--line);background:var(--topbg);backdrop-filter:blur(6px);z-index:20}',
'.top::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:var(--blue)}',
'.brand{display:flex;align-items:center;gap:11px;font-weight:800;font-size:17px;letter-spacing:-.01em;white-space:nowrap}',
'.mark{width:26px;height:30px;background:var(--honey);clip-path:var(--hex)}',
'.crumb{display:flex;align-items:center;gap:8px;color:var(--ink2);font-size:13.5px;margin-left:10px;min-width:0}',
'.crumb button{background:none;border:0;padding:4px 6px;border-radius:8px;color:var(--ink2);transition:color .15s,background .15s}',
'.crumb button:hover{color:var(--ink);background:var(--panel)}',
'.crumb b{color:var(--ink);font-weight:600;white-space:nowrap}.crumb i{font-style:normal;color:var(--ink3)}',
'.envpill{margin-left:auto;display:flex;align-items:center;gap:8px;padding:7px 14px;border-radius:999px;background:var(--panel);border:1px solid var(--line);font-weight:600;font-size:13px}',
'.envpill i{width:8px;height:8px;border-radius:50%;background:var(--prod);box-shadow:0 0 10px var(--prod)}',
'.envpill.uat i{background:var(--uat);box-shadow:0 0 10px var(--uat)}',
'.who{display:flex;align-items:center;gap:10px;font-weight:600;font-size:13.5px;background:none;border:0;padding:4px 8px 4px 4px;border-radius:999px;transition:background .15s}',
'.who:hover{background:var(--panel)}',
'.av{width:32px;height:32px;border-radius:50%;background:var(--blue);display:grid;place-items:center;font-size:12px;font-weight:700}',
'.iconbtn{width:36px;height:36px;border-radius:10px;border:1px solid transparent;background:none;color:var(--ink2);display:grid;place-items:center;transition:all .15s}',
'.iconbtn:hover{background:var(--panel);color:var(--ink);border-color:var(--line)}',

/* ---------- stage + cells ---------- */
'.body{position:relative;flex:1;min-height:0}',
'.side{position:absolute;left:0;top:0;bottom:0;width:320px;border-right:1px solid var(--line);z-index:5}',
'.sidepane{position:absolute;inset:0;padding:40px 30px 24px 36px;overflow:auto;transition:opacity .3s var(--ease),transform .4s var(--ease)}',
'.sidepane.off{opacity:0;transform:translateX(-12px);pointer-events:none}',
'.stage{position:absolute;inset:0;z-index:6;pointer-events:none}',
'.cell{position:absolute;left:0;top:0;pointer-events:auto;transform-origin:50% 50%;will-change:transform,opacity;',
'  transition:transform .8s var(--flow),opacity .45s var(--ease),filter .3s;background:none;border:0;padding:0}',
'.cell.gone{pointer-events:none}',
'.cell .rim{width:100%;height:100%;clip-path:var(--hex);background:var(--line);padding:1.5px;transition:background .2s,transform .25s var(--ease)}',
'.cell .face{width:100%;height:100%;clip-path:var(--hex);background:var(--panel);display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;gap:6px;padding:0 18px;color:var(--ink2);transition:background .2s}',
'.cell .nm{font-size:14px;font-weight:600;color:var(--ink);line-height:1.2;transition:color .2s}',
'.cell .ct{font-size:11.5px;color:var(--ink3)}',
'.cell .ht{font-size:11.5px;color:var(--ink3);line-height:1.3}',
'.cell .ic{transition:color .2s,transform .25s var(--ease)}',
'.pips{display:flex;gap:4px}.pips i{width:9px;height:10px;background:var(--ink3);clip-path:var(--hex);transition:background .2s}',
'.cell:hover:not(.gone),.cell:focus-visible{z-index:3;filter:drop-shadow(0 22px 22px var(--cellshadow)) drop-shadow(0 0 18px var(--honeyglow));outline:none}',
'.cell:hover:not(.gone) .rim,.cell:focus-visible .rim{background:var(--honey)}',
'.cell.area .face{background:var(--areaface)}',
'.cell:hover:not(.gone) .face,.cell:focus-visible .face{background:var(--hoverface)}',
'.cell:hover:not(.gone) .ic{color:var(--honey);transform:translateY(-2px)}',
'.cell:hover:not(.gone) .pips i{background:var(--pip)}',
'.cell.area.sel .rim{background:var(--blue2)}.cell.area.sel .face{background:var(--bluebg)}.cell.area.sel .ic{color:var(--blue3)}.cell.area.sel .pips i{background:var(--pip)}',
'.cell.hub .rim{background:#C98A14}.cell.hub .face{background:var(--honeygrad);color:var(--honeyink)}.cell.hub .ic{color:var(--honeyink)}',
'.cell.hub:hover:not(.gone) .rim,.cell.hub:focus-visible .rim{background:#FFE3A3}.cell.hub:hover:not(.gone) .face,.cell.hub:focus-visible .face{background:linear-gradient(180deg,#FFE0A0,#F4B33A)}.cell.hub:hover:not(.gone) .ic{color:var(--honeyink)}',
'.cell.tool .face{background:var(--toolface2)}.cell.tool .ic{color:var(--blue3)}',
'.cell.tool.cur .rim{background:var(--honey)}.cell.tool.cur .face{background:var(--honeybg)}.cell.tool.cur .ic{color:var(--honey)}',
'.cell.ghost .rim{background:var(--ghostrim)}.cell.ghost .face{background:var(--well2)}',
'.cell.ghost.back .ct{color:var(--ink2)}',
'.cell.mini .nm,.cell.mini .ct,.cell.mini .pips,.cell.mini .ht{opacity:0}',
'.cell .nm,.cell .ct,.cell .pips,.cell .ht{transition:opacity .25s}',
'.ring{width:46px;height:46px;border-radius:50%;display:grid;place-items:center}',
'.ring b{width:38px;height:38px;border-radius:50%;background:var(--hubface);display:grid;place-items:center;font-size:12px;font-weight:700;color:var(--ink)}',

/* peek card */
'.peek{position:absolute;width:270px;background:var(--panel2);border:1px solid var(--peekline);border-radius:16px;padding:15px 17px;box-shadow:0 20px 50px -20px var(--shadow);z-index:9;',
'  opacity:0;transform:translateY(6px);transition:opacity .18s var(--ease),transform .22s var(--ease);pointer-events:none}',
'.peek.on{opacity:1;transform:none}',
'.peek b{display:block;font-size:15px}.peek p{margin:2px 0 10px;color:var(--ink2);font-size:12.5px}',
'.peek li{list-style:none;display:flex;align-items:center;gap:10px;padding:5px 0;font-size:13.5px}',
'.peek ul{margin:0;padding:0}.peek li::before{content:"";width:9px;height:10px;background:var(--pip);clip-path:var(--hex)}',
'.peek em{display:block;margin-top:8px;color:var(--blue3);font-style:normal;font-size:12.5px;font-weight:600}',

/* ---------- side panes ---------- */
'.side h1{font-size:34px;line-height:1.05;margin:0 0 8px;letter-spacing:-.02em;font-weight:700}',
'.side h2{font-size:24px;margin:0 0 6px;letter-spacing:-.01em}',
'.side p{margin:0 0 20px;color:var(--ink2)}',
'.searchbtn{width:100%;display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:12px 14px;color:var(--ink2);font-size:14px;transition:border-color .15s,background .15s}',
'.searchbtn:hover{border-color:var(--blue2);background:var(--panel2)}',
'.searchbtn kbd,.kbd{margin-left:auto;font:600 11px ui-monospace,Consolas,monospace;border:1px solid var(--line);border-radius:6px;padding:1px 6px;color:var(--ink2)}',
'.label{color:var(--ink3);font-size:12.5px;margin:22px 0 8px}',
'.rec{width:100%;display:flex;align-items:center;gap:11px;padding:10px 12px;border-radius:12px;background:none;border:0;text-align:left;font-size:14px;transition:background .15s}',
'.rec:hover{background:var(--panel)}',
'.rec::before{content:"";width:10px;height:11px;background:var(--ink3);clip-path:var(--hex);flex:none;transition:background .15s}',
'.rec:hover::before,.rec.on::before{background:var(--honey)}',
'.rec.on{background:var(--bluebg);color:var(--onaccent)}',
'.rec span{margin-left:auto;color:var(--ink3);font-size:12px}',
'.runs div{display:flex;justify-content:space-between;gap:10px;padding:9px 0;border-top:1px solid var(--line);font-size:13px}',
'.runs .okc{color:var(--ok)}.runs .badc{color:var(--bad)}',
'.trail{position:relative;height:300px}',
'.trail .tl{position:absolute;left:84px;font-size:13.5px;color:var(--ink2);transform:translateY(-50%)}',
'.trail .tl.cur{color:var(--ink);font-weight:700}',
'.trail .ln{position:absolute;left:69px;width:2px;background:var(--line)}',

/* ---------- workspace (tool view) ---------- */
'.work{position:absolute;left:320px;right:0;top:0;bottom:0;overflow:auto;padding:34px 40px 60px;z-index:7;opacity:0;transform:translateX(24px);pointer-events:none;transition:opacity .35s var(--ease),transform .45s var(--ease)}',
'.work.on{opacity:1;transform:none;pointer-events:auto}',
'.page{max-width:1180px}',
'.ph{display:flex;align-items:flex-end;gap:18px;flex-wrap:wrap;margin-bottom:24px}',
'.ph .t{flex:1 1 380px}.ph .ar{color:var(--ink3);font-size:13px}',
'.ph h1{margin:2px 0 0;font-size:30px;letter-spacing:-.02em;font-weight:700}',
'.ph p{margin:6px 0 0;color:var(--ink2);max-width:72ch}',
'.acts{display:flex;gap:10px;flex-wrap:wrap}',

/* buttons */
'.btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;padding:10px 16px;min-height:40px;border-radius:12px;border:1px solid var(--line2);background:var(--panel);color:var(--ink);font-weight:600;font-size:14px;white-space:nowrap;',
'  transition:background .15s,border-color .15s,transform .15s var(--ease),box-shadow .15s}',
'.btn:hover{background:var(--panel2);border-color:var(--blue2)}',
'.btn:active{transform:translateY(1px)}',
'.btn.primary{background:var(--blue);border-color:var(--blue);color:var(--onaccent)}',
'.btn.primary:hover{background:var(--bluehover);box-shadow:0 8px 22px -10px var(--blue)}',
'.btn.danger{background:var(--danger);border-color:var(--danger);color:var(--onaccent)}.btn.danger:hover{background:var(--dangerhover)}',
'.btn.quiet{background:none;border-color:transparent;color:var(--ink2)}.btn.quiet:hover{background:var(--panel);color:var(--ink);border-color:var(--line)}',
'.btn.sm{min-height:32px;padding:5px 11px;font-size:13px;border-radius:10px}',
'.btn[disabled]{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}',
'.linkbtn{background:none;border:0;padding:0;color:var(--blue3);font-weight:600;font-size:13px}',
'.linkbtn:hover{text-decoration:underline}',

/* tabs */
'.tabs{display:flex;gap:4px;border-bottom:1px solid var(--line);margin-bottom:22px;overflow-x:auto}',
'.tab{position:relative;background:none;border:0;padding:11px 14px;color:var(--ink2);font-weight:600;transition:color .15s}',
'.tab:hover{color:var(--ink)}',
'.tab::after{content:"";position:absolute;left:10px;right:10px;bottom:-1px;height:3px;border-radius:3px;background:var(--blue2);transform:scaleX(0);transition:transform .25s var(--ease)}',
'.tab[aria-selected=true]{color:var(--ink)}.tab[aria-selected=true]::after{transform:scaleX(1)}',
'.tabbody{animation:fadeup .3s var(--ease)}',
'@keyframes fadeup{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}',

/* hex steps */
'.steps{display:flex;align-items:center;gap:12px;margin:2px 0 24px}',
'.step{display:flex;align-items:center;gap:10px;white-space:nowrap}',
'.step .hx{width:30px;height:34px;clip-path:var(--hex);background:var(--line);padding:1.5px;transition:background .3s}',
'.step .hx b{width:100%;height:100%;clip-path:var(--hex);background:var(--panel);display:grid;place-items:center;font-size:12px;transition:background .3s}',
'.step span{font-weight:600;color:var(--ink3);transition:color .3s}',
'.step.done .hx{background:var(--blue2)}.step.done .hx b{background:var(--bluebg)}.step.done span{color:var(--ink)}',
'.step.now .hx{background:var(--honey)}.step.now .hx b{background:var(--honeybg)}.step.now span{color:var(--ink)}',
'.steps .bar{flex:1;height:2px;background:var(--line);position:relative;overflow:hidden;min-width:20px}',
'.steps .bar i{position:absolute;inset:0;background:var(--blue2);transform:scaleX(0);transform-origin:left;transition:transform .45s var(--ease)}',
'.steps .bar.done i{transform:scaleX(1)}',

/* fields */
'.field{display:grid;gap:6px;margin-bottom:12px}',
'.field>span{font-size:13px;font-weight:600;color:var(--ink2)}',
'.input{width:100%;padding:11px 13px;border-radius:12px;border:1px solid var(--line2);background:var(--well);color:var(--ink);min-height:42px;transition:border-color .15s,box-shadow .15s}',
'.input:hover{border-color:var(--inputhover)}',
'.input:focus{outline:none;border-color:var(--blue2);box-shadow:0 0 0 3px var(--focus)}',
'select.input{appearance:auto}',
'textarea.input{min-height:110px;resize:vertical}',
'.grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}',
'.grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}',
'.row{display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap}',
'.spacer{height:14px}',
'.check{display:flex;align-items:center;gap:10px;font-size:13.5px;color:var(--ink2)}',
'.check input{width:16px;height:16px;accent-color:var(--blue2)}',

/* drop zone */
'.drop{display:grid;gap:6px;justify-items:center;text-align:center;padding:30px 24px;border:1.5px dashed var(--line2);border-radius:18px;background:var(--well);cursor:pointer;transition:border-color .2s,background .2s,transform .2s var(--ease)}',
'.drop:hover,.drop.over{border-color:var(--blue2);background:var(--dropover)}',
'.drop.over{transform:scale(1.01)}',
'.drop .dh{width:44px;height:50px;clip-path:var(--hex);background:var(--bluebg);display:grid;place-items:center;color:var(--blue3);margin-bottom:6px;transition:transform .25s var(--ease)}',
'.drop:hover .dh{transform:translateY(-3px)}',
'.drop strong{font-size:15px}',
'.chipfile{display:inline-flex;align-items:center;gap:12px;padding:9px 12px 9px 14px;border:1px solid var(--line2);border-radius:12px;background:var(--panel)}',

/* counts */
'.counts{display:flex;border:1px solid var(--line);border-radius:16px;overflow:hidden;margin:14px 0}',
'.count{flex:1 1 120px;padding:14px 18px;border-right:1px solid var(--line);background:var(--panel)}',
'.count:last-child{border-right:0}',
'.count b{display:block;font-size:26px;font-weight:700;line-height:1.1}',
'.count span{color:var(--ink2);font-size:13px}',
'.count.new b{color:var(--blue3)}.count.upd b{color:var(--honey)}.count.bad b{color:var(--bad)}.count.ok b{color:var(--ok)}',

/* chips */
'.chip{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:700;white-space:nowrap;background:var(--chipbg);color:var(--ink2)}',
'.chip.new{background:var(--bluebg);color:var(--blue3)}.chip.upd{background:var(--warnbg);color:var(--honey)}.chip.bad{background:var(--badbg);color:var(--bad)}.chip.ok{background:var(--okbg);color:var(--ok)}',

/* table */
'.tbar{display:flex;align-items:center;gap:10px;margin:8px 0;flex-wrap:wrap}',
'.tbar .input{max-width:280px;min-height:36px;padding:7px 11px}',
'.twrap{overflow:auto;max-height:520px;border:1px solid var(--line);border-radius:16px;background:var(--panel)}',
'table{border-collapse:separate;border-spacing:0;width:100%;font-size:13.5px}',
'th{position:sticky;top:0;z-index:1;background:var(--panel2);text-align:left;font-weight:600;color:var(--ink2);font-size:12.5px;padding:10px 14px;border-bottom:1px solid var(--line);white-space:nowrap}',
'td{padding:10px 14px;border-bottom:1px solid var(--line);white-space:nowrap;max-width:380px;overflow:hidden;text-overflow:ellipsis;vertical-align:top}',
'td.wrap{white-space:normal;min-width:240px}',
'tr:last-child td{border-bottom:0}',
'tbody tr{transition:background .12s}tbody tr:hover{background:var(--rowhover)}',
'tr.sel td{background:var(--rowsel)}',
'td.chg{background:var(--warnbg)}',
'td input[type=checkbox],th input[type=checkbox]{accent-color:var(--blue2);width:15px;height:15px}',
'.tmore{padding:9px 14px;color:var(--ink2);font-size:13px}',

/* run panel */
'.run{border:1px solid var(--line);border-radius:16px;padding:16px 18px;background:var(--panel)}',
'.runh{display:flex;justify-content:space-between;gap:10px;align-items:baseline}',
'.pbar{height:8px;border-radius:999px;background:var(--well);overflow:hidden;margin:12px 0 8px}',
'.pbar i{display:block;height:100%;width:0;border-radius:999px;background:linear-gradient(90deg,var(--blue),var(--blue2));transition:width .3s var(--ease)}',
'.pbar.done i{background:var(--ok)}',
'.log{margin-top:10px;max-height:220px;overflow:auto;font:12px/1.55 ui-monospace,Consolas,monospace;background:var(--well);border-radius:10px;padding:9px 11px;white-space:pre-wrap;color:var(--ink2)}',
'.log .e{color:var(--bad)}.log .w{color:var(--honey)}.log .o{color:var(--ok)}',

/* notes */
'.note{display:flex;gap:12px;padding:12px 14px;border-radius:12px;background:var(--panel);border:1px solid var(--line);margin:12px 0;font-size:13.5px;color:var(--ink2)}',
'.note::before{content:"";width:4px;border-radius:4px;background:var(--ink3);flex:none}',
'.note b{display:block;color:var(--ink);margin-bottom:2px}',
'.note.warn::before{background:var(--honey)}.note.bad::before{background:var(--bad)}.note.ok::before{background:var(--ok)}.note.info::before{background:var(--blue2)}',

/* dialog + toast + palette */
'.scrim{position:absolute;inset:0;background:var(--scrim);z-index:40;display:grid;place-items:center;opacity:0;transition:opacity .2s var(--ease)}',
'.scrim.on{opacity:1}',
'.dlg{width:min(520px,92vw);background:var(--panel2);border:1px solid var(--line2);border-radius:20px;padding:22px 24px;box-shadow:0 40px 80px -30px var(--shadow);transform:translateY(10px) scale(.98);transition:transform .25s var(--ease)}',
'.scrim.on .dlg{transform:none}',
'.dlg h2{margin:0 0 10px;font-size:19px}',
'.dlg .acts{justify-content:flex-end;margin-top:16px}',
'.envbox{display:flex;align-items:center;gap:12px;padding:11px 13px;border-radius:12px;background:var(--bluebg);border-left:5px solid var(--prod);margin:4px 0 12px}',
'.envbox.uat{border-left-color:var(--uat)}.envbox b{font-size:16px}',
'.toasts{position:absolute;right:20px;bottom:20px;display:grid;gap:8px;z-index:50}',
'.toast{background:var(--panel3);border:1px solid var(--line2);color:var(--ink);padding:11px 15px;border-radius:12px;font-size:13.5px;max-width:380px;animation:fadeup .25s var(--ease)}',
'.toast.bad{border-color:var(--badline)}',
'.pal{position:absolute;left:50%;top:14vh;width:min(640px,92vw);transform:translate(-50%,-8px);background:var(--panel2);border:1px solid var(--line2);border-radius:18px;overflow:hidden;box-shadow:0 40px 80px -30px var(--shadow);z-index:45;opacity:0;transition:opacity .18s var(--ease),transform .22s var(--ease)}',
'.pal.on{opacity:1;transform:translate(-50%,0)}',
'.pal .q{display:flex;align-items:center;gap:12px;padding:16px 18px;border-bottom:1px solid var(--line);color:var(--blue3)}',
'.pal .q input{flex:1;background:none;border:0;outline:none;font-size:18px;color:var(--ink);box-shadow:none;padding:0;min-height:0}',
'.pal ul{list-style:none;margin:0;padding:8px;max-height:52vh;overflow:auto}',
'.pal li button{width:100%;display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;background:none;border:0;text-align:left;color:var(--ink2);transition:background .12s}',
'.pal li button b{color:var(--ink);font-weight:600}',
'.pal li button em{margin-left:auto;font-style:normal;font-size:12.5px;color:var(--ink3)}',
'.pal li button[aria-selected=true],.pal li button:hover{background:var(--panel3)}',
'.pal li button[aria-selected=true] .ic{color:var(--blue3)}',

/* login */
'.login{position:absolute;inset:0;display:grid;place-items:center;z-index:10}',
'.lcard{width:min(420px,92vw);background:var(--lcardbg);border:1px solid var(--line2);border-radius:22px;padding:30px 30px 26px;box-shadow:0 40px 90px -40px var(--shadow);backdrop-filter:blur(8px);animation:fadeup .4s var(--ease)}',
'.lhex{position:absolute;inset:0;pointer-events:none;overflow:hidden}',
'.lhex i{position:absolute;width:150px;height:173px;clip-path:var(--hex);background:var(--line);padding:1.5px;opacity:.55}',
'.lhex i::after{content:"";position:absolute;inset:1.5px;clip-path:var(--hex);background:var(--well2)}',
'.lhex i.b{background:var(--blue2);opacity:.35}.lhex i.y{background:var(--honey);opacity:.5}',
'.lcard .brand{margin-bottom:22px}',
'.lcard h2{margin:0 0 4px;font-size:24px}',
'.seg{display:flex;background:var(--well);border:1px solid var(--line);border-radius:12px;padding:4px;margin:16px 0 18px}',
'.seg button{flex:1;border:0;background:none;padding:9px;border-radius:9px;font-weight:600;color:var(--ink2);display:flex;align-items:center;justify-content:center;gap:8px;transition:background .2s,color .2s}',
'.seg button i{width:8px;height:8px;border-radius:50%;background:var(--prod)}.seg button.u i{background:var(--uat)}',
'.seg button[aria-pressed=true]{background:var(--panel3);color:var(--ink)}',
'.seg button:hover{color:var(--ink)}',
'.err{color:var(--bad);font-size:13px;min-height:18px;margin:2px 0 8px}',
'.pw{position:relative}.pw .input{padding-right:44px}.pw button{position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none;border:0;color:var(--ink3);padding:6px}',
'.pw button:hover{color:var(--ink)}',
'.spin{display:inline-block;width:14px;height:14px;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:sp .7s linear infinite}',
'@keyframes sp{to{transform:rotate(360deg)}}',
'.empty{padding:24px;color:var(--ink2);border:1px dashed var(--line2);border-radius:14px}',
'.kv{display:grid;grid-template-columns:max-content 1fr;gap:5px 16px;font-size:13.5px}.kv dt{color:var(--ink2)}.kv dd{margin:0;font-weight:600}',
'.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;padding:18px}',
'details summary{cursor:pointer;color:var(--ink2);font-size:13px}',
'pre.code{background:var(--well);border:1px solid var(--line);border-radius:12px;padding:12px;overflow:auto;font:12px/1.5 ui-monospace,Consolas,monospace;color:var(--ink2);max-height:320px}',

/* ---------- v3.10: shared tokens (v3.6.1 look) ---------- */
'.app{--r4:4px;--r6:8px;--r8:10px;--r10:10px;--r12:14px;--r14:16px;--t12:12.5px;--t13:13.5px;--t15:15px;--t18:18px;--t24:26px;--t32:38px;',
'  --mono:ui-monospace,"SF Mono",Consolas,"Liberation Mono",monospace;--settle:cubic-bezier(.22,1,.36,1);--focusring:#5B9BFF;--honeyedge:var(--honey);--fieldline:#5C6B86;',
/* contrast (a11y): muted text ≥4.5:1 on panels and faces; field borders ≥3:1 */
'  --ink3:#8C9AB0;--cellink3:#B0BDD1;--honeyink2:#4A380E}',
'.app[data-theme=light]{--focusring:#0B5CC7;--fieldline:#7F8CA1;--ink3:#5F6C82;--cellink3:#5F6C82;--honey:#9A6400;--honeyedge:#D99412;--ok:#0E7A4D}',
/* tool counts and hints on the hexagons: readable on the area, tool and hover faces (≥ 4.5:1) */
'.cell .ct,.cell .ht{color:var(--cellink3)}',
':focus-visible{outline-color:var(--focusring)}',
/* icon buttons: the focus ring appears at once (v3.6.1 transitioned every property, so the ring faded in) */
'.iconbtn{transition:background .15s,color .15s,border-color .15s}',
'.input{border-color:var(--fieldline)}.input:hover{border-color:var(--ink3)}',
/* hexagon focus: a blue ring, so keyboard focus is not mistaken for the honey hover */
'.cell:focus-visible .rim{background:var(--focusring)}',
'.cell:focus-visible{filter:drop-shadow(0 0 1px var(--focusring)) drop-shadow(0 0 4px var(--focusring))}',
'.cell.hub:focus-visible .rim{background:var(--focusring)}',
/* hidden panes and screens leave the Tab order */
'.sidepane{transition:opacity .3s var(--ease),transform .4s var(--ease),visibility 0s}',
'.sidepane.off{visibility:hidden;transition:opacity .3s var(--ease),transform .4s var(--ease),visibility 0s .3s}',
'.work{visibility:hidden;transition:opacity .35s var(--ease),transform .45s var(--ease),visibility 0s .45s}',
'.work.on{visibility:inherit;transition:opacity .35s var(--ease),transform .45s var(--ease),visibility 0s}',

/* ---------- motion: calm (default) ----------
 * Cells are moved by the Web Animations API in core/shell.js layout(); CSS only handles hover. */
'.app[data-motion=calm] .cell{transition:filter .2s var(--ease)}',
'.app[data-motion=calm] .work{transform:translateX(8px);transition:opacity .2s var(--ease),transform .24s var(--settle),visibility 0s .24s}',
'.app[data-motion=calm] .work.on{transform:none;transition:opacity .2s var(--ease),transform .24s var(--settle),visibility 0s}',
'.app[data-motion=calm] .sidepane{transition:opacity .2s var(--ease),transform .24s var(--settle),visibility 0s}',
'.app[data-motion=calm] .sidepane.off{transform:translateX(-6px);transition:opacity .2s var(--ease),transform .24s var(--settle),visibility 0s .2s}',

/* ---------- motion: off ----------
 * No movement anywhere: things appear with a short fade, hover/selection still change colour, progress still shows.
 * Covers module styles too (dev panel, admin settings) through the general rule. */
'.app[data-motion=off] *,.app[data-motion=off] *::before,.app[data-motion=off] *::after{transition-duration:.12s!important;transition-delay:0s!important;animation-duration:.12s!important;animation-delay:0s!important;animation-iteration-count:1!important;scroll-behavior:auto!important}',
'.app[data-motion=off] .cell{transition:none!important}',
'.app[data-motion=off] .cell .tl,.app[data-motion=off] .cell .ic,.app[data-motion=off] .cell:hover .ic{transform:none!important}',
'.app[data-motion=off] .cell.mini .ic{transform:scale(2.3)!important}',
'.app[data-motion=off] :is(.tabbody,.gsec,.ccard,.toast,.menu,.lcard,.slotmark,.acc-body){animation-name:fadein!important}',
'.app[data-motion=off] :is(.sidepane,.work,.gallery,.side,.modhead,.modfoot,.peek,.tip,.dlg,.dock,.dock .dhex,.dock .dlabel,.devpanel,.drop,.btn,.gtile,.lcard,.lhex i,.login),.app[data-motion=off].min>:not(.dock):not(.toasts){transform:none!important}',
'.app[data-motion=off] .arrbar{transform:translate(-50%,0)!important}.app[data-motion=off] .pal{transform:translate(-50%,0)!important}',
'.app[data-motion=off] .spin{animation-duration:1.6s!important;animation-iteration-count:infinite!important}',
'.app[data-motion=off] .cell.nope .tl{animation:none!important}.app[data-motion=off] .cell.nope .rim{animation:nopec .7s linear 1!important}',
'@keyframes nopec{0%,75%{background:var(--bad)}}',
'.app[data-motion=off] .backlight{display:none}',
'.app[data-motion=off] .cell:hover:not(.gone):not(:focus-visible){filter:none}',
'@keyframes fadein{from{opacity:0}to{opacity:1}}',
/* top bar on smaller windows: the controls keep their size; the breadcrumb is cut off instead of running under them */
'.top>:not(.crumb):not(.topgap){flex:none}',
'.crumb{overflow:clip;overflow-clip-margin:4px}.crumb button{white-space:nowrap}',
/* narrow windows (v3.6.1 layout): the side pane stays 320px and the page scrolls sideways instead of cutting off the
 * top-bar buttons and the workspace; overlays stay on screen while it is scrolled */
'.app{overflow-x:auto;overflow-y:hidden}',
'.app>.top,.app>.body{min-width:980px}',
'.app>.body{overflow:hidden}',
'@media (max-width:1100px){.top{gap:12px;padding:0 20px}}',
'.app::before,.scrim,.toasts{position:fixed}',
/* search results: long hints shorten instead of pushing the area / shortcut text onto several lines */
'.pal li button b{white-space:nowrap}',
'.pal li button span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
'.pal li button em{white-space:nowrap;flex:none}',
'@media (max-width:560px){.pal li button span{display:none}}',

/* ---------- v3.11 "Hive" theme: warm graphite dark (direction C), light first in Atlassian structure ----------
 * Flat surfaces, 1px hairlines, 3px controls / 4px containers, no glows or gradients (the honey hub keeps its gradient).
 * Borrowed rules: flat tables and square fields (IBM Carbon), outlined badges (GitHub Primer).
 * Roles: ink = actions (primary button is ink on paper / paper on ink), honey = where you are and what is selected. */
'.app{--bg:#191816;--panel:#211F1C;--panel2:#262420;--panel3:#2F2C27;--line:#34302A;--line2:#4A453C;--ink:#ECE6DA;--ink2:#B4AC9C;--ink3:#A39A88;--cellink3:#B4AC9C;--field:#262420;--fieldline:#7D766A;--blue:#ECE6DA;--bluehover:#FFFFFF;--onaccent:#191816;--blue2:#E9A825;--blue3:#D9C9A3;--bluebg:#2E2614;--honey:#E9A825;--honeybg:#2E2614;--honeyedge:#E9A825;--prod:#9CC27A;--uat:#E9A825;--bad:#EE7A6A;--badbg:#2C1916;--ok:#9CC27A;--okbg:#1E2618;--warnbg:#2E2614;--well:#1D1C19;--well2:#191816;--glow:#191816;--topbg:#191816;--cellglow:transparent;--cellhover:#2F2C27;--pip:#7E766A;--toolface:#211F1C;--ghostrim:#2A2723;--peekline:#4A453C;--shadow:#000;--danger:#EE7A6A;--dangerhover:#F28E80;--inputhover:#8C8475;--focus:transparent;--dropover:#262420;--chipbg:transparent;--rowhover:#23211E;--rowsel:#2A2418;--scrim:#0f0e0ccc;--badline:#EE7A6A66;--lcardbg:#211F1C;--badrow:#2C1916;--badrowh:#331D19;--warnrow:#2A2418;--ringtrack:#2E2614;--honeyglow:transparent;--cellshadow:#0000008c;--modface:#211F1C;--blcore:rgba(233,168,37,.20);--blmid:rgba(233,168,37,.07);--areaface:#211F1C;--toolface2:#211F1C;--hoverface:#2A2723;--focusring:#E9A825;--elev:0 8px 24px rgba(0,0,0,.45)}',
'.app[data-theme=light]{--bg:#F6F5F2;--panel:#FFFFFF;--panel2:#FFFFFF;--panel3:#EFEDE8;--line:#E3E0D9;--line2:#CCC7BD;--ink:#1F1D1A;--ink2:#4F4A43;--ink3:#6B655C;--cellink3:#6B655C;--field:#F3F1EC;--fieldline:#8C867B;--blue:#2A2723;--bluehover:#000000;--onaccent:#FFFFFF;--blue2:#B57A00;--blue3:#6B4A00;--bluebg:#FDF6E7;--honey:#9A6400;--honeybg:#FDF6E7;--honeyedge:#D99412;--prod:#1F8A57;--uat:#9A6400;--bad:#AE2E24;--badbg:#FFECEB;--ok:#216E4E;--okbg:#E3F4EA;--warnbg:#FDF6E7;--well:#FFFFFF;--well2:#F6F5F2;--glow:#F6F5F2;--topbg:#FFFFFF;--cellglow:transparent;--cellhover:#F6F5F2;--pip:#A39E94;--toolface:#FFFFFF;--ghostrim:#ECE9E3;--peekline:#CCC7BD;--shadow:#2A272326;--danger:#C9372C;--dangerhover:#AE2E24;--inputhover:#6B655C;--focus:transparent;--dropover:#FBF8F1;--chipbg:transparent;--rowhover:#FAF9F6;--rowsel:#FDF6E6;--scrim:#1F1D1A66;--badline:#AE2E2466;--lcardbg:#FFFFFF;--badrow:#FFF1F0;--badrowh:#FFE4E1;--warnrow:#FFF8E8;--ringtrack:#F2E6C8;--honeyglow:transparent;--cellshadow:#2A272333;--modface:#FFFFFF;--blcore:rgba(217,148,18,.16);--blmid:rgba(217,148,18,.06);--areaface:#FFFFFF;--toolface2:#FFFFFF;--hoverface:#FFFCF5;--focusring:#B57A00;--elev:0 8px 24px rgba(42,39,35,.14),0 0 0 1px rgba(42,39,35,.05)}',
'.app::before{background:var(--bg)}',
'.top{backdrop-filter:none}.top::before{display:none}',
'.envpill{border-radius:3px;background:transparent;border-color:var(--line2)}.envpill i,.envpill.uat i{box-shadow:none}',
'.who{border-radius:3px}.av{background:var(--honeyedge);color:#1F1D1A}',
'.iconbtn,.crumb button,.searchbtn,.rec,.seg,.seg button,.chipfile,.envbox,.toast,.log,pre.code,.note,.searchbtn kbd,.kbd{border-radius:3px}',
'.card,.counts,.peek,.run,.drop,.empty,.dlg,.pal,.lcard{border-radius:4px}',
'.dlg,.pal,.peek,.lcard{box-shadow:var(--elev)}.lcard{backdrop-filter:none}',
'.searchbtn:hover{border-color:var(--ink3)}',
'.rec.on{color:var(--ink)}',
'.btn{border-radius:3px;background:transparent;border-color:var(--line2);min-height:36px;padding:7px 14px}',
'.btn:hover{background:var(--panel3);border-color:var(--line2)}',
'.btn.primary:hover{background:var(--bluehover);border-color:var(--bluehover);box-shadow:none}',
'.btn.quiet{border-color:transparent}.btn.quiet:hover{background:var(--panel3);border-color:transparent}',
'.btn.sm{min-height:30px;border-radius:3px}',
'.input{border-radius:0;border:0;border-bottom:1px solid var(--fieldline);background:var(--field)}',
'.input:hover{border-bottom-color:var(--inputhover)}',
'.input:focus{box-shadow:none;border-bottom-color:var(--focusring);outline:2px solid var(--focusring);outline-offset:-2px}',
'.tab::after{left:0;right:0;height:2px;border-radius:0;background:var(--honeyedge)}',
'.step.done .hx{background:var(--ink2)}.step.done .hx b{background:var(--panel3)}.steps .bar i{background:var(--ink2)}',
'.drop{border-radius:4px;background:transparent}.drop .dh{background:var(--honeybg);color:var(--honey)}',
'.counts{border-color:var(--line)}',
'.chip{background:transparent;border:1px solid var(--line2);font-weight:600;padding:1px 9px}',
'.chip.new,.chip.upd,.chip.bad,.chip.ok{background:transparent;border-color:color-mix(in srgb,currentColor 55%,transparent)}',
'.chip.new{color:var(--blue3)}',
'.twrap{border:0;border-radius:0;background:transparent}',
'th{background:var(--panel3);color:var(--ink);border-bottom:0}',
'tbody tr{background:var(--panel)}',
'td input[type=checkbox],th input[type=checkbox],.check input{accent-color:var(--ink)}',
'.run{border-radius:4px}.pbar{height:4px;border-radius:0;background:var(--panel3)}.pbar i{border-radius:0;background:var(--honeyedge)}',
'.note::before{width:3px;border-radius:0}',
'.cell .rim{background:var(--line2)}'
].join('\n');

// Fonts must be registered on the document (shadow roots share document.fonts).
ctx.loadFonts = function () {
  if (!window.FontFace || ctx._fontsLoaded) return;
  ctx._fontsLoaded = true;
  [400, 500, 600, 700, 800].forEach(function (w) {
    try {
      var f = new FontFace('Schibsted Grotesk', 'url(' + ctx.CONFIG.FONT_BASE + w + '-normal.woff2) format("woff2")', { weight: String(w) });
      f.load().then(function (ff) { document.fonts.add(ff); }).catch(function () {});
    } catch (e) {}
  });
};
