'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createNativeBridge, encodeBinding, decodeBinding } = require('../native-bridge');
const core = require('../core'), shortcuts = require('../shortcuts');
function fixture(loadAddon) {
  const calls = [], executed = [], statuses = [];
  let nativeSnapshot, next = {}, deferred, searchOpen = false;
  const value = { state: core.defaults(), context: { documentId: 42, layerCount: 1 },
    items: [{ id: 'layer.new', title: 'New layer', requires: 'document' }], suspended: false };
  const addon = { call(method, payload) {
    calls.push({ method, payload });
    if (method === 'health') return { protocol: 1, platform: 'win32' };
    if (method === 'sync') { nativeSnapshot = payload; return true; }
    if (method === 'poll') { const result = next; next = {}; return result; }
    if (method === 'capture') return { id: payload.id, phase: payload.action === 'confirm' ? 'confirmed' : payload.action === 'cancel' ? 'cancelled' : 'ready', binding: { key: 75, modifiers: 5 } };
    return true;
  } };
  const bridge = createNativeBridge({ automatic: false, now: () => 100, loadAddon: () => loadAddon ? loadAddon(addon) : addon,
    snapshot: () => value, execute: async (id, documentId) => { executed.push({ id, documentId }); if (deferred) await deferred; },
    openSearch: async () => { searchOpen = true; if (deferred) await deferred; }, onStatus: result => statuses.push(result) });
  return { bridge, calls, executed, statuses, value, addon,
    queue(overrides) { next = { sequence: 1, kind: 'command', command: 'layer.new', session: nativeSnapshot.session, document: '42', age: 2, ...overrides }; },
    block(promise) { deferred = promise; }, snapshot: () => nativeSnapshot, searchOpen: () => searchOpen };
}
test('hybrid starts without pairing or network and sends only available slot IDs', async () => {
  const f = fixture(); await f.bridge.start();
  assert.equal(f.bridge.getStatus().connected, true);
  assert.equal(f.snapshot().slots[0].id, 'layer.new'); assert.equal(f.snapshot().slots[1].id, '');
  assert.equal(f.snapshot().slots.length, 8); assert.equal(f.calls[0].method, 'health'); f.bridge.stop();
});

test('unavailable commands retain their real wheel icons without becoming executable', async () => {
  for (const context of [{ documentId: 42, layerCount: 0 }, { documentId: null, layerCount: 0 }]) {
    const f = fixture(); f.value.items = require('../catalog'); f.value.context = context;
    await f.bridge.start();
    for (let i = 0; i < 8; i++) {
      const item = f.value.items.find(item => item.id === f.value.state.wheels[0].slots[i]);
      const slot = f.snapshot().slots[i];
      assert.equal(slot.icon, item.icon);
      assert.equal(slot.title, item.title);
      assert.equal(slot.id, core.unavailable(item, context) ? '' : item.id);
    }
    f.value.state.wheels[0].slots[0] = null; f.bridge.syncNow();
    assert.deepEqual(f.snapshot().slots[0], { id: '', title: 'Empty', icon: 'plus' });
    f.bridge.stop();
  }
});

test('native wheel receives the same resolved colors and typeface as the panel', async () => {
  const f = fixture(); Object.assign(f.value.state, { accent: '#0000ff', accentStyle: 'bold', tintIcons: true, typeface: 'clear' });
  const colors = require('../theme').palette('#0000ff', 'bold'); await f.bridge.start();
  assert.equal(f.snapshot().accent, parseInt(colors.accent.slice(1), 16));
  assert.equal(f.snapshot().hover, parseInt(colors.hover.slice(1), 16));
  assert.equal(f.snapshot().iconAccent, f.snapshot().accent); assert.equal(f.snapshot().typeface, 2);
  f.value.state.tintIcons = false; f.value.state.accentStyle = 'minimal'; await f.bridge.syncNow();
  assert.equal(f.snapshot().iconAccent, 0xdedede); assert.equal(f.snapshot().hover, 0x252525); f.bridge.stop();
});
test('opening a wheel publishes settings first and refuses while Photoshop is busy', async () => {
  const f = fixture(); await f.bridge.start(); f.calls.length = 0;
  await f.bridge.showWheel();
  assert.deepEqual(f.calls.map(call => call.method), ['sync', 'status', 'wheel']);
  f.value.suspended = true;
  await assert.rejects(f.bridge.showWheel(), /Finish the current Photoshop dialog/);
  assert.equal(f.calls.filter(call => call.method === 'wheel').length, 1);
  f.bridge.stop(); await assert.rejects(f.bridge.showWheel(), /Reload Reflex/);
});
test('Missing ping reaches native drawing while execution is suspended, but never while stopped or recording', async () => {
  const f = fixture(); await f.bridge.start(); f.value.suspended = true;
  await f.bridge.showMissingPing();
  assert.equal(f.calls.filter(call => call.method === 'ping').length, 1);
  const capture = await f.bridge.startShortcutCapture();
  await assert.rejects(f.bridge.showMissingPing(), /recording/);
  await f.bridge.cancelShortcutCapture(capture.id);
  f.bridge.stop(); await assert.rejects(f.bridge.showMissingPing(), /Reload Reflex/);
});

test('native drawing failures remain visible in shortcut status instead of reporting Ready', async () => {
  const f = fixture(), nativeCall = f.addon.call;
  f.addon.call = (method, payload) => method === 'status' ? { error: 'Windows rejected the transparent window (Windows 87).' } : nativeCall(method, payload);
  await f.bridge.start();
  assert.equal(f.bridge.getStatus().connected, true);
  assert.match(f.bridge.getStatus().status, /Wheel overlay: Windows rejected/); f.bridge.stop();
});
test('hybrid executes an event once and acknowledges even invalid or duplicate events', async () => {
  const f = fixture(); await f.bridge.start(); f.queue(); await f.bridge.tick(); f.queue(); await f.bridge.tick();
  assert.deepEqual(f.executed, [{ id: 'layer.new', documentId: 42 }]);
  assert.equal(f.calls.filter(c => c.method === 'ack').length, 2); f.bridge.stop();
});

test('saved Remove wheel bindings cannot dispatch, even if native code delivers an old event', async () => {
  const f = fixture();
  f.value.items.push({ id: 'tool.remove', title: 'Remove', kind: 'command' });
  f.value.state.wheels[0].slots[0] = 'tool.remove';
  await f.bridge.start();
  assert.equal(f.snapshot().slots[0].id, '');
  f.queue({ command: 'tool.remove' }); await f.bridge.tick();
  assert.deepEqual(f.executed, []);
  assert.equal(f.calls.filter(call => call.method === 'ack').length, 1);
  assert.equal(f.value.state.wheels[0].slots[0], 'tool.remove');
  f.bridge.stop();
});
for (const [name, change] of Object.entries({ expired: { age: 2001 }, future: { age: -1 }, session: { session: 'foreign' }, document: { document: '41' }, arbitrary: { command: 'arbitrary.code' } })) {
  test('hybrid rejects ' + name + ' events', async () => {
    const f = fixture(); await f.bridge.start(); f.queue(change); await f.bridge.tick(); assert.equal(f.executed.length, 0); f.bridge.stop();
  });
}
test('modal state blocks delivery and long commands keep native input suspended', async () => {
  const f = fixture(); await f.bridge.start(); f.value.suspended = true; f.queue(); await f.bridge.tick();
  assert.equal(f.executed.length, 0); f.value.suspended = false;
  let release; f.block(new Promise(resolve => { release = resolve; })); f.queue({ sequence: 2 });
  const pending = f.bridge.tick(); await Promise.resolve(); f.bridge.syncNow(); assert.equal(f.snapshot().suspended, true);
  release(); await pending; assert.equal(f.snapshot().suspended, false); f.bridge.stop();
});
test('unload during a command cannot resume native input or acknowledge into a new session', async () => {
  const f = fixture(); await f.bridge.start(); let release;
  f.block(new Promise(resolve => { release = resolve; })); f.queue(); const pending = f.bridge.tick(); await Promise.resolve();
  f.bridge.stop(); const count = f.calls.length; release(); await pending;
  assert.equal(f.calls.length, count); assert.equal(f.bridge.getStatus().connected, false);
});
test('idle polling does not rebuild and publish the entire Photoshop catalog', async () => {
  const f = fixture(); await f.bridge.start(); const before = f.calls.filter(c => c.method === 'sync').length;
  await f.bridge.tick(); await f.bridge.tick(); assert.equal(f.calls.filter(c => c.method === 'sync').length, before); f.bridge.stop();
});
test('capture is suspended before listening, validates transaction identity and resumes after Save', async () => {
  const f = fixture(); await f.bridge.start(); const capture = await f.bridge.startShortcutCapture();
  assert.equal(f.snapshot().suspended, true);
  await assert.rejects(f.bridge.confirmShortcutCapture('foreign'));
  const result = await f.bridge.confirmShortcutCapture(capture.id);
  assert.deepEqual(result.binding, { key: 'KeyK', ctrl: true, alt: false, shift: true });
  assert.equal(f.snapshot().suspended, false); f.bridge.stop();
});
test('Mac Command bindings survive settings and conversion without changing existing Ctrl bindings', () => {
  const raw = { key: 'KeyK', ctrl: false, alt: true, shift: false, meta: true };
  const state = core.defaults(); state.shortcuts.search = raw;
  assert.deepEqual(core.cleanState(state).shortcuts.search, raw);
  assert.deepEqual(decodeBinding(encodeBinding(raw, 'darwin')), raw);
  assert.throws(() => encodeBinding(raw, 'win32'), /Command/);
  assert.equal(shortcuts.equal(raw, { ...raw, meta: false }), false);
  assert.equal(shortcuts.label(raw), 'Cmd + Alt + K');
});
test('missing or incompatible addon reports an error instead of pretending to connect', async () => {
  const f = fixture(); f.addon.call = () => { throw new Error('load failed'); }; await f.bridge.start();
  assert.equal(f.bridge.getStatus().connected, false); assert.match(f.bridge.getStatus().status, /load failed/);
});
test('async addon loading waits for exports and coalesces concurrent starts', async () => {
  let resolve, loads = 0;
  const f = fixture(addon => { loads++; return new Promise(done => { resolve = () => done(addon); }); });
  const first = f.bridge.start(), second = f.bridge.start();
  assert.equal(loads, 1); assert.equal(first, second); assert.equal(f.calls.length, 0);
  resolve(); await first;
  assert.equal(f.bridge.getStatus().connected, true);
  assert.equal(f.calls.filter(c => c.method === 'health').length, 1); f.bridge.stop();
});
test('unloading while addon loads cannot start native input late', async () => {
  let resolve;
  const f = fixture(addon => new Promise(done => { resolve = () => done(addon); }));
  const pending = f.bridge.start(); f.bridge.stop(); resolve(); await pending;
  assert.equal(f.calls.length, 0); assert.equal(f.bridge.getStatus().connected, false);
});
test('rejected async addon can be retried and invalid exports get an actionable error', async () => {
  let attempt = 0;
  const f = fixture(addon => ++attempt === 1 ? Promise.reject(new Error('Could not load binary')) : Promise.resolve(addon));
  await f.bridge.start(); assert.match(f.bridge.getStatus().status, /Could not load binary/);
  await f.bridge.start(); assert.equal(f.bridge.getStatus().connected, true); f.bridge.stop();
  const invalid = fixture(() => Promise.resolve({})); await invalid.bridge.start();
  assert.match(invalid.bridge.getStatus().status, /no Reflex interface/);
});
