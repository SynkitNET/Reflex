'use strict';
const core = require('./core.js');
const theme = require('./theme.js');
const shortcuts = require('./shortcuts.js');
function encodeBinding(binding, platform) {
  const value = shortcuts.clean(binding);
  if (!value) throw new Error('Invalid shortcut. Record it again.');
  if (value.meta && platform !== 'darwin') throw new Error('Command shortcuts require macOS. Record a Windows shortcut.');
  const key = { MouseMiddle: 4, MouseBack: 5, MouseForward: 6, Space: 32 }[value.key] ||
    (/^Key/.test(value.key) ? value.key.charCodeAt(3) : /^Digit/.test(value.key) ? value.key.charCodeAt(5) : 111 + Number(value.key.slice(1)));
  return { key, modifiers: (value.ctrl ? 1 : 0) | (value.alt ? 2 : 0) | (value.shift ? 4 : 0) | (value.meta ? 8 : 0) };
}
function decodeBinding(value) {
  if (!value || !Number.isInteger(value.key) || !Number.isInteger(value.modifiers) || value.modifiers < 0 || value.modifiers > 15)
    throw new Error('Invalid shortcut from native input. Record again.');
  const key = { 4: 'MouseMiddle', 5: 'MouseBack', 6: 'MouseForward', 32: 'Space' }[value.key] ||
    (value.key >= 65 && value.key <= 90 ? 'Key' + String.fromCharCode(value.key) :
      value.key >= 48 && value.key <= 57 ? 'Digit' + String.fromCharCode(value.key) : 'F' + (value.key - 111));
  const result = shortcuts.clean({ key, ctrl: !!(value.modifiers & 1), alt: !!(value.modifiers & 2),
    shift: !!(value.modifiers & 4), ...(value.modifiers & 8 ? { meta: true } : {}) });
  if (!result) throw new Error('Unsupported native shortcut. Record again.');
  return result;
}
function createNativeBridge(options) {
  const now = options.now || Date.now;
  const session = now().toString(36) + '-' + Math.random().toString(36).slice(2);
  let addon, platform, timer, heartbeat, stopped = true, connected = false, busy = false, captureId = null;
  let captureSequence = 0, epoch = 0, starting = null, status = 'Starting Reflex…';
  const seen = new Set();
  const report = (message, live) => { const changed = status !== message || connected !== !!live; status = message; connected = !!live; if (changed) options.onStatus?.({ status, connected }); };
  const call = (method, payload = {}) => addon.call(method, payload);
  function snapshot() {
    const value = options.snapshot();
    const state = core.cleanState(value.state), wheel = state.wheels.find(w => w.id === state.activeWheel) || state.wheels[0];
    const items = new Map(value.items.map(item => [item.id, item]));
    const colors = theme.palette(state.accent, state.accentStyle);
    return { session, document: value.context.documentId == null ? '' : String(value.context.documentId),
      suspended: !!value.suspended || busy || !!captureId,
      search: encodeBinding(state.shortcuts.search, platform), wheel: encodeBinding(state.shortcuts.wheel, platform),
      directions: wheel.size, accent: parseInt(colors.accent.slice(1), 16),
      hover: parseInt(colors.hover.slice(1), 16), iconAccent: parseInt((state.tintIcons ? colors.accent : '#dedede').slice(1), 16),
      typeface: ['neutral', 'humanist', 'clear'].indexOf(state.typeface),
      slots: Array.from({ length: 8 }, (_, i) => {
        const item = items.get(wheel.slots[i]), available = item && !core.unavailable(item, value.context);
        return { id: available ? item.id : '', title: item ? String(item.title).slice(0, 64) : 'Empty', icon: item?.icon || 'plus' };
      }) };
  }
  function syncNow() {
    if (!addon || stopped) return;
    try {
      const value = snapshot(); call('sync', value);
      const diagnostic = call('status');
      report(diagnostic?.error ? 'Wheel overlay: ' + diagnostic.error : value.suspended ? 'Shortcuts paused while Photoshop is busy' : 'Ready', true);
    }
    catch (error) { try { call('suspend'); } catch (_) {} report(error.message, false); throw error; }
  }
  async function tick() {
    if (stopped) return;
    if (!connected || busy) { schedule(); return; }
    const turn = epoch;
    let event;
    try {
      event = call('poll');
      if (!event?.sequence) return;
      const value = options.snapshot();
      const valid = !seen.has(event.sequence) && event.session === session && !value.suspended && !captureId &&
        event.document === (value.context.documentId == null ? '' : String(value.context.documentId)) &&
        Number.isFinite(event.age) && event.age >= 0 && event.age <= 2000;
      seen.add(event.sequence);
      if (seen.size > 256) seen.delete(seen.values().next().value);
      if (!valid) return;
      busy = true; syncNow();
      if (event.kind === 'search') await options.openSearch();
      else if (event.kind === 'command' && value.items.some(item => item.id === event.command && !core.unavailable(item, value.context)))
        await options.execute(event.command, value.context.documentId);
    } catch (error) { if (turn === epoch && !stopped) report(error.message, false); }
    finally {
      if (turn === epoch && !stopped) {
        if (event?.sequence) { try { call('ack', { sequence: event.sequence }); } catch (error) { report(error.message, false); } }
        busy = false;
        if (event?.sequence) { try { syncNow(); } catch (_) {} }
        schedule();
      }
    }
  }
  function schedule() { clearTimeout(timer); if (!stopped && options.automatic !== false) timer = setTimeout(tick, 16); }
  function pulse() {
    if (stopped) return;
    try { syncNow(); } catch (_) {}
    if (!stopped && options.automatic !== false) heartbeat = setTimeout(pulse, 500);
  }
  function start() {
    if (starting) return starting;
    if (!stopped) return Promise.resolve();
    const turn = ++epoch;
    const pending = (async () => {
      try {

        const loaded = await options.loadAddon();
        if (turn !== epoch) return;
        if (!loaded || typeof loaded.call !== 'function') throw new Error('The native component has no Reflex interface. Reload the matching .ccx.');
        addon = loaded;
        const health = call('health');
        if (health.protocol !== 1 || !['win32', 'darwin'].includes(health.platform)) throw new Error('Unsupported Reflex native component. Reinstall the matching .ccx.');
        platform = health.platform; stopped = false;
        syncNow(); schedule();
        if (options.automatic !== false) heartbeat = setTimeout(pulse, 500);
      } catch (error) {
        if (turn !== epoch) return;
        stop(); report('Reflex native component could not start: ' + error.message, false);
      }
    })();
    starting = pending;
    pending.finally(() => { if (starting === pending) starting = null; });
    return pending;
  }
  function stop() {
    stopped = true; connected = false; ++epoch; starting = null; busy = false; captureId = null;
    clearTimeout(timer); clearTimeout(heartbeat);
    if (addon) { try { call('stop'); } catch (_) {} }
  }
  function capture(action, id) {
    if (stopped || !connected) throw new Error('Reload Reflex before recording a shortcut.');
    if (!id || id !== captureId) throw new Error('Shortcut capture ended. Record again.');
    const result = call('capture', { action, id, session });
    if (result.id !== id || !['listening', 'pressed', 'ready', 'confirmed', 'cancelled', 'expired'].includes(result.phase))
      throw new Error('Invalid native capture response.');
    return { id, phase: result.phase, binding: result.binding ? decodeBinding(result.binding) : null };
  }
  return { start, stop, tick, syncNow, markDirty() { if (addon && !stopped) { try { syncNow(); } catch (_) {} } },
    async showWheel() {
      if (stopped || !connected) throw new Error('Reload Reflex before opening the wheel.');
      if (snapshot().suspended) throw new Error('Finish the current Photoshop dialog or command before opening the wheel.');
      syncNow();
      if (call('wheel') !== true) throw new Error('Reflex could not open the wheel overlay.');
    },
    async showMissingPing() {
      if (stopped || !connected) throw new Error('Reload Reflex before using Missing ping.');
      if (captureId) throw new Error('Finish recording the shortcut before using Missing ping.');
      if (call('ping') !== true) throw new Error('Reflex could not show Missing ping. Reload the latest plugin.');
    },
    notifyHostChange() { try { syncNow(); } catch (_) {} return Promise.resolve(); },
    getStatus: () => ({ connected, status, platform }),
    async startShortcutCapture() {
      if (captureId) await this.cancelShortcutCapture(captureId);
      captureId = 'capture-' + (++captureSequence);
      try { syncNow(); return capture('start', captureId); }
      catch (error) { captureId = null; try { syncNow(); } catch (_) {} throw error; }
    },
    async readShortcutCapture(id) { return capture('read', id); },
    async confirmShortcutCapture(id) {
      const result = capture('confirm', id);
      if (result.phase !== 'confirmed' || !result.binding) throw new Error('Release the shortcut before saving.');
      captureId = null; syncNow(); return result;
    },
    async cancelShortcutCapture(id) {
      if (!captureId) return { id, phase: 'cancelled', binding: null };
      const result = capture('cancel', id || captureId); captureId = null; syncNow(); return result;
    }
  };
}
module.exports = { createNativeBridge, encodeBinding, decodeBinding };
