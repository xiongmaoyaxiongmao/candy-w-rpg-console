import assert from 'node:assert/strict';
import test from 'node:test';
import { ScenarioAuthoringService } from '../src/application/scenario-authoring-service.js';
import { FOG_HARBOR_SCENARIO } from '../src/scenarios/index.js';
import { FakeOfficialAdapter } from './support/fake-official-adapter.mjs';

function draft(id, title) {
    const value = structuredClone(FOG_HARBOR_SCENARIO);
    delete value.hash;
    value.id = id;
    value.contentVersion = '1.0.0';
    value.public.title = title;
    return value;
}

function brief(title) {
    return {
        title,
        premise: '潮门会在零点前开启。',
        tone: '',
        setting: '雾港。',
        opening: '暴雨落下。',
        coreTruth: '风暴不可避免。',
        npcGoals: '每个人都想保住自己的城区。',
        timePressure: '零点潮逼近。',
        endings: '选择洪水去向。',
    };
}

test('scenario authoring service isolates model writing modes from application persistence', async () => {
    const adapter = new FakeOfficialAdapter();
    const identity = adapter.selectSingle('guide.png', 'chat-a');
    const stages = [];
    const service = new ScenarioAuthoringService({
        adapter,
        assertMayContinue: (current, stage) => {
            assert.deepEqual(current, identity);
            stages.push(stage);
        },
    });

    const originalDraft = draft('fog-harbor-authoring-service', '雾港初稿');
    adapter.enqueueRaw(JSON.stringify(originalDraft));
    const original = await service.writeBrief(brief('雾港初稿'), identity);
    assert.equal(original.public.title, '雾港初稿');

    adapter.nativeWorldInfo = '雾港海关门坐落在旧港与仓区之间。';
    const worldDraft = draft('fog-harbor-world-service', '雾港世界书稿');
    adapter.enqueueRaw(JSON.stringify(worldDraft));
    const world = await service.writeFromWorldInfo({ title: '', outcome: '零点前决定潮门去向。', anchors: '雾港, 潮门' }, identity);
    assert.equal(world.public.title, '雾港世界书稿');
    assert.match(adapter.nativeWorldInfoRequests[0].scanSeed, /潮门/u);

    const revisedDraft = draft(original.id, '雾港修订稿');
    adapter.enqueueRaw(JSON.stringify(revisedDraft));
    const revised = await service.revise({ scenarioId: original.id, instruction: '让旧港有新的救援机会。' }, original, identity);
    assert.equal(revised.public.title, '雾港修订稿');
    assert.deepEqual(stages, ['剧本编写', '世界书扫描', '剧本编写', '剧本修改']);
});
