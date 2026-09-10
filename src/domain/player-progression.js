import { isSkillLearned } from './skill-check.js';
// Player-owned resources and learnable skills share the director transaction.
// The model selects configured rules; only this module computes numbers.
export const PLAYER_LIMITS = Object.freeze({ entries: 12, rules: 4, thresholds: 4 });
const own = (v, k) => Object.prototype.hasOwnProperty.call(v, k);
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => own(v, k));
const identifier = v => typeof v === 'string' && /^p_[a-z0-9_-]{1,100}$/u.test(v);
const text = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v);
const number = v => Number.isSafeInteger(v) && Math.abs(v) <= 1_000_000;
const strings = (v, max, chars = 500) => Array.isArray(v) && v.length <= max && v.every(s => text(s, chars));
const ids = (v, allowed, max = 48) => Array.isArray(v) && v.length <= max && new Set(v).size === v.length && v.every(id => allowed.has(id));
const clone = v => structuredClone(v);

export function assertPlayerEntries(entries) {
    if (!Array.isArray(entries) || entries.length > PLAYER_LIMITS.entries) throw new Error('角色数值和技能最多添加 12 项。');
    const allIds = new Set(); const names = new Set();
    const addId = id => { if (!identifier(id) || allIds.has(id)) throw new Error('角色数值规则标识重复或无效，请重新添加这一项。'); allIds.add(id); };
    for (const e of entries) {
        if (!exact(e, ['id', 'kind', 'name', 'value', 'min', 'max', 'learnAt', 'rules', 'thresholds', ...['effect','condition','enabled','learned'].filter(k => own(e,k))])) throw new Error('角色数值记录不完整。');
        addId(e.id);
        if (own(e,'enabled') && typeof e.enabled !== 'boolean' || own(e,'learned') && (e.kind === 'skill' ? typeof e.learned !== 'boolean' : e.learned !== null)) throw new Error('技能开关或学习状态无效。');
        if (own(e,'effect') && (e.kind === 'skill' ? !text(e.effect,240) : typeof e.effect !== 'string' || e.effect.length > 240) || own(e,'condition') && (e.kind === 'skill' ? !text(e.condition,200) : typeof e.condition !== 'string' || e.condition.length > 200)) throw new Error('请填写技能的使用条件和触发效果。');
        if (own(e,'learned') && e.kind === 'skill' && (e.min !== 0 || e.max !== 100 || e.learnAt !== 100)) throw new Error('技能熟练度范围固定为 0～100，100 代表熟练掌握。');
        if (!['resource', 'skill'].includes(e.kind) || !text(e.name, 40) || names.has(e.name.trim())) throw new Error('请为每项数值或技能填写不同的名称（最多 40 字）。');
        names.add(e.name.trim());
        if (![e.value, e.min, e.max].every(number) || e.min >= e.max || e.value < e.min || e.value > e.max) throw new Error(`${e.name}：请填写整数，最低值必须小于最高值，当前值须在范围内。`);
        if (e.kind === 'resource' ? e.learnAt !== null : !number(e.learnAt) || e.learnAt <= e.min || e.learnAt > e.max) throw new Error(`${e.name}：学会门槛须高于最低值且不超过最高值。`);
        if (!Array.isArray(e.rules) || e.rules.length > PLAYER_LIMITS.rules || !Array.isArray(e.thresholds) || e.thresholds.length > PLAYER_LIMITS.thresholds) throw new Error(`${e.name}：最多填写 4 条增减规则和 4 条数值反应。`);
        for (const [index, r] of e.rules.entries()) {
            const invalidRule = (message, field = null) => { const error = new Error(`${e.name}：第 ${index + 1} 条增减规则${message}`); error.field = field ? `${r.id}.${field}` : null; throw error; };
            if (!exact(r, ['id', 'condition', 'delta', 'timing'])) invalidRule('内容不完整，请补全或移除这一条。');
            if (!text(r.condition, 200)) invalidRule('需要填写具体的触发条件（200 字以内，不含换行）。', 'condition');
            if (!number(r.delta)) invalidRule('的变化量需要填写整数。', 'delta');
            if (r.delta === 0) invalidRule('的变化量不能为 0；请填写增加或减少的数值，不需要增减就移除这一条。', 'delta');
            if (!['action', 'success', 'failure'].includes(r.timing)) invalidRule('需要选择生效时机。', 'timing');
            addId(r.id);
        }
        for (const t of e.thresholds) {
            if (!exact(t, ['id', 'operator', 'value', 'reaction', 'mode']) || !['gte', 'lte'].includes(t.operator) || !number(t.value) || t.value < e.min || t.value > e.max || !text(t.reaction, 240) || !['once', 'cross', 'while'].includes(t.mode)) throw new Error(`${e.name}：数值反应需填写范围内的门槛、反应描述和触发方式。`);
            addId(t.id);
        }
    }
    return entries;
}

// Draft review reports each affected entry without admitting it into playable state.
export function playerEntryIssues(entries) {
    const issues = [];
    for (const entry of entries) {
        try { assertPlayerEntries([entry]); }
        catch (error) { issues.push({ entryId: entry.id, field: error.field ?? null, message: error.message }); }
    }
    if (!issues.length) {
        try { assertPlayerEntries(entries); }
        catch (error) { issues.push({ entryId: entries[0]?.id ?? null, field: null, message: error.message }); }
    }
    return issues;
}

export const emptyProgression = () => ({ version: 1, entries: [], fired: [], deferred: [], notices: [], log: [] });
export function assertProgression(p) {
    if (!exact(p, ['version', 'entries', 'fired', 'deferred', 'notices', 'log']) || p.version !== 1) throw new Error('角色数值存档格式无效。');
    assertPlayerEntries(p.entries);
    const thresholds = new Set(p.entries.flatMap(e => e.thresholds.filter(t => t.mode === 'once').map(t => t.id)));
    const rules = new Set(p.entries.flatMap(e => e.rules.filter(r => r.timing !== 'action').map(r => r.id)));
    if (!ids(p.fired, thresholds) || !ids(p.deferred, rules) || !strings(p.notices, 96) || !Array.isArray(p.log) || p.log.length > 32 || !p.log.every(l => exact(l, ['revision', 'source', 'details']) && Number.isSafeInteger(l.revision) && l.revision >= 0 && ['action', 'opening', 'check_consequence', 'manual'].includes(l.source) && strings(l.details, 192))) throw new Error('角色数值的变化记录无效。');
    return p;
}
export function validateProgression(p) { try { assertProgression(p); return true; } catch { return false; } }
const applies = (t, value) => t.operator === 'gte' ? value >= t.value : value <= t.value;
const learned = isSkillLearned;
export function playerRuleContext(p) {
    assertProgression(p);
    return p.entries.map(e => ({ id: e.id, enabled: e.enabled !== false, learned: learned(e), effect: e.effect ?? '', condition: e.condition ?? '', name: e.name, kind: e.kind, value: e.value, min: e.min, max: e.max, learnAt: e.learnAt, rules: clone(e.rules) }));
}
export const playerRuleIds = p => (p?.entries ?? []).flatMap(e => e.rules.map(r => r.id));
export function assertSelectedRules(p, selected) {
    if (!ids(selected, new Set(playerRuleIds(p)))) throw new Error('导演选择了未配置或重复的角色增减规则。');
}

function reactions(before, after, p, initial = false, continuous = true) {
    const result = [];
    for (const e of after) {
        if (e.enabled === false) continue;
        const old = before.find(v => v.id === e.id);
        if (learned(e) && (!old || !learned(old))) result.push(`学会技能「${e.name}」：现在可以尝试使用，熟练度 ${Math.min(100,e.value)} 决定触发概率。`);
        for (const t of e.thresholds) {
            if (!applies(t, e.value)) continue;
            const prior = old?.thresholds.find(v => v.id === t.id && JSON.stringify(v) === JSON.stringify(t));
            const entered = initial || !prior || !applies(t, old.value);
            if (t.mode === 'while' && continuous || t.mode === 'cross' && entered || t.mode === 'once' && !p.fired.includes(t.id)) {
                result.push(`${e.name} ${t.operator === 'gte' ? '达到' : '不高于'} ${t.value}：${t.reaction}`);
                if (t.mode === 'once') p.fired.push(t.id);
            }
        }
    }
    return result;
}
function appendLog(p, revision, source, details) {
    if (details.length) p.log = [...p.log, { revision, source, details: [...new Set(details)] }].slice(-32);
}

export function createProgression(entries) {
    const p = emptyProgression(); p.entries = clone(assertPlayerEntries(entries));
    return assertProgression(p);
}

/** Preview is pure; retrying previews never consumes a threshold or a rule. */
export function settleProgression(input, { ruleIds = [], kind, check = null, revision }) {
    const p = clone(assertProgression(input));
    assertSelectedRules(p, ruleIds);
    if (kind !== 'action' && ruleIds.length) throw new Error('这一阶段不能重新选择角色增减规则。');
    const before = clone(p.entries);
    const outcome = kind === 'check_consequence' || check?.status === 'resolved' ? check?.roll?.outcome : null;
    const selected = new Set(kind === 'check_consequence' ? p.deferred : ruleIds);
    const details = [...p.notices]; p.notices = [];
    for (const e of p.entries) {
        const rules = e.rules.filter(r => e.enabled !== false && selected.has(r.id) && (kind === 'action' ? r.timing === 'action' || outcome && r.timing === outcome : r.timing === outcome));
        const delta = rules.reduce((sum, r) => sum + r.delta, 0);
        const previous = e.value;
        e.value = Math.min(e.max, Math.max(e.min, e.value + delta));
        if (rules.length) details.push(`${e.name}：${previous} → ${e.value}（${rules.map(r => r.condition).join('；').slice(0, 280)}）。`);
    }
    if (kind === 'action') p.deferred = check?.status === 'required' ? ruleIds.filter(id => p.entries.some(e => e.rules.some(r => r.id === id && r.timing !== 'action'))) : [];
    if (kind === 'check_consequence') p.deferred = [];
    const effects = [...new Set([...details, ...reactions(before, p.entries, p, kind === 'opening')])];
    appendLog(p, revision, kind, effects);
    return { progression: assertProgression(p), effects, facts: progressionFacts(p) };
}

export function progressionFacts(p) {
    assertProgression(p);
    return p.entries.flatMap(e => e.kind === 'skill'
        ? [`玩家技能「${e.name}」：熟练度 ${Math.min(100,e.value)}/100；${e.enabled === false ? '已停用' : learned(e) ? '已学会；熟练度100直接触发，否则公开d100点数不超过熟练度才触发' : '尚未学会，不能使用'}。`, ...(e.effect ? [`「${e.name}」的效果：${e.effect}`, `「${e.name}」的使用条件：${e.condition}`] : [])]
        : [`玩家数值「${e.name}」：${e.value}（范围 ${e.min}～${e.max}）${e.enabled === false ? '；已停用自动增减' : ''}。`]);
}

export function reviseProgression(input, entries, revision) {
    const p = clone(assertProgression(input));
    if (p.deferred.length) throw new Error('请先完成当前公开判定，再修改角色数值。');
    const before = clone(p.entries);
    p.entries = clone(assertPlayerEntries(entries));
    p.fired = p.fired.filter(id => p.entries.some(e => e.thresholds.some(t => t.id === id && t.mode === 'once' && before.some(old => old.thresholds.some(prior => JSON.stringify(prior) === JSON.stringify(t))))));
    const details = p.entries.flatMap(e => {
        const old = before.find(v => v.id === e.id);
        return !old ? [`添加${e.kind === 'skill' ? '技能' : '数值'}「${e.name}」：${e.value}。`] : old.value !== e.value ? [`手动修正${e.name}：${old.value} → ${e.value}。`] : JSON.stringify(old) !== JSON.stringify(e) ? [`更新「${e.name}」的规则。`] : [];
    });
    details.push(...before.filter(e => !p.entries.some(v => v.id === e.id)).map(e => `移除「${e.name}」。`));
    const effects = reactions(before, p.entries, p, false, false);
    // Continuous reactions are included from the current value each turn, not queued.
    p.notices = [...new Set([...p.notices, ...details, ...effects.map(effect => `此前手动调整触发：${effect}`)])];
    if (p.notices.length > 96) throw new Error('尚未演出的手动调整过多，请先完成一轮剧情再继续修改。');
    appendLog(p, revision, 'manual', [...details, ...effects]);
    return assertProgression(p);
}
