'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const core = require('../core'), shortcuts = require('../shortcuts');

function setup(native = true, overrides = {}) {
  const timers = new Map(); let timerId = 0;
  const document = { activeElement: null };
  class Node {
    constructor(tag) {
      this.tagName = tag; this.children = []; this.attrs = {}; this.listeners = [];
      this.style = {}; this.className = ''; this._text = ''; this.scrollTop = 0;
      this.classList = {
        toggle: (name, yes) => { const list = new Set(this.className.split(' ').filter(Boolean)); (yes ? list.add(name) : list.delete(name)); this.className = [...list].join(' '); },
        add: name => this.classList.toggle(name, true), remove: name => this.classList.toggle(name, false)
      };
    }
    set textContent(value) { this._text = value; this.children = []; }
    get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
    set innerHTML(_) { this.children = []; this._text = ''; }
    appendChild(node) { node.parent = this; this.children.push(node); return node; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return this.attrs[key]; }
    removeAttribute(key) { delete this.attrs[key]; }
    addEventListener(type, fn, capture) { this.listeners.push({type, fn, capture:!!capture}); }
    removeEventListener(type, fn) { this.listeners = this.listeners.filter(item => item.type !== type || item.fn !== fn); }
    querySelectorAll(selector) { return this.descendants().filter(node => selector[0] === '.' && node.className.split(' ').includes(selector.slice(1))); }
    descendants() { return this.children.flatMap(child => [child, ...child.descendants()]); }
    contains(node) { return node === this || this.descendants().includes(node); }
    focus() { document.activeElement = this; }
  }
  document.createElement = tag => new Node(tag);
  const window = new Node('window'), root = new Node('root');
  const exported = { exports: {} };
  vm.runInNewContext(fs.readFileSync(require.resolve('../ui'), 'utf8'), {
    module: exported, document, window,
    setTimeout: (fn, delay) => { timers.set(++timerId, {fn, delay}); return timerId; },
    clearTimeout: id => timers.delete(id)
  });
  let candidate = {id:'capture-test-1',phase:'listening',binding:null}, saved = 0;
  const events = [], options = {
    core, shortcuts, catalog: [], state: core.defaults(), host:{snapshot:async()=>({items:[],context:{}})},
    storage:{save:async()=>{ saved++; }},
    setShortcutCapture: async value => { events.push(value ? 'suspend' : 'resume'); },
    ...(native ? {
      startShortcutCapture: async () => { events.push('start'); return {id:candidate.id,phase:'listening',binding:null}; },
      readShortcutCapture: async () => candidate,
      confirmShortcutCapture: async () => {
        events.push('confirm');
        if (candidate.phase !== 'ready') throw new Error('Capture ended. Record again.');
        return {...candidate,phase:'confirmed'};
      },
      cancelShortcutCapture: async () => { events.push('cancel'); }
    } : {}), ...overrides
  };
  const app = exported.exports.createController(options); app.mountPanel(root);
  async function fire(node, type, values = {}) {
    let stopped = false;
    const event = {target:node,defaultPrevented:false,preventDefault(){this.defaultPrevented=true;},stopPropagation(){stopped=true;},...values};
    const chain = []; for (let parent = node; parent; parent = parent.parent) chain.push(parent);
    for (const capture of [true, false]) {
      for (const target of capture ? [...chain].reverse() : chain) {
        for (const listener of [...target.listeners]) if (listener.type === type && listener.capture === capture) await listener.fn(event);
        if (stopped) break;
      }
      if (stopped) break;
    }
    await flush(); return event;
  }
  const find = label => root.descendants().find(node => node.getAttribute('aria-label') === label);
  async function flush() { for (let i=0;i<12;i++) await Promise.resolve(); }
  async function poll() {
    const entry = [...timers].find(([,value]) => value.delay === 100);
    assert.ok(entry, 'native polling is scheduled'); timers.delete(entry[0]); await entry[1].fn(); await flush();
  }
  return {app,events,root,document,find,fire,poll,flush,saved:()=>saved,setCandidate:value=>{candidate=value;},
    expireFeedback: async () => {
      const entry = [...timers].find(([, value]) => value.delay === 3000);
      assert.ok(entry); timers.delete(entry[0]); await entry[1].fn(); await flush();
    },
    open:async()=>{await fire(find('Shortcuts'),'click'); await fire(find('Change wheel shortcut'),'click');}};
}
const mouse = shortcuts.clean({key:'MouseBack'});

test('Pink replaces Thermal and Silver and survives reload and reset', async () => {
  const f = setup(true, { theme: require('../theme'), state: { ...core.defaults(), accent: '#00adf4', accentPreset: 'thermal' } });
  await f.fire(f.find('Settings'), 'click');
  assert.equal(f.find('Silver'), undefined); assert.equal(f.find('Thermal'), undefined);
  assert.equal(f.find('Pink').getAttribute('aria-pressed'), 'true');
  await f.fire(f.find('Mint'), 'click'); await f.fire(f.find('Pink'), 'click');
  assert.equal(f.app.getState().accent, '#f28fc8');
  const reloaded = setup(true, { theme: require('../theme'), state: JSON.parse(JSON.stringify(f.app.getState())) });
  await reloaded.fire(reloaded.find('Settings'), 'click');
  assert.equal(reloaded.find('Pink').getAttribute('aria-pressed'), 'true');
  await f.fire(f.find('Reset appearance'), 'click');
  assert.equal(f.app.getState().accent, '#e6e6e6');
});
test('native mouse recording requires release then explicit Save before changing settings', async () => {
  const f = setup(); const original = {...f.app.getState().shortcuts.wheel}; await f.open();
  f.setCandidate({id:'capture-test-1',phase:'pressed',binding:mouse}); await f.poll();
  await f.fire(f.find('Save'),'click');
  assert.deepEqual(f.app.getState().shortcuts.wheel,original); assert.equal(f.saved(),0);
  f.setCandidate({id:'capture-test-1',phase:'ready',binding:mouse}); await f.poll();
  assert.equal(f.saved(),0,'recording a button alone never saves');
  await f.fire(f.find('Save'),'click');
  assert.deepEqual(f.app.getState().shortcuts.wheel,mouse); assert.equal(f.saved(),1);
  assert.deepEqual(f.events,['suspend','start','confirm','resume']);
});
test('Escape and native cancellation discard the candidate without changing the old binding', async () => {
  for (const nativeCancel of [true,false]) {
    const f = setup(); const original = {...f.app.getState().shortcuts.wheel}; await f.open();
    f.setCandidate({id:'capture-test-1',phase:'ready',binding:mouse}); await f.poll();
    if (nativeCancel) { f.setCandidate({id:'capture-test-1',phase:'cancelled',binding:null}); await f.poll(); }
    else await f.fire(f.document.activeElement,'keydown',{key:'Escape'});
    assert.deepEqual(f.app.getState().shortcuts.wheel,original); assert.equal(f.saved(),0);
    assert.equal(f.events.at(-1),'resume');
  }
});
test('duplicate native bindings cannot be saved', async () => {
  const f = setup(); await f.open();
  f.setCandidate({id:'capture-test-1',phase:'ready',binding:f.app.getState().shortcuts.search}); await f.poll();
  assert.equal(f.find('Save').getAttribute('aria-disabled'),'true');
  await f.fire(f.find('Save'),'click'); assert.equal(f.saved(),0);
  await f.fire(f.find('Cancel'),'click');
});
test('native Escape or timeout between polling and Save cannot persist a stale candidate', async () => {
  for (const phase of ['cancelled','expired']) {
    const f = setup(); const original = {...f.app.getState().shortcuts.wheel}; await f.open();
    f.setCandidate({id:'capture-test-1',phase:'ready',binding:mouse}); await f.poll();
    f.setCandidate({id:'capture-test-1',phase,binding:null});
    await f.fire(f.find('Save'),'click');
    assert.deepEqual(f.app.getState().shortcuts.wheel,original); assert.equal(f.saved(),0);
    assert.equal(f.events.at(-1),'resume');
  }
});
test('browser fallback records mouse release and Enter confirms, without treating normal click as a binding', async () => {
  const f = setup(false); await f.open(); const target = f.document.activeElement;
  await f.fire(target,'mousedown',{button:0}); assert.equal(f.find('Save').getAttribute('aria-disabled'),'true');
  await f.fire(target,'mousedown',{button:3}); await f.fire(target,'mouseup',{button:3});
  assert.equal(f.saved(),0); await f.fire(target,'keydown',{key:'Enter'});
  assert.deepEqual(f.app.getState().shortcuts.wheel,mouse); assert.equal(f.saved(),1);
});
test('wheel assignment can browse past 80 Photoshop menus and assign a disabled command for later', async () => {
  const items = Array.from({ length: 95 }, (_, i) => ({ id: 'menu:' + JSON.stringify(['Image', 'Command ' + i]),
    title: 'Command ' + String(i).padStart(3, '0'), subtitle: 'Image', kind: 'menu', category: 'Menus', icon: 'command', enabled: false }));
  const f = setup(true, { host: { snapshot: async () => ({ items, context: {} }) } });
  await f.app.refresh(); await f.fire(f.find('Wheels'), 'click');
  await f.fire(f.root.querySelectorAll('.slot-card')[0], 'click');
  await f.fire(f.find('Menus'), 'click');
  assert.equal(f.root.querySelectorAll('.result').length, 80);
  await f.fire(f.find('Show more results'), 'click');
  const rows = f.root.querySelectorAll('.result'); assert.equal(rows.length, 95);
  assert.equal(rows[94].getAttribute('aria-disabled'), 'false');
  await f.fire(rows[94], 'click'); assert.equal(f.app.getState().wheels[0].slots[0], items[94].id);
  assert.equal(f.saved(), 1);
});

test('Missing ping can be found and assigned through the wheel editor', async () => {
  const f = setup(true, { catalog: require('../catalog') });
  await f.app.refresh(); await f.fire(f.find('Wheels'), 'click');
  await f.fire(f.root.querySelectorAll('.slot-card')[0], 'click');
  const input = f.find('Find a Photoshop command, tool or action'); input.value = 'enemy missing'; await f.fire(input, 'input');
  const rows = f.root.querySelectorAll('.result');
  assert.equal(rows.length, 1); assert.match(rows[0].textContent, /Missing ping/);
  await f.fire(rows[0], 'click');
  assert.equal(f.app.getState().wheels[0].slots[0], 'reflex.missing-ping'); assert.equal(f.saved(), 1);
});

test('floating search closes with Escape or its internal close button without running a command', async () => {
  const closed = [], f = setup(); f.app.mountSearch(f.root, { floating: true, close: value => closed.push(value) });
  const input = f.find('Search Photoshop'); input.value = 'brush'; await f.fire(input, 'input');
  await f.fire(input, 'keydown', { key: 'Escape', isComposing: true }); assert.equal(closed.length, 0);
  await f.fire(input, 'keydown', { key: 'Escape' }); assert.equal(closed.length, 1);
  await f.fire(f.find('Close search'), 'click'); assert.equal(closed.length, 2);
  await f.fire(f.find('Tools'), 'keydown', { key: 'Escape' }); assert.equal(closed.length, 3);
  assert.ok(closed.every(value => value === null)); assert.equal(f.saved(), 0);
});

test('keyboard navigation reaches results beyond the first page and closes with an exact document guard', async () => {
  const items = Array.from({ length: 95 }, (_, i) => ({ id: 'layer:7:' + i, title: 'Layer ' + String(i).padStart(3, '0'), category: 'Layers', kind: 'layer', documentId: 7 }));
  const closed = [], f = setup(true, { host: { snapshot: async () => ({ items, context: { documentId: 7 } }) } });
  await f.app.refresh(); f.app.mountSearch(f.root, { floating: true, close: value => closed.push(value) });
  const input = f.find('Search Photoshop');
  for (let i = 0; i < 94; i++) await f.fire(input, 'keydown', { key: 'ArrowDown' });
  assert.equal(f.root.querySelectorAll('.result').length, 95);
  await f.fire(input, 'keydown', { key: 'Enter', isComposing: true }); assert.equal(closed.length, 0);
  await f.fire(input, 'keydown', { key: 'Enter' });
  assert.equal(closed[0].id, items[94].id); assert.equal(closed[0].documentId, 7);
});

test('a recovered index clears its warning but keeps a genuine command error visible', async () => {
  let warning = 'Menus temporarily unavailable';
  const f = setup(true, { host: { snapshot: async () => ({ items: [], context: {}, warning }) } });
  await f.app.refresh(); assert.equal(f.root.querySelectorAll('.status')[0].textContent, warning);
  warning = ''; await f.app.refresh(); assert.equal(f.root.querySelectorAll('.status')[0].style.display, 'none');
  f.app.message('Photoshop could not run that filter', true); await f.app.refresh();
  assert.equal(f.root.querySelectorAll('.status')[0].textContent, 'Photoshop could not run that filter');
});

test('cancelled filters use a temporary footer notice with no banner and allow the next command', async () => {
  let failure = Object.assign(new Error('Photoshop could not run this command.'), { result: -128 });
  const f = setup(true, { catalog: require('../catalog'), host: {
    snapshot: async () => ({ items: [], context: { documentId: 7, layerCount: 1 } }),
    run: async () => { if (failure) throw failure; }
  } });
  await f.app.refresh();
  const cancelled = await f.app.execute('filter.gaussian', 7);
  assert.equal(cancelled.cancelled, true); assert.equal(cancelled.ok, false);
  const notice = f.root.querySelectorAll('.status')[0], feedback = f.root.querySelectorAll('.command-notice')[0];
  assert.equal(notice.style.display, 'none'); assert.equal(feedback.textContent, 'Action cancelled.');
  assert.equal(feedback.style.display, 'block'); assert.equal(f.saved(), 0);
  assert.equal(f.app.getState().usage['filter.gaussian'], undefined);
  assert.equal(f.app.getBridgeSnapshot().suspended, false);
  await f.expireFeedback(); assert.equal(feedback.style.display, 'none');
  assert.equal(f.root.querySelectorAll('.hints')[0].style.display, 'flex');
  failure = new Error('This layer is locked.'); await f.app.execute('filter.gaussian', 7);
  assert.equal(notice.textContent, failure.message); assert.ok(notice.className.split(' ').includes('error'));
  failure = null; const result = await f.app.execute('filter.gaussian', 7);
  assert.equal(result.ok, true); assert.equal(notice.style.display, 'none');
  assert.equal(f.app.getState().usage['filter.gaussian'].count, 1);
});

test('plain cancellation values and empty interactive rejections never create the red error banner', async () => {
  for (const error of [-128, 'Error: User cancelled the operation', undefined]) {
    const f = setup(true, { catalog: require('../catalog'), host: {
      snapshot: async () => ({ items: [], context: { documentId: 7, layerCount: 1 } }), run: async () => { throw error; }
    } });
    await f.app.refresh(); const result = await f.app.execute('filter.gaussian', 7);
    assert.equal(result.ok, false); assert.equal(f.saved(), 0);
    assert.equal(f.root.querySelectorAll('.status')[0].style.display, 'none');
    assert.equal(f.root.querySelectorAll('.command-notice')[0].textContent, error === undefined ? 'Action not completed.' : 'Action cancelled.');
  }
});

test('merged menu favorites remain starred and can be removed from the surviving result', async () => {
  const menu = { id: 'menu:gaussian', title: 'Gaussian Blur…', menuPath: JSON.stringify(['Filter', 'Blur', 'Gaussian Blur…']),
    commandId: 2400, kind: 'menu', category: 'Menus', aliases: ['Filter Blur Gaussian Blur'] };
  const state = core.defaults(); state.favorites = [menu.id];
  const f = setup(true, { catalog: require('../catalog'), state, host: {
    snapshot: async () => ({ items: [menu], context: { documentId: 7, layerCount: 1 } })
  } });
  await f.app.refresh(); const input = f.find('Search Photoshop'); input.value = 'gaus'; await f.fire(input, 'input');
  assert.equal(f.root.querySelectorAll('.result').length, 1);
  await f.fire(f.find('Remove favorite'), 'click');
  assert.equal(f.app.getState().favorites.length, 0); assert.ok(f.find('Add favorite'));
});

test('Remove stays searchable with a disabled explanation and never runs on click or Enter', async () => {
  let runs = 0;
  const f = setup(true, { catalog: require('../catalog'), host: {
    snapshot: async () => ({ items: [], context: { documentId: 7, layerCount: 1 } }), run: async () => { runs++; }
  } });
  await f.app.refresh();
  const input = f.find('Search Photoshop'); input.value = 'remove'; await f.fire(input, 'input');
  const row = f.root.querySelectorAll('.result')[0];
  assert.equal(row.getAttribute('aria-disabled'), 'true');
  assert.match(row.textContent, /Remove is temporarily disabled/);
  await f.fire(row, 'click'); await f.fire(input, 'keydown', { key: 'Enter' });
  assert.equal((await f.app.execute('tool.remove', 7)).ok, false);
  assert.equal(runs, 0);
  assert.equal(f.app.getState().usage['tool.remove'], undefined);
});

test('the reported crashing Remove tool cannot be assigned to another wheel slot', async () => {
  const f = setup(true, { catalog: require('../catalog') });
  await f.app.refresh(); await f.fire(f.find('Wheels'), 'click');
  await f.fire(f.root.querySelectorAll('.slot-card')[0], 'click');
  const input = f.find('Find a Photoshop command, tool or action'); input.value = 'remove'; await f.fire(input, 'input');
  assert.ok(f.root.querySelectorAll('.result-title').every(title => title.textContent !== 'Remove'));
  assert.equal(f.app.getState().wheels[0].slots[0], 'layer.new');
});

test('appearance controls save color, coverage, icon tint and typeface; reset preserves wheel assignments', async () => {
  const f = setup(); const before = JSON.stringify(f.app.getState().wheels);
  await f.fire(f.find('Settings'), 'click');
  await f.fire(f.find('Mint'), 'click'); await f.fire(f.find('Bold'), 'click');
  await f.fire(f.find('Tint icons'), 'click'); await f.fire(f.find('Verdana'), 'click');
  const state = core.cleanState(JSON.parse(JSON.stringify(f.app.getState())));
  assert.equal(state.accent, '#7de1bd'); assert.equal(state.accentStyle, 'bold'); assert.equal(state.tintIcons, true); assert.equal(state.typeface, 'clear');
  const input = f.find('Custom accent hex'); input.value = 'invalid'; await f.fire(f.find('Apply'), 'click');
  assert.equal(f.app.getState().accent, '#7de1bd'); assert.equal(input.getAttribute('aria-invalid'), 'true');
  await f.fire(f.find('Reset appearance'), 'click');
  assert.equal(f.app.getState().accent, '#e6e6e6'); assert.equal(f.app.getState().accentStyle, 'minimal'); assert.equal(f.app.getState().tintIcons, false);
  assert.equal(f.app.getState().typeface, 'humanist'); assert.equal(JSON.stringify(f.app.getState().wheels), before);
});
