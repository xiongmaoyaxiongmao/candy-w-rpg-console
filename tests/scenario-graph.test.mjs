import assert from 'node:assert/strict';
import test from 'node:test';

import { analyzeScenarioGraph, computeScenarioHash } from '../src/domain/index.js';
import { FOG_HARBOR_SCENARIO } from '../src/scenarios/index.js';

function validMutation(mutate) {
    const value = structuredClone(FOG_HARBOR_SCENARIO);
    mutate(value);
    value.hash = '';
    value.hash = computeScenarioHash(value);
    return value;
}

function move(scenario, moveId) {
    return scenario.scenes.flatMap(scene => scene.moves).find(item => item.id === moveId);
}

test('the complete built-in graph reaches every scene and all five distinct endings', () => {
    const analysis = analyzeScenarioGraph(FOG_HARBOR_SCENARIO);
    assert.equal(analysis.isComplete, true);
    assert.equal(analysis.allEndingsReachable, true);
    assert.deepEqual(analysis.unreachableSceneIds, []);
    assert.deepEqual(analysis.unreachableEndingIds, []);
    assert.deepEqual(analysis.deadEndSceneIds, []);
    assert.deepEqual(new Set(analysis.reachableSceneIds), new Set(FOG_HARBOR_SCENARIO.scenes.map(scene => scene.id)));
    assert.deepEqual(new Set(analysis.reachableEndingIds), new Set([
        'ending_both_saved',
        'ending_warehouse_flooded',
        'ending_harbor_evacuated',
        'ending_collapse',
        'ending_left',
    ]));
});

test('graph traversal follows both success and failure consequence moves without treating them as player choices', () => {
    const analysis = analyzeScenarioGraph(FOG_HARBOR_SCENARIO);
    assert.ok(analysis.reachableEndingIds.includes('ending_both_saved'));
    assert.ok(analysis.reachableEndingIds.includes('ending_collapse'));

    const outcomeMoveIds = new Set(FOG_HARBOR_SCENARIO.checks.flatMap(check => [check.successMoveId, check.failureMoveId]));
    assert.ok(outcomeMoveIds.has('split_success'));
    assert.ok(outcomeMoveIds.has('split_failure'));
});

test('graph audit reports a structurally valid but unreachable scene', () => {
    const scenario = validMutation(value => {
        move(value, 'pump_follow_signal').nextSceneId = 'control_room';
        move(value, 'tang_success').nextSceneId = 'control_room';
    });
    const analysis = analyzeScenarioGraph(scenario);
    assert.deepEqual(analysis.unreachableSceneIds, ['bell_tower']);
    assert.equal(analysis.isComplete, false);
});

test('graph audit reports a declared ending that has no reachable transition', () => {
    const scenario = validMutation(value => {
        move(value, 'leave_confirm').endingId = 'ending_collapse';
    });
    const analysis = analyzeScenarioGraph(scenario);
    assert.deepEqual(analysis.unreachableEndingIds, ['ending_left']);
    assert.equal(analysis.allEndingsReachable, false);
    assert.equal(analysis.isComplete, false);
});
