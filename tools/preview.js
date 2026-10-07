const http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..'), port = Number(process.env.REFLEX_PORT || 4318);
http.createServer((req, res) => {
  let requested; try { requested = decodeURIComponent(new URL(req.url, 'http://localhost').pathname); } catch (_) { res.writeHead(400).end(); return; }
  const file = path.resolve(root, '.' + (requested === '/' ? '/preview.html' : requested));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' }[path.extname(file)];
  if (!mime) { res.writeHead(404).end(); return; }
  fs.readFile(file, (error, data) => { if (error) { res.writeHead(404).end(); return; } res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'no-store' }); res.end(data); });
}).listen(port, '127.0.0.1', () => console.log('Reflex preview: http://127.0.0.1:' + port));
