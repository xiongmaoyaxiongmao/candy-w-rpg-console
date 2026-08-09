import { extension_settings, getContext, saveMetadataDebounced } from '../../../extensions.js';
import {
    chat_metadata,
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    getCurrentChatId,
    setExtensionPrompt,
    saveSettingsDebounced,
} from '../../../../script.js';
import {
    buildGmPrompt,
    buildOpeningText,
    buildPrompt,
    createDefaultState,
    DEFAULT_CAMPAIGN_NAME,
    GENRES,
    makeId,
    normalizeState,
    NOTE_TYPES,
    rollDice,
    STORAGE_KEY,
} from './rpg-console-core.js';

const EXTENSION_NAME = 'candy-w-rpg-console';
const PROMPT_KEY = `${EXTENSION_NAME}.current_state`;
const GM_PROMPT_KEY = `${EXTENSION_NAME}.gm_contract`;
const DEFAULT_SETTINGS = Object.freeze({ showButton: true });

let state = createDefaultState();
let activeTab = 'state';
let setupMode = false;
let startingFirstScene = false;
let panel;
let toggle;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

function notify(type, message) {
    if (window.toastr?.[type]) window.toastr[type](message);
    else window.alert(message);
}

function currentChatAvailable() {
    return Boolean(getCurrentChatId?.() ?? getContext()?.chatId);
}

function getChatState() {
    return normalizeState(chat_metadata?.[STORAGE_KEY]);
}

function saveState() {
    if (!chat_metadata || !currentChatAvailable()) return;
    state.updatedAt = new Date().toISOString();
    chat_metadata[STORAGE_KEY] = normalizeState(state);
    saveMetadataDebounced();
    updatePrompts();
}

function updatePrompts() {
    const active = currentChatAvailable();
    setExtensionPrompt(GM_PROMPT_KEY, active ? buildGmPrompt(state) : '', extension_prompt_types.IN_PROMPT, 0, false, extension_prompt_roles.SYSTEM);
    setExtensionPrompt(PROMPT_KEY, active ? buildPrompt(state) : '', extension_prompt_types.IN_PROMPT, 0, false, extension_prompt_roles.SYSTEM);
}

function renderShell() {
    if (document.getElementById('cwrpc-toggle')) return;
    toggle = document.createElement('button');
    toggle.id = 'cwrpc-toggle';
    toggle.type = 'button';
    toggle.className = 'menu_button';
    toggle.title = '打开跑团控制台';
    toggle.setAttribute('aria-label', '打开跑团控制台');
    toggle.innerHTML = '<span aria-hidden="true">🎲</span><span class="cwrpc-toggle-label">跑团</span>';
    toggle.addEventListener('click', () => togglePanel(true));
    document.body.append(toggle);

    panel = document.createElement('aside');
    panel.id = 'cwrpc-panel';
    panel.setAttribute('aria-label', '跑团控制台');
    panel.innerHTML = '<div class="cwrpc-panel-inner"></div>';
    document.body.append(panel);
    panel.addEventListener('click', handleClick);
    panel.addEventListener('change', handleChange);
    panel.addEventListener('submit', handleSubmit);

    renderSettings();
    updateVisibility();
}

function togglePanel(open) {
    if (!panel) return;
    panel.classList.toggle('open', open);
    panel.setAttribute('aria-hidden', String(!open));
    if (open) renderPanel();
}

function updateVisibility() {
    const settings = extension_settings[EXTENSION_NAME] ?? DEFAULT_SETTINGS;
    const visible = settings.showButton !== false;
    toggle?.classList.toggle('cwrpc-hidden', !visible);
    if (!visible) togglePanel(false);
}

function renderPanel() {
    if (!panel) return;
    const host = panel.querySelector('.cwrpc-panel-inner');
    if (!currentChatAvailable()) {
        host.innerHTML = '<header class="cwrpc-header"><strong>跑团控制台</strong><button type="button" class="cwrpc-icon" data-action="close" aria-label="关闭">×</button></header><div class="cwrpc-empty">请先打开一个角色聊天，再开始一团。</div>';
        return;
    }
    if (!state.setupComplete) {
        host.innerHTML = setupMode ? renderSetup() : renderWelcome();
        return;
    }
    if (!state.campaign.started && !setupMode) {
        host.innerHTML = renderFirstScene();
        return;
    }
    host.innerHTML = renderConsole();
}

function header(subtitle = '') {
    return `<header class="cwrpc-header"><div><strong>跑团控制台</strong>${subtitle ? `<small>${escapeHtml(subtitle)}</small>` : ''}</div><button type="button" class="cwrpc-icon" data-action="close" aria-label="关闭">×</button></header>`;
}

function renderWelcome() {
    return `${header('先开一团，再让当前酒馆模型主持。')}<section class="cwrpc-welcome"><span class="cwrpc-welcome-die" aria-hidden="true">🎲</span><h2>准备开始跑团吗？</h2><p>只要填四项，当前聊天正在使用的 AI 就会担任主持人。你不需要配置 API，也不用先写主持提示。</p><button type="button" class="cwrpc-primary" data-action="open-setup">开新团</button><p class="cwrpc-hint">不会自动发送消息；完成后由你点击“开始第一幕”。</p></section>`;
}

function renderSetup() {
    const genreOptions = Object.entries(GENRES).map(([value, label]) => `<option value="${value}" ${state.campaign.genre === value ? 'selected' : ''}>${label}</option>`).join('');
    return `${header('开新团 · 一屏就够')}<form class="cwrpc-form cwrpc-setup-form" data-form="setup"><p class="cwrpc-hint">AI 使用当前酒馆模型；这里只设定本聊天的跑团起点。</p><label class="cwrpc-field"><span>团名</span><input name="campaignName" value="${escapeHtml(state.campaign.name || DEFAULT_CAMPAIGN_NAME)}" maxlength="240"></label><label class="cwrpc-field"><span>题材</span><select name="genre">${genreOptions}</select></label><label class="cwrpc-field"><span>玩家角色名</span><input name="characterName" value="${escapeHtml(state.character.name)}" maxlength="240" required placeholder="例如 林晚"></label><label class="cwrpc-field"><span>一句角色设定或想玩的感觉 <em>可空</em></span><input name="concept" value="${escapeHtml(state.character.concept)}" maxlength="240" placeholder="例如 冷静的调查记者，想要一点悬疑"></label><button class="cwrpc-primary" type="submit">准备第一幕</button><button class="cwrpc-link" type="button" data-action="back-welcome">返回</button></form>`;
}

function renderFirstScene() {
    const subtitle = state.enabled ? '主持契约与团状态已准备好' : '请先开启状态注入';
    return `${header(subtitle)}<section class="cwrpc-welcome"><span class="cwrpc-welcome-die" aria-hidden="true">✦</span><h2>《${escapeHtml(state.campaign.name || DEFAULT_CAMPAIGN_NAME)}》准备好了</h2><p>AI 会沿用当前聊天的角色卡、已激活世界书和前文，在保持角色演绎的同时主持场景与 NPC；遇到不确定结果会明确告诉你掷什么骰子、难度多少。</p><button type="button" class="cwrpc-primary" data-action="start-first-scene" ${state.enabled && !startingFirstScene ? '' : 'disabled'}>${startingFirstScene ? '正在开始…' : '开始或继续第一幕'}</button><button type="button" class="cwrpc-link" data-action="open-console">先看看控制台</button><p class="cwrpc-hint">点击后会自然沿用前文；只有空白新聊天才建立第一幕。</p></section>`;
}

function renderConsole() {
    const status = state.enabled ? '主持契约与当前团状态正在注入' : '已暂停：不向模型注入主持契约或团状态';
    return `${header(status)}<div class="cwrpc-toolbar"><label class="cwrpc-switch"><input type="checkbox" data-field="enabled" ${state.enabled ? 'checked' : ''}> <span>注入主持契约与当前团状态</span></label><button type="button" class="cwrpc-link" data-action="reset">结束并清空本团</button></div><nav class="cwrpc-tabs" aria-label="控制台分页"><button type="button" class="${activeTab === 'state' ? 'active' : ''}" data-tab="state">状态</button><button type="button" class="${activeTab === 'rolls' ? 'active' : ''}" data-tab="rolls">掷骰 <b>${state.rolls.length}</b></button><button type="button" class="${activeTab === 'notes' ? 'active' : ''}" data-tab="notes">记录 <b>${state.notes.length}</b></button></nav><section class="cwrpc-view">${renderView()}</section><footer class="cwrpc-footer"><button type="button" class="cwrpc-link" data-action="export">导出</button><button type="button" class="cwrpc-link" data-action="import">导入</button><input id="cwrpc-import-file" type="file" accept="application/json" hidden></footer>`;
}

function renderView() {
    if (activeTab === 'rolls') return renderRolls();
    if (activeTab === 'notes') return renderNotes();
    return renderState();
}

function input(label, field, value, type = 'text') {
    return `<label class="cwrpc-field"><span>${label}</span><input type="${type}" data-field="${field}" value="${escapeHtml(value)}"></label>`;
}

function renderState() {
    return `<form class="cwrpc-form" data-form="state"><div class="cwrpc-section-title">这一团</div>${input('团名', 'campaign.name', state.campaign.name)}${input('当前场景', 'campaign.scene', state.campaign.scene)}${input('当前目标', 'campaign.goal', state.campaign.goal)}<div class="cwrpc-section-title">玩家角色</div>${input('角色名', 'character.name', state.character.name)}${input('角色设定/感觉', 'character.concept', state.character.concept)}<div class="cwrpc-two-col">${input('体力', 'character.hp', state.character.hp, 'number')}${input('意志', 'character.will', state.character.will, 'number')}</div><p class="cwrpc-hint">AI 使用当前酒馆模型。主持人要求判定时，到“掷骰”页记录结果；线索、物品和 NPC 需要在“记录”页手动确认。</p></form>`;
}

function renderRolls() {
    const rows = state.rolls.slice().reverse().map(roll => `<article class="cwrpc-card"><div><strong>${escapeHtml(roll.label || '判定')}</strong><small>${escapeHtml(roll.formula)} · ${new Date(roll.at).toLocaleString()}</small></div><div class="cwrpc-roll-result"><b>${roll.total}</b>${roll.difficulty === null ? '' : `<span class="${roll.success ? 'success' : 'fail'}">${roll.success ? '成功' : '失败'} / ${roll.difficulty}</span>`}</div><button type="button" class="cwrpc-icon cwrpc-card-delete" data-action="delete-roll" data-id="${escapeHtml(roll.id)}" aria-label="删除记录">×</button></article>`).join('');
    return `<form class="cwrpc-form cwrpc-roll-form" data-form="roll"><div class="cwrpc-section-title">公开掷骰</div><div class="cwrpc-two-col"><label class="cwrpc-field"><span>公式</span><input name="formula" value="d20" inputmode="text"></label><label class="cwrpc-field"><span>难度（可选）</span><input name="difficulty" type="number" placeholder="例如 12"></label></div><label class="cwrpc-field"><span>用途（可选）</span><input name="label" placeholder="例如 察觉"></label><button class="cwrpc-primary" type="submit">掷骰并记录</button></form><div class="cwrpc-list">${rows || '<div class="cwrpc-empty small">主持人要求判定时，在这里掷骰并把结果告诉她。</div>'}</div>`;
}

function renderNotes() {
    const rows = state.notes.slice().reverse().map(note => `<article class="cwrpc-card"><div><strong><span class="cwrpc-tag">${NOTE_TYPES[note.type]}</span>${escapeHtml(note.name)}</strong><small>${escapeHtml(note.detail || '无补充说明')}</small></div><button type="button" class="cwrpc-icon cwrpc-card-delete" data-action="delete-note" data-id="${escapeHtml(note.id)}" aria-label="删除记录">×</button></article>`).join('');
    return `<form class="cwrpc-form" data-form="note"><div class="cwrpc-section-title">新增记录</div><div class="cwrpc-two-col"><label class="cwrpc-field"><span>类别</span><select name="type"><option value="clue">线索</option><option value="item">物品</option><option value="npc">重要 NPC</option></select></label><label class="cwrpc-field"><span>名称</span><input name="name" required placeholder="例如 银色钥匙"></label></div><label class="cwrpc-field"><span>补充说明</span><input name="detail" placeholder="可选"></label><button class="cwrpc-primary" type="submit">加入记录</button></form><div class="cwrpc-list">${rows || '<div class="cwrpc-empty small">线索、物品和重要 NPC 由你在这里手动确认。</div>'}</div>`;
}

function readStateFields() {
    panel.querySelectorAll('[data-field]').forEach(element => {
        const field = element.dataset.field;
        if (field === 'enabled') state.enabled = element.checked;
        if (field === 'campaign.name') state.campaign.name = element.value;
        if (field === 'campaign.scene') state.campaign.scene = element.value;
        if (field === 'campaign.goal') state.campaign.goal = element.value;
        if (field === 'character.name') state.character.name = element.value;
        if (field === 'character.concept') state.character.concept = element.value;
        if (field === 'character.hp') state.character.hp = Number(element.value || 0);
        if (field === 'character.will') state.character.will = Number(element.value || 0);
    });
    state = normalizeState(state);
    saveState();
    renderPanel();
}

function handleClick(event) {
    const button = event.target.closest('[data-action], [data-tab]');
    if (!button) return;
    if (button.dataset.tab) {
        activeTab = button.dataset.tab;
        setupMode = false;
        renderPanel();
        return;
    }
    const action = button.dataset.action;
    if (action === 'close') togglePanel(false);
    if (action === 'open-setup') { setupMode = true; renderPanel(); }
    if (action === 'back-welcome') { setupMode = false; renderPanel(); }
    if (action === 'open-console') { setupMode = true; renderPanel(); }
    if (action === 'start-first-scene') void startFirstScene();
    if (action === 'export') exportState();
    if (action === 'import') panel.querySelector('#cwrpc-import-file')?.click();
    if (action === 'reset') resetState();
    if (action === 'delete-roll') {
        state.rolls = state.rolls.filter(roll => roll.id !== button.dataset.id);
        saveState();
        renderPanel();
    }
    if (action === 'delete-note') {
        state.notes = state.notes.filter(note => note.id !== button.dataset.id);
        saveState();
        renderPanel();
    }
}

function handleChange(event) {
    if (event.target.id === 'cwrpc-import-file') {
        void importState(event.target.files?.[0]);
        event.target.value = '';
        return;
    }
    if (event.target.matches('[data-field]')) readStateFields();
}

function handleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    if (form.dataset.form === 'setup') {
        state = normalizeState({
            ...state,
            enabled: true,
            setupComplete: true,
            campaign: {
                ...state.campaign,
                name: form.elements.campaignName.value || DEFAULT_CAMPAIGN_NAME,
                genre: form.elements.genre.value,
                scene: state.campaign.scene || '第一幕尚未开始',
                goal: state.campaign.goal || '探索故事的开端',
                started: false,
            },
            character: {
                ...state.character,
                name: form.elements.characterName.value,
                concept: form.elements.concept.value,
            },
        });
        setupMode = false;
        saveState();
        renderPanel();
    }
    if (form.dataset.form === 'roll') {
        try {
            const result = rollDice(form.elements.formula.value, form.elements.difficulty.value);
            state.rolls.push({ ...result, id: makeId('roll'), at: new Date().toISOString(), label: form.elements.label.value });
            state = normalizeState(state);
            saveState();
            renderPanel();
        } catch (error) {
            notify('error', error.message);
        }
    }
    if (form.dataset.form === 'note') {
        const name = form.elements.name.value.trim();
        if (!name) return;
        state.notes.push({ id: makeId('note'), type: form.elements.type.value, name, detail: form.elements.detail.value });
        state = normalizeState(state);
        saveState();
        renderPanel();
    }
}

async function startFirstScene() {
    if (!state.enabled || startingFirstScene) return;
    const context = getContext();
    if (typeof context?.generate !== 'function') {
        notify('error', '当前 SillyTavern 没有可用的原生发送能力，请刷新后重试。');
        return;
    }
    if (context.onlineStatus === 'no_connection') {
        notify('warning', '请先在酒馆连接模型，再开始第一幕。');
        return;
    }
    const textarea = document.querySelector('#send_textarea');
    if (!textarea) {
        notify('error', '没有找到酒馆输入框，请刷新后重试。');
        return;
    }
    if (String(textarea.value).trim()) {
        notify('warning', '输入框已有草稿；请先发送或清空它，避免覆盖你的文字。');
        return;
    }
    const openingText = buildOpeningText(state);
    if (!openingText) return;
    startingFirstScene = true;
    renderPanel();
    textarea.value = openingText;
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    state.campaign.started = true;
    saveState();
    try {
        await context.generate('normal');
    } catch (error) {
        state.campaign.started = false;
        saveState();
        notify('error', `第一幕没有发出：${error.message}`);
    } finally {
        startingFirstScene = false;
        renderPanel();
    }
}

function resetState() {
    if (!window.confirm('只结束并清空当前聊天的跑团状态、骰子与记录，继续吗？')) return;
    state = createDefaultState();
    activeTab = 'state';
    setupMode = false;
    saveState();
    renderPanel();
}

function exportState() {
    const payload = { format: 'candy-w-rpg-console', version: 2, exportedAt: new Date().toISOString(), state };
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${(state.campaign.name || '跑团状态').replace(/[^\w\-一-龥]+/g, '_')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
}

async function importState(file) {
    if (!file) return;
    try {
        const payload = JSON.parse(await file.text());
        const imported = payload?.format === 'candy-w-rpg-console' ? payload.state : payload;
        state = normalizeState(imported);
        setupMode = false;
        saveState();
        renderPanel();
        notify('success', '已导入到当前聊天');
    } catch (error) {
        notify('error', `导入失败：${error.message}`);
    }
}

function renderSettings() {
    if (document.getElementById('cwrpc-settings')) return;
    const settingsPanel = document.createElement('div');
    settingsPanel.id = 'cwrpc-settings';
    settingsPanel.className = 'extension_container';
    settingsPanel.innerHTML = '<div class="cwrpc-settings-title">Candy W 跑团控制台</div><label><input type="checkbox" data-setting="showButton"> 显示聊天里的跑团入口</label><p>在一个聊天里开一团，AI 会复用当前酒馆模型主持；关闭该聊天的注入时，主持契约和团状态都会停止注入。</p>';
    document.querySelector('#extensions_settings2')?.append(settingsPanel);
    const checkbox = settingsPanel.querySelector('[data-setting="showButton"]');
    checkbox.checked = extension_settings[EXTENSION_NAME]?.showButton !== false;
    checkbox.addEventListener('change', () => {
        extension_settings[EXTENSION_NAME] = { ...DEFAULT_SETTINGS, ...extension_settings[EXTENSION_NAME], showButton: checkbox.checked };
        saveSettingsDebounced();
        updateVisibility();
    });
}

function onChatChanged() {
    state = getChatState();
    activeTab = 'state';
    setupMode = false;
    startingFirstScene = false;
    updatePrompts();
    renderPanel();
}

function init() {
    extension_settings[EXTENSION_NAME] = { ...DEFAULT_SETTINGS, ...extension_settings[EXTENSION_NAME] };
    state = getChatState();
    renderShell();
    updatePrompts();
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.APP_READY, onChatChanged);
}

init();
