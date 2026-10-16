/* modules/health.js — Health check (v3.14): read-only checks of the configuration in the signed-in environment.
 *
 * Reads the lists the other tools already read (same endpoints, GET only) and reports:
 *   Problems  — a reference to something that does not exist (broken link), duplicate codes / names
 *   Warnings  — an inactive paycode that is still used
 *   Info      — things nothing uses (paycodes, accruals, policies, shift templates not in any set or pattern)
 * Nothing is written. Lists that cannot be read are reported and skipped. */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api;
var MOD = 'Health check';

function ref(o) { return o && o.id != null ? String(o.id) : null; }
function byId(list) { var m = {}; list.forEach(function (x) { m[String(x.id)] = x; }); return m; }
function nameOf(x) { return x ? (x.code || x.name || '#' + x.id) : ''; }

var LISTS = [
  ['paycodes', 'paycodes.list', 'Paycodes'], ['combos', 'paycode-combinations.list', 'Combinations'], ['events', 'paycode-events.list', 'Paycode events'],
  ['eventSets', 'paycode-event-sets.list', 'Event sets'], ['templates', 'shift-templates.list', 'Shift templates'], ['templateSets', 'shift-template-sets.list', 'Shift template sets'],
  ['patterns', 'schedule-patterns.list', 'Schedule patterns'], ['accruals', 'accrual.list', 'Accruals'], ['accPolicies', 'accrual-policies.list', 'Accrual policies'],
  ['accSets', 'accrual-policy-sets.list', 'Accrual policy sets'], ['toPolicies', 'timeoff-policy-sets.policies', 'Time off policies'], ['toSets', 'timeoff-policy-sets.list', 'Time off policy sets'],
  ['opPolicies', 'outpass-policy-sets.policies', 'Outpass policies'], ['opSets', 'outpass-policy-sets.list', 'Outpass policy sets']
];

async function readAll(progress) {
  var D = {}, missing = [];
  for (var i = 0; i < LISTS.length; i++) {
    var L = LISTS[i];
    progress && progress(L[2]);
    try { D[L[0]] = await ctx.EP.list(L[1], null, { module: MOD }); }
    catch (e) { D[L[0]] = null; missing.push(L[2] + ' (' + e.message.replace(/^Could not load [^ ]+ /, '') + ')'); }
  }
  return { D: D, missing: missing };
}

function checks(D) {
  var out = [];
  function add(sev, area, item, finding) { out.push({ sev: sev, area: area, item: item, finding: finding }); }
  function dupes(list, area, key) {
    if (!list) return;
    var seen = {};
    list.forEach(function (x) { var k = X.str(x[key]).toLowerCase(); if (!k) return; (seen[k] = seen[k] || []).push(x); });
    Object.keys(seen).forEach(function (k) { if (seen[k].length > 1) add('Problem', area, seen[k].map(nameOf).join(', '), 'Same ' + key + ' used ' + seen[k].length + ' times (ids ' + seen[k].map(function (x) { return x.id; }).join(', ') + ')'); });
  }
  var P = D.paycodes ? byId(D.paycodes) : null;
  var used = {};   // paycode id → where it is used
  function use(id, where) { if (id == null) return; (used[id] = used[id] || []).push(where); }
  function needPaycode(o, area, item, field) {
    var id = ref(o); if (id == null || !P) return id;
    if (!P[id]) add('Problem', area, item, field + ' points to paycode id ' + id + ', which does not exist');
    else if (P[id].inactive) add('Warning', area, item, field + ' uses inactive paycode ' + nameOf(P[id]));
    return id;
  }
  dupes(D.paycodes, 'Paycodes', 'code');
  (D.paycodes || []).forEach(function (p) { var l = ref(p.linkedPaycode); if (l) { use(l, 'linked from ' + nameOf(p)); if (P && !P[l]) add('Problem', 'Paycodes', nameOf(p), 'Linked paycode id ' + l + ' does not exist'); } });
  (D.combos || []).forEach(function (c) {
    var label = ['firstPaycode', 'secondPaycode', 'combinedPaycode'].map(function (k) { var id = ref(c[k]); return P && id && P[id] ? nameOf(P[id]) : '#' + id; }).join(' + ').replace(/ \+ ([^+]+)$/, ' → $1');
    ['firstPaycode', 'secondPaycode', 'combinedPaycode'].forEach(function (k) { var id = c.inactive ? ref(c[k]) : needPaycode(c[k], 'Combinations', label, k); use(id, 'combination'); });
  });
  var E = D.events ? byId(D.events) : null;
  (D.events || []).forEach(function (e) {
    use(needPaycode(e.paycode, 'Paycode events', e.name, 'paycode'), 'event ' + e.name);
    if (!(e.schedules || []).length) add('Info', 'Paycode events', e.name, 'No dates (schedules) in this event');
  });
  dupes(D.events, 'Paycode events', 'name');
  var inSet = {};
  (D.eventSets || []).forEach(function (s) { (s.entries || []).forEach(function (en) { var id = ref(en.paycodeEvent); inSet[id] = 1; if (E && id && !E[id]) add('Problem', 'Event sets', s.name, 'Entry points to event id ' + id + ', which does not exist'); }); });
  if (D.events && D.eventSets) D.events.forEach(function (e) { if (!inSet[String(e.id)]) add('Info', 'Paycode events', e.name, 'Not in any event set'); });
  // shifts
  var ST = D.templates ? byId(D.templates) : null, stUsed = {};
  dupes(D.templates, 'Shift templates', 'name');
  (D.templateSets || []).forEach(function (s) { (s.entries || []).forEach(function (en) { var id = ref(en); stUsed[id] = 1; if (ST && id && !ST[id]) add('Problem', 'Shift template sets', s.name, 'Entry points to shift template id ' + id + ', which does not exist'); }); });
  (D.patterns || []).forEach(function (pt) {
    (pt.entries || []).forEach(function (en) {
      var sid = ref(en.shiftTemplate); if (sid) { stUsed[sid] = 1; if (ST && !ST[sid]) add('Problem', 'Schedule patterns', pt.name, 'Week ' + en.week + ' day ' + en.dayOfWeek + ': shift template id ' + sid + ' does not exist'); }
      use(needPaycode(en.paycode, 'Schedule patterns', pt.name, 'Week ' + en.week + ' day ' + en.dayOfWeek + ' paycode'), 'pattern ' + pt.name);
    });
  });
  if (D.templates && (D.templateSets || D.patterns)) D.templates.forEach(function (t) { if (!stUsed[String(t.id)]) add('Info', 'Shift templates', t.name, 'Not in any shift template set or schedule pattern'); });
  // accruals
  var A = D.accruals ? byId(D.accruals) : null, AP = D.accPolicies ? byId(D.accPolicies) : null, aUsed = {}, apUsed = {};
  dupes(D.accruals, 'Accruals', 'name');
  (D.accPolicies || []).forEach(function (p) { var id = ref(p.accrual); if (id) { aUsed[id] = 1; if (A && !A[id]) add('Problem', 'Accrual policies', p.name, 'Accrual id ' + id + ' does not exist'); } });
  (D.accSets || []).forEach(function (s) { (s.entries || []).forEach(function (en) { var id = ref(en); apUsed[id] = 1; if (AP && id && !AP[id]) add('Problem', 'Accrual policy sets', s.name, 'Policy id ' + id + ' does not exist'); }); });
  if (D.accruals && D.accPolicies) D.accruals.forEach(function (a) { if (!aUsed[String(a.id)]) add('Info', 'Accruals', a.name, 'No accrual policy uses this accrual'); });
  if (D.accPolicies && D.accSets) D.accPolicies.forEach(function (p) { if (!apUsed[String(p.id)]) add('Info', 'Accrual policies', p.name, 'Not in any accrual policy set'); });
  // time off
  var TP = D.toPolicies ? byId(D.toPolicies) : null, tpUsed = {};
  (D.toSets || []).forEach(function (s) { (s.entries || []).forEach(function (en) { var id = ref(en); tpUsed[id] = 1; if (TP && id && !TP[id]) add('Problem', 'Time off policy sets', s.name, 'Policy id ' + id + ' does not exist'); use(needPaycode(en.paycode, 'Time off policy sets', s.name, 'Entry ' + (en.name || id) + ' paycode'), 'time off set ' + s.name); }); });
  (D.toPolicies || []).forEach(function (p) { use(ref(p.paycode), 'time off policy ' + p.name); });
  if (D.toPolicies && D.toSets) D.toPolicies.forEach(function (p) { if (!tpUsed[String(p.id)]) add('Info', 'Time off policies', p.name, 'Not in any time off policy set'); });
  // outpass
  var OP = D.opPolicies ? byId(D.opPolicies) : null, opUsed = {};
  (D.opSets || []).forEach(function (s) { (s.entries || []).forEach(function (en) { var id = ref(en); opUsed[id] = 1; if (OP && id && !OP[id]) add('Problem', 'Outpass policy sets', s.name, 'Policy id ' + id + ' does not exist'); }); });
  if (D.opPolicies && D.opSets) D.opPolicies.forEach(function (p) { if (!opUsed[String(p.id)]) add('Info', 'Outpass policies', p.name, 'Not in any outpass policy set'); });
  // paycodes nothing uses (only when the lists that can use them were all read)
  if (D.paycodes && D.combos && D.events && D.patterns && D.toSets) D.paycodes.forEach(function (p) { if (!used[String(p.id)] && !p.inactive) add('Info', 'Paycodes', nameOf(p) + (p.description ? ' — ' + p.description : ''), 'Not used by any combination, event, schedule pattern, time off policy or linked paycode'); });
  var order = { Problem: 0, Warning: 1, Info: 2 };
  out.sort(function (a, b) { return order[a.sev] - order[b.sev] || a.area.localeCompare(b.area) || String(a.item).localeCompare(String(b.item)); });
  return out;
}

ctx.defineTool('health', {
  desc: 'Read-only checks of the configuration: broken links, duplicates, inactive paycodes still in use, and things nothing uses.',
  render: function (view) {
    var body = h('div');
    view.appendChild(body);
    function start() {
      U.swap(body, UI.note('info', null, 'Reads paycodes, events, combinations, shifts, accruals, time off and outpass setup from ' + Api.envLabel() + ' and checks how they refer to each other. Nothing is written.'),
        h('div.row', UI.btn('Run the health check', { kind: 'primary', icon: 'play', onClick: run })));
    }
    async function run() {
      var status = h('span.muted', 'Reading…');
      U.swap(body, h('div.card', h('span.spin'), ' ', status));
      var r = await readAll(function (n) { status.textContent = 'Reading ' + n + ' from ' + Api.envLabel() + '…'; });
      var list = checks(r.D);
      var n = function (s) { return list.filter(function (x) { return x.sev === s; }).length; };
      var CH = { Problem: 'bad', Warning: 'upd', Info: '' };
      var tbl = UI.table([
        { key: 'sev', label: 'Severity', render: function (x) { return UI.chip(x.sev, CH[x.sev]); }, text: function (x) { return x.sev; } },
        { key: 'area', label: 'Area' }, { key: 'item', label: 'Item', wrap: true }, { key: 'finding', label: 'Finding', wrap: true }
      ], list, { label: 'Health check', rowKey: function (x, i) { return String(i); },
        toolbar: [UI.btn('Download (Excel)', { icon: 'download', sm: true, onClick: function () {
          return X.download('health_' + (Api.state.env || 'env') + '_' + U.stamp() + '.xlsx', [{ name: 'Findings', headers: ['Severity', 'Area', 'Item', 'Finding'], rows: list.map(function (x) { return [x.sev, x.area, x.item, x.finding]; }) },
            { name: 'About', headers: ['Field', 'Value'], rows: [['Environment', Api.envLabel()], ['Checked at', new Date().toISOString()], ['By', Api.state.user || ''], ['Lists not read', r.missing.join('; ') || 'none']] }]);
        } })] });
      U.swap(body,
        UI.counts([{ n: n('Problem'), label: 'Problems', kind: 'bad' }, { n: n('Warning'), label: 'Warnings', kind: 'upd' }, { n: n('Info'), label: 'Info' }]),
        r.missing.length ? UI.note('warn', 'Some lists could not be read', 'Checks that need them were skipped: ' + r.missing.join('; ')) : null,
        h('div.row', { style: { margin: '6px 0' } }, UI.btn('Run again', { kind: 'quiet', icon: 'retry', onClick: run })),
        list.length ? tbl : UI.empty('No findings. Everything that was read refers to things that exist.'));
    }
    start();
  }
});
