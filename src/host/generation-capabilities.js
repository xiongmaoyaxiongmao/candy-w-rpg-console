/** Known provider capabilities are selected from the native source or the exact official hostname. */
export function thinkingParameters(body, mode = 'auto') {
    let officialGlm = false;
    try { officialGlm = ['open.bigmodel.cn', 'api.z.ai'].includes(new URL(body.custom_url).hostname); } catch {}
    const forcedThinkingGlm = officialGlm && /^glm-5\.3(?:-|$)/iu.test(body.model ?? '');
    let officialDeepSeek = body.chat_completion_source === 'deepseek';
    try { officialDeepSeek ||= new URL(body.custom_url).hostname === 'api.deepseek.com'; } catch {}
    const selected = mode === 'auto' ? (officialDeepSeek ? (body.chat_completion_source === 'custom' ? 'disabled' : 'low') : forcedThinkingGlm ? 'low' : 'provider') : mode;
    if (selected === 'provider') return {};
    // The host forwards top-level reasoning_effort only for its model allowlist.
    // Custom providers must carry this explicitly in their additional JSON body.
    if (selected === 'low') return body.chat_completion_source === 'custom'
        ? { custom: { reasoning_effort: 'low' } }
        : { reasoning_effort: 'low', include_reasoning: true };
    if (selected === 'disabled' && officialDeepSeek && body.chat_completion_source === 'custom') return { custom: { thinking: { type: 'disabled' } } };
    throw new Error('关闭思考目前只支持已识别的 DeepSeek 官方兼容接口；其他接口请选择自动或使用接口默认设置。');
}
