(function () {
  'use strict';
  if (typeof require !== 'function') return;
  const uxp = require('uxp'), ps = require('photoshop');
  const core = require('./core.js'), catalog = require('./catalog.js'), shortcuts = require('./shortcuts.js');
  const hybrid = require('./manifest.json').manifestVersion >= 6;
  const createBridge = hybrid ? require('./native-bridge.js').createNativeBridge : require('./bridge.js').createBridge;
  const fs = uxp.storage.localFileSystem;
  const host = require('./host.js')(ps), storage = require('./storage.js')(fs, core), UI = require('./ui.js');
  let controller, initPromise, bridge, activeDialog = null, panelVisible = false, unsubscribe, refreshTimer, capturingShortcut = false;
  function scheduleRefresh() {
    if (!controller || host.isModal() || (!panelVisible && !activeDialog && !bridge?.getStatus().connected)) return;
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => { if (!host.isModal()) controller.refresh(); }, 180);
  }
  function availabilityChanged() { bridge?.notifyHostChange(); }
  function photoshopChanged(event) {
    if (event === 'modalStateChanged') availabilityChanged();
    if (!host.isModal()) scheduleRefresh();
  }
  async function saveConnection(value) {
    const folder = await fs.getDataFolder();
    const file = await folder.createFile('companion-connection.json', { overwrite: true });
    await file.write(JSON.stringify(value));
  }
  async function setShortcutCapture(value) {
    capturingShortcut = !!value;
    bridge?.markDirty();
    if (bridge?.getStatus().connected) await bridge.syncNow();
  }
  async function connectHelper() {
    try {
      await setShortcutCapture(true);
      const file = await fs.getFileForOpening({ types: ['json'], allowMultiple: false });
      if (!file) return;
      await bridge.useConnection(JSON.parse(await file.read()), true);
    } finally { await setShortcutCapture(false); }
  }
  async function init() {
    if (initPromise) return initPromise;
    initPromise = (async () => {
      const loaded = await storage.load();
      controller = UI.createController({ core, catalog, host, storage, shortcuts, theme: require('./theme.js'), state: loaded.state, showSearch, showWheel,
        nativeMode: hybrid, previewWheel: showWheel, showMissingPing: () => {
          if (!bridge?.showMissingPing || host.isModal() || activeDialog || capturingShortcut) throw new Error('Finish the current dialog and reload the latest Reflex plugin to use Missing ping.');
          return bridge.showMissingPing();
        }, onChange: () => bridge?.markDirty(), onAvailabilityChange: availabilityChanged,
        helperStatus: () => bridge ? bridge.getStatus() : { status: 'Helper not connected', connected: false },
        connectHelper, disconnectHelper: () => bridge?.disconnect(), setShortcutCapture,
        startShortcutCapture: () => bridge?.getStatus().connected ? bridge.startShortcutCapture() : null,
        readShortcutCapture: id => bridge.readShortcutCapture(id),
        confirmShortcutCapture: id => bridge.confirmShortcutCapture(id),
        cancelShortcutCapture: id => bridge?.cancelShortcutCapture(id)
      });
      controller.mountPanel(document.getElementById('panel'));
      await controller.refresh();
      bridge = createBridge({ loadAddon: () => require('reflex.uxpaddon'), fetch: (url, settings) => fetch(url, settings),
        snapshot: () => {
          const snapshot = controller.getBridgeSnapshot();
          const suspended = snapshot.suspended || host.isModal() || !!activeDialog || capturingShortcut;

          return Object.assign({}, snapshot, { context: suspended ? snapshot.context : host.context(), suspended });
        },
        execute: (id, documentId) => controller.execute(id, documentId),
        openSearch: () => showSearch().catch(error => controller.message(error.message, true)),
        onStatus: () => controller.refreshViews(), saveConnection
      });
      if (hybrid) await bridge.start();
      else try {
        const folder = await fs.getDataFolder();
        const file = await folder.getEntry('companion-connection.json');
        const saved = JSON.parse(await file.read());
        if (saved) bridge.restoreConnection(saved);
      } catch (_) {                                       }
      if (loaded.warning) controller.message(loaded.warning, true);
      try { unsubscribe = await host.subscribe(photoshopChanged); }
      catch (_) { controller.message('Automatic refresh is unavailable. Use Refresh after changing your document.', true); }
      return controller;
    })();
    return initPromise;
  }
  async function openDialog(kind) {
    const app = await init();
    if (activeDialog) return;
    const dialog = document.getElementById(kind + '-dialog'), root = document.getElementById(kind + '-root');
    activeDialog = dialog;
    availabilityChanged();
    let view, selected;
    try {
      await app.refresh();
      if (bridge?.getStatus().connected) await bridge.syncNow();
      view = kind === 'palette'
        ? app.mountSearch(root, { close: value => dialog.close(value), floating: true })
        : app.mountWheel(root, { close: value => dialog.close(value) });

      const promise = kind === 'palette'
        ? dialog.showModal({ title: 'Reflex search', titleVisibility: 'hide', lockDocumentFocus: true,
          isTransparent: false, resize: 'none', size: { width: 560, height: 392 } })
        : dialog.uxpShowModal({ title: 'Reflex wheel preview', resize: 'none', size: { width: 380, height: 425 } });
      setTimeout(() => view?.focus(), 40);
      selected = await promise;
    } catch (error) {
      if (error && error.message && !/cancel|dismiss|escape|closed/i.test(error.message)) app.message(error.message, true);
    } finally {
      activeDialog = null;
      availabilityChanged();
      view?.dispose();
      root.innerHTML = '';
    }
    if (selected && selected.id) await app.execute(selected.id, selected.documentId);
  }
  async function showSearch() { return openDialog('palette'); }
  async function showWheel() {
    const app = await init();
    try { await bridge.showWheel(); }
    catch (error) { app.message(error.message, true); }
  }
  uxp.entrypoints.setup({
    commands: { search: showSearch, wheel: showWheel },
    panels: { reflex: {
      async show() { panelVisible = true; const app = await init(); if (hybrid) await bridge.start(); await app.refresh(); },
      hide() { panelVisible = false; clearTimeout(refreshTimer); },
      async destroy() { panelVisible = false; clearTimeout(refreshTimer); bridge?.stop(); if (unsubscribe) await unsubscribe(); }
    } }
  });
  document.addEventListener('focus', () => { availabilityChanged(); scheduleRefresh(); }, true);
  init().catch(error => { document.getElementById('panel').textContent = 'Reflex could not start: ' + error.message; });
})();
