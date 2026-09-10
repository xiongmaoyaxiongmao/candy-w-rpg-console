import { providerSchema, decodeProviderValue } from './provider-schema.js';
import { parseStrictJsonObject } from './strict-json.js';
import { assertContract } from '../domain/json-contract.js';

export class GenerationError extends Error {
    constructor(code, message, diagnostic = null) { super(message); this.code = code; this.diagnostic = diagnostic; }
}
const short = (value, limit = 200) => typeof value === 'string' ? value.slice(0, limit) : null;
/** Keep machine data unchanged. Never remove fences, guess missing braces or extract a fragment. */
export function completionEnvelope(raw, { route = '', model = '', outputMode = '', requestId = '', source = '' } = {}) {
    const choice = raw?.choices?.[0];
    const nativeTools = source === 'claude' && Array.isArray(raw?.content) ? raw.content.filter(p => p.type === 'tool_use') : [];
    const structuredTool = nativeTools.length === 1 && nativeTools[0].name === 'director_result' ? nativeTools[0] : null;
    const functionCalls = outputMode === 'tool' ? (choice?.message?.tool_calls ?? []) : [];
    const functionResult = functionCalls.length === 1 && functionCalls[0].type === 'function' && functionCalls[0].function?.name === 'director_result' ? functionCalls[0].function : null;
    const candidate = raw?.candidates?.[0];
    let content = choice?.message?.content ?? choice?.text ?? raw?.content ?? candidate?.content?.parts ?? raw?.results?.[0]?.text ?? raw?.output_text;
    if (Array.isArray(content)) content = content.filter(p => p.type === 'text' || (!p.type && !p.thought && typeof p.text === 'string')).map(p => p.text ?? '').join('');
    if (outputMode === 'tool') content = functionResult?.arguments ?? '';
    if (structuredTool) content = JSON.stringify(structuredTool.input);
    if (typeof raw === 'string') content = raw;
    const refusal = choice?.message?.refusal ?? raw?.refusal ?? raw?.promptFeedback?.blockReason;
    const usage = raw?.usage ?? raw?.usageMetadata ?? {};
    const finishReason = short(choice?.finish_reason ?? raw?.stop_reason ?? candidate?.finishReason);
    return {
        requestId, providerRequestId: short(raw?.id), route, model: short(raw?.model) ?? model, outputMode,
        content: typeof content === 'string' ? content : '', finishReason,
        ambiguous: (raw?.choices?.length ?? 0) > 1 || nativeTools.length > 1 || functionCalls.length > 1, structuredTool: Boolean(structuredTool || functionResult),
        refused: Boolean(refusal) || ['content_filter', 'SAFETY', 'RECITATION'].includes(finishReason),
        usage: { input: usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount ?? null, output: usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount ?? null, reasoning: usage.completion_tokens_details?.reasoning_tokens ?? usage.thoughtsTokenCount ?? null },
    };
}
export function responseDiagnostic(envelope) {
    return { ...envelope, content: envelope.content.slice(0, 120000), contentLength: envelope.content.length, capturedAt: new Date().toISOString() };
}
export function parseStructuredCompletion(envelope, schema, label) {
    const diagnostic = responseDiagnostic(envelope);
    const fail = (code, message) => { throw new GenerationError(code, `${label}：${message}`, diagnostic); };
    if (envelope.ambiguous) fail('AMBIGUOUS_OUTPUT', '接口返回了多个结果，无法确定本次应采用的唯一结果。');
    if (envelope.refused) fail('MODEL_REFUSAL', '模型拒绝或拦截了本次生成，没有保存结果。');
    if (['length', 'max_tokens', 'MAX_TOKENS', 'model_length'].includes(envelope.finishReason)) fail('OUTPUT_TRUNCATED', '模型因输出长度限制停止，内容未完成。已保留恢复点，可在 API 设置中调整思考设置或输出上限后重试。');
    if (!envelope.content.trim()) fail('EMPTY_OUTPUT', '模型没有返回正文。请核对模型及输出预算后重试。');
    if (!(envelope.structuredTool && ['tool_use', 'tool_calls'].includes(envelope.finishReason)) && envelope.finishReason && !['stop', 'end_turn', 'stop_sequence', 'STOP', 'eos_token', 'completed'].includes(envelope.finishReason)) fail('UNEXPECTED_FINISH', `模型以非正常状态结束（${envelope.finishReason}），没有保存结果。`);
    try {
        const value = parseStrictJsonObject(envelope.content, { label });
        if (envelope.wireEncoding === 'entries-v1') {
            assertContract(value, providerSchema(schema), label);
            return assertContract(decodeProviderValue(value, schema), schema, label);
        }
        return assertContract(value, schema, label);
    }
    catch (error) { const failure = new GenerationError(error.code ?? 'INVALID_FIELDS', error.message, diagnostic); failure.issues = error.issues; throw failure; }
}
export function schemaFieldGuide(schema) {
    const fields = [];
    function visit(schema, path) {
        if (schema.properties) {
            if (schema.additionalProperties === false) fields.push(`${path} 必须包含且只能包含：${Object.keys(schema.properties).join('、')}`);
            else fields.push(`${path} 允许符合字段名与值类型定义的自定义键；可以为空字典。`);
            for (const [name, sub] of Object.entries(schema.properties)) visit(sub, `${path}.${name}`);
        }
        if (schema.items) visit(schema.items, `${path}[]`);
        if (schema.anyOf) schema.anyOf.forEach(sub => visit(sub, path));
    }
    visit(schema, '$'); return fields.join('\n');
}
export function structuredPrompt(prompt, schema, { native = false } = {}) {
    return `${prompt}\n\n只返回一个完整 JSON 对象，不加代码围栏或说明。字符串去除首尾空白，字段名不得替换。${native ? '严格遵循接口附带的输出结构定义。' : `完整输出定义：\n${JSON.stringify(schema)}`}`;
}
