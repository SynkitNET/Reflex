const test = require('node:test'), assert = require('node:assert/strict');
const shortcuts = require('../shortcuts'), core = require('../core');
test('shortcut capture supports layout-aware letters and the UXP key fallback', () => {
  assert.deepEqual(shortcuts.fromEvent({code:'KeyQ',key:'q',altKey:true}), {key:'KeyQ',alt:true,ctrl:false,shift:false});
  assert.equal(shortcuts.fromEvent({code:'KeyQ',key:'a'}).key, 'KeyA');
  assert.equal(shortcuts.fromEvent({code:'Digit1',key:'!',shiftKey:true}).key, 'Digit1');
  assert.equal(shortcuts.fromEvent({key:'F8',ctrlKey:true}).key, 'F8');
  assert.equal(shortcuts.fromEvent({key:'a',metaKey:true}), null);
  for(const key of ['Escape','Enter','Control','F12','F25','ArrowUp']) assert.equal(shortcuts.fromEvent({key}),null);
});
test('bindings persist and duplicate bindings recover to separate defaults', () => {
  const state=core.defaults(); state.shortcuts.wheel={key:'KeyQ',alt:true,ctrl:false,shift:false};
  assert.deepEqual(core.cleanState(JSON.parse(JSON.stringify(state))).shortcuts,state.shortcuts);
  state.shortcuts.search=state.shortcuts.wheel;
  assert.deepEqual(core.cleanState(state).shortcuts,shortcuts.defaults());
  assert.equal(shortcuts.label({key:'Space',ctrl:true,shift:true}),'Ctrl + Shift + Space');
});
test('mouse buttons capture modifiers, keep mouse/key namespaces separate, and exclude normal clicks and scrolling', () => {
  for (const [button, key] of [[1, 'MouseMiddle'], [3, 'MouseBack'], [4, 'MouseForward']]) {
    assert.deepEqual(shortcuts.fromMouseEvent({button, ctrlKey:true, shiftKey:true}), {key, ctrl:true, alt:false, shift:true});
    assert.equal(shortcuts.fromMouseEvent({button, metaKey:true}), null);
    assert.equal(shortcuts.fromEvent({key}), null);
  }
  for (const button of [0, 2, 5, -1, undefined]) assert.equal(shortcuts.fromMouseEvent({button}), null);
  for (const key of ['MouseLeft', 'MouseRight', 'Mouse6', 'WheelUp', 'WheelDown']) assert.equal(shortcuts.validKey(key), false);
  assert.equal(shortcuts.label({key:'MouseBack',alt:true}), 'Alt + Mouse 4 · Back');
});
test('mouse bindings survive persisted settings and retain duplicate protection', () => {
  const state = core.defaults();
  state.shortcuts.search = shortcuts.clean({key:'MouseForward'});
  state.shortcuts.wheel = shortcuts.clean({key:'MouseBack',ctrl:true});
  assert.deepEqual(core.cleanState(JSON.parse(JSON.stringify(state))).shortcuts, state.shortcuts);
  assert.equal(shortcuts.equal(state.shortcuts.wheel, shortcuts.clean({key:'MouseBack'})), false);
  state.shortcuts.search = state.shortcuts.wheel;
  assert.deepEqual(core.cleanState(state).shortcuts, shortcuts.defaults());
});
