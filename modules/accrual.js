/* modules/accrual.js — Accrual (leave balance types): create, update, export, delete.
 * Endpoints (core/endpoints.js):
 * accrual.list    list (old View Existing: no projection param)
 * accrual.create  create { name, description }        (trailing slash, as old)
 * accrual.update  update { name, description, id }
 * accrual.remove  delete */
'use strict';
var X = ctx.X, Api = ctx.Api, E = ctx.Engine;
var MOD = 'Accrual';

ctx.defineTool('accrual', {
  desc: 'Create and update accruals (leave balance types) from Excel, export them for editing, or delete the ones you no longer need.',
  render: function (view) {
    E.entity(view, {
      module: MOD, noun: 'accrual',
      list: function () { return ctx.EP.list('accrual.list', null, { module: MOD }); },
      // Old template: id | name | description, "name" highlighted.
      headers: ['id', 'name', 'description'], inputCols: [1],
      flatten: function (a) { return { id: a.id, name: a.name || '', description: a.description || '' }; },
      // Old payload: { name, description } (+ id on update, added by the engine). Description is sent as typed, even blank.
      build: function (row) { return { name: X.str(row.name), description: X.str(row.description) }; },
      validate: function (row, p) { return p.name ? null : '“name” is required'; },
      labelOf: function (r) { return [X.str(r.name), X.str(r.description)].filter(Boolean).join(' — '); },
      create: function (p) { return ctx.EP.call('accrual.create', null, { body: p, module: MOD }); },
      update: function (id, p) { return ctx.EP.call('accrual.update', { id: id }, { body: p, module: MOD }); },
      remove: function (id) { return ctx.EP.call('accrual.remove', { id: id }, { module: MOD }); },
      browse: [{ key: 'name', label: 'Name' }, { key: 'description', label: 'Description' }],
      intro: 'Leave the id blank to create a new accrual. Fill the id to update an existing one. “name” is required. Tip: use “Export for editing” in Browse to get current data in this format.'
    });
  }
});
