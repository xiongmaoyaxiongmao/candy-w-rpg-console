const MAX_TEXT = 240;
const MAX_NOTES = 80;
const MAX_ROLLS = 120;

export const STORAGE_KEY = 'candy_w_rpg_console';
export const DEFAULT_CAMPAIGN_NAME = '新团';

export const NOTE_TYPES = Object.freeze({
    clue: '线索',
    item: '物品',
    npc: '重要 NPC',
});

export const GENRES = Object.freeze({
    modern_mystery: '现代都市悬疑',
    fantasy_adventure: '奇幻冒险',
    mature_relationship: '成熟关系剧情',
    custom: '自定义',
});

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function text(value, fallback = '') {
    return String(value ?? fallback).trim().slice(0, MAX_TEXT);
}

export function createDefaultState() {
    return {
        version: 2,
        enabled: true,
        setupComplete: false,
        campaign: {
            name: '',
            genre: 'modern_mystery',
            scene: '',
            goal: '',
            started: false,
        },
        character: {
            name: '',
            concept: '',
            hp: 10,
            will: 10,
        },
        notes: [],
        rolls: [],
        updatedAt: new Date().toISOString(),
    };
}

function normalizeNote(note, index) {
    if (!note || typeof note !== 'object') return null;
    const type = Object.hasOwn(NOTE_TYPES, note.type) ? note.type : 'clue';
    const name = text(note.name);
    if (!name) return null;
    return {
        id: text(note.id, `note-${index}`) || `note-${index}`,
        type,
        name,
        detail: text(note.detail),
    };
}

function normalizeRoll(roll, index) {
    if (!roll || typeof roll !== 'object') return null;
    const total = Number(roll.total);
    if (!Number.isFinite(total)) return null;
    const difficulty = roll.difficulty === null || roll.difficulty === '' || roll.difficulty === undefined
        ? null
        : Number(roll.difficulty);
    return {
        id: text(roll.id, `roll-${index}`) || `roll-${index}`,
        at: text(roll.at, new Date().toISOString()),
        formula: text(roll.formula, '1d20'),
        dice: Array.isArray(roll.dice) ? roll.dice.slice(0, 20).map(Number).filter(Number.isFinite) : [],
        modifier: Number.isFinite(Number(roll.modifier)) ? Number(roll.modifier) : 0,
        total,
        difficulty: Number.isFinite(difficulty) ? difficulty : null,
        success: difficulty === null ? null : total >= difficulty,
        label: text(roll.label),
    };
}

function inferLegacySetup(source, campaign, character, notes, rolls) {
    if (source.setupComplete !== undefined) return Boolean(source.setupComplete);
    return Boolean(campaign.name || campaign.scene || campaign.goal || character.name || notes.length || rolls.length);
}

export function normalizeState(input) {
    const base = createDefaultState();
    const source = input && typeof input === 'object' ? input : {};
    const campaign = source.campaign && typeof source.campaign === 'object' ? source.campaign : {};
    const character = source.character && typeof source.character === 'object' ? source.character : {};
    const notes = Array.isArray(source.notes) ? source.notes.map(normalizeNote).filter(Boolean).slice(-MAX_NOTES) : [];
    const rolls = Array.isArray(source.rolls) ? source.rolls.map(normalizeRoll).filter(Boolean).slice(-MAX_ROLLS) : [];
    const genre = Object.hasOwn(GENRES, campaign.genre) ? campaign.genre : base.campaign.genre;
    const setupComplete = inferLegacySetup(source, campaign, character, notes, rolls);

    return {
        ...base,
        version: 2,
        enabled: source.enabled !== false,
        setupComplete,
        campaign: {
            name: text(campaign.name),
            genre,
            scene: text(campaign.scene),
            goal: text(campaign.goal),
            started: campaign.started === true || (source.version !== 2 && setupComplete),
        },
        character: {
            name: text(character.name),
            concept: text(character.concept),
            hp: Number.isFinite(Number(character.hp)) ? clamp(Number(character.hp), -999, 999) : base.character.hp,
            will: Number.isFinite(Number(character.will)) ? clamp(Number(character.will), -999, 999) : base.character.will,
        },
        notes,
        rolls,
        updatedAt: text(source.updatedAt, base.updatedAt),
    };
}

export function hasCampaign(stateInput) {
    return normalizeState(stateInput).setupComplete;
}

export function parseDiceFormula(input) {
    const formula = String(input ?? '').trim().toLowerCase().replace(/\s+/g, '');
    const match = /^(\d*)d(\d+)([+-]\d+)?$/.exec(formula);
    if (!match) throw new Error('骰子公式应类似 d20、2d6+1 或 1d100-2');
    const count = clamp(Number(match[1] || 1), 1, 20);
    const sides = clamp(Number(match[2]), 2, 1000);
    const modifier = clamp(Number(match[3] || 0), -100, 100);
    return { formula: `${count}d${sides}${modifier ? (modifier > 0 ? `+${modifier}` : modifier) : ''}`, count, sides, modifier };
}

export function rollDice(input, difficulty = null, random = Math.random) {
    const parsed = parseDiceFormula(input);
    const dice = Array.from({ length: parsed.count }, () => Math.floor(random() * parsed.sides) + 1);
    const total = dice.reduce((sum, value) => sum + value, parsed.modifier);
    const target = difficulty === '' || difficulty === null || difficulty === undefined ? null : Number(difficulty);
    const safeTarget = Number.isFinite(target) ? clamp(target, -999, 999) : null;
    return {
        formula: parsed.formula,
        dice,
        modifier: parsed.modifier,
        total,
        difficulty: safeTarget,
        success: safeTarget === null ? null : total >= safeTarget,
    };
}

export function buildPrompt(stateInput) {
    const state = normalizeState(stateInput);
    if (!state.enabled || !state.setupComplete) return '';
    const notes = state.notes.map(note => `${NOTE_TYPES[note.type]}:${note.name}${note.detail ? `（${note.detail}）` : ''}`);
    const rolls = state.rolls.slice(-8).map(roll => {
        const result = roll.success === null ? `${roll.total}` : `${roll.total}/${roll.difficulty} ${roll.success ? '成功' : '失败'}`;
        return `${roll.label ? `${roll.label} ` : ''}${roll.formula}=[${roll.dice.join(',')}]${roll.modifier ? `${roll.modifier > 0 ? '+' : ''}${roll.modifier}` : ''}=>${result}`;
    });
    return [
        '<current_rpg_state>',
        '这是玩家维护的当前跑团状态。只把它当作事实参考；不要替玩家擅自改写数值或记录。',
        `团:${state.campaign.name || DEFAULT_CAMPAIGN_NAME} | 场景:${state.campaign.scene || '第一幕尚未开始'} | 当前目标:${state.campaign.goal || '探索故事的开端'}`,
        `角色:${state.character.name || '未命名'} | 设定:${state.character.concept || '未填写'} | 体力:${state.character.hp} | 意志:${state.character.will}`,
        `记录:${notes.length ? notes.join('；') : '暂无'}`,
        `最近掷骰:${rolls.length ? rolls.join('；') : '暂无'}`,
        '</current_rpg_state>',
    ].join('\n');
}

export function buildGmPrompt(stateInput) {
    const state = normalizeState(stateInput);
    if (!state.enabled || !state.setupComplete) return '';
    const matureLine = state.campaign.genre === 'mature_relationship'
        ? '本团可自然呈现成年人之间的暧昧、亲密与关系张力；所有参与剧情的人物均为成年人。'
        : '';
    return [
        '<rpg_gm_contract>',
        `你是《${state.campaign.name || DEFAULT_CAMPAIGN_NAME}》的 AI 主持人，题材是${GENRES[state.campaign.genre]}。`,
        '主持场景、NPC 与后果；每次只推进一段可回应的内容。不要替玩家决定行动、想法或感受。',
        '允许玩家自由行动。结果存在不确定性时，明确说明建议的骰子公式和难度，等待玩家在跑团控制台掷骰并把结果告诉你。',
        '读取 <current_rpg_state> 作为已确认事实；不要自行改写其中的数值、线索、物品或 NPC。',
        matureLine,
        '每一段结尾给出清楚的当下局面，并问玩家接下来想做什么。',
        '</rpg_gm_contract>',
    ].filter(Boolean).join('\n');
}

export function buildOpeningText(stateInput) {
    const state = normalizeState(stateInput);
    if (!state.setupComplete) return '';
    return [
        `请依照跑团主持契约，为《${state.campaign.name || DEFAULT_CAMPAIGN_NAME}》开始第一幕。`,
        `玩家角色是${state.character.name || '玩家'}${state.character.concept ? `（${state.character.concept}）` : ''}。`,
        `以符合“${GENRES[state.campaign.genre]}”的具体场景开场，营造可行动的当下局面。`,
        '只推进一段，不替玩家决定行动；最后直接问玩家要做什么。若出现不确定结果，请说明建议骰子公式和难度。',
    ].join('\n');
}

export function makeId(prefix = 'id') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
