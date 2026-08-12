import assert from 'node:assert/strict';
import test from 'node:test';

import {
    commitTurn,
    createCheckResult,
    createDirectorState,
    prepareActionTurn,
    prepareCheckConsequence,
    prepareOpeningTurn,
    recoverPendingState,
} from '../src/domain/index.js';
import { FOG_HARBOR_SCENARIO as scenario } from '../src/scenarios/index.js';

const player = {
    name: '岑舟',
    concept: '港区信使',
    relationship: '与当前角色共同调查封港令',
    attributes: { body: 0, insight: 2, rapport: 1 },
};

function ids(prefix) {
    let value = 0;
    return {
        id: () => `${prefix}_${value += 1}`,
        now: () => `2026-08-12T05:${String(value).padStart(2, '0')}:00.000Z`,
    };
}

function start() {
    const deps = ids('opening');
    const ready = createDirectorState(scenario, player, deps);
    const opening = prepareOpeningTurn(ready, scenario, deps);
    return commitTurn(opening.state, scenario, opening.turn, { performance: '海关门在暴雨里落下。', deps });
}

function action(state, moveId, attribute = null) {
    const deps = ids(moveId);
    const prepared = prepareActionTurn(state, scenario, {
        transactionId: `decision_${moveId}`,
        baseRevision: state.revision,
        actionId: moveId,
        attribute,
        summary: `执行 ${moveId}`,
    }, deps);
    return commitTurn(prepared.state, scenario, prepared.turn, { performance: `完成 ${moveId}`, deps });
}

function check(state, moveId, attribute, outcome) {
    const awaiting = action(state, moveId, attribute);
    assert.equal(awaiting.phase, 'awaiting_check');
    const result = createCheckResult(awaiting, scenario, { checkId: awaiting.public.pendingCheck.id }, {
        random: () => outcome === 'success' ? 0.999 : 0,
    });
    assert.equal(result.outcome, outcome);
    const deps = ids(`${moveId}_${outcome}`);
    const prepared = prepareCheckConsequence(awaiting, scenario, result, deps);
    return commitTurn(prepared.state, scenario, prepared.turn, { performance: `判定 ${outcome} 后果已发生。`, deps });
}

test('taking a detour past 23:10 fires missed events and every matching NPC agenda automatically', () => {
    let state = start();
    state = action(state, 'gate_to_pump');
    assert.equal(state.hidden.clock.minute, 1315);
    state = action(state, 'pump_wait_explosion');

    assert.ok(state.hidden.clock.minute >= 1390, 'the action that narrates the fixed 23:10 explosion must reach 23:10');
    assert.ok(state.hidden.clock.firedThresholdIds.includes('t_2200'));
    assert.ok(state.hidden.clock.firedThresholdIds.includes('t_2230'));
    assert.ok(state.hidden.clock.firedThresholdIds.includes('t_2310'));
    assert.ok(state.hidden.occurredFacts.includes('time_2310'));
    assert.equal(state.hidden.variables.pump_exploded, true);
    assert.ok(state.public.perceptibleClock.firedWarnings.some(warning => warning.includes('旧泵房爆炸')));

    const agendaFacts = new Set(state.hidden.npcAgenda.map(item => item.factId));
    assert.ok(agendaFacts.has('agenda_lin_signal'));
    assert.ok(agendaFacts.has('agenda_mu_run'));
    assert.ok(agendaFacts.has('agenda_wei_burn'));
    assert.ok(agendaFacts.has('agenda_tang_rescue'));
    assert.equal(state.hidden.npcAgenda.length, new Set(state.hidden.npcAgenda.map(item => `${item.npcId}:${item.thresholdId}`)).size);
});

test('generation preparation and recovery do not fire a crossed threshold until one successful commit', () => {
    let state = start();
    state = action(state, 'gate_to_pump');
    const before = structuredClone(state);
    const deps = ids('delayed');
    const prepared = prepareActionTurn(state, scenario, {
        transactionId: 'decision_pump_wait',
        baseRevision: state.revision,
        actionId: 'pump_wait_explosion',
        attribute: null,
        summary: '留下预警并承担爆炸后果',
    }, deps);
    assert.deepEqual(prepared.state.hidden.clock, before.hidden.clock);
    assert.deepEqual(prepared.state.hidden.npcAgenda, before.hidden.npcAgenda);

    const recovered = recoverPendingState(prepared.state);
    assert.deepEqual(recovered.hidden.clock, before.hidden.clock);
    assert.deepEqual(recovered.hidden.npcAgenda, before.hidden.npcAgenda);
    const retry = prepareActionTurn(recovered, scenario, {
        transactionId: 'decision_pump_wait_retry',
        baseRevision: recovered.revision,
        actionId: 'pump_wait_explosion',
        attribute: null,
        summary: '留下预警并承担爆炸后果',
    }, ids('delayed_retry'));
    const committed = commitTurn(retry.state, scenario, retry.turn, { performance: '固定爆炸发生。', deps: ids('delayed_commit') });
    assert.equal(committed.hidden.occurredFacts.filter(item => item === 'time_2310').length, 1);
    assert.equal(committed.hidden.npcAgenda.length, new Set(committed.hidden.npcAgenda.map(item => `${item.npcId}:${item.thresholdId}`)).size);
});

const endingRoutes = [
    {
        endingId: 'ending_left',
        run: state => action(action(state, 'gate_leave'), 'leave_confirm'),
    },
    {
        endingId: 'ending_warehouse_flooded',
        run: state => action(action(action(state, 'gate_to_pump'), 'pump_wait_explosion'), 'control_flood_warehouse'),
    },
    {
        endingId: 'ending_harbor_evacuated',
        run: state => {
            state = action(state, 'gate_to_office');
            state = check(state, 'office_search_check', 'insight', 'success');
            state = action(state, 'pump_to_patrol');
            state = check(state, 'patrol_persuade_check', 'rapport', 'success');
            state = check(state, 'tower_rescue_check', 'body', 'success');
            return action(state, 'control_flood_evacuated_harbor');
        },
    },
    {
        endingId: 'ending_both_saved',
        run: state => {
            state = action(state, 'gate_to_pump');
            state = action(state, 'pump_follow_signal');
            state = check(state, 'tower_rescue_check', 'body', 'success');
            return check(state, 'control_split_check', 'insight', 'success');
        },
    },
    {
        endingId: 'ending_collapse',
        run: state => action(action(action(state, 'gate_to_pump'), 'pump_wait_explosion'), 'control_wait_collapse'),
    },
];

for (const route of endingRoutes) {
    test(`${route.endingId} is playable end-to-end and settles the unavoidable zero tide`, () => {
        const ended = route.run(start());
        assert.equal(ended.phase, 'ended');
        assert.equal(ended.hidden.endingId, route.endingId);
        assert.equal(ended.hidden.clock.minute, scenario.clocks[0].endMinute);
        assert.ok(ended.hidden.clock.firedThresholdIds.includes('t_0000'));
        assert.ok(ended.hidden.occurredFacts.includes('time_0000'));
        assert.equal(ended.hidden.variables.tide_arrived, true);
        assert.equal(ended.pendingTransaction, null);
        assert.equal(ended.revision, ended.history.length);
    });
}
