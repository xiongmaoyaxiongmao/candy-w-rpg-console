import { renderChapterModules } from './chapter-modules.js';
import { renderChapterEditor } from './chapter-editor.js';
import { renderCheckControl } from './check-control.js';
import { renderScenarioDocument } from './scenario-document.js';
import { renderPlayerEntries, renderPlayerState, renderPlayerEditor } from './player-progression.js';
import { renderApiSettings } from './api-settings.js';
const PHASE_ALIASES = Object.freeze({
    uninitialized: 'empty',
    no_campaign: 'empty',
    scenario_selection: 'empty',
    prepared: 'ready',
    opening_generation: 'opening',
    active: 'playing',
    in_progress: 'playing',
    waiting_for_check: 'awaiting_check',
    check_required: 'awaiting_check',
    check_generating: 'resolving_check',
    recovering: 'recoverable_error',
    error: 'recoverable_error',
    recoverable: 'recoverable_error',
    complete: 'ended',
    completed: 'ended',
});

const EMPTY_LIST = Object.freeze([]);

export function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    })[character]);
}

function first(...values) {
    return values.find(value => value !== undefined && value !== null);
}

function string(value, fallback = '') {
    if (typeof value === 'string' || typeof value === 'number') return String(value);
    return fallback;
}

function list(...values) {
    const value = values.find(candidate => Array.isArray(candidate));
    return value ?? EMPTY_LIST;
}

function object(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function normalizeNamedEntry(entry, index, prefix) {
    if (typeof entry === 'string') return { id: `${prefix}-${index}`, name: entry, detail: '' };
    const value = object(entry);
    return {
        id: string(first(value.id, value.key), `${prefix}-${index}`),
        name: string(first(value.name, value.title, value.label), '未命名'),
        detail: string(first(value.detail, value.description, value.summary, value.text)),
        relation: string(first(value.relation, value.relationship)),
        status: string(first(value.status, value.state)),
        urgency: string(first(value.urgency, value.time, value.deadline, value.clock)),
    };
}

function normalizeNamedList(values, prefix) {
    return list(values).map((entry, index) => normalizeNamedEntry(entry, index, prefix));
}

function normalizeScenario(scenario, index = 0) {
    const value = object(scenario);
    const tags = list(value.tags, value.tones).map(tag => string(tag)).filter(Boolean);
    return {
        id: string(first(value.id, value.scenarioId), `scenario-${index}`),
        title: string(first(value.title, value.name), '未命名世界'),
        tagline: string(first(value.tagline, value.subtitle)),
        summary: string(first(value.summary, value.description, value.introduction)),
        tone: string(first(value.tone, value.genre)),
        duration: string(first(value.duration, value.length)),
        version: string(value.version),
        symbol: string(first(value.symbol, object(value.cover).symbol), '✦'),
        tags, editable: Boolean(value.editable),
    };
}

function normalizeCheck(check) {
    const value = object(check);
    const rawAttribute = string(first(value.attributeLabel, value.attribute, value.stat), '行动');
    const attribute = value.skill?.name ?? ({ body: '身手', insight: '洞察', rapport: '交涉' })[rawAttribute] ?? rawAttribute;
    return {
        skill: value.skill ?? null,
        id: string(first(value.id, value.checkId)),
        reason: string(first(value.reason, value.label, value.purpose), '前路出现了不确定的风险'),
        attribute,
        formula: string(first(value.formula, value.dice), 'd20'),
        difficulty: first(value.difficulty, value.target, value.dc),
        success: string(first(value.successStakes, value.successStake, value.success, object(value.stakes).success)),
        failure: string(first(value.failureStakes, value.failureStake, value.failure, object(value.stakes).failure)),
        result: value.skill && value.difficulty === 100 ? '直接触发' : first(value.result, value.total, value.roll?.total),
        outcome: string(value.outcome ?? value.roll?.outcome),
    };
}

function normalizeError(error, viewModel) {
    const value = typeof error === 'string' ? { message: error } : object(error);
    return {
        title: string(value.title, '这一幕暂时停住了'),
        message: string(first(value.message, value.detail, viewModel.errorMessage), '导演事务没有完成，你可以从已保存的位置重试。'),
        canRetry: first(value.canRetry, viewModel.canRetry) !== false,
        canCancel: first(value.canCancel, viewModel.canCancel) !== false,
    };
}

export function normalizeViewModel(input) {
    const viewModel = object(input);
    const world = object(first(viewModel.world, viewModel.publicState, viewModel.knownWorld));
    const rawPhase = string(first(viewModel.phase, viewModel.status, object(viewModel.lifecycle).phase), 'empty');
    let phase = PHASE_ALIASES[rawPhase] ?? rawPhase;
    const transaction = object(first(viewModel.transaction, viewModel.pendingTransaction));
    if (phase === 'generating') {
        phase = ['check', 'check_result', 'roll', 'consequence'].includes(string(transaction.kind)) ? 'resolving_check' : 'opening';
    }
    const host = object(first(viewModel.host, viewModel.chat));
    const scenario = normalizeScenario(first(viewModel.scenario, viewModel.campaign, world.scenario));
    const chapterValue = first(viewModel.chapter, world.chapter);
    const chapter = typeof chapterValue === 'string'
        ? { title: chapterValue, number: null, summary: '' }
        : {
            title: string(first(object(chapterValue).title, object(chapterValue).name)),
            number: first(object(chapterValue).number, object(chapterValue).index),
            summary: string(first(object(chapterValue).summary, object(chapterValue).description)),
        };
    const sceneValue = object(first(viewModel.scene, world.scene, viewModel.currentScene));
    const pendingCheck = normalizeCheck(first(viewModel.pendingCheck, world.pendingCheck, viewModel.check));
    const lastCheckValue = first(viewModel.lastCheck, world.lastCheck);
    return {
        contextEvidence: Array.isArray(viewModel.contextEvidence) ? viewModel.contextEvidence : [],
        enabled: viewModel.enabled !== false,
        hostKind: string(first(host.kind, viewModel.chatKind), 'single'),
        phase,
        scenario,
        player: object(first(viewModel.player, world.player)),
        canEditPlayer: viewModel.canEditPlayer === true,
        chapter,
        scene: {
            title: string(first(sceneValue.title, sceneValue.name), '故事正在这里发生'),
            description: string(first(sceneValue.description, sceneValue.summary, sceneValue.text)),
            location: string(sceneValue.location),
            time: string(first(sceneValue.time, sceneValue.timeLabel)),
        },
        objectives: normalizeNamedList(first(world.objectives, world.knownObjectives, viewModel.objectives), 'objective'),
        characters: normalizeNamedList(first(world.characters, world.people, world.knownCharacters, viewModel.characters), 'character'),
        clues: normalizeNamedList(first(world.clues, world.knownClues, viewModel.clues), 'clue'),
        items: normalizeNamedList(first(world.items, world.inventory, viewModel.items), 'item'),
        crises: normalizeNamedList(first(world.crises, world.pressures, world.visibleClocks, viewModel.crises), 'crisis'),
        pendingCheck,
        lastCheck: lastCheckValue ? normalizeCheck(lastCheckValue) : null,
        error: normalizeError(first(viewModel.error, viewModel.recovery), viewModel),
        ending: object(first(viewModel.ending, world.ending, viewModel.conclusion)),
        transaction,
    };
}

function icon(name) {
    const icons = {
        arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>',
        close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>',
        book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A3.5 3.5 0 0 1 7.5 2H20v17H7.5A3.5 3.5 0 0 0 4 22V5.5Zm0 0V19"/></svg>',
        compass: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="m15.5 8.5-2 5-5 2 2-5 5-2Z"/></svg>',
        people: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3"/><path d="M3.5 20v-2.5A4.5 4.5 0 0 1 8 13h2a4.5 4.5 0 0 1 4.5 4.5V20M16 4.5a3 3 0 0 1 0 6M17 13a4 4 0 0 1 3.5 4v3"/></svg>',
        spark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2 1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7L12 2Z"/></svg>',
        bag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 8V5a3 3 0 0 1 6 0v3"/></svg>',
        clue: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>',
        warning: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2.5 20h19L12 3Z"/><path d="M12 9v5m0 3v.1"/></svg>',
        die: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4"/><circle cx="8" cy="8" r="1"/><circle cx="16" cy="8" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="8" cy="16" r="1"/><circle cx="16" cy="16" r="1"/></svg>',
        download: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m-5-5 5 5 5-5M4 20h16"/></svg>',
    };
    return icons[name] ?? icons.spark;
}

function button(label, action, options = {}) {
    const className = options.className ?? 'cw-button cw-button--primary';
    const disabled = options.disabled ? ' disabled' : '';
    const iconMarkup = options.icon ? `<span class="cw-button__icon">${icon(options.icon)}</span>` : '';
    const data = options.data ? Object.entries(options.data).map(([key, value]) => ` data-${key}="${escapeHtml(value)}"`).join('') : '';
    return `<button type="button" class="${className}" data-action="${escapeHtml(action)}"${data}${disabled}>${iconMarkup}<span>${escapeHtml(label)}</span></button>`;
}

function emptyState(message) {
    return `<p class="cw-empty">${escapeHtml(message)}</p>`;
}

function renderNamedCards(entries, kind) {
    if (!entries.length) return emptyState({ characters: '你还没有认识这里的人。', clues: '目前没有已知线索。', items: '你目前没有需要特别记录的物品。' }[kind] ?? '这里暂时没有记录。');
    return `<div class="cw-card-list">${entries.map(entry => `<article class="cw-record-card">
        <div class="cw-record-card__icon">${icon(kind === 'characters' ? 'people' : kind === 'items' ? 'bag' : 'clue')}</div>
        <div><h4>${escapeHtml(entry.name)}</h4>${entry.relation ? `<span class="cw-relation">${escapeHtml(entry.relation)}</span>` : ''}${entry.detail ? `<p>${escapeHtml(entry.detail)}</p>` : ''}${entry.status ? `<small>${escapeHtml(entry.status)}</small>` : ''}</div>
    </article>`).join('')}</div>`;
}

function renderScenarioCard(scenario, selected) {
    const meta = [scenario.tone, scenario.version ? `v${scenario.version}` : ''].filter(Boolean);
    const tags = scenario.tags.length ? `<div class="cw-tags">${scenario.tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : '';
    return `<button type="button" class="cw-scenario-card${selected ? ' is-selected' : ''}" data-action="script-view" data-scenario-id="${escapeHtml(scenario.id)}">
        <span class="cw-scenario-card__art" aria-hidden="true"><b>${escapeHtml(scenario.symbol)}</b></span>
        <span class="cw-scenario-card__body"><span class="cw-scenario-card__meta">${escapeHtml(meta.join(' · ') || '单人剧情')}</span><strong>${escapeHtml(scenario.title)}</strong>${scenario.tagline ? `<em>${escapeHtml(scenario.tagline)}</em>` : ''}${scenario.summary ? `<span>${escapeHtml(scenario.summary)}</span>` : ''}${tags}</span>
        <span class="cw-scenario-card__arrow">${icon('arrow')}</span>
    </button>`;
}

function renderWelcome() {
    return `<section class="cw-hero">
        <div class="cw-hero__sigil" aria-hidden="true">✦</div>
        <p class="cw-eyebrow">Candy W · 单人故事</p>
        <h2>选择一个世界，<br>写下你的故事。</h2>
        <p class="cw-hero__copy">选择已有剧本，或把自己的故事设想与世界书结合。导演安排剧情，当前角色陪你演出，你决定自己的行动。</p>
        <div class="cw-stack">${button('选择一个故事', 'show-scenarios', { icon: 'compass' })}${button('创作我的故事', 'show-authoring', { className: 'cw-button cw-button--secondary', icon: 'spark' })}${button('导入旅程备份', 'import-save', { className: 'cw-button cw-button--secondary', icon: 'book' })}</div>
        <button type="button" class="cw-text-button" data-action="import-scenario">导入剧本包</button>
    </section>`;
}

function renderScenarioLibrary(scenarios, selectedScenarioId, hasCampaign = false, deleted = []) {
    return `<section class="cw-page cw-scenario-library">
        <div class="cw-page-heading"><p class="cw-eyebrow">选择剧本</p><h2>你想走进哪个世界？</h2><p>卡片展示无剧透简介。点击后查看完整剧本，也可以编辑或另存副本。</p></div>
        <div class="cw-script-tools">${hasCampaign ? button('查看当前旅程剧本', 'script-current', { className: 'cw-button cw-button--secondary', icon: 'book' }) : ''}</div><div class="cw-scenario-list">${scenarios.length ? scenarios.map(scenario => `<article class="cw-library-entry">${renderScenarioCard(scenario, scenario.id === selectedScenarioId)}<div class="cw-library-actions">${button('查看完整剧本', 'script-view', { className: 'cw-text-button', data: { 'scenario-id': scenario.id } })}${button(scenario.editable ? '编辑剧本' : '查看 / 另存副本', 'script-edit-open', { className: 'cw-text-button', data: { 'scenario-id': scenario.id } })}${button('设置与绑定', 'setup-open', { className: 'cw-text-button', data: { 'scenario-id': scenario.id } })}${button('删除剧本', 'library-delete', { className: 'cw-text-button', data: { 'scenario-id': scenario.id } })}</div></article>`).join('') : emptyState('还没有可进入的剧本。你可以导入一个严格校验的剧本包。')}</div>
        ${deleted.length?`<details class="cw-deleted-scripts"><summary>已删除的剧本（${deleted.length}）</summary><p>可以恢复；已建立的旅程继续保留。</p>${deleted.map(s=>`<div class="cw-script-tools"><span>${escapeHtml(s.title)}</span>${button('恢复','library-restore',{data:{'scenario-id':s.id}})}</div>`).join('')}</details>`:''}
        <div class="cw-bottom-actions">${button('创作我的故事', 'show-authoring', { className: 'cw-button cw-button--secondary', icon: 'spark' })}${button('导入剧本包', 'import-scenario', { className: 'cw-button cw-button--secondary' })}<button type="button" class="cw-text-button" data-action="back-welcome">返回</button></div>
    </section>`;
}

function renderScenarioAuthoring(draft) {
    const value = name => escapeHtml(string(draft?.[name]));
    const field = (name, label, placeholder, max, rows = 3, required = false) => `<label><span>${label}${required ? '' : ' <small>可选</small>'}</span><textarea name="${name}" maxlength="${max}" rows="${rows}" placeholder="${escapeHtml(placeholder)}"${required ? ' required' : ''}>${value(name)}</textarea></label>`;
    return `<section class="cw-page cw-scenario-authoring">
        <div class="cw-page-heading"><p class="cw-eyebrow">创作我的故事</p><h2>你的故事，也可以发生在世界书里。</h2><p>写下你想经历什么、从哪里开始。导演把它编成剧本，聊天正文仍由主 API 按角色卡和预设演出。</p></div>
        <form class="cw-form" data-form="write-custom-scenario">
            <fieldset class="cw-creation-card"><legend>故事与开场</legend>
                <label><span>剧本名称 <small>可选</small></span><input name="title" maxlength="120" autocomplete="off" value="${value('title')}" placeholder="留空由导演取名"></label>
                ${field('premise', '我想写的故事', '例如：我重返故乡，与旧友修复一座书店，在日常相处中慢慢发现家族往事。', 1600, 4, true)}
                ${field('opening', '我希望这样开场', '例如：从雨停后的书店门口开始。旧友正搬书，看到我时先停下手里的动作；不要一上来就介绍全部背景或安排灾难。', 900, 4)}
                ${field('tone', '氛围与写作感觉', '例如：温柔、慢热、有生活感；先写人物互动', 120, 2)}
            </fieldset>
            ${renderChapterModules(draft?.chapterOutline??[])}
            <fieldset class="cw-creation-card"><legend>结合世界书</legend>
                ${renderCheckControl({name:'useWorldInfo',label:'使用当前聊天的世界书',description:'你的设想决定故事方向，世界书提供已有的人物、地点与规则。',checked:Boolean(draft?.useWorldInfo),controls:'cw-world-anchors'})}
                <div id="cw-world-anchors" ${draft?.useWorldInfo ? '' : 'hidden'}>
                    ${field('anchors', '优先查找的关键词', '人物、地点、组织或物件；用逗号或换行分隔。', 600, 2)}
                    <p class="cw-form-note">按酒馆原生规则读取已激活条目。没有命中时会提示补充关键词，并保留你填写的故事。</p>
                </div>
            </fieldset>
            <details class="cw-creation-card cw-story-details"><summary>更多故事设定 <small>可选，不填由导演补全</small></summary>
                ${field('setting', '舞台与地点', '主要发生在哪里？有哪些你想加入的地点？', 600)}
                ${field('coreTruth', '必须保留的真相与规则', '你希望故事始终遵守的事实，或需要藏在幕后的真相。', 1200)}
                ${field('npcGoals', '人物、关系与心愿', '谁会参与故事？各自想得到什么？', 1400)}
                ${field('timePressure', '时间推进与节奏', '例如：按日常作息慢慢推进，不设置紧迫灾难。', 600)}
                ${field('endings', '期待的走向或结局', '希望故事走向哪里？可以写几个方向，具体选择留给游玩时的你。', 1200)}
            </details>
            <p class="cw-form-note">只需填写故事设想。编写进度会保存，可以停止后继续。新剧本加入剧本库后再建立旅程；已有聊天的固定剧本不会因此改变。</p>
            ${button('写成可玩剧本', 'submit-custom-scenario', { icon: 'spark' })}
        </form>
        <button type="button" class="cw-text-button" data-action="back-scenarios">返回剧本库</button>
    </section>`;
}

function renderPlayerSetup(scenario, draft = {}, entries = [], notice = '', view = {}, issues = []) {

    return `<section class="cw-page cw-player-setup">
        <div class="cw-selected-world"><span aria-hidden="true">${escapeHtml(scenario.symbol)}</span><div><small>独立剧本</small><strong>${escapeHtml(scenario.title)}</strong>${scenario.tagline ? `<p>${escapeHtml(scenario.tagline)}</p>` : ''}</div></div>
        <div class="cw-page-heading"><p class="cw-eyebrow">设置与绑定</p><h2>保存一次，绑定到需要的聊天。</h2><p>剧本与开局设置独立保存在剧本库。同一剧本可绑定多个聊天，各个聊天分别记录剧情进度。</p></div>
        <form class="cw-form" data-form="create-campaign">
            <input type="hidden" name="scenarioId" value="${escapeHtml(scenario.id)}">
            <label><span>开场时的称呼</span><input name="playerName" maxlength="120" autocomplete="off" required value="${escapeHtml(draft.playerName)}" placeholder="故事开始时如何称呼你"></label><p class="cw-form-note">名字可以随剧情改变。明确改名或采用化名后，会在下一轮行动结算时更新；也能在“角色状态”中手动修改。</p>
            <label><span>本剧本的补充设定 <small>可选</small></span><textarea name="playerConcept" maxlength="280" rows="3" placeholder="留空沿用酒馆 Persona；这里只补充本故事身份或背景">${escapeHtml(draft.playerConcept)}</textarea></label>
            <label><span>与当前角色的关系起点 <small>可选</small></span><input name="playerRelationship" maxlength="160" autocomplete="off" value="${escapeHtml(draft.playerRelationship)}" placeholder="例如：七年未见的旧友"></label>
            <input type="hidden" name="attributeBody" value="0"><input type="hidden" name="attributeInsight" value="0"><input type="hidden" name="attributeRapport" value="0">
            <div class="cw-player-generation">${button('根据剧本生成数值与技能', 'write-player-entries', {className:'cw-button cw-button--secondary'})}<button type="button" class="cw-text-button" data-action="undo-generated-entries" hidden>恢复生成前的条目</button><p class="cw-form-note">使用导演 API，生成后可逐项编辑，保存前不会覆盖原设置。</p></div>
            ${renderPlayerEntries(entries, true, issues)}
            <p class="cw-form-note">当前角色卡仍决定与你对话之人的人设、关系与口吻。</p>
            <div class="cw-setup-save"><p class="cw-form-note" data-setup-notice role="status">${escapeHtml(notice || '设置保存在剧本库，不需要导出。')}</p>${button('保存剧本设置', 'save-scenario-setup', { className: 'cw-button cw-button--secondary', icon: 'book' })}${button(view.phase !== 'empty' && view.scenario?.id === scenario.id ? '返回已绑定的聊天' : '保存并绑定当前聊天', view.phase !== 'empty' && view.scenario?.id === scenario.id ? 'back-welcome' : 'submit-create', { icon: 'spark', data: {'review-binding': view.hostKind === 'single' && (['empty','ended'].includes(view.phase) || view.scenario?.id === scenario.id)}, disabled: issues.length > 0 || view.hostKind !== 'single' || !['empty','ended'].includes(view.phase) && view.scenario?.id !== scenario.id })}<p class="cw-form-note">${view.hostKind !== 'single' ? '先保存设置，再打开需要的单角色聊天来绑定。' : !['empty','ended'].includes(view.phase) ? '当前聊天已有剧本。修改开局设置不会重置已经绑定的聊天。' : '绑定后再点“进入世界”才会生成开场。切换到另一个聊天，可再次绑定同一剧本。'}</p></div>
        </form>
        <button type="button" class="cw-text-button" data-action="back-scenarios">重新选剧本</button>
    </section>`;
}

function renderWorldGate(view) {
    return `<section class="cw-world-gate">
        <div class="cw-world-gate__symbol" aria-hidden="true">${escapeHtml(view.scenario.symbol)}</div>
        <p class="cw-eyebrow">已绑定当前聊天 · 尚未开场</p>
        <h2>${escapeHtml(view.scenario.title)}</h2>
        ${view.scenario.tagline ? `<p class="cw-world-gate__tagline">${escapeHtml(view.scenario.tagline)}</p>` : ''}
        <div class="cw-boundary-note"><span>${icon('spark')}</span><p>从这一刻起，世界会记住你的选择。你在聊天里正常说出行动，导演会在幕后推进故事。</p></div>
        ${button('进入世界', 'enter-world', { icon: 'compass' })}
        <button type="button" class="cw-text-button cw-text-button--danger" data-action="end-campaign">放弃这次旅程</button>
    </section>`;
}

function renderGenerating(view, resolvingCheck = false) {
    const title = resolvingCheck ? '骰声已经落下' : '世界正在醒来';
    const copy = resolvingCheck ? '结果已成为事实。导演正在安排它带来的后果……' : '导演正在确认此刻、登场的人与第一件无法忽视的事……';
    return `<section class="cw-generating" aria-live="polite" aria-busy="true">
        <div class="cw-orbit" aria-hidden="true"><span></span><b>✦</b></div>
        <p class="cw-eyebrow">${resolvingCheck ? '后果演出中' : '开场生成中'}</p><h2>${title}</h2><p>${copy}</p>
        ${view.lastCheck ? `<div class="cw-last-roll"><small>${escapeHtml(view.lastCheck.attribute)} · ${escapeHtml(view.lastCheck.formula)}</small><strong>${escapeHtml(view.lastCheck.result ?? '—')}</strong></div>` : ''}
        <p class="cw-muted">可以停止当前生成；已保存的导演事务不会被当作完成。</p>
    </section>`;
}

function renderCrises(crises) {
    if (!crises.length) return '';
    return `<section class="cw-crises" aria-labelledby="cw-crisis-title"><div class="cw-section-heading"><span>${icon('warning')}</span><h3 id="cw-crisis-title">正在逼近</h3></div>${crises.map(crisis => `<article><div><strong>${escapeHtml(crisis.name)}</strong>${crisis.detail ? `<p>${escapeHtml(crisis.detail)}</p>` : ''}</div>${crisis.urgency ? `<span>${escapeHtml(crisis.urgency)}</span>` : ''}</article>`).join('')}</section>`;
}

function renderObjectives(objectives) {
    if (!objectives.length) return emptyState('此刻没有明确写下的目标；你仍可以自由行动。');
    return `<ul class="cw-objectives">${objectives.map(objective => `<li><span aria-hidden="true">◇</span><div><strong>${escapeHtml(objective.name)}</strong>${objective.detail ? `<p>${escapeHtml(objective.detail)}</p>` : ''}</div></li>`).join('')}</ul>`;
}

function renderWorldNow(view) {
    const placeLine = [view.scene.location, view.scene.time].filter(Boolean).join(' · ');
    return `<div class="cw-world-view">
        ${view.contextEvidence.length ? `<details class="cw-context-evidence"><summary>本轮接入内容 · ${view.contextEvidence.length} 项</summary><ul>${view.contextEvidence.map(item => `<li><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.reason)}</span></li>`).join('')}</ul></details>` : ''}
        <section class="cw-scene-card"><p class="cw-eyebrow">此刻${placeLine ? ` · ${escapeHtml(placeLine)}` : ''}</p><h3>${escapeHtml(view.scene.title)}</h3>${view.scene.description ? `<p>${escapeHtml(view.scene.description)}</p>` : ''}</section>
        ${renderCrises(view.crises)}
        <section class="cw-known-section"><div class="cw-section-heading"><span>${icon('compass')}</span><h3>眼前要做的事</h3></div>${renderObjectives(view.objectives)}</section>
        ${view.lastCheck ? `<section class="cw-outcome-note"><span>${icon('die')}</span><div><small>最近的公开判定</small><strong>${escapeHtml(view.lastCheck.reason)}</strong><p>${escapeHtml(view.lastCheck.attribute)} · ${escapeHtml(view.lastCheck.formula)}${view.lastCheck.result !== null && view.lastCheck.result !== undefined ? ` → ${escapeHtml(view.lastCheck.result)}` : ''}</p></div></section>` : ''}
        <p class="cw-chat-hint">回到聊天，像平常一样说出你要做什么。无需点击“继续剧情”。</p>
    </div>`;
}

function renderKnownWorld(view) {
    return `<div class="cw-known-world">
        <section class="cw-known-section"><div class="cw-section-heading"><span>${icon('people')}</span><h3>认识的人与关系</h3></div>${renderNamedCards(view.characters, 'characters')}</section>
        <section class="cw-known-section"><div class="cw-section-heading"><span>${icon('clue')}</span><h3>已知线索</h3></div>${renderNamedCards(view.clues, 'clues')}</section>
        <section class="cw-known-section"><div class="cw-section-heading"><span>${icon('bag')}</span><h3>随身与重要物品</h3></div>${renderNamedCards(view.items, 'items')}</section>
    </div>`;
}

function renderChapter(view) {
    const number = view.chapter.number !== null && view.chapter.number !== undefined ? `第 ${escapeHtml(view.chapter.number)} 章` : '当前章节';
    return `<div class="cw-chapter-view"><div class="cw-chapter-mark" aria-hidden="true">${escapeHtml(view.chapter.number ?? '✦')}</div><p class="cw-eyebrow">${number}</p><h3>${escapeHtml(view.chapter.title || view.scenario.title)}</h3>${view.chapter.summary ? `<p>${escapeHtml(view.chapter.summary)}</p>` : '<p class="cw-muted">章节会随着已经发生的事实更新，不会提前揭示未来。</p>'}${button('中途加入章节', 'chapter-open')}</div>`;
}

function renderPlaying(view, activeTab) {
    const tabs = [
        ['now', '故事'],
        ['known', '已知世界'],
        ['chapter', '章节'],
    ];
    return `<section class="cw-play-shell">
        <header class="cw-world-header"><div><small>${escapeHtml(view.scenario.title)}</small><strong>${escapeHtml(view.chapter.title || '旅程进行中')}</strong></div><span class="cw-live-pill"><i></i>世界在前进</span></header>
        <nav class="cw-tabs" aria-label="世界记录">${tabs.map(([key, label]) => `<button type="button" data-action="set-tab" data-tab="${key}" class="${activeTab === key ? 'is-active' : ''}" aria-current="${activeTab === key ? 'page' : 'false'}">${label}</button>`).join('')}</nav>
        <div class="cw-scroll-region">${activeTab === 'known' ? renderKnownWorld(view) : activeTab === 'chapter' ? renderChapter(view) : renderWorldNow(view)}</div>
        <footer class="cw-world-footer">${button('导出旅程备份', 'export-save', { className: 'cw-icon-label-button', icon: 'download' })}<button type="button" class="cw-text-button cw-text-button--danger" data-action="end-campaign">结束旅程</button></footer>
    </section>`;
}

function renderPendingCheck(view) {
    const check = view.pendingCheck;
    const difficulty = check.skill ? `点数 ≤ ${check.difficulty}，触发概率 ${check.difficulty}%` : check.difficulty === null || check.difficulty === undefined || check.difficulty === '' ? '由剧本规则确定' : `难度 ${check.difficulty}`;
    return `<section class="cw-check-screen">
        <div class="cw-check-screen__icon">${icon('die')}</div><p class="cw-eyebrow">需要一次公开判定</p><h2>${escapeHtml(check.reason)}</h2>
        <div class="cw-check-rule${check.skill ? ' cw-check-rule--skill' : ''}"><div><small>使用</small><strong>${escapeHtml(check.attribute)}</strong></div><div><small>投掷</small><strong>${escapeHtml(check.formula)}</strong></div><div><small>目标</small><strong>${escapeHtml(difficulty)}</strong></div></div>
        <div class="cw-stakes"><article class="cw-stake cw-stake--success"><small>成功时</small><p>${escapeHtml(check.success || '你会争取到想要的进展。')}</p></article><article class="cw-stake cw-stake--failure"><small>失败时</small><p>${escapeHtml(check.failure || '世界会推进一个明确的代价。')}</p></article></div>
        <p class="cw-check-fact">骰子一旦落下，结果会成为不可改写的剧情事实。</p>
        ${button('公开投骰', 'roll-check', { icon: 'die' })}
    </section>`;
}

function renderRecoverableError(view) {
    return `<section class="cw-error-screen" role="alert">
        <div class="cw-error-screen__icon">${icon('warning')}</div><p class="cw-eyebrow">已停在安全位置</p><h2>${escapeHtml(view.error.title)}</h2><p>${escapeHtml(view.error.message)}</p>
        <div class="cw-boundary-note"><span>${icon('book')}</span><p>已经提交的事实仍然保留；重试不会让时间或 NPC 行动重复推进。</p></div>
        <div class="cw-stack">${view.error.canRetry ? button('从这里重试', 'retry-pending') : ''}${view.error.canCancel ? button('放弃这次未完成的推进', 'cancel-pending', { className: 'cw-button cw-button--secondary' }) : ''}</div>
    </section>`;
}

function renderEnded(view) {
    const ending = view.ending;
    return `<section class="cw-ending">
        <div class="cw-ending__mark" aria-hidden="true">✦</div><p class="cw-eyebrow">故事抵达结局</p><h2>${escapeHtml(string(first(ending.title, ending.name), view.scenario.title))}</h2>
        ${string(first(ending.summary, ending.description)) ? `<p class="cw-ending__summary">${escapeHtml(first(ending.summary, ending.description))}</p>` : '<p class="cw-ending__summary">你做过的选择已经留在这个世界里。</p>'}
        ${string(first(ending.epilogue, ending.afterword)) ? `<blockquote>${escapeHtml(first(ending.epilogue, ending.afterword))}</blockquote>` : ''}
        <div class="cw-stack">${button('保存完整旅程', 'export-save', { icon: 'download' })}${button('进入另一个故事', 'show-scenarios', { className: 'cw-button cw-button--secondary', icon: 'compass' })}</div>
    </section>`;
}

function renderHostBoundary(view) {
    if (!view.enabled) return `<section class="cw-boundary-screen"><div class="cw-boundary-screen__icon">${icon('book')}</div><h2>导演已经离场</h2><p>启用 Candy W 后才能进入或继续故事。重新启用不会改写聊天正文。</p>${button('启用 Candy W', 'enable')}</section>`;
    if (view.hostKind === 'group') return `<section class="cw-boundary-screen"><div class="cw-boundary-screen__icon">${icon('people')}</div><h2>请打开一个角色聊天</h2><p>Candy W 只服务单人玩家与当前单个角色聊天，不会在群聊里创建状态或生成内容。</p></section>`;
    if (view.hostKind === 'none') return `<section class="cw-boundary-screen"><div class="cw-boundary-screen__icon">${icon('compass')}</div><h2>先选择同行的角色</h2><p>打开一个单个角色聊天。这个角色会保持角色卡中的人设、关系和口吻，陪你进入故事。</p></section>`;
    return '';
}

export function renderPanel({ playerIssues = [], chapterModules = null, deletedScenarios = [], scriptSectionTitle = null, scriptInlineKey = null, chapterDraft = null, viewModel, screen = 'welcome', scenarios = EMPTY_LIST, selectedScenarioId = '', activeTab = 'now', localError = '', busyAction = '', authoringDraft = {}, apiSettings = {}, authoringJob = null, playerDraft = {}, playerEntries = [], playerEditName = '', scenarioDocument = null, scriptEditing = false, scriptChanges = {}, scriptGroup = '全部', revisionRequest = '', scenarioSetup = null, setupNotice = '', revisionSelection = {mode:'selected',ids:[]} }) {
    const view = normalizeViewModel(viewModel);
    const normalizedScenarios = scenarios.map(normalizeScenario);
    const selectedScenario = normalizedScenarios.find(scenario => scenario.id === selectedScenarioId) ?? normalizedScenarios[0] ?? normalizeScenario({});
    const hostBoundary = renderHostBoundary(view);
    let content = screen === 'api-settings' ? renderApiSettings(apiSettings) : hostBoundary;
    if (view.enabled && screen === 'player') content = renderPlayerSetup(scenarioSetup ? normalizeScenario(scenarioSetup.scenario) : selectedScenario, playerDraft, playerEntries, setupNotice, view, playerIssues);
    if (view.enabled && screen === 'scenarios') content = renderScenarioLibrary(normalizedScenarios, selectedScenarioId, view.phase !== 'empty', deletedScenarios);
    if (view.enabled && screen === 'script') content = renderScenarioDocument(scenarioDocument, { chapterModules, sectionTitle: scriptSectionTitle, inlineKey: scriptInlineKey, editing: scriptEditing, changes: scriptChanges, group: scriptGroup, request: revisionRequest, selection: revisionSelection, canStart: ['empty','ended'].includes(view.phase) && view.hostKind === 'single' });
    if (view.enabled && view.hostKind === 'single' && screen === 'authoring') content = renderScenarioAuthoring(authoringDraft);
    if (!content && screen === 'chapter-editor') content = renderChapterEditor(chapterDraft,busyAction);
    if (!content && screen === 'player-state' && view.phase !== 'empty') content = renderPlayerState(view);
    if (!content && screen === 'player-editor' && view.phase !== 'empty') content = renderPlayerEditor(playerEntries, playerEditName, playerIssues);
    if (!content) {
        if (view.phase === 'empty') {
            if (screen === 'scenarios') content = renderScenarioLibrary(normalizedScenarios, selectedScenarioId);
            else if (screen === 'authoring') content = renderScenarioAuthoring(authoringDraft);
            else if (screen === 'player') content = renderPlayerSetup(selectedScenario, playerDraft, playerEntries, setupNotice, view, playerIssues);
            else content = renderWelcome();
        } else if (view.phase === 'ready') content = renderWorldGate(view);
        else if (view.phase === 'opening') content = renderGenerating(view, false);
        else if (view.phase === 'awaiting_check') content = renderPendingCheck(view);
        else if (view.phase === 'resolving_check') content = renderGenerating(view, true);
        else if (view.phase === 'recoverable_error') content = renderRecoverableError(view);
        else if (view.phase === 'ended') content = renderEnded(view);
        else content = renderPlaying(view, activeTab);
    }
    const title = view.scenario.title && view.phase !== 'empty' ? view.scenario.title : 'Candy W';
    const error = localError ? `<div class="cw-inline-error" role="alert"><span>${escapeHtml(localError)}</span><button type="button" data-action="dismiss-error" aria-label="关闭错误提示">${icon('close')}</button></div>` : '';
    return `<div class="cw-director-shell${busyAction ? ' is-busy' : ''}" data-phase="${escapeHtml(view.phase)}">
        <header class="cw-panel-header"><div><span class="cw-panel-brand">✦</span><div><strong>${escapeHtml(title)}</strong><small>无形导演 · 当前角色演出</small></div></div><button type="button" class="cw-text-button" data-action="show-scenarios">剧本库</button>${view.phase !== 'empty' ? '<button type="button" class="cw-text-button" data-action="player-show">角色状态</button>' : ''}<button type="button" class="cw-text-button cw-api-open" data-action="show-api-settings" aria-label="导演 API 设置">API 设置</button><button type="button" class="cw-icon-button" data-action="close" aria-label="关闭 Candy W">${icon('close')}</button></header>
        ${error}${renderAuthoringJob(authoringJob)}${screen === 'api-settings' && busyAction ? '<div class="cw-api-progress" role="status">正在处理…<button type="button" class="cw-text-button" data-action="cancel-api-request">取消请求</button></div>' : ''}<main class="cw-panel-main" id="cw-director-main" tabindex="-1">${content}</main>
        <input type="file" id="cw-import-scenario" data-file-kind="scenario" accept="application/json,.json" hidden>
        <input type="file" id="cw-import-save" data-file-kind="save" accept="application/json,.json" hidden>
    </div>`;
}

export function renderToggle(viewModel) {
    const view = normalizeViewModel(viewModel);
    const active = !['empty', 'ended'].includes(view.phase);
    return `<span class="cw-toggle__mark" aria-hidden="true">✦</span>${active ? '<i aria-label="旅程进行中"></i>' : ''}`;
}

function renderAuthoringJob(job) {
    if (!job) return '';
    const d = job.diagnostic;
    return `<section class="cw-authoring-progress" aria-label="剧本编写进度"><strong>${escapeHtml(job.title)}</strong>
    <p role="status">${escapeHtml(job.stage)} · 已完成 ${job.completed}${job.total ? `/${job.total}` : ''} 个场景${job.busy ? (job.correcting ? ` · 正在核对并重写（${job.attempt}/${job.attemptLimit}）` : ' · 正在编写') : job.reviewReady ? ' · 待保存' : ' · 可继续'}</p>
    ${job.error ? `<p class="cw-authoring-error">${escapeHtml(job.error)}</p>` : ''}
    ${d ? `<details><summary>查看失败详情</summary><p>接口：${escapeHtml(d.route)} · 模型：${escapeHtml(d.model)}<br>结束原因：${escapeHtml(d.finishReason)} · 输出用量：${escapeHtml(d.usage?.output ?? '未提供')}<br>错误类别：${escapeHtml(d.code)}<br>请求编号：${escapeHtml(d.requestId)}</p></details>` : ''}
    <div class="cw-api-actions">${job.reviewReady ? '<button type="button" class="cw-text-button" data-action="script-review">查看修改版</button><button type="button" class="cw-text-button" data-action="discard-authoring">放弃这份改写</button>' : job.busy ? '<button type="button" class="cw-text-button" data-action="cancel-api-request">停止编写并保留进度</button>' : `<button type="button" class="cw-text-button" data-action="resume-authoring">${job.finalFailed ? '检查并修正问题场景' : '继续编写'}</button><button type="button" class="cw-text-button" data-action="replan-authoring">${job.partialRevision ? '重新改写所选部分' : '重新规划'}</button><button type="button" class="cw-text-button" data-action="discard-authoring">放弃此编写任务</button>`}</div></section>`;
}
