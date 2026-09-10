// Skill use is a percentile check. The attempt fixes proficiency before growth.
export const isSkillLearned = entry => entry.kind === 'skill' && (entry.learned ?? entry.value >= entry.learnAt);
export const usableSkills = progression => (progression?.entries ?? []).filter(e => isSkillLearned(e) && e.enabled !== false);
export function skillCheck(skill, move, storyCheck = null) {
    if (!usableSkills({ entries: [skill] }).length) throw new Error('这项技能尚未学会或已停用。');
    const proficiency = Math.max(0, Math.min(100, skill.value));
    return {
        id: `skill_${move.id}`, status: 'required', reason: `尝试使用「${skill.name}」`, attribute: 'skill', formula: 'd100', difficulty: proficiency,
        successStakes: skill.effect || `「${skill.name}」成功触发，按当前行动产生效果。`, failureStakes: `「${skill.name}」本次未触发。`, roll: null,
        skill: { id: skill.id, name: skill.name, moveId: move.id, storyCheckId: storyCheck?.id ?? null },
    };
}
export function validSkillCheck(check) {
    const keys = ['id','status','reason','attribute','formula','difficulty','successStakes','failureStakes','roll','skill'];
    if (!check || Object.keys(check).length !== keys.length || !keys.every(k => Object.hasOwn(check,k))) return false;
    const s = check.skill;
    const id = v => typeof v === 'string' && /^[a-z][a-z0-9_-]{0,119}$/u.test(v);
    const text = (v,n) => typeof v === 'string' && v.trim().length > 0 && v.length <= n;
    if (!s || Object.keys(s).sort().join(',') !== 'id,moveId,name,storyCheckId' || !id(s.id) || !id(s.moveId) || !text(s.name,40) || !(s.storyCheckId === null || id(s.storyCheckId))) return false;
    if (check.id !== `skill_${s.moveId}` || check.attribute !== 'skill' || check.formula !== 'd100' || !Number.isInteger(check.difficulty) || check.difficulty < 0 || check.difficulty > 100 || !text(check.reason,360) || !text(check.successStakes,500) || !text(check.failureStakes,500)) return false;
    if (check.status === 'required') return check.roll === null && check.difficulty < 100;
    const r = check.roll;
    if (check.status !== 'resolved' || !r || Object.keys(r).sort().join(',') !== 'dice,modifier,outcome,total' || !Array.isArray(r.dice) || r.modifier !== 0) return false;
    if (check.difficulty === 100) return r.dice.length === 0 && r.total === 0 && r.outcome === 'success';
    return r.dice.length === 1 && Number.isInteger(r.dice[0]) && r.dice[0] >= 1 && r.dice[0] <= 100 && r.total === r.dice[0] && r.outcome === (r.total <= check.difficulty ? 'success' : 'failure');
}
export function resolveSkillCheck(check, random = Math.random) {
    let dice = [];
    if (check.difficulty < 100) {
        const value = random();
        if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('技能随机源必须返回 [0, 1) 的有限数。');
        dice = [Math.floor(value * 100) + 1];
    }
    const total = dice[0] ?? 0;
    const resolved = { ...structuredClone(check), status: 'resolved', roll: { dice, modifier: 0, total, outcome: total <= check.difficulty ? 'success' : 'failure' } };
    if (!validSkillCheck(resolved)) throw new Error('技能判定结果无效。');
    return resolved;
}
export function skillResultFact(check) {
    return check.difficulty === 100
        ? `技能「${check.skill.name}」熟练度 100，符合条件后直接触发，没有投骰。效果：${check.successStakes}`
        : `技能「${check.skill.name}」熟练度 ${check.difficulty}；公开 d100 点数 ${check.roll.total}，点数不超过熟练度才触发。本次${check.roll.outcome === 'success' ? `触发成功：${check.successStakes}` : '未触发，不得演出技能已经生效'}。骰果不可改写。`;
}
