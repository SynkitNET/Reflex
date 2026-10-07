(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ReflexShortcuts = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const mouseButtons = [
    { key: 'MouseMiddle', button: 1, label: 'Middle click' },
    { key: 'MouseBack', button: 3, label: 'Mouse 4 · Back' },
    { key: 'MouseForward', button: 4, label: 'Mouse 5 · Forward' }
  ];
  function isMouse(key) { return mouseButtons.some(item => item.key === key); }
  function validKey(key) { return isMouse(key) || (/^(Key[A-Z]|Digit[0-9]|Space|F([1-9]|1[0-9]|2[0-4]))$/.test(key || '') && key !== 'F12'); }
  function clean(binding) {
    if (!binding || !validKey(binding.key)) return null;
    return { key: binding.key, ctrl: binding.ctrl === true, alt: binding.alt === true, shift: binding.shift === true, ...(binding.meta === true ? { meta: true } : {}) };
  }
  function defaults() { return { search: { key: 'KeyK', ctrl: true, alt: true, shift: false }, wheel: { key: 'KeyW', ctrl: true, alt: true, shift: false } }; }
  function equal(a, b) { return !!a && !!b && a.key === b.key && !!a.ctrl === !!b.ctrl && !!a.alt === !!b.alt && !!a.shift === !!b.shift && !!a.meta === !!b.meta; }
  function cleanPair(raw) {
    const result = defaults();
    if (raw && clean(raw.search)) result.search = clean(raw.search);
    if (raw && clean(raw.wheel)) result.wheel = clean(raw.wheel);
    return equal(result.search, result.wheel) ? defaults() : result;
  }
  function fromEvent(event) {
    if (event.metaKey) return null;
    const value = event.key || '';

    let key = /^[a-z]$/i.test(value) ? 'Key' + value.toUpperCase() : event.code;
    if (!validKey(key)) {
      key = /^[a-z]$/i.test(value) ? 'Key' + value.toUpperCase() : /^[0-9]$/.test(value) ? 'Digit' + value : value === ' ' ? 'Space' : value;
    }
    return isMouse(key) ? null : clean({ key, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey });
  }
  function fromMouseEvent(event) {
    if (event.metaKey) return null;
    const item = mouseButtons.find(item => item.button === event.button);
    return item ? clean({ key: item.key, ctrl: event.ctrlKey, alt: event.altKey, shift: event.shiftKey }) : null;
  }
  function label(binding) {
    if (!binding) return 'Not set';
    const mouse = mouseButtons.find(item => item.key === binding.key);
    return [binding.meta && 'Cmd', binding.ctrl && 'Ctrl', binding.alt && 'Alt', binding.shift && 'Shift', mouse ? mouse.label : binding.key.replace(/^Key|^Digit/, '')].filter(Boolean).join(' + ');
  }
  return { validKey, clean, defaults, equal, cleanPair, fromEvent, fromMouseEvent, isMouse, mouseButtons, label };
});
