import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const mime = { '.css':'text/css', '.html':'text/html', '.js':'text/javascript', '.mjs':'text/javascript' };
const server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
    const target = resolve(root, `.${normalize(pathname)}`);
    if (!target.startsWith(root)) { response.writeHead(403).end(); return; }
    try { const info = await stat(target); if (!info.isFile()) throw new Error('not file'); response.writeHead(200, { 'Content-Type': mime[extname(target)] ?? 'application/octet-stream', 'Cache-Control':'no-store' }); createReadStream(target).pipe(response); }
    catch { response.writeHead(404).end('Not found'); }
});
server.listen(4173, '127.0.0.1', () => console.log('http://127.0.0.1:4173/tests/ui-harness.html'));
