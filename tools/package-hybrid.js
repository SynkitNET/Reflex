'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const JSZip = require('jszip');
const acorn = require('acorn'), postcss = require('postcss');
const validateManifestIcons = require('./manifest-icons');
const root = path.resolve(__dirname, '..');
const runtimeFiles = ['manifest.json','package.json','index.html','style.css','main.js','native-bridge.js','catalog.js','core.js','host.js','shortcuts.js','storage.js','theme.js','ui.js','LICENSE','THIRD_PARTY_NOTICES.md'];
async function packageHybrid() {
  const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
  assert.equal(manifest.manifestVersion, 6); assert.equal(manifest.requiredPermissions.enableAddon, true);
  assert.equal(manifest.requiredPermissions.network, undefined);
  const requested = process.argv.find(arg => arg.startsWith('--target='))?.slice(9) || 'all';

  const nativeRoot = path.resolve(process.argv.find(arg => arg.startsWith('--native-root='))?.slice(14) || root);
  const targets = requested === 'all' ? ['win/x64','mac/arm64','mac/x64'] : [requested];
  if (targets.some(t => !['win/x64','mac/arm64','mac/x64'].includes(t))) throw new Error('Unknown target. Use win/x64, mac/arm64, mac/x64, or all.');
  const zip = new JSZip(), listed = [];
  async function add(file, data) { zip.file(file, data ?? await fs.readFile(path.join(root, file))); listed.push(file); }
  for (const file of runtimeFiles) await add(file);
  for (const file of await fs.readdir(path.join(root, 'assets'))) if (/\.(svg|png|json|js)$/.test(file) && file !== 'icon-sheet.svg') await add('assets/' + file);
  for (const target of targets) {
    const name = target + '/reflex.uxpaddon'; let bytes;
    try { bytes = await fs.readFile(path.join(nativeRoot, name)); } catch (_) { throw new Error('Missing ' + name + '. Build that architecture first; no partial package is labeled universal.'); }
    if (target.startsWith('win') && bytes.subarray(0, 2).toString() !== 'MZ') throw new Error('Not a Windows binary: ' + name);
    if (target.startsWith('mac') && ![0xfeedfacf,0xcffaedfe,0xcafebabe,0xbebafeca].includes(bytes.readUInt32BE(0))) throw new Error('Not a Mach-O binary: ' + name);
    await add(name, bytes);
  }
  const sdk = process.env.REFLEX_UXP_SDK || path.join(root, 'native/sdk/uxp-hybrid-plugin-sdk-main');
  const terms = path.join(sdk, 'Adobe-Developer-Additional-Terms_en-US_20220330.pdf');
  await add('licenses/Adobe-Developer-Additional-Terms.pdf', await fs.readFile(terms));
  const name = 'Reflex-' + manifest.version + '-' + (requested === 'all' ? 'all-platforms' : requested.replace('/', '-')) + '-dev.ccx';
  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  const verified = await JSZip.loadAsync(bytes, { checkCRC32: true });
  assert.deepEqual(Object.keys(verified.files).filter(k => !verified.files[k].dir).sort(), listed.sort());
  await validateManifestIcons(manifest, file => {
    assert.ok(verified.file(file), 'Missing packaged icon: ' + file);
    return verified.file(file).async('nodebuffer');
  });
  assert.ok(!listed.some(k => /companion|connection|sdk\//i.test(k)));
  for (const file of listed) {
    if (!/\.(js|css|html|svg)$/.test(file)) continue;
    const source = await verified.file(file).async('string');
    if (file.endsWith('.js')) {
      const comments = [];
      acorn.parse(source, { ecmaVersion: 'latest', onComment: comments });
      assert.equal(comments.length, 0, 'Comments in ' + file);
    } else if (file.endsWith('.css')) {
      postcss.parse(source).walkComments(() => { throw new Error('Comments in ' + file); });
    } else assert.ok(!source.includes('<!--'), 'Comments in ' + file);
  }
  const report = { version: manifest.version, stage: 'development', artifact: name, targets,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length,
    helperRequired: false, networkPermission: false, archiveVerified: true, commentFreeCode: true,
    photoshopInteractiveTested: false, cleanInstallTested: false, macBinariesNotarizationVerified: false };
  await fs.mkdir(path.join(root, 'dist'), { recursive: true });
  await fs.writeFile(path.join(root, 'dist', name), bytes);
  await fs.writeFile(path.join(root, 'dist', 'package-report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
packageHybrid().catch(error => { console.error(error.message); process.exitCode = 1; });
