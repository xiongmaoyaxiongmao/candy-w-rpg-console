import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectorApplication } from '../src/application/index.js';
import { finalizeScenario, validateScenario } from '../src/domain/scenario-schema.js';
import { validateDirectorState } from '../src/domain/director-state.js';
import { revisionSections } from '../src/protocol/scenario-revision.js';
import { PerChatRepository } from '../src/persistence/per-chat-repository.js';
import { FOG_HARBOR_SCENARIO } from '../src/scenarios/index.js';
import { FakeOfficialAdapter } from './support/fake-official-adapter.mjs';
import { DirectorUi } from '../src/ui/controller.js';
import { renderPanel } from '../src/ui/render.js';
function setup() {
 const adapter=new FakeOfficialAdapter();adapter.selectSingle('guide.png','partial-a');const draft=structuredClone(FOG_HARBOR_SCENARIO);delete draft.hash;draft.id='partial-story';const original=finalizeScenario(draft);adapter.settings.importedScenarios=[original];
 const repository=new PerChatRepository({adapter,validateState:validateDirectorState,validateScenario});
 return {adapter,repository,original,app:new DirectorApplication({adapter,repository}).start()};
}
const fields=s=>Object.fromEntries(s.fields.map(f=>[f.key,Array.isArray(f.value)?f.value.join('\n'):String(f.value??'')]));
const args=(original,ids)=>({id:original.id,expectedHash:original.hash,request:'把选择的内容改成温和的旧友重逢，保留既有连接。',sectionIds:ids});
const opening=original=>revisionSections(original).find(s=>s.id==='scenes.0.title');
function response(original){return {...fields(opening(original)),'scenes.0.description':'旧友在书店门口搬书，看见你回来，轻轻放下手里的纸箱。'};}

test('one selected scene makes one generation and changes no unselected content; adoption preserves chat snapshot',async()=>{
 const h=setup();await h.app.createCampaign({scenarioId:h.original.id,player:{name:'林雨',concept:'',relationship:'',attributes:{body:2,insight:1,rapport:0}}});const chat=structuredClone(h.adapter.currentChatMetadata());
 h.adapter.enqueueRaw(JSON.stringify(response(h.original)));await h.app.reviseScenario(args(h.original,[opening(h.original).id]));
 assert.equal(h.adapter.rawPrompts.length,1);const job=h.app.getAuthoringJob();assert.equal(job.completed,1);assert.equal(job.total,1);assert.equal(job.reviewReady,true);
 const candidate=structuredClone(h.adapter.settings.authoringJobs[0].review),original=structuredClone(h.original);
 candidate.scenes[0].description=original.scenes[0].description;candidate.hash=original.hash;candidate.contentVersion=original.contentVersion;assert.deepEqual(candidate,original);
 const preview=h.app.getScenarioDocument({source:'review'});assert.deepEqual(preview.revisedSectionIds,['scenes.0.title']);
 assert.equal(h.app.getScenarioDocument({id:h.original.id}).hash,h.original.hash);
 await h.app.acceptScenarioRevision({jobId:job.jobId});assert.notEqual(h.app.getScenarioDocument({id:h.original.id}).hash,h.original.hash);assert.deepEqual(h.adapter.currentChatMetadata(),chat);
});

test('out-of-scope fields are rejected and corrected before a preview exists',async()=>{
 const h=setup();h.adapter.enqueueRaw(JSON.stringify({...response(h.original),'public.title':'不可越界'}));h.adapter.enqueueRaw(JSON.stringify(response(h.original)));
 await h.app.reviseScenario(args(h.original,['scenes.0.title']));assert.equal(h.adapter.rawPrompts.length,2);assert.match(h.adapter.rawPrompts[1],/未知字段/);
 assert.equal(h.adapter.settings.authoringJobs[0].review.public.title,h.original.public.title);
});

test('multi-selection resumes only the interrupted part after reload',async()=>{
 const h=setup();const npc=revisionSections(h.original).find(s=>s.group==='人物');h.adapter.enqueueRaw(JSON.stringify(response(h.original)));h.adapter.enqueueRaw(new Error('offline'));
 await assert.rejects(h.app.reviseScenario(args(h.original,['scenes.0.title',npc.id])),/offline/);assert.equal(h.app.getAuthoringJob().completed,1);assert.equal(h.app.getAuthoringJob().reviewReady,false);
 const next=new DirectorApplication({adapter:h.adapter,repository:h.repository});const rewritten={...fields(npc),[npc.id]:'旧友林舟'};h.adapter.enqueueRaw(JSON.stringify(rewritten));await next.resumeAuthoring();
 assert.equal(h.adapter.rawPrompts.length,3);assert.equal(next.getAuthoringJob().completed,2);assert.deepEqual(next.getScenarioDocument({source:'review'}).revisedSectionIds,['scenes.0.title',npc.id]);
 assert.equal(h.adapter.settings.importedScenarios[0].hash,h.original.hash);
});

test('empty, duplicate, invalid selections fail before generation; failed partial work never replaces the library',async()=>{
 const h=setup();for(const ids of [[],['scenes.0.title','scenes.0.title'],['secrets.999.title']])await assert.rejects(h.app.reviseScenario(args(h.original,ids)),/至少选择/);
 assert.equal(h.adapter.rawPrompts.length,0);assert.equal(h.app.getAuthoringJob(),null);
 for(let i=0;i<3;i++)h.adapter.enqueueRaw(JSON.stringify({'scenes.0.description':'缺少字段'}));await assert.rejects(h.app.reviseScenario(args(h.original,['scenes.0.title'])),/已尝试 3 次/);
 assert.equal(h.app.getAuthoringJob().reviewReady,false);assert.equal(h.adapter.settings.importedScenarios[0].hash,h.original.hash);
});

test('partial review cannot overwrite a newer manual edit and can be kept as a separate copy',async()=>{
 const h=setup();h.adapter.enqueueRaw(JSON.stringify(response(h.original)));await h.app.reviseScenario(args(h.original,['scenes.0.title']));const preview=h.app.getScenarioDocument({source:'review'});
 await h.app.saveScenarioEdits({id:h.original.id,expectedHash:h.original.hash,changes:{'public.title':'更新后的标题'}});await assert.rejects(h.app.acceptScenarioRevision({jobId:preview.jobId}),/其他修改/);
 const copy=await h.app.copyScenario(preview);assert.notEqual(copy.id,h.original.id);assert.equal(h.app.getScenarioDocument({id:h.original.id}).title,'更新后的标题');assert.equal(h.app.getAuthoringJob(),null);
});

test('section action selects exactly that part; UI preserves an explicit whole-book option',async()=>{
 const h=setup();const ui=new DirectorUi(h.app);ui.openScript({id:h.original.id});await ui.perform('script-rewrite-section',{sectionId:'scenes.0.title'});
 assert.deepEqual(ui.revisionSelections[h.original.hash],{mode:'selected',ids:['scenes.0.title']});
 const html=renderPanel({viewModel:h.app.getViewModel(),screen:'script',scenarioDocument:ui.scenarioDocument,revisionSelection:ui.revisionSelections[h.original.hash]});
 assert.match(html,/重写这部分/);assert.match(html,/整本改写/);assert.match(html,/value="scenes.0.title"[^>]*\bchecked/);assert.match(html,/其余内容原样保留/);
});
