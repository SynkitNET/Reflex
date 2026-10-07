'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');

test('the actual entry point publishes native dialog transitions before the index refresh and avoids modal DOM reads', async () => {
  let entrypoints, listener, bridgeOptions, controllerOptions, notifications = 0, reads = 0, overlays = 0;
  const savedContext = { documentId: 7, documentName: 'Before.psd', layerCount: 1 };
  const liveDocument = { id: 8, title: 'After.psd', activeLayers: [{}] };
  const ps = { app: { get activeDocument() { reads++; return liveDocument; } }, action: {
    addNotificationListener: async (events, fn) => { listener = fn; }, removeNotificationListener: async () => {}
  } };
  const bridge = { start() {}, markDirty() {}, stop() {}, getStatus: () => ({ connected: true }),
    async showWheel() { overlays++; },
    notifyHostChange() { notifications++; return Promise.resolve(); } };
  const context = {
    require(name) {
      if (name === 'photoshop') return ps;
      if (name === 'uxp') return {
        entrypoints: { setup: value => { entrypoints = value; } },
        storage: { localFileSystem: { getDataFolder: async () => ({ getEntry: async () => { throw new Error('No saved file'); } }) } }
      };
      if (name === './native-bridge.js') return { createNativeBridge: options => { bridgeOptions = options; return bridge; } };
      if (name === './ui.js') return { createController: options => { controllerOptions = options; return ({
        mountPanel() {}, refresh: async () => {}, message() {}, refreshViews() {},
        getBridgeSnapshot: () => ({ context: savedContext, items: [], suspended: false })
      }); } };
      return require(path.resolve(root, name));
    },
    document: { getElementById: () => ({}), addEventListener() {} }, setTimeout, clearTimeout
  };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), context);
  await entrypoints.panels.reflex.show();
  listener('modalStateChanged', { state: { _value: 'enter' } });
  assert.equal(notifications, 1);
  const paused = bridgeOptions.snapshot(); assert.equal(paused.suspended, true);
  assert.equal(paused.context, savedContext); assert.equal(reads, 0);
  listener('modalStateChanged', { state: { _value: 'exit' } });
  assert.equal(notifications, 2);
  const ready = bridgeOptions.snapshot(); assert.equal(ready.suspended, false);
  assert.equal(ready.context.documentId, 8); assert.equal(reads, 1);
  await entrypoints.commands.wheel();
  await controllerOptions.previewWheel();
  assert.equal(overlays, 2, 'Photoshop menu and wheel control both use the native overlay, never a UXP dialog');
  await entrypoints.panels.reflex.destroy();
});

test('search opens without window chrome, suspends shortcuts, and closes before executing', async () => {
  let entrypoints, bridgeOptions, searchOptions, resolveDialog, shown = false, modalOptions;
  const order = [], rootNode = { innerHTML: '' }, panel = {};
  const dialog = {
    showModal(options) { modalOptions = options; shown = true; order.push('show'); return new Promise(resolve => { resolveDialog = resolve; }); },
    close(value) { shown = false; order.push('close'); resolveDialog(value); }
  };
  const host = { context: () => ({ documentId: 7 }), isModal: () => false, subscribe: async () => async () => {} };
  const app = {
    mountPanel() {}, refresh: async () => { order.push('refresh'); }, message: text => { throw new Error(text); }, refreshViews() {},
    getBridgeSnapshot: () => ({ context: { documentId: 7 }, suspended: false, items: [] }),
    mountSearch(root, options) { searchOptions = options; order.push('mount'); return { focus() {}, dispose() { order.push('dispose'); } }; },
    execute: async (id, documentId) => { assert.equal(shown, false); assert.equal(id, 'view.fit'); assert.equal(documentId, 7); order.push('execute'); }
  };
  const bridge = { start: async () => {}, stop() {}, markDirty() {}, notifyHostChange() {},
    getStatus: () => ({ connected: true }), syncNow: async () => { assert.equal(bridgeOptions.snapshot().suspended, true); order.push('sync'); } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), {
    require(name) {
      if (name === 'photoshop') return {};
      if (name === 'uxp') return { entrypoints: { setup: value => { entrypoints = value; } }, storage: { localFileSystem: {} } };
      if (name === './host.js') return () => host;
      if (name === './storage.js') return () => ({ load: async () => ({ state: {} }) });
      if (name === './ui.js') return { createController: () => app };
      if (name === './native-bridge.js') return { createNativeBridge: options => { bridgeOptions = options; return bridge; } };
      return require(path.resolve(root, name));
    },
    document: { getElementById: id => id === 'palette-dialog' ? dialog : id === 'palette-root' ? rootNode : panel, addEventListener() {} },
    setTimeout, clearTimeout
  });
  await entrypoints.panels.reflex.show(); order.length = 0;
  const opening = entrypoints.commands.search();
  for (let i = 0; i < 20; i++) await Promise.resolve();
  assert.deepEqual(order, ['refresh', 'sync', 'mount', 'show']);
  assert.equal(modalOptions.titleVisibility, 'hide'); assert.equal(modalOptions.lockDocumentFocus, true); assert.equal(modalOptions.isTransparent, false);
  assert.equal(modalOptions.size.width, 560); assert.equal(modalOptions.size.height, 392);
  assert.equal(searchOptions.floating, true);
  await entrypoints.commands.search(); assert.equal(order.filter(event => event === 'show').length, 1);
  searchOptions.close({ id: 'view.fit', documentId: 7 }); await opening;
  assert.deepEqual(order.slice(-3), ['close', 'dispose', 'execute']);
  assert.equal(bridgeOptions.snapshot().suspended, false);
  await entrypoints.panels.reflex.destroy();
});
