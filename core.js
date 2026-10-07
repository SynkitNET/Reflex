(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReflexCore = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  function normalize(value) {

    return String(value || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^\p{L}\p{N}\p{M}\p{S}]+/gu, ' ').trim();
  }
  function distanceOne(a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0, j = 0, differences = 0;
    while (i < a.length && j < b.length) {
      if (a[i] === b[j]) { i++; j++; continue; }
      if (++differences > 1) return false;
      if (a.length === b.length) {
        if (a[i] === b[j + 1] && a[i + 1] === b[j]) { i += 2; j += 2; }
        else { i++; j++; }
      } else if (a.length > b.length) i++;
      else j++;
    }
    return differences + (i < a.length || j < b.length ? 1 : 0) <= 1;
  }
  function prepare(items) {
    const entries = items.map(item => ({ ...item, aliases: [...(item.aliases || [])] }));
    const paths = new Map(), commands = new Map(), equivalents = new Map();
    const pathKey = path => JSON.stringify(path.map(normalize));
    for (const item of entries) {
      if (item.kind === 'command') for (const path of item.menuPaths || []) {
        const key = pathKey(path);
        if (!equivalents.has(key)) equivalents.set(key, new Set());
        equivalents.get(key).add(item);
      }
      if (item.kind !== 'menu' || !Number.isSafeInteger(item.commandId)) continue;
      if (!commands.has(item.commandId)) commands.set(item.commandId, []);
      commands.get(item.commandId).push(item);
      try {
        const path = JSON.parse(item.menuPath);
        if (!Array.isArray(path) || !path.every(part => typeof part === 'string')) continue;
        const key = pathKey(path);
        if (!paths.has(key)) paths.set(key, new Set());
        paths.get(key).add(item.commandId);
        item._menuKey = key;
      } catch (_) {                                                             }
    }
    for (const group of commands.values()) {
      const matches = new Set();
      for (const menu of group) if (paths.get(menu._menuKey)?.size === 1) {
        for (const command of equivalents.get(menu._menuKey) || []) matches.add(command);
      }
      const canonical = matches.size === 1 ? [...matches][0] : group[0];
      for (const menu of group) {
        if (menu === canonical) continue;
        canonical.aliases.push(menu.title, menu.subtitle || '', ...menu.aliases);
        canonical.aliasIds = [...(canonical.aliasIds || []), menu.id];
        canonical.searchCategories = [...new Set([canonical.category, ...(canonical.searchCategories || []), menu.category])];
        menu.canonicalId = canonical.id;
      }
    }
    const byId = new Map(entries.map(item => [item.id, item]));
    return entries.map(entry => {

      const item = entry.canonicalId ? { ...byId.get(entry.canonicalId), id: entry.id, canonicalId: entry.canonicalId } : entry;
      const title = normalize(item.title), aliases = normalize((item.aliases || []).join(' '));
      return Object.assign({}, item, { _title: title, _words: title.split(' '), _aliases: aliases, _text: title + ' ' + aliases + ' ' + normalize(item.subtitle) + ' ' + normalize(item.category) });
    });
  }
  function score(item, query) {
    if (!query) return 1;
    if (item._title === query) return 1000;
    let total = item._title.startsWith(query) ? 240 : 0;
    for (const token of query.split(' ')) {
      if (item._words.includes(token)) { total += 100; continue; }
      if (item._words.some(word => word.startsWith(token))) { total += 75; continue; }
      if (item._aliases.split(' ').some(word => word.startsWith(token))) { total += 50; continue; }
      if (item._text.includes(token)) { total += 30; continue; }
      if (token.length >= 4 && item._words.some(word => distanceOne(token, word))) { total += 20; continue; }
      const initials = item._words.filter(word => !['to', 'the', 'a', 'an', 'of'].includes(word)).map(word => word[0]).join('');
      if (token.length > 1 && initials.startsWith(token)) { total += 40; continue; }
      return -1;
    }
    return total;
  }
  function search(items, query, options) {
    const opts = options || {}, q = normalize(query);
    const favorites = new Set(opts.favorites || []), usage = opts.usage || {};
    const isFavorite = item => [item.id, ...(item.aliasIds || [])].some(id => favorites.has(id));
    const useOf = item => [item.id, ...(item.aliasIds || [])].reduce((use, id) => ({ count: use.count + (Number(usage[id]?.count) || 0), last: Math.max(use.last, Number(usage[id]?.last) || 0) }), { count: 0, last: 0 });
    return items.filter(item => !item.canonicalId && (!opts.category || opts.category === 'All' || item.category === opts.category || item.searchCategories?.includes(opts.category)) && (!opts.onlyFavorites || isFavorite(item)))
      .map(item => ({ item, score: score(item, q) }))
      .filter(row => row.score >= 0)
      .map(row => {
        const use = useOf(row.item); row.last = use.last;
        row.score += (isFavorite(row.item) ? 12 : 0) + Math.min(10, use.count);
        return row;
      })
      .sort((a, b) => b.score - a.score || b.last - a.last || a.item.title.localeCompare(b.item.title))
      .slice(0, opts.limit || 60).map(row => row.item);
  }
  const defaultSlots = ['layer.new', 'adjust.levels', 'layer.delete', 'reflex.missing-ping', 'adjust.invert', 'selection.inverse', 'edit.fill', 'adjust.hue'];
  const legacySlots = ['layer.new', 'tool.brush', 'layer.duplicate', 'layer.smart', 'selection.deselect', 'layer.mask', 'history.undo', 'tool.move'];
  function defaultShortcuts() {
    return { search: { key: 'KeyK', ctrl: true, alt: true, shift: false }, wheel: { key: 'KeyW', ctrl: true, alt: true, shift: false } };
  }
  function defaults() {
    return { version: 1, wheelPresetVersion: 1, accent: '#e6e6e6', accentStyle: 'minimal', tintIcons: false, typeface: 'humanist', shortcuts: defaultShortcuts(), favorites: ['layer.new', 'layer.duplicate', 'layer.smart', 'selection.subject'], usage: {}, activeWheel: 'everyday', wheels: [{ id: 'everyday', name: 'Everyday', size: 8, slots: defaultSlots.slice() }] };
  }
  function cleanAccent(value) {
    if (typeof value !== 'string') return null;
    const hex = value.trim().replace(/^#/, '').toLowerCase();
    if (/^[a-f0-9]{6}$/.test(hex)) return '#' + hex;
    if (/^[a-f0-9]{3}$/.test(hex)) return '#' + hex.split('').map(c => c + c).join('');
    return null;
  }
  function cleanState(raw) {
    const base = defaults();
    if (!raw || raw.version !== 1) return base;
    base.accent = cleanAccent(raw.accent) || base.accent;
    if (raw.accentPreset === 'thermal') base.accent = '#f28fc8';
    if (['minimal', 'soft', 'bold'].includes(raw.accentStyle)) base.accentStyle = raw.accentStyle;
    base.tintIcons = raw.tintIcons === true;
    if (['neutral', 'humanist', 'clear'].includes(raw.typeface)) base.typeface = raw.typeface;
    for (const name of ['search', 'wheel']) {
      const b = raw.shortcuts && raw.shortcuts[name];
      if (b && /^(Key[A-Z]|Digit[0-9]|Space|F([1-9]|1[0-9]|2[0-4])|Mouse(Middle|Back|Forward))$/.test(b.key || '') && b.key !== 'F12') base.shortcuts[name] = { key: b.key, ctrl: b.ctrl === true, alt: b.alt === true, shift: b.shift === true, ...(b.meta === true ? { meta: true } : {}) };
    }
    if (JSON.stringify(base.shortcuts.search) === JSON.stringify(base.shortcuts.wheel)) base.shortcuts = defaultShortcuts();
    base.favorites = Array.isArray(raw.favorites) ? [...new Set(raw.favorites.filter(id => typeof id === 'string').slice(0, 500))] : base.favorites;
    if (raw.usage && typeof raw.usage === 'object') {
      Object.keys(raw.usage).slice(-2000).forEach(id => {
        const use = raw.usage[id];
        if (use && Number.isFinite(use.count) && Number.isFinite(use.last) && !['__proto__', 'constructor', 'prototype'].includes(id)) base.usage[id] = { count: Math.max(0, Math.min(use.count, 100000)), last: use.last };
      });
    }
    if (Array.isArray(raw.wheels)) {
      const seen = new Set();
      const wheels = raw.wheels.slice(0, 24).filter(w => w && typeof w.id === 'string' && !seen.has(w.id) && seen.add(w.id)).map(w => ({
        id: w.id.slice(0, 120), name: String(w.name || 'My wheel').slice(0, 40), size: w.size === 4 ? 4 : 8,
        slots: Array.from({ length: 8 }, (_, i) => typeof w.slots?.[i] === 'string' ? w.slots[i].slice(0, 250) : null)
      }));
      if (wheels.length) base.wheels = wheels;
    }
    if (!Number.isSafeInteger(raw.wheelPresetVersion) || raw.wheelPresetVersion < 1) {
      const wheel = base.wheels.find(wheel => wheel.id === 'everyday');
      if (wheel?.size === 8 && wheel.slots.every((id, i) => id === legacySlots[i] || id === defaultSlots[i] || (i === 2 && id === 'tool.remove'))) {
        wheel.slots = defaultSlots.slice();
      }
    }
    base.activeWheel = base.wheels.some(w => w.id === raw.activeWheel) ? raw.activeWheel : base.wheels[0].id;
    return base;
  }
  function wheelIndex(x, y, size, inner) {
    const radius = Math.sqrt(x * x + y * y);
    if (![x, y, inner].every(Number.isFinite) || inner <= 0 || ![4, 8].includes(size) || radius < inner) return -1;
    const angle = (Math.atan2(y, x) + Math.PI / 2 + Math.PI * 2) % (Math.PI * 2);
    return Math.floor((angle + Math.PI / size) / (Math.PI * 2 / size)) % size;
  }
  function blockedReason(item) {
    return item && (item.id === 'tool.remove' || item.operation === 'tool:removeTool')
      ? 'Remove is temporarily disabled in Reflex after a Photoshop crash report.' : '';
  }
  function unavailable(item, context) {
    if (!item) return 'This item is no longer available.';
    const blocked = blockedReason(item);
    if (blocked) return blocked;
    const ctx = context || {};
    if (item.requires === 'document' && !ctx.documentId) return 'Open a document first.';
    if (item.requires === 'layer' && !ctx.layerCount) return 'Select a layer first.';
    if (item.kind === 'layer' && item.documentId !== ctx.documentId) return 'Switch to the original document.';
    return '';
  }
  function isCancellation(error) {
    if (Array.isArray(error)) return error.length === 1 && isCancellation(error[0]);
    if (error?.code === 'REFLEX_CANCELLED') return true;
    if ([error, error?.result, error?.number, error?.code, error?.errorCode].some(code =>
      (typeof code === 'number' || typeof code === 'string') && [-128, 8007].includes(Number(code)))) return true;

    const message = errorMessage(error).replace(/^Error(?:\s+-?\d+)?\s*:\s*/i, '');
    return /^(?:(?:the\s+)?user\s+(?:has\s+)?cancel(?:led|ed)\b|(?:(?:the\s+)?(?:action|operation|command)\s+(?:was\s+|has been\s+)?)?cancel(?:led|ed)(?:\s+by\s+(?:the\s+)?user)?[.!]?\s*$)/i.test(message.trim());
  }
  function errorMessage(error) {
    if (Array.isArray(error)) return error.length === 1 ? errorMessage(error[0]) : '';
    const message = typeof error === 'string' ? error : error?.message;
    return typeof message === 'string' ? message.trim() : '';
  }
  return { normalize, distanceOne, prepare, score, search, defaults, cleanState, cleanAccent, wheelIndex, blockedReason, unavailable, isCancellation, errorMessage };
});
