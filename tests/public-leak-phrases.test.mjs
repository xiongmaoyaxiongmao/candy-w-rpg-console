import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePerformanceMessage } from '../src/protocol/performance.js';
import { DirectorApplication } from '../src/application/index.js';
import { PerChatRepository } from '../src/persistence/per-chat-repository.js';
import { validateDirectorState, validateScenario } from '../src/domain/index.js';
import { finalizeScenario } from '../src/domain/scenario-schema.js';
import { FOG_HARBOR_SCENARIO } from '../src/scenarios/index.js';
import { FakeOfficialAdapter } from './support/fake-official-adapter.mjs';

test('public scene vocabulary cannot act as a leak cue, while unexposed full phrases still block', () => {
    const options = { forbiddenPhrases: ['名单', '名单上的初恋标记'], publicContent: ['登记员低头核对名单。'] };
    assert.equal(validatePerformanceMessage('登记员把笔落回名单上。', options), '登记员把笔落回名单上。');
    assert.throws(() => validatePerformanceMessage('他看见名 单 上 的 初 恋 标 记。', options), /明确禁止短语「名单上的初恋标记」/);
    assert.throws(() => validatePerformanceMessage('他看见名单。', { forbiddenPhrases: ['名单'] }), /明确禁止短语/);
    assert.throws(() => validatePerformanceMessage('<hidden_state>内部信息</hidden_state>', { ...options, publicContent: ['<hidden_state>内部信息</hidden_state>'] }), /隐藏导演标记/);
});

test('actual reply submission accepts an ordinary public word and keeps true secret leaks recoverable', async () => {
    for (const leak of [false, true]) {
        const adapter = new FakeOfficialAdapter(); adapter.selectSingle();
        const draft = structuredClone(FOG_HARBOR_SCENARIO); delete draft.hash; draft.id = 'public-word-regression';
        draft.scenes.find(s => s.id === draft.startSceneId).description += '登记员低头核对名单。';
        draft.secrets[0].leakPhrases = ['名单', '名单上的初恋标记'];
        const scenario = finalizeScenario(draft);
        adapter.settings.importedScenarios = [scenario];
        const repository = new PerChatRepository({ adapter, validateState: validateDirectorState, validateScenario });
        const app = new DirectorApplication({ adapter, repository }).start();
        try {
            await app.createCampaign({ scenarioId: scenario.id, player: { name: '旅人', concept: '名单上的初恋标记', relationship: '', attributes: { body: 0, insight: 0, rapport: 0 } } });
            await app.enterWorld(); const revision = repository.load().revision;
            await adapter.completeGeneration(leak ? '登记员指出名单上的初恋标记。' : '登记员把笔落回名单上，继续核对。');
            assert.equal(repository.load().phase, leak ? 'generating' : 'playing');
            assert.equal(repository.load().revision, leak ? revision : revision + 1);
            if (leak) assert.equal(repository.loadRuntime().operation.stage, 'recoverable');
        } finally { await app.destroy(); }
    }
});
