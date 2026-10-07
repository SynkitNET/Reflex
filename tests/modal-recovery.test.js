'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { createBridge, URL } = require('../bridge');
const createHost = require('../host');
const UI = require('../ui'), core = require('../core'), catalog = require('../catalog');
const connection = { version: 1, url: URL, token: 'a'.repeat(64) };
const response = value => ({ ok: true, json: async () => value || {}, headers: { get: () => 'event' } });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const flush = () => new Promise(resolve => setImmediate(resolve));
const snapshot = () => ({ items: [{ id: 'layer.new' }], context: { documentId: 7 }, suspended: false });

test('direct Photoshop dialog notifications suspend and resume without waiting for another document event', async () => {
  let listener, removed, observed = [];
  const host = createHost({ action: {
    async addNotificationListener(events, callback) { assert.ok(events.includes('modalStateChanged')); listener = callback; },
    async removeNotificationListener(events, callback) { removed = callback; }
  } });
  const unsubscribe = await host.subscribe(event => observed.push([event, host.isModal()]));
  listener('modalStateChanged', { state: { _enum: 'state', _value: 'enter' } });
  assert.equal(host.isModal(), true);
  listener('select', {}); assert.equal(host.isModal(), true, 'ordinary document events cannot resume a modal dialog');
  listener('modalStateChanged', { state: 'unknown' }); assert.equal(host.isModal(), true);
  listener('modalStateChanged', { state: { _enum: 'state', _value: 'exit' } });
  assert.equal(host.isModal(), false);
  assert.deepEqual(observed.at(-1), ['modalStateChanged', false]);
  await unsubscribe(); assert.equal(removed, listener);
});

test('a long command keeps heartbeats suspended and resumes immediately even when its acknowledgement expired', async () => {
  let time = 1000, polls = 0, runs = 0;
  const operation = deferred(), writes = [], statuses = [];
  let bridge;
  bridge = createBridge({ automatic: false, now: () => time, snapshot,
    onStatus: value => statuses.push(value),
    execute: async () => { runs++; await operation.promise; return { ok: true }; },
    fetch: async (url, options) => {
      if (url.endsWith('/sync')) writes.push(JSON.parse(options.body));
      if (url.endsWith('/poll')) return response(++polls === 1 ? { request: {
        id: 'long-dialog', kind: 'execute', commandId: 'layer.new', documentId: 7,
        session: bridge.session, expiresAt: time + 2000
      } } : {});
      if (url.endsWith('/ack')) return { ok: false, status: 409 };
      return response();
    }
  });
  await bridge.useConnection(connection);
  const command = bridge.tick(); await flush();
  assert.equal(runs, 1); assert.equal(writes.at(-1).suspended, true);
  for (let i = 0; i < 8; i++) {
    time += 500; await bridge.heartbeat(); assert.equal(writes.at(-1).suspended, true);
  }
  assert.ok(writes.length >= 10, 'freshness is maintained while the dialog is awaiting dismissal');
  operation.resolve(); await command;
  assert.equal(writes.at(-1).suspended, false, 'completion publishes resume before returning');
  assert.equal(bridge.getStatus().connected, true);
  assert.ok(!statuses.some(value => /409/.test(value.status)));
  await bridge.tick(); assert.equal(polls, 2); assert.equal(runs, 1);
  bridge.stop();
});

test('failed commands resume the helper too, but acknowledgement authentication failures still disconnect', async () => {
  const writes = []; let bridge;
  bridge = createBridge({ automatic: false, now: () => 1000, snapshot,
    execute: async () => { throw new Error('User cancelled filter'); },
    fetch: async (url, options) => {
      if (url.endsWith('/sync')) writes.push(JSON.parse(options.body));
      if (url.endsWith('/poll')) return response({ request: { id: 'cancel-filter', kind: 'execute', commandId: 'layer.new', documentId: 7, session: bridge.session, expiresAt: 2000 } });
      if (url.endsWith('/ack')) { assert.equal(JSON.parse(options.body).ok, false); return { ok: false, status: 401 }; }
      return response();
    }
  });
  await bridge.useConnection(connection); await bridge.tick();
  assert.equal(writes.at(-1).suspended, false);
  assert.equal(bridge.getStatus().connected, false); assert.match(bridge.getStatus().status, /Pairing was rejected/);
  bridge.stop();
});

test('modal exit replaces a stale GET without waiting for its timeout and ignores its late response', async () => {
  let time = 1000, polls = 0, runs = 0, suspended = true;
  const oldRead = deferred(), freshRead = deferred(); let bridge;
  bridge = createBridge({ automatic: false, now: () => time, snapshot: () => ({ ...snapshot(), suspended }),
    execute: async () => { runs++; return { ok: true }; },
    fetch: async url => {
      if (url.endsWith('/poll')) return ++polls === 1 ? oldRead.promise : freshRead.promise;
      return response();
    }
  });
  await bridge.useConnection(connection);
  const oldTick = bridge.tick(); await flush();
  time += 4000; suspended = false;
  await bridge.notifyHostChange();
  const newTick = bridge.tick(); await flush(); assert.equal(polls, 2);
  const command = { id: 'after-dialog', kind: 'execute', commandId: 'layer.new', documentId: 7, session: bridge.session, expiresAt: time + 2000 };
  freshRead.resolve(response({ request: command })); await newTick; assert.equal(runs, 1);
  oldRead.resolve(response({ request: command, status: 'Stale paused state' })); await oldTick;
  assert.equal(runs, 1, 'abandoned poll cannot execute or acknowledge its late copy');
  assert.deepEqual(bridge.getStatus(), { status: 'Connected', connected: true });
  bridge.stop();
});

test('repeated modal/focus events never produce more than two in-flight poll reads', async () => {
  let time = 1000, polls = 0; const reads = [];
  const bridge = createBridge({ automatic: false, now: () => time, snapshot,
    fetch: async url => {
      if (url.endsWith('/poll')) { polls++; const read = deferred(); reads.push(read); return read.promise; }
      return response();
    }
  });
  await bridge.useConnection(connection);
  const first = bridge.tick(); await flush();
  time += 1000; await bridge.notifyHostChange(); const second = bridge.tick(); await flush();
  for (let i = 0; i < 10; i++) { time += 1000; await bridge.notifyHostChange(); await bridge.tick(); }
  assert.equal(polls, 2);
  bridge.stop(); reads.forEach(read => read.resolve(response())); await Promise.all([first, second]);
});

test('modal exit does not abandon a command that is still executing', async () => {
  let time = 1000, polls = 0; const operation = deferred(); let bridge;
  bridge = createBridge({ automatic: false, now: () => time, snapshot, execute: () => operation.promise,
    fetch: async url => {
      if (url.endsWith('/poll')) { polls++; return response({ request: { id: 'in-progress', kind: 'execute', commandId: 'layer.new', documentId: 7, session: bridge.session, expiresAt: time + 2000 } }); }
      return response();
    }
  });
  await bridge.useConnection(connection); const pending = bridge.tick(); await flush();
  time += 5000; await bridge.notifyHostChange(); await bridge.tick(); assert.equal(polls, 1);
  operation.resolve({ ok: true }); await pending; bridge.stop();
});

test('controller announces both busy transitions before waiting on the deferred index refresh', async () => {
  const pending = deferred(), states = []; let controller;
  controller = UI.createController({ core, catalog, state: core.defaults(), storage: { save: async () => {} },
    host: { snapshot: async () => ({ context: { documentId: 7, layerCount: 1 }, items: [] }), run: () => pending.promise },
    onAvailabilityChange: () => states.push(controller.getBridgeSnapshot().suspended)
  });
  await controller.refresh(); const execution = controller.execute('layer.new', 7);
  assert.deepEqual(states, [true]); pending.resolve(); await execution;
  assert.deepEqual(states, [true, false]);
});

test('disconnect, expiry, modal entry, and document changes during suspension sync prevent command execution', async () => {
  for (const change of ['disconnect', 'expiry', 'modal', 'document']) {
    let time = 1000, runs = 0, writes = 0; const pending = deferred(), state = snapshot();
    const bridge = createBridge({ automatic: false, now: () => time, snapshot: () => state,
      execute: async () => { runs++; return { ok: true }; },
      fetch: async url => url.endsWith('/sync') && ++writes === 2 ? pending.promise : response()
    });
    await bridge.useConnection(connection);
    const handled = bridge.handle({ id: 'guard-' + change, kind: 'execute', commandId: 'layer.new', documentId: 7, session: bridge.session, expiresAt: 2000 });
    await flush(); let disconnect;
    if (change === 'disconnect') disconnect = bridge.disconnect();
    if (change === 'expiry') time = 4000;
    if (change === 'modal') state.suspended = true;
    if (change === 'document') state.context.documentId = 9;
    pending.resolve(response()); const ack = await handled; await disconnect;
    assert.equal(ack.ok, false, change); assert.equal(runs, 0, change); bridge.stop();
  }
});
