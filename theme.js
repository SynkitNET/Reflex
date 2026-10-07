(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./assets/theme-assets.js'));
  else root.ReflexTheme = factory(root.ReflexThemeAssets);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (assets) {
  'use strict';
  function rgb(hex) { return [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)); }
  function hex(values) { return '#' + values.map(v => v.toString(16).padStart(2, '0')).join(''); }
  function mix(a, b, amount) { const x = rgb(a), y = rgb(b); return hex(x.map((n, i) => Math.round(n + (y[i] - n) * amount))); }
  function luminance(color) {
    const v = rgb(color).map(n => { n /= 255; return n <= .04045 ? n / 12.92 : Math.pow((n + .055) / 1.055, 2.4); });
    return v[0] * .2126 + v[1] * .7152 + v[2] * .0722;
  }
  function palette(value, style) {
    const raw = /^#[a-f0-9]{6}$/i.test(value || '') ? value.toLowerCase() : '#e6e6e6';
    let accent = raw;

    for (let step = 1; (luminance(accent) + .05) / (luminance('#101010') + .05) < 6 && step <= 20; step++) accent = mix(raw, '#ffffff', step / 20);
    const amount = { minimal: 0, soft: .10, bold: .22 }[style] || 0;
    return { raw, accent, text: '#ededed', soft: amount ? mix('#101010', accent, amount) : '#1a1a1a',
      hover: amount ? mix('#101010', accent, amount + .06) : '#252525', border: mix('#101010', accent, .48),
      strong: accent, on: '#080808' };
  }
  let cachedAccent, cache = new Map();
  function asset(name, accent, style, tintIcons) {
    const key = [accent, style, !!tintIcons].join(':');
    if (cachedAccent !== key) { cache = new Map(); cachedAccent = key; }
    if (cache.has(name)) return cache.get(name);
    const source = assets[name];
    if (!source) return 'assets/command.svg';
    const p = palette(accent, style);
    const svg = source.replace(/#b5abfa/g, tintIcons ? p.accent : '#dedede').replace(/#383249/g, p.hover).replace(/#8071ae/g, p.accent);
    const uri = 'data:image/svg+xml;base64,' + btoa(svg);
    cache.set(name, uri); return uri;
  }
  const fonts = { neutral: "'Arial'", humanist: "'Trebuchet MS', 'Arial'", clear: "'Verdana', 'Arial'" };
  return { palette, asset, mix, luminance, fonts };
});
