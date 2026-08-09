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
    buildPrompt,
    createDefaultState,
    makeId,
    normalizeState,
    NOTE_TYPES,
    rollDice,
    STORAGE_KEY,
} from './rpg-console-core.js';

const EXTENSION_NAME = 'candy-w-rpg-console';
const PROMPT_KEY = `${EXTENSION_NAME}.current_state`;
const DEFAULT_SETTINGS = Object.freeze({ showButton: true });

let state = createDefaultState();
let activeTab = 'state';
let panel;
let toggle;
let settingsPanel;

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
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
    updatePrompt();
}

function updatePrompt() {
    const prompt = currentChatAvailable() ? buildPrompt(state) : '';
    setExtensionPrompt(PROMPT_KEY, prompt, extension_prompt_types.IN_PROMPT, 0, false, extension_prompt_roles.SYSTEM);
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
    const status = state.enabled ? '注入开启' : '仅记录，不注入';
    host.innerHTML = `
        <header class="cwrpc-header">
            <div><strong>跑团控制台</strong><small>${escapeHtml(status)}</small></div>
            <button type="button" class="cwrpc-icon" data-action="close" aria-label="关闭">×</button>
        </header>
        <div class="cwrpc-toolbar">
            <label class="cwrpc-switch"><input type="checkbox" data-field="enabled" ${state.enabled ? 'checked' : ''}> <span>注入当前团状态</span></label>
            <button type="button" class="cwrpc-link" data-action="reset">清空本聊天记录</button>
        </div>
        <nav class="cwrpc-tabs" aria-label="控制台分页">
            <button type="button" class="${activeTab === 'state' ? 'active' : ''}" data-tab="state">状态</button>
            <button type="button" class="${activeTab === 'rolls' ? 'active' : ''}" data-tab="rolls">掷骰 <b>${state.rolls.length}</b></button>
            <button type="button" class="${activeTab === 'notes' ? 'active' : ''}" data-tab="notes">记录 <b>${state.notes.length}</b></button>
        </nav>
        <section class="cwrpc-view">${renderView()}</section>
        <footer class="cwrpc-footer"><button type="button" class="cwrpc-link" data-action="export">导出</button><button type="button" class="cwrpc-link" data-action="import">导入</button><input id="cwrpc-import-file" type="file" accept="application/json" hidden></footer>`;
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
    return `
        <form class="cwrpc-form" data-form="state">
            <div class="cwrpc-section-title">这一团</div>
            ${input('团名', 'campaign.name', state.campaign.name)}
            ${input('当前场景', 'campaign.scene', state.campaign.scene)}
            ${input('当前目标', 'campaign.goal', state.campaign.goal)}
            <div class="cwrpc-section-title">玩家角色</div>
            ${input('角色名', 'character.name', state.character.name)}
            <div class="cwrpc-two-col">${input('体力', 'character.hp', state.character.hp, 'number')}${input('意志', 'character.will', state.character.will, 'number')}</div>
            <p class="cwrpc-hint">状态只保存在当前聊天的 metadata，不会改写聊天消息。</p>
        </form>`;
}

function renderRolls() {
    const rows = state.rolls.slice().reverse().map(roll => `<article class="cwrpc-card"><div><strong>${escapeHtml(roll.label || '判定')}</strong><small>${escapeHtml(roll.formula)} · ${new Date(roll.at).toLocaleString()}</small></div><div class="cwrpc-roll-result"><b>${roll.total}</b>${roll.difficulty === null ? '' : `<span class="${roll.success ? 'success' : 'fail'}">${roll.success ? '成功' : '失败'} / ${roll.difficulty}</span>`}</div><button type="button" class="cwrpc-icon cwrpc-card-delete" data-action="delete-roll" data-id="${escapeHtml(roll.id)}" aria-label="删除记录">×</button></article>`).join('');
    return `<form class="cwrpc-form cwrpc-roll-form" data-form="roll"><div class="cwrpc-section-title">公开掷骰</div><div class="cwrpc-two-col"><label class="cwrpc-field"><span>公式</span><input name="formula" value="d20" inputmode="text"></label><label class="cwrpc-field"><span>难度（可选）</span><input name="difficulty" type="number" placeholder="例如 12"></label></div><label class="cwrpc-field"><span>用途（可选）</span><input name="label" placeholder="例如 察觉"></label><button class="cwrpc-primary" type="submit">掷骰并记录</button></form><div class="cwrpc-list">${rows || '<div class="cwrpc-empty small">还没有骰子记录。</div>'}</div>`;
}

function renderNotes() {
    const rows = state.notes.slice().reverse().map(note => `<article class="cwrpc-card"><div><strong><span class="cwrpc-tag">${NOTE_TYPES[note.type]}</span>${escapeHtml(note.name)}</strong><small>${escapeHtml(note.detail || '无补充说明')}</small></div><button type="button" class="cwrpc-icon cwrpc-card-delete" data-action="delete-note" data-id="${escapeHtml(note.id)}" aria-label="删除记录">×</button></article>`).join('');
    return `<form class="cwrpc-form" data-form="note"><div class="cwrpc-section-title">新增记录</div><div class="cwrpc-two-col"><label class="cwrpc-field"><span>类别</span><select name="type"><option value="clue">线索</option><option value="item">物品</option><option value="npc">重要 NPC</option></select></label><label class="cwrpc-field"><span>名称</span><input name="name" required placeholder="例如 银色钥匙"></label></div><label class="cwrpc-field"><span>补充说明</span><input name="detail" placeholder="可选"></label><button class="cwrpc-primary" type="submit">加入记录</button></form><div class="cwrpc-list">${rows || '<div class="cwrpc-empty small">还没有线索、物品或 NPC 记录。</div>'}</div>`;
}

function readStateFields() {
    panel.querySelectorAll('[data-field]').forEach(element => {
        const field = element.dataset.field;
        if (field === 'enabled') state.enabled = element.checked;
        if (field === 'campaign.name') state.campaign.name = element.value;
        if (field === 'campaign.scene') state.campaign.scene = element.value;
        if (field === 'campaign.goal') state.campaign.goal = element.value;
        if (field === 'character.name') state.character.name = element.value;
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
        renderPanel();
        return;
    }
    const action = button.dataset.action;
    if (action === 'close') togglePanel(false);
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
        importState(event.target.files?.[0]);
        event.target.value = '';
        return;
    }
    if (event.target.matches('[data-field]')) readStateFields();
}

function handleSubmit(event) {
    event.preventDefault();
    const form = event.target;
    if (form.dataset.form === 'roll') {
        try {
            const result = rollDice(form.elements.formula.value, form.elements.difficulty.value);
            state.rolls.push({ ...result, id: makeId('roll'), at: new Date().toISOString(), label: form.elements.label.value });
            state = normalizeState(state);
            saveState();
            renderPanel();
        } catch (error) {
            window.toastr?.error?.(error.message) || window.alert(error.message);
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

function resetState() {
    if (!window.confirm('只清空当前聊天的跑团控制台记录，继续吗？')) return;
    state = createDefaultState();
    saveState();
    renderPanel();
}

function exportState() {
    const payload = { format: 'candy-w-rpg-console', version: 1, exportedAt: new Date().toISOString(), state };
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
        saveState();
        renderPanel();
        window.toastr?.success?.('已导入到当前聊天');
    } catch (error) {
        window.toastr?.error?.(`导入失败：${error.message}`) || window.alert(`导入失败：${error.message}`);
    }
}

function renderSettings() {
    if (document.getElementById('cwrpc-settings')) return;
    settingsPanel = document.createElement('div');
    settingsPanel.id = 'cwrpc-settings';
    settingsPanel.className = 'extension_container';
    settingsPanel.innerHTML = '<div class="cwrpc-settings-title">Candy W 跑团控制台</div><label><input type="checkbox" data-setting="showButton"> 显示聊天里的跑团入口</label><p>控制台数据按聊天保存；关闭本聊天的“注入当前团状态”后，仍可继续记录和掷骰。</p>';
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
    updatePrompt();
    renderPanel();
}

function init() {
    extension_settings[EXTENSION_NAME] = { ...DEFAULT_SETTINGS, ...extension_settings[EXTENSION_NAME] };
    state = getChatState();
    renderShell();
    updatePrompt();
    eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
    eventSource.on(event_types.APP_READY, onChatChanged);
}

init();
