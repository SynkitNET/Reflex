const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const core = require('../core');
const root = path.resolve(__dirname, '..');

async function boot(savedSettings) {
  const files = new Map();
  if (savedSettings !== undefined) files.set('reflex.json', savedSettings);
  const writes = [], messages = [];
  const panel = { textContent: '' };
  let entrypoints, controllerOptions, mounted = false, snapshots = 0;
  const folder = {
    async getEntry(name) {
      if (!files.has(name)) throw new Error('Entry not found');
      return { read: async () => files.get(name) };
    },
    async createFile(name) {
      return { write: async value => { writes.push(name); files.set(name, value); } };
    }
  };
  const uxp = {
    storage: { localFileSystem: { getDataFolder: async () => folder } },
    entrypoints: { setup(value) { entrypoints = value; } }
  };
  const ps = {
    app: { documents: [], actionTree: [] },
    action: { addNotificationListener: async () => {}, removeNotificationListener: async () => {} }
  };
  const ui = { createController(options) {
    controllerOptions = options;
    return {
      mountPanel(target) { assert.equal(target, panel); mounted = true; },
      async refresh() { await options.host.snapshot(); snapshots++; },
      refreshViews() {},
      getBridgeSnapshot: () => ({ state: options.state, items: [], context: { documentId: null, layerCount: 0 }, suspended: false }),
      message(value, error) { messages.push({ value, error }); }
    };
  } };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'main.js'), 'utf8'), {
    require(name) {
      if (name === 'uxp') return uxp;
      if (name === 'photoshop') return ps;
      if (name === './ui.js') return ui;
      if (name === 'reflex.uxpaddon') return Promise.resolve({ call(method) { return method === 'health' ? { protocol: 1, platform: 'win32' } : true; } });
      return require(path.resolve(root, name));
    },
    document: { getElementById: () => panel, addEventListener() {} },
    setTimeout, clearTimeout,
    fetch() { throw new Error('Startup must not contact an unpaired helper'); }
  }, { filename: 'main.js' });
  await entrypoints.panels.reflex.show();
  assert.equal(mounted, true);
  assert.equal(panel.textContent, '');
  assert.ok(snapshots >= 1);
  assert.equal(controllerOptions.helperStatus().connected, true);
  assert.deepEqual(Object.keys(entrypoints.commands).sort(), ['search', 'wheel']);
  await entrypoints.panels.reflex.destroy();
  return { options: controllerOptions, files, writes, messages };
}

test('actual plugin startup mounts on first launch with no saved settings', async () => {
  const app = await boot();
  assert.deepEqual(app.options.state, core.defaults());
  assert.deepEqual(app.writes, []);
  await app.options.storage.save(app.options.state);
  assert.deepEqual(JSON.parse(app.files.get('reflex.json')), core.defaults());
});

test('actual plugin startup preserves saved wheels and shortcuts', async () => {
  const saved = core.defaults();
  saved.wheels[0].name = 'Retouch';
  saved.shortcuts.search = { key: 'F8', ctrl: false, alt: false, shift: false };
  const app = await boot(JSON.stringify(saved));
  assert.deepEqual(app.options.state, saved);
  assert.deepEqual(app.writes, []);
  assert.deepEqual(app.messages, []);
});

test('upgrading the installed Remove wheel shows the requested layout immediately and keeps later edits on reload', async () => {
  const saved = core.defaults(); delete saved.wheelPresetVersion;
  saved.wheels[0].name = 'My wheel';
  saved.wheels[0].slots = ['layer.new', 'tool.brush', 'tool.remove', 'layer.smart', 'selection.deselect', 'layer.mask', 'history.undo', 'tool.move'];
  const app = await boot(JSON.stringify(saved));
  assert.deepEqual(app.options.state.wheels[0].slots, core.defaults().wheels[0].slots);
  assert.equal(app.options.state.wheels[0].name, 'My wheel');
  assert.equal(app.options.state.activeWheel, 'everyday');
  assert.deepEqual(app.writes, []);
  app.options.state.wheels[0].slots = saved.wheels[0].slots;
  await app.options.storage.save(app.options.state);
  const reloaded = await boot(app.files.get('reflex.json'));
  assert.deepEqual(reloaded.options.state.wheels[0].slots, saved.wheels[0].slots);
});

test('actual plugin startup recovers malformed settings without overwriting them', async () => {
  const app = await boot('{broken settings');
  assert.deepEqual(app.options.state, core.defaults());
  assert.equal(app.files.get('reflex.json'), '{broken settings');
  assert.deepEqual(app.writes, []);
  assert.ok(app.messages.some(message => message.error && /Saved settings could not be read/.test(message.value)));
});
