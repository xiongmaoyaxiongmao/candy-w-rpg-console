import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectorApplication } from '../src/application/index.js';
import { finalizeScenario } from '../src/domain/scenario-schema.js';
import { validateDirectorState, validateScenario, stateMatchesScenario } from '../src/domain/index.js';
import { nextScenarioVersion } from '../src/domain/scenario-content.js';
import { PerChatRepository } from '../src/persistence/per-chat-repository.js';
import { importScenarioPackage } from '../src/io/index.js';
import { FOG_HARBOR_SCENARIO } from '../src/scenarios/index.js';
import { FakeOfficialAdapter } from './support/fake-official-adapter.mjs';
import { renderPanel } from '../src/ui/render.js';
import { DirectorUi } from '../src/ui/controller.js';
function setup() {
    const adapter=new FakeOfficialAdapter();adapter.selectSingle('guide.png','edit-a');
    const draft=structuredClone(FOG_HARBOR_SCENARIO);delete draft.hash;draft.id='editable-story';
    const original=finalizeScenario(draft);adapter.settings.importedScenarios=[original];
    const repository=new PerChatRepository({adapter,validateState:validateDirectorState,validateScenario});
    const app=new DirectorApplication({adapter,repository}).start();return {adapter,original,repository,app};
}
const player={name:'林雨',concept:'',relationship:'旧友',attributes:{body:2,insight:1,rapport:0}};
function revised(original){const draft=structuredClone(original);delete draft.hash;draft.contentVersion=nextScenarioVersion(original.contentVersion);draft.scenes[0].description='旧友在书店门口搬书，看见来人时停下手中的动作。';return draft;}
test('full author reading includes scenes, secrets, outcomes and rules without adding spoilers to normal player screens', async()=>{
 const {app,original}=setup();try{const doc=app.getScenarioDocument({id:original.id});assert.equal(doc.editable,true);for(const group of ['概览','场景','人物','真相','时间','知识','判定','结局'])assert.ok(doc.sections.some(s=>s.group===group));
 const html=renderPanel({viewModel:app.getViewModel(),screen:'script',scenarioDocument:doc});assert.ok(!html.includes(original.secrets[0].fact));assert.ok(renderPanel({viewModel:app.getViewModel(),screen:'script',scenarioDocument:doc,scriptGroup:'真相'}).includes(original.secrets[0].fact));assert.ok(!html.includes('data-section-title="第 1 章'));assert.match(html,/<details class="cw-script-revision"><summary>/);assert.match(html,/直接编辑文字/);assert.match(html,/生成改写预览/);
 assert.ok(!renderPanel({viewModel:app.getViewModel(),screen:'scenarios',scenarios:app.listScenarios()}).includes(original.secrets[0].fact));
 }finally{await app.destroy();}
});
test('manual changes persist, preserve current snapshots, export correctly, and do not duplicate library entries', async()=>{
 const {app,adapter,original,repository}=setup();try{
 await app.createCampaign({scenarioId:original.id,player});const metadata=structuredClone(adapter.currentChatMetadata());
 const doc=await app.saveScenarioEdits({id:original.id,expectedHash:original.hash,changes:{'scenes.0.description':'旧友正把书搬到门口。','public.title':'书店重逢'}});
 assert.equal(doc.version,nextScenarioVersion(original.contentVersion));assert.notEqual(doc.hash,original.hash);assert.deepEqual(adapter.currentChatMetadata(),metadata);assert.equal(repository.loadScenario().hash,original.hash);
 assert.equal(app.listScenarios().filter(s=>s.id===original.id).length,1);assert.equal(adapter.settings.scenarioBackups[0].hash,original.hash);assert.equal(adapter.rawPrompts.length,0);
 assert.equal(importScenarioPackage(app.exportScenarioDocument({id:original.id})).scenes[0].description,'旧友正把书搬到门口。');
 adapter.selectSingle('guide.png','edit-b');await app.createCampaign({scenarioId:original.id,player});assert.equal(repository.loadScenario().hash,doc.hash);assert.ok(stateMatchesScenario(repository.load(),repository.loadScenario()));
 }finally{await app.destroy();}
});
test('invalid content, stale edits, and failed persistence never overwrite the existing script', async()=>{
 const {app,adapter,original}=setup();try{
 for(const changes of [{'scenes.0.id':'bad'}, {'scenes.0.description':''}, {'scenes.0.description':'bad\u0000'}, {'clocks.0.endMinute':'0'}])await assert.rejects(app.saveScenarioEdits({id:original.id,expectedHash:original.hash,changes}));
 assert.equal(adapter.settings.importedScenarios[0].hash,original.hash);
 adapter.persistApiSettings=async()=>{throw new Error('save unavailable');};await assert.rejects(app.saveScenarioEdits({id:original.id,expectedHash:original.hash,changes:{'public.title':'修改'}}),/unavailable/);
 assert.equal(app.getScenarioDocument({id:original.id}).hash,original.hash);delete adapter.persistApiSettings;
 await app.saveScenarioEdits({id:original.id,expectedHash:original.hash,changes:{'public.title':'修改'}});
 await assert.rejects(app.saveScenarioEdits({id:original.id,expectedHash:original.hash,changes:{'public.title':'过期'}}),/已更新/);
 }finally{await app.destroy();}
});
test('built-in and fixed versions can be copied and edited; restoring previous content is recoverable', async()=>{
 const {app,adapter,original}=setup();try{
 const builtin=app.getScenarioDocument({id:FOG_HARBOR_SCENARIO.id});assert.equal(builtin.editable,false);
 await assert.rejects(app.saveScenarioEdits({id:builtin.id,expectedHash:builtin.hash,changes:{'public.title':'no'}}),/内置/);
 const copy=await app.copyScenario({id:builtin.id});assert.equal(copy.editable,true);assert.notEqual(copy.id,builtin.id);
 const edited=await app.saveScenarioEdits({id:original.id,expectedHash:original.hash,changes:{'public.title':'修改后'}});
 const restored=await app.restorePreviousScenario({id:original.id,expectedHash:edited.hash});assert.equal(restored.title,original.public.title);assert.equal(adapter.settings.scenarioBackups.find(s=>s.id===original.id).public.title,'修改后');
 }finally{await app.destroy();}
});
test('director revision is persisted as a review, survives reload, and only adoption publishes it', async()=>{
 const {app,adapter,original,repository}=setup();try{
 await app.createCampaign({scenarioId:original.id,player});const before=structuredClone(adapter.currentChatMetadata());adapter.enqueueScenario(revised(original),{includePlayer:false});
 await app.reviseScenario({id:original.id,expectedHash:original.hash,request:'把开场改为旧友重逢，保留其他结构。'});
 const job=app.getAuthoringJob();assert.equal(job.reviewReady,true);assert.equal(adapter.settings.importedScenarios[0].hash,original.hash);assert.equal(app.getScenarioDocument({id:original.id}).hash,original.hash);
 assert.match(adapter.rawPrompts[0],/把开场改为旧友重逢/);assert.ok(adapter.rawPrompts[0].includes(original.scenes[0].description));
 const reloaded=new DirectorApplication({adapter,repository});const preview=reloaded.getScenarioDocument({source:'review'});assert.equal(preview.source,'review');assert.equal(preview.editable,false);
 const saved=await reloaded.acceptScenarioRevision({jobId:job.jobId});assert.notEqual(saved.hash,original.hash);assert.deepEqual(adapter.settings.authoringJobs,[]);assert.deepEqual(adapter.currentChatMetadata(),before);assert.equal(repository.loadScenario().hash,original.hash);
 }finally{await app.destroy();}
});
test('failed revisions resume original work and conflicts keep the preview without overwriting newer manual edits', async()=>{
 const {app,adapter,original}=setup();try{
 adapter.enqueueRaw(new Error('offline'));await assert.rejects(app.reviseScenario({id:original.id,expectedHash:original.hash,request:'修改开场'}),/offline/);assert.equal(adapter.settings.importedScenarios[0].hash,original.hash);
 adapter.enqueueScenario(revised(original),{includePlayer:false});await app.resumeAuthoring();const jobId=app.getAuthoringJob().jobId;
 const manual=await app.saveScenarioEdits({id:original.id,expectedHash:original.hash,changes:{'public.title':'手动新标题'}});
 await assert.rejects(app.acceptScenarioRevision({jobId}),/其他修改/);assert.equal(app.getScenarioDocument({id:original.id}).hash,manual.hash);assert.equal(app.getAuthoringJob().reviewReady,true);
 }finally{await app.destroy();}
});
test('full length legal opening content can actually enter the story', async()=>{
 const {app,original,adapter}=setup();try{
 await app.saveScenarioEdits({id:original.id,expectedHash:original.hash,changes:{'scenes.0.description':'书'.repeat(800)}});
 await app.createCampaign({scenarioId:original.id,player});await app.enterWorld();assert.ok(adapter.prompts.directive.includes('书'.repeat(800)));
 }finally{await app.destroy();}
});
test('post-authoring controller opens the readable script before player setup and binds reviews to their chat', async()=>{
 const {app,original,adapter}=setup();try{
 const ui=new DirectorUi(app);await ui.afterAuthoring(original);assert.equal(ui.screen,'script');assert.equal(ui.scenarioDocument.id,original.id);
 adapter.enqueueScenario(revised(original),{includePlayer:false});await app.reviseScenario({id:original.id,expectedHash:original.hash,request:'修改开场'});await ui.afterAuthoring(original);ui.reconcileScreen();assert.equal(ui.scenarioDocument.source,'review');
 adapter.selectSingle('guide.png','another-chat');ui.reconcileScreen();assert.equal(ui.scenarioDocument,null);assert.equal(ui.screen,'scenarios');
 }finally{await app.destroy();}
});
test('a conflicted director preview can be saved as an independent copy without losing either version', async()=>{
 const {app,adapter,original}=setup();try{
 adapter.enqueueScenario(revised(original),{includePlayer:false});await app.reviseScenario({id:original.id,expectedHash:original.hash,request:'修改开场'});
 const review=app.getScenarioDocument({source:'review'});await app.saveScenarioEdits({id:original.id,expectedHash:original.hash,changes:{'public.title':'更新的原剧本'}});
 const copy=await app.copyScenario(review);assert.notEqual(copy.id,original.id);assert.equal(app.getScenarioDocument({id:original.id}).title,'更新的原剧本');
 assert.match(importScenarioPackage(app.exportScenarioDocument({id:copy.id})).scenes[0].description,/书店门口/);assert.equal(app.getAuthoringJob(),null);
 }finally{await app.destroy();}
});

test('changing the opening persists its name and reference, starts new chats there, and preserves existing chats', async()=>{
 const h=setup();try{
 const d=structuredClone(h.original);delete d.hash;
 const back=structuredClone(d.scenes[0].moves[0]);back.id='office_return_gate';back.nextSceneId=d.scenes[0].id;
 d.scenes[1].moves.push(back);const original=finalizeScenario(d);h.adapter.settings.importedScenarios=[original];
 await h.app.createCampaign({scenarioId:original.id,player});const before=structuredClone(h.adapter.currentChatMetadata());
 const saved=await h.app.saveScenarioEdits({id:original.id,expectedHash:original.hash,changes:{startSceneId:original.scenes[1].id,'scenes.1.title':'从档案室开始','scenes.1.description':'你在档案室醒来。'}});
 assert.deepEqual(h.adapter.currentChatMetadata(),before);
 const exported=importScenarioPackage(h.app.exportScenarioDocument({id:original.id}));assert.equal(exported.startSceneId,original.scenes[1].id);
 const field=saved.sections.flatMap(s=>s.fields).find(f=>f.key==='startSceneId');assert.equal(field.options.find(o=>o.value===field.value).label,'从档案室开始');
 h.adapter.selectSingle('guide.png','changed-opening');await h.app.createCampaign({scenarioId:original.id,player});
 assert.equal(h.repository.load().hidden.currentSceneId,original.scenes[1].id);assert.ok(stateMatchesScenario(h.repository.load(),h.repository.loadScenario()));
 await h.app.enterWorld();assert.ok(h.adapter.prompts.directive.includes('你在档案室醒来。'));assert.equal(h.adapter.rawPrompts.length,0);
 }finally{await h.app.destroy();}
});
test('invalid opening connections do not overwrite the script; opening controls follow unsaved selections',async()=>{
 const h=setup();try{
 await assert.rejects(h.app.saveScenarioEdits({id:h.original.id,expectedHash:h.original.hash,changes:{startSceneId:h.original.scenes[1].id}}),/不能从这个场景开场.*输入的修改仍保留/);
 assert.equal(h.adapter.settings.importedScenarios[0].hash,h.original.hash);
 const ui=new DirectorUi(h.app);ui.openScript({id:h.original.id});await ui.perform('script-opening-choice');assert.equal(ui.scriptEditing,true);assert.equal(ui.scriptGroup,'概览');
 ui.scriptDrafts[h.original.hash]={startSceneId:h.original.scenes[1].id};await ui.perform('script-edit-opening');assert.equal(ui.scriptGroup,'场景');assert.equal(ui.openingFocusKey,'scenes.1.title');
 assert.equal(ui.scriptDrafts[h.original.hash].startSceneId,h.original.scenes[1].id);
 }finally{await h.app.destroy();}
});
