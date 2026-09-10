import { DirectTransport, TRANSPORT_VERSION } from './direct-transport.mjs';
import { randomUUID } from 'node:crypto';
export const info = { id: 'candy-w-director', name: 'Candy W Director Direct', description: 'Independent direct transport for director requests; Tavern proxy remains unchanged.' };
const transport = new DirectTransport();
const active = new Map();
const safeCode = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value) ? value : null;
export async function init(router) {
    router.get('/health', (_req, res) => res.json({ version: TRANSPORT_VERSION, transport: 'direct' }));
    router.post('/request', async (req, res) => {
        if (!req.user?.profile?.handle) return res.status(401).json({ error: 'LOGIN_REQUIRED' });
        const input = req.body;
        if (!input || input.version !== TRANSPORT_VERSION) return res.status(409).json({ error: 'TRANSPORT_VERSION_MISMATCH' });
        if (!['completion', 'models'].includes(input.operation) || typeof input.endpoint !== 'string' || input.endpoint.length > 2000) return res.status(400).json({ error: 'INVALID_REQUEST' });
        if (input.operation === 'completion' && (!input.payload || typeof input.payload.model !== 'string' || !Array.isArray(input.payload.messages) || !input.payload.messages.length)) return res.status(400).json({ error: 'INVALID_COMPLETION' });
        const owner = req.user.profile.handle;
        if ((active.get(owner)?.size ?? 0) >= 3) return res.status(429).json({ error: 'DIRECTOR_BUSY' });
        const controller = new AbortController(), requestId = randomUUID();
        if (!active.has(owner)) active.set(owner, new Set()); active.get(owner).add(controller);
        res.set({ 'Content-Type': 'application/x-ndjson; charset=utf-8', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
        const send = value => { if (!res.destroyed) res.write(JSON.stringify({ version: TRANSPORT_VERSION, requestId, ...value }) + '\n'); };
        const onClose = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', onClose);
        send({ type: 'progress', stage: 'connecting' });
        const heartbeat = setInterval(() => send({ type: 'heartbeat' }), 15_000);
        try {
            const result = await transport.request(input, { signal: controller.signal, progress: details => send({ type: 'progress', ...details }) });
            send({ type: 'result', ...result });
        } catch (error) {
            const code = safeCode(error.code) ?? 'NETWORK_FAILED';
            const message = error.name === 'TransportError' || error.constructor.name === 'TransportError' ? error.message : '导演直连请求失败。';
            send({ type: 'error', error: { code, message, status: error.status ?? null, providerCode: safeCode(error.providerCode), timings: error.timings } });
            console.warn('[Candy W Director]', JSON.stringify({ requestId, code, status: error.status ?? null, timings: error.timings }));
        } finally { clearInterval(heartbeat); active.get(owner)?.delete(controller); if (!active.get(owner)?.size) active.delete(owner); res.end(); }
    });
}
export async function exit() { for (const requests of active.values()) for (const controller of requests) controller.abort(); transport.close(); }
