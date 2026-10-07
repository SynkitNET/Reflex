'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const UI = require('../ui'), core = require('../core'), catalog = require('../catalog');

test('Missing ping is searchable, assignable and runs without a Photoshop operation or document', async () => {
  let pings = 0;
  const item = catalog.find(item => item.id === 'reflex.missing-ping');
  const host = { snapshot: async () => ({ context: {}, items: [] }), run: async () => { throw new Error('Must not run a Photoshop command'); } };
  const controller = UI.createController({ core, catalog, host, storage: { save: async () => {} }, state: core.defaults(), showMissingPing: async () => { pings++; } });
  await controller.refresh();
  for (const query of ['missing ping', 'enemy missing', 'league', 'question mark', 'ping spam']) assert.ok(core.search(core.prepare(catalog), query).some(result => result.id === item.id), query);
  assert.equal(item.kind, 'command');
  assert.equal(core.unavailable(item, {}), '');
  const saved = core.defaults(); saved.wheels[0].slots[0] = item.id;
  assert.equal(core.cleanState(saved).wheels[0].slots[0], item.id);
  assert.deepEqual(await controller.execute(item.id), { ok: true });
  assert.equal(pings, 1);
  assert.equal(controller.getState().usage[item.id].count, 1);
});

test('Missing ping reports an unavailable native overlay without recording successful usage', async () => {
  const controller = UI.createController({ core, catalog, host: { snapshot: async () => ({ context: {}, items: [] }) }, storage: { save: async () => {} }, state: core.defaults() });
  assert.equal((await controller.execute('reflex.missing-ping')).ok, false);
  assert.equal(controller.getState().usage['reflex.missing-ping'], undefined);
});

test('a completed command returns before a slow layer/action refresh', async () => {
  let snapshotCalls = 0, releaseRefresh;
  const updated = { context: { documentId: 1, documentName: 'Test.psd', layerCount: 1 }, items: [] };
  const delayed = new Promise(resolve => { releaseRefresh = () => resolve(updated); });
  const host = { snapshot: () => ++snapshotCalls === 1 ? Promise.resolve(updated) : delayed, run: async () => {} };
  const controller = UI.createController({ core, catalog, host, storage: { save: async () => {} }, state: core.defaults() });
  await controller.refresh();
  try {
    const result = await controller.execute('layer.new', 1);
    assert.deepEqual(result, { ok: true });
    assert.equal(snapshotCalls, 1, 'index rebuild has not started in the command/acknowledgement path');
    assert.equal(controller.getBridgeSnapshot().suspended, false);
    await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal(snapshotCalls, 2, 'index rebuild still runs after command completion');
  } finally { releaseRefresh(); }
});
