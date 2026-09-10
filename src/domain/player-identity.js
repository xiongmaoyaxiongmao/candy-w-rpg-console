import { object, text, nullable, assertContract } from './json-contract.js';

export const PLAYER_NAME_CONTRACT = { ...text(120), pattern: '^[^\\u0000-\\u001f\\u007f]*$' };
export const NAME_CHANGE_CONTRACT = nullable(object({
    name: PLAYER_NAME_CONTRACT,
    source: { type: 'string', enum: ['action', 'story'] },
    evidence: text(400),
}));
const historyContract = { type: 'array', maxItems: 32, items: object({
    previousName: PLAYER_NAME_CONTRACT, name: PLAYER_NAME_CONTRACT,
    revision: { type: 'integer', minimum: 1 }, source: { type: 'string', enum: ['manual', 'action', 'story'] },
}) };
export function validateNameHistory(history, currentName) {
    try { assertContract(history, historyContract); return !history.length || history.at(-1).name === currentName; }
    catch { return false; }
}
export function validateNameChange(change) { try { assertContract(change, NAME_CHANGE_CONTRACT); return true; } catch { return false; } }
export function assertNameChangeEvidence(change, context) {
    assertContract(change, NAME_CHANGE_CONTRACT, '玩家称呼变化');
    if (change === null) return null;
    const source = change.source === 'action' ? context.playerAction : context.recentStory;
    // Equivalent punctuation in a copied quote is still the same evidence.
    const normal = value => String(value ?? '').normalize('NFKC');
    if (!normal(source).includes(normal(change.evidence)) || !normal(change.evidence).includes(normal(change.name))) throw new Error('称呼变化缺少本次行动或最近已完成剧情中的原文依据。');
    if (change.name === context.currentName) throw new Error('当前称呼没有变化时，nameChange 应为 null。');
    return change;
}
export function renamePlayer(player, name, revision, source) {
    assertContract(name, PLAYER_NAME_CONTRACT, '当前称呼');
    const next = structuredClone(player);
    if (name === player.name) return next;
    next.nameHistory = [...(player.nameHistory ?? []), { previousName: player.name, name, revision, source }].slice(-32);
    if (!validateNameHistory(next.nameHistory, name)) throw new Error('称呼变更记录无效。');
    next.name = name;
    return next;
}
export function playerIdentityFacts(player, change = null) {
    const facts = [];
    if (change) facts.push(`玩家本轮采用称呼「${change.name}」，原称呼为「${player.name}」。两者是同一人；后续演出使用新称呼，已有经历继续保留。`);
    if (player.nameHistory?.length) {
        facts.push(`玩家当前称呼是「${change?.name ?? player.name}」。以下旧称呼属于同一个玩家角色，不是其他人物。`);
        for (const oldName of [...new Set(player.nameHistory.map(item => item.previousName))]) facts.push(`玩家曾用称呼：${oldName}。`);
    }
    return facts;
}
