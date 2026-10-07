const test=require('node:test'),assert=require('node:assert/strict');
const {createBridge,validateConnection,URL,LEGACY_URL}=require('../bridge');
const connection={version:1,url:URL,token:'a'.repeat(64)};
test('a rejected Photoshop snapshot reports the native validation reason',async()=>{
  const bridge=createBridge({automatic:false,snapshot:()=>({}),fetch:async url=>url.endsWith('/health')
    ? {ok:true,json:async()=>({})}
    : {ok:false,status:400,json:async()=>({error:'Duplicate item IDs.'})}});
  await assert.rejects(bridge.useConnection(connection), /rejected \/sync \(400\): Duplicate item IDs/);
  assert.match(bridge.getStatus().status, /Duplicate item IDs/);
  assert.equal(bridge.getStatus().connected,false);
});
function setup(){
  const snapshot={context:{documentId:7},items:[{id:'layer.new'}],suspended:false};
  let calls=0, searches=0;
  const bridge=createBridge({automatic:false,now:()=>1000,snapshot:()=>snapshot,execute:async()=>{calls++;return{ok:true};},openSearch:()=>{searches++;},fetch:async()=>({ok:true,json:async()=>({})})});
  return {bridge,snapshot,calls:()=>calls,searches:()=>searches,event:extra=>Object.assign({id:'one',kind:'execute',commandId:'layer.new',documentId:7,session:bridge.session,expiresAt:2500},extra)};
}
test('connection file cannot redirect requests or accept malformed credentials',()=>{
  assert.equal(validateConnection(connection).url,URL);
  assert.deepEqual(validateConnection({...connection,url:LEGACY_URL}),connection);
  for(const change of [{url:'https://example.com'},{url:'http://localhost'},{url:'http://localhost:47838'},{url:'http://127.0.0.1:47838'},{url:'http://localhost:47837/health'},{url:'https://localhost:47837'},{url:'http://localhost.evil.test:47837'},{url:'http://user@localhost:47837'},{token:'short'},{version:2}]) assert.throws(()=>validateConnection({...connection,...change}));
});
test('redelivered wheel request executes only once even if acknowledgement was lost',async()=>{
  const f=setup();const first=await f.bridge.handle(f.event());const second=await f.bridge.handle(f.event());
  assert.equal(first.ok,true);assert.equal(second.ok,true);assert.equal(f.calls(),1);
});
test('expired, foreign, suspended, stale-document and arbitrary commands never execute',async()=>{
  const cases=[{expiresAt:999},{expiresAt:9000},{session:'foreign'},{documentId:8},{commandId:'eval'},{kind:'javascript'}];
  for(const change of cases){const f=setup();assert.equal((await f.bridge.handle(f.event(change))).ok,false);assert.equal(f.calls(),0);}
  const f=setup();f.snapshot.suspended=true;assert.equal((await f.bridge.handle(f.event())).ok,false);assert.equal(f.calls(),0);
});
test('search request opens the existing centered palette without running a Photoshop command',async()=>{
  const f=setup();assert.equal((await f.bridge.handle(f.event({kind:'search'}))).ok,true);assert.equal(f.searches(),1);assert.equal(f.calls(),0);
});
test('disconnect sends suspension before forgetting the paired helper',async()=>{
  const sent=[];const bridge=createBridge({automatic:false,snapshot:()=>({items:[],context:{},suspended:false}),fetch:async(url,options)=>{sent.push([url,options]);return{ok:true,json:async()=>({})};}});
  await bridge.useConnection(connection);await bridge.disconnect();
  const last=sent.filter(([url])=>url.endsWith('/sync')).at(-1);
  assert.equal(JSON.parse(last[1].body).suspended,true);assert.equal(bridge.getStatus().connected,false);
});

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const response = value => ({ ok: true, json: async () => value || {} });
const flush = () => new Promise(resolve => setImmediate(resolve));
function deferredSyncBridge() {
  const writes = [], statuses = [];
  let active = 0, maximumActive = 0, revision = 0;
  const bridge = createBridge({
    automatic: false,
    now: () => 1000,
    snapshot: () => ({ items: [], context: {}, suspended: false, revision }),
    onStatus: value => statuses.push(value),
    fetch: async (url, settings) => {
      if (!url.endsWith('/sync')) return response();
      active++; maximumActive = Math.max(maximumActive, active);
      const pending = deferred();
      writes.push({ pending, payload: JSON.parse(settings.body) });
      try { return await pending.promise; } finally { active--; }
    }
  });
  bridge.restoreConnection(connection);
  return { bridge, writes, statuses, maximumActive: () => maximumActive, revision: value => { revision = value; } };
}
test('three concurrent sync calls own the write queue one at a time and read state at dispatch', async () => {
  const f = deferredSyncBridge();
  const one = f.bridge.syncNow(), two = f.bridge.syncNow(), three = f.bridge.syncNow();
  await flush();
  assert.equal(f.writes.length, 1);
  assert.equal(f.writes[0].payload.revision, 0);
  f.revision(1); f.writes[0].pending.resolve(response());
  await one; await flush();
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[1].payload.revision, 1);
  f.revision(2); f.writes[1].pending.resolve(response());
  await two; await flush();
  assert.equal(f.writes.length, 3);
  assert.equal(f.writes[2].payload.revision, 2);
  f.writes[2].pending.resolve(response()); await three;
  assert.equal(f.maximumActive(), 1);
});
test('disconnect drains the active sync, skips queued old snapshots, and suspends last', async () => {
  const f = deferredSyncBridge();
  const one = f.bridge.syncNow(); await flush();
  const two = f.bridge.syncNow(), three = f.bridge.syncNow();
  const disconnect = f.bridge.disconnect();
  assert.equal(f.bridge.getStatus().connected, false);
  assert.equal(f.bridge.getStatus().status, 'Helper not connected');
  await f.bridge.syncNow(); await flush();
  assert.equal(f.writes.length, 1, 'suspension must wait for the existing write');
  f.writes[0].pending.resolve(response());
  await Promise.all([one, two, three]); await flush();
  assert.equal(f.writes.length, 2, 'old queued snapshots were skipped');
  assert.equal(f.writes[1].payload.suspended, true);
  assert.equal(f.bridge.getStatus().connected, false, 'old completion cannot rearm connection status');
  f.writes[1].pending.resolve(response()); await disconnect;
  assert.equal(f.maximumActive(), 1);
  assert.equal(f.statuses.some(value => value.connected), false);
});
test('a failed sync does not poison the queue or bypass final disconnect suspension', async () => {
  const f = deferredSyncBridge();
  const failed = f.bridge.syncNow(); const rejected = assert.rejects(failed, /network failure/);
  await flush();
  const disconnect = f.bridge.disconnect();
  f.writes[0].pending.reject(new Error('network failure'));
  await rejected; await flush();
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[1].payload.suspended, true);
  f.writes[1].pending.resolve(response()); await disconnect;
});
test('reconnecting queues the new snapshot after disconnect suspension and invalidates old queued work', async () => {
  const f = deferredSyncBridge();
  const oldSession = f.bridge.session;
  const old = f.bridge.syncNow(); await flush();
  const oldQueued = f.bridge.syncNow();
  const disconnect = f.bridge.disconnect();
  f.bridge.restoreConnection(connection);
  const replacementSession = f.bridge.session;
  assert.notEqual(replacementSession, oldSession);
  const replacement = f.bridge.syncNow();
  f.writes[0].pending.resolve(response()); await old; await oldQueued; await flush();
  assert.equal(f.writes.length, 2);
  assert.equal(f.writes[1].payload.suspended, true);
  assert.equal(f.writes[1].payload.session, oldSession);
  f.writes[1].pending.resolve(response()); await disconnect; await flush();
  assert.equal(f.writes.length, 3);
  assert.equal(f.writes[2].payload.session, replacementSession);
  assert.equal(f.writes[2].payload.suspended, false);
  f.writes[2].pending.resolve(response()); await replacement;
  assert.equal(f.bridge.getStatus().connected, true);
  assert.equal(f.maximumActive(), 1);
});
test('stale polling responses and errors cannot overwrite stopped or replacement-session status', async () => {
  for (const outcome of ['resolve', 'reject']) {
    const poll = deferred();
    const bridge = createBridge({ automatic: false, now: () => 1000,
      snapshot: () => ({ items: [], context: {}, suspended: false }),
      fetch: async url => url.endsWith('/poll') ? poll.promise : response()
    });
    await bridge.useConnection(connection);
    const oldTick = bridge.tick(); await flush();
    bridge.stop();
    if (outcome === 'reject') {
      bridge.restoreConnection(connection); await bridge.syncNow();
      poll.reject(new Error('Old connection broke'));
    } else poll.resolve(response({ status: 'Old connected state' }));
    await oldTick;
    assert.equal(bridge.getStatus().status, outcome === 'resolve' ? 'Helper not connected' : 'Connected');
    assert.equal(bridge.getStatus().connected, outcome === 'reject');
  }
});
test('stopping during an acknowledgement cannot report the old poll as connected', async () => {
  const ack = deferred(); let bridge;
  bridge = createBridge({ automatic: false, now: () => 1000,
    snapshot: () => ({ items: [], context: {}, suspended: false }),
    openSearch() {},
    fetch: async url => {
      if (url.endsWith('/ack')) return ack.promise;
      if (url.endsWith('/poll')) return response({ status: 'Old status', request: {
        id: 'search-1', kind: 'search', session: bridge.session, expiresAt: 2000
      } });
      return response();
    }
  });
  await bridge.useConnection(connection);
  const tick = bridge.tick(); await flush(); bridge.stop();
  ack.resolve(response()); await tick;
  assert.deepEqual(bridge.getStatus(), { status: 'Helper not connected', connected: false });
});
test('a late health check cannot reconnect after an explicit disconnect', async () => {
  const health = deferred(); let writes = 0;
  const bridge = createBridge({ automatic: false,
    snapshot: () => ({ items: [], context: {}, suspended: false }),
    fetch: async url => {
      if (url.endsWith('/health')) return health.promise;
      writes++; return response();
    }
  });
  const connecting = bridge.useConnection(connection);
  await bridge.disconnect(); health.resolve(response()); await connecting;
  assert.equal(writes, 0);
  assert.equal(bridge.getStatus().connected, false);
});
test('read timeout leaves an unreachable helper disconnected without releasing mutation ordering', async () => {
  const health = deferred();
  const bridge = createBridge({ automatic: false, readTimeoutMs: 10,
    snapshot: () => ({ items: [], context: {}, suspended: false }), fetch: () => health.promise });
  await assert.rejects(bridge.useConnection(connection), /timed out/);
  health.resolve(response()); await flush();
  assert.equal(bridge.getStatus().connected, false);
});

test('reconnect rotates the session, clears cached acknowledgements, and rejects old requests', async () => {
  const f = setup();
  const initial = f.bridge.session;
  const old = f.event();
  assert.equal((await f.bridge.handle(old)).ok, true);
  await f.bridge.useConnection(connection);
  const connectedSession = f.bridge.session;
  assert.notEqual(connectedSession, initial);
  assert.equal((await f.bridge.handle(old)).ok, false, 'cached old success must be cleared');
  assert.equal(f.calls(), 1);
  const fresh = f.event({ id: 'fresh' });
  assert.equal((await f.bridge.handle(fresh)).ok, true);
  f.bridge.restoreConnection(connection);
  assert.notEqual(f.bridge.session, connectedSession);
  assert.equal((await f.bridge.handle(fresh)).ok, false);
  assert.equal(f.calls(), 2);
  assert.equal((await f.bridge.handle(f.event({ id: 'newest' }))).ok, true);
  assert.equal(f.calls(), 3);
});


test('a blocked UXP health request preserves its URL and reason without repeating reload advice', async () => {
  const diagnostic = 'Permission denied to the url http://127.0.0.1:47837/health. Manifest entry not found.';
  let failure;
  const bridge = createBridge({ automatic: false,
    fetch: async () => { throw new Error(diagnostic); }
  });
  await assert.rejects(bridge.useConnection(connection), error => {
    assert.equal(error.code, 'REFLEX_NETWORK_PERMISSION');
    assert.match(error.message, /local connection permission needs updating/i);
    assert.ok(error.message.endsWith(diagnostic));
    assert.doesNotMatch(error.message, /unload|reload|load the updated/i);
    failure = error;
    return true;
  });
  assert.equal(bridge.getStatus().status, failure.message);
  assert.equal(bridge.getStatus().status.split(diagnostic).length - 1, 1);
  assert.equal(bridge.getStatus().connected, false);
});

test('restored pairing keeps the permission diagnosis instead of replacing it with helper unavailable', async () => {
  const bridge = createBridge({ automatic: false,
    snapshot: () => ({ items: [], context: {}, suspended: false }),
    fetch: async () => { throw new Error('Manifest entry not found'); }
  });
  bridge.restoreConnection(connection);
  await bridge.tick();
  assert.match(bridge.getStatus().status, /local connection permission needs updating.*Manifest entry not found/i);
  assert.doesNotMatch(bridge.getStatus().status, /unload|reload/i);
  assert.equal(bridge.getStatus().connected, false);
});

test('a first-sync failure reports its cause and retries automatically after pairing succeeds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let writes = 0, polls = 0;
  const bridge = createBridge({
    snapshot: () => ({ items: [], context: {}, suspended: false }),
    fetch: async url => {
      if (url.endsWith('/sync') && ++writes === 1) throw new Error('Manifest entry not found');
      if (url.endsWith('/poll')) polls++;
      return response();
    }
  });
  try {
    await assert.rejects(bridge.useConnection(connection), /Photoshop blocked/);
    assert.match(bridge.getStatus().status, /Photoshop blocked/);
    assert.equal(writes, 1);
    t.mock.timers.tick(1999); await flush();
    assert.equal(writes, 1);
    t.mock.timers.tick(1); await flush();
    assert.equal(writes, 2);
    assert.equal(polls, 1);
    assert.equal(bridge.getStatus().connected, true);
  } finally { bridge.stop(); }
});

test('a failed old health check cannot replace the status of a newer working session', async () => {
  const health = deferred();
  const bridge = createBridge({ automatic: false,
    snapshot: () => ({ items: [], context: {}, suspended: false }),
    fetch: async url => url.endsWith('/health') ? health.promise : response()
  });
  const connecting = bridge.useConnection(connection);
  const failed = assert.rejects(connecting, /Photoshop blocked/);
  bridge.restoreConnection(connection); await bridge.syncNow();
  health.reject(new Error('Manifest entry not found')); await failed;
  assert.deepEqual(bridge.getStatus(), { status: 'Connected', connected: true });
});

test('authentication and transport rejection retain distinct connection diagnoses', async () => {
  for (const [status, expected] of [[401, /current connection\.json/], [403, /Update Reflex and its helper/]]) {
    const bridge = createBridge({ automatic: false,
      fetch: async () => ({ ok: false, status })
    });
    await assert.rejects(bridge.useConnection(connection), expected);
    assert.match(bridge.getStatus().status, expected);
    assert.equal(bridge.getStatus().connected, false);
  }
});


test('legacy pairing keeps its token while every endpoint uses the exact localhost transport', async () => {
  const sent = [], saved = [];
  let bridge;
  bridge = createBridge({ automatic: false, now: () => 1000,
    snapshot: () => ({ items: [], context: {}, suspended: false }),
    saveConnection: async value => saved.push(value),
    openSearch() {},
    fetch: async (url, settings) => {
      sent.push({ url, settings });
      return response(url.endsWith('/poll') ? { request: {
        id: 'search', kind: 'search', session: bridge.session, expiresAt: 2500
      } } : {});
    }
  });
  const legacy = { ...connection, url: LEGACY_URL };
  await bridge.useConnection(legacy, true);
  await bridge.tick();
  await bridge.showWheel();
  await bridge.disconnect();
  assert.deepEqual(saved[0], connection);
  assert.equal(legacy.url, LEGACY_URL, 'migration must not mutate the supplied file');
  assert.equal(saved.at(-1), null);
  assert.deepEqual(new Set(sent.map(item => item.url.slice(URL.length))), new Set(['/health', '/sync', '/poll', '/ack', '/show']));
  for (const { url, settings } of sent) {
    assert.ok(url.startsWith(URL + '/'));
    assert.equal(settings.headers.Authorization, 'Bearer ' + legacy.token);
  }
});

test('restoring a saved legacy pairing immediately uses localhost without requiring pairing again', async () => {
  const urls = [];
  const bridge = createBridge({ automatic: false,
    snapshot: () => ({ items: [], context: {}, suspended: false }),
    fetch: async url => { urls.push(url); return response(); }
  });
  bridge.restoreConnection({ ...connection, url: LEGACY_URL });
  await bridge.tick();
  assert.deepEqual(urls, [URL + '/sync', URL + '/poll']);
  assert.equal(bridge.getStatus().connected, true);
  bridge.stop();
});


for (const mode of ['event', 'immediate', 'legacy']) {
  test('poll scheduling uses ' + mode + ' helper delivery without adding an event-mode delay', async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const polls = [], first = deferred(), second = deferred();
    let calls = 0, acks = 0, bridge;
    bridge = createBridge({ now: () => 1000,
      snapshot: () => ({ items: [{ id: 'layer.new' }], context: { documentId: 7 }, suspended: false }),
      execute: async () => { calls++; return { ok: true }; },
      fetch: async url => {
        if (url.endsWith('/poll')) { polls.push(url); return polls.length === 1 ? first.promise : second.promise; }
        if (url.endsWith('/ack')) acks++;
        return response();
      }
    });
    try {
      await bridge.useConnection(connection);
      t.mock.timers.tick(0); await flush();
      assert.equal(polls.length, 1);
      const returned = response({ _eventDrivenPoll: true, request: {
        id: 'release-1', kind: 'execute', commandId: 'layer.new', documentId: 7,
        session: bridge.session, expiresAt: 2500
      } });
      if (mode !== 'legacy') returned.headers = { get: name => name === 'X-Reflex-Poll-Mode' ? mode : null };
      first.resolve(returned); await flush();
      assert.equal(calls, 1);
      assert.equal(acks, 1);
      t.mock.timers.tick(0); await flush();
      assert.equal(polls.length, mode === 'event' ? 2 : 1);
      if (mode !== 'event') {
        t.mock.timers.tick(99); await flush(); assert.equal(polls.length, 1);
        t.mock.timers.tick(1); await flush(); assert.equal(polls.length, 2);
      }
    } finally {
      bridge.stop(); first.resolve(response()); second.resolve(response()); await flush();
    }
  });
}


test('snapshot sends the installed plugin version, including final disconnect suspension', async () => {
  const writes = [];
  const bridge = createBridge({ automatic: false,
    snapshot: () => ({ items: [], context: {}, suspended: false, clientVersion: 'foreign' }),
    fetch: async (url, settings) => { if (url.endsWith('/sync')) writes.push(JSON.parse(settings.body)); return response(); }
  });
  await bridge.useConnection(connection);
  await bridge.disconnect();
  assert.equal(writes.length, 2);
  for (const payload of writes) assert.equal(payload.clientVersion, require('../package.json').version);
});

test('ack timing distinguishes late delivery from slow Photoshop completion without changing expiry', async () => {
  let clock = 1000;
  const snapshot = { context: { documentId: 7 }, items: [{ id: 'layer.new' }], suspended: false };
  const bridge = createBridge({ automatic: false, now: () => clock, snapshot: () => snapshot,
    execute: async () => { clock += 2250; return { ok: true }; }
  });
  const event = { id: 'timed', kind: 'execute', commandId: 'layer.new', documentId: 7, session: bridge.session, expiresAt: 1500 };
  const ack = await bridge.handle(event);
  assert.deepEqual(ack, { requestId: 'timed', ok: true, error: '', executionMs: 2250, receivedRemainingMs: 500 });
  assert.strictEqual(await bridge.handle(event), ack, 'redelivery keeps original timing and does not execute again');
  const expired = await bridge.handle({ ...event, id: 'expired', expiresAt: clock - 1 });
  assert.equal(expired.ok, false);
  assert.equal(expired.executionMs, 0);
  assert.equal(expired.receivedRemainingMs, -1);
});

test('ack diagnostics clamp unexpected clock changes to bounded numeric values', async () => {
  for (const elapsed of [-10000, 4000000]) {
    let clock = 1000;
    const bridge = createBridge({ automatic: false, now: () => clock,
      snapshot: () => ({ context: { documentId: 7 }, items: [{ id: 'layer.new' }], suspended: false }),
      execute: async () => { clock += elapsed; return { ok: true }; }
    });
    const ack = await bridge.handle({ id: 'bounded', kind: 'execute', commandId: 'layer.new', documentId: 7,
      session: bridge.session, expiresAt: 2500 });
    assert.equal(ack.executionMs, elapsed < 0 ? 0 : 3600000);
    assert.equal(ack.receivedRemainingMs, 1500);
  }
});

function captureBridge(extra = {}) {
  const sent = [], snapshot = { items: [], context: {}, suspended: false };
  let native = null, synced = null, intercept = null;
  const bridge = createBridge({ automatic: false, now: () => 1000, ...extra,
    snapshot: () => snapshot,
    fetch: async (url, settings) => {
      const path = url.slice(URL.length), body = settings.body === undefined ? undefined : JSON.parse(settings.body);
      sent.push({ path, body, settings });
      if (intercept) {
        const result = await intercept(path, body);
        if (result !== undefined) return result;
      }
      if (path === '/sync') { synced = body; return response(); }
      if (path === '/capture') {
        assert.match(body.id, /^[A-Za-z0-9_-]{8,128}$/);
        if (body.action === 'start') {
          assert.equal(synced.suspended, true, 'native capture requires a prior suspended snapshot');
          assert.equal(synced.session, body.session);
          native = { id: body.id, phase: 'listening', binding: null };
        } else if (body.action === 'confirm') {
          if (!native || native.id !== body.id || native.phase !== 'ready') return { ok: false, status: 409 };
          const confirmed = { id: body.id, phase: 'confirmed', binding: native.binding };
          native = { id: body.id, phase: 'cancelled', binding: null };
          return response(confirmed);
        } else {
          assert.equal(body.action, 'cancel');
          if (native && native.id !== body.id) return { ok: false, status: 409 };
          native = { id: body.id, phase: 'cancelled', binding: null };
        }
        return response(native);
      }
      if (path.startsWith('/capture?')) {
        const query = new globalThis.URL(url).searchParams;
        assert.equal(query.get('session'), bridge.session);
        assert.equal(query.get('id'), native.id);
        return response(native);
      }
      return response();
    }
  });
  return { bridge, sent, snapshot, intercept: value => { intercept = value; },
    native: () => native, phase: (phase, binding = null) => { native = { ...native, phase, binding }; } };
}

for (const binding of [
  { key: 'KeyK', ctrl: true, alt: true, shift: false },
  { key: 'MouseMiddle', ctrl: false, alt: false, shift: false },
  { key: 'MouseBack', ctrl: true, alt: false, shift: true },
  { key: 'MouseForward', ctrl: false, alt: true, shift: false }
]) {
  test('native shortcut capture returns pressed and released ' + binding.key + ' candidates without saving', async () => {
    const f = captureBridge(); await f.bridge.useConnection(connection);
    const started = await f.bridge.startShortcutCapture();
    assert.deepEqual(started, { id: started.id, phase: 'listening', binding: null });
    f.phase('pressed', { ...binding, derivedField: 'discard me' });
    assert.deepEqual(await f.bridge.readShortcutCapture(started.id), { id: started.id, phase: 'pressed', binding });
    f.phase('ready', binding);
    assert.deepEqual(await f.bridge.readShortcutCapture(started.id), { id: started.id, phase: 'ready', binding });
    assert.equal(f.native().phase, 'ready', 'candidate remains pending explicit Save or Cancel');
    assert.deepEqual(await f.bridge.confirmShortcutCapture(started.id), { id: started.id, phase: 'confirmed', binding });
    assert.equal(f.native().phase, 'cancelled');
    assert.equal(f.native().binding, null);
    await assert.rejects(f.bridge.confirmShortcutCapture(started.id), /capture ended or changed/);
    await f.bridge.syncNow();
    assert.equal(f.sent.at(-1).body.suspended, false);
    for (const call of f.sent.filter(call => call.path.startsWith('/capture'))) {
      assert.equal(call.path.includes(connection.token), false);
      assert.equal(JSON.stringify(call.body || {}).includes(connection.token), false);
      assert.equal(call.settings.headers.Authorization, 'Bearer ' + connection.token);
    }
  });
}

test('capture suspension and start are adjacent writes and later syncs stay suspended until cancellation', async () => {
  const f = captureBridge(); await f.bridge.useConnection(connection);
  const gate = deferred(); let block = true;
  f.intercept(async path => { if (path === '/sync' && block) { block = false; await gate.promise; } });
  const started = f.bridge.startShortcutCapture();
  const laterSync = f.bridge.syncNow(); await flush();
  assert.equal(f.sent.filter(call => call.path === '/capture').length, 0);
  gate.resolve(); const capture = await started; await laterSync;
  assert.deepEqual(f.sent.slice(-3).map(call => [call.path, call.body.action || call.body.suspended]),
    [['/sync', true], ['/capture', 'start'], ['/sync', true]]);
  await f.bridge.cancelShortcutCapture(capture.id);
});

test('cancelling before the suspended sync completes prevents any native start', async () => {
  const f = captureBridge(); await f.bridge.useConnection(connection);
  const gate = deferred();
  f.intercept(async path => { if (path === '/sync') await gate.promise; });
  const started = f.bridge.startShortcutCapture(); await flush();
  const cancelled = f.bridge.cancelShortcutCapture();
  gate.resolve();
  assert.equal((await started).phase, 'cancelled');
  assert.equal((await cancelled).phase, 'cancelled');
  assert.equal(f.sent.some(call => call.path === '/capture'), false);
});

test('disconnect drains an in-flight capture start, cancels it, then sends final suspension', async () => {
  const f = captureBridge(); await f.bridge.useConnection(connection);
  const gate = deferred();
  f.intercept(async (path, body) => { if (path === '/capture' && body.action === 'start') await gate.promise; });
  const started = f.bridge.startShortcutCapture(); await flush();
  const disconnect = f.bridge.disconnect(); await flush();
  assert.equal(f.sent.at(-1).body.action, 'start', 'cancel cannot overtake an unabortable start');
  gate.resolve();
  const result = await started; await disconnect;
  assert.equal(result.phase, 'cancelled');
  assert.deepEqual(f.sent.slice(-3).map(call => [call.path, call.body.action || call.body.suspended]),
    [['/capture', 'start'], ['/capture', 'cancel'], ['/sync', true]]);
  assert.equal(f.sent.at(-2).body.id, result.id);
  assert.equal(f.native().phase, 'cancelled');
});

test('replacement capture ignores stale read results and cancellation with an old id', async () => {
  const f = captureBridge(); await f.bridge.useConnection(connection);
  const first = await f.bridge.startShortcutCapture(), gate = deferred();
  f.intercept(path => path.startsWith('/capture?') ? gate.promise : undefined);
  const reading = f.bridge.readShortcutCapture(first.id); await flush();
  const second = await f.bridge.startShortcutCapture();
  gate.resolve(response({ id: first.id, phase: 'ready', binding: { key: 'KeyA', ctrl: false, alt: false, shift: false } }));
  assert.deepEqual(await reading, { id: first.id, phase: 'cancelled', binding: null });
  const calls = f.sent.length;
  assert.equal((await f.bridge.cancelShortcutCapture(first.id)).phase, 'cancelled');
  assert.equal(f.sent.length, calls, 'an old cancel cannot send a write for the replacement');
  f.intercept(null);
  assert.equal((await f.bridge.readShortcutCapture(second.id)).phase, 'listening');
  await f.bridge.cancelShortcutCapture(second.id);
});

test('a late cancel response cannot clear a newer capture transaction', async () => {
  const f = captureBridge(); await f.bridge.useConnection(connection);
  const first = await f.bridge.startShortcutCapture(), gate = deferred(); let block = true;
  f.intercept(async (path, body) => {
    if (path === '/capture' && body.action === 'cancel' && block) { block = false; await gate.promise; }
  });
  const cancelling = f.bridge.cancelShortcutCapture(first.id); await flush();
  const replacing = f.bridge.startShortcutCapture(); await flush();
  gate.resolve(); await cancelling; const second = await replacing;
  assert.notEqual(second.id, first.id);
  assert.equal((await f.bridge.readShortcutCapture(second.id)).phase, 'listening');
  await f.bridge.cancelShortcutCapture(second.id);
});

test('reconnect invalidates an in-flight start and queues its cancellation before the new session sync', async () => {
  const f = captureBridge(); await f.bridge.useConnection(connection);
  const oldSession = f.bridge.session, gate = deferred(); let block = true;
  f.intercept(async (path, body) => {
    if (path === '/capture' && body.action === 'start' && block) { block = false; await gate.promise; }
  });
  const started = f.bridge.startShortcutCapture(); await flush();
  f.bridge.restoreConnection(connection); const sync = f.bridge.syncNow();
  gate.resolve(); assert.equal((await started).phase, 'cancelled'); await sync;
  const last = f.sent.slice(-2);
  assert.equal(last[0].body.action, 'cancel'); assert.equal(last[0].body.session, oldSession);
  assert.equal(last[1].path, '/sync'); assert.equal(last[1].body.session, f.bridge.session);
  assert.notEqual(f.bridge.session, oldSession);
  const next = await f.bridge.startShortcutCapture();
  assert.equal((await f.bridge.readShortcutCapture(next.id)).phase, 'listening');
  await f.bridge.cancelShortcutCapture(next.id);
});

test('capture read timeout shares one request, cancels the listener, and ignores its late response', async () => {
  const f = captureBridge({ readTimeoutMs: 10 }); await f.bridge.useConnection(connection);
  const started = await f.bridge.startShortcutCapture(), gate = deferred();
  f.intercept(path => path.startsWith('/capture?') ? gate.promise : undefined);
  const reading = f.bridge.readShortcutCapture(started.id);
  assert.strictEqual(f.bridge.readShortcutCapture(started.id), reading);
  await assert.rejects(reading, /timed out/); await flush();
  assert.equal(f.sent.filter(call => call.path.startsWith('/capture?')).length, 1);
  assert.equal(f.native().phase, 'cancelled');
  gate.resolve(response({ id: started.id, phase: 'ready', binding: { key: 'KeyK', ctrl: true, alt: true, shift: false } }));
  await flush();
  assert.deepEqual(await f.bridge.readShortcutCapture(started.id), { id: started.id, phase: 'cancelled', binding: null });
  f.intercept(null);
  const replacement = await f.bridge.startShortcutCapture(); await f.bridge.cancelShortcutCapture(replacement.id);
});

test('expired native capture clears its candidate and permits normal synchronization', async () => {
  const f = captureBridge(); await f.bridge.useConnection(connection);
  const capture = await f.bridge.startShortcutCapture(); f.phase('expired');
  assert.deepEqual(await f.bridge.readShortcutCapture(capture.id), { id: capture.id, phase: 'expired', binding: null });
  await f.bridge.syncNow(); assert.equal(f.sent.at(-1).body.suspended, false);
});

test('capture responses reject mismatched ids, malformed phases, and unsupported or unbounded bindings', async () => {
  const malformed = [
    { id: 'other-id' }, { phase: 'running' }, { phase: 'listening', binding: {} },
    { phase: 'ready', binding: null },
    { phase: 'pressed', binding: { key: 'F12', ctrl: false, alt: false, shift: false } },
    { phase: 'ready', binding: { key: 'MouseLeft', ctrl: false, alt: false, shift: false } },
    { phase: 'ready', binding: { key: 'x'.repeat(10000), ctrl: false, alt: false, shift: false } },
    { phase: 'ready', binding: { key: 'KeyA', ctrl: 'true', alt: false, shift: false } }
  ];
  for (const change of malformed) {
    const f = captureBridge(); await f.bridge.useConnection(connection);
    const capture = await f.bridge.startShortcutCapture();
    f.intercept(path => path.startsWith('/capture?') ? response({ ...capture, ...change }) : undefined);
    await assert.rejects(f.bridge.readShortcutCapture(capture.id), /invalid shortcut capture|unsupported shortcut/);
    await flush(); assert.equal(f.native().phase, 'cancelled');
  }
});

test('old helpers report an actionable capture update error without echoing server data', async () => {
  const f = captureBridge(); await f.bridge.useConnection(connection);
  f.intercept(path => path.startsWith('/capture') ? { ok: false, status: 404, json: async () => ({ error: connection.token }) } : undefined);
  await assert.rejects(f.bridge.startShortcutCapture(), error => {
    assert.equal(error.code, 'REFLEX_CAPTURE_UPDATE_REQUIRED');
    assert.match(error.message, /Update and restart the Reflex helper/);
    assert.equal(error.message.includes(connection.token), false);
    return true;
  });
  assert.equal((await f.bridge.cancelShortcutCapture()).phase, 'cancelled');
  await f.bridge.syncNow(); assert.equal(f.sent.at(-1).body.suspended, false);
  assert.equal(f.sent.filter(call => call.path === '/capture').length, 1, 'a missing start endpoint never armed a listener');
  f.bridge.stop(); await flush();
});

test('failed explicit cancellation rejects Save, retains suspension, and can be retried', async () => {
  const f = captureBridge(); await f.bridge.useConnection(connection);
  const capture = await f.bridge.startShortcutCapture(); let fail = true;
  f.intercept((path, body) => {
    if (path === '/capture' && body.action === 'cancel' && fail) { fail = false; return { ok: false, status: 500 }; }
  });
  await assert.rejects(f.bridge.cancelShortcutCapture(capture.id), /500/);
  await f.bridge.syncNow(); assert.equal(f.sent.at(-1).body.suspended, true);
  assert.equal((await f.bridge.readShortcutCapture(capture.id)).phase, 'cancelled', 'cancelled UI attempts cannot consume later candidates');
  assert.equal((await f.bridge.cancelShortcutCapture(capture.id)).phase, 'cancelled');
  await f.bridge.syncNow(); assert.equal(f.sent.at(-1).body.suspended, false);
  assert.equal(f.native().phase, 'cancelled');
});

test('invalid capture ids never become request paths or cancellation writes', async () => {
  const f = captureBridge(); await f.bridge.useConnection(connection);
  const capture = await f.bridge.startShortcutCapture(); const before = f.sent.length;
  for (const id of ['', '../../health', 'x'.repeat(129), {}, 123]) {
    await assert.rejects(f.bridge.readShortcutCapture(id), /Invalid shortcut capture/);
    await assert.rejects(f.bridge.cancelShortcutCapture(id), /Invalid shortcut capture/);
  }
  assert.equal(f.sent.length, before);
  await f.bridge.cancelShortcutCapture(capture.id);
});

test('Record again retries failed predecessor cancellation and never arms its replacement on another failure', async () => {
  const f = captureBridge(); await f.bridge.useConnection(connection);
  const first = await f.bridge.startShortcutCapture(); let failures = 2;
  f.intercept((path, body) => {
    if (path === '/capture' && body.action === 'cancel' && failures-- > 0) return { ok: false, status: 500 };
  });
  await assert.rejects(f.bridge.cancelShortcutCapture(first.id), /500/);
  await assert.rejects(f.bridge.startShortcutCapture(), /500/);
  assert.equal(f.sent.filter(call => call.path === '/capture' && call.body.action === 'start').length, 1);
  assert.equal(f.native().id, first.id); assert.equal(f.native().phase, 'listening');
  await f.bridge.syncNow(); assert.equal(f.sent.at(-1).body.suspended, true);
  const next = await f.bridge.startShortcutCapture();
  assert.notEqual(next.id, first.id); assert.equal(f.native().id, next.id);
  assert.deepEqual(f.sent.filter(call => call.path === '/capture').map(call => call.body.action),
    ['start', 'cancel', 'cancel', 'cancel', 'start']);
  await f.bridge.cancelShortcutCapture(next.id);
  await f.bridge.syncNow(); assert.equal(f.sent.at(-1).body.suspended, false);
});

test('a rejected start clears only its own suspension and does not enter a failed cancellation loop', async () => {
  for (const status of [400, 409]) {
    const f = captureBridge(); await f.bridge.useConnection(connection);
    f.intercept(path => path === '/capture' ? { ok: false, status } : undefined);
    await assert.rejects(f.bridge.startShortcutCapture(), /capture ended or changed|rejected shortcut capture/);
    assert.equal((await f.bridge.cancelShortcutCapture()).phase, 'cancelled');
    await f.bridge.syncNow(); assert.equal(f.sent.at(-1).body.suspended, false);
    assert.equal(f.sent.filter(call => call.path === '/capture').length, 1);
    f.intercept(null);
    const next = await f.bridge.startShortcutCapture(); await f.bridge.cancelShortcutCapture(next.id);
  }
});

test('cancel 404 and 409 are terminal because the requested listener is absent', async () => {
  for (const status of [404, 409]) {
    const f = captureBridge(); await f.bridge.useConnection(connection);
    const capture = await f.bridge.startShortcutCapture();
    f.intercept((path, body) => path === '/capture' && body.action === 'cancel' ? { ok: false, status } : undefined);
    assert.deepEqual(await f.bridge.cancelShortcutCapture(capture.id), { id: capture.id, phase: 'cancelled', binding: null });
    await f.bridge.syncNow(); assert.equal(f.sent.at(-1).body.suspended, false);
  }
});

test('read 409 clears a vanished capture without blocking the next recording', async () => {
  const f = captureBridge(); await f.bridge.useConnection(connection);
  const capture = await f.bridge.startShortcutCapture();
  f.intercept(path => path.startsWith('/capture?') ? { ok: false, status: 409 } : undefined);
  await assert.rejects(f.bridge.readShortcutCapture(capture.id), /capture ended or changed/);
  await f.bridge.syncNow(); assert.equal(f.sent.at(-1).body.suspended, false);
  f.intercept(null);
  const next = await f.bridge.startShortcutCapture(); await f.bridge.cancelShortcutCapture(next.id);
});

test('Escape followed by Save before the next poll cannot confirm the stale ready candidate', async () => {
  const f = captureBridge(); await f.bridge.useConnection(connection);
  const capture = await f.bridge.startShortcutCapture();
  const binding = { key: 'KeyA', ctrl: false, alt: false, shift: false };
  f.phase('ready', binding);
  assert.deepEqual((await f.bridge.readShortcutCapture(capture.id)).binding, binding);
  f.phase('cancelled');
  await assert.rejects(f.bridge.confirmShortcutCapture(capture.id), /capture ended or changed/);
  assert.equal(f.native().binding, null);
  assert.deepEqual(f.sent.filter(call => call.path === '/capture').map(call => call.body.action), ['start', 'confirm', 'cancel']);
  await f.bridge.syncNow(); assert.equal(f.sent.at(-1).body.suspended, false);
});

test('confirmation 409 while pressed cancels the listener before returning its failure', async () => {
  const f = captureBridge(); await f.bridge.useConnection(connection);
  const capture = await f.bridge.startShortcutCapture();
  f.phase('pressed', { key: 'MouseBack', ctrl: true, alt: false, shift: false });
  await assert.rejects(f.bridge.confirmShortcutCapture(capture.id), /capture ended or changed/);
  assert.equal(f.native().phase, 'cancelled');
  await f.bridge.syncNow(); assert.equal(f.sent.at(-1).body.suspended, false);
});

test('confirm returns only the helper-confirmed binding and sanitizes extra fields', async () => {
  const f = captureBridge(); await f.bridge.useConnection(connection);
  const capture = await f.bridge.startShortcutCapture();
  f.phase('ready', { key: 'MouseForward', ctrl: false, alt: true, shift: false, secret: connection.token });
  assert.deepEqual(await f.bridge.confirmShortcutCapture(capture.id), {
    id: capture.id, phase: 'confirmed', binding: { key: 'MouseForward', ctrl: false, alt: true, shift: false }
  });
});

test('an in-flight read cannot consume the native terminal state ahead of confirmation', async () => {
  const f = captureBridge(); await f.bridge.useConnection(connection);
  const capture = await f.bridge.startShortcutCapture(), readGate = deferred(), confirmGate = deferred();
  const binding = { key: 'KeyK', ctrl: true, alt: true, shift: false };
  f.phase('ready', binding);
  f.intercept((path, body) => path.startsWith('/capture?') ? readGate.promise
    : path === '/capture' && body.action === 'confirm' ? confirmGate.promise : undefined);
  const reading = f.bridge.readShortcutCapture(capture.id); await flush();
  const confirming = f.bridge.confirmShortcutCapture(capture.id); await flush();
  readGate.resolve(response({ id: capture.id, phase: 'cancelled', binding: null }));
  assert.equal((await reading).phase, 'cancelled');
  confirmGate.resolve(response({ id: capture.id, phase: 'confirmed', binding }));
  assert.deepEqual((await confirming).binding, binding);
});

test('a late confirmation cannot save a candidate after capture replacement', async () => {
  const f = captureBridge(); await f.bridge.useConnection(connection);
  const capture = await f.bridge.startShortcutCapture(), gate = deferred(); let block = true;
  f.phase('ready', { key: 'KeyA', ctrl: false, alt: false, shift: false });
  f.intercept(async (path, body) => {
    if (path === '/capture' && body.action === 'confirm' && block) { block = false; await gate.promise; }
  });
  const confirming = f.bridge.confirmShortcutCapture(capture.id);
  const rejected = assert.rejects(confirming, /capture ended or changed/); await flush();
  const replacing = f.bridge.startShortcutCapture(); await flush();
  gate.resolve(); await rejected; const next = await replacing;
  assert.notEqual(next.id, capture.id);
  assert.equal((await f.bridge.readShortcutCapture(next.id)).phase, 'listening');
  await f.bridge.cancelShortcutCapture(next.id);
});

test('malformed confirmation never exposes a candidate and performs native cancellation', async () => {
  for (const result of [
    { phase: 'ready', binding: { key: 'KeyA', ctrl: false, alt: false, shift: false } },
    { phase: 'confirmed', binding: null },
    { phase: 'confirmed', binding: { key: 'MouseLeft', ctrl: false, alt: false, shift: false } }
  ]) {
    const f = captureBridge(); await f.bridge.useConnection(connection);
    const capture = await f.bridge.startShortcutCapture();
    f.intercept((path, body) => path === '/capture' && body.action === 'confirm' ? response({ id: capture.id, ...result }) : undefined);
    await assert.rejects(f.bridge.confirmShortcutCapture(capture.id), /Release the recorded shortcut|unsupported shortcut/);
    assert.equal(f.native().phase, 'cancelled');
  }
});
