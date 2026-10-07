'use strict';
const assert = require('node:assert/strict');
module.exports = async function validateManifestIcons(manifest, read) {
  const groups = [{ icons: manifest.icons, size: 24 }, ...manifest.entrypoints.filter(entry => entry.type === 'panel').map(entry => ({ icons: entry.icons, size: 23 }))];
  for (const { icons, size } of groups) {
    assert.ok(icons?.length, 'Missing Photoshop icons');
    for (const theme of ['darkest', 'dark', 'light', 'lightest']) assert.ok(icons.some(icon => icon.theme.includes(theme)), 'Missing icon theme: ' + theme);
    for (const icon of icons) {
      assert.equal(icon.width, size);
      assert.equal(icon.height, size);
      assert.deepEqual(icon.scale, [1, 2]);
      assert.match(icon.path, /^assets\/[^/]+\.png$/);
      for (const scale of icon.scale) {
        const file = scale === 1 ? icon.path : icon.path.replace(/\.png$/, '@' + scale + 'x.png');
        const bytes = await read(file);
        assert.ok(bytes.length >= 33, 'Invalid PNG: ' + file);
        assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Invalid PNG: ' + file);
        assert.equal(bytes.subarray(12, 16).toString(), 'IHDR', 'Missing PNG header: ' + file);
        assert.equal(bytes.readUInt32BE(16), size * scale, 'Incorrect icon width: ' + file);
        assert.equal(bytes.readUInt32BE(20), size * scale, 'Incorrect icon height: ' + file);
        assert.equal(bytes[25], 6, 'Icon must include transparency: ' + file);
      }
    }
  }
};
