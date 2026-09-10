import test from 'node:test';
import assert from 'node:assert/strict';
import { createProgression, emptyProgression, reviseProgression, settleProgression, validateProgression } from '../src/domain/player-progression.js';
import { createDirectorState, validateDirectorState, prepareOpeningTurn, prepareActionTurn, recoverPendingState, commitTurn, previewPlayerTurn } from '../src/domain/director-state.js';
import { FOG_HARBOR_SCENARIO as scenario } from '../src/scenarios/index.js';
import { exportSavePackage, importSavePackage } from '../src/io/index.js';
import { buildActionDecisionPrompt, actionDecisionContract, parseAndValidateActionDecision } from '../src/protocol/action-decision.js';
import { buildPerformanceDirective } from '../src/protocol/performance.js';
import { newPlayerEntry, numericPlayerEntries, playerEntriesFromForm } from '../src/ui/player-progression.js';
const player = { name: '测试玩家', concept: '', relationship: '', attributes: { body: 0, insight: 2, rapport: 1 } };
const rule = (id, delta, timing = 'action') => ({ id: `p_${id}`, condition: id, delta, timing });
const threshold = mode => ({ id: `p_${mode}`, operator: 'lte', value: 20, reaction: mode, mode });
export const entries = () => [
    { id: 'p_stamina', kind: 'resource', name: '体力', value: 25, min: 0, max: 100, learnAt: null, rules: [rule('run', -10), rule('rest', 30)], thresholds: ['once', 'cross', 'while'].map(threshold) },
    { id: 'p_skill', kind: 'skill', name: '符文术', value: 15, min: 0, max: 100, learnAt: 20, rules: [rule('practice', 5), rule('win', 10, 'success'), rule('lose', 1, 'failure')], thresholds: [] },
];
const settle = (p, rules = [], extra = {}) => settleProgression(p, { kind: 'action', ruleIds: rules, revision: 2, ...extra });

test('resources, learning and all threshold modes use pure previews and bounded arithmetic', () => {
    const p = createProgression(entries());
    const first = settle(p, ['p_run', 'p_practice']);
    assert.deepEqual(p, createProgression(entries()));
    assert.deepEqual(first, settle(p, ['p_run', 'p_practice']));
    assert.equal(first.progression.entries[0].value, 15);
    assert.equal(first.progression.entries[1].value, 20);
    assert.equal(first.effects.filter(s => s.startsWith('学会技能')).length, 1);
    assert.deepEqual(first.progression.fired, ['p_once']);
    const again = settle(first.progression, ['p_run']);
    assert.equal(again.effects.some(s => s.endsWith('once')), false);
    assert.equal(again.effects.some(s => s.endsWith('cross')), false);
    assert.equal(again.effects.some(s => s.endsWith('while')), true);
    assert.equal(settle(again.progression, ['p_run']).progression.entries[0].value, 0);
    const recovered = settle(first.progression, ['p_rest']);
    assert.equal(recovered.effects.some(s => s.endsWith('while')), false);
    let below = recovered.progression;
    for (let i = 0; i < 3; i++) below = settle(below, ['p_run']).progression;
    assert.equal(below.log.at(-1).details.some(s => s.endsWith('cross')), true);
    assert.equal(below.log.at(-1).details.some(s => s.endsWith('once')), false);
    for (let i = 0; i < 20; i++) below = settle(below, ['p_rest']).progression;
    assert.equal(below.entries[0].value, 100);
});

test('successful and failed check rules are deferred until the actual dice outcome', () => {
    const p = createProgression(entries());
    const waiting = settle(p, ['p_run', 'p_win', 'p_lose'], { check: { status: 'required' } }).progression;
    assert.equal(waiting.entries[1].value, 15);
    assert.deepEqual(waiting.deferred, ['p_win', 'p_lose']);
    assert.throws(() => reviseProgression(waiting, entries(), 3), /判定/);
    for (const [outcome, expected] of [['success', 25], ['failure', 16]]) {
        const after = settle(waiting, [], { kind: 'check_consequence', check: { roll: { outcome } } });
        assert.equal(after.progression.entries[1].value, expected);
        assert.deepEqual(after.progression.deferred, []);
        assert.equal(settle(after.progression).progression.entries[1].value, expected);
    }
    assert.deepEqual(settle(p, ['p_win']).progression.deferred, []);
    assert.throws(() => settle(p, ['p_run', 'p_run']), /重复/);
    assert.throws(() => settle(p, ['p_unknown']), /未配置/);
});

test('manual correction retains once ledger, queues crossing reactions, and exports with the existing v2 save', () => {
    const initial = settle(createProgression(entries()), ['p_run']).progression;
    let draft = structuredClone(initial.entries); draft[0].value = 70;
    const corrected = reviseProgression(initial, draft, 3);
    assert.deepEqual(corrected.fired, ['p_once']);
    assert.equal(corrected.notices.some(s => s.endsWith('while')), false);
    draft = structuredClone(corrected.entries); draft[0].value = 15;
    const recross = reviseProgression(corrected, draft, 4);
    assert.equal(recross.notices.some(s => s.endsWith('cross')), true);
    assert.equal(recross.notices.some(s => s.endsWith('once')), false);
    const state = createDirectorState(scenario, { ...player, progression: recross });
    const result = importSavePackage(exportSavePackage(scenario, state));
    assert.deepEqual(result.state.player.progression, recross);
    const next = settle(recross);
    assert.deepEqual(next.progression.notices, []);
    const old = createDirectorState(scenario, player);
    assert.equal(validateDirectorState(old), true);
    assert.deepEqual(importSavePackage(exportSavePackage(scenario, old)).state, old);
    const broken = structuredClone(state); broken.player.progression.entries[0].value = -1;
    assert.equal(validateDirectorState(broken), false);
});

test('prepared action keeps old values, cancel discards effects, commit charges exactly once', () => {
    const initial = createDirectorState(scenario, { ...player, progression: createProgression(entries()) });
    const opening = prepareOpeningTurn(initial, scenario);
    const playing = commitTurn(opening.state, scenario, opening.turn, { performance: '雨中的海关门前，小牧向你说明眼前的事情。' });
    const action = prepareActionTurn(playing, scenario, { transactionId: 'tx_stats', baseRevision: playing.revision, actionId: 'gate_to_pump', attribute: null, summary: '跑去泵房练习符文术。', ruleIds: ['p_run', 'p_practice'] });
    assert.equal(action.state.player.progression.entries[0].value, 25);
    assert.match(previewPlayerTurn(action.state, action.turn).effects.join('\n'), /25 → 15/);
    assert.equal(recoverPendingState(action.state).player.progression.entries[0].value, 25);
    const after = commitTurn(action.state, scenario, action.turn, { performance: '你抵达泵房，身体有些疲惫，但符文终于亮起。' });
    assert.equal(after.player.progression.entries[0].value, 15);
    assert.throws(() => commitTurn(after, scenario, action.turn, { performance: '再次抵达泵房。' }), /pending/);
});

test('strict action contract only allows configured rule references and includes state context', () => {
    const expected = { transactionId: 'tx_test', baseRevision: 0, allowedMoveIds: ['move'], allowedAttributeIds: ['body'], allowedRuleIds: ['p_run'] };
    const decision = { transactionId: 'tx_test', baseRevision: 0, actionId: 'move', attribute: null, summary: '奔跑', ruleIds: ['p_run'] };
    assert.equal(parseAndValidateActionDecision(JSON.stringify(decision), expected).ruleIds[0], 'p_run');
    assert.throws(() => parseAndValidateActionDecision(JSON.stringify({ ...decision, ruleIds: ['p_new'] }), expected));
    assert.throws(() => parseAndValidateActionDecision(JSON.stringify({ ...decision, ruleIds: ['p_run', 'p_run'] }), expected));
    assert.throws(() => parseAndValidateActionDecision(JSON.stringify({ ...decision, setValue: 100 }), expected));
    assert.deepEqual(actionDecisionContract(expected).properties.ruleIds.items.enum, ['p_run']);
    const prompt = buildActionDecisionPrompt({ transactionId: 'tx_test', baseRevision: 0, playerAction: '奔跑', allowedMoves: [{ id: 'move', label: '前进' }], allowedAttributes: [{ id: 'body', label: '身手' }], playerProgression: createProgression(entries()) });
    assert.match(prompt, /ruleIds/); assert.match(prompt, /符文术/); assert.match(prompt, /p_win/);
});

test('player facts and reactions remain mandatory even when ordinary facts exceed context budget', () => {
    const playerState = Array.from({ length: 150 }, (_, i) => `${i}：${'状态'.repeat(100)}`);
    const prompt = buildPerformanceDirective({ publicFacts: [], mustHappen: ['开始演出'], forbiddenTopics: [], check: null, playerState }, { maxChars: 100000 });
    assert.ok(prompt.includes(playerState.at(-1)));
});

test('form retains incomplete drafts and rejects invalid numbers at the application boundary', () => {
    const e = newPlayerEntry('skill');
    const f = new FormData(); f.append('playerEntryId', e.id);
    for (const key of ['kind', 'name', 'value', 'min', 'max', 'learnAt','learned','enabled']) f.set(`${e.id}.${key}`, e[key]);
    f.set(`${e.id}.effect`,'释放光芒');f.set(`${e.id}.condition`,'能够施法');
    f.set(`${e.id}.name`, '学习中的魔法'); f.set(`${e.id}.value`, '');
    const draft = playerEntriesFromForm(f);
    assert.equal(draft[0].value, '');
    assert.throws(() => createProgression(numericPlayerEntries(draft)), /整数/);
    f.set(`${e.id}.value`, '0');
    assert.equal(validateProgression(createProgression(numericPlayerEntries(playerEntriesFromForm(f)))), true);
    assert.deepEqual(reviseProgression(emptyProgression(), [], 1), emptyProgression());
});


test('action summaries preserve legal Chinese punctuation under the shared string contract', () => {
    const expected = { transactionId:'tx_text',baseRevision:0,allowedMoveIds:['talk'],allowedAttributeIds:['body'] };
    const value = { transactionId:'tx_text',baseRevision:0,actionId:'talk',attribute:null,summary:'询问：过去有人学习过符文术吗？' };
    assert.equal(parseAndValidateActionDecision(JSON.stringify(value),expected).summary,value.summary);
    for(const summary of [' 前后空格 ', '行\n控制', '制\u0000符', '', 'a'.repeat(281)]) assert.throws(()=>parseAndValidateActionDecision(JSON.stringify({...value,summary}),expected));
});
