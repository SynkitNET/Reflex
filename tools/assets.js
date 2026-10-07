'use strict';
const fs = require('node:fs'), path = require('node:path');
const icons = require('./icon-source');
const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
const colors = { ink: '#dedede', accent: '#b5abfa' };
function svg(width, body) { return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="0 0 ${width} ${width}">${body}</svg>\n`; }
function shape(s) {
  const color = s.accent ? colors.accent : colors.ink;
  const style = `fill="${s.fill ? color : 'none'}" stroke="${s.fill ? 'none' : color}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round"`;
  if (s.type === 'path') return `<path d="${s.d}" fill-rule="evenodd" ${style}/>`;
  if (s.type === 'circle') return `<circle cx="${s.x}" cy="${s.y}" r="${s.r}" ${style}/>`;
  if (s.type === 'rect') return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" ${style}/>`;
  throw new Error('Unknown icon primitive: ' + s.type);
}
for (const [name, drawing] of Object.entries(icons)) fs.writeFileSync(path.join(out, name + '.svg'), svg(24, drawing.map(shape).join('')));
fs.writeFileSync(path.join(out, 'icons.json'), JSON.stringify(icons));
function point(radius, angle) { return [170 + radius * Math.cos(angle), 170 + radius * Math.sin(angle)].map(n => n.toFixed(3)).join(' '); }
for (const size of [4, 8]) {
  let body = '';
  for (let i = 0; i < size; i++) {
    const mid = i * Math.PI * 2 / size - Math.PI / 2, a = mid - Math.PI / size, b = mid + Math.PI / size;
    const d = `M${point(61, a)} L${point(162, a)} A162 162 0 0 1 ${point(162, b)} L${point(61, b)} A61 61 0 0 0 ${point(61, a)} Z`;
    body += `<path d="${d}" fill="#101010" stroke="#2b2b2b" stroke-width="1"/>`;
    fs.writeFileSync(path.join(out, `wheel-${size}-${i}.svg`), svg(340, `<path d="${d}" fill="#383249" stroke="#8071ae" stroke-width="1"/>`));
  }
  fs.writeFileSync(path.join(out, `wheel-${size}.svg`), svg(340, body + '<circle cx="170" cy="170" r="60" fill="#090909" stroke="#2b2b2b" stroke-width="1"/>'));
}
const entries = Object.entries(icons), columns = 8, cellW = 112, cellH = 80;
const sheet = entries.map(([name, drawing], i) => {
  const x = (i % columns) * cellW, y = Math.floor(i / columns) * cellH;
  return `<g transform="translate(${x + 44} ${y + 12})">${drawing.map(shape).join('')}</g><text x="${x + 56}" y="${y + 58}" text-anchor="middle" fill="#989ba9" font-family="Arial" font-size="10">${name}</text>`;
}).join('');
const height = Math.ceil(entries.length / columns) * cellH;
fs.writeFileSync(path.join(out, 'icon-sheet.svg'), `<svg xmlns="http://www.w3.org/2000/svg" width="${columns * cellW}" height="${height}"><rect width="100%" height="100%" fill="#18191d"/>${sheet}</svg>`);
const themeAssets = Object.fromEntries(fs.readdirSync(out).filter(name => name.endsWith('.svg') && name !== 'icon-sheet.svg').map(name => [name.slice(0, -4), fs.readFileSync(path.join(out, name), 'utf8')]));
fs.writeFileSync(path.join(out, 'theme-assets.js'), '(function(root,data){if(typeof module==="object"&&module.exports)module.exports=data;else root.ReflexThemeAssets=data;})(typeof globalThis!=="undefined"?globalThis:this,' + JSON.stringify(themeAssets) + ');');
console.log(`Generated ${entries.length} shared icons and 14 wheel assets.`);
