'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const core = require('../core'), theme = require('../theme'), assets = require('../assets/theme-assets');

test('accent migration preserves existing wheel, shortcut and favorite settings', () => {
  const old = core.defaults(); delete old.accent;
  old.wheels[0].name = 'Retouch'; old.shortcuts.wheel.key = 'MouseBack'; old.favorites = ['tool.brush'];
  const restored = core.cleanState(old);
  assert.equal(restored.accent, '#e6e6e6');
  assert.deepEqual(restored.wheels, old.wheels); assert.deepEqual(restored.shortcuts, old.shortcuts); assert.deepEqual(restored.favorites, old.favorites);
  restored.accent = '#7de1bd';
  assert.deepEqual(core.cleanState(JSON.parse(JSON.stringify(restored))), restored);
});

test('saved Thermal settings become solid Pink without changing other preferences', () => {
  const old = { ...core.defaults(), accent: '#00adf4', accentPreset: 'thermal', accentStyle: 'bold', tintIcons: true };
  old.wheels[0].name = 'Retouch'; old.shortcuts.wheel.key = 'MouseBack';
  const restored = core.cleanState(old);
  assert.equal(restored.accent, '#f28fc8'); assert.equal(restored.accentPreset, undefined);
  assert.equal(restored.accentStyle, 'bold'); assert.equal(restored.tintIcons, true);
  assert.deepEqual(restored.wheels, old.wheels); assert.deepEqual(restored.shortcuts, old.shortcuts);
  assert.deepEqual(core.cleanState(JSON.parse(JSON.stringify(restored))), restored);
  assert.equal(core.cleanState({ ...old, accentPreset: 'solid' }).accent, '#00adf4');
  const svg = Buffer.from(theme.asset('wheel-8-1', restored.accent, 'bold', true).split(',')[1], 'base64').toString();
  assert.doesNotMatch(svg, /linearGradient|url\(#thermal\)/);
  assert.ok(svg.includes(theme.palette(restored.accent, 'bold').hover));
});

test('custom colors normalize hex only and cannot inject styles or SVG', () => {
  for (const [input, expected] of [['#ABC', '#aabbcc'], [' 82CFFF ', '#82cfff'], ['#000000', '#000000']]) assert.equal(core.cleanAccent(input), expected);
  for (const input of [null, {}, 123, '', '#12', '#12345678', 'red', '#fff;display:none', '"><script>']) {
    assert.equal(core.cleanAccent(input), null);
    assert.equal(core.cleanState({...core.defaults(), accent:input}).accent, '#e6e6e6');
  }
});

test('dark accents retain readable indicators and consistent native blend values', () => {
  for (const raw of ['#000000', '#010101', '#ffffff', '#0000ff', '#ff0000', '#7de1bd']) {
    const p = theme.palette(raw); assert.equal(p.raw, raw);
    assert.ok((theme.luminance(p.accent) + .05) / (theme.luminance('#101010') + .05) >= 6);
  }
  assert.equal(theme.palette('#7de1bd', 'minimal').hover, '#252525');
  assert.notEqual(theme.palette('#7de1bd', 'soft').hover, theme.palette('#7de1bd', 'bold').hover);
});

test('themed vectors retain drawings, recolor every accent, and invalidate the cache on color changes', () => {
  for (const name of Object.keys(assets)) {
    const decoded = Buffer.from(theme.asset(name, '#7de1bd').split(',')[1], 'base64').toString();
    assert.ok(decoded.includes('<svg'));
    assert.equal(/#b5abfa|#383249|#8071ae/.test(decoded), false, name);
  }
  const mint = theme.asset('brush', '#7de1bd', 'soft', true);
  assert.notEqual(theme.asset('brush', '#82cfff', 'soft', true), mint);
  assert.equal(theme.asset('brush', '#7de1bd', 'soft', true), mint);
  assert.notEqual(theme.asset('brush', '#7de1bd', 'soft', false), mint);
  assert.equal(theme.asset('reflex', '#7de1bd'), theme.asset('reflex', '#82cfff'), 'brand stays monochrome');
});

test('appearance options survive reload without replacing custom colors or existing bindings', () => {
  const old = { ...core.defaults(), accent: '#123456', accentStyle: 'bold', tintIcons: true, typeface: 'clear' };
  assert.deepEqual(core.cleanState(JSON.parse(JSON.stringify(old))), old);
  const invalid = core.cleanState({ ...old, accentStyle: 'invalid', typeface: 'invalid', tintIcons: 'true' });
  assert.equal(invalid.accentStyle, 'minimal'); assert.equal(invalid.typeface, 'humanist'); assert.equal(invalid.tintIcons, false);
  assert.equal(invalid.accent, '#123456'); assert.deepEqual(invalid.shortcuts, old.shortcuts);
});
