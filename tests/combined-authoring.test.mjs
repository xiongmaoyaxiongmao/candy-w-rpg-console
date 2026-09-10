import assert from 'node:assert/strict';
import test from 'node:test';
import { DirectorApplication } from '../src/application/index.js';
import { validateDirectorState, validateScenario, buildPublicPerformanceFacts } from '../src/domain/index.js';
import { PerChatRepository } from '../src/persistence/per-chat-repository.js';
import { FOG_HARBOR_SCENARIO } from '../src/scenarios/index.js';
import { FakeOfficialAdapter } from './support/fake-official-adapter.mjs';
import { assertCustomScenarioBrief } from '../src/protocol/custom-scenario.js';
import { authoringInput } from '../src/protocol/scenario-authoring.js';
import { compileAuthoringWorldInfoScanSeed } from '../src/compilation/index.js';
const brief = overrides => ({ title:'', premise:'回乡后和旧友重开书店。', opening:'雨停后，旧友在书店门口搬书。', tone:'温柔、慢热', setting:'', coreTruth:'', npcGoals:'', timePressure:'', endings:'', useWorldInfo:true, anchors:'书店，旧友', ...overrides });
function harness() {
    const adapter = new FakeOfficialAdapter(); adapter.selectSingle('guide.png','combined-authoring');
    const repository = new PerChatRepository({adapter, validateState:validateDirectorState, validateScenario});
    const app = new DirectorApplication({adapter,repository}).start();
    const draft = structuredClone(FOG_HARBOR_SCENARIO); delete draft.hash;
    draft.id='bookshop-reunion'; draft.public.tone='温柔、慢热';
    draft.scenes.find(s=>s.id===draft.startSceneId).description=brief().opening;
    return {adapter, repository, app, draft};
}
test('combined brief accepts optional details but rejects unsupported fields, invalid switches and missing requested world facts', () => {
    assert.equal(assertCustomScenarioBrief(brief()).opening, brief().opening);
    assert.throws(()=>assertCustomScenarioBrief(brief({useWorldInfo:'yes'})),/开关/);
    assert.throws(()=>assertCustomScenarioBrief({...brief(),unknown:1}),/未知字段/);
    assert.throws(()=>authoringInput('custom',brief(),''),/世界书/);
    assert.deepEqual(authoringInput('custom',brief({useWorldInfo:false}),'unused world facts').worldFacts,[]);
});
test('long multiline creative input is scanned completely with explicit keywords first and illegal controls rejected', () => {
    const premise='书店 '.repeat(400)+'末尾旧友';
    const seed=compileAuthoringWorldInfoScanSeed(['优先人物', '第一行\n第二行',premise]);
    assert.ok(seed.startsWith('优先人物\n')); assert.match(seed,/第一行 第二行/); assert.match(seed,/末尾旧友/);
    const boundary = "甲".repeat(159)+"临河书店"; assert.ok(compileAuthoringWorldInfoScanSeed([boundary]).includes("临河书店"));
    assert.throws(()=>compileAuthoringWorldInfoScanSeed(['非法\u0000字符']),/控制字符/);
});
test('combined creation scans native facts, retains opening in every authoring stage and passes tone to visible performance', async () => {
    const {adapter,repository,app,draft}=harness();
    try {
        adapter.nativeWorldInfo='旧友经营临河书店，店门朝东。'; adapter.enqueueScenario(draft);
        const result=await app.writeCustomScenario(brief({premise:'回乡的故事。'.repeat(60),coreTruth:'幕后保险箱藏着遗嘱'}));
        assert.equal(adapter.nativeWorldInfoRequests.length,1);
        assert.doesNotMatch(adapter.nativeWorldInfoRequests[0].scanSeed,/遗嘱/);
        assert.match(adapter.rawPrompts[0],/旧友经营临河书店/);
        for(const prompt of adapter.rawPrompts.slice(1)) { assert.doesNotMatch(prompt,/旧友经营临河书店/); assert.match(prompt,/雨停后，旧友在书店门口搬书/); }
        assert.equal(repository.load(),null); // authoring never creates a campaign
        await app.createCampaign({scenarioId:result.id,player:{name:'林雨',concept:'',relationship:'旧友',attributes:{body:2,insight:1,rapport:0}}});
        assert.match(buildPublicPerformanceFacts(repository.load(),adapter.settings.importedScenarios[0]).join('\n'),/温柔、慢热/);
        await app.enterWorld(); assert.match(adapter.prompts.directive,/雨停后[,，]旧友在书店门口搬书/); assert.match(adapter.prompts.directive,/温柔、慢热/);
    } finally { await app.destroy(); }
});
test('world lookup failure stops before model calls; plain creation never performs the optional scan', async () => {
    const {adapter,app,draft}=harness();
    try {
        adapter.nativeWorldInfo=new Error('没有命中的世界书条目');
        await assert.rejects(app.writeCustomScenario(brief()),/没有命中/); assert.equal(adapter.rawPrompts.length,0); assert.equal(app.getAuthoringJob(),null);
        adapter.enqueueScenario(draft); await app.writeCustomScenario(brief({useWorldInfo:false}));
        assert.equal(adapter.nativeWorldInfoRequests.length,1);
        assert.doesNotMatch(adapter.rawPrompts[0],/没有命中/);
    } finally { await app.destroy(); }
});
test('resuming a combined job reuses its original facts and brief without rescanning changed world info', async () => {
    const {adapter,app,draft}=harness();
    try {
        adapter.nativeWorldInfo='原世界事实：书店朝东。'; adapter.enqueueRaw(new Error('临时离线'));
        await assert.rejects(app.writeCustomScenario(brief()));
        assert.equal(adapter.settings.authoringJobs[0].source.brief.opening,brief().opening);
        adapter.nativeWorldInfo='已改变的世界书'; adapter.enqueueScenario(draft);
        await app.resumeAuthoring(); assert.equal(adapter.nativeWorldInfoRequests.length,1);
        assert.match(adapter.rawPrompts[1],/原世界事实：书店朝东/); assert.doesNotMatch(adapter.rawPrompts.at(-1),/原世界事实：书店朝东/); assert.doesNotMatch(adapter.rawPrompts.at(-1),/已改变的世界书/);
        assert.deepEqual(adapter.settings.authoringJobs,[]);
    } finally { await app.destroy(); }
});
