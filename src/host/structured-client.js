import { providerSchema } from '../protocol/provider-schema.js';
import { thinkingParameters } from './generation-capabilities.js';
import { completionEnvelope, GenerationError, structuredPrompt } from '../protocol/structured-output.js';

export function outputParameters(mode, schema) {
    if (mode === 'text_json') return {};
    if (mode === 'json_object') return { response_format: { type: 'json_object' } };
    if (mode === 'tool') return { tools: [{ type: 'function', function: { name: 'director_result', description: 'Return the structured director result', parameters: schema } }], tool_choice: { type: 'function', function: { name: 'director_result' } } };
    if (mode === 'json_schema') return { response_format: { type: 'json_schema', json_schema: { name: 'director_result', strict: true, schema } } };
    throw new GenerationError('UNSUPPORTED_FORMAT', '所选结构化输出格式无效，请重新保存 API 设置。');
}
export function buildDirectPayload(profile, prompt, schema, { responseLength = 16000 } = {}) {
    const mode = profile.outputMode ?? 'json_object';
    const encoded = ['json_schema', 'tool'].includes(mode);
    const requestSchema = encoded ? providerSchema(schema) : schema;
    const thinking = thinkingParameters({ chat_completion_source: 'custom', custom_url: profile.endpoint, model: profile.model }, profile.thinkingMode ?? 'auto');
    return { wireEncoding: encoded ? 'entries-v1' : null, payload: {
        ...outputParameters(mode, requestSchema), ...(thinking.custom ?? thinking), model: profile.model,
        messages: [{ role: 'user', content: structuredPrompt(prompt, requestSchema, { native: encoded }) }],
        max_tokens: Math.min(responseLength, profile.maxOutputTokens ?? 16000),
    } };
}
export async function structuredRequest(client, profile, prompt, schema, options = {}) {
    const mode = profile.outputMode ?? 'json_object';
    const { payload, wireEncoding } = buildDirectPayload(profile, prompt, schema, options);
    const metadata = { requestId: globalThis.crypto.randomUUID(), route: `${profile.label} · 导演直连`, model: profile.model, outputMode: mode, source: 'custom' };
    try {
        return await client.run(async signal => {
            const response = await client.request(profile, 'completion', payload, signal);
            return { ...completionEnvelope(response.result, { ...metadata, requestId: response.requestId }), timings: response.timings, wireEncoding };
        });
    } catch (error) {
        error.diagnostic ??= { ...metadata, ...error.transport, finishReason: null, content: '', contentLength: 0, usage: { input: null, output: null } };
        throw error;
    }
}
