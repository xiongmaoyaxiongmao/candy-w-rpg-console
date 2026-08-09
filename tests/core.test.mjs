import assert from 'node:assert/strict';
import {
    buildGmPrompt,
    buildOpeningText,
    buildPrompt,
    createDefaultState,
    hasCampaign,
    normalizeState,
    parseDiceFormula,
    rollDice,
} from '../rpg-console-core.js';

assert.deepEqual(parseDiceFormula(' 2d6 + 1 '), { formula: '2d6+1', count: 2, sides: 6, modifier: 1 });
assert.deepEqual(rollDice('d20', 12, () => 0.55), {
    formula: '1d20', dice: [12], modifier: 0, total: 12, difficulty: 12, success: true,
});
assert.throws(() => parseDiceFormula('percentile'), /骰子公式/);

const empty = createDefaultState();
assert.equal(hasCampaign(empty), false);
assert.equal(buildPrompt(empty), '');
assert.equal(buildGmPrompt(empty), '');
assert.equal(buildOpeningText(empty), '');

const state = normalizeState({
    version: 2,
    setupComplete: true,
    campaign: { name: '示例团', genre: 'modern_mystery', scene: '测试场景', goal: '完成示例目标' },
    character: { name: '测试角色', concept: '冷静的调查记者', hp: 7, will: 9 },
    notes: [{ type: 'item', name: '示例物品' }],
    rolls: [{ formula: 'd20', dice: [18], total: 18, difficulty: 12 }],
});
const prompt = buildPrompt(state);
const gmPrompt = buildGmPrompt(state);
const opening = buildOpeningText(state);
assert.equal(hasCampaign(state), true);
assert.match(prompt, /<current_rpg_state>/);
assert.match(prompt, /示例团/);
assert.match(prompt, /示例物品/);
assert.match(prompt, /18\/12 成功/);
assert.match(gmPrompt, /现代都市悬疑/);
assert.match(gmPrompt, /当前角色卡、已激活世界书、场景设定/);
assert.match(gmPrompt, /既有聊天上下文/);
assert.match(gmPrompt, /保持当前角色的人设、口吻、关系与已发生事实/);
assert.match(gmPrompt, /只补充主持流程与团状态，不覆盖、重置、重排或替代/);
assert.match(gmPrompt, /不要替玩家决定行动/);
assert.match(gmPrompt, /骰子公式和难度/);
assert.match(opening, /示例团/);
assert.match(opening, /测试角色/);
assert.match(opening, /当前上下文/);
assert.match(opening, /此聊天没有既有内容时，才以第一幕建立场景/);
assert.doesNotMatch(opening, /忽略此前设定|重新定义角色|从零开始/);

const mature = normalizeState({ ...state, campaign: { ...state.campaign, genre: 'mature_relationship' } });
assert.match(buildGmPrompt(mature), /成年人之间的暧昧、亲密与关系张力/);

const disabled = normalizeState({ ...state, enabled: false });
assert.equal(buildPrompt(disabled), '');
assert.equal(buildGmPrompt(disabled), '');

const legacy = normalizeState({
    version: 1,
    enabled: true,
    campaign: { name: '旧团', scene: '旧场景', goal: '旧目标' },
    character: { name: '旧角色', hp: 4, will: 5 },
    notes: [{ type: 'clue', name: '旧线索' }],
    rolls: [{ formula: 'd20', dice: [10], total: 10, difficulty: 8 }],
});
assert.equal(legacy.version, 2);
assert.equal(legacy.setupComplete, true);
assert.equal(legacy.campaign.started, true);
assert.equal(legacy.campaign.genre, 'modern_mystery');
assert.equal(legacy.character.concept, '');
assert.match(buildPrompt(legacy), /旧线索/);
assert.match(buildGmPrompt(legacy), /旧团/);

console.log('core tests passed');
