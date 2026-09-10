import test from 'node:test';
import assert from 'node:assert/strict';
import {FOG_HARBOR_SCENARIO as base} from '../src/scenarios/index.js';
import {finalizeScenario} from '../src/domain/scenario-schema.js';
import {createDirectorState,prepareOpeningTurn,prepareActionTurn,preparePublicTurnContent,commitTurn,createCheckResult,prepareCheckConsequence,listAvailableMoves} from '../src/domain/director-state.js';
import {selectPublicKnowledge,restoreArrivalFacts} from '../src/domain/scenario-context.js';
import {buildPerformanceDirective} from '../src/protocol/performance.js';
import {buildActionDecisionPrompt} from '../src/protocol/action-decision.js';
import {revisionSections,sectionRevisionPrompt} from '../src/protocol/scenario-revision.js';
import {scenePrompt,authoringInput} from '../src/protocol/scenario-authoring.js';
import {FakeOfficialAdapter} from './support/fake-official-adapter.mjs';
const clone=v=>structuredClone(v);
const player={name:'旅行者',concept:'',relationship:'',attributes:{body:2,insight:1,rapport:0}};
const deps={now:()=> '2026-09-09T00:00:00.000Z',id:()=> 'test_turn'};
function fixture(){const draft=clone(base);delete draft.hash;draft.scenes.forEach((s,i)=>s.description=`PUBLIC_SCENE_${i}`);draft.secrets.forEach((s,i)=>{s.fact=`HIDDEN_${i}`;s.revealText=`REVEAL_${i}`;});return finalizeScenario(draft);}
function action(state,scenario,id){const m=listAvailableMoves(state,scenario).find(m=>m.id===id);return prepareActionTurn(state,scenario,{transactionId:'test_action',baseRevision:state.revision,actionId:id,attribute:m.allowedAttribute,summary:'行动'},deps);}
function opened(scenario){const prepared=prepareOpeningTurn(createDirectorState(scenario,player),scenario,deps);return commitTurn(prepared.state,scenario,prepared.turn,{performance:'开始行动。',deps});}
test('arrival uses destination picture and target in that turn; entry facts commit once without leaking future scenes',()=>{
    const s=fixture(),before=opened(s),prepared=action(before,s,'gate_to_office');
    const content=preparePublicTurnContent(prepared.state,s,prepared.turn);const text=JSON.stringify(content);
    assert.match(text,/PUBLIC_SCENE_1/);assert.doesNotMatch(text,/PUBLIC_SCENE_[02-9]|HIDDEN_/);
    assert.equal(before.hidden.occurredFacts.includes('entered_port_office'),false);
    const committed=commitTurn(prepared.state,s,prepared.turn,{performance:'抵达办公室。',deps});
    assert.equal(committed.hidden.occurredFacts.filter(x=>x==='entered_port_office').length,1);
    assert.equal(committed.public.scene.id,'port_office');
    assert.equal(committed.public.objective,prepared.turn.decision.publicPatch.objective??s.scenes[1].objective);
    assert.throws(()=>commitTurn(committed,s,prepared.turn,{performance:'不应重复',deps}));
});
test('public check waits for dice; resolved branch receives its scene and exact newly revealed text',()=>{
    const s=fixture();let p=action(opened(s),s,'gate_to_office'), state=commitTurn(p.state,s,p.turn,{performance:'到场',deps});
    p=action(state,s,'office_search_check');assert.doesNotMatch(JSON.stringify(preparePublicTurnContent(p.state,s,p.turn)),/REVEAL_|PUBLIC_SCENE_2/);
    state=commitTurn(p.state,s,p.turn,{performance:'等待投骰',deps});
    const result=createCheckResult(state,s,{checkId:'check_archives'},{random:()=>.999});p=prepareCheckConsequence(state,s,result,deps);
    const content=preparePublicTurnContent(p.state,s,p.turn);assert.ok(content.mustHappen.some(e=>e.includes('REVEAL_')));assert.doesNotMatch(JSON.stringify(content),/HIDDEN_/);
    assert.equal(state.hidden.currentSceneId,'port_office');assert.equal(p.turn.decision.nextSceneId,'old_pump');
});
test('legal boundary descriptions and stakes pass actual action and performance protocols without clipping',()=>{
    const s=clone(base);delete s.hash;s.scenes[0].moves[0].description='字'.repeat(400);s.checks[0].successStakes='成'.repeat(500);s.checks[0].failureStakes='败'.repeat(500);const scenario=finalizeScenario(s);
    const prompt=buildActionDecisionPrompt({transactionId:'t',baseRevision:0,playerAction:'尝试',allowedMoves:[{id:s.scenes[0].moves[0].id,label:'动作',description:s.scenes[0].moves[0].description}],allowedAttributes:[{id:'body',label:'身手'}]});assert.ok(prompt.includes('字'.repeat(400)));
    const c=scenario.checks[0];const directive=buildPerformanceDirective({publicFacts:[],mustHappen:['等待判定'],forbiddenTopics:[],check:{id:c.id,status:'required',reason:c.reason,attribute:c.attribute,formula:c.formula,difficulty:c.difficulty,successStakes:c.successStakes,failureStakes:c.failureStakes,roll:null}});
    assert.ok(directive.includes('成'.repeat(500)));assert.ok(directive.includes('败'.repeat(500)));
    assert.throws(()=>buildPerformanceDirective({publicFacts:['必要事实'.repeat(150)],mustHappen:['执行'],forbiddenTopics:[],check:null},{maxChars:100}),e=>e.code==='CONTEXT_BUDGET_EXCEEDED');
});
test('an unrelated known person stays saved but is absent until explicitly mentioned',()=>{
    const draft=clone(base);delete draft.hash;draft.knowledge.people.push({id:'remote_person',name:'遥远的故人',relation:'旧识',detail:'REMOTE_ONLY_DETAIL',status:'平安',anchors:['遥远的故人']});const s=finalizeScenario(draft),state=opened(s);state.public.knownPeopleIds.push('remote_person');
    assert.ok(!selectPublicKnowledge(s,state.public).people.some(p=>p.id==='remote_person'));
    assert.ok(selectPublicKnowledge(s,state.public,{playerAction:'我想起遥远的故人'}).people.some(p=>p.id==='remote_person'));
    assert.ok(state.public.knownPeopleIds.includes('remote_person'));
});
test('scene authoring and single-section rewrite exclude unrelated full story and world bodies',()=>{
    const adapter=new FakeOfficialAdapter(),draft=clone(base);delete draft.hash;adapter.enqueueScenario(draft);const plan=JSON.parse(adapter.rawDecisions[0]);
    const world=[{id:'world_0',title:'current',content:'CURRENT_WORLD_FACT'},{id:'world_1',title:'remote',content:'REMOTE_WORLD_FACT'}];plan.scenePlans[0].context.worldEntryIds=['world_0'];
    const source={kind:'custom',brief:{title:'Test'},worldFacts:world};const prompt=scenePrompt(source,plan,0);
    assert.match(prompt,/CURRENT_WORLD_FACT/);assert.doesNotMatch(prompt,/REMOTE_WORLD_FACT/);assert.ok(!prompt.includes(JSON.stringify(plan)));
    const section=revisionSections(base).find(s=>s.group==='场景');const revision=sectionRevisionPrompt({brief:{original:base,request:'改语气',sectionIds:[section.id]}},section,{});
    assert.ok(!revision.includes(JSON.stringify(base)));assert.ok(!revision.includes(base.scenes.at(-1).description));
});
test('migration adds only arrivals proved by submitted history and never changes private or public prose',()=>{
    const s=fixture(),prepared=action(opened(s),s,'gate_to_office'),state=commitTurn(prepared.state,s,prepared.turn,{performance:'抵达',deps});state.hidden.occurredFacts=state.hidden.occurredFacts.filter(id=>id!=='entered_port_office');
    const restored=restoreArrivalFacts(state,s);assert.ok(restored.hidden.occurredFacts.includes('entered_port_office'));assert.deepEqual(restored.history,state.history);assert.deepEqual(restored.player,state.player);
    assert.deepEqual(restoreArrivalFacts(restored,s),restored);assert.ok(!restored.hidden.occurredFacts.includes(s.scenes[2].entryFacts[0]));
});
test('confirmed ending injects only that ending and its epilogue',()=>{
    const draft=clone(base);delete draft.hash;const m=draft.scenes[0].moves.find(m=>m.id==='gate_to_office');m.nextSceneId=null;m.endingId=draft.endings[0].id;draft.endings.forEach((e,i)=>{e.summary=`ENDING_${i}`;e.epilogue=`EPILOGUE_${i}`;});const s=finalizeScenario(draft),p=action(opened(s),s,m.id);
    const text=JSON.stringify(preparePublicTurnContent(p.state,s,p.turn));assert.match(text,/ENDING_0/);assert.match(text,/EPILOGUE_0/);assert.doesNotMatch(text,/ENDING_[1-9]|EPILOGUE_[1-9]/);
    assert.equal(commitTurn(p.state,s,p.turn,{performance:'结束',deps}).phase,'ended');
});
test('settings conversion retains API credentials, frozen jobs and story hashes without touching unrelated settings',async()=>{
    const {migrateDirectorSettings,migrateChatEnvelope}=await import('../src/persistence/director-migration.js');
    const input={enabled:true,auxiliaryApis:{profiles:[{id:'p',credential:'local-test'}],directorProfileId:'p',mainOutputMode:'json_object'},importedScenarios:[clone(base)],authoringJobs:[{source:{kind:'world',worldFacts:'first paragraph\n\nsecond paragraph'},scenes:[],plan:null}],customPreference:true};
    const next=migrateDirectorSettings(input);assert.equal(next.auxiliaryApis.profiles[0].credential,'local-test');assert.deepEqual(next.importedScenarios,input.importedScenarios);assert.equal(next.authoringJobs[0].source.worldFacts.map(e=>e.content).join(''),input.authoringJobs[0].source.worldFacts);assert.equal(next.customPreference,true);assert.deepEqual(migrateDirectorSettings(next),next);
    const s=fixture(),p=prepareOpeningTurn(createDirectorState(s,player),s,deps);
    assert.throws(()=>migrateChatEnvelope({scenario:s,state:p.state,runtime:{operation:{}}}),/未完成事务/);
});
test('boundary-length Unicode is preserved rather than normalized into an invalid longer string',()=>{
    const description='Ⅷ'.repeat(400),label='Ⅷ'.repeat(120);
    const prompt=buildActionDecisionPrompt({transactionId:'t',baseRevision:0,playerAction:'尝试',allowedMoves:[{id:'m',label,description}],allowedAttributes:[{id:'body',label:'身手'}]});assert.ok(prompt.includes(description));assert.ok(prompt.includes(label));
    const c=base.checks[0],stakes='Ⅷ'.repeat(500);
    const directive=buildPerformanceDirective({publicFacts:[],mustHappen:['事件'],forbiddenTopics:[],check:{id:c.id,status:'required',reason:c.reason,attribute:c.attribute,formula:c.formula,difficulty:c.difficulty,successStakes:stakes,failureStakes:stakes,roll:null}});assert.ok(directive.includes(stakes));
});
