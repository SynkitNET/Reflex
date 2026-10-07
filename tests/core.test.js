const test = require('node:test'), assert = require('node:assert/strict');
const core = require('../core'), catalog = require('../catalog'), index = core.prepare(catalog);
test('specific filter names, abbreviations, typos, and aliases find executable commands', () => {
  for (const [query, id] of [['gaussian blur', 'filter.gaussian'], ['gausian blur', 'filter.gaussian'], ['gaussian blru', 'filter.gaussian'], ['cso', 'layer.smart'], ['clone', 'tool.clone'], ['empty', 'layer.new']]) {
    const results = core.search(index, query);
    assert.ok(results.some(item => item.id === id), query);
  }
  assert.equal(core.search(index, 'gaussian blur')[0].id, 'filter.gaussian');
});
test('exact match outranks frequently used and favorited partial matches', () => {
  const custom = core.prepare([{ id: 'a', title: 'Blur', category: 'Commands' }, { id: 'b', title: 'Blur background', category: 'Commands' }]);
  assert.equal(core.search(custom, 'blur', { favorites: ['b'], usage: { b: { count: 900 } } })[0].id, 'a');
});
test('filters do not return unrelated matches; multiword queries must match every token', () => {
  assert.equal(core.search(index, 'gaussian elephant').length, 0);
  assert.ok(core.search(index, '', { category: 'Tools' }).every(item => item.category === 'Tools'));
  assert.deepEqual(core.search(index, '', { onlyFavorites: true, favorites: [] }), []);
});
test('wheel sectors continue beyond the visible ring while the center cancels', () => {
  for (const size of [4, 8]) {
    for (let i = 0; i < size; i++) {
      const angle = i * Math.PI * 2 / size - Math.PI / 2;
      for (const distance of [100, 164, 300, 20000]) {
        assert.equal(core.wheelIndex(Math.cos(angle) * distance, Math.sin(angle) * distance, size, 56), i);
      }
    }
    assert.equal(core.wheelIndex(0, 0, size, 56), -1);
    assert.equal(core.wheelIndex(55.9, 0, size, 56), -1);
    assert.equal(core.wheelIndex(56, 0, size, 56), size / 4);

    assert.equal(core.wheelIndex(0, 0, size, 56), -1);
  }
});
test('saved wheels retain hidden slots when switching to four and back', () => {
  const state = core.defaults(); state.wheels[0].size = 4;
  const restored = core.cleanState(JSON.parse(JSON.stringify(state)));
  assert.equal(restored.wheels[0].slots[7], 'adjust.hue');
  assert.equal(restored.wheels[0].size, 4);
});

test('the default wheel resolves all eight requested commands without loaded Photoshop actions', () => {
  const wheel = core.defaults().wheels[0];
  assert.equal(wheel.size, 8);
  assert.deepEqual(wheel.slots.map(id => catalog.find(item => item.id === id)?.title), [
    'New layer', 'Levels', 'Delete', 'Missing ping', 'Invert colors', 'Invert selection', 'Fill', 'Hue / Saturation'
  ]);
  for (const id of wheel.slots) {
    const item = catalog.find(item => item.id === id);
    assert.equal(item.kind, 'command');
    assert.equal(core.unavailable(item, { documentId: 1, layerCount: 1 }), '');
    assert.ok(core.search(index, item.title).some(result => result.id === id));
  }
});

test('loading settings preserves custom action bindings instead of replacing them with new defaults', () => {
  const state = core.defaults();
  delete state.wheelPresetVersion;
  state.wheels[0].slots[2] = 'action:["Nexus Actions","Delete"]';
  state.wheels[0].slots[6] = 'action:["Nexus Actions","Fill"]';
  state.wheels.push({ id: 'custom', name: 'Custom', size: 4, slots: ['tool.remove', 'tool.brush', null, null, null, null, null, null] });
  state.activeWheel = 'custom';
  assert.deepEqual(core.cleanState(JSON.parse(JSON.stringify(state))), { ...state, wheelPresetVersion: 1 });
});

test('older stock wheels and the reported Remove variant upgrade without changing other saved settings', () => {
  for (const rightSlot of ['layer.duplicate', 'tool.remove', 'layer.delete']) {
    const saved = core.defaults(); delete saved.wheelPresetVersion;
    saved.accent = '#7de1bd'; saved.tintIcons = true;
    saved.shortcuts.wheel = { key: 'MouseBack', ctrl: false, alt: false, shift: false };
    saved.usage = { 'tool.brush': { count: 4, last: 123 } };
    saved.wheels[0].name = 'My wheel';
    saved.wheels[0].slots = ['layer.new', 'tool.brush', rightSlot, 'layer.smart', 'selection.deselect', 'layer.mask', 'history.undo', 'tool.move'];
    saved.wheels.push({ id: 'custom', name: 'Custom', size: 4, slots: ['history.redo', null, null, null, null, null, null, null] });
    const before = JSON.stringify(saved);
    const upgraded = core.cleanState(saved);
    assert.deepEqual(upgraded, { ...saved, wheelPresetVersion: 1, wheels: [
      { ...saved.wheels[0], slots: core.defaults().wheels[0].slots }, saved.wheels[1]
    ] });
    assert.equal(JSON.stringify(saved), before);
    assert.deepEqual(core.cleanState(upgraded), upgraded);
    upgraded.wheels[0].slots = saved.wheels[0].slots.slice();
    assert.deepEqual(core.cleanState(upgraded).wheels[0].slots, saved.wheels[0].slots);
  }
});

test('a partially updated starter wheel finishes upgrading instead of retaining old slots', () => {
  const slots = core.defaults().wheels[0].slots;
  for (let direction = 0; direction < 8; direction++) {
    const saved = core.defaults(); delete saved.wheelPresetVersion;
    saved.wheels[0].slots = ['layer.new', 'tool.brush', 'tool.remove', 'layer.smart', 'selection.deselect', 'layer.mask', 'history.undo', 'tool.move'];
    saved.wheels[0].slots[direction] = slots[direction];
    assert.deepEqual(core.cleanState(saved).wheels[0].slots, slots);
  }
});

test('the default upgrade leaves different custom layouts and four-direction wheels alone', () => {
  for (const change of ['custom-slot', 'four-directions', 'different-id']) {
    const saved = core.defaults(); delete saved.wheelPresetVersion;
    saved.wheels[0].slots = ['layer.new', 'tool.brush', 'tool.remove', 'layer.smart', 'selection.deselect', 'layer.mask', 'history.undo', 'tool.move'];
    if (change === 'custom-slot') saved.wheels[0].slots[1] = 'tool.healing';
    if (change === 'four-directions') saved.wheels[0].size = 4;
    if (change === 'different-id') saved.activeWheel = saved.wheels[0].id = 'custom';
    assert.deepEqual(core.cleanState(saved), { ...saved, wheelPresetVersion: 1 });
  }
});
test('corrupt and old settings recover to a valid wheel', () => {
  for (const raw of [null, {}, { version: 8 }, { version: 1, wheels: [], activeWheel: 'missing' }]) assert.equal(core.cleanState(raw).wheels.length, 1);
  const state = core.cleanState({ version: 1, favorites: [null, 5, 'a', 'a'], wheels: [{ id: 'ok', size: 99, slots: [5, 'a'] }], activeWheel: 'missing' });
  assert.deepEqual(state.favorites, ['a']); assert.equal(state.activeWheel, 'ok'); assert.equal(state.wheels[0].slots[0], null);
});
test('availability accounts for missing documents, selection, and closed items', () => {
  assert.ok(core.unavailable(catalog[0], {}));
  assert.ok(core.unavailable(catalog[1], { documentId: 1, layerCount: 0 }));
  assert.equal(core.unavailable(catalog[1], { documentId: 1, layerCount: 2 }), '');
  assert.ok(core.unavailable(null, {}));
});
test('large layer index returns bounded results with relevant exact match', () => {
  const large = core.prepare(Array.from({ length: 10000 }, (_, i) => ({ id: String(i), title: 'Artwork layer ' + i, category: 'Layers' })));
  const start = performance.now(); const result = core.search(large, 'artwork layer 9876'); const elapsed = performance.now() - start;
  assert.equal(result[0].id, '9876'); assert.ok(result.length <= 60);
  console.log('10,000-item search: ' + elapsed.toFixed(1) + ' ms (Node, not Photoshop).');
});

test('every catalog entry can be found by its complete name and every tool by name plus tool', () => {
  for (const item of catalog) {
    assert.ok(core.search(index, item.title).some(found => found.id === item.id), item.id);
    if (item.category === 'Tools') assert.ok(core.search(index, item.title + ' tool', { category: 'Tools' }).some(found => found.id === item.id), item.id);
  }
});

test('search preserves non-Latin names, emoji, accents and full-width input', () => {
  const items = core.prepare(['背景画像', '背景文字', 'Слой логотипа', 'طبقة الشعار', 'कला परत', 'Crème brûlée', '★', '🐈', 'Brush'].map((title, id) => ({ id, title })));
  for (const [query, expected] of [['背景画像', 0], ['背景文字', 1], ['логотипа', 2], ['الشعار', 3], ['कला', 4], ['creme brulee', 5], ['★', 6], ['🐈', 7], ['ＢＲＵＳＨ', 8]]) {
    assert.equal(core.search(items, query)[0]?.id, expected, query);
  }
  assert.deepEqual(core.search(items, '不存在'), []);
});

test('long names are not cut off before the distinguishing part of a query', () => {
  const prefix = 'long document name '.repeat(15);
  const items = core.prepare([{ id: 'a', title: prefix + 'alpha' }, { id: 'b', title: prefix + 'beta' }]);
  assert.deepEqual(core.search(items, prefix + 'beta').map(item => item.id), ['b']);
});

test('cancellation recognizes plain host values without classifying ordinary failures as cancelled', () => {
  for (const value of [-128, '-128', 8007, { errorCode: -128 }, { number: 8007 },
    'Error: User cancelled the operation', 'Error 8007: User cancelled the operation',
    [{ _obj: 'error', result: -128 }]]) assert.equal(core.isCancellation(value), true, JSON.stringify(value));
  for (const value of [undefined, null, false, -25922, { number: 9 }, new Error('Could not cancel command'),
    new Error('Photoshop could not run this command.'), 'Click Cancel to stop']) assert.equal(core.isCancellation(value), false);
  assert.equal(core.errorMessage('The layer is locked.'), 'The layer is locked.');
});
