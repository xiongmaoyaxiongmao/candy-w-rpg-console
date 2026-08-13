import assert from 'node:assert/strict';
import test from 'node:test';
import {
    assertCustomScenarioBrief,
    buildCustomScenarioPrompt,
    parseAndFinalizeCustomScenario,
} from '../src/protocol/index.js';
import { FOG_HARBOR_SCENARIO } from '../src/scenarios/index.js';

const BRIEF = Object.freeze({
    title: '月背列车失踪案',
    premise: '一列失去返航记录的月背列车在无名站停下，玩家必须找到失踪者并决定列车去向。',
    tone: '温柔惊悚',
    setting: '月背列车、无名站与真空中的维修舱。',
    opening: '列车在没有站名的月背站台停靠，乘务长递来一张空白乘车证。',
    coreTruth: '列车的返航协议被人为篡改，月背风暴不会等待任何人。',
    npcGoals: '乘务长想带所有乘客返航；失踪的工程师留下了修复协议的线索。',
    timePressure: '氧气和月背风暴都会按时间推进，拖延会封死维修舱。',
    endings: '可以修复返航、带部分人离开，或让列车留在月背成为新的避难所。',
});

function validDraft() {
    const draft = structuredClone(FOG_HARBOR_SCENARIO);
    delete draft.hash;
    draft.id = 'moon-train-missing';
    draft.contentVersion = '1.0.0';
    draft.public.title = BRIEF.title;
    draft.public.tagline = '列车停在月亮背面，返程记录却消失了。';
    draft.public.summary = '一列月背列车在无名站停下，你必须找到失踪者并决定所有人的返程。';
    draft.public.tone = BRIEF.tone;
    draft.public.duration = '约 2 小时';
    draft.public.symbol = '◐';
    draft.public.tags = ['月背', '列车', '悬疑'];
    return draft;
}

test('custom scenario brief is exact, bounded and becomes a model-neutral writing instruction', () => {
    const prompt = buildCustomScenarioPrompt(BRIEF);
    assert.match(prompt, /只输出一个 JSON 对象/);
    assert.match(prompt, /完整可达剧情图/);
    assert.match(prompt, /月背列车失踪案/);
    assert.doesNotMatch(prompt, /jsonSchema/iu);
    assert.throws(() => assertCustomScenarioBrief({ ...BRIEF, hidden: 'no' }), /未知字段/);
    assert.throws(() => assertCustomScenarioBrief({ ...BRIEF, opening: ' ' }), /不能为空/);
});

test('only a complete strict scenario is finalized; raw prose, duplicate keys and draft hashes fail closed', () => {
    const scenario = parseAndFinalizeCustomScenario(JSON.stringify(validDraft()));
    assert.equal(scenario.id, 'moon-train-missing');
    assert.equal(scenario.public.title, BRIEF.title);
    assert.match(scenario.hash, /^fnv1a64:[a-f0-9]{16}$/u);

    assert.throws(() => parseAndFinalizeCustomScenario('我写好了一个故事。'), /单一、严格的 JSON/);
    assert.throws(() => parseAndFinalizeCustomScenario('{"schema":"a","schema":"b"}'), /重复字段/);
    assert.throws(() => parseAndFinalizeCustomScenario(JSON.stringify({ ...validDraft(), hash: 'not-allowed' })), /字段不完整或含有未知字段/);
    const incomplete = validDraft();
    incomplete.startSceneId = 'missing-scene';
    assert.throws(() => parseAndFinalizeCustomScenario(JSON.stringify(incomplete)), /严格 schema|剧情图不完整/);
});
