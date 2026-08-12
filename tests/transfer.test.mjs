import test from 'node:test';
import assert from 'node:assert/strict';
import { computeScenarioHash, createDirectorState } from '../src/domain/index.js';
import { FOG_HARBOR_SCENARIO } from '../src/scenarios/index.js';
import {
    SAVE_PACKAGE_FORMAT,
    SCENARIO_PACKAGE_FORMAT,
    createSavePackage,
    createScenarioPackage,
    exportSavePackage,
    exportScenarioPackage,
    importSavePackage,
    importScenarioPackage,
} from '../src/io/index.js';

const exportedAt = '2026-08-12T12:34:56.000Z';
const player = {
    name: '沈舟',
    concept: '熟悉旧港机械的夜班记者',
    relationship: '当前角色曾在一次事故中救过沈舟',
    attributes: { body: 0, insight: 2, rapport: 1 },
};

function initialState() {
    return createDirectorState(FOG_HARBOR_SCENARIO, player);
}

test('scenario package is strict v2 and round-trips the validated built-in scenario', () => {
    const envelope = createScenarioPackage(FOG_HARBOR_SCENARIO, { exportedAt });
    assert.deepEqual(Object.keys(envelope), ['format', 'exportedAt', 'scenario']);
    assert.equal(envelope.format, SCENARIO_PACKAGE_FORMAT);
    assert.equal(envelope.exportedAt, exportedAt);
    assert.deepEqual(importScenarioPackage(exportScenarioPackage(FOG_HARBOR_SCENARIO, { exportedAt })), FOG_HARBOR_SCENARIO);
});

test('scenario import rejects v1, unknown fields, trailing text, duplicate keys, and invalid hashes', () => {
    const valid = createScenarioPackage(FOG_HARBOR_SCENARIO, { exportedAt });
    assert.throws(() => importScenarioPackage({ ...valid, format: 'candy-w-rpg-console/scenario/v1' }), /v2|旧版|未知格式/);
    assert.throws(() => importScenarioPackage({ ...valid, future: true }), /未知字段/);
    assert.throws(() => importScenarioPackage(`${JSON.stringify(valid)}\nnot-json`), /严格的 JSON/);
    assert.throws(
        () => importScenarioPackage(`{"format":"${SCENARIO_PACKAGE_FORMAT}","format":"${SCENARIO_PACKAGE_FORMAT}","exportedAt":"${exportedAt}","scenario":${JSON.stringify(FOG_HARBOR_SCENARIO)}}`),
        /重复字段/,
    );
    assert.throws(() => importScenarioPackage({
        ...valid,
        scenario: { ...valid.scenario, hash: 'fnv1a64:0000000000000000' },
    }), /严格 schema|哈希|校验/);
});

test('scenario import rejects a structurally valid but incomplete story graph', () => {
    const scenario = structuredClone(FOG_HARBOR_SCENARIO);
    const move = scenario.scenes.flatMap(scene => scene.moves).find(item => item.id === 'leave_confirm');
    move.endingId = 'ending_collapse';
    scenario.hash = '';
    scenario.hash = computeScenarioHash(scenario);
    assert.throws(
        () => createScenarioPackage(scenario, { exportedAt }),
        /剧本图不完整|不可达结局/,
    );
});

test('save package keeps only scenario and director state, then validates their identity', () => {
    const state = initialState();
    const envelope = createSavePackage(FOG_HARBOR_SCENARIO, state, { exportedAt });
    assert.deepEqual(Object.keys(envelope), ['format', 'exportedAt', 'scenario', 'state']);
    assert.equal(envelope.format, SAVE_PACKAGE_FORMAT);
    assert.deepEqual(importSavePackage(exportSavePackage(FOG_HARBOR_SCENARIO, state, { exportedAt })), {
        scenario: FOG_HARBOR_SCENARIO,
        state,
    });
    assert.equal('runtime' in envelope, false, 'host transaction/runtime identity never travels in a portable save');
});

test('save import rejects v1, unknown fields, and scenario id/version/hash mismatches', () => {
    const state = initialState();
    const valid = createSavePackage(FOG_HARBOR_SCENARIO, state, { exportedAt });
    assert.throws(() => importSavePackage({ ...valid, format: 'candy-w-rpg-console/save/v1' }), /v2|旧版|未知格式/);
    assert.throws(() => importSavePackage({ ...valid, extra: null }), /未知字段/);

    for (const [key, replacement] of [
        ['id', 'another-scenario'],
        ['version', state.scenario.version + 1],
        ['hash', 'fnv1a64:1111111111111111'],
    ]) {
        const mismatched = structuredClone(valid);
        mismatched.state.scenario[key] = replacement;
        assert.throws(() => importSavePackage(mismatched), /不一致|严格 v2 校验/);
    }
});

test('generating or pending state is not portable', () => {
    const state = initialState();
    const generating = structuredClone(state);
    generating.phase = 'generating';
    assert.throws(() => createSavePackage(FOG_HARBOR_SCENARIO, generating, { exportedAt }), /生成中|严格 v2 校验/);

    const pending = structuredClone(state);
    pending.pendingTransaction = { id: 'tx-import-must-refuse' };
    assert.throws(() => createSavePackage(FOG_HARBOR_SCENARIO, pending, { exportedAt }), /pending|严格 v2 校验/);
});

test('exportedAt and export formatting are validated deterministically', () => {
    assert.throws(() => createScenarioPackage(FOG_HARBOR_SCENARIO, { exportedAt: 'tomorrow' }), /UTC ISO/);
    assert.throws(() => exportScenarioPackage(FOG_HARBOR_SCENARIO, { exportedAt, space: 9 }), /缩进/);
    assert.throws(() => exportSavePackage(FOG_HARBOR_SCENARIO, initialState(), { exportedAt, space: -1 }), /缩进/);
});
