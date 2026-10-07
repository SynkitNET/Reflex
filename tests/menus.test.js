'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const createHost = require('../host'), core = require('../core'), UI = require('../ui');
const { createNativeBridge } = require('../native-bridge');
function fixture() {
  const calls = [];
  const state = { available: true, success: true, tree: { submenu: [
    { title: 'Edit', submenu: [{ title: 'Free Transform', command: 2207, enabled: true }] },
    { title: 'Image', submenu: [{ title: 'Adjustments', submenu: [{ title: 'Curves…', command: 1054 }] }] },
    { title: 'Layer', submenu: [{ title: 'Flatten Image', command: 1059, enabled: false }] },
    { title: 'Plugins', submenu: [
      { title: 'Nexus', submenu: [{ title: 'Open', command: -20 }] },
      { title: 'Reflex', submenu: [{ title: 'Search', command: -21 }] }
    ] }
  ] } };
  let modal = false;
  const doc = { id: 7, title: 'Test', activeLayers: [{ id: 1 }], layers: [] };
  const ps = { app: { activeDocument: doc, documents: [doc], actionTree: [] }, action: {
    async batchPlay(descriptors) {
      assert.equal(descriptors[0]._obj, 'get'); assert.equal(descriptors[0]._target[0]._property, 'menuBarInfo');
      return [{ menuBarInfo: state.tree }];
    }
  }, core: {
    async executeAsModal(fn, options) { calls.push(['modal', options]); modal = true; try { return await fn(); } finally { modal = false; } },
    async getMenuCommandState({ commandID }) { calls.push(['state', commandID]); return state.available; },
    async performMenuCommand({ commandID }) { assert.equal(modal, true); calls.push(['run', commandID]); return state.success; }
  } };
  const host = createHost(ps);
  return { host, ps, state, calls, menus: async () => (await host.snapshot()).items.filter(item => item.kind === 'menu') };
}
test('Photoshop menus include nested commands, disabled assignments and plugin panels, without Reflex recursion', async () => {
  const f = fixture(), items = await f.menus();
  assert.equal(items.length, 4); assert.ok(!items.some(item => item.id.includes('Reflex')));
  const curves = items.find(item => item.title === 'Curves…');
  assert.equal(curves.subtitle, 'Image › Adjustments'); assert.equal(curves.category, 'Menus'); assert.equal(curves.interactive, true);
  assert.equal(core.search(core.prepare(items), 'image adjustments')[0].id, curves.id);
  const disabled = items.find(item => item.title === 'Flatten Image'); assert.equal(disabled.enabledHint, false); assert.equal(core.unavailable(disabled, {}), '');
  const saved = core.defaults(); saved.wheels[0].slots[0] = curves.id;
  assert.equal(core.cleanState(JSON.parse(JSON.stringify(saved))).wheels[0].slots[0], curves.id);
});
test('menu assignments resolve new IDs after a restart and never execute the saved numeric ID', async () => {
  const f = fixture(), original = (await f.menus()).find(item => item.title === 'Open');
  f.state.tree.submenu[3].submenu[0].submenu[0].command = -900;
  await f.host.run(original, 7);
  assert.deepEqual(f.calls.find(call => call[0] === 'run'), ['run', -900]);
  assert.equal(f.calls.find(call => call[0] === 'modal')[1].interactive, true);
});
test('same-name menus stay searchable with distinct identities; old ambiguous assignments cannot run', async () => {
  const f = fixture(), item = (await f.menus())[0];
  f.state.tree.submenu[0].submenu.push({ title: 'Free Transform', command: 9000 });
  const snap = await f.host.snapshot(); assert.equal(snap.warning, '');
  const variants = snap.items.filter(candidate => candidate.title === item.title);
  assert.equal(variants.length, 2); assert.equal(new Set(variants.map(candidate => candidate.id)).size, 2);
  assert.ok(!snap.items.some(candidate => candidate.id === item.id));
  await assert.rejects(f.host.run(item, 7), /no longer available/);
  assert.ok(!f.calls.some(call => call[0] === 'run'));
  for (const variant of variants) await f.host.run(variant, 7);
  assert.deepEqual(f.calls.filter(call => call[0] === 'run').map(call => call[1]), [2207, 9000]);
});
test('disabled or removed menus, changed document and host rejection cannot report success', async () => {
  for (const variant of ['state', 'removed', 'document', 'failure']) {
    const f = fixture(), item = (await f.menus())[0];
    if (variant === 'state') f.state.available = false;
    if (variant === 'removed') f.state.tree.submenu = [];
    if (variant === 'failure') f.state.success = false;
    await assert.rejects(f.host.run(item, variant === 'document' ? 8 : 7));
    assert.equal(f.calls.filter(call => call[0] === 'run').length, variant === 'failure' ? 1 : 0);
    assert.equal(f.host.isModal(), false);
  }
});
test('a failed menu read preserves other Photoshop items and exposes an actionable warning', async () => {
  const f = fixture(); f.ps.action.batchPlay = async () => [{ _obj: 'error', message: 'Menu read failed' }];
  const snap = await f.host.snapshot();
  assert.ok(snap.items.some(item => item.kind === 'document'));
  assert.match(snap.warning, /Photoshop menus could not be read: Menu read failed/);
});
test('menu IDs persist across ordering and live state overrides cached disabled parents', async () => {
  const f = fixture(), before = await f.menus(); f.state.tree.submenu.reverse();
  assert.deepEqual((await f.menus()).map(item => item.id).sort(), before.map(item => item.id).sort());
  f.state.tree.submenu.find(menu => menu.title === 'Image').enabled = false;
  await f.host.run(before.find(item => item.title === 'Curves…'), 7);
  assert.equal(f.calls.filter(call => call[0] === 'run').length, 1);
  f.state.available = false;
  await assert.rejects(f.host.run(before.find(item => item.title === 'Curves…'), 7), /unavailable/);
  assert.equal(f.calls.filter(call => call[0] === 'run').length, 1);
});
test('native wheel retains menu assignments for live availability checks at execution', async () => {
  const f = fixture(), menus = await f.menus(), state = core.defaults();
  state.wheels[0].slots[0] = menus.find(item => item.title === 'Free Transform').id;
  state.wheels[0].slots[1] = menus.find(item => item.title === 'Flatten Image').id;
  const controller = UI.createController({ core, catalog: [], state, host: f.host, storage: { save: async () => {} } });
  await controller.refresh(); let synced;
  const bridge = createNativeBridge({ automatic: false, snapshot: controller.getBridgeSnapshot,
    loadAddon: async () => ({ call(method, payload) {
      if (method === 'health') return { platform: 'win32', protocol: 1 };
      if (method === 'sync') synced = payload;
      return true;
    } }) });
  await bridge.start();
  assert.equal(synced.slots[0].id, state.wheels[0].slots[0]); assert.equal(synced.slots[1].id, state.wheels[0].slots[1]);
  bridge.stop();
});

test('repeated host records collapse into one searchable command without an omission warning', async () => {
  const f = fixture(); f.state.tree.submenu[0].submenu.push({ title: 'Free Transform', command: 2207, enabled: false });
  const snap = await f.host.snapshot(); assert.equal(snap.warning, '');
  const items = snap.items.filter(item => item.title === 'Free Transform'); assert.equal(items.length, 1);
  await f.host.run(items[0], 7); assert.equal(f.calls.filter(call => call[0] === 'run').length, 1);
});

test('long multilingual menu paths survive saving, search and execution', async () => {
  const f = fixture(), title = '日本語の非常に長いコマンド名'.repeat(30);
  f.state.tree.submenu.push({ title: '拡張機能', submenu: [{ title, command: -80 }] });
  const item = (await f.menus()).find(item => item.commandId === -80);
  assert.ok(item.id.length <= 250); assert.equal(core.search(core.prepare(await f.menus()), title)[0].id, item.id);
  const saved = core.defaults(); saved.wheels[0].slots[0] = item.id;
  assert.equal(core.cleanState(JSON.parse(JSON.stringify(saved))).wheels[0].slots[0], item.id);
  await f.host.run(item, 7); assert.ok(f.calls.some(call => call[0] === 'run' && call[1] === -80));
});

test('ambiguous plugin IDs are session scoped and cannot silently rebind after a restart', async () => {
  const f = fixture(); f.state.tree.submenu[3].submenu[0].submenu.push({ title: 'Open', command: -22 });
  const items = (await f.menus()).filter(item => item.title === 'Open'); assert.equal(items.length, 2);
  for (const item of items) await f.host.run(item, 7);
  const restarted = createHost(f.ps);
  await assert.rejects(restarted.run(items[0], 7), /no longer available/);
  assert.equal(f.calls.filter(call => call[0] === 'run').length, 2);
});

test('literal ampersands, keyboard suffixes and unrelated Reflex labels remain searchable', async () => {
  const f = fixture(); f.state.tree.submenu.push({ title: 'Window', submenu: [
    { title: 'Black && White…\tAlt+Shift+Ctrl+B', command: 90 }, { title: '&Reflex', command: 91 }
  ] });
  const items = await f.menus(); assert.ok(items.some(item => item.title === 'Black & White…'));
  assert.ok(items.some(item => item.title === 'Reflex' && item.subtitle === 'Window'));
});

test('Gaussian search excludes hidden menus and merges the equivalent command while retaining saved assignments', async () => {
  const catalog = require('../catalog'), f = fixture();
  f.state.tree.submenu.push({ title: 'Filter', submenu: [
    { title: 'Blur', submenu: [{ title: 'Gaussian Blur…', command: 2400, visible: true }] },
    { title: 'NextGen Filters', visible: false, submenu: [{ title: 'Blur (Gaussian)', command: 2401, visible: true }] }
  ] });
  f.state.tree.submenu[1].submenu.push({ title: 'Mode', submenu: [
    { title: 'Add Gaussian Blur Filter…', command: 2402, visible: false },
    { title: 'Internal Gaussian', command: 2403, hidden: true }
  ] });
  const snap = await f.host.snapshot(), menu = snap.items.find(item => item.commandId === 2400);
  assert.ok(menu); assert.ok(!snap.items.some(item => [2401, 2402, 2403].includes(item.commandId)));
  const index = core.prepare(catalog.concat(snap.items));
  for (const options of [{}, { category: 'Commands' }, { category: 'Menus' }, { onlyFavorites: true, favorites: [menu.id] }])
    assert.deepEqual(core.search(index, 'gaus', options).map(item => item.id), ['filter.gaussian']);
  assert.equal(core.search(index, 'filter blur gaussian')[0].id, 'filter.gaussian');

  const oldAssignment = index.find(item => item.id === menu.id), descriptors = [];
  f.ps.action.batchPlay = async commands => { descriptors.push(...commands); return [{}]; };
  await f.host.run(oldAssignment, 7);
  assert.equal(descriptors[0]._obj, 'gaussianBlur');
  assert.equal(descriptors[0].radius?._unit, 'pixelsUnit');
  assert.ok(descriptors[0].radius._value >= 0.1);
  assert.equal(descriptors[0]._options.dialogOptions, 'display');
  assert.ok(!f.calls.some(call => call[0] === 'run'));
});

test('one native command in several paths is searchable once; unrelated same-name commands stay separate', async () => {
  const f = fixture();
  f.state.tree.submenu.push({ title: 'Window', submenu: [{ title: 'Transform artwork', command: 2207 }] });
  const catalog = require('../catalog');

  f.state.tree.submenu[2].submenu.push({ title: 'New Adjustment Layer', submenu: [{ title: 'Curves…', command: 4000 }] });
  const index = core.prepare(catalog.concat((await f.host.snapshot()).items));
  assert.equal(core.search(index, 'transform').filter(item => item.kind === 'menu').length, 1);
  assert.equal(core.search(index, 'window artwork')[0].title, 'Free Transform');
  assert.equal(core.search(index, 'curves').length, 2);
});

test('different native commands at the same path are never guessed to be a catalog equivalent', async () => {
  const f = fixture();
  f.state.tree.submenu[1].submenu[0].submenu.push({ title: 'Curves…', command: 4999 });
  const index = core.prepare(require('../catalog').concat((await f.host.snapshot()).items));
  assert.equal(core.search(index, 'curves', { category: 'Menus' }).length, 2);
  assert.ok(core.search(index, 'curves', { category: 'Menus' }).every(item => item.kind === 'menu'));
});

test('menu cancellation is recognized from the modal context; a plain false result remains a real failure', async () => {
  for (const cancelled of [true, false]) {
    const f = fixture(), item = (await f.menus())[0];
    f.state.success = false;
    f.ps.core.executeAsModal = async fn => fn({ isCancelled: cancelled });

    f.ps.core.performMenuCommand = async () => false;
    await assert.rejects(f.host.run(item, 7), error => {
      assert.equal(core.isCancellation(error), cancelled); return true;
    });
    assert.equal(f.host.isModal(), false);
  }
});
