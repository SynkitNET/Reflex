'use strict';
const fs = require('node:fs'), path = require('node:path');
const icons = require('./icon-source');
const number = n => String(Math.round(n * 10000) / 10000);
function paths(shape) {
  if (shape.type === 'circle') return [Array.from({ length: 33 }, (_, i) => [shape.x + shape.r * Math.cos(i * Math.PI / 16), shape.y + shape.r * Math.sin(i * Math.PI / 16)])];
  if (shape.type === 'rect') return [[[shape.x,shape.y],[shape.x+shape.w,shape.y],[shape.x+shape.w,shape.y+shape.h],[shape.x,shape.y+shape.h],[shape.x,shape.y]]];
  const tokens = shape.d.match(/[MLCQZ]|-?(?:\d*\.)?\d+/g), result = [];
  let i = 0, points = [], current = [0, 0];
  const pair = () => [Number(tokens[i++]), Number(tokens[i++])];
  while (i < tokens.length) {
    const op = tokens[i++];
    if (op === 'M') { if (points.length) result.push(points); current = pair(); points = [current]; }
    else if (op === 'L') { current = pair(); points.push(current); }
    else if (op === 'Z') { points.push(points[0]); current = points[0]; }
    else if (op === 'C' || op === 'Q') {
      const start = current, c1 = pair(), c2 = op === 'C' ? pair() : null, end = pair();
      for (let j = 1; j <= 12; j++) {
        const t = j / 12, u = 1 - t;
        points.push([0,1].map(k => op === 'C' ? u*u*u*start[k] + 3*u*u*t*c1[k] + 3*u*t*t*c2[k] + t*t*t*end[k] : u*u*start[k] + 2*u*t*c1[k] + t*t*end[k]));
      }
      current = end;
    } else throw new Error('Unsupported shared icon command: ' + op);
  }
  if (points.length) result.push(points); return result;
}
const rows = Object.entries(icons).map(([name, shapes]) => `  {"${name}", {${shapes.map(shape =>
  `{${!!shape.accent}, ${!!shape.fill}, {${paths(shape).map(points => `{${points.map(p => `{${p.map(number).join(',')}}`).join(',')}}`).join(',')}}}`).join(',')}}}`);
const output = `#pragma once\n#include "reflex/engine.hpp"\n#include <unordered_map>\n#include <vector>\nnamespace reflex {\nstruct IconStroke { bool accent; bool fill; std::vector<std::vector<Point>> contours; };\ninline const std::unordered_map<std::string, std::vector<IconStroke>>& sharedIcons() {\n static const std::unordered_map<std::string, std::vector<IconStroke>> icons = {\n${rows.join(',\n')}\n }; return icons;\n}\n}\n`;
fs.writeFileSync(path.join(__dirname, '../native/include/reflex/icons.hpp'), output);
console.log('Generated ' + rows.length + ' native icons from the shared drawings.');
