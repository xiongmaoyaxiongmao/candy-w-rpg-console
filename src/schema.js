import { SCHEMA, normalizeState, validateState } from './domain.js';

export function exportCampaign(state) {
    if (!validateState(state)) throw new Error('没有可导出的有效 v1 跑团状态。');
    return { format: SCHEMA, exportedAt: new Date().toISOString(), state: structuredClone(state) };
}

export function parseCampaignImport(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== 3 || !['format', 'exportedAt', 'state'].every(key => Object.hasOwn(input, key)) || input.format !== SCHEMA || typeof input.exportedAt !== 'string') throw new Error('这不是完整的 Candy W 跑团控制台 v1 导出文件。');
    const state = normalizeState(input.state);
    if (!state) throw new Error('导入文件的 v1 团务状态不符合完整 schema。');
    if (state.lifecycle.phase === 'generating') throw new Error('不能导入正在生成中的团务状态。');
    return state;
}
