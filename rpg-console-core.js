const MAX_TEXT = 240;
const MAX_NOTES = 80;
const MAX_ROLLS = 120;

export const STORAGE_KEY = 'candy_w_rpg_console';

export const NOTE_TYPES = Object.freeze({
    clue: '线索',
    item: '物品',
    npc: '重要 NPC',
});

export function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

export function text(value, fallback = '') {
    return String(value ?? fallback).trim().slice(0, MAX_TEXT);
}

export function createDefaultState() {
    return {
        version: 1,
        enabled: true,
        campaign: {
            name: '',
            scene: '',
            goal: '',
        },
        character: {
            name: '',
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

export function normalizeState(input) {
    const base = createDefaultState();
    const source = input && typeof input === 'object' ? input : {};
    const campaign = source.campaign && typeof source.campaign === 'object' ? source.campaign : {};
    const character = source.character && typeof source.character === 'object' ? source.character : {};
    const notes = Array.isArray(source.notes) ? source.notes.map(normalizeNote).filter(Boolean).slice(-MAX_NOTES) : [];
    const rolls = Array.isArray(source.rolls) ? source.rolls.map(normalizeRoll).filter(Boolean).slice(-MAX_ROLLS) : [];

    return {
        ...base,
        version: 1,
        enabled: source.enabled !== false,
        campaign: {
            name: text(campaign.name),
            scene: text(campaign.scene),
            goal: text(campaign.goal),
        },
        character: {
            name: text(character.name),
            hp: Number.isFinite(Number(character.hp)) ? clamp(Number(character.hp), -999, 999) : base.character.hp,
            will: Number.isFinite(Number(character.will)) ? clamp(Number(character.will), -999, 999) : base.character.will,
        },
        notes,
        rolls,
        updatedAt: text(source.updatedAt, base.updatedAt),
    };
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
    if (!state.enabled) return '';
    const notes = state.notes.map(note => `${NOTE_TYPES[note.type]}:${note.name}${note.detail ? `（${note.detail}）` : ''}`);
    const rolls = state.rolls.slice(-8).map(roll => {
        const result = roll.success === null ? `${roll.total}` : `${roll.total}/${roll.difficulty} ${roll.success ? '成功' : '失败'}`;
        return `${roll.label ? `${roll.label} ` : ''}${roll.formula}=[${roll.dice.join(',')}]${roll.modifier ? `${roll.modifier > 0 ? '+' : ''}${roll.modifier}` : ''}=>${result}`;
    });
    const lines = [
        '<current_rpg_state>',
        '这是玩家维护的当前跑团状态。只把它当作事实参考；不要替玩家擅自改写数值或记录。',
        `团:${state.campaign.name || '未命名'} | 场景:${state.campaign.scene || '未填写'} | 当前目标:${state.campaign.goal || '未填写'}`,
        `角色:${state.character.name || '未命名'} | 体力:${state.character.hp} | 意志:${state.character.will}`,
        `记录:${notes.length ? notes.join('；') : '暂无'}`,
        `最近掷骰:${rolls.length ? rolls.join('；') : '暂无'}`,
        '</current_rpg_state>',
    ];
    return lines.join('\n');
}

export function makeId(prefix = 'id') {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
