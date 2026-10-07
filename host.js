(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = ps => factory(ps, require('./core.js'));
  else root.createReflexHost = ps => factory(ps, root.ReflexCore);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (ps, core) {
  'use strict';
  let running = false, modalDialog = false;
  const menuSession = Date.now().toString(36) + Math.random().toString(36).slice(2);
  function namedId(prefix, path) {
    const key = JSON.stringify(path);
    if (key.length < 180) return prefix + ':' + key;

    let a = 2166136261, b = 3335557771;
    for (let i = 0; i < key.length; i++) {
      a = Math.imul(a ^ key.charCodeAt(i), 16777619);
      b = Math.imul(b ^ key.charCodeAt(i), 2246822519);
    }
    return prefix + ':path:' + (a >>> 0).toString(16) + '-' + (b >>> 0).toString(16);
  }
  function isModal() { return running || modalDialog; }
  function actionIcon(name) {

    const rules = [
      [/\b(delete|remove|trash)\b/i, 'trash'], [/\b(fill|paint bucket)\b/i, 'fill'],
      [/\b(export|output)\b/i, 'export'], [/\bsave\b/i, 'save'],
      [/\b(blur|soften)\b/i, 'blur'], [/\b(noise|grain)\b/i, 'noise'],
      [/\b(sharpen|high pass)\b/i, 'highpass'], [/\b(curves?)\b/i, 'curve'],
      [/\blevels?\b/i, 'levels'], [/\b(hue|saturation|color|colour)\b/i, 'hue'],
      [/\bmask\b/i, 'mask'], [/\b(duplicate|copy)\b/i, 'copy'],
      [/\b(merge|flatten)\b/i, 'merge'], [/\b(transform|resize|scale)\b/i, 'transform']
    ];
    return rules.find(([pattern]) => pattern.test(String(name)))?.[1] || 'play';
  }
  function context() {
    try {
      const doc = ps.app.activeDocument;
      return { documentId: doc.id, documentName: doc.title, layerCount: doc.activeLayers.length };
    } catch (_) { return { documentId: null, documentName: 'No document open', layerCount: 0 }; }
  }
  function savedActions() {
    const records = [];
    Array.from(ps.app.actionTree).forEach((set, setIndex) => {
      Array.from(set.actions).forEach((action, actionIndex) => {
        const legacyId = namedId('action', [set.name, action.name]);
        const nativeIds = Number.isSafeInteger(set.id) && Number.isSafeInteger(action.id) ? { setId: set.id, actionId: action.id } : null;
        records.push({ set, action, setIndex, actionIndex, legacyId, nativeIds });
      });
    });
    return records;
  }
  async function photoshopMenus() {
    if (typeof ps.core?.performMenuCommand !== 'function' || typeof ps.core?.getMenuCommandState !== 'function') return { items: [], warning: 'This Photoshop version does not expose menu commands to Reflex.' };
    const response = await batch({ _obj: 'get', _target: [
      { _property: 'menuBarInfo' }, { _ref: 'application', _enum: 'ordinal', _value: 'targetEnum' }
    ] });
    const tree = response[0]?.menuBarInfo;
    if (!tree || !Array.isArray(tree.submenu)) throw new Error('Photoshop did not return its menu list.');
    const groups = new Map();
    const label = title => String(title || '').replace(/\t.*$/, '').replace(/&&|&/g, token => token === '&&' ? '&' : '').trim();
    const walk = (entries, parents, enabled) => {
      for (const entry of entries) {
        if (!entry || typeof entry.title !== 'string' || entry.visible === false || entry.hidden === true) continue;
        const title = label(entry.title);
        if (!title || /^[-–—]+$/.test(title)) continue;
        if (title === 'Reflex' && parents.length === 1 && /^(plugins|plug-ins)$/i.test(parents[0])) continue;
        const path = parents.concat(title), available = enabled && entry.enabled !== false;
        if (Array.isArray(entry.submenu) && entry.submenu.length) { walk(entry.submenu, path, available); continue; }
        if (!Number.isSafeInteger(entry.command) || entry.command === 0) continue;

        const key = JSON.stringify(path), id = namedId('menu', path);
        if (!groups.has(key)) groups.set(key, new Map());
        const group = groups.get(key);

        if (group.has(entry.command)) continue;
        const subtitle = parents.join(' › '), suggestedIcon = actionIcon(title);
        group.set(entry.command, { id, title, subtitle, menuPath: key, aliases: [path.join(' ')], category: 'Menus', kind: 'menu',
          icon: suggestedIcon === 'play' ? 'command' : suggestedIcon,
          commandId: entry.command, enabledHint: available, interactive: /(?:\.\.\.|…)$/.test(title) });
      }
    };
    walk(tree.submenu, [], true);
    const items = [], ids = new Set();
    for (const group of groups.values()) {
      let position = 0;
      for (const item of group.values()) {
        if (group.size > 1) {

          item.id += ':command:' + item.commandId + (item.commandId < 0 ? ':session:' + menuSession : '');
          item.subtitle += ' · Menu item ' + (++position);
        }
        if (ids.has(item.id)) throw new Error('Two menu paths share an identity. Refresh Photoshop before assigning these menus.');
        ids.add(item.id); items.push(item);
      }
    }
    return { items, warning: '' };
  }
  async function snapshot() {
    const ctx = context(), items = [], documents = Array.from(ps.app.documents);
    documents.forEach(doc => items.push({ id: 'document:' + doc.id, title: doc.title, subtitle: 'Open document', category: 'Documents', icon: 'file', kind: 'document', documentId: doc.id }));
    if (ctx.documentId) {
      const walk = (layers, path) => {
        for (const layer of layers) {
          items.push({ id: 'layer:' + ctx.documentId + ':' + layer.id, title: layer.name, subtitle: path || ctx.documentName, category: 'Layers', icon: layer.layers ? 'folder' : 'layers', kind: 'layer', layerId: layer.id, documentId: ctx.documentId });
          if (layer.layers && layer.layers.length) walk(layer.layers, path ? path + ' / ' + layer.name : layer.name);
        }
      };
      walk(ps.app.activeDocument.layers, '');
    }
    let actionError = '';
    try {
      const records = savedActions(), nameCounts = new Map(), idCounts = new Map();
      records.forEach(record => nameCounts.set(record.legacyId, (nameCounts.get(record.legacyId) || 0) + 1));
      records.forEach(record => {
        record.ambiguous = nameCounts.get(record.legacyId) > 1;
        record.id = !record.ambiguous ? record.legacyId : record.nativeIds
          ? record.legacyId + ':native:' + JSON.stringify([record.nativeIds.setId, record.nativeIds.actionId]) : null;
        if (record.id) idCounts.set(record.id, (idCounts.get(record.id) || 0) + 1);
      });
      let skipped = 0;
      for (const record of records) {
        if (!record.id || idCounts.get(record.id) !== 1) { skipped++; continue; }
        const { set, action, setIndex, actionIndex } = record;
        items.push({ id: record.id, title: action.name,
          subtitle: record.ambiguous ? set.name + ' · Set ' + (setIndex + 1) + ', action ' + (actionIndex + 1) : set.name,
          category: 'Actions', icon: actionIcon(action.name), kind: 'action', actionName: action.name, setName: set.name,
          ...(record.nativeIds || {}) });
      }
      if (skipped) actionError = skipped + (skipped === 1 ? ' saved action has' : ' saved actions have') + ' duplicate names without a distinct Photoshop ID and could not be indexed.';
    } catch (error) { actionError = 'Saved actions could not be read: ' + error.message; }
    let menuWarning = '';
    try { const menus = await photoshopMenus(); items.push(...menus.items); menuWarning = menus.warning; }
    catch (error) { menuWarning = 'Photoshop menus could not be read: ' + error.message; }
    return { context: ctx, items, warning: [actionError, menuWarning].filter(Boolean).join(' ') };
  }
  async function batch(descriptor, interactive) {
    const result = await ps.action.batchPlay([Object.assign({}, descriptor, { _options: { dialogOptions: interactive ? 'display' : 'dontDisplay' } })], {});
    if (!Array.isArray(result) || !result.length) throw new Error('Photoshop did not confirm this command.');
    const failed = result.find(r => r && String(r._obj).toLowerCase() === 'error');
    if (failed) throw Object.assign(new Error(failed.message || 'Photoshop could not complete this command.'),
      { result: failed.result, number: failed.number, code: failed.code, errorCode: failed.errorCode });
    return result;
  }
  async function run(item, expectedDocumentId) {
    const blocked = core.blockedReason(item);
    if (blocked) throw new Error(blocked);
    if (running) throw new Error('Another Reflex command is still running.');
    running = true;
    let executionContext, cancelled = false, commandFailed = false, commandError;
    try {
      let menuCommand;
      if (item.kind === 'menu') {
        const menus = await photoshopMenus();
        const current = menus.items.find(candidate => candidate.id === item.id);
        if (!current || (item.menuPath && current.menuPath !== item.menuPath)) throw new Error('That Photoshop menu command changed or is no longer available. Refresh and assign it again.');

        if (!await ps.core.getMenuCommandState({ commandID: current.commandId }))
          throw new Error('This command is unavailable in Photoshop right now. Check the active document, layer, or selection.');
        menuCommand = current.commandId;
      }
      await ps.core.executeAsModal(async modalContext => {
        executionContext = modalContext;

        if (modalContext) modalContext.onCancel = () => { cancelled = true; };
        try {
          const ctx = context();
          if (item.kind !== 'document' && expectedDocumentId !== undefined && ctx.documentId !== expectedDocumentId) throw new Error('The active document changed. Search again before running this command.');
          if (item.requires === 'document' && !ctx.documentId) throw new Error('Open a document first.');
          if (item.requires === 'layer' && !ctx.layerCount) throw new Error('Select a layer first.');
          if (item.kind === 'menu') {
            const completed = await ps.core.performMenuCommand({ commandID: menuCommand });
            if (completed !== true) throw new Error('Photoshop could not run this menu command.');
            return;
          }
          if (item.kind === 'document') {
            const doc = Array.from(ps.app.documents).find(d => d.id === item.documentId);
            if (!doc) throw new Error('That document has been closed.');
            ps.app.activeDocument = doc;
            return;
          }
          if (item.kind === 'layer') {
            if (ctx.documentId !== item.documentId) throw new Error('That layer belongs to another document.');
            await batch({ _obj: 'select', _target: [{ _ref: 'layer', _id: item.layerId }], makeVisible: false });
            return;
          }
          if (item.kind === 'action') {
            const records = savedActions();
            const hasNativeIds = Number.isSafeInteger(item.setId) && Number.isSafeInteger(item.actionId);

            if (!hasNativeIds && (item.setId != null || item.actionId != null)) throw new Error('That saved action has an invalid Photoshop ID. Search again.');
            const matches = records.filter(({ set, action }) => set.name === item.setName && action.name === item.actionName &&
              (!hasNativeIds || (set.id === item.setId && action.id === item.actionId)));
            if (!matches.length) throw new Error('That saved action changed or is no longer loaded. Search again.');
            if (matches.length !== 1) throw new Error('More than one saved action matches those names. Search again and choose the specific action.');
            await matches[0].action.play();
            return;
          }
          const op = item.operation;
          if (typeof op !== 'string') throw new Error('This command has no Photoshop operation. Refresh Reflex.');
          if (op.startsWith('tool:')) return batch({ _obj: 'select', _target: [{ _ref: op.slice(5) }] });
          const doc = ctx.documentId ? ps.app.activeDocument : null;
          const layers = doc ? Array.from(doc.activeLayers) : [];
          switch (op) {
            case 'newLayer': await doc.createLayer(); break;
            case 'duplicateLayer': await doc.duplicateLayers(layers); break;
            case 'deleteLayers':
              await batch({ _obj: 'delete', _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }], layerID: layers.map(layer => layer.id) }); break;
            case 'fill':
              await batch({ _obj: 'fill', using: { _enum: 'fillContents', _value: 'foregroundColor' } }); break;
            case 'toggleVisibility': {
              const visible = !layers.every(layer => layer.visible);
              layers.forEach(layer => { layer.visible = visible; });
              break;
            }
            case 'toggleLock': {
              const locked = !layers.every(layer => layer.allLocked);
              layers.forEach(layer => { layer.allLocked = locked; });
              break;
            }
            case 'selectAll': await batch({ _obj: 'set', _target: [{ _ref: 'channel', _property: 'selection' }], to: { _enum: 'ordinal', _value: 'allEnum' } }); break;
            case 'deselect': await batch({ _obj: 'set', _target: [{ _ref: 'channel', _property: 'selection' }], to: { _enum: 'ordinal', _value: 'none' } }); break;
            case 'reselect': await batch({ _obj: 'set', _target: [{ _ref: 'channel', _property: 'selection' }], to: { _enum: 'ordinal', _value: 'previous' } }); break;
            case 'addMask': await batch({ _obj: 'make', new: { _class: 'channel' }, at: { _ref: 'channel', _enum: 'channel', _value: 'mask' }, using: { _enum: 'userMaskEnabled', _value: 'revealAll' } }); break;
            case 'rasterizeLayer': await batch({ _obj: op, _target: [{ _ref: 'layer', _enum: 'ordinal', _value: 'targetEnum' }] }); break;
            case 'autoCutout': await batch({ _obj: op, sampleAllLayers: false }); break;
            case 'fitOnScreen': case 'actualPixels':
              await batch({ _obj: 'select', _target: [{ _ref: 'menuItemClass', _enum: 'menuItemType', _value: op }] }); break;

            case 'gaussianBlur': case 'highPass':
              await batch({ _obj: op, radius: { _unit: 'pixelsUnit', _value: 10 } }, true); break;
            case 'motionBlur':
              await batch({ _obj: op, angle: 0, distance: { _unit: 'pixelsUnit', _value: 10 } }, true); break;
            case 'addNoise':
              await batch({ _obj: op, distort: { _enum: 'distort', _value: 'uniformDistribution' },
                noise: { _unit: 'percentUnit', _value: 1 }, monochromatic: false }, true); break;
            case 'groupLayersEvent': case 'newPlacedLayer': case 'mergeLayersNew':
            case 'groupEvent': case 'ungroupEvent': case 'inverse':
            case 'undo': case 'redo': case 'curves': case 'levels':
            case 'hueSaturation': case 'invert': await batch({ _obj: op }, item.interactive); break;
            default: throw new Error('This Photoshop operation is not supported by Reflex.');
          }
        } catch (error) {
          commandFailed = true; commandError = error;
          cancelled = cancelled || core.isCancellation(error);
          throw error;
        } finally { cancelled = cancelled || !!modalContext?.isCancelled; }
      }, { commandName: item.title, interactive: item.interactive || item.kind === 'action' || item.kind === 'menu', timeOut: 1 });
      if (cancelled || executionContext?.isCancelled) throw Object.assign(new Error('Action cancelled.'), { code: 'REFLEX_CANCELLED' });
      if (commandFailed) throw commandError;
    } catch (error) {
      if (cancelled || executionContext?.isCancelled || core.isCancellation(error))
        throw Object.assign(new Error('Action cancelled.'), { code: 'REFLEX_CANCELLED' });
      throw commandFailed ? commandError : error;
    } finally { running = false; }
  }
  async function subscribe(callback) {
    const events = ['open', 'close', 'select', 'make', 'delete', 'set', 'move', 'duplicate', 'play', 'undo', 'redo', 'modalStateChanged'];
    const listener = (event, descriptor) => {
      if (event === 'modalStateChanged') {
        const state = descriptor?.state?._value || descriptor?.state;
        if (state === 'enter') modalDialog = true;
        else if (state === 'exit') modalDialog = false;
      }
      callback(event, descriptor);
    };
    await ps.action.addNotificationListener(events, listener);
    return async () => { await ps.action.removeNotificationListener(events, listener); modalDialog = false; };
  }
  return { context, snapshot, run, subscribe, isModal };
});
