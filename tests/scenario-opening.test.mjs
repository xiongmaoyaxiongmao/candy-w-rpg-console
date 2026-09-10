import test from 'node:test';
import assert from 'node:assert/strict';
import { createDirectorState, stateMatchesScenario, validateDirectorState, projectPublicState, buildPublicPerformanceFacts } from '../src/domain/director-state.js';
import { computeScenarioHash, validateScenario } from '../src/domain/scenario-schema.js';
import { FOG_HARBOR_SCENARIO } from '../src/scenarios/index.js';
import { DirectorApplication } from '../src/application/index.js';
import { PerChatRepository } from '../src/persistence/per-chat-repository.js';
import { FakeOfficialAdapter } from './support/fake-official-adapter.mjs';
import { exportSavePackage, importSavePackage } from '../src/io/index.js';
const player={name:'测试玩家',concept:'调查员',relationship:'同伴',attributes:{body:0,insight:2,rapport:1}};
function scenarioWithCrises(crises) {
    const scenario=structuredClone(FOG_HARBOR_SCENARIO);
    scenario.id='custom_opening';scenario.knowledge.crises=crises;
    for(const scene of scenario.scenes)for(const move of scene.moves)move.publicPatch.crisisIds=crises.map(c=>c.id);
    scenario.hash=computeScenarioHash(scenario);
    assert.equal(validateScenario(scenario),true);
    return scenario;
}

test('every valid custom crisis catalog, including none, produces a matching ready state',()=>{
    const foreign={id:'crisis_custom',name:'未来才公开的危机',detail:'不可在开场提前公开的内容。',urgency:'稍后发生',anchors:['后续']};
    for(const scenario of [FOG_HARBOR_SCENARIO,scenarioWithCrises([]),scenarioWithCrises([foreign])]){
        const state=createDirectorState(scenario,player);
        assert.equal(stateMatchesScenario(state,scenario),true);
        assert.deepEqual(state.public.crisisIds,[]);
        assert.deepEqual(projectPublicState(state,scenario).crises,[]);
        assert.doesNotMatch(buildPublicPerformanceFacts(state,scenario).join('\n'),/不可在开场提前公开/);
        assert.deepEqual(importSavePackage(exportSavePackage(scenario,state)).state,state);
    }
});

test('foreign sample crisis remains a rejected inconsistency rather than being ignored',()=>{
    const scenario=scenarioWithCrises([]),state=createDirectorState(scenario,player);
    state.public.crisisIds=['crisis_tide'];
    assert.equal(validateDirectorState(state),true);
    assert.equal(stateMatchesScenario(state,scenario),false);
});

test('custom campaign creates, opens, reloads and reveals only the crisis declared by the committed move',async()=>{
    const scenario=scenarioWithCrises([{id:'crisis_custom',name:'本剧本危机',detail:'前往泵房后才明确的故障。',urgency:'尽快处理',anchors:['泵房']}]);
    const adapter=new FakeOfficialAdapter();adapter.selectSingle();
    const repository=new PerChatRepository({adapter,validateState:validateDirectorState,validateScenario});
    let sequence=0;
    const app=new DirectorApplication({adapter,repository,scenarios:[scenario],deps:{id:()=>`tx_open_${++sequence}`}}).start();
    await app.createCampaign({scenarioId:scenario.id,player});
    assert.equal(app.getViewModel().phase,'ready');assert.deepEqual(repository.load().public.crisisIds,[]);
    await app.enterWorld();assert.equal(app.getViewModel().phase,'opening');
    assert.doesNotMatch(adapter.prompts.directive,/前往泵房后才明确的故障/);
    await adapter.completeGeneration('暴雨中的海关门前，同伴向你讲清眼前的情况，等待你决定接下来的行动。');
    assert.equal(app.getViewModel().phase,'playing');assert.deepEqual(repository.load().public.crisisIds,[]);
    adapter.appendUser('我前往泵房。');adapter.enqueueDecision('gate_to_pump');
    await adapter.completeGeneration('你和同伴抵达泵房，发现了必须尽快处理的故障，接下来由你决定。');
    assert.deepEqual(repository.load().public.crisisIds,['crisis_custom']);assert.equal(stateMatchesScenario(repository.load(),scenario),true);
    await app.destroy();
    const refreshed=new DirectorApplication({adapter,repository,scenarios:[scenario]}).start();
    assert.equal(refreshed.getViewModel().phase,'playing');assert.equal(refreshed.getViewModel().world.crises[0].id,'crisis_custom');
    await refreshed.destroy();
});
