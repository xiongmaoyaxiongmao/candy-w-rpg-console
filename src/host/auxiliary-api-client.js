import { requestFailure } from './request-failure.js';
import { structuredRequest } from './structured-client.js';
import { GenerationError } from '../protocol/structured-output.js';
import { getRequestHeaders } from '../../../../../../script.js';

export class AuxiliaryApiClient {
    constructor(context) { this.context = context; this.requests = new Set(); }
    cancel() { for (const controller of this.requests) controller.abort('cancelled'); }
    async run(task) {
        const controller = new AbortController(); this.requests.add(controller);
        const timer = setTimeout(() => controller.abort('timeout'), 620_000);
        try { const value = await task(controller.signal); if (controller.signal.aborted) throw new Error('aborted'); return value; }
        catch (cause) {
            if (!controller.signal.aborted && cause instanceof GenerationError) throw cause;
            const failure = requestFailure(cause);
            const error = new GenerationError(controller.signal.aborted ? (controller.signal.reason === 'cancelled' ? 'CANCELLED' : 'TIMEOUT') : failure.code,
                controller.signal.aborted ? (controller.signal.reason === 'cancelled' ? '导演请求已取消，已完成阶段保留。' : '导演直连请求超时，已完成阶段保留。') : failure.message);
            if (controller.signal.reason === 'cancelled') error.name = 'AbortError';
            throw error;
        } finally { clearTimeout(timer); this.requests.delete(controller); }
    }
    async request(profile, operation, payload, signal) {
        const response = await fetch('/api/plugins/candy-w-director/request', { method: 'POST', headers: getRequestHeaders(), signal,
            body: JSON.stringify({ version: 1, operation, endpoint: profile.endpoint, credential: profile.credential ?? '', payload }) });
        if (response.status === 404) throw new GenerationError('DIRECT_SERVICE_MISSING', '导演直连服务尚未加载。请配套安装服务端组件并重启酒馆；不会改走主 API。');
        if (response.status === 409) throw new GenerationError('TRANSPORT_VERSION_MISMATCH', '导演界面与直连服务版本不一致，请配套更新后重启酒馆。');
        if (!response.ok) throw new GenerationError('DIRECT_SERVICE_ERROR', `酒馆导演服务返回 HTTP ${response.status}。`);
        const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', received = 0, final = null;
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) break;
                received += value.byteLength;
                if (received > 12_000_000) throw new GenerationError('RESPONSE_TOO_LARGE', '导演服务返回内容过长。');
                buffer += decoder.decode(value, { stream: true });
                let newline;
                while ((newline = buffer.indexOf('\n')) >= 0) {
                    const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1); if (!line.trim()) continue;
                    let frame; try { frame = JSON.parse(line); } catch { throw new GenerationError('INVALID_TRANSPORT', '导演直连服务返回数据损坏。'); }
                    if (frame.version !== 1) throw new GenerationError('TRANSPORT_VERSION_MISMATCH', '导演直连服务版本不一致。');
                    if (frame.type === 'error') {
                        const info = frame.error, known = /^(?:E(?:CONNRESET|PIPE|CONNREFUSED|NOTFOUND|AI_AGAIN|TIMEDOUT)|CERT_|ERR_TLS|UNABLE_TO_VERIFY)/.test(info.code);
                        const error = new GenerationError(known ? requestFailure(info).code : info.code, known ? requestFailure(info).message : info.message);
                        error.transport = { requestId: frame.requestId, status: info.status, providerCode: info.providerCode, timings: info.timings };
                        throw error;
                    }
                    if (frame.type === 'result') { if (final) throw new GenerationError('AMBIGUOUS_OUTPUT', '导演服务返回重复结果。'); final = frame; }
                }
            }
            if (!final || buffer.trim()) throw new GenerationError('INCOMPLETE_RESPONSE', '酒馆与导演服务之间的连接中断，未保存不完整结果。');
            return final;
        } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    }
    structured(profile, prompt, schema, options = {}) { return structuredRequest(this, profile, prompt, schema, options); }
    async models(profile) {
        return this.run(async signal => {
            const { result } = await this.request(profile, 'models', null, signal);
            if (!Array.isArray(result?.data)) throw new GenerationError('INVALID_MODEL_LIST', '接口没有返回 OpenAI 兼容模型列表，可以手动填写模型名称。');
            const models = [...new Set(result.data.map(item => item?.id).filter(id => typeof id === 'string' && id.length <= 200))].sort();
            if (!models.length) throw new GenerationError('EMPTY_MODEL_LIST', '接口返回的模型列表为空，可以手动填写模型名称。');
            return models;
        });
    }
}
