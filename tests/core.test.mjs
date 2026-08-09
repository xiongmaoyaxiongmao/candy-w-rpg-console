import assert from 'node:assert/strict';
import { buildPrompt, normalizeState, parseDiceFormula, rollDice } from '../rpg-console-core.js';

assert.deepEqual(parseDiceFormula(' 2d6 + 1 '), { formula: '2d6+1', count: 2, sides: 6, modifier: 1 });
assert.deepEqual(rollDice('d20', 12, () => 0.55), {
    formula: '1d20', dice: [12], modifier: 0, total: 12, difficulty: 12, success: true,
});
assert.throws(() => parseDiceFormula('percentile'), /骰子公式/);

const state = normalizeState({ campaign: { name: '示例团', scene: '测试场景', goal: '完成示例目标' }, character: { name: '测试角色', hp: 7, will: 9 }, notes: [{ type: 'item', name: '示例物品' }], rolls: [{ formula: 'd20', dice: [18], total: 18, difficulty: 12 }] });
const prompt = buildPrompt(state);
assert.match(prompt, /<current_rpg_state>/);
assert.match(prompt, /示例团/);
assert.match(prompt, /示例物品/);
assert.match(prompt, /18\/12 成功/);
assert.equal(buildPrompt({ ...state, enabled: false }), '');
console.log('core tests passed');
