import { generatedPlayer } from './support/player-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { FOG_HARBOR_SCENARIO } from '../src/scenarios/index.js';
import { FakeOfficialAdapter } from './support/fake-official-adapter.mjs';
import { ScenarioAuthoringService } from '../src/application/scenario-authoring-service.js';
import { finalizeCustomScenario } from '../src/protocol/custom-scenario.js';
import { scenePrompt, validateScene, validateSceneRepair } from '../src/protocol/scenario-authoring.js';

const brief={title:'事实链测试',premise:'检查港口设施。',tone:'悬疑',setting:'港口',opening:'潮水将至。',coreTruth:'潮门损坏。',npcGoals:'修复潮门。',timePressure:'午夜之前。',endings:'修复或撤离。'};
function setup() {
    const adapter=new FakeOfficialAdapter();const identity=adapter.selectSingle();
    const draft=structuredClone(FOG_HARBOR_SCENARIO);delete draft.hash;draft.id='fact-flow-test';
    adapter.enqueueScenario(draft);const plan=JSON.parse(adapter.rawDecisions.shift());adapter.rawDecisions=[];
    const service=new ScenarioAuthoringService({adapter,assertMayContinue:()=>{},changed:()=>{}});
    return {adapter,identity,draft,plan,service};
}
function failedDraft(draft) {
    draft.scenes[0].moves[0].hiddenPatch.setVariables.first_inspection=true;
    draft.scenes[0].moves[0].conditions.notFacts.push('first_inspection');
    draft.scenes[1].moves[0].conditions.allFacts.push('first_inspection');
}
function savedJob(identity,plan,scenes) {
    return {id:'saved-final-failure',owner:JSON.stringify([identity.characterId,identity.chatId]),source:{kind:'custom',brief,worldFacts:''},plan,scenes,stage:'完整校验',error:'旧版完整校验失败',code:'AUTHORING_FAILED',finalFailed:true};
}

test('a variable does not declare an occurred fact, and unknown references fail at the individual scene',()=>{
    const {draft,plan}=setup();failedDraft(draft);
    assert.throws(()=>validateScene(draft.scenes[0],plan,0),e=>e.code==='INVALID_REFERENCES'&&e.message.includes('first_inspection'));
    assert.throws(()=>finalizeCustomScenario(draft),e=>e.code==='INVALID_REFERENCES'&&e.issues.length===2);
    draft.scenes[0].moves[0].hiddenPatch.occurredFactIds.push('first_inspection');
    assert.doesNotThrow(()=>validateScene(draft.scenes[0],plan,0));
    assert.doesNotThrow(()=>validateScene(draft.scenes[1],plan,1,[draft.scenes[0]]));
    assert.ok(scenePrompt({kind:'custom',brief,worldFacts:''},plan,1,'',[draft.scenes[0]]).includes('first_inspection'));
});

test('a saved complete draft repairs one producer scene and retains every other scene without regenerating them',async()=>{
    const {adapter,identity,draft,plan,service}=setup();failedDraft(draft);
    const before=structuredClone(draft.scenes);
    adapter.settings.authoringJobs=[savedJob(identity,plan,draft.scenes)];
    const corrected=structuredClone(draft.scenes[0]);corrected.moves[0].hiddenPatch.occurredFactIds.push('first_inspection');
    adapter.enqueueRaw(prompt=>{assert.ok(prompt.includes('first_inspection'));return JSON.stringify(corrected);});
    adapter.enqueueRaw(JSON.stringify(generatedPlayer()));
    const result=await service.resume(identity);
    assert.equal(adapter.rawPrompts.length,2);
    assert.deepEqual(result.scenes.slice(1),before.slice(1));
    assert.equal(result.scenes.length,before.length);
    assert.equal(adapter.settings.importedScenarios.length,1);assert.equal(service.read(identity),null);
});

test('failed local repairs retain the entire complete draft and never publish a partial scenario',async()=>{
    const {adapter,identity,draft,plan,service}=setup();failedDraft(draft);
    const before=structuredClone(draft.scenes);
    adapter.settings.authoringJobs=[savedJob(identity,plan,draft.scenes)];
    for(let i=0;i<3;i++)adapter.enqueueRaw(JSON.stringify(draft.scenes[0]));
    await assert.rejects(service.resume(identity),/已尝试 3 次/);
    assert.deepEqual(service.read(identity).scenes,before);
    assert.deepEqual(service.read(identity).previous.scenes,before);
    assert.equal(adapter.settings.importedScenarios.length,0);
});

test('a scene repair cannot delete a fact already produced by a saved action',()=>{
    const {draft,plan}=setup();const original=structuredClone(draft.scenes[0]);
    original.moves[0].hiddenPatch.occurredFactIds.push('established_event');
    assert.throws(()=>validateSceneRepair(draft.scenes[0],original,plan,0,draft.scenes),/不得移除/);
});
