import assert from 'node:assert/strict';
import test from 'node:test';

import {
    assertScenario,
    computeScenarioHash,
    finalizeScenario,
    validateScenario,
} from '../src/domain/index.js';
import { FOG_HARBOR_SCENARIO } from '../src/scenarios/index.js';

function cloneScenario() {
    return structuredClone(FOG_HARBOR_SCENARIO);
}

function rehash(value) {
    value.hash = '';
    value.hash = computeScenarioHash(value);
    return value;
}

test('built-in scenario satisfies the strict v2 schema and content hash', () => {
    assert.equal(validateScenario(FOG_HARBOR_SCENARIO), true);
    assert.equal(FOG_HARBOR_SCENARIO.schema, 'candy-w-rpg-director/scenario/v2');
    assert.equal(FOG_HARBOR_SCENARIO.version, 2);
    assert.match(FOG_HARBOR_SCENARIO.contentVersion, /^\d+\.\d+\.\d+$/u);
    assert.equal(FOG_HARBOR_SCENARIO.hash, computeScenarioHash(FOG_HARBOR_SCENARIO));
});

test('hash is canonical for object key order and changes for content', () => {
    const original = cloneScenario();
    const reordered = Object.fromEntries(Object.entries(original).reverse());
    assert.equal(computeScenarioHash(reordered), computeScenarioHash(original));

    original.public.title = '另一个标题';
    assert.notEqual(computeScenarioHash(original), FOG_HARBOR_SCENARIO.hash);
    assert.equal(validateScenario(original), false, 'stale content must not pass the stored hash');
});

test('strict schema rejects unknown root and nested fields even after rehash', () => {
    const rootExtra = cloneScenario();
    rootExtra.legacy = true;
    assert.equal(validateScenario(rehash(rootExtra)), false);

    const nestedExtra = cloneScenario();
    nestedExtra.scenes[0].moves[0].debugOnly = true;
    assert.equal(validateScenario(rehash(nestedExtra)), false);
});

test('strict schema rejects invalid version, identifiers, values, and duplicate ids', () => {
    const mutations = [
        value => { value.version = 1; },
        value => { value.contentVersion = 'v2'; },
        value => { value.id = '../escape'; },
        value => { value.scenes[0].moves[0].clockAdvance = -1; },
        value => { value.scenes[0].moves[0].attribute = 'luck'; },
        value => { value.scenes[0].moves[1].id = value.scenes[0].moves[0].id; },
        value => { value.clocks[0].thresholds[1].minute = value.clocks[0].thresholds[0].minute; },
    ];

    for (const mutate of mutations) {
        const invalid = cloneScenario();
        mutate(invalid);
        assert.equal(validateScenario(rehash(invalid)), false);
    }
});

test('strict schema rejects dangling graph, check, secret, agenda, and public knowledge references', () => {
    const mutations = [
        value => { value.startSceneId = 'missing_scene'; },
        value => { value.scenes[0].actId = 'missing_act'; },
        value => { value.scenes[0].moves[0].nextSceneId = 'missing_scene'; },
        value => { value.scenes[1].moves[0].checkId = 'missing_check'; },
        value => { value.checks[0].successMoveId = 'missing_move'; },
        value => { value.scenes[1].moves[1].revealSecretIds = ['missing_secret']; },
        value => { value.npcs[0].agenda[0].thresholdId = 'missing_threshold'; },
        value => { value.scenes[0].moves[0].publicPatch.knownPeopleIds = ['missing_person']; },
        value => { value.scenes[0].moves[0].conditions.allFacts = ['missing_fact']; },
    ];

    for (const mutate of mutations) {
        const invalid = cloneScenario();
        mutate(invalid);
        assert.equal(validateScenario(rehash(invalid)), false);
    }
});

test('assertScenario returns an isolated deeply frozen snapshot', () => {
    const source = cloneScenario();
    const snapshot = assertScenario(source);
    assert.notEqual(snapshot, source);
    assert.equal(Object.isFrozen(snapshot), true);
    assert.equal(Object.isFrozen(snapshot.scenes), true);
    assert.equal(Object.isFrozen(snapshot.scenes[0].moves[0]), true);

    source.public.title = '外部突变';
    assert.equal(snapshot.public.title, '雾港零点潮');
    assert.throws(() => { snapshot.public.title = '内部突变'; }, TypeError);
});

test('finalizeScenario computes the hash but does not weaken validation', () => {
    const draft = cloneScenario();
    draft.hash = '';
    const finalized = finalizeScenario(draft);
    assert.equal(finalized.hash, computeScenarioHash(finalized));

    const invalid = cloneScenario();
    invalid.hash = '';
    invalid.scenes[0].moves[0].nextSceneId = 'missing_scene';
    assert.throws(() => finalizeScenario(invalid), /严格 schema、哈希或引用校验/u);
});
