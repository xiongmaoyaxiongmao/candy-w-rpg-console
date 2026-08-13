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
        tags,
        editable: value.editable === true,
    };
}

function normalizeCheck(check) {
    const value = object(check);
    const rawAttribute = string(first(value.attributeLabel, value.attribute, value.stat), '行动');
    const attribute = ({ body: '身手', insight: '洞察', rapport: '交涉' })[rawAttribute] ?? rawAttribute;
    return {
        id: string(first(value.id, value.checkId)),
        reason: string(first(value.reason, value.label, value.purpose), '前路出现了不确定的风险'),
        attribute,
        formula: string(first(value.formula, value.dice), 'd20'),
        difficulty: first(value.difficulty, value.target, value.dc),
        success: string(first(value.successStakes, value.successStake, value.success, object(value.stakes).success)),
        failure: string(first(value.failureStakes, value.failureStake, value.failure, object(value.stakes).failure)),
        result: first(value.result, value.total),
        outcome: string(value.outcome),
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
        enabled: viewModel.enabled !== false,
        hostKind: string(first(host.kind, viewModel.chatKind), 'single'),
        phase,
        scenario,
        player: object(first(viewModel.player, world.player)),
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
    const meta = [scenario.tone, scenario.duration, scenario.version ? `v${scenario.version}` : ''].filter(Boolean);
    const tags = scenario.tags.length ? `<div class="cw-tags">${scenario.tags.map(tag => `<span>${escapeHtml(tag)}</span>`).join('')}</div>` : '';
    return `<button type="button" class="cw-scenario-card${selected ? ' is-selected' : ''}" data-action="select-scenario" data-scenario-id="${escapeHtml(scenario.id)}" aria-pressed="${selected}">
        <span class="cw-scenario-card__art" aria-hidden="true"><b>${escapeHtml(scenario.symbol)}</b></span>
        <span class="cw-scenario-card__body"><span class="cw-scenario-card__meta">${escapeHtml(meta.join(' · ') || '单人剧情')}</span><strong>${escapeHtml(scenario.title)}</strong>${scenario.tagline ? `<em>${escapeHtml(scenario.tagline)}</em>` : ''}${scenario.summary ? `<span>${escapeHtml(scenario.summary)}</span>` : ''}${tags}</span>
        <span class="cw-scenario-card__arrow">${icon('arrow')}</span>
    </button>`;
}

function renderWelcome() {
    return `<section class="cw-hero">
        <div class="cw-hero__sigil" aria-hidden="true">✦</div>
        <p class="cw-eyebrow">Candy W · 单人故事</p>
        <h2>故事已经写好。<br>等你走进去。</h2>
        <p class="cw-hero__copy">你只需要扮演自己。幕后导演记得秘密、时间与每个人真正想要什么，当前角色会把发生的一切演给你看。</p>
        <div class="cw-stack">${button('选择一个故事', 'show-scenarios', { icon: 'compass' })}${button('按世界书写故事', 'show-world-authoring', { className: 'cw-button cw-button--secondary', icon: 'book' })}${button('写一个自己的故事', 'show-authoring', { className: 'cw-button cw-button--secondary', icon: 'spark' })}${button('继续保存的旅程', 'import-save', { className: 'cw-button cw-button--secondary', icon: 'book' })}</div>
        <button type="button" class="cw-text-button" data-action="import-scenario">导入剧本包</button>
    </section>`;
}

function renderScenarioLibrary(scenarios, selectedScenarioId) {
    return `<section class="cw-page cw-scenario-library">
        <div class="cw-page-heading"><p class="cw-eyebrow">选择剧本</p><h2>你想走进哪个世界？</h2><p>这里只有开场前能知道的事。未来、秘密与结局仍在幕后。</p></div>
        <div class="cw-scenario-list">${scenarios.length ? scenarios.map(scenario => renderScenarioCard(scenario, scenario.id === selectedScenarioId)).join('') : emptyState('还没有可进入的剧本。你可以导入一个严格校验的剧本包。')}</div>
        <div class="cw-bottom-actions">${button('按世界书写故事', 'show-world-authoring', { className: 'cw-button cw-button--secondary', icon: 'book' })}${button('写一个自己的故事', 'show-authoring', { className: 'cw-button cw-button--secondary', icon: 'spark' })}${button('导入剧本包', 'import-scenario', { className: 'cw-button cw-button--secondary' })}<button type="button" class="cw-text-button" data-action="back-welcome">返回</button></div>
    </section>`;
}

function renderScenarioAuthoring(draft) {
    const value = name => escapeHtml(string(draft?.[name]));
    const field = (name, label, placeholder, rows = 3, optional = false) => `<label><span>${label}${optional ? ' <small>可选</small>' : ''}</span><textarea name="${name}" maxlength="${name === 'premise' ? 1600 : name === 'npcGoals' ? 1400 : name === 'coreTruth' || name === 'endings' ? 1200 : name === 'opening' ? 900 : name === 'setting' || name === 'timePressure' ? 600 : 120}" rows="${rows}" placeholder="${escapeHtml(placeholder)}"${optional ? '' : ' required'}>${value(name)}</textarea></label>`;
    return `<section class="cw-page cw-scenario-authoring">
        <div class="cw-page-heading"><p class="cw-eyebrow">自定义剧本</p><h2>把你想走进的世界写下来。</h2><p>你写下故事的硬边界与方向；当前连接的模型会把它编成完整、可分支、带秘密和时钟的导演剧本。未通过严格校验就不会保存。</p></div>
        <form class="cw-form" data-form="write-custom-scenario">
            <label><span>剧本名称</span><input name="title" maxlength="120" autocomplete="off" required value="${value('title')}" placeholder="例如：月背列车失踪案"></label>
            ${field('premise', '故事设想', '主角为何踏入这个世界？冲突从哪里开始？', 4)}
            ${field('tone', '氛围与题材', '例如：近未来悬疑、温柔惊悚、古风权谋', 2, true)}
            ${field('setting', '舞台与地点', '故事主要发生在哪里？有哪些关键地点？', 3)}
            ${field('opening', '开场画面', '玩家进入聊天后，最先遇见的人、事或危机。', 3)}
            ${field('coreTruth', '不可改写的真相', '即使玩家绕路也不会改变的核心事实、幕后规则或灾难。', 4)}
            ${field('npcGoals', '关键人物与目的', '写出人物、彼此关系、各自想得到什么，以及至少一个隐藏目的。', 4)}
            ${field('timePressure', '时间压力', '什么事件会按时间自动推进？拖延会带来什么可感知的代价？', 3)}
            ${field('endings', '分支与结局方向', '玩家的决定可以怎样改变过程与结局？至少写两种不同去向。', 4)}
            <p class="cw-form-note">编写不会把草稿、秘密或结果写入聊天正文；只有校验通过的剧本会加入当前设备的剧本库。</p>
            ${button('写成可玩剧本', 'submit-custom-scenario', { icon: 'spark' })}
        </form>
        <button type="button" class="cw-text-button" data-action="back-scenarios">返回剧本库</button>
    </section>`;
}

function renderWorldInfoScenarioAuthoring(draft) {
    const value = name => escapeHtml(string(draft?.[name]));
    return `<section class="cw-page cw-scenario-authoring">
        <div class="cw-page-heading"><p class="cw-eyebrow">世界书剧本</p><h2>告诉世界，你想让故事走到哪里。</h2><p>插件会按原生世界书扫描规则找出与结果相关的条目，再交给当前连接的模型写成完整导演剧本。它不会读取或复制整本世界书。</p></div>
        <form class="cw-form" data-form="write-world-info-scenario">
            <label><span>剧本名称 <small>可选</small></span><input name="title" maxlength="120" autocomplete="off" value="${value('title')}" placeholder="不写也可以，让故事自己取名"></label>
            <label><span>你想要的结果</span><textarea name="outcome" maxlength="1600" rows="5" required placeholder="例如：让主角发现王位继承真相，并在战争爆发前决定把王冠交给谁。">${value('outcome')}</textarea></label>
            <label><span>蓝色扫描词 <small>可选</small></span><textarea name="anchors" maxlength="600" rows="3" placeholder="只用来触发扫描；填人物、地点、组织或物件，例如：王城，王冠，黎明军">${value('anchors')}</textarea></label>
            <p class="cw-form-note">蓝色扫描词只负责触发原生世界书扫描；绿色命中的条目才会作为世界事实交给编剧。没有命中时，系统会提示你补充扫描词，不会用整本世界书硬塞进剧本。</p>
            ${button('按世界书写成剧本', 'submit-world-info-scenario', { icon: 'book' })}
        </form>
        <button type="button" class="cw-text-button" data-action="back-scenarios">返回剧本库</button>
    </section>`;
}

function renderPlayerSetup(scenario) {
    const attributeSelect = (name, label, selected) => `<label class="cw-attribute-field"><span>${label}</span><select name="${name}" aria-label="${label}加值"><option value="2" ${selected === 2 ? 'selected' : ''}>+2</option><option value="1" ${selected === 1 ? 'selected' : ''}>+1</option><option value="0" ${selected === 0 ? 'selected' : ''}>+0</option></select></label>`;
    return `<section class="cw-page cw-player-setup">
        <div class="cw-selected-world"><span aria-hidden="true">${escapeHtml(scenario.symbol)}</span><div><small>你将进入</small><strong>${escapeHtml(scenario.title)}</strong>${scenario.tagline ? `<p>${escapeHtml(scenario.tagline)}</p>` : ''}</div></div>
        <div class="cw-page-heading"><p class="cw-eyebrow">关于你</p><h2>故事该怎样认识你？</h2><p>只写角色进入故事前已经成立的部分。之后的经历会由行动留下。</p></div>
        <form class="cw-form" data-form="create-campaign">
            <input type="hidden" name="scenarioId" value="${escapeHtml(scenario.id)}">
            <label><span>你的名字</span><input name="playerName" maxlength="80" autocomplete="off" required placeholder="故事里如何称呼你"></label>
            <label><span>一句角色设定 <small>可选</small></span><textarea name="playerConcept" maxlength="280" rows="3" placeholder="例如：刚从外地归来的旧宅继承人"></textarea></label>
            <label><span>与当前角色的关系起点 <small>可选</small></span><input name="playerRelationship" maxlength="160" autocomplete="off" placeholder="例如：七年未见的旧友"></label>
            <fieldset class="cw-attributes"><legend>分配行动加值</legend><p>把 +2、+1、+0 各分配一次；它们只在导演明确要求判定时使用。</p><div>${attributeSelect('attributeBody', '身手', 2)}${attributeSelect('attributeInsight', '洞察', 1)}${attributeSelect('attributeRapport', '交涉', 0)}</div></fieldset>
            <p class="cw-form-note">当前角色卡仍决定与你对话之人的人设、关系与口吻。</p>
            ${button('建立旅程', 'submit-create', { icon: 'spark' })}
        </form>
        <div class="cw-bottom-actions">${scenario.editable ? button('修改这个剧本', 'show-revision', { className: 'cw-button cw-button--secondary', icon: 'spark', data: { scenarioId: scenario.id } }) : ''}<button type="button" class="cw-text-button" data-action="back-scenarios">重新选剧本</button></div>
    </section>`;
}

function renderScenarioRevision(scenario, draft) {
    const instruction = escapeHtml(string(draft?.instruction));
    return `<section class="cw-page cw-scenario-authoring">
        <div class="cw-page-heading"><p class="cw-eyebrow">修改剧本</p><h2>想让这个世界哪里不一样？</h2><p>写下要改的内容，例如结局、人物动机、事件顺序或判定风险。系统会重写完整剧本并重新校验；已开始的旅程仍使用它们自己的旧快照。</p></div>
        <form class="cw-form" data-form="revise-scenario">
            <input type="hidden" name="scenarioId" value="${escapeHtml(string(draft?.scenarioId || scenario.id))}">
            <label><span>修改说明</span><textarea name="instruction" maxlength="1600" rows="7" required placeholder="例如：把最终决定改为救旧港，但让魏朔的动机更有说服力；保留所有判定与倒计时。">${instruction}</textarea></label>
            <p class="cw-form-note">只有校验通过的新版本会替换剧本库中的这份剧本；当前进行中的旅程不会被改变。</p>
            ${button('重写并保存剧本', 'submit-scenario-revision', { icon: 'spark' })}
        </form>
        <button type="button" class="cw-text-button" data-action="back-scenarios">返回剧本库</button>
    </section>`;
}

function renderWorldGate(view) {
    return `<section class="cw-world-gate">
        <div class="cw-world-gate__symbol" aria-hidden="true">${escapeHtml(view.scenario.symbol)}</div>
        <p class="cw-eyebrow">旅程已经准备好</p>
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
    return `<div class="cw-chapter-view"><div class="cw-chapter-mark" aria-hidden="true">${escapeHtml(view.chapter.number ?? '✦')}</div><p class="cw-eyebrow">${number}</p><h3>${escapeHtml(view.chapter.title || view.scenario.title)}</h3>${view.chapter.summary ? `<p>${escapeHtml(view.chapter.summary)}</p>` : '<p class="cw-muted">章节会随着已经发生的事实更新，不会提前揭示未来。</p>'}</div>`;
}

function renderPlaying(view, activeTab) {
    const tabs = [
        ['now', '此刻'],
        ['known', '已知世界'],
        ['chapter', '章节'],
    ];
    return `<section class="cw-play-shell">
        <header class="cw-world-header"><div><small>${escapeHtml(view.scenario.title)}</small><strong>${escapeHtml(view.chapter.title || '旅程进行中')}</strong></div><span class="cw-live-pill"><i></i>世界在前进</span></header>
        <nav class="cw-tabs" aria-label="世界记录">${tabs.map(([key, label]) => `<button type="button" data-action="set-tab" data-tab="${key}" class="${activeTab === key ? 'is-active' : ''}" aria-current="${activeTab === key ? 'page' : 'false'}">${label}</button>`).join('')}</nav>
        <div class="cw-scroll-region">${activeTab === 'known' ? renderKnownWorld(view) : activeTab === 'chapter' ? renderChapter(view) : renderWorldNow(view)}</div>
        <footer class="cw-world-footer">${button('保存旅程', 'export-save', { className: 'cw-icon-label-button', icon: 'download' })}<button type="button" class="cw-text-button cw-text-button--danger" data-action="end-campaign">结束旅程</button></footer>
    </section>`;
}

function renderPendingCheck(view) {
    const check = view.pendingCheck;
    const difficulty = check.difficulty === null || check.difficulty === undefined || check.difficulty === '' ? '由剧本规则确定' : `难度 ${check.difficulty}`;
    return `<section class="cw-check-screen">
        <div class="cw-check-screen__icon">${icon('die')}</div><p class="cw-eyebrow">需要一次公开判定</p><h2>${escapeHtml(check.reason)}</h2>
        <div class="cw-check-rule"><div><small>使用</small><strong>${escapeHtml(check.attribute)}</strong></div><div><small>投掷</small><strong>${escapeHtml(check.formula)}</strong></div><div><small>目标</small><strong>${escapeHtml(difficulty)}</strong></div></div>
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

export function renderPanel({ viewModel, screen = 'welcome', scenarios = EMPTY_LIST, selectedScenarioId = '', activeTab = 'now', localError = '', busyAction = '', authoringDraft = {}, worldAuthoringDraft = {}, revisionDraft = {} }) {
    const view = normalizeViewModel(viewModel);
    const normalizedScenarios = scenarios.map(normalizeScenario);
    const selectedScenario = normalizedScenarios.find(scenario => scenario.id === selectedScenarioId) ?? normalizedScenarios[0] ?? normalizeScenario({});
    const hostBoundary = renderHostBoundary(view);
    let content = hostBoundary;
    if (!content) {
        if (view.phase === 'empty') {
            if (screen === 'scenarios') content = renderScenarioLibrary(normalizedScenarios, selectedScenarioId);
            else if (screen === 'authoring') content = renderScenarioAuthoring(authoringDraft);
            else if (screen === 'world-authoring') content = renderWorldInfoScenarioAuthoring(worldAuthoringDraft);
            else if (screen === 'revision' && selectedScenario.editable) content = renderScenarioRevision(selectedScenario, revisionDraft);
            else if (screen === 'player') content = renderPlayerSetup(selectedScenario);
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
        <header class="cw-panel-header"><div><span class="cw-panel-brand">✦</span><div><strong>${escapeHtml(title)}</strong><small>无形导演 · 当前角色演出</small></div></div><button type="button" class="cw-icon-button" data-action="close" aria-label="关闭 Candy W">${icon('close')}</button></header>
        ${error}<main class="cw-panel-main" id="cw-director-main" tabindex="-1">${content}</main>
        <input type="file" id="cw-import-scenario" data-file-kind="scenario" accept="application/json,.json" hidden>
        <input type="file" id="cw-import-save" data-file-kind="save" accept="application/json,.json" hidden>
    </div>`;
}

export function renderToggle(viewModel) {
    const view = normalizeViewModel(viewModel);
    const active = !['empty', 'ended'].includes(view.phase);
    return `<span class="cw-toggle__mark" aria-hidden="true">✦</span>${active ? '<i aria-label="旅程进行中"></i>' : ''}`;
}
