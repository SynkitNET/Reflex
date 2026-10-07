'use strict';
const URL = 'http://localhost:47837';
const LEGACY_URL = 'http://127.0.0.1:47837';
const CLIENT_VERSION = require('./package.json').version;
const shortcuts = require('./shortcuts.js');
function validateConnection(raw) {
  if (!raw || raw.version !== 1 || (raw.url !== URL && raw.url !== LEGACY_URL) || !/^[a-f0-9]{64}$/i.test(raw.token || '')) throw new Error('Choose the connection.json file created by the Reflex helper.');
  return { version: 1, url: URL, token: raw.token };
}
function connectionError(error) {
  if (error && error.code === 'REFLEX_NETWORK_PERMISSION') return error;
  const message = error && error.message ? error.message : String(error || 'Reflex helper is unavailable.');
  if (/manifest entry not found|permission denied to (?:the )?url/i.test(message)) {
    const failure = new Error('Photoshop blocked the helper connection. Reflex’s local connection permission needs updating. ' + message);
    failure.code = 'REFLEX_NETWORK_PERMISSION';
    return failure;
  }
  return error instanceof Error ? error : new Error(message);
}
function createBridge(options) {
  const now = options.now || Date.now;
  let sessionSequence = 0;
  const newSession = () => now().toString(36) + '-' + (++sessionSequence).toString(36) + '-' + Math.random().toString(36).slice(2);
  let session = newSession();
  let connection = null, timer = null, heartbeatTimer = null, stopped = true, connected = false, epoch = 0;
  let pollOwner = null, urgentSync = null, executing = 0;
  const pollReads = new Set();
  let status = 'Helper not connected', lastSync = 0, dirty = true;
  let syncTail = Promise.resolve();
  let activeCapture = null, captureSequence = 0;
  const captureSuspensions = new Set();
  const readTimeoutMs = options.readTimeoutMs || 3000;
  const handled = new Map();
  function rotateSession() { session = newSession(); handled.clear(); }
  function report(text, live) {
    const changed = status !== text || connected !== !!live;
    status = text; connected = !!live;
    if (changed && options.onStatus) options.onStatus({ status, connected });
  }
  async function request(path, body, specificConnection) {
    const config = specificConnection || connection;
    if (!config) throw new Error('Connect the Reflex helper first.');
    const operation = (async () => {
      const response = await options.fetch(URL + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { Authorization: 'Bearer ' + config.token, 'Content-Type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (!response.ok) {

        if (path === '/ack' && response.status === 409) return { ok: false, expired: true };
        if (path === '/capture' || path.startsWith('/capture?')) {
          if (response.status === 404) {
            const error = new Error('Update and restart the Reflex helper to record keyboard and mouse shortcuts.');
            error.code = 'REFLEX_CAPTURE_UPDATE_REQUIRED';
            error.status = response.status;
            throw error;
          }
          if (response.status === 409 || response.status === 400) {
            const error = new Error(response.status === 409
              ? 'Shortcut capture ended or changed. Start shortcut capture again.'
              : 'The helper rejected shortcut capture. Update Reflex and its helper, then try again.');
            error.code = 'REFLEX_CAPTURE_REJECTED';
            error.status = response.status;
            throw error;
          }
        }
        if (response.status === 401) throw new Error('Pairing was rejected. Reconnect using the helper’s current connection.json file.');
        if (response.status === 403) throw new Error('The helper refused this connection. Update Reflex and its helper, then reconnect.');
        if (response.status === 400) {
          let reason = '';
          try { const detail = await response.json(); if (typeof detail?.error === 'string') reason = detail.error.slice(0, 400); } catch (_) {}
          throw new Error('Reflex helper rejected ' + path + ' (400)' + (reason ? ': ' + reason : '.'));
        }
        throw new Error('Reflex helper returned ' + response.status + '.');
      }
      const result = await response.json();

      if (path === '/poll') return Object.assign({}, result, {
        _eventDrivenPoll: response.headers?.get?.('X-Reflex-Poll-Mode') === 'event'
      });
      return result;
    })().catch(error => { throw connectionError(error); });

    if (body !== undefined) return operation;
    let timeout;
    try {
      return await Promise.race([operation, new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Reflex helper request timed out.')), readTimeoutMs);
      })]);
    } finally { clearTimeout(timeout); }
  }
  function current(currentEpoch, config) { return !stopped && epoch === currentEpoch && connection === config; }
  function queueSync(operation) {
    const result = syncTail.then(operation);

    syncTail = result.catch(() => {});
    return result;
  }
  function syncSnapshot(currentSession, suspended = false) {
    const snapshot = options.snapshot();
    return Object.assign({}, snapshot, { session: currentSession, clientVersion: CLIENT_VERSION,
      suspended: suspended || !!snapshot.suspended || executing > 0 || captureSuspensions.size > 0 });
  }
  function syncNow() {
    if (!connection || stopped) return Promise.resolve();
    const currentEpoch = epoch, config = connection;
    return queueSync(async () => {

      if (!current(currentEpoch, config)) return;
      dirty = false;
      try {
        await request('/sync', syncSnapshot(session), config);
        if (current(currentEpoch, config)) { lastSync = now(); report('Connected', true); }
      } catch (error) {
        if (current(currentEpoch, config)) dirty = true;
        throw error;
      }
    });
  }
  async function heartbeat() {
    const currentEpoch = epoch, config = connection;
    if (!current(currentEpoch, config) || !config) return;
    try {

      if (connected && (dirty || now() - lastSync >= 500)) await syncNow();
    } catch (error) {
      if (current(currentEpoch, config)) report(connectionError(error).message, false);
    } finally {
      if (current(currentEpoch, config) && options.automatic !== false) {
        heartbeatTimer = setTimeout(heartbeat, 500);
      }
    }
  }
  function startHeartbeat() {
    clearTimeout(heartbeatTimer);
    if (options.automatic !== false) heartbeatTimer = setTimeout(heartbeat, 500);
  }
  function notifyHostChange() {
    dirty = true;
    if (!connection || stopped) return Promise.resolve();
    const currentEpoch = epoch, config = connection;
    if (urgentSync && urgentSync.epoch === currentEpoch) return urgentSync.promise;
    const owner = { epoch: currentEpoch, promise: null };
    urgentSync = owner;
    owner.promise = syncNow().then(() => {
      if (!current(currentEpoch, config)) return;

      if (pollOwner?.epoch === currentEpoch && pollOwner.phase === 'reading' &&
          now() - pollOwner.startedAt >= 500 && pollReads.size < 2) pollOwner = null;

      if (options.automatic !== false && pollOwner?.epoch !== currentEpoch) {
        clearTimeout(timer); timer = setTimeout(tick, 0);
      }
    }).catch(error => {
      if (current(currentEpoch, config)) report(connectionError(error).message, false);
    }).finally(() => {
      if (urgentSync === owner) {
        urgentSync = null;

        if (dirty && connected && current(currentEpoch, config)) notifyHostChange();
      }
    });
    return owner.promise;
  }
  const validCaptureId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(id);
  const cancelledCapture = id => ({ id, phase: 'cancelled', binding: null });
  function captureCurrent(capture) {
    return activeCapture === capture && !capture.cancelled && current(capture.epoch, capture.config) && session === capture.session;
  }
  function captureResult(value, id, confirming = false) {
    const phases = ['listening', 'pressed', 'ready', 'cancelled', 'expired'];
    if (confirming) phases.push('confirmed');
    if (!value || value.id !== id || !phases.includes(value.phase)) {
      throw new Error('The helper returned an invalid shortcut capture. Update Reflex and its helper, then try again.');
    }
    const candidate = value.phase === 'pressed' || value.phase === 'ready' || value.phase === 'confirmed';
    let binding = null;
    if (candidate) {
      const raw = value.binding;
      if (raw && typeof raw.key === 'string' && raw.key.length <= 32 &&
          ['ctrl', 'alt', 'shift'].every(key => typeof raw[key] === 'boolean')) binding = shortcuts.clean(raw);
      if (!binding) throw new Error('The helper returned an unsupported shortcut. Record a keyboard key or middle, back, or forward mouse button.');
    } else if (value.binding !== null) {
      throw new Error('The helper returned an invalid shortcut capture. Update Reflex and its helper, then try again.');
    }
    return { id, phase: value.phase, binding };
  }
  function cancelNativeCapture(capture) {
    if (capture.cancellation) return capture.cancellation;
    capture.cancellation = queueSync(async () => {
      let failed = false;
      try {
        if (!capture.sentStart) {
          if (activeCapture === capture) activeCapture = null;
          return cancelledCapture(capture.id);
        }
        const result = await request('/capture', { action: 'cancel', id: capture.id, session: capture.session }, capture.config);
        if (!current(capture.epoch, capture.config)) return cancelledCapture(capture.id);
        const cancelled = captureResult(result, capture.id);
        if (cancelled.phase !== 'cancelled' && cancelled.phase !== 'expired') throw new Error('The helper has not stopped shortcut capture. Try cancelling again.');
        if (activeCapture === capture) activeCapture = null;
        return cancelled;
      } catch (error) {
        if (!current(capture.epoch, capture.config) || error.status === 404 || error.status === 409) return cancelledCapture(capture.id);
        failed = true;
        throw error;
      } finally {

        if (failed) capture.cancellation = null;
        else {
          captureSuspensions.delete(capture);
          if (activeCapture === capture) activeCapture = null;
        }
      }
    });
    return capture.cancellation;
  }
  function cancelShortcutCapture(id) {
    if (id !== undefined && !validCaptureId(id)) return Promise.reject(new Error('Invalid shortcut capture. Start shortcut capture again.'));
    const capture = activeCapture || [...captureSuspensions].reverse().find(value =>
      current(value.epoch, value.config) && (id === undefined || value.id === id));
    if (!capture || (id !== undefined && capture.id !== id)) return Promise.resolve(cancelledCapture(id || null));

    capture.cancelled = true;
    return cancelNativeCapture(capture);
  }
  function startShortcutCapture() {
    if (!connected || stopped || !connection) return Promise.reject(new Error('Start and connect the Reflex helper in Shortcuts first.'));

    const predecessors = [...captureSuspensions];
    for (const previous of predecessors) previous.cancelled = true;
    const predecessorResult = Promise.all(predecessors.map(cancelNativeCapture)).then(() => null, error => error);
    const capture = { id: 'capture-' + now().toString(36) + '-' + (++captureSequence).toString(36) + '-' + Math.random().toString(36).slice(2),
      epoch, config: connection, session, sentStart: false, cancelled: false, read: null, cancellation: null, confirmation: null };
    activeCapture = capture;
    captureSuspensions.add(capture);
    capture.start = queueSync(async () => {
      if (!captureCurrent(capture)) return cancelledCapture(capture.id);
      const predecessorError = await predecessorResult;
      if (!captureCurrent(capture)) return cancelledCapture(capture.id);
      if (predecessorError) {
        activeCapture = null; captureSuspensions.delete(capture);
        throw predecessorError;
      }
      try {

        await request('/sync', syncSnapshot(capture.session, true), capture.config);
        if (!captureCurrent(capture)) return cancelledCapture(capture.id);
        lastSync = now();
        capture.sentStart = true;
        const result = await request('/capture', { action: 'start', id: capture.id, session: capture.session }, capture.config);
        if (!captureCurrent(capture)) return cancelledCapture(capture.id);
        const value = captureResult(result, capture.id);
        if (value.phase === 'cancelled' || value.phase === 'expired') { activeCapture = null; captureSuspensions.delete(capture); }
        return value;
      } catch (error) {
        if (!captureCurrent(capture)) return cancelledCapture(capture.id);
        if (error.code === 'REFLEX_CAPTURE_UPDATE_REQUIRED' || error.code === 'REFLEX_CAPTURE_REJECTED') {

          activeCapture = null; captureSuspensions.delete(capture);
          throw error;
        }
        capture.cancelled = true;
        cancelNativeCapture(capture).catch(() => {});
        throw error;
      }
    });
    return capture.start;
  }
  function readShortcutCapture(id) {
    if (!validCaptureId(id)) return Promise.reject(new Error('Invalid shortcut capture. Start shortcut capture again.'));
    const capture = activeCapture;
    if (!capture || capture.id !== id || !captureCurrent(capture)) return Promise.resolve(cancelledCapture(id));
    if (capture.confirmation) return Promise.resolve(cancelledCapture(id));

    if (capture.read) return capture.read;
    capture.read = (async () => {
      try {
        await capture.start;
        if (!captureCurrent(capture) || capture.confirmation) return cancelledCapture(id);
        const result = await request('/capture?session=' + encodeURIComponent(capture.session) + '&id=' + encodeURIComponent(id), undefined, capture.config);
        if (!captureCurrent(capture) || capture.confirmation) return cancelledCapture(id);
        const value = captureResult(result, id);
        if (value.phase === 'cancelled' || value.phase === 'expired') { activeCapture = null; captureSuspensions.delete(capture); }
        return value;
      } catch (error) {
        if (!captureCurrent(capture) || capture.confirmation) return cancelledCapture(id);
        if (error.status === 404 || error.status === 409) {
          activeCapture = null; captureSuspensions.delete(capture);
          throw error;
        }
        capture.cancelled = true;
        cancelNativeCapture(capture).catch(() => {});
        throw error;
      } finally { capture.read = null; }
    })();
    return capture.read;
  }
  function confirmShortcutCapture(id) {
    if (!validCaptureId(id)) return Promise.reject(new Error('Invalid shortcut capture. Start shortcut capture again.'));
    const capture = activeCapture;
    if (!capture || capture.id !== id || !captureCurrent(capture)) {
      return Promise.reject(new Error('Shortcut capture ended or changed. Start shortcut capture again.'));
    }
    if (capture.confirmation) return capture.confirmation;
    capture.confirmation = queueSync(async () => {
      if (!captureCurrent(capture)) throw new Error('Shortcut capture ended or changed. Start shortcut capture again.');
      const result = await request('/capture', { action: 'confirm', id, session: capture.session }, capture.config);
      if (!captureCurrent(capture)) throw new Error('Shortcut capture ended or changed. Start shortcut capture again.');
      const confirmed = captureResult(result, id, true);
      if (confirmed.phase !== 'confirmed') throw new Error('Release the recorded shortcut before saving it.');
      activeCapture = null; captureSuspensions.delete(capture);
      return confirmed;
    }).catch(async error => {
      if (captureCurrent(capture)) {
        capture.cancelled = true;

        try { await cancelNativeCapture(capture); } catch (_) {                                                 }
      }
      throw error;
    });
    return capture.confirmation;
  }
  async function handle(message) {
    if (!message || typeof message.id !== 'string' || message.id.length > 150) return;
    if (handled.has(message.id)) return handled.get(message.id);
    const receivedAt = now();
    const handleEpoch = epoch;
    const ack = { requestId: message.id, ok: false, error: '', executionMs: 0,
      receivedRemainingMs: Number.isFinite(message.expiresAt) ? Math.max(-5000, Math.min(5000, Math.round(message.expiresAt - receivedAt))) : null };

    handled.set(message.id, ack);
    if (handled.size > 512) handled.delete(handled.keys().next().value);
    try {
      if (message.session !== session) throw new Error('Discarded a request from an old Reflex session.');
      if (!Number.isFinite(message.expiresAt) || message.expiresAt < now() || message.expiresAt > now() + 5000) throw new Error('That shortcut request expired. Press it again.');
      const snapshot = options.snapshot();
      if (snapshot.suspended) throw new Error('Finish the current Reflex interaction first.');
      if (message.kind === 'search') {
        options.openSearch();
      } else if (message.kind === 'execute') {
        if (typeof message.commandId !== 'string' || !snapshot.items.some(item => item.id === message.commandId)) throw new Error('This command is no longer available.');
        if (message.documentId !== snapshot.context.documentId) throw new Error('The document changed. Open the wheel again.');
        executing++;
        try {

          await syncNow();
          if (message.session !== session || handleEpoch !== epoch) throw new Error('Reflex connection changed before command execution.');
          if (message.expiresAt < now()) throw new Error('That shortcut request expired. Press it again.');
          const latest = options.snapshot();
          if (latest.suspended || captureSuspensions.size > 0) throw new Error('Finish the current Photoshop interaction first.');
          if (message.documentId !== latest.context.documentId) throw new Error('The document changed. Open the wheel again.');
          const result = await options.execute(message.commandId, message.documentId);
          if (result && result.ok === false) throw new Error(result.error || 'Photoshop could not run this command.');
        } finally {
          executing--;

          await syncNow();
        }
      } else throw new Error('Unknown shortcut request.');
      ack.ok = true;
    } catch (error) { ack.error = error.message || 'The shortcut could not run.'; }
    ack.executionMs = Math.max(0, Math.min(3600000, Math.round(now() - receivedAt)));
    return ack;
  }
  async function tick() {
    if (stopped || !connection) return;
    const currentEpoch = epoch, config = connection;
    if (pollOwner?.epoch === currentEpoch) return;
    const owner = { epoch: currentEpoch, phase: 'syncing', startedAt: now() };
    pollOwner = owner;
    let nextPollDelay = 100;
    try {
      if (dirty || now() - lastSync >= 500) await syncNow();
      if (!current(currentEpoch, config)) return;
      owner.phase = 'reading'; owner.startedAt = now(); pollReads.add(owner);
      let result;
      try { result = await request('/poll', undefined, config); }
      finally { pollReads.delete(owner); }
      if (!current(currentEpoch, config) || pollOwner !== owner) return;
      owner.phase = 'handling';
      if (result._eventDrivenPoll) nextPollDelay = 0;
      if (result.request) {
        const ack = await handle(result.request);
        if (ack && current(currentEpoch, config)) await request('/ack', ack, config);
      }
      if (current(currentEpoch, config)) report(result.request ? 'Connected' : result.status || 'Connected', true);
    } catch (error) {
      if (current(currentEpoch, config) && pollOwner === owner) report(connectionError(error).message, false);
    } finally {
      if (pollOwner === owner) {
        pollOwner = null;
        if (current(currentEpoch, config) && options.automatic !== false) timer = setTimeout(tick, connected ? nextPollDelay : 2000);
      }
    }
  }
  async function useConnection(raw, persist) {
    const verified = validateConnection(raw), healthEpoch = epoch;
    try { await request('/health', undefined, verified); }
    catch (error) {
      if (epoch === healthEpoch) report(connectionError(error).message, false);
      throw error;
    }
    if (epoch !== healthEpoch) return;
    stop(); rotateSession(); connection = verified; stopped = false; dirty = true;
    const currentEpoch = epoch;
    try {
      if (persist && options.saveConnection) await options.saveConnection(verified);
      if (!current(currentEpoch, verified)) return;
      await syncNow();
    } catch (error) {
      if (current(currentEpoch, verified)) report(connectionError(error).message, false);
      throw error;
    } finally {

      if (current(currentEpoch, verified)) {
        startHeartbeat();
        if (options.automatic !== false) timer = setTimeout(tick, connected ? 0 : 2000);
      }
    }
  }
  function restoreConnection(raw) {
    const verified = validateConnection(raw);
    stop(); rotateSession(); connection = verified; stopped = false; dirty = true;
    startHeartbeat();
    if (options.automatic !== false) timer = setTimeout(tick, 0);
  }
  function stop() {

    for (const capture of captureSuspensions) {
      capture.cancelled = true;
      cancelNativeCapture(capture).catch(() => {});
    }
    activeCapture = null;
    stopped = true; epoch++; clearTimeout(timer); clearTimeout(heartbeatTimer);
    timer = null; heartbeatTimer = null; urgentSync = null;
    report('Helper not connected', false);
  }
  async function disconnect() {
    const config = connection, disconnectSession = session;

    stop(); connection = null;
    const disconnectEpoch = epoch;
    if (config) {
      try {
        await queueSync(() => request('/sync', syncSnapshot(disconnectSession, true), config));
      } catch (_) {                                                                }
    }
    if (epoch === disconnectEpoch && options.saveConnection) await options.saveConnection(null);
  }
  async function showWheel() {
    if (!connected) throw new Error('Start and connect the Reflex helper in Shortcuts first.');
    const currentEpoch = epoch, config = connection;
    await syncNow();
    if (!current(currentEpoch, config)) throw new Error('Reflex helper connection changed.');
    return request('/show', { kind: 'wheel' }, config);
  }
  return { get session() { return session; }, useConnection, restoreConnection, syncNow, heartbeat, notifyHostChange, tick, handle, stop, disconnect, showWheel,
    startShortcutCapture, readShortcutCapture, cancelShortcutCapture, confirmShortcutCapture,
    markDirty() { dirty = true; }, getStatus: () => ({ status, connected }) };
}
module.exports = { createBridge, validateConnection, URL, LEGACY_URL };
