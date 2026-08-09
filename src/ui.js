import { ATTRIBUTES, GENRES, PHASES, RECORD_TYPES, createInitialState } from './domain.js';
import { exportCampaign } from './schema.js';

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const statusText = phase => ({ [PHASES.READY]: '等待 AI 开场或续场', [PHASES.GENERATING]: 'AI 正在主持…', [PHASES.IN_PROGRESS]: '进行中', [PHASES.ENDED]: '本团已结束' }[phase] || '尚未建立');
const recordBucket = type => `${type}s`;

export class RpgConsoleUi {
    constructor(application, adapter) {
        this.app = application;
        this.adapter = adapter;
        this.open = false;
        this.view = 'overview';
        this.screen = 'welcome';
        this.error = '';
        this.toggle = null;
        this.panel = null;
        this.unsubscribe = this.app.subscribe(event => {
            if (event.type === 'chat-changed') {
                this.screen = 'welcome';
                this.view = 'overview';
                this.error = '';
            }
            if (event.type === 'generation-error') this.error = event.error;
            this.render();
        });
    }

    mount() {
        if (document.getElementById('cwrpc-v1-toggle')) return;
        this.toggle = document.createElement('button');
        this.toggle.id = 'cwrpc-v1-toggle'; this.toggle.type = 'button'; this.toggle.className = 'menu_button';
        this.toggle.title = '打开跑团控制台'; this.toggle.setAttribute('aria-label', '打开跑团控制台');
        this.toggle.innerHTML = '<span aria-hidden="true">🎲</span><span>跑团</span>';
        this.toggle.addEventListener('click', () => { this.open = true; this.render(); });
        document.body.append(this.toggle);
        this.panel = document.createElement('aside');
        this.panel.id = 'cwrpc-v1-panel'; this.panel.setAttribute('aria-label', '跑团控制台');
        document.body.append(this.panel);
        this.panel.addEventListener('click', event => void this.handleClick(event));
        this.panel.addEventListener('submit', event => void this.handleSubmit(event));
        this.panel.addEventListener('change', event => void this.handleChange(event));
        this.render();
    }

    destroy() { this.unsubscribe?.(); this.toggle?.remove(); this.panel?.remove(); }
    notify(error) { this.error = error instanceof Error ? error.message : String(error); this.render(); }
    clearError() { this.error = ''; }
    isVisible() { return this.adapter.getSettings().showButton !== false && this.app.enabled; }

    render() {
        if (!this.toggle || !this.panel) return;
        this.toggle.classList.toggle('cwrpc-hidden', !this.isVisible());
        this.panel.classList.toggle('open', this.open && this.isVisible());
        this.panel.setAttribute('aria-hidden', String(!this.open));
        if (!this.open || !this.isVisible()) return;
        const state = this.app.currentState();
        if (this.app.chatKind() === 'group') { this.panel.innerHTML = this.shell('跑团控制台', '<div class="cwrpc-empty">跑团控制台仅支持单个角色聊天，请打开一个单个角色聊天。</div>'); return; }
        if (!this.app.hasChat()) { this.panel.innerHTML = this.shell('跑团控制台', '<div class="cwrpc-empty">请先打开一个单个角色聊天，再开始一团。</div>'); return; }
        if (this.screen === 'setup') { this.panel.innerHTML = this.shell('开新团', this.setup(state ?? createInitialState())); return; }
        if (!state || state.lifecycle.phase === PHASES.UNINITIALIZED) { this.panel.innerHTML = this.shell('跑团控制台', this.welcome()); return; }
        if (state.lifecycle.phase === PHASES.ENDED) { this.panel.innerHTML = this.shell('本团已结束', this.ended(state)); return; }
        this.panel.innerHTML = this.shell(state.campaign.name, this.console(state));
    }

    shell(title, content) {
        return `<div class="cwrpc-panel-inner"><header class="cwrpc-header"><div><strong>${escapeHtml(title)}</strong><small>单人玩家 · 当前聊天 AI 主持</small></div><button class="cwrpc-icon" type="button" data-action="close" aria-label="关闭">×</button></header>${this.error ? `<div class="cwrpc-error" role="alert">${escapeHtml(this.error)}<button type="button" data-action="dismiss-error" aria-label="关闭提示">×</button></div>` : ''}${content}</div>`;
    }

    welcome() {
        return `<section class="cwrpc-welcome"><span class="cwrpc-welcome-die" aria-hidden="true">🎲</span><h2>开一团，开始玩</h2><p>当前聊天连接的 AI 会继续保留角色人设、世界书与前文，同时主持场景、NPC 和判定。你不需要另配 API，也不用写主持提示。</p><button class="cwrpc-primary" type="button" data-action="open-setup">开新团</button><p class="cwrpc-hint">每次请求 AI 都必须由你点按钮触发。</p></section>`;
    }

    setup(state) {
        const options = Object.entries(GENRES).map(([key, label]) => `<option value="${key}" ${state.campaign.genre === key ? 'selected' : ''}>${label}</option>`).join('');
        return `<form class="cwrpc-form cwrpc-setup" data-form="setup"><p class="cwrpc-hint">只收必要信息；之后仍可在控制台修改当前目标、场景和角色状态。</p>
            ${field('团名', 'name', state.campaign.name, '例如：雨夜档案')}
            <label class="cwrpc-field"><span>题材</span><select name="genre">${options}</select></label>
            ${field('自定义题材', 'customGenre', state.campaign.customGenre, '仅选择“自定义”时填写')}
            ${field('玩家角色名', 'playerName', state.player.name, '例如：林晚', true)}
            ${field('一句角色设定或想玩的感觉（可空）', 'brief', state.player.brief, '例如：冷静的调查记者，想有一点悬疑')}
            ${field('当前目标（可空）', 'objective', state.campaign.objective, '例如：找回失踪的朋友')}
            <div class="cwrpc-actions"><button class="cwrpc-primary" type="submit">建立这一团</button><button class="cwrpc-link" type="button" data-action="back-welcome">返回</button></div></form>`;
    }

    ended(state) {
        return `<section class="cwrpc-welcome"><span class="cwrpc-welcome-die">✓</span><h2>《${escapeHtml(state.campaign.name)}》已结束</h2><p>这团的记录仍留在当前聊天，可导出保存。开新团会替换本聊天的 v1 团务状态。</p><button class="cwrpc-primary" type="button" data-action="open-setup">开新团</button><button class="cwrpc-link" type="button" data-action="export">导出这一团</button></section>`;
    }

    console(state) {
        const generating = state.lifecycle.phase === PHASES.GENERATING;
        const counts = Object.values(state.records).reduce((sum, list) => sum + list.length, 0);
        return `<div class="cwrpc-status"><span class="cwrpc-status-dot ${generating ? 'busy' : ''}"></span>${statusText(state.lifecycle.phase)}</div>
            <div class="cwrpc-primary-actions"><button type="button" class="cwrpc-primary" data-action="ask-ai" ${generating ? 'disabled' : ''}>${generating ? '正在请求主持人…' : state.lifecycle.phase === PHASES.READY ? '开始第一幕' : '让 AI 继续'}</button>${state.checks.length ? `<button type="button" class="cwrpc-secondary" data-action="continue-check" ${generating ? 'disabled' : ''}>按最近判定继续</button>` : ''}</div>
            <p class="cwrpc-hint cwrpc-inline-hint">AI 使用当前酒馆模型。主持人要求判定时来这里公开掷骰；线索、物品和 NPC 需要你手动确认记录。</p>
            <nav class="cwrpc-tabs" aria-label="控制台分页"><button type="button" class="${this.view === 'overview' ? 'active' : ''}" data-view="overview">团务</button><button type="button" class="${this.view === 'check' ? 'active' : ''}" data-view="check">判定 <b>${state.checks.length}</b></button><button type="button" class="${this.view === 'records' ? 'active' : ''}" data-view="records">记录 <b>${counts}</b></button></nav>
            <section class="cwrpc-view">${this.view === 'check' ? this.checks(state) : this.view === 'records' ? this.records(state) : this.overview(state)}</section>
            <footer class="cwrpc-footer"><button type="button" class="cwrpc-link" data-action="export">导出</button><button type="button" class="cwrpc-link" data-action="import">导入到当前聊天</button><button type="button" class="cwrpc-danger-link" data-action="end">结束本团</button><input id="cwrpc-import-file" type="file" accept="application/json" hidden></footer>`;
    }

    overview(state) {
        const attrs = Object.entries(ATTRIBUTES).map(([key, label]) => `<label class="cwrpc-attribute"><span>${label}</span><input name="attribute-${key}" type="number" min="-2" max="4" value="${state.player.attributes[key]}"></label>`).join('');
        const conditions = state.player.conditions.map(value => `<span class="cwrpc-chip">${escapeHtml(value)}<button type="button" data-action="remove-condition" data-value="${escapeHtml(value)}" aria-label="移除 ${escapeHtml(value)}">×</button></span>`).join('');
        return `<form class="cwrpc-form" data-form="overview">${field('团名', 'campaignName', state.campaign.name)}${field('当前目标', 'objective', state.campaign.objective)}${field('场景标题', 'sceneTitle', state.campaign.scene.title)}${field('场景摘要', 'sceneSummary', state.campaign.scene.summary)}<div class="cwrpc-section-title">玩家角色</div>${field('角色名', 'playerName', state.player.name, '', true)}${field('角色简述', 'brief', state.player.brief)}<div class="cwrpc-attribute-grid">${attrs}</div><button class="cwrpc-secondary" type="submit">保存团务与状态</button></form><form class="cwrpc-condition-form" data-form="condition"><div class="cwrpc-section-title">当前状态</div><div class="cwrpc-chip-row">${conditions || '<span class="cwrpc-hint">暂无状态标签</span>'}</div><div class="cwrpc-inline-form"><input name="condition" maxlength="80" placeholder="例如：疲惫、受伤、被跟踪"><button class="cwrpc-secondary" type="submit">添加</button></div></form>`;
    }

    checks(state) {
        const rows = state.checks.slice().reverse().map(check => `<article class="cwrpc-card"><div><strong>${escapeHtml(check.label || '判定')}</strong><small>${ATTRIBUTES[check.attribute]} · ${escapeHtml(check.formula)}=[${check.dice.join(',')}] ${check.modifier >= 0 ? '+' : ''}${check.modifier} → ${check.total}${check.difficulty === null ? '' : ` / ${check.difficulty} ${check.outcome === 'success' ? '成功' : '失败'}`}</small></div><b class="cwrpc-roll-number">${check.total}</b></article>`).join('');
        const attrs = Object.entries(ATTRIBUTES).map(([key, label]) => `<option value="${key}">${label} ${state.player.attributes[key] >= 0 ? '+' : ''}${state.player.attributes[key]}</option>`).join('');
        return `<form class="cwrpc-form" data-form="check"><div class="cwrpc-section-title">公开判定</div><p class="cwrpc-hint">通用规则：投出的骰子总和加所选属性，对照 AI 提出的难度。默认是 d20。</p><div class="cwrpc-two-col"><label class="cwrpc-field"><span>属性</span><select name="attribute">${attrs}</select></label><label class="cwrpc-field"><span>骰子公式</span><input name="formula" value="d20" required></label></div><div class="cwrpc-two-col">${field('难度（可空）', 'difficulty', '', '例如：12', false, 'number')}${field('用途（可空）', 'label', '', '例如：察觉') }</div>${field('备注（可空）', 'note', '', '例如：撬锁时') }<button class="cwrpc-primary" type="submit">投骰并记录</button></form><div class="cwrpc-list">${rows || '<div class="cwrpc-empty small">AI 要求判定时，在这里掷骰；结果会留在当前聊天的团务状态中。</div>'}</div>`;
    }

    records(state) {
        const typeOptions = Object.entries(RECORD_TYPES).map(([key, label]) => `<option value="${key}">${label}</option>`).join('');
        const rows = Object.entries(RECORD_TYPES).flatMap(([type, label]) => state.records[recordBucket(type)].slice().reverse().map(record => `<article class="cwrpc-card"><div><strong><span class="cwrpc-tag">${label}</span>${escapeHtml(record.name)}</strong><small>${escapeHtml(record.detail || '无补充说明')}</small></div><button type="button" class="cwrpc-icon" data-action="remove-record" data-type="${type}" data-id="${escapeHtml(record.id)}" aria-label="删除记录">×</button></article>`)).join('');
        return `<form class="cwrpc-form" data-form="record"><div class="cwrpc-section-title">新增记录</div><div class="cwrpc-two-col"><label class="cwrpc-field"><span>类别</span><select name="type">${typeOptions}</select></label>${field('名称', 'name', '', '例如：银色钥匙', true)}</div>${field('补充说明（可空）', 'detail', '', '知道它的人住在北港') }<button class="cwrpc-secondary" type="submit">加入记录</button></form><div class="cwrpc-list">${rows || '<div class="cwrpc-empty small">线索、物品和重要 NPC 由你手动确认后记录。</div>'}</div>`;
    }

    async handleClick(event) {
        const button = event.target.closest('[data-action], [data-view]'); if (!button) return;
        if (button.dataset.view) { this.view = button.dataset.view; this.render(); return; }
        const action = button.dataset.action;
        try {
            if (action === 'close') { this.open = false; this.render(); return; }
            if (action === 'dismiss-error') { this.clearError(); this.render(); return; }
            if (action === 'open-setup') { this.screen = 'setup'; this.clearError(); this.render(); return; }
            if (action === 'back-welcome') { this.screen = 'welcome'; this.render(); return; }
            if (action === 'ask-ai') await this.app.startOrContinue();
            if (action === 'continue-check') await this.app.continueAfterCheck();
            if (action === 'remove-condition') await this.app.removeCondition(button.dataset.value);
            if (action === 'remove-record') await this.app.removeRecord(button.dataset.type, button.dataset.id);
            if (action === 'export') this.download();
            if (action === 'import') this.panel.querySelector('#cwrpc-import-file')?.click();
            if (action === 'end' && window.confirm('结束这一团？状态会停止注入，但记录仍保留在当前聊天，可导出。')) await this.app.endCampaign();
        } catch (error) { this.notify(error); }
    }

    async handleSubmit(event) {
        event.preventDefault(); const form = event.target; const value = name => form.elements[name]?.value ?? '';
        try {
            if (form.dataset.form === 'setup') {
                await this.app.createCampaign({ campaign: { name: value('name'), genre: value('genre'), customGenre: value('customGenre'), objective: value('objective') }, player: { name: value('playerName'), brief: value('brief') } });
                this.screen = 'console'; this.view = 'overview'; this.render();
            }
            if (form.dataset.form === 'overview') {
                await this.app.updateCampaign({ name: value('campaignName'), objective: value('objective') });
                await this.app.updateScene({ title: value('sceneTitle'), summary: value('sceneSummary') });
                await this.app.updatePlayer({ name: value('playerName'), brief: value('brief'), attributes: Object.fromEntries(Object.keys(ATTRIBUTES).map(key => [key, Number(value(`attribute-${key}`))])) });
            }
            if (form.dataset.form === 'condition') await this.app.addCondition(value('condition'));
            if (form.dataset.form === 'check') await this.app.rollCheck({ attribute: value('attribute'), formula: value('formula'), difficulty: value('difficulty'), label: value('label'), note: value('note') });
            if (form.dataset.form === 'record') await this.app.addRecord(value('type'), { name: value('name'), detail: value('detail') });
        } catch (error) { this.notify(error); }
    }

    async handleChange(event) {
        if (event.target.id !== 'cwrpc-import-file') return;
        const file = event.target.files?.[0]; event.target.value = '';
        if (!file) return;
        try { await this.app.importCampaign(JSON.parse(await file.text())); } catch (error) { this.notify(error); }
    }

    download() {
        const state = this.app.currentState(); const content = JSON.stringify(exportCampaign(state), null, 2);
        const anchor = document.createElement('a'); anchor.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
        anchor.download = `${state.campaign.name || 'candy-w-rpg'}-v1.json`; anchor.click(); URL.revokeObjectURL(anchor.href);
    }
}

function field(label, name, value, placeholder = '', required = false, type = 'text') {
    return `<label class="cwrpc-field"><span>${label}</span><input name="${name}" type="${type}" value="${escapeHtml(value)}" placeholder="${escapeHtml(placeholder)}" ${required ? 'required' : ''}></label>`;
}
