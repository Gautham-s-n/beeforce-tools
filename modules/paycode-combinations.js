/* modules/paycode-combinations.js — Paycode Combinations: two paycodes on one day give a combined paycode.
 * Endpoints (core/endpoints.js):
 *   paycode-combinations.list       (no projection, as the old tool)
 *   paycode-combinations.paycodes   (reference sheet / names)
 *   paycode-combinations.create / .update {id} / .remove {id} */
'use strict';
var U = ctx.U, h = U.h, UI = ctx.UI, X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Paycode Combinations';
var HEAD = ['id', 'firstPaycode', 'secondPaycode', 'combinedPaycode', 'inactive'];
var PC = ['firstPaycode', 'secondPaycode', 'combinedPaycode'];
var REFS = { list: [], byId: {} }; // last loaded paycodes, for readable labels

function pcName(refs, id) {
  var p = (refs.byId || {})[String(id)];
  return p ? (p.code || p.description || '#' + id) : (id == null || id === '' ? '' : '#' + id);
}

function flatten(c, refs) {
  var o = { id: c.id };
  PC.forEach(function (k) { o[k] = (c[k] || {}).id == null ? '' : c[k].id; });
  o.inactive = c.inactive ? 'TRUE' : 'FALSE';
  // display-only keys for Browse (not part of the upload headers)
  o._first = pcName(refs, o.firstPaycode); o._second = pcName(refs, o.secondPaycode); o._combined = pcName(refs, o.combinedPaycode);
  return o;
}

// Same payload as the old tool: { firstPaycode:{id}, secondPaycode:{id}, combinedPaycode:{id}, inactive }.
// inactive: TRUE / yes / 1 mean true (X.bool, the same words the review diff treats as true); anything else false.
// (The old tool only took "true"; "yes"/"1" were silently sent as false, which the review showed as a change to TRUE.)
function build(row) {
  var p = {};
  PC.forEach(function (k) { p[k] = { id: X.int(row[k]) }; });
  p.inactive = X.bool(row.inactive) === true;
  return p;
}

function validate(row, p, refs) {
  var missing = PC.filter(function (k) { return p[k].id == null; });
  if (missing.length) return 'Fill ' + missing.join(', ');
  var inc = X.str(row.inactive);
  if (inc && X.bool(inc) == null) return 'inactive must be TRUE or FALSE (got "' + inc + '")';
  if (refs.list.length) {
    var unknown = PC.filter(function (k) { return !refs.byId[String(p[k].id)]; }).map(function (k) { return k + ' ' + p[k].id; });
    if (unknown.length) return 'Paycode not found: ' + unknown.join(', ');
  }
  return null;
}

ctx.defineTool('paycode-combinations', {
  desc: 'Say which paycode applies when two paycodes fall on the same day. Create and update from Excel, export, or delete.',
  render: function (view) {
    E.entity(view, {
      module: MOD, noun: 'combination',
      list: function () { return ctx.EP.list('paycode-combinations.list', null, { module: MOD }); },
      create: function (p) { return ctx.EP.call('paycode-combinations.create', null, { body: p, module: MOD }); },
      update: function (id, p) { return ctx.EP.call('paycode-combinations.update', { id: id }, { body: p, module: MOD }); },
      remove: function (id) { return ctx.EP.call('paycode-combinations.remove', { id: id }, { module: MOD }); },
      refs: async function () {
        var list = await ctx.EP.listQuiet('paycode-combinations.paycodes', null, { module: MOD });
        var byId = {}; list.forEach(function (p) { byId[String(p.id)] = p; });
        REFS = { list: list, byId: byId };
        return REFS;
      },
      headers: HEAD, inputCols: [1, 2, 3],
      flatten: flatten, build: build, validate: validate,
      labelOf: function (r) {
        var n = function (k) { return X.str(r[k]) ? pcName(REFS, X.str(r[k])) : '?'; };
        return n('firstPaycode') + ' + ' + n('secondPaycode') + ' → ' + n('combinedPaycode');
      },
      intro: 'Leave the id blank to create a new combination. Fill the id to update one. Paycode columns take paycode ids — see the Available_Paycodes sheet.',
      browse: [{ key: '_first', label: 'First paycode' }, { key: '_second', label: 'Second paycode' }, { key: '_combined', label: 'Combined paycode' }, { key: 'inactive', label: 'Inactive' }],
      refSheets: function (refs) {
        return [{ name: 'Available_Paycodes', tabColor: '059669', headers: ['id', 'code', 'description'], rows: refs.list.map(function (p) { return [p.id, p.code || '', p.description || '']; }) }];
      }
    });
  }
});
