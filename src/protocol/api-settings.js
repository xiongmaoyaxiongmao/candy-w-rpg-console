import { cleanText } from './validation.js';

export function readApiSettings(settings = {}) {
    const value = settings.auxiliaryApis ?? {};
    return {
        profiles: Array.isArray(value.profiles) ? structuredClone(value.profiles) : [],
        directorProfileId: String(value.directorProfileId ?? ''),
    };
}

export function normalizeApiProfile(input, previous = null, { requireModel = true } = {}) {
    const label = cleanText(input.label, { label: '配置名称', minChars: 1, maxChars: 80 });
    let endpoint = cleanText(input.endpoint, { label: '接口地址', minChars: 1, maxChars: 2000 });
    let url;
    try { url = new URL(endpoint); } catch { throw new Error('接口地址需要是完整的 http 或 https 地址。'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
        throw new Error('接口地址只支持 http 或 https；请把密钥填写在密钥栏中。');
    }
    endpoint = url.href.replace(/\/(?:chat\/completions|models)\/?$/u, '').replace(/\/+$/u, '');
    const model = cleanText(input.model ?? '', { label: '模型', minChars: requireModel ? 1 : 0, maxChars: 200 });
    const entered = String(input.credential ?? '').trim();
    if (/[\u0000-\u001f\u007f]/u.test(entered) || entered.length > 4096) throw new Error('密钥格式无效。');
    const noAuth = input.noAuth === true;
    if (previous && previous.endpoint !== endpoint && !entered && !noAuth) {
        throw new Error('接口地址已更改，请重新填写对应密钥，或选择无需密钥。');
    }
    const credential = noAuth ? '' : entered || previous?.credential || '';
    if (!credential && !noAuth) throw new Error('请填写密钥；本地免认证接口可选择无需密钥。');
    const { outputMode, maxOutputTokens, thinkingMode } = normalizeOutputSettings(input.outputMode ?? previous?.outputMode, input.maxOutputTokens ?? previous?.maxOutputTokens, input.thinkingMode ?? previous?.thinkingMode);
    return { outputMode, maxOutputTokens, thinkingMode, id: previous?.id ?? String(input.id ?? ''), label, endpoint, model, credential, noAuth };
}

export function publicApiProfile({ credential, ...profile }) {
    return { ...profile, hasCredential: Boolean(credential) };
}

export function normalizeOutputSettings(mode = 'json_object', tokens = 16000, thinkingMode = 'auto') {
    if (!['auto', 'provider', 'low', 'disabled'].includes(thinkingMode)) throw new Error('思考设置无效。');
    if (!['json_object', 'json_schema', 'tool', 'text_json'].includes(mode)) throw new Error('请选择接口支持的结构化输出格式。');
    const count = Number(tokens);
    if (!Number.isSafeInteger(count) || count < 1024 || count > 64000) throw new Error('输出上限需要是 1024 至 64000 的整数。');
    return { outputMode: mode, maxOutputTokens: count, thinkingMode };
}
