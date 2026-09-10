import http from 'node:http';
import https from 'node:https';

export const TRANSPORT_VERSION = 1;
export class TransportError extends Error {
    constructor(code, message, detail = {}) { super(message); this.code = code; Object.assign(this, detail); }
}
const failure = (code, message, detail) => new TransportError(code, message, detail);
const safeCode = value => typeof value === 'string' && /^[a-zA-Z0-9_.:-]{1,160}$/.test(value) ? value : null;
export function endpointFor(endpoint, operation) {
    let url;
    try { url = new URL(endpoint); } catch { throw failure('INVALID_ENDPOINT', '导演接口地址无效。'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw failure('INVALID_ENDPOINT', '导演接口地址只支持不带认证信息的 HTTP 或 HTTPS 地址。');
    url.pathname = url.pathname.replace(/\/(?:chat\/completions|models)\/?$/, '').replace(/\/+$/, '') + (operation === 'models' ? '/models' : '/chat/completions');
    return url;
}

/** Parse OpenAI SSE without treating a partial object or EOF as completion. */
export class CompletionStream {
    constructor() { this.pending = ''; this.done = false; this.result = { choices: [{ index: 0, message: { role: 'assistant', content: '' }, finish_reason: null }] }; }
    push(text) {
        this.pending += text;
        let match;
        while ((match = /\r?\n\r?\n/.exec(this.pending))) {
            const block = this.pending.slice(0, match.index); this.pending = this.pending.slice(match.index + match[0].length);
            const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
            if (!data) continue;
            if (data === '[DONE]') { this.done = true; continue; }
            if (this.done) throw failure('INVALID_STREAM', '接口在结束标记后继续返回生成数据。');
            let chunk; try { chunk = JSON.parse(data); } catch { throw failure('INVALID_STREAM', '导演接口返回了无法读取的流式数据。'); }
            if (chunk.error) throw failure('PROVIDER_ERROR', '服务商在生成过程中返回错误。', { providerCode: safeCode(chunk.error.code) });
            for (const key of ['id', 'model', 'created', 'usage']) if (chunk[key] != null) this.result[key] = chunk[key];
            if ((chunk.choices ?? []).some(c => c.index !== 0)) throw failure('AMBIGUOUS_OUTPUT', '接口返回了多个生成结果。');
            const choice = chunk.choices?.[0]; if (!choice) continue;
            const target = this.result.choices[0], delta = choice.delta ?? {};
            if (typeof delta.content === 'string') target.message.content += delta.content;
            if (delta.refusal) target.message.refusal = String(target.message.refusal ?? '') + delta.refusal;
            if (choice.finish_reason != null) target.finish_reason = choice.finish_reason;
            for (const tool of delta.tool_calls ?? []) {
                if (!Number.isInteger(tool.index) || tool.index < 0 || tool.index > 8) throw failure('INVALID_STREAM', '工具结果序号无效。');
                target.message.tool_calls ??= [];
                const entry = target.message.tool_calls[tool.index] ??= { type: 'function', function: { name: '', arguments: '' } };
                if (tool.id) entry.id = tool.id;
                if (tool.function?.name) entry.function.name += tool.function.name;
                if (tool.function?.arguments) entry.function.arguments += tool.function.arguments;
            }
        }
    }
    finish() {
        if (!this.done || !this.result.choices[0].finish_reason) throw failure('INCOMPLETE_RESPONSE', '导演接口在完整结束前断开，已收到的片段没有保存。');
        return this.result;
    }
}

export class DirectTransport {
    constructor({ connectMs = 30_000, idleMs = 120_000, totalMs = 600_000, maxBytes = 8_000_000 } = {}) {
        this.options = { connectMs, idleMs, totalMs, maxBytes };
        // Explicit agents are intentionally independent of Tavern's global proxy agents.
        this.agents = { 'http:': new http.Agent({ keepAlive: true }), 'https:': new https.Agent({ keepAlive: true }) };
    }
    close() { Object.values(this.agents).forEach(agent => agent.destroy()); }
    async request({ endpoint, credential = '', operation, payload }, { signal, progress = () => {} } = {}) {
        if (!['models', 'completion'].includes(operation)) throw failure('INVALID_OPERATION', '未知导演请求。');
        if (typeof credential !== 'string' || credential.length > 4096 || /[\u0000-\u001f\u007f]/.test(credential)) throw failure('INVALID_CREDENTIAL', '导演密钥格式无效。');
        const url = endpointFor(endpoint, operation), started = Date.now();
        const body = operation === 'completion' ? JSON.stringify({ ...payload, stream: true, stream_options: { include_usage: true } }) : null;
        const timings = { startedAt: new Date(started).toISOString(), connectedMs: null, firstByteMs: null, completedMs: null };
        return await new Promise((resolve, reject) => {
            let settled = false, req, connectTimer, totalTimer;
            const end = (error, result) => {
                if (settled) return; settled = true;
                clearTimeout(connectTimer); clearTimeout(totalTimer); signal?.removeEventListener('abort', abort);
                if (error) { req?.destroy(); error.timings = timings; reject(error); }
                else { timings.completedMs = Date.now() - started; resolve({ result, timings }); }
            };
            const abort = () => end(failure('CANCELLED', '导演请求已取消。'));
            if (signal?.aborted) { abort(); return; }
            signal?.addEventListener('abort', abort, { once: true });
            req = (url.protocol === 'https:' ? https : http).request(url, {
                method: body ? 'POST' : 'GET', agent: this.agents[url.protocol],
                headers: { accept: body ? 'text/event-stream, application/json' : 'application/json', ...(body ? { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } : {}), ...(credential ? { authorization: `Bearer ${credential}` } : {}) },
            }, res => {
                clearTimeout(connectTimer);
                const status = res.statusCode;
                if (status >= 300 && status < 400) { res.resume(); end(failure('REDIRECT_REJECTED', '接口返回重定向，请填写最终 API 地址；密钥未转发。', { status })); return; }
                const streaming = /text\/event-stream/i.test(res.headers['content-type'] ?? '');
                const stream = streaming ? new CompletionStream() : null;
                let text = '', bytes = 0;
                res.setEncoding('utf8');
                res.on('data', chunk => {
                    if (settled) return;
                    bytes += Buffer.byteLength(chunk);
                    if (bytes > this.options.maxBytes) { end(failure('RESPONSE_TOO_LARGE', '导演接口返回内容超过可处理范围。')); return; }
                    if (timings.firstByteMs === null) { timings.firstByteMs = Date.now() - started; progress({ stage: 'receiving', ...timings }); }
                    try { if (stream && status >= 200 && status < 300) stream.push(chunk); else text += chunk; } catch (error) { end(error); }
                });
                res.on('aborted', () => end(failure('ECONNRESET', '导演直连在返回完整结果前被中断。', { status })));
                res.on('error', error => end(error));
                res.on('end', () => {
                    if (settled) return;
                    let raw; try { raw = stream && status >= 200 && status < 300 ? stream.finish() : JSON.parse(text); }
                    catch (error) { end(error instanceof TransportError ? error : failure('INVALID_RESPONSE', '导演接口返回的内容不是有效 JSON。', { status })); return; }
                    if (status < 200 || status >= 300 || raw?.error) {
                        const messages = { 400: '接口拒绝了请求参数，请核对模型、输出格式和输出上限。', 401: '导演接口认证失败，请检查该服务商的密钥。', 402: '导演接口余额不足。', 403: '导演接口拒绝访问，请检查账户权限。', 404: '导演接口地址或模型不存在。', 429: '导演接口额度受限或请求过于频繁。' };
                        end(failure('HTTP_ERROR', messages[status] ?? '导演服务商返回错误。', { status, providerCode: safeCode(raw?.error?.code) })); return;
                    }
                    if (operation === 'completion' && !raw?.choices?.[0]?.finish_reason) { end(failure('INCOMPLETE_RESPONSE', '接口没有提供生成结束状态，结果未保存。')); return; }
                    end(null, raw);
                });
            });
            req.on('socket', socket => {
                const connected = () => { clearTimeout(connectTimer); timings.connectedMs = Date.now() - started; progress({ stage: 'connected', ...timings }); };
                if (socket.connecting) socket.once(url.protocol === 'https:' ? 'secureConnect' : 'connect', connected); else connected();
            });
            req.on('error', error => end(error));
            req.setTimeout(this.options.idleMs, () => end(failure('IDLE_TIMEOUT', '导演接口长时间没有传回数据，本次请求已停止。')));
            connectTimer = setTimeout(() => end(failure('CONNECT_TIMEOUT', '导演直连建立连接超时。')), this.options.connectMs);
            totalTimer = setTimeout(() => end(failure('TOTAL_TIMEOUT', '导演请求超过总时限，已停止并保留完成的阶段。')), this.options.totalMs);
            req.end(body);
        });
    }
}
