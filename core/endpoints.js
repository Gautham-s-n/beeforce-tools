/* core/endpoints.js — the endpoint registry. Every Beeforce call a tool makes is listed here once.
 *
 *   ctx.EP.call('paycodes.update', { id: 12 }, { body: p, module: MOD })
 *     → Api.call('PUT', '/api/attendance/paycodes/12', …)
 *
 * Layers (later wins, method + path only): built-in DEFAULTS below → endpoints.json in the repo (team)
 * → this browser (localStorage 'bft.endpoints'). Query parameters stay in code (DEFAULTS[key].query),
 * because they are part of how each tool reads data, not where the API lives.
 *
 * Entry: { tool, label, method, path, query?, required? }
 *   path placeholders: {id}, {name}… filled from params (URL-encoded); a missing param is an error.
 *   Trailing slashes are deliberate — some Beeforce routes need them, some must not have them. Keep them exact.
 *   required: false  → optional/fallback call; the Postman importer does not flag it red when missing.
 */
'use strict';

var LKEY = 'bft.endpoints';
var METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

/* ---- built-in defaults (grouped by tool, same order as the honeycomb) ---- */
var DEFAULTS = {
  // ==== Attendance ====
  'timecard-update.paycodes':  { tool: 'timecard-update', label: 'List paycodes (reference)', method: 'GET', path: '/api/attendance/paycodes', required: false },
  'timecard-update.timecards': { tool: 'timecard-update', label: 'Get an employee\'s timecard for a date', method: 'GET', path: '/api/attendance/timecards' },
  'timecard-update.update':    { tool: 'timecard-update', label: 'Update timecard paycodes', method: 'POST', path: '/api/attendance/timecards' },
  'punch.add':                 { tool: 'punch', label: 'Add a punch', method: 'POST', path: '/api/attendance/punches/action/' },
  'punch.employees':           { tool: 'punch', label: 'Find employee by number (review check)', method: 'GET', path: '/api/attendance/employees/', required: false },
  'ot-approval.employees':     { tool: 'ot-approval', label: 'Find employee by number', method: 'GET', path: '/api/attendance/employees/' },
  'ot-approval.add':           { tool: 'ot-approval', label: 'Raise overtime requests', method: 'POST', path: '/api/attendance/overtime_requests/action' },
  'workflow-transfer.transfer':  { tool: 'workflow-transfer', label: 'Transfer employee to a new manager', method: 'POST', path: '/api/attendance/workflow/employee_transfer' },
  'workflow-transfer.employees': { tool: 'workflow-transfer', label: 'Find employee by number (review check)', method: 'GET', path: '/api/attendance/employees/', required: false },
  'tasks.list':                { tool: 'tasks', label: 'List my pending tasks', method: 'GET', path: '/api/attendance/workflow/tasks/mine', query: { 'active.equals': 'true', onlyList: 'true' } },
  'tasks.approve':             { tool: 'tasks', label: 'Approve a task', method: 'POST', path: '/api/attendance/workflow/tasks/mine/{id}' },
  // ==== Pay rules ====
  'paycodes.list':             { tool: 'paycodes', label: 'List paycodes', method: 'GET', path: '/api/attendance/paycodes', query: { projection: 'FULL' } },
  'paycodes.attributes':       { tool: 'paycodes', label: 'List paycode attributes', method: 'GET', path: '/api/attendance/paycode_attributes' },
  'paycodes.create':           { tool: 'paycodes', label: 'Create a paycode', method: 'POST', path: '/api/attendance/paycodes' },
  'paycodes.update':           { tool: 'paycodes', label: 'Update a paycode', method: 'PUT', path: '/api/attendance/paycodes/{id}' },
  'paycodes.remove':           { tool: 'paycodes', label: 'Delete a paycode', method: 'DELETE', path: '/api/attendance/paycodes/{id}' },
  'paycode-events.list':       { tool: 'paycode-events', label: 'List paycode events', method: 'GET', path: '/api/attendance/paycode_events' },
  'paycode-events.paycodes':   { tool: 'paycode-events', label: 'List paycodes (reference)', method: 'GET', path: '/api/attendance/paycodes', required: false },
  'paycode-events.create':     { tool: 'paycode-events', label: 'Create a paycode event', method: 'POST', path: '/api/attendance/paycode_events' },
  'paycode-events.update':     { tool: 'paycode-events', label: 'Update a paycode event', method: 'PUT', path: '/api/attendance/paycode_events/{id}' },
  'paycode-events.remove':     { tool: 'paycode-events', label: 'Delete a paycode event', method: 'DELETE', path: '/api/attendance/paycode_events/{id}' },
  'paycode-event-sets.list':   { tool: 'paycode-event-sets', label: 'List paycode event sets', method: 'GET', path: '/api/attendance/paycode_event_sets/', query: { projection: 'FULL' } },
  'paycode-event-sets.events': { tool: 'paycode-event-sets', label: 'List paycode events (reference)', method: 'GET', path: '/api/attendance/paycode_events', required: false },
  'paycode-event-sets.create': { tool: 'paycode-event-sets', label: 'Create a paycode event set', method: 'POST', path: '/api/attendance/paycode_event_sets/' },
  'paycode-event-sets.update': { tool: 'paycode-event-sets', label: 'Update a paycode event set', method: 'PUT', path: '/api/attendance/paycode_event_sets/{id}' },
  'paycode-event-sets.remove': { tool: 'paycode-event-sets', label: 'Delete a paycode event set', method: 'DELETE', path: '/api/attendance/paycode_event_sets/{id}' },
  'paycode-combinations.list':     { tool: 'paycode-combinations', label: 'List paycode combinations', method: 'GET', path: '/api/attendance/paycode_combinations' },
  'paycode-combinations.paycodes': { tool: 'paycode-combinations', label: 'List paycodes (reference)', method: 'GET', path: '/api/attendance/paycodes', required: false },
  'paycode-combinations.create':   { tool: 'paycode-combinations', label: 'Create a paycode combination', method: 'POST', path: '/api/attendance/paycode_combinations' },
  'paycode-combinations.update':   { tool: 'paycode-combinations', label: 'Update a paycode combination', method: 'PUT', path: '/api/attendance/paycode_combinations/{id}' },
  'paycode-combinations.remove':   { tool: 'paycode-combinations', label: 'Delete a paycode combination', method: 'DELETE', path: '/api/attendance/paycode_combinations/{id}' },
  // ==== Shifts ====
  'shift-templates.list':          { tool: 'shift-templates', label: 'List shift templates', method: 'GET', path: '/api/attendance/shift_templates', query: { projection: 'FULL' } },
  'shift-templates.listForUpdate': { tool: 'shift-templates', label: 'List shift templates (update download)', method: 'GET', path: '/api/attendance/shift_templates/', query: { projection: 'FULL' } },
  'shift-templates.paycodes':      { tool: 'shift-templates', label: 'List paycodes (reference)', method: 'GET', path: '/api/attendance/paycodes', required: false },
  'shift-templates.create':        { tool: 'shift-templates', label: 'Create a shift template', method: 'POST', path: '/api/attendance/shift_templates' },
  'shift-templates.update':        { tool: 'shift-templates', label: 'Update a shift template', method: 'PUT', path: '/api/attendance/shift_templates/{id}' },
  'shift-templates.remove':        { tool: 'shift-templates', label: 'Delete a shift template', method: 'DELETE', path: '/api/attendance/shift_templates/{id}' },
  'shift-template-sets.list':      { tool: 'shift-template-sets', label: 'List shift template sets', method: 'GET', path: '/api/attendance/shift_template_sets', query: { projection: 'FULL' } },
  'shift-template-sets.templates': { tool: 'shift-template-sets', label: 'List shift templates (reference)', method: 'GET', path: '/api/attendance/shift_templates', required: false },
  'shift-template-sets.create':    { tool: 'shift-template-sets', label: 'Create a shift template set', method: 'POST', path: '/api/attendance/shift_template_sets/' },
  'shift-template-sets.update':    { tool: 'shift-template-sets', label: 'Update a shift template set', method: 'PUT', path: '/api/attendance/shift_template_sets/{id}/' },
  'shift-template-sets.remove':    { tool: 'shift-template-sets', label: 'Delete a shift template set', method: 'DELETE', path: '/api/attendance/shift_template_sets/{id}' },
  'schedule-patterns.list':        { tool: 'schedule-patterns', label: 'List schedule patterns', method: 'GET', path: '/api/attendance/schedule_patterns/', query: { projection: 'FULL' } },
  'schedule-patterns.templates':   { tool: 'schedule-patterns', label: 'List shift templates (reference)', method: 'GET', path: '/api/attendance/shift_templates' },
  'schedule-patterns.paycodes':    { tool: 'schedule-patterns', label: 'List paycodes (reference)', method: 'GET', path: '/api/attendance/paycodes' },
  'schedule-patterns.create':      { tool: 'schedule-patterns', label: 'Create a schedule pattern', method: 'POST', path: '/api/attendance/schedule_patterns/' },
  'schedule-patterns.update':      { tool: 'schedule-patterns', label: 'Update a schedule pattern', method: 'PUT', path: '/api/attendance/schedule_patterns/{id}/' },
  'schedule-patterns.remove':      { tool: 'schedule-patterns', label: 'Delete a schedule pattern', method: 'DELETE', path: '/api/attendance/schedule_patterns/{id}' },
  // ==== Accruals ====
  'accrual.list':                  { tool: 'accrual', label: 'List accruals', method: 'GET', path: '/api/attendance/accruals/' },
  'accrual.create':                { tool: 'accrual', label: 'Create an accrual', method: 'POST', path: '/api/attendance/accruals/' },
  'accrual.update':                { tool: 'accrual', label: 'Update an accrual', method: 'PUT', path: '/api/attendance/accruals/{id}' },
  'accrual.remove':                { tool: 'accrual', label: 'Delete an accrual', method: 'DELETE', path: '/api/attendance/accruals/{id}' },
  'accrual-policies.list':         { tool: 'accrual-policies', label: 'List accrual policies', method: 'GET', path: '/api/attendance/accrual_policies', query: { projection: 'FULL' } },
  'accrual-policies.list-fallback': { tool: 'accrual-policies', label: 'List accrual policies (fallback without projection)', method: 'GET', path: '/api/attendance/accrual_policies/', required: false },
  'accrual-policies.get':          { tool: 'accrual-policies', label: 'Get one accrual policy with its child lists', method: 'GET', path: '/api/attendance/accrual_policies/{id}', query: { attributes: 'paycodes,grantPaycodes,cascades' } },
  'accrual-policies.paycodes':     { tool: 'accrual-policies', label: 'List paycodes (reference)', method: 'GET', path: '/api/attendance/paycodes', required: false },
  'accrual-policies.accruals':     { tool: 'accrual-policies', label: 'List accruals (reference)', method: 'GET', path: '/api/attendance/accruals', required: false },
  'accrual-policies.create':       { tool: 'accrual-policies', label: 'Create an accrual policy', method: 'POST', path: '/api/attendance/accrual_policies/' },
  'accrual-policies.update':       { tool: 'accrual-policies', label: 'Update an accrual policy', method: 'PUT', path: '/api/attendance/accrual_policies/{id}', query: { attributes: 'paycodes,grantPaycodes,cascades' } },
  'accrual-policies.remove':       { tool: 'accrual-policies', label: 'Delete an accrual policy', method: 'DELETE', path: '/api/attendance/accrual_policies/{id}' },
  'accrual-policy-sets.list':      { tool: 'accrual-policy-sets', label: 'List accrual policy sets', method: 'GET', path: '/api/attendance/accrual_policy_sets/', query: { projection: 'FULL' } },
  'accrual-policy-sets.policies':  { tool: 'accrual-policy-sets', label: 'List accrual policies (reference)', method: 'GET', path: '/api/attendance/accrual_policies', required: false },
  'accrual-policy-sets.create':    { tool: 'accrual-policy-sets', label: 'Create an accrual policy set', method: 'POST', path: '/api/attendance/accrual_policy_sets' },
  'accrual-policy-sets.update':    { tool: 'accrual-policy-sets', label: 'Update an accrual policy set', method: 'PUT', path: '/api/attendance/accrual_policy_sets/{id}' },
  'accrual-policy-sets.remove':    { tool: 'accrual-policy-sets', label: 'Delete an accrual policy set', method: 'DELETE', path: '/api/attendance/accrual_policy_sets/{id}' },
  'accrual-balances.employees':    { tool: 'accrual-balances', label: 'List employees (paged)', method: 'GET', path: '/api/attendance/employees/' },
  'accrual-balances.accruals':     { tool: 'accrual-balances', label: 'List accruals (reference)', method: 'GET', path: '/api/attendance/accruals/', required: false },
  'accrual-balances.balances':     { tool: 'accrual-balances', label: 'Get an employee\'s accrual balances on a date', method: 'GET', path: '/api/attendance/accruals/balances_v2' },
  // ==== Time off ====
  'timeoff-policy-sets.list':      { tool: 'timeoff-policy-sets', label: 'List time off policy sets', method: 'GET', path: '/api/attendance/time_off_policy_sets', query: { projection: 'FULL' } },
  'timeoff-policy-sets.policies':  { tool: 'timeoff-policy-sets', label: 'List time off policies (reference)', method: 'GET', path: '/api/attendance/time_off_policies', required: false },
  'timeoff-policy-sets.create':    { tool: 'timeoff-policy-sets', label: 'Create a time off policy set', method: 'POST', path: '/api/attendance/time_off_policy_sets' },
  'timeoff-policy-sets.update':    { tool: 'timeoff-policy-sets', label: 'Update a time off policy set', method: 'PUT', path: '/api/attendance/time_off_policy_sets/{id}/' },
  'timeoff-policy-sets.remove':    { tool: 'timeoff-policy-sets', label: 'Delete a time off policy set', method: 'DELETE', path: '/api/attendance/time_off_policy_sets/{id}' },
  'timeoff-policy-config.list':    { tool: 'timeoff-policy-config', label: 'List time off policies', method: 'GET', path: '/api/attendance/time_off_policies/', query: { projection: 'FULL' } },
  'timeoff-policy-config.paycodes': { tool: 'timeoff-policy-config', label: 'List paycodes (reference)', method: 'GET', path: '/api/attendance/paycodes', required: false },
  'timeoff-policy-config.create':  { tool: 'timeoff-policy-config', label: 'Create a time off policy', method: 'POST', path: '/api/attendance/time_off_policies/' },
  'timeoff-policy-config.update':  { tool: 'timeoff-policy-config', label: 'Update a time off policy', method: 'PUT', path: '/api/attendance/time_off_policies/{id}' },
  'timeoff-policy-config.remove':  { tool: 'timeoff-policy-config', label: 'Delete a time off policy', method: 'DELETE', path: '/api/attendance/time_off_policies/{id}' },
  'timeoff-raise.raise':           { tool: 'timeoff-raise', label: 'Raise a time off request', method: 'POST', path: '/api/attendance/chatbot/timeoff_processes/' },
  'timeoff-raise.paycodes':        { tool: 'timeoff-raise', label: 'List paycodes (reference)', method: 'GET', path: '/api/attendance/paycodes', required: false },
  'timeoff-raise.employees':       { tool: 'timeoff-raise', label: 'List / find employees (reference and review check)', method: 'GET', path: '/api/attendance/employees/', required: false },
  // ==== Policies ====
  'outpass-policies.list':         { tool: 'outpass-policies', label: 'List outpass policies', method: 'GET', path: '/api/attendance/outpass_policies/', query: { attributes: 'attendanceAdjustmentType' } },
  'outpass-policies.types':        { tool: 'outpass-policies', label: 'List attendance adjustment types (reference)', method: 'GET', path: '/api/attendance/attendance_adjustment_types/', required: false },
  'outpass-policies.create':       { tool: 'outpass-policies', label: 'Create an outpass policy', method: 'POST', path: '/api/attendance/outpass_policies/' },
  'outpass-policies.update':       { tool: 'outpass-policies', label: 'Update an outpass policy', method: 'PUT', path: '/api/attendance/outpass_policies/{id}' },
  'outpass-policies.remove':       { tool: 'outpass-policies', label: 'Delete an outpass policy', method: 'DELETE', path: '/api/attendance/outpass_policies/{id}' },
  'outpass-policy-sets.list':      { tool: 'outpass-policy-sets', label: 'List outpass policy sets', method: 'GET', path: '/api/attendance/outpass_policy_sets/', query: { projection: 'FULL' } },
  'outpass-policy-sets.types':     { tool: 'outpass-policy-sets', label: 'List attendance adjustment types (reference)', method: 'GET', path: '/api/attendance/attendance_adjustment_types/', required: false },
  'outpass-policy-sets.policies':  { tool: 'outpass-policy-sets', label: 'List outpass policies (reference and id check)', method: 'GET', path: '/api/attendance/outpass_policies/', query: { attributes: 'attendanceAdjustmentType' }, required: false },
  'outpass-policy-sets.create':    { tool: 'outpass-policy-sets', label: 'Create an outpass policy set', method: 'POST', path: '/api/attendance/outpass_policy_sets/' },
  'outpass-policy-sets.update':    { tool: 'outpass-policy-sets', label: 'Update an outpass policy set', method: 'PUT', path: '/api/attendance/outpass_policy_sets/{id}/' },
  'outpass-policy-sets.remove':    { tool: 'outpass-policy-sets', label: 'Delete an outpass policy set', method: 'DELETE', path: '/api/attendance/outpass_policy_sets/{id}/' },
  // ==== People & access ====
  'employee-bulk-create.org-levels':       { tool: 'employee-bulk-create', label: 'List org levels', method: 'GET', path: '/api/data-management/api/employees/org-levels' },
  'employee-bulk-create.org-level-entries-next': { tool: 'employee-bulk-create', label: 'List entries of one org level', method: 'POST', path: '/api/data-management/api/employees/org-level-entries-next' },
  'employee-bulk-create.locations':        { tool: 'employee-bulk-create', label: 'List locations', method: 'GET', path: '/api/data-management/api/employees/locations' },
  'employee-bulk-create.dropdown-values':  { tool: 'employee-bulk-create', label: 'List dropdown values', method: 'GET', path: '/api/data-management/api/employees/dropdown-values' },
  'employee-bulk-create.create':           { tool: 'employee-bulk-create', label: 'Create an employee', method: 'POST', path: '/api/data-management/api/employees/create' },
  'roles.tenants':                         { tool: 'roles', label: 'List tenants', method: 'GET', path: '/api/data-management/api/master/getAll' },
  'roles.positions':                       { tool: 'roles', label: 'List positions (also the connect check)', method: 'GET', path: '/api/data-management/api/organization-masters/position' },
  'roles.position':                        { tool: 'roles', label: 'Get one position', method: 'GET', path: '/api/data-management/api/organization-masters/position/{id}' },
  'roles.roles':                           { tool: 'roles', label: 'List roles (reference)', method: 'GET', path: '/api/data-management/api/organization-masters/position/roles', required: false },
  'roles.save':                            { tool: 'roles', label: 'Create or update a position', method: 'POST', path: '/api/data-management/api/organization-masters/position' },
  'employee-lookup.tables':                { tool: 'employee-lookup', label: 'List employee lookup tables', method: 'GET', path: '/api/attendance/employee_lookup_table/' },
  'employee-lookup.table':                 { tool: 'employee-lookup', label: 'Get one employee lookup table', method: 'GET', path: '/api/attendance/employee_lookup_table/{id}' },
  'employee-lookup.save':                  { tool: 'employee-lookup', label: 'Save an employee lookup table', method: 'PUT', path: '/api/attendance/entity_lookup_tables/{id}' },
  'employee-lookup.ref-outpass-policy-sets': { tool: 'employee-lookup', label: 'List outpass policy sets (reference)', method: 'GET', path: '/api/attendance/outpass_policy_sets/', required: false },
  'employee-lookup.ref-timeoff-policy-sets': { tool: 'employee-lookup', label: 'List time off policy sets (reference)', method: 'GET', path: '/api/attendance/time_off_policy_sets/', required: false },
  'employee-lookup.ref-accrual-policy-sets': { tool: 'employee-lookup', label: 'List accrual policy sets (reference)', method: 'GET', path: '/api/attendance/accrual_policy_sets/', required: false },
  'employee-lookup.ref-regularization-policy-sets': { tool: 'employee-lookup', label: 'List regularization policy sets (reference)', method: 'GET', path: '/api/attendance/regularization_policy_sets/', required: false },
  'employee-lookup.ref-overtime-policies': { tool: 'employee-lookup', label: 'List overtime policies (reference)', method: 'GET', path: '/api/attendance/overtime_policies/', required: false },
  'employee-lookup.ref-shift-template-sets': { tool: 'employee-lookup', label: 'List shift template sets (reference)', method: 'GET', path: '/api/attendance/shift_template_sets/', required: false },
  'employee-lookup.ref-schedule-pattern-sets': { tool: 'employee-lookup', label: 'List schedule pattern sets (reference)', method: 'GET', path: '/api/attendance/schedule_pattern_sets/', required: false },
  'employee-lookup.ref-schedule-patterns': { tool: 'employee-lookup', label: 'List schedule patterns (reference)', method: 'GET', path: '/api/attendance/schedule_patterns/', required: false },
  'employee-lookup.ref-paycode-event-sets': { tool: 'employee-lookup', label: 'List paycode event sets (reference)', method: 'GET', path: '/api/attendance/paycode_event_sets/', required: false },
  'employee-lookup.ref-known-locations':   { tool: 'employee-lookup', label: 'List known locations (reference)', method: 'GET', path: '/api/attendance/known_locations/', required: false },
  'org-lookup.tables':                     { tool: 'org-lookup', label: 'List organization location lookup tables', method: 'GET', path: '/api/attendance/organization_location_lookup_table/' },
  'org-lookup.table':                      { tool: 'org-lookup', label: 'Get one organization location lookup table', method: 'GET', path: '/api/attendance/organization_location_lookup_table/{id}' },
  'org-lookup.save':                       { tool: 'org-lookup', label: 'Save an organization location lookup table', method: 'PUT', path: '/api/attendance/entity_lookup_tables/{id}' },
  'org-lookup.ref-outpass-policy-sets':    { tool: 'org-lookup', label: 'List outpass policy sets (reference)', method: 'GET', path: '/api/attendance/outpass_policy_sets/', required: false },
  'org-lookup.ref-timeoff-policy-sets':    { tool: 'org-lookup', label: 'List time off policy sets (reference)', method: 'GET', path: '/api/attendance/time_off_policy_sets/', required: false },
  'org-lookup.ref-accrual-policy-sets':    { tool: 'org-lookup', label: 'List accrual policy sets (reference)', method: 'GET', path: '/api/attendance/accrual_policy_sets/', required: false },
  'org-lookup.ref-regularization-policy-sets': { tool: 'org-lookup', label: 'List regularization policy sets (reference)', method: 'GET', path: '/api/attendance/regularization_policy_sets/', required: false },
  'org-lookup.ref-overtime-policies':      { tool: 'org-lookup', label: 'List overtime policies (reference)', method: 'GET', path: '/api/attendance/overtime_policies/', required: false },
  'org-lookup.ref-shift-template-sets':    { tool: 'org-lookup', label: 'List shift template sets (reference)', method: 'GET', path: '/api/attendance/shift_template_sets/', required: false },
  'org-lookup.ref-schedule-pattern-sets':  { tool: 'org-lookup', label: 'List schedule pattern sets (reference)', method: 'GET', path: '/api/attendance/schedule_pattern_sets/', required: false },
  'org-lookup.ref-schedule-patterns':      { tool: 'org-lookup', label: 'List schedule patterns (reference)', method: 'GET', path: '/api/attendance/schedule_patterns/', required: false },
  'org-lookup.ref-paycode-event-sets':     { tool: 'org-lookup', label: 'List paycode event sets (reference)', method: 'GET', path: '/api/attendance/paycode_event_sets/', required: false },
  'org-lookup.ref-known-locations':        { tool: 'org-lookup', label: 'List known locations (reference)', method: 'GET', path: '/api/attendance/known_locations/', required: false },
  // ==== end ====
};

function readLocal() { try { return JSON.parse(localStorage.getItem(LKEY) || 'null'); } catch (e) { return null; } }
function overridesOf(o) { return o && typeof o === 'object' && o.endpoints && typeof o.endpoints === 'object' ? o.endpoints : {}; }

/* Problems with one method/path pair (empty list = fine). */
function check(method, path, def) {
  var errs = [];
  if (METHODS.indexOf(String(method || '').toUpperCase()) < 0) errs.push('Method must be one of ' + METHODS.join(', '));
  path = String(path || '');
  if (!/^\/api\//.test(path)) errs.push('Path must start with /api/');
  if (/^https?:|\/\/|\s|[?#]/.test(path)) errs.push('Path only — no host, spaces, ? or #');
  if (/\{\{|\}\}|:[a-z]/i.test(path)) errs.push('Use {id} style placeholders, not {{var}} or :id');
  var want = (def && def.path.match(/\{[a-zA-Z]+\}/g) || []).sort().join();
  var got = (path.match(/\{[a-zA-Z]+\}/g) || []).sort().join();
  if (def && want !== got) errs.push('Placeholders must be exactly: ' + (want || 'none') + (got ? ' (found ' + got + ')' : ''));
  return errs;
}

function layer(o, key) { var e = overridesOf(o)[key]; return e && e.method && e.path && !check(e.method, e.path, DEFAULTS[key]).length ? e : null; }

function get(key) {
  var d = DEFAULTS[key];
  if (!d) throw new Error('Unknown endpoint "' + key + '" (add it to core/endpoints.js)');
  var e = Object.assign({}, d);
  var r = layer(ctx.repoEndpoints, key), l = layer(readLocal(), key);
  if (r) { e.method = r.method.toUpperCase(); e.path = r.path; e.source = 'team'; }
  if (l) { e.method = l.method.toUpperCase(); e.path = l.path; e.source = 'browser'; }
  if (!e.source) e.source = 'built-in';
  e.key = key;
  return e;
}

function fill(path, params, key) {
  return path.replace(/\{([a-zA-Z]+)\}/g, function (m, k) {
    var v = params && params[k];
    if (v == null || v === '') throw new Error('Endpoint ' + key + ' needs “' + k + '”');
    return encodeURIComponent(String(v));
  });
}

ctx.EP = {
  KEY: LKEY, METHODS: METHODS, DEFAULTS: DEFAULTS, check: check,
  get: get,
  method: function (key) { return get(key).method; },
  path: function (key, params) { var e = get(key); return fill(e.path, params, key); },
  /* Api.call with the registry's method + path; opts.query is merged over the default query. */
  call: function (key, params, opts) {
    var e = get(key);
    opts = Object.assign({}, opts || {});
    if (e.query) opts.query = Object.assign({}, e.query, opts.query || {});
    return ctx.Api.call(e.method, fill(e.path, params, key), opts);
  },
  list: function (key, params, opts) {
    var e = get(key);
    opts = Object.assign({}, opts || {});
    if (e.query) opts.query = Object.assign({}, e.query, opts.query || {});
    if (e.method !== 'GET') throw new Error(key + ' is not a GET endpoint');
    return ctx.Api.list(fill(e.path, params, key), opts);
  },
  listQuiet: function (key, params, opts) { return this.list(key, params, opts).catch(function () { return []; }); },
  /* Full URL for display / cURL (no request is made). */
  url: function (key, params, query) {
    var e = get(key), q = Object.assign({}, e.query || {}, query || {});
    var qs = Object.keys(q).filter(function (k) { return q[k] != null && q[k] !== ''; }).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(q[k]); }).join('&');
    var path = e.path.replace(/\{([a-zA-Z]+)\}/g, function (m, k) { var v = params && params[k]; return v == null || v === '' ? m : encodeURIComponent(String(v)); });
    return (ctx.Api.state.base || 'https://app.beeforce.in') + path + (qs ? '?' + qs : '');
  },
  /* cURL text. The token is a placeholder unless withToken is true (that makes the text a live key). */
  curl: function (key, params, o) {
    o = o || {};
    var e = get(key), sq = function (v) { return "'" + String(v).replace(/'/g, "'\\''") + "'"; };
    var tok = o.withToken && ctx.Api.state.token ? ctx.Api.state.token : '$BEEFORCE_TOKEN';
    var lines = ['curl -X ' + e.method + ' ' + sq(this.url(key, params, o.query)),
      '  -H ' + (o.withToken && ctx.Api.state.token ? sq('Authorization: Bearer ' + tok) : '"Authorization: Bearer $BEEFORCE_TOKEN"'), '  -H ' + sq('Accept: application/json'), '  -H ' + sq('X-Client-Type: Web')];
    if (e.method !== 'GET' && e.method !== 'DELETE') { lines.push('  -H ' + sq('Content-Type: application/json')); lines.push('  --data ' + sq(o.body ? JSON.stringify(o.body, null, 2) : '{}')); }
    return lines.join(' \\\n');
  },
  /* Postman collection v2.1 for a list of entries (default: all), grouped by tool. */
  postman: function (entries, name) {
    entries = entries || this.all();
    var byTool = {};
    entries.forEach(function (e) { (byTool[e.tool] = byTool[e.tool] || []).push(e); });
    return {
      info: { name: name || 'APIary endpoints', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
      variable: [{ key: 'baseUrl', value: ctx.Api.state.base || 'https://app.beeforce.in' }, { key: 'token', value: '' }],
      auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
      item: Object.keys(byTool).map(function (t) {
        return { name: (ctx.DEFAULT_TOOLS[t] || {}).name || t, item: byTool[t].map(function (e) {
          var p = e.path.replace(/\{([a-zA-Z]+)\}/g, ':$1');
          var q = e.query ? '?' + Object.keys(e.query).map(function (k) { return k + '=' + e.query[k]; }).join('&') : '';
          return { name: e.label || e.key, request: { method: e.method, header: [{ key: 'X-Client-Type', value: 'Web' }], url: { raw: '{{baseUrl}}' + p + q, host: ['{{baseUrl}}'], path: p.replace(/^\//, '').split('/') } } };
        }) };
      })
    };
  },
  keys: function () { return Object.keys(DEFAULTS); },
  all: function () { return Object.keys(DEFAULTS).map(get); },
  local: readLocal,
  /* overrides: { key: { method, path } } — only entries that differ from team/built-in are kept. */
  saveLocal: function (map) {
    var out = {};
    Object.keys(map || {}).forEach(function (k) {
      if (!DEFAULTS[k]) return;
      var m = String(map[k].method).toUpperCase(), p = String(map[k].path).trim();
      if (check(m, p, DEFAULTS[k]).length) return;
      var base = Object.assign({}, DEFAULTS[k]), r = layer(ctx.repoEndpoints, k);
      if (r) { base.method = r.method.toUpperCase(); base.path = r.path; }
      if (base.method !== m || base.path !== p) out[k] = { method: m, path: p };
    });
    try {
      if (Object.keys(out).length) localStorage.setItem(LKEY, JSON.stringify({ version: 1, endpoints: out }));
      else localStorage.removeItem(LKEY);
    } catch (e) { throw new Error('This browser blocked saving: ' + e.message); }
    return Object.keys(out).length;
  },
  clearLocal: function () { try { localStorage.removeItem(LKEY); } catch (e) {} },
  /* endpoints.json for the team: every entry that differs from the built-in defaults. */
  exportRepo: function (map) {
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      var cur = map && map[k] ? map[k] : get(k);
      var m = String(cur.method).toUpperCase(), p = String(cur.path);
      if (m !== DEFAULTS[k].method || p !== DEFAULTS[k].path) out[k] = { method: m, path: p };
    });
    return { version: 1, endpoints: out };
  }
};
