export const SCHEMA = 'candy-w-rpg-console/v1';
export const METADATA_KEY = 'candy_w_rpg_console_v1';
export const CONTEXT_SLOT = 'candy-w-rpg-console.v1.context';
export const EXTENSION_NAME = 'candy-w-rpg-console';
export const DEFAULT_CAMPAIGN_NAME = '未命名的团';
export const GENRES = Object.freeze({ modern_mystery: '现代都市悬疑', fantasy_adventure: '奇幻冒险', mature_relationship: '成熟关系剧情', custom: '自定义' });
export const ATTRIBUTES = Object.freeze({ body: '体魄', insight: '洞察', resolve: '意志' });
export const RECORD_TYPES = Object.freeze({ clue: '线索', item: '物品', npc: '重要 NPC' });
export const PHASES = Object.freeze({ UNINITIALIZED: 'uninitialized', READY: 'ready', GENERATING: 'generating', IN_PROGRESS: 'in_progress', ENDED: 'ended' });
export const ACTIONS = Object.freeze({ OPENING: 'opening', CONTINUE: 'continue', CHECK_RESULT: 'check_result' });
export const CONTEXT_MAX_CHARS = 6000;

const MAX_TEXT = 280;
const MAX_RECORDS = 100;
const MAX_CHECKS = 150;
const now = () => new Date().toISOString();
const isObject = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const exactKeys = (value, keys) => isObject(value) && Object.keys(value).length === keys.length && keys.every(key => own(value, key));

export function text(value, fallback = '') { return String(value ?? fallback).trim().slice(0, MAX_TEXT); }
export function makeId(prefix = 'record') { return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`; }
export function clamp(value, min, max) { return Math.min(max, Math.max(min, value)); }

function numeric(value, fallback = 1) {
    const result = Number(value);
    return Number.isFinite(result) ? clamp(result, -2, 4) : fallback;
}

export function createCampaign(input = {}) {
    const genre = own(GENRES, input.genre) ? input.genre : 'modern_mystery';
    return { name: text(input.name, DEFAULT_CAMPAIGN_NAME) || DEFAULT_CAMPAIGN_NAME, genre, customGenre: genre === 'custom' ? text(input.customGenre) : '', objective: text(input.objective), scene: { title: text(input.scene?.title), summary: text(input.scene?.summary) } };
}

export function createPlayer(input = {}) {
    return { name: text(input.name), brief: text(input.brief), attributes: Object.fromEntries(Object.keys(ATTRIBUTES).map(key => [key, numeric(input.attributes?.[key], 1)])), conditions: Array.isArray(input.conditions) ? input.conditions.map(value => text(value)).filter(Boolean).slice(0, 8) : [] };
}

export function createInitialState() {
    return { schema: SCHEMA, version: 1, revision: 0, lifecycle: { phase: PHASES.UNINITIALIZED, pendingAction: null, transaction: null }, campaign: createCampaign(), player: createPlayer(), records: { clues: [], items: [], npcs: [] }, checks: [], updatedAt: now() };
}

function tick(state, patch) { return { ...state, ...patch, revision: state.revision + 1, updatedAt: now() }; }
function validText(value) { return typeof value === 'string' && value.length <= MAX_TEXT; }
function validRecord(record) { return exactKeys(record, ['id', 'name', 'detail', 'createdAt']) && validText(record.id) && Boolean(record.name) && validText(record.name) && validText(record.detail) && validText(record.createdAt); }
function validCheck(check) {
    if (!exactKeys(check, ['id', 'label', 'attribute', 'formula', 'dice', 'diceTotal', 'modifier', 'total', 'difficulty', 'outcome', 'note', 'createdAt']) || !validText(check.id) || !validText(check.label) || !own(ATTRIBUTES, check.attribute) || !validText(check.formula) || !Array.isArray(check.dice) || !Number.isFinite(check.diceTotal) || !Number.isFinite(check.modifier) || check.modifier < -2 || check.modifier > 4 || !Number.isFinite(check.total) || !validText(check.note) || !validText(check.createdAt)) return false;
    let parsed;
    try { parsed = parseDiceFormula(check.formula); } catch { return false; }
    if (check.formula !== parsed.formula) return false;
    if (check.dice.length !== parsed.count || !check.dice.every(value => Number.isInteger(value) && value >= 1 && value <= parsed.sides)) return false;
    if (check.diceTotal !== check.dice.reduce((sum, value) => sum + value, parsed.modifier) || check.total !== check.diceTotal + check.modifier) return false;
    if (check.difficulty === null) return check.outcome === 'unrated';
    if (!Number.isFinite(check.difficulty) || check.difficulty < -50 || check.difficulty > 99) return false;
    return check.outcome === (check.total >= check.difficulty ? 'success' : 'failure');
}

export function validateState(value) {
    if (!exactKeys(value, ['schema', 'version', 'revision', 'lifecycle', 'campaign', 'player', 'records', 'checks', 'updatedAt']) || value.schema !== SCHEMA || value.version !== 1 || !Number.isSafeInteger(value.revision) || value.revision < 0 || !exactKeys(value.lifecycle, ['phase', 'pendingAction', 'transaction']) || !Object.values(PHASES).includes(value.lifecycle.phase) || !exactKeys(value.campaign, ['name', 'genre', 'customGenre', 'objective', 'scene']) || !exactKeys(value.campaign.scene, ['title', 'summary']) || !exactKeys(value.player, ['name', 'brief', 'attributes', 'conditions']) || !exactKeys(value.player.attributes, Object.keys(ATTRIBUTES)) || !exactKeys(value.records, ['clues', 'items', 'npcs']) || !Array.isArray(value.checks) || !validText(value.updatedAt)) return false;
    if (![null, ...Object.values(ACTIONS)].includes(value.lifecycle.pendingAction)) return false;
    if (value.lifecycle.phase === PHASES.GENERATING) {
        const transaction = value.lifecycle.transaction;
        if (!exactKeys(transaction, ['id', 'previousPhase', 'baseRevision', 'startedAt']) || !validText(transaction.id) || ![PHASES.READY, PHASES.IN_PROGRESS].includes(transaction.previousPhase) || !Number.isSafeInteger(transaction.baseRevision) || !validText(transaction.startedAt)) return false;
    } else if (value.lifecycle.transaction !== null || value.lifecycle.pendingAction !== null) return false;
    if (!value.campaign.name || !validText(value.campaign.name) || !own(GENRES, value.campaign.genre) || !validText(value.campaign.customGenre) || !validText(value.campaign.objective) || !validText(value.campaign.scene.title) || !validText(value.campaign.scene.summary)) return false;
    if (!value.player.name || !validText(value.player.name) || !validText(value.player.brief) || !Object.keys(ATTRIBUTES).every(key => Number.isFinite(value.player.attributes[key]) && value.player.attributes[key] >= -2 && value.player.attributes[key] <= 4) || !Array.isArray(value.player.conditions) || value.player.conditions.length > 8 || !value.player.conditions.every(value => Boolean(value) && validText(value))) return false;
    if (!Object.entries(RECORD_TYPES).every(([type]) => Array.isArray(value.records[`${type}s`]) && value.records[`${type}s`].length <= MAX_RECORDS && value.records[`${type}s`].every(validRecord))) return false;
    return value.checks.length <= MAX_CHECKS && value.checks.every(validCheck);
}

export function normalizeState(value) { return validateState(value) ? structuredClone(value) : null; }

export function prepareCampaign(input) {
    const state = createInitialState();
    const prepared = { ...state, revision: 1, lifecycle: { phase: PHASES.READY, pendingAction: null, transaction: null }, campaign: createCampaign(input.campaign), player: createPlayer(input.player), updatedAt: now() };
    if (!prepared.player.name) throw new Error('请填写玩家角色名。');
    return prepared;
}

export function updateState(state, patch) { if (!validateState(state)) throw new Error('跑团状态无效。'); return tick(state, patch); }
export function setScene(state, scene) { return updateState(state, { campaign: { ...state.campaign, scene: { ...state.campaign.scene, title: text(scene.title), summary: text(scene.summary) } } }); }
export function setCampaignDetails(state, details) { return updateState(state, { campaign: { ...state.campaign, name: text(details.name, state.campaign.name) || DEFAULT_CAMPAIGN_NAME, objective: text(details.objective), genre: state.campaign.genre, customGenre: state.campaign.customGenre, scene: state.campaign.scene } }); }
export function setPlayer(state, player) {
    const attributes = Object.fromEntries(Object.keys(ATTRIBUTES).map(key => {
        const value = player.attributes?.[key] ?? state.player.attributes[key];
        if (!Number.isFinite(Number(value))) throw new Error('属性必须是有限数字。');
        return [key, clamp(Number(value), -2, 4)];
    }));
    const name = text(player.name, state.player.name);
    if (!name) throw new Error('请填写玩家角色名。');
    return updateState(state, { player: { ...state.player, name, brief: text(player.brief), attributes, conditions: state.player.conditions } });
}
export function addCondition(state, value) { const condition = text(value); return !condition || state.player.conditions.includes(condition) ? state : updateState(state, { player: { ...state.player, conditions: [...state.player.conditions, condition].slice(0, 8) } }); }
export function removeCondition(state, value) { return updateState(state, { player: { ...state.player, conditions: state.player.conditions.filter(condition => condition !== value) } }); }
export function addRecord(state, type, input) { if (!own(RECORD_TYPES, type)) throw new Error('未知记录类别。'); const name = text(input.name); if (!name) throw new Error('请填写记录名称。'); const bucket = `${type}s`; return updateState(state, { records: { ...state.records, [bucket]: [...state.records[bucket], { id: makeId(type), name, detail: text(input.detail), createdAt: now() }].slice(-MAX_RECORDS) } }); }
export function removeRecord(state, type, id) { if (!own(RECORD_TYPES, type)) throw new Error('未知记录类别。'); const bucket = `${type}s`; return updateState(state, { records: { ...state.records, [bucket]: state.records[bucket].filter(record => record.id !== id) } }); }

export function parseDiceFormula(value) { const formula = String(value ?? '').trim().toLowerCase().replace(/\s+/g, ''); const match = /^(\d*)d(\d+)([+-]\d+)?$/.exec(formula); if (!match) throw new Error('骰子公式应类似 d20、2d6+1 或 1d100-2。'); const count = clamp(Number(match[1] || 1), 1, 20); const sides = clamp(Number(match[2]), 2, 1000); const modifier = clamp(Number(match[3] || 0), -100, 100); return { formula: `${count}d${sides}${modifier === 0 ? '' : modifier > 0 ? `+${modifier}` : modifier}`, count, sides, modifier }; }
export function readDifficulty(value) { if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null; const parsed = typeof value === 'number' ? value : Number(value); if (!Number.isFinite(parsed)) throw new Error('难度必须是有限数字。'); return clamp(parsed, -50, 99); }
export function resolveCheck(state, input, random = Math.random) { const attribute = own(ATTRIBUTES, input.attribute) ? input.attribute : 'resolve'; const parsed = parseDiceFormula(input.formula || 'd20'); const dice = Array.from({ length: parsed.count }, () => Math.floor(random() * parsed.sides) + 1); const diceTotal = dice.reduce((sum, value) => sum + value, parsed.modifier); const difficulty = readDifficulty(input.difficulty); const modifier = state.player.attributes[attribute]; const total = diceTotal + modifier; const check = { id: makeId('check'), label: text(input.label), attribute, formula: parsed.formula, dice, diceTotal, modifier, total, difficulty, outcome: difficulty === null ? 'unrated' : total >= difficulty ? 'success' : 'failure', note: text(input.note), createdAt: now() }; return updateState(state, { checks: [...state.checks, check].slice(-MAX_CHECKS) }); }

export function beginGeneration(state, action, transactionId = makeId('generation')) { if (!Object.values(ACTIONS).includes(action)) throw new Error('未知主持请求。'); if (![PHASES.READY, PHASES.IN_PROGRESS].includes(state.lifecycle.phase)) throw new Error('当前状态不能请求主持人。'); return tick(state, { lifecycle: { phase: PHASES.GENERATING, pendingAction: action, transaction: { id: transactionId, previousPhase: state.lifecycle.phase, baseRevision: state.revision, startedAt: now() } } }); }
export function finishGeneration(state, transactionId) { if (state.lifecycle.phase !== PHASES.GENERATING || state.lifecycle.transaction?.id !== transactionId) throw new Error('主持事务已不匹配。'); return tick(state, { lifecycle: { phase: PHASES.IN_PROGRESS, pendingAction: null, transaction: null } }); }
export function recoverGeneration(state, transactionId = state.lifecycle.transaction?.id) { if (state.lifecycle.phase !== PHASES.GENERATING || state.lifecycle.transaction?.id !== transactionId) return state; return tick(state, { lifecycle: { phase: state.lifecycle.transaction.previousPhase, pendingAction: null, transaction: null } }); }
export function endCampaign(state) { if (state.lifecycle.phase === PHASES.GENERATING) throw new Error('主持人正在生成；请等本次请求结束或停止后再结束本团。'); return updateState(state, { lifecycle: { phase: PHASES.ENDED, pendingAction: null, transaction: null } }); }
