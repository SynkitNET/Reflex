const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const root = path.resolve(__dirname, '..');
for (const name of fs.readdirSync(root).filter(name => name.endsWith('.js'))) new vm.Script(fs.readFileSync(path.join(root, name), 'utf8'), { filename: name });
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
if (!fs.existsSync(path.join(root, manifest.main))) throw new Error('Missing plugin entry point');
if (manifest.manifestVersion !== 6 || manifest.addon?.name !== 'reflex.uxpaddon' || manifest.requiredPermissions?.enableAddon !== true || manifest.requiredPermissions.network) {
  throw new Error('Reflex requires its bundled addon and no network permission.');
}
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (manifest.version !== pkg.version) throw new Error('Plugin versions are out of sync');
const catalog = require('../catalog');
const iconSource = require('./icon-source');
const nativeIcons = JSON.parse(fs.readFileSync(path.join(root, 'assets/icons.json'), 'utf8'));
if (JSON.stringify(iconSource) !== JSON.stringify(nativeIcons)) throw new Error('Native icon resource is stale. Run npm run assets.');

if (new Set(catalog.map(c => c.id)).size !== catalog.length) throw new Error('Duplicate command IDs');
for (const item of catalog) {
  if (!nativeIcons[item.icon] || !fs.existsSync(path.join(root, 'assets', item.icon + '.svg'))) throw new Error('Missing shared icon: ' + item.icon);
}
require('./manifest-icons')(manifest, file => fs.readFileSync(path.join(root, file))).then(() => {
  console.log('Syntax, manifest, ' + catalog.length + ' commands, SVG assets, and Photoshop panel icons checked.');
}).catch(error => { console.error(error.message); process.exitCode = 1; });
