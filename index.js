/* =========================================================
 * APIary v3 — index.js
 * Loaded by loader.js with (0, eval). Fetches the core files in order,
 * runs each as new Function('ctx', code), then starts the shell.
 * Modules are fetched only when a tool is opened.
 * ========================================================= */
(function () {
  'use strict';

  var BASE = window.BFT_BASE || '';
  var old = document.getElementById('bft-host');
  if (old) old.remove(); // every click = fresh load of the latest files

  // ---- Modules → areas → tools (max 8 areas per module, 6 tools per area, so each fits the honeycomb) ----
  // A module with no areas yet shows as "Coming soon" on the module page. Add areas (here, in layout.json or in
  // Admin Settings) and move tools in to open it.
  var MODULES = [
    { id: 'attendance', name: 'Attendance', icon: 'clock', desc: 'Timecards, pay rules, shifts, accruals, leave and access.' },
    { id: 'onboarding', name: 'Onboarding', icon: 'userplus', desc: 'Joiners, documents and offer details.' },
    { id: 'core', name: 'Core', icon: 'building', desc: 'Employee master, org structure and access.' }
  ];

  // Built-in defaults. The honeycomb actually shown = these + layout.json (team) + this browser's changes (core/layout.js).
  var AREAS = [
    { id: 'attendance', module: 'attendance', name: 'Timecards & approvals', icon: 'cal', desc: 'Timecards, punches, overtime and approvals.',
      tools: ['timecard-update', 'punch', 'ot-approval', 'workflow-transfer', 'tasks'] },
    { id: 'pay', module: 'attendance', name: 'Pay rules', icon: 'coin', desc: 'Paycodes and the events and combinations that set them.',
      tools: ['paycodes', 'paycode-events', 'paycode-event-sets', 'paycode-combinations'] },
    { id: 'shifts', module: 'attendance', name: 'Shifts', icon: 'cal', desc: 'Shift templates, sets and schedule patterns.',
      tools: ['shift-templates', 'shift-template-sets', 'schedule-patterns'] },
    { id: 'accruals', module: 'attendance', name: 'Accruals', icon: 'leaf', desc: 'Leave balance types, how they are granted and carried over, and who gets which policy.',
      tools: ['accrual', 'accrual-policies', 'accrual-policy-sets', 'accrual-balances'] },
    { id: 'timeoff', module: 'attendance', name: 'Time off', icon: 'sun', desc: 'Time-off policy sets, rules per leave type, and raising leave.',
      tools: ['timeoff-policy-sets', 'timeoff-policy-config', 'timeoff-raise'] },
    { id: 'policies', module: 'attendance', name: 'Policies', icon: 'shield', desc: 'Outpass (short leave) policies and the sets that group them.',
      tools: ['outpass-policies', 'outpass-policy-sets'] },
    { id: 'people', module: 'attendance', name: 'People & access', icon: 'people', desc: 'Create employees in bulk, roles and positions, and the employee / org lookup tables.',
      tools: ['employee-bulk-create', 'roles', 'employee-lookup', 'org-lookup'] },
    { id: 'automation', module: 'attendance', name: 'Automation', icon: 'bolt', desc: 'Chain Beeforce API calls from a spreadsheet.',
      tools: ['api-automation'] }
  ];

  var TOOLS = {
    'timecard-update': { icon: 'cal', name: 'Timecard Update', hint: 'Override paycodes by date' },
    'punch': { icon: 'clock', name: 'Punch', hint: 'Add or bulk-upload punches' },
    'ot-approval': { icon: 'timer', name: 'OT Approval', hint: 'Approve overtime in bulk' },
    'workflow-transfer': { icon: 'route', name: 'Workflow Transfer', hint: 'Move pending approvals' },
    'tasks': { icon: 'inbox', name: 'Tasks', hint: 'Clear task queues' },
    'paycodes': { icon: 'tag', name: 'Paycodes', hint: 'Create, update, export' },
    'paycode-events': { icon: 'sun', name: 'Paycode Events', hint: 'Holiday-style events' },
    'paycode-event-sets': { icon: 'layers', name: 'Event Sets', hint: 'Group events by priority' },
    'paycode-combinations': { icon: 'scale', name: 'Combinations', hint: 'Two paycodes, one result' },
    'shift-templates': { icon: 'clock', name: 'Shift Templates', hint: 'Times, tolerances, rules' },
    'shift-template-sets': { icon: 'layers', name: 'Shift Template Set', hint: 'Group shift templates' },
    'schedule-patterns': { icon: 'repeat', name: 'Schedule Patterns', hint: 'Rotations and cycles' },
    'accrual': { icon: 'leaf', name: 'Accrual', hint: 'Leave balance types' },
    'accrual-policies': { icon: 'list', name: 'Accrual Policies', hint: 'Grant, prorate, carry over' },
    'accrual-policy-sets': { icon: 'layers', name: 'Accrual Policy Set', hint: 'Group accrual policies' },
    'accrual-balances': { icon: 'scale', name: 'Accrual Balances', hint: 'Grant or adjust balances' },
    'timeoff-policy-sets': { icon: 'layers', name: 'Time Off Policy Set', hint: 'Policies to paycodes' },
    'timeoff-policy-config': { icon: 'sliders', name: 'Timeoff Policy Config', hint: 'Rules per leave type' },
    'timeoff-raise': { icon: 'upload', name: 'Timeoff Raise', hint: 'Raise leave on behalf' },
    'outpass-policies': { icon: 'route', name: 'Outpass Policies', hint: 'Short-leave rules' },
    'outpass-policy-sets': { icon: 'layers', name: 'Outpass Policy Set', hint: 'Group outpass rules' },
    'employee-bulk-create': { icon: 'userplus', name: 'Employee Bulk Create', hint: 'New employees from Excel' },
    'roles': { icon: 'badge', name: 'Roles & Positions', hint: 'Access and hierarchy' },
    'employee-lookup': { icon: 'grid', name: 'Emp Lookup', hint: 'Employee field rules' },
    'org-lookup': { icon: 'building', name: 'Org Lookup', hint: 'Location field rules' },
    'api-automation': { icon: 'bolt', name: 'API Automation', hint: 'Chain API calls from Excel' }
  };

  var CORE = ['config', 'core/secrets', 'core/util', 'core/layout', 'core/styles', 'core/excel', 'core/api', 'core/endpoints', 'core/audit', 'core/ui', 'core/engine', 'core/shell'];

  var ctx = { repoEndpoints: null, BASE: BASE, DEFAULT_MODULES: MODULES, DEFAULT_AREAS: AREAS, DEFAULT_TOOLS: TOOLS, AREAS: AREAS, TOOLS: TOOLS, modules: {}, repoLayout: null };
  window.__BFT__ = ctx; // for debugging in the console

  function fetchCode(path) {
    return fetch(BASE + path + '.js?t=' + Date.now()).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status + ' loading ' + path + '.js');
      return r.text();
    });
  }

  function run(path, code) {
    try {
      new Function('ctx', code)(ctx);
    } catch (e) {
      e.message = path + '.js: ' + e.message;
      throw e;
    }
  }

  // Modules: file body calls ctx.defineTool(id, { render(view, api) { ... } })
  ctx.loadTool = function (id) {
    if (ctx.modules[id]) return Promise.resolve(ctx.modules[id]);
    return fetchCode('modules/' + id).then(function (code) {
      run('modules/' + id, code);
      if (!ctx.modules[id]) throw new Error('modules/' + id + '.js did not call ctx.defineTool("' + id + '", …)');
      return ctx.modules[id];
    });
  };
  ctx.defineTool = function (id, def) { ctx.modules[id] = def; };

  // Optional team files in the repo (missing or broken = built-in defaults).
  function fetchJson(name) {
    return fetch(BASE + name + '?t=' + Date.now()).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; });
  }

  // Fetch all core files (and the team layout) in parallel, run them in order.
  Promise.all([fetchJson('layout.json'), fetchJson('endpoints.json')].concat(CORE.map(fetchCode))).then(function (all) {
    ctx.repoLayout = all[0];
    ctx.repoEndpoints = all[1];
    var codes = all.slice(2);
    codes.forEach(function (code, i) { run(CORE[i], code); });
    ctx.Shell.start();
  }).catch(function (e) {
    console.error('[APIary]', e);
    alert('APIary failed to start: ' + e.message);
  });
})();
