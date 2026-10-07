const test = require('node:test'), assert = require('node:assert/strict');
const createHost = require('../host'), catalog = require('../catalog');
function setup() {
  let modal = false; const calls = [];
  const layer = { id: 5, name: 'Logo', visible: true, allLocked: false };
  const doc = { id: 1, title: 'Test.psd', activeLayers: [layer], layers: [layer], createLayer: async () => calls.push(['newLayer', modal]), duplicateLayers: async layers => calls.push(['duplicate', modal, layers.length]) };
  const ps = { app: { activeDocument: doc, documents: [doc], actionTree: [{ id: 40, name: 'My set', actions: [{ id: 41, name: 'My action', play: async () => calls.push(['action', modal]) }] }] }, core: { executeAsModal: async (fn, options) => { calls.push(['modal', options]); modal = true; try { return await fn(); } finally { modal = false; } } }, action: { batchPlay: async descriptors => { calls.push(['batch', modal, descriptors[0]]); return [{}]; } } };
  return { ps, doc, layer, calls, host: createHost(ps) };
}
test('snapshot includes nested layers, documents and saved actions', async () => {
  const f = setup(); f.doc.layers.push({ id: 6, name: 'Group', layers: [{ id: 7, name: 'Child' }] });
  const snap = await f.host.snapshot(); assert.equal(snap.items.length, 5);
  assert.equal(snap.items.find(i => i.layerId === 7).subtitle, 'Group');
  assert.ok(snap.items.find(i => i.kind === 'action'));
});
test('filter dispatch requests an interactive Photoshop dialog inside modal execution', async () => {
  const f = setup(); await f.host.run(catalog.find(c => c.id === 'filter.gaussian'), 1);
  const call = f.calls.find(c => c[0] === 'batch');
  assert.equal(call[1], true); assert.equal(call[2]._obj, 'gaussianBlur'); assert.equal(call[2]._options.dialogOptions, 'display');
  assert.equal(f.calls[0][1].interactive, true);
});

test('filter dialogs receive complete valid parameters and never apply before confirmation', async () => {

  const units = (value, unit, min, max) => {
    assert.equal(value?._unit, unit);
    assert.ok(Number.isFinite(value._value) && value._value >= min && value._value <= max);
  };
  for (const id of ['filter.gaussian', 'filter.highpass', 'filter.motion', 'filter.noise']) {
    const f = setup(); let calls = 0;
    f.ps.action.batchPlay = async descriptors => {
      calls++; assert.equal(descriptors.length, 1);
      const descriptor = descriptors[0];
      assert.equal(descriptor._options.dialogOptions, 'display');
      assert.equal(f.host.isModal(), true);
      switch (descriptor._obj) {
        case 'gaussianBlur': units(descriptor.radius, 'pixelsUnit', 0.1, 250); break;
        case 'highPass': units(descriptor.radius, 'pixelsUnit', 0.1, 1000); break;
        case 'motionBlur':
          assert.ok(Number.isInteger(descriptor.angle) && descriptor.angle >= -360 && descriptor.angle <= 360);
          units(descriptor.distance, 'pixelsUnit', 1, 999); break;
        case 'addNoise':
          units(descriptor.noise, 'percentUnit', 0.1, 400);
          assert.equal(descriptor.distort?._enum, 'distort');
          assert.ok(['uniformDistribution', 'gaussianDistribution'].includes(descriptor.distort._value));
          assert.equal(typeof descriptor.monochromatic, 'boolean'); break;
        default: assert.fail('Unexpected operation before the filter dialog');
      }
      return [{ _obj: 'error', result: -128, message: 'User cancelled' }];
    };
    await assert.rejects(f.host.run(catalog.find(item => item.id === id), 1), error => error.code === 'REFLEX_CANCELLED');
    assert.equal(calls, 1, 'cancellation must not retry or apply a filter silently');
    assert.equal(f.host.isModal(), false);
  }
});
test('stale document context is rejected before a mutation', async () => {
  const f = setup(); await assert.rejects(f.host.run(catalog[0], 9), /active document changed/);
  assert.equal(f.calls.filter(c => c[0] === 'newLayer').length, 0);
});
test('batchPlay error results propagate instead of reporting success', async () => {
  const f = setup(); f.ps.action.batchPlay = async () => [{ _obj: 'error', message: 'Not available' }];
  await assert.rejects(f.host.run(catalog.find(c => c.id === 'layer.smart'), 1), /Not available/);
  f.ps.action.batchPlay = async () => [{}]; await f.host.run(catalog[0], 1);
});

test('filter cancellation retains the host result code even with a generic or localized message', async () => {
  const core = require('../core'), item = catalog.find(c => c.id === 'filter.gaussian');
  for (const message of ['Photoshop could not run this command.', 'Opération annulée', '']) {
    const f = setup();
    f.ps.action.batchPlay = async () => [{ _obj: 'error', result: -128, message }];
    await assert.rejects(f.host.run(item, 1), error => error.code === 'REFLEX_CANCELLED' && error.message === 'Action cancelled.');
    assert.equal(f.host.isModal(), false);
    f.ps.action.batchPlay = async () => [{}]; await f.host.run(item, 1);
  }
  const f = setup();
  f.ps.action.batchPlay = async () => [{ _obj: 'error', result: -25922, message: 'Layer is unavailable.' }];
  await assert.rejects(f.host.run(item, 1), error => !core.isCancellation(error) && error.result === -25922);
});

test('thrown cancellation and modal cancellation both release command execution', async () => {
  const core = require('../core'), item = catalog.find(c => c.id === 'filter.gaussian');
  for (const error of [Object.assign(new Error('Generic host message'), { number: -128 }), 'user cancelled', new Error('The user cancelled the operation')]) {
    const f = setup(); f.ps.action.batchPlay = async () => { throw error; };
    await assert.rejects(f.host.run(item, 1), core.isCancellation);
    assert.equal(f.host.isModal(), false);
  }
  const f = setup(); let cancelled = false;
  f.ps.core.executeAsModal = async fn => fn({ get isCancelled() { return cancelled; } });
  f.ps.action.batchPlay = async () => { cancelled = true; return [{}]; };
  await assert.rejects(f.host.run(item, 1), core.isCancellation);
  assert.equal(f.host.isModal(), false);
});

test('cancellation survives modal teardown and empty outer rejections', async () => {
  for (const signal of ['callback', 'flag', 'inner-error', 'primitive']) {
    const f = setup(), ctx = { isCancelled: false };
    f.ps.core.executeAsModal = async fn => {
      try { await fn(ctx); } catch (_) { throw undefined; }
      finally { ctx.isCancelled = false; }
    };
    f.ps.action.batchPlay = async () => {
      if (signal === 'callback') ctx.onCancel();
      if (signal === 'flag') ctx.isCancelled = true;
      if (signal === 'inner-error') throw { result: -128 };
      if (signal === 'primitive') throw -128;
      throw undefined;
    };
    await assert.rejects(f.host.run(catalog.find(c => c.id === 'filter.gaussian'), 1), error => error.code === 'REFLEX_CANCELLED');
    assert.equal(f.host.isModal(), false);
  }
});

test('modal teardown preserves the original genuine error instead of losing its message', async () => {
  const f = setup(), failure = new Error('The layer is locked.');
  f.ps.core.executeAsModal = async fn => { try { await fn({ isCancelled: false }); } catch (_) { throw undefined; } };
  f.ps.action.batchPlay = async () => { throw failure; };
  await assert.rejects(f.host.run(catalog.find(c => c.id === 'filter.gaussian'), 1), error => error === failure);
});
test('saved action is resolved again at run time, including missing action handling', async () => {
  const f = setup(); const item = (await f.host.snapshot()).items.find(i => i.kind === 'action');
  await f.host.run(item, 1); assert.ok(f.calls.some(c => c[0] === 'action' && c[1]));
  f.ps.app.actionTree = []; await assert.rejects(f.host.run(item, 1), /no longer loaded/);
});
test('layer selection targets ID without changing visibility', async () => {
  const f = setup(); await f.host.run({ kind: 'layer', layerId: 5, documentId: 1, title: 'Logo' }, 1);
  const descriptor = f.calls.find(c => c[0] === 'batch')[2]; assert.equal(descriptor.makeVisible, false); assert.equal(descriptor._target[0]._id, 5);
});

function duplicateActionsFixture() {
  const f = setup(), played = [];
  const action = id => ({ id, name: 'Glow', play: async () => played.push(id) });
  f.ps.app.actionTree = [
    { id: 10, name: 'Synkit', actions: [action(11), action(12)] },
    { id: 20, name: 'Synkit', actions: [action(21)] },
    { id: 30, name: 'Other set', actions: [action(31)] }
  ];
  return { ...f, played };
}
test('unique action preserves its existing ID and subtitle while carrying native IDs', async () => {
  const f = setup(); const item = (await f.host.snapshot()).items.find(i => i.kind === 'action');
  assert.equal(item.id, 'action:["My set","My action"]');
  assert.equal(item.subtitle, 'My set'); assert.equal(item.setId, 40); assert.equal(item.actionId, 41);
});
test('duplicate action and set names produce distinct IDs and position subtitles', async () => {
  const f = duplicateActionsFixture(), snap = await f.host.snapshot();
  const actions = snap.items.filter(i => i.kind === 'action');
  assert.equal(actions.length, 4); assert.equal(new Set(snap.items.map(i => i.id)).size, snap.items.length);
  assert.match(snap.warning, /does not expose menu commands/);
  assert.deepEqual(actions.slice(0, 3).map(i => i.id), [
    'action:["Synkit","Glow"]:native:[10,11]',
    'action:["Synkit","Glow"]:native:[10,12]',
    'action:["Synkit","Glow"]:native:[20,21]'
  ]);
  assert.deepEqual(actions.slice(0, 3).map(i => i.subtitle), ['Synkit · Set 1, action 1', 'Synkit · Set 1, action 2', 'Synkit · Set 2, action 1']);
  assert.ok(actions.every(i => i.title === 'Glow'));
  assert.equal(actions[3].id, 'action:["Other set","Glow"]'); assert.equal(actions[3].subtitle, 'Other set');
  for (const item of actions) await f.host.run(item, 1);
  assert.deepEqual(f.played, [11, 12, 21, 31]);
});
test('duplicate action IDs remain tied to native identity after palette reordering', async () => {
  const f = duplicateActionsFixture(); const before = (await f.host.snapshot()).items.filter(i => i.kind === 'action');
  f.ps.app.actionTree.reverse(); f.ps.app.actionTree[2].actions.reverse();
  const after = (await f.host.snapshot()).items.filter(i => i.kind === 'action');
  for (const item of before) assert.equal(after.find(i => i.setId === item.setId && i.actionId === item.actionId).id, item.id);
  await f.host.run(before.find(i => i.actionId === 12), 1); assert.deepEqual(f.played, [12]);
});
test('deleted native action never falls back to another matching name', async () => {
  const f = duplicateActionsFixture(), item = (await f.host.snapshot()).items.find(i => i.actionId === 12);
  f.ps.app.actionTree[0].actions = f.ps.app.actionTree[0].actions.filter(action => action.id !== 12);
  await assert.rejects(f.host.run(item, 1), /changed or is no longer loaded/); assert.deepEqual(f.played, []);
});
test('reused action ID or set ID with different names is rejected', async () => {
  for (const changed of ['action', 'set']) {
    const f = duplicateActionsFixture(), item = (await f.host.snapshot()).items.find(i => i.actionId === 12);
    if (changed === 'action') f.ps.app.actionTree[0].actions[1].name = 'Different action';
    else f.ps.app.actionTree[0].name = 'Different set';
    await assert.rejects(f.host.run(item, 1), /changed or is no longer loaded/); assert.deepEqual(f.played, []);
  }
});
test('legacy name-only action runs only when exactly one match exists across all sets', async () => {
  const f = setup(), current = (await f.host.snapshot()).items.find(i => i.kind === 'action');
  const { setId, actionId, ...legacy } = current;
  await f.host.run(legacy, 1); assert.equal(f.calls.filter(c => c[0] === 'action').length, 1);
  f.ps.app.actionTree.push({ id: 50, name: 'My set', actions: [{ id: 51, name: 'My action', play: async () => f.calls.push(['wrong action']) }] });
  await assert.rejects(f.host.run(legacy, 1), /More than one saved action/);
  assert.equal(f.calls.filter(c => c[0] === 'action').length, 1); assert.equal(f.calls.filter(c => c[0] === 'wrong action').length, 0);
  const snap = await f.host.snapshot(); assert.ok(!snap.items.some(i => i.id === legacy.id));
});
test('duplicate legacy names inside one set are also rejected without playing', async () => {
  const f = duplicateActionsFixture(); f.ps.app.actionTree = [f.ps.app.actionTree[0]];
  await assert.rejects(f.host.run({ kind: 'action', title: 'Glow', setName: 'Synkit', actionName: 'Glow' }, 1), /More than one saved action/);
  assert.deepEqual(f.played, []);
});
test('actions missing native IDs are indexable only when their names are unique', async () => {
  const f = setup(); delete f.ps.app.actionTree[0].id; delete f.ps.app.actionTree[0].actions[0].id;
  const first = await f.host.snapshot(); assert.equal(first.items.filter(i => i.kind === 'action').length, 1);
  const item = first.items.find(i => i.kind === 'action'); await f.host.run(item, 1);
  f.ps.app.actionTree[0].actions.push({ name: 'My action', play: async () => f.calls.push(['wrong action']) });
  const duplicate = await f.host.snapshot(); assert.equal(duplicate.items.filter(i => i.kind === 'action').length, 0);
  assert.match(duplicate.warning, /2 saved actions have duplicate names/);
  await assert.rejects(f.host.run(item, 1), /More than one saved action/);
  assert.equal(f.calls.filter(c => c[0] === 'wrong action').length, 0);
});
test('colliding native identities are omitted and cannot execute ambiguously', async () => {
  const f = duplicateActionsFixture(); f.ps.app.actionTree = [f.ps.app.actionTree[0]];
  f.ps.app.actionTree[0].actions[1].id = 11;
  const snap = await f.host.snapshot(); assert.equal(snap.items.filter(i => i.kind === 'action').length, 0); assert.match(snap.warning, /2 saved actions/);
  await assert.rejects(f.host.run({ kind: 'action', title: 'Glow', setName: 'Synkit', actionName: 'Glow', setId: 10, actionId: 11 }, 1), /More than one saved action/);
  assert.deepEqual(f.played, []);
});

test('view commands select Photoshop menu items instead of sending nonexistent events', async () => {
  for (const [id, value] of [['view.fit', 'fitOnScreen'], ['view.actual', 'actualPixels']]) {
    const f = setup(); await f.host.run(catalog.find(item => item.id === id), 1);
    const call = f.calls.find(call => call[0] === 'batch');
    assert.equal(call[1], true); assert.equal(call[2]._obj, 'select');
    assert.deepEqual(call[2]._target, [{ _ref: 'menuItemClass', _enum: 'menuItemType', _value: value }]);
  }
});

test('Object Selection uses the Photoshop magicLassoTool reference', async () => {
  const f = setup(); await f.host.run(catalog.find(item => item.id === 'tool.object'), 1);
  assert.deepEqual(f.calls.find(call => call[0] === 'batch')[2]._target, [{ _ref: 'magicLassoTool' }]);
});

test('Reselect restores the previous selection channel instead of calling a nonexistent event', async () => {
  const f = setup(); await f.host.run(catalog.find(item => item.id === 'selection.reselect'), 1);
  const descriptor = f.calls.find(call => call[0] === 'batch')[2];
  assert.equal(descriptor._obj, 'set'); assert.deepEqual(descriptor._target, [{ _ref: 'channel', _property: 'selection' }]);
  assert.deepEqual(descriptor.to, { _enum: 'ordinal', _value: 'previous' });
});

test('every Photoshop catalog operation reaches a supported dispatch inside the modal guard', async () => {
  for (const item of catalog.filter(item => !item.id.startsWith('reflex.') && !require('../core').blockedReason(item))) {
    const f = setup(); await f.host.run(item, 1);
    assert.equal(f.calls[0][0], 'modal', item.id);
    assert.ok(f.calls.slice(1).every(call => call[1] === true), item.id);
    if (item.id === 'layer.visibility') assert.equal(f.layer.visible, false);
    else if (item.id === 'layer.lock') assert.equal(f.layer.allLocked, true);
    else assert.equal(f.calls.length, 2, item.id + ' dispatches once');
    assert.equal(f.host.isModal(), false, item.id);
  }
  const f = setup();
  await assert.rejects(f.host.run({ kind: 'command', title: 'Unknown', operation: 'unknown' }, 1), /not supported/);
  assert.ok(!f.calls.some(call => call[0] === 'batch'));
});

test('Remove is rejected before entering Photoshop, including legacy operation-only entries', async () => {
  for (const item of [catalog.find(item => item.id === 'tool.remove'), { id: 'tool.remove' }, { operation: 'tool:removeTool' }]) {
    const f = setup();
    await assert.rejects(f.host.run(item, 1), /Remove is temporarily disabled/);
    assert.deepEqual(f.calls, []);
    assert.equal(f.host.isModal(), false);
    await f.host.run(catalog.find(item => item.id === 'tool.healing'), 1);
    assert.equal(f.calls.find(call => call[0] === 'batch')[2]._target[0]._ref, 'spotHealingBrushTool');
  }
});

test('Delete targets the selected layers explicitly, including multiple selection, and never clears pixels', async () => {
  const f = setup(); f.doc.activeLayers.push({ id: 9 });
  await f.host.run(catalog.find(item => item.id === 'layer.delete'), 1);
  const descriptor = f.calls.find(call => call[0] === 'batch')[2];
  assert.equal(descriptor._obj, 'delete');
  assert.deepEqual(descriptor._target, [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }]);
  assert.deepEqual(descriptor.layerID, [5, 9]);
  assert.equal(descriptor._options.dialogOptions, 'dontDisplay');
});

test('Fill matches the recorded foreground-color action without changing its parameters or showing a dialog', async () => {
  const f = setup();
  await f.host.run(catalog.find(item => item.id === 'edit.fill'), 1);
  assert.deepEqual(f.calls.find(call => call[0] === 'batch')[2], {
    _obj: 'fill', using: { _enum: 'fillContents', _value: 'foregroundColor' }, _options: { dialogOptions: 'dontDisplay' }
  });
  assert.equal(f.calls[0][1].interactive, false);
  assert.equal(f.host.isModal(), false);
});

test('all document and layer commands reject missing context before dispatch', async () => {
  for (const item of catalog.filter(item => item.requires)) {
    const f = setup(); f.ps.app.activeDocument = null;
    await assert.rejects(f.host.run(item, null), /document first|layer first/, item.id);
    assert.equal(f.calls.length, 1, item.id);
  }
});

test('a document opened since a no-document search rejects the stale selection', async () => {
  const f = setup(); await assert.rejects(f.host.run(catalog.find(item => item.id === 'tool.brush'), null), /active document changed/);
  assert.ok(!f.calls.some(call => call[0] === 'batch'));
});

test('empty Photoshop replies cannot report success and leave the host ready to retry', async () => {
  for (const reply of [[], undefined, null]) {
    const f = setup(); f.ps.action.batchPlay = async () => reply;
    await assert.rejects(f.host.run(catalog.find(item => item.id === 'tool.brush'), 1), /did not confirm/);
    assert.equal(f.host.isModal(), false);
  }
});

test('long saved action names remain assignable and resolve to their exact native identity', async () => {
  const f = setup(); f.ps.app.actionTree[0].actions[0].name = 'A very long saved action '.repeat(30);
  const item = (await f.host.snapshot()).items.find(item => item.kind === 'action');
  assert.ok(item.id.length <= 250); await f.host.run(item, 1);
  assert.equal(f.calls.filter(call => call[0] === 'action').length, 1);
});
