'use strict';
const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
const bundled = 'C:/Program Files/Microsoft Visual Studio/2022/Community/Common7/IDE/CommonExtensions/Microsoft/CMake/CMake/bin/cmake.exe';
const cmake = process.env.CMAKE || (process.platform === 'win32' && fs.existsSync(bundled) ? bundled : 'cmake');
const arch = process.env.REFLEX_ARCH || process.arch;
if (process.platform !== 'win32' && process.platform !== 'darwin') throw new Error('Build native addons on Windows or macOS.');
if (process.platform === 'win32' && arch !== 'x64') throw new Error('The Windows release target is x64.');
if (!['x64', 'arm64'].includes(arch)) throw new Error('REFLEX_ARCH must be x64 or arm64.');
const build = path.join(root, 'native', 'build-' + process.platform + '-' + arch);
function run(args) { const result = spawnSync(cmake, args, { cwd: root, stdio: 'inherit' }); if (result.error) throw result.error; if (result.status !== 0) process.exit(result.status || 1); }
run(['-S', 'native', '-B', build, '-DREFLEX_BUILD_ADDON=ON',
  ...(process.env.REFLEX_UXP_SDK ? ['-DREFLEX_UXP_SDK=' + path.resolve(process.env.REFLEX_UXP_SDK)] : []),
  ...(process.platform === 'win32' ? ['-A', 'x64', '-DCMAKE_TRY_COMPILE_CONFIGURATION=Release'] : ['-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_OSX_ARCHITECTURES=' + (arch === 'x64' ? 'x86_64' : 'arm64'), '-DCMAKE_OSX_DEPLOYMENT_TARGET=12.0'])]);
run(['--build', build, '--config', 'Release']);
const source = path.join(build, ...(process.platform === 'win32' ? ['Release'] : []), 'reflex.uxpaddon');
const target = path.join(root, process.platform === 'win32' ? 'win' : 'mac', arch, 'reflex.uxpaddon');
fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(source, target);
console.log('Built: ' + target);
