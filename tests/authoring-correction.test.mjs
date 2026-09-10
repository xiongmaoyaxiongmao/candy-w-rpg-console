import test from 'node:test';
import assert from 'node:assert/strict';
import { FakeOfficialAdapter } from './support/fake-official-adapter.mjs';
import { FOG_HARBOR_SCENARIO } from '../src/scenarios/index.js';
import { ScenarioAuthoringService } from '../src/application/scenario-authoring-service.js';
import { generateAuthoringStage } from '../src/application/authoring-stage.js';
import { contractIssues, object, text } from '../src/domain/json-contract.js';
import { AUTHORING_PLAN_CONTRACT } from '../src/domain/scenario-contract.js';
import { schemaFieldGuide } from '../src/protocol/structured-output.js';

const brief = { title:'灯塔测试', premise:'暴雨前修复灯塔。', tone:'悬疑', setting:'海港', opening:'灯塔熄灭。', coreTruth:'电路损坏。', npcGoals:'安全撤离。', timePressure:'午夜之前。', endings:'修复或撤离。' };
function setup() {
    const adapter = new FakeOfficialAdapter(); const identity = adapter.selectSingle();
    const draft = structuredClone(FOG_HARBOR_SCENARIO); delete draft.hash; draft.id = 'corrected-test'; adapter.enqueueScenario(draft);
    const service = new ScenarioAuthoringService({adapter, assertMayContinue: value => assert.deepEqual(value,adapter.currentChatIdentity()), changed:()=>{}});
    return {adapter,identity,service};
}
function wrongSecrets(raw) {
    const value=JSON.parse(raw);
    value.secrets.forEach(secret=>{secret.text=secret.fact;delete secret.fact;});
    return JSON.stringify(value);
}

test('all wrong secret field names are reported together and a model rewrite must pass the unchanged schema', async () => {
    const {adapter,identity,service}=setup();
    const valid=adapter.rawDecisions[0], wrong=wrongSecrets(valid), value=JSON.parse(wrong);
    const issues=contractIssues(value,AUTHORING_PLAN_CONTRACT);
    for(let i=0;i<value.secrets.length;i++) {
        assert.ok(issues.includes(`$.secrets[${i}]：缺少字段 fact`));
        assert.ok(issues.includes(`$.secrets[${i}]：含未知字段 text`));
    }
    adapter.rawDecisions.unshift(wrong);
    adapter.rawDecisions[1]=prompt=>{
        assert.ok(prompt.includes(JSON.stringify(wrong)));
        assert.ok(prompt.includes('含未知字段 text'));
        assert.equal(service.read(identity).plan,null);
        assert.equal(service.read(identity).attempts.attempt,2);
        assert.equal(service.read(identity).attempts.history[0].response.content,wrong);
        assert.equal(service.view(identity).correcting,true);
        return valid;
    };
    const result=await service.start(identity,'custom',brief,'');
    assert.ok(result.secrets.every(s=>Object.hasOwn(s,'fact')&&!Object.hasOwn(s,'text')));
    assert.equal(adapter.rawPrompts.length,result.scenes.length+3);
    assert.equal(adapter.settings.importedScenarios.length,1);
    assert.equal(service.read(identity),null);
});

test('a persisted pre-upgrade world plan failure resumes from its rejected draft and frozen world input', async () => {
    const {adapter,identity,service}=setup(); const wrong=wrongSecrets(adapter.rawDecisions[0]);
    adapter.settings.authoringJobs=[{id:'old-job',owner:JSON.stringify([identity.characterId,identity.chatId]),source:{kind:'world',brief:{title:'灯塔',outcome:'修复或安全撤离。',anchors:'灯塔'},worldFacts:'既有世界书事实快照：旧灯塔位于海港。'},plan:null,scenes:[],stage:'结构规划',error:'缺少字段 fact',code:'INVALID_FIELDS',diagnostic:{content:wrong,finishReason:'stop'},finalFailed:false}];
    const result=await service.resume(identity);
    assert.ok(adapter.rawPrompts[0].includes(JSON.stringify(wrong)));
    assert.ok(adapter.rawPrompts[0].includes('既有世界书事实快照'));
    assert.equal(adapter.settings.importedScenarios.length,1);
    assert.equal(result.scenes.length,FOG_HARBOR_SCENARIO.scenes.length);
});

test('three rejected outputs stop with intact draft, and transport failures never trigger repeated calls', async () => {
    for(const transport of [false,true]) {
        let calls=0; const job={stage:'结构规划',scenes:[]};
        const adapter={generateStructured:async()=>{calls++;if(transport){const e=new Error('network');e.code='REQUEST_FAILED';throw e;}return {content:'{"wrong":"x"}',finishReason:'stop',usage:{},requestId:String(calls)};}};
        await assert.rejects(generateAuthoringStage({adapter,identity:{},job,stageKey:'plan',stage:'结构规划',prompt:'write',schema:object({fact:text(100)}),validate:v=>v,check:()=>{},persist:async()=>{}}),transport?/network/:/已尝试 3 次/);
        assert.equal(calls,transport?1:3);
        if(!transport) {assert.equal(job.attempts.history.length,3);assert.equal(job.diagnostic.content,'{"wrong":"x"}');}
    }
});

test('cancellation after a failed response prevents its corrective request', async () => {
    let calls=0,cancelled=false;const job={stage:'结构规划',scenes:[]};
    await assert.rejects(generateAuthoringStage({adapter:{generateStructured:async()=>{calls++;return {content:'{}',finishReason:'stop',usage:{}};}},identity:{},job,stageKey:'plan',stage:'结构规划',prompt:'write',schema:object({fact:text(100)}),validate:v=>v,check:()=>{if(cancelled)throw new Error('cancelled');},persist:async()=>{if(job.code==='INVALID_FIELDS')cancelled=true;}}),/cancelled/);
    assert.equal(calls,1);
});

test('an interrupted correction retains its rejected draft across a later transport failure', async () => {
    const rejected={error:'缺少字段 fact',issues:['缺少字段 fact'],response:{content:'{"text":"old content"}'}};
    const job={stage:'结构规划',code:'REQUEST_FAILED',diagnostic:{content:''},attempts:{stageKey:'plan',history:[rejected]}};
    const value=await generateAuthoringStage({adapter:{generateStructured:async prompt=>{
        assert.ok(prompt.includes(JSON.stringify(rejected.response.content)));
        return {content:'{"fact":"old content"}',finishReason:'stop',usage:{}};
    }},identity:{},job,stageKey:'plan',stage:'结构规划',prompt:'write',schema:object({fact:text(100)}),validate:v=>v,check:()=>{},persist:async()=>{}});
    assert.deepEqual(value,{fact:'old content'});
});

test('the generated field guide tracks protocol field names instead of maintaining a separate example', () => {
    assert.ok(schemaFieldGuide(AUTHORING_PLAN_CONTRACT).includes('$.secrets[] 必须包含且只能包含：id、title、fact、revealText、leakPhrases'));
    assert.ok(schemaFieldGuide(AUTHORING_PLAN_CONTRACT).includes('$.clocks[].thresholds[].setVariables 允许符合字段名与值类型定义的自定义键'));
    assert.ok(schemaFieldGuide(object({newSection:object({newField:text(30)})})).includes('$.newSection 必须包含且只能包含：newField'));
});
