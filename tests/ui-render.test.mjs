import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { normalizeViewModel, renderPanel, renderToggle } from '../src/ui/render.js';

const scenario = {
    id: 'last-train',
    title: '雾港末班车',
    tagline: '今晚，所有离开的路都通向同一座站台。',
    summary: '一封迟到七年的信把你带回雾港。',
    tone: '悬疑',
    duration: '2 小时',
    symbol: '⌁',
    tags: ['雨夜', '旧友'],
};

const playing = {
    enabled: true,
    host: { kind: 'single' },
    phase: 'playing',
    scenario,
    chapter: { number: 2, title: '无人停靠的站台', summary: '你已经抵达北站。' },
    scene: { title: '雨落在废弃站台', description: '远处亮起一束白光。', location: '雾港北站', time: '午夜前' },
    world: {
        objectives: [{ name: '在午夜前找到寄信人' }],
        characters: [{ name: '祁寒川', relation: '旧友', detail: '与你一同前往北站。' }],
        clues: [{ name: '迟到七年的信', detail: '邮戳日期是今天。' }],
        items: [{ name: '寄存柜钥匙', detail: '刻着北站 17。' }],
        crises: [{ name: '末班车即将进站', urgency: '还剩 2 刻' }],
    },
    hiddenDirectorState: {
        finalVillain: '绝不能显示的幕后真相',
        npcAgenda: '绝不能显示的 NPC 计划',
    },
};

test('welcome and scenario selection describe entering a story without future spoilers', () => {
    const empty = { enabled: true, host: { kind: 'single' }, phase: 'empty' };
    const welcome = renderPanel({ viewModel: empty });
    assert.match(welcome, /故事已经写好/);
    assert.match(welcome, /选择一个故事/);
    assert.doesNotMatch(welcome, /团务|让 AI 继续/);

    const library = renderPanel({ viewModel: empty, screen: 'scenarios', scenarios: [scenario], selectedScenarioId: scenario.id });
    assert.match(library, /你想走进哪个世界/);
    assert.match(library, /未来、秘密与结局仍在幕后/);
    assert.match(library, /雾港末班车/);
});

test('custom scenario authoring is a focused creative brief, not a raw schema editor', () => {
    const html = renderPanel({
        viewModel: { enabled: true, host: { kind: 'single' }, phase: 'empty' },
        screen: 'authoring',
        authoringDraft: { title: '月背列车失踪案', premise: '失踪案从终点站开始。' },
    });
    assert.match(html, /把你想走进的世界写下来/);
    assert.match(html, /data-form="write-custom-scenario"/);
    assert.match(html, /name="coreTruth"/);
    assert.match(html, /name="timePressure"/);
    assert.match(html, /写成可玩剧本/);
    assert.match(html, /月背列车失踪案/);
    assert.doesNotMatch(html, /name="schema"|name="secrets"|name="scenes"/);
});

test('world info authoring asks for a desired outcome and optional scan anchors only', () => {
    const html = renderPanel({
        viewModel: { enabled: true, host: { kind: 'single' }, phase: 'empty' },
        screen: 'world-authoring',
        worldAuthoringDraft: { outcome: '在零点前决定潮门去向。', anchors: '雾港, 潮门' },
    });
    assert.match(html, /告诉世界，你想让故事走到哪里/);
    assert.match(html, /data-form="write-world-info-scenario"/);
    assert.match(html, /name="outcome"/);
    assert.match(html, /name="anchors"/);
    assert.match(html, /蓝色扫描词/);
    assert.match(html, /绿色命中的条目/);
    assert.match(html, /按世界书写成剧本/);
    assert.match(html, /在零点前决定潮门去向/);
    assert.doesNotMatch(html, /name="secrets"|name="scenes"/);
});

test('player setup collects relationship and a unique +2 +1 +0 allocation', () => {
    const html = renderPanel({ viewModel: { enabled: true, host: { kind: 'single' }, phase: 'empty' }, screen: 'player', scenarios: [scenario], selectedScenarioId: scenario.id });
    assert.match(html, /name="playerRelationship"/);
    assert.match(html, /与当前角色的关系起点/);
    assert.match(html, /name="attributeBody"/);
    assert.match(html, /name="attributeInsight"/);
    assert.match(html, /name="attributeRapport"/);
    assert.match(html, /身手/);
    assert.match(html, /洞察/);
    assert.match(html, /交涉/);
});

test('playing view projects only known world fields', () => {
    const now = renderPanel({ viewModel: playing, activeTab: 'now' });
    assert.match(now, /雨落在废弃站台/);
    assert.match(now, /末班车即将进站/);
    assert.match(now, /无需点击“继续剧情”/);
    assert.doesNotMatch(now, /绝不能显示/);

    const known = renderPanel({ viewModel: playing, activeTab: 'known' });
    assert.match(known, /祁寒川/);
    assert.match(known, /迟到七年的信/);
    assert.match(known, /寄存柜钥匙/);
    assert.doesNotMatch(known, /NPC 计划/);

    const chapter = renderPanel({ viewModel: playing, activeTab: 'chapter' });
    assert.match(chapter, /第 2 章/);
    assert.match(chapter, /无人停靠的站台/);
});

test('check screen fixes reason, rule, difficulty and both stakes', () => {
    const html = renderPanel({ viewModel: {
        ...playing,
        phase: 'awaiting_check',
        pendingCheck: {
            id: 'check-1',
            reason: '赶在闸门落锁前穿过去',
            attribute: '身手',
            formula: 'd20+2',
            difficulty: 13,
            successStake: '你们一起进入零号站台。',
            failureStake: '闸门把你们隔开。',
        },
    } });
    assert.match(html, /需要一次公开判定/);
    assert.match(html, /赶在闸门落锁前穿过去/);
    assert.match(html, /d20\+2/);
    assert.match(html, /难度 13/);
    assert.match(html, /你们一起进入零号站台/);
    assert.match(html, /闸门把你们隔开/);
    assert.doesNotMatch(html, /type="number"|<select/);
});

test('production director check shape keeps localized attribute and exact plural stakes', () => {
    const html = renderPanel({
        viewModel: {
            enabled: true,
            host: { kind: 'single' },
            phase: 'awaiting_check',
            pendingCheck: {
                id: 'check-archives',
                status: 'required',
                reason: '核对档案',
                attribute: 'insight',
                formula: 'd20',
                difficulty: 12,
                successStakes: '取得完整伪造证据与疏散名单。',
                failureStakes: '只能保住不完整证据。',
                roll: null,
            },
        },
        screen: 'welcome', scenarios: [], selectedScenarioId: '', activeTab: 'now', localError: '', busyAction: '',
    });
    assert.match(html, /洞察/u);
    assert.match(html, /取得完整伪造证据与疏散名单/u);
    assert.match(html, /只能保住不完整证据/u);
});

test('generation, recovery, boundaries, ending and toggle have distinct states', () => {
    assert.match(renderPanel({ viewModel: { ...playing, phase: 'opening' } }), /世界正在醒来/);
    assert.match(renderPanel({ viewModel: { ...playing, phase: 'resolving_check', lastCheck: { result: 16, attribute: '身手', formula: 'd20+2' } } }), /骰声已经落下/);
    assert.match(renderPanel({ viewModel: { ...playing, phase: 'recoverable_error', error: { message: '生成被停止', canRetry: true, canCancel: true } } }), /从这里重试/);
    assert.match(renderPanel({ viewModel: { enabled: true, host: { kind: 'group' }, phase: 'empty' } }), /只服务单人玩家/);
    assert.match(renderPanel({ viewModel: { enabled: false, host: { kind: 'single' }, phase: 'empty' } }), /启用 Candy W/);
    assert.match(renderPanel({ viewModel: { ...playing, phase: 'ended', ending: { title: '驶向黎明' } } }), /故事抵达结局/);
    assert.match(renderToggle(playing), /✦/);
    assert.match(renderToggle(playing), /旅程进行中/);
    assert.doesNotMatch(renderToggle(playing), /进入世界/);
});

test('view-model aliases normalize without exposing unknown private fields', () => {
    const normalized = normalizeViewModel({ status: 'in_progress', chatKind: 'single', publicState: { people: ['林岚'] }, secret: 'hidden' });
    assert.equal(normalized.phase, 'playing');
    assert.equal(normalized.characters[0].name, '林岚');
    assert.equal(Object.hasOwn(normalized, 'secret'), false);
});

test('responsive and accessibility CSS includes touch, focus and reduced-motion rules', async () => {
    const css = await readFile(new URL('../style.css', import.meta.url), 'utf8');
    assert.match(css, /@media \(max-width: 600px\)/);
    assert.match(css, /min-height: 44px/);
    assert.match(css, /#cw-director-toggle \{[\s\S]*?width: 45px;[\s\S]*?height: 45px;[\s\S]*?border-radius: 50%;/);
    assert.doesNotMatch(css, /\.cw-toggle__label/);
    assert.match(css, /:focus-visible/);
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
    assert.match(css, /100dvh/);
});
