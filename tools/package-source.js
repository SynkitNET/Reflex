'use strict';
const fs = require('node:fs/promises'), path = require('node:path'), crypto = require('node:crypto'), assert = require('node:assert/strict');
const JSZip = require('jszip'), root = path.resolve(__dirname, '..');
async function main() {
  const zip = new JSZip(), included = [];
  const dirs = ['assets','docs','tests','tools','native','.github'];
  const rootFiles = ['.gitignore','.gitattributes','.editorconfig','.uxpignore','LICENSE','README.md','CONTRIBUTING.md','THIRD_PARTY_NOTICES.md','package.json','package-lock.json','manifest.json',
    'bridge.js','native-bridge.js','catalog.js','core.js','host.js','main.js','shortcuts.js','storage.js','theme.js','ui.js','index.html','style.css','preview.html','preview.js'];
  const allowed = /\.(?:js|json|md|yml|yaml|svg|png|html|css|cpp|hpp|h|mm|cs|csproj|manifest|ps1|txt)$/i;
  const excluded = new Set(['tools/package.js', 'tools/check-protocol.ps1', 'tools/protocol-fixture.js', 'docs/legacy-development.md', 'docs/legacy-macos-companion.md']);
  async function add(name) { zip.file('Reflex/' + name, await fs.readFile(path.join(root, name))); included.push(name); }
  async function walk(directory) {
    for (const entry of await fs.readdir(path.join(root, directory), { withFileTypes: true })) {
      if (entry.isSymbolicLink() || (entry.isDirectory() && /^(sdk|bin|obj|node_modules|dist|\.git|build.*|preview-artifacts)$/.test(entry.name))) continue;
      const name = directory + '/' + entry.name;
      if (excluded.has(name)) continue;
      if (entry.isDirectory()) await walk(name);
      else if (allowed.test(entry.name) && !/^(connection|companion-connection)\.json$/.test(entry.name)) await add(name);
    }
  }
  for (const file of rootFiles) await add(file);
  for (const directory of dirs) { try { await fs.access(path.join(root, directory)); } catch (_) { continue; } await walk(directory); }
  const pkg = JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
  const bytes = await zip.generateAsync({ type:'nodebuffer', compression:'DEFLATE' });
  const verified = await JSZip.loadAsync(bytes, { checkCRC32:true });
  assert.equal(Object.values(verified.files).filter(f => !f.dir).length, included.length);
  assert.ok(included.includes('tools/build-native.js'));
  assert.ok(!included.some(n => /(?:^|\/)(?:sdk|bin|obj|build[^/]*|\.git)\/|(?:^|\/)\.env(?:\.|$)|\.(?:exe|dll|pfx|pem|uxpaddon|ccx)$/i.test(n)));
  const name = 'Reflex-' + pkg.version + '-source.zip';
  await fs.mkdir(path.join(root,'dist'),{ recursive:true }); await fs.writeFile(path.join(root,'dist',name),bytes);
  console.log(JSON.stringify({ artifact:name, files:included.length, bytes:bytes.length, sha256:crypto.createHash('sha256').update(bytes).digest('hex'), sdkIncluded:false },null,2));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
