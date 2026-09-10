import { renderCheckControl } from './check-control.js';
const escape = value => String(value ?? '').replace(/[&<>"']/gu, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);
export const emptyApiDraft = () => ({ id: '', label: '', endpoint: '', model: '', credential: '', noAuth: false, hasCredential: false, outputMode: 'json_object', maxOutputTokens: 16000, thinkingMode: 'auto' });
export function apiDraftFromForm(form) {
    return { id: String(form.get('id') ?? ''), label: String(form.get('label') ?? ''), endpoint: String(form.get('endpoint') ?? ''), model: String(form.get('model') ?? ''), credential: String(form.get('credential') ?? ''), noAuth: form.get('noAuth') === 'on', outputMode: String(form.get('outputMode') ?? 'json_object'), maxOutputTokens: Number(form.get('maxOutputTokens') ?? 16000), thinkingMode: String(form.get('thinkingMode') ?? 'auto') };
}
export function apiSelectionFromForm(form) { return { directorProfileId: String(form.get('directorProfileId') ?? '') }; }

export function renderApiSettings({ config = {}, draft = {}, selection = {}, models = [], notice = '' } = {}) {
    const profiles = config.profiles ?? [];
    const options = (selected, fallback) => `<option value="">${fallback}</option>${profiles.map(p => `<option value="${escape(p.id)}" ${p.id === selected ? 'selected' : ''}>${escape(p.label)} · ${escape(p.model)}</option>`).join('')}`;
    return `<section class="cw-api-settings">
        <div class="cw-page-heading"><p class="cw-eyebrow">导演 API 设置</p><h2>选择导演使用的接口和模型。</h2><p>导演独立直连；角色正文沿用酒馆主 API 与原有代理。支持 OpenAI 兼容接口。</p></div>
        ${notice ? `<p class="cw-api-notice" role="status">${escape(notice)}</p>` : ''}
        <form class="cw-form" data-form="api-selection">
            <label><span>导演 API <small>行动判断、剧本编写</small></span><select name="directorProfileId">${options(selection.directorProfileId, '请选择导演直连接口')}</select></label>
            <p class="cw-form-note">导演使用下方所选配置的模型与输出设置，失败不会切换到主 API。</p>
            <button type="submit" class="cw-button cw-button--primary">保存使用设置</button>
        </form>
        <section class="cw-api-section"><h3>已保存的接口</h3>
            ${profiles.length ? profiles.map(p => `<div class="cw-api-profile"><div><strong>${escape(p.label)}</strong><small>${escape(p.model)}</small><small>${escape(p.endpoint)}</small></div><button type="button" class="cw-text-button" data-action="edit-api-profile" data-profile-id="${escape(p.id)}">编辑</button><button type="button" class="cw-text-button" data-action="delete-api-profile" data-profile-id="${escape(p.id)}">删除</button></div>`).join('') : '<p>还没有接口。填写下方信息后，即可选择给导演使用。</p>'}
        </section>
        <form class="cw-form cw-api-section" data-form="api-profile">
            <h3>${draft.id ? '编辑接口配置' : '新增接口配置'}</h3>
            <input type="hidden" name="id" value="${escape(draft.id)}">
            <label><span>配置名称</span><input name="label" maxlength="80" required value="${escape(draft.label)}" placeholder="例如：导演专用"></label>
            <label><span>API 地址</span><input name="endpoint" type="url" maxlength="2000" required value="${escape(draft.endpoint)}" placeholder="填写服务商提供的接口地址，包含所需的 /v1"></label>
            <label><span>密钥 ${draft.hasCredential ? '<small>已保存；留空保留</small>' : ''}</span><input name="credential" type="password" autocomplete="new-password" maxlength="4096" value="${escape(draft.credential)}" placeholder="${draft.hasCredential ? '不显示已保存密钥' : '填写该接口的密钥'}"></label>
            ${renderCheckControl({name:'noAuth',label:'此接口无需密钥',checked:Boolean(draft.noAuth)})}
            <label><span>模型</span><input name="model" list="cw-api-models" maxlength="200" required value="${escape(draft.model)}" placeholder="填写模型名称，或先获取模型列表"><datalist id="cw-api-models">${models.map(model => `<option value="${escape(model)}"></option>`).join('')}</datalist></label>
            ${outputFields(draft.outputMode, draft.maxOutputTokens, draft.thinkingMode)}
            <div class="cw-api-actions"><button type="button" class="cw-button cw-button--secondary" data-action="list-api-models">获取模型列表</button><button type="button" class="cw-button cw-button--secondary" data-action="test-api-profile">验证 JSON 连接</button></div>
            <p class="cw-form-note">验证会发送一条简短的 JSON 请求，并检查返回格式。密钥保存在酒馆用户设置中，不随剧本或旅程导出。</p>
            <button type="submit" class="cw-button cw-button--primary">保存接口配置</button>
            ${draft.id ? '<button type="button" class="cw-text-button" data-action="new-api-profile">取消编辑 / 新增配置</button>' : ''}
        </form>
        ${config.diagnostic ? `<details class="cw-api-section"><summary>最近一次行动判断失败详情</summary><p>接口：${escape(config.diagnostic.route)} · 模型：${escape(config.diagnostic.model)}<br>结束原因：${escape(config.diagnostic.finishReason ?? '接口未提供')}<br>错误类别：${escape(config.diagnostic.code)}<br>请求编号：${escape(config.diagnostic.requestId)}</p></details>` : ''}
        <button type="button" class="cw-text-button" data-action="back-welcome">返回故事</button>
    </section>`;
}

function outputFields(mode = 'json_object', tokens = 16000, thinkingMode = 'auto') {
    return `<details class="cw-api-advanced"><summary>高级生成设置</summary><label><span>输出格式</span><select name="outputMode"><option value="json_object" ${mode === 'json_object' ? 'selected' : ''}>JSON 对象</option><option value="json_schema" ${mode === 'json_schema' ? 'selected' : ''}>JSON Schema（需接口支持）</option><option value="tool" ${mode === 'tool' ? 'selected' : ''}>工具式结构化输出（需接口支持）</option><option value="text_json" ${mode === 'text_json' ? 'selected' : ''}>严格文本 JSON（接口不支持格式参数时）</option></select></label>
    <label><span>思考设置</span><select name="thinkingMode">${[['auto','自动（按已识别接口分配预算）'],['provider','使用接口默认设置'],['low','低强度思考（需接口支持）'],['disabled','关闭思考（DeepSeek 官方兼容接口）']].map(([value,label]) => `<option value="${value}" ${thinkingMode === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
    <label><span>输出上限（tokens）</span><input name="maxOutputTokens" type="number" min="1024" max="64000" step="1" required value="${escape(tokens)}"></label></details>`;
}
