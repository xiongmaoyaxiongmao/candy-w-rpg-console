import { createProgression } from './player-progression.js';
const record = v => v && typeof v === 'object' && !Array.isArray(v);
const keys = (v, names) => record(v) && Object.keys(v).length === names.length && names.every(k => Object.hasOwn(v, k));
const text = (v, max) => typeof v === 'string' && v.length <= max && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(v);
const numberDraft = v => text(v, 32) || typeof v === 'number' && Number.isFinite(v);
const id = v => typeof v === 'string' && /^[A-Za-z][A-Za-z0-9_-]{0,79}$/u.test(v);

// Drafts allow blank fields and incomplete numeric values; playable state is
// validated separately when the player explicitly establishes the journey.
export function validateSetupFields(player, entries) {
    if (!keys(player, ['playerName', 'playerConcept', 'playerRelationship', 'attributeBody', 'attributeInsight', 'attributeRapport'])
        || !text(player.playerName, 120) || !text(player.playerConcept, 280) || !text(player.playerRelationship, 160)
        || !['attributeBody', 'attributeInsight', 'attributeRapport'].every(k => ['0', '1', '2'].includes(String(player[k])))
        || !Array.isArray(entries) || entries.length > 12) return false;
    const ids = new Set();
    const unique = value => { if (!id(value) || ids.has(value)) return false; ids.add(value); return true; };
    return entries.every(e => keys(e, ['id', 'kind', 'name', 'value', 'min', 'max', 'learnAt', 'rules', 'thresholds', ...['effect','condition','enabled','learned'].filter(k => Object.hasOwn(e,k))])
        && (!Object.hasOwn(e,'effect') || text(e.effect,240)) && (!Object.hasOwn(e,'condition') || text(e.condition,200)) && (!Object.hasOwn(e,'enabled') || typeof e.enabled === 'boolean') && (!Object.hasOwn(e,'learned') || (e.kind === 'skill' ? typeof e.learned === 'boolean' : e.learned === null))
        && unique(e.id) && ['resource', 'skill'].includes(e.kind) && text(e.name, 40)
        && [e.value, e.min, e.max].every(numberDraft) && (e.kind === 'resource' ? e.learnAt === null : numberDraft(e.learnAt))
        && Array.isArray(e.rules) && e.rules.length <= 4
        && e.rules.every(r => keys(r, ['id', 'condition', 'delta', 'timing']) && unique(r.id) && text(r.condition, 200) && numberDraft(r.delta) && ['action', 'success', 'failure'].includes(r.timing))
        && Array.isArray(e.thresholds) && e.thresholds.length <= 4
        && e.thresholds.every(t => keys(t, ['id', 'operator', 'value', 'reaction', 'mode']) && unique(t.id) && ['gte', 'lte'].includes(t.operator) && numberDraft(t.value) && text(t.reaction, 240) && ['while', 'cross', 'once'].includes(t.mode)));
}

export function defaultScenarioSetup() {
 return { playerDraft: { playerName: '', playerConcept: '', playerRelationship: '', attributeBody: '0', attributeInsight: '0', attributeRapport: '0' }, playerEntries: [] };
}
export function playerFromScenarioSetup(setup) {
 const d = setup.playerDraft;
 if (!d.playerName.trim()) throw new Error('请先填写开场时的称呼，再绑定聊天。');
 const attributes = { body: Number(d.attributeBody), insight: Number(d.attributeInsight), rapport: Number(d.attributeRapport) };

 const num = value => String(value).trim() === '' ? NaN : Number(value);
 const entries = setup.playerEntries.map(e => ({ ...e, name: e.name.trim(), value: num(e.value), min: num(e.min), max: num(e.max), learnAt: e.kind === 'skill' ? num(e.learnAt) : null,
  rules: e.rules.map(r => ({...r,condition:r.condition.trim(),delta:num(r.delta)})),
  thresholds: e.thresholds.map(t => ({...t,reaction:t.reaction.trim(),value:num(t.value)})) }));
 return { name:d.playerName.trim(), concept:d.playerConcept.trim().replace(/\s+/gu,' '), relationship:d.playerRelationship.trim().replace(/\s+/gu,' '), attributes, progression:createProgression(entries) };
}
