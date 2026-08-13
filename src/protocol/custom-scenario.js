import { analyzeScenarioGraph, finalizeScenario } from '../domain/index.js';
import { parseStrictJsonObject } from './strict-json.js';

const BRIEF_KEYS = Object.freeze([
    'title', 'premise', 'tone', 'setting', 'opening', 'coreTruth', 'npcGoals', 'timePressure', 'endings',
]);
const DRAFT_KEYS = Object.freeze([
    'schema', 'version', 'id', 'contentVersion', 'public', 'coreFacts', 'secrets', 'npcs', 'clocks',
    'knowledge', 'acts', 'scenes', 'checks', 'endings', 'startSceneId',
]);

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));

function exact(value, keys) {
    return record(value) && Object.keys(value).length === keys.length && keys.every(key => own(value, key));
}

function text(value, name, { max, optional = false } = {}) {
    if (typeof value !== 'string') throw new Error(`${name}必须是文字。`);
    const result = value.trim();
    if (!optional && !result) throw new Error(`${name}不能为空。`);
    if (result.length > max) throw new Error(`${name}不能超过 ${max} 个字符。`);
    return result;
}

export function assertCustomScenarioBrief(input) {
    if (!exact(input, BRIEF_KEYS)) throw new Error('自定义剧本只接受完整的创作字段，不能混入未知字段。');
    return Object.freeze({
        title: text(input.title, '剧本名称', { max: 120 }),
        premise: text(input.premise, '故事设想', { max: 1_600 }),
        tone: text(input.tone, '氛围', { max: 120, optional: true }),
        setting: text(input.setting, '舞台与地点', { max: 600 }),
        opening: text(input.opening, '开场', { max: 900 }),
        coreTruth: text(input.coreTruth, '不可改写的真相', { max: 1_200 }),
        npcGoals: text(input.npcGoals, '关键人物与目的', { max: 1_400 }),
        timePressure: text(input.timePressure, '时间压力', { max: 600 }),
        endings: text(input.endings, '分支与结局方向', { max: 1_200 }),
    });
}

export function buildCustomScenarioPrompt(input) {
    const brief = assertCustomScenarioBrief(input);
    return `你是 Candy W 跑团的剧本作者。把用户的创作意图编写成一个可以从开场玩到结局的完整导演剧本。

只输出一个 JSON 对象：不要 Markdown、代码围栏、说明文字或前后缀。对象顶层必须且只能有：
${JSON.stringify(DRAFT_KEYS)}

这是 Candy W v2 严格剧本草稿。必须写入 schema="candy-w-rpg-director/scenario/v2"、version=2、一个小写 kebab-case id、contentVersion="1.0.0"。不要输出 hash。

必须遵守：
1. public 只包含 title、tagline、summary、tone、duration、symbol、tags，绝不泄露秘密或结局。
2. coreFacts 是不可改写事实；secrets 含 title、fact、revealText、leakPhrases；npcs 含隐藏目标和按时钟阈值发生的 agenda。
3. 只能有一个 clocks 条目，含 startMinute、endMinute 和按 minute 严格递增的 thresholds；每个 threshold 的 factId、每个 NPC agenda 的 factId，都必须是 coreFacts 或动作会记录的事实 id。
4. knowledge 必须有 people、clues、items、crises 四个数组；acts、scenes、moves、checks、endings 必须构成完整可达剧情图。
5. 每个 scene 的 moves 至少有一个。move 的字段必须完整：id、label、description、clockAdvance、attribute、checkId、conditions、mustHappen、revealSecretIds、publicPatch、hiddenPatch、nextSceneId、endingId。非判定 move 的 attribute/checkId 必须均为 null。
6. 每个 check 都必须定义身手(body)、洞察(insight)或交涉(rapport)之一、d6/d8/d10/d12/d20 公式、难度、成功/失败 stakes，以及分别指向两个没有 checkId 的后果 move。每个结局必须可达。
7. 不得给当前角色卡角色擅自增加秘密身份、命定血统或替代人设；角色卡只负责当前聊天 AI 的口吻与关系。
8. 所有字符串去除首尾空白；所有引用 id 必须真实存在；不得添加未声明字段。

用户创作意图：
${JSON.stringify(brief, null, 2)}`;
}

export function parseAndFinalizeCustomScenario(raw) {
    const draft = parseStrictJsonObject(raw);
    if (!exact(draft, DRAFT_KEYS)) throw new Error('剧本编写结果字段不完整或含有未知字段；没有保存任何内容。');
    const scenario = finalizeScenario(draft);
    if (!analyzeScenarioGraph(scenario).isComplete) {
        throw new Error('剧本编写结果的剧情图不完整；没有保存任何内容。');
    }
    return scenario;
}
