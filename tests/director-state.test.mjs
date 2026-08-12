import assert from 'node:assert/strict';
import test from 'node:test';

import {
    buildPublicPerformanceFacts,
    commitTurn,
    createCheckResult,
    createDirectorState,
    listAvailableMoves,
    prepareActionTurn,
    prepareCheckConsequence,
    prepareOpeningTurn,
    projectPublicState,
    recoverPendingState,
    stateMatchesScenario,
    validateDirectorState,
} from '../src/domain/index.js';
import { FOG_HARBOR_SCENARIO as scenario } from '../src/scenarios/index.js';

const player = Object.freeze({
    name: '岑舟',
    concept: '熟悉旧港机械的信使',
    relationship: '曾与当前角色一同巡检潮门',
    attributes: { body: 0, insight: 2, rapport: 1 },
});

function deterministicDeps(prefix = 'tx') {
    let sequence = 0;
    return {
        id: () => `${prefix}_${sequence += 1}`,
        now: () => new Date(Date.UTC(2026, 7, 12, 5, sequence, 0)).toISOString(),
    };
}

function openWorld(deps = deterministicDeps('open')) {
    const ready = createDirectorState(scenario, player, deps);
    const prepared = prepareOpeningTurn(ready, scenario, deps);
    return commitTurn(prepared.state, scenario, prepared.turn, { performance: '暴雨里，海关门在身后落下。', deps });
}

function performMove(state, moveId, attribute = null, deps = deterministicDeps(moveId)) {
    const prepared = prepareActionTurn(state, scenario, {
        transactionId: `decision_${moveId}`,
        baseRevision: state.revision,
        actionId: moveId,
        attribute,
        summary: `玩家执行 ${moveId}`,
    }, deps);
    return commitTurn(prepared.state, scenario, prepared.turn, { performance: `演出 ${moveId}`, deps });
}

function enterArchiveCheck() {
    let state = openWorld();
    state = performMove(state, 'gate_to_office');
    state = performMove(state, 'office_search_check', 'insight');
    return state;
}

test('state exact schema holds from ready through opening and rejects extra or inconsistent state', () => {
    const ready = createDirectorState(scenario, player);
    assert.equal(validateDirectorState(ready), true);
    assert.equal(stateMatchesScenario(ready, scenario), true);
    assert.equal(ready.phase, 'ready');
    assert.equal(ready.revision, 0);

    const extra = structuredClone(ready);
    extra.legacyConsole = {};
    assert.equal(validateDirectorState(extra), false);

    const inconsistent = structuredClone(ready);
    inconsistent.phase = 'generating';
    assert.equal(validateDirectorState(inconsistent), false, 'generating must own an exact pending transaction');

    const wrongScenario = structuredClone(scenario);
    wrongScenario.hash = 'fnv1a64:0000000000000000';
    assert.equal(stateMatchesScenario(ready, wrongScenario), false);
});

test('opening is a prepared transaction and commits once into normal play', () => {
    const deps = deterministicDeps('opening');
    const ready = createDirectorState(scenario, player, deps);
    const prepared = prepareOpeningTurn(ready, scenario, deps);
    assert.equal(prepared.state.phase, 'generating');
    assert.equal(prepared.turn.kind, 'opening');
    assert.equal(prepared.turn.baseRevision, 0);
    assert.equal(ready.phase, 'ready', 'preparation must not mutate its input');

    const playing = commitTurn(prepared.state, scenario, prepared.turn, { performance: '雾港的雨幕吞没了最后一班船。', deps });
    assert.equal(playing.phase, 'playing');
    assert.equal(playing.revision, 1);
    assert.equal(playing.history.length, 1);
    assert.equal(playing.history[0].transactionId, prepared.turn.id);
    assert.throws(() => commitTurn(playing, scenario, prepared.turn, { performance: '重复提交', deps }), /pending 不匹配/u);
});

test('available moves contain only current player choices, never hidden check outcome moves', () => {
    let state = openWorld();
    assert.deepEqual(listAvailableMoves(state, scenario).map(move => move.id), ['gate_to_office', 'gate_to_pump', 'gate_leave']);
    state = performMove(state, 'gate_to_office');
    assert.deepEqual(listAvailableMoves(state, scenario).map(move => move.id), ['office_search_check']);
    assert.ok(!listAvailableMoves(state, scenario).some(move => ['archives_success', 'archives_failure'].includes(move.id)));
});

test('check protocol exposes why, formula, difficulty and both stakes, then makes the public roll immutable', () => {
    const awaiting = enterArchiveCheck();
    const pending = awaiting.public.pendingCheck;
    assert.equal(awaiting.phase, 'awaiting_check');
    assert.deepEqual(pending, {
        id: 'check_archives',
        status: 'required',
        reason: '在档案被封存前找出伪造与疏散证据',
        attribute: 'insight',
        formula: 'd20',
        difficulty: 12,
        successStakes: '取得完整伪造证据与疏散名单。',
        failureStakes: '只保住不完整证据，封锁继续收紧。',
        roll: null,
    });

    const result = createCheckResult(awaiting, scenario, { checkId: pending.id }, { random: () => 0.999 });
    assert.deepEqual(result, {
        checkId: 'check_archives',
        dice: [20],
        modifier: 2,
        total: 22,
        outcome: 'success',
        consequenceMoveId: 'archives_success',
    });
    assert.equal(Object.isFrozen(result), true);
    assert.equal(Object.isFrozen(result.dice), true);
    assert.throws(() => { result.total = 1; }, TypeError);
    assert.throws(() => { result.dice[0] = 1; }, TypeError);

    const deps = deterministicDeps('consequence');
    const prepared = prepareCheckConsequence(awaiting, scenario, result, deps);
    assert.equal(prepared.state.public.lastCheck.roll.total, 22);
    assert.match(prepared.turn.decision.mustHappen[0], /骰面 20.*总点 22.*成功/u);
    const committed = commitTurn(prepared.state, scenario, prepared.turn, { performance: '骰面二十已经落定，档案在封箱前被拍下。', deps });
    assert.equal(committed.phase, 'playing');
    assert.equal(committed.public.lastCheck.roll.total, 22);
    assert.ok(committed.hidden.occurredFacts.includes('archives_secured'));
    assert.ok(committed.hidden.revealedSecretIds.includes('secret_forgery'));
});

test('check consequence rejects a different check and malformed or impossible dice facts', () => {
    const awaiting = enterArchiveCheck();
    const valid = createCheckResult(awaiting, scenario, { checkId: 'check_archives' }, { random: () => 0.55 });
    const invalidResults = [
        { ...valid, checkId: 'check_tang', consequenceMoveId: 'tang_success' },
        { ...valid, dice: [21], total: 23, outcome: 'success', consequenceMoveId: 'archives_success' },
        { ...valid, dice: [1, 2], total: 5, outcome: 'failure', consequenceMoveId: 'archives_failure' },
        { ...valid, dice: [10.5], total: 12.5, outcome: 'success', consequenceMoveId: 'archives_success' },
        { ...valid, outcome: 'draw' },
    ];
    for (const result of invalidResults) {
        assert.throws(() => prepareCheckConsequence(awaiting, scenario, result), Error);
    }
});

test('an already published roll cannot be rolled back into a fresh roll opportunity', () => {
    const awaiting = enterArchiveCheck();
    const result = createCheckResult(awaiting, scenario, { checkId: 'check_archives' }, { random: () => 0.999 });
    const prepared = prepareCheckConsequence(awaiting, scenario, result, deterministicDeps('fixed_roll'));
    assert.equal(prepared.state.public.lastCheck.roll.total, 22);
    const recovered = recoverPendingState(prepared.state);
    assert.equal(recovered.phase, 'generating');
    assert.equal(recovered.pendingTransaction.id, prepared.turn.id);
    assert.deepEqual(recovered.pendingTransaction.decision.check.roll, { dice: [20], modifier: 2, total: 22, outcome: 'success' });
    assert.deepEqual(recovered.public.lastCheck.roll, { dice: [20], modifier: 2, total: 22, outcome: 'success' });
    assert.equal(recovered.public.pendingCheck, null);
    assert.throws(
        () => createCheckResult(recovered, scenario, { checkId: 'check_archives' }, { random: () => 0 }),
        /没有等待公开投骰/u,
    );
});

test('ordinary failed generation recovery does not advance facts, time, revision or history twice', () => {
    const state = openWorld();
    const before = structuredClone(state);
    const first = prepareActionTurn(state, scenario, {
        transactionId: 'decision_gate_to_pump',
        baseRevision: state.revision,
        actionId: 'gate_to_pump',
        attribute: null,
        summary: '赶往泵房',
    }, deterministicDeps('first_try'));
    assert.equal(first.state.hidden.clock.minute, before.hidden.clock.minute);
    assert.deepEqual(first.state.hidden.occurredFacts, before.hidden.occurredFacts);

    const recovered = recoverPendingState(first.state);
    assert.equal(recovered.phase, 'playing');
    assert.equal(recovered.revision, before.revision);
    assert.equal(recovered.hidden.clock.minute, before.hidden.clock.minute);
    assert.deepEqual(recovered.hidden.occurredFacts, before.hidden.occurredFacts);
    assert.equal(recovered.history.length, before.history.length);

    const retry = prepareActionTurn(recovered, scenario, {
        transactionId: 'decision_gate_to_pump_retry',
        baseRevision: recovered.revision,
        actionId: 'gate_to_pump',
        attribute: null,
        summary: '赶往泵房',
    }, deterministicDeps('retry'));
    const committed = commitTurn(retry.state, scenario, retry.turn, { performance: '抵达泵房。', deps: deterministicDeps('retry_commit') });
    assert.equal(committed.revision, before.revision + 1);
    assert.equal(committed.hidden.clock.minute, before.hidden.clock.minute + 15);
    assert.equal(committed.history.length, before.history.length + 1);
    assert.equal(committed.hidden.occurredFacts.filter(fact => fact === 'chose_pump').length, 1);
});

test('public projection and performance facts never expose director secrets or NPC backstage actions', () => {
    const state = openWorld();
    const publicJson = JSON.stringify(projectPublicState(state, scenario));
    const performanceFacts = buildPublicPerformanceFacts(state, scenario).join('\n');
    const exposed = `${publicJson}\n${performanceFacts}`;

    for (const secret of scenario.secrets) {
        assert.ok(!exposed.includes(secret.fact));
        assert.ok(!exposed.includes(secret.revealText));
        assert.ok(!exposed.includes(secret.id));
        for (const phrase of secret.leakPhrases) assert.ok(!exposed.includes(phrase));
    }
    for (const npc of scenario.npcs) {
        assert.ok(!exposed.includes(npc.hiddenGoal));
        for (const agenda of npc.agenda) assert.ok(!exposed.includes(agenda.action));
    }
    for (const threshold of scenario.clocks[0].thresholds) assert.ok(!exposed.includes(threshold.hiddenEvent));
    assert.ok(!exposed.includes('occurredFacts'));
    assert.ok(!exposed.includes('variables'));
    assert.ok(!exposed.includes('npcAgenda'));
});
