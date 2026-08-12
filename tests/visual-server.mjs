import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const port = Number(process.env.CANDY_W_VISUAL_PORT || 4173);
const mime = Object.freeze({
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
});

const server = createServer(async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = url.pathname === '/' ? '/tests/ui-harness.html' : decodeURIComponent(url.pathname);
    const target = resolve(root, `.${pathname}`);
    const relativeTarget = relative(root, target);
    if (relativeTarget.startsWith('..') || relativeTarget === '') {
        response.writeHead(403).end('Forbidden');
        return;
    }
    try {
        const info = await stat(target);
        if (!info.isFile()) throw new Error('not a file');
        response.writeHead(200, {
            'Content-Type': mime[extname(target)] ?? 'application/octet-stream',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
        });
        createReadStream(target).pipe(response);
    } catch {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Not found');
    }
});

server.listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/tests/ui-harness.html`));
