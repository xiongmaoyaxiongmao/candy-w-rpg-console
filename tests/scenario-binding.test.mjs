import { editablePlayerEntries } from '../src/ui/player-progression.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectorApplication } from '../src/application/index.js';
import { PerChatRepository } from '../src/persistence/per-chat-repository.js';
import { validateScenario, validateDirectorState } from '../src/domain/index.js';
import { FOG_HARBOR_SCENARIO as scenario } from '../src/scenarios/index.js';
import { FakeOfficialAdapter } from './support/fake-official-adapter.mjs';
import { DirectorUi } from '../src/ui/controller.js';
import { renderPanel } from '../src/ui/render.js';
const fields = () => ({playerName:'林雨',playerConcept:'旅行者',playerRelationship:'旧友',attributeBody:'2',attributeInsight:'1',attributeRapport:'0'});
const entry = () => ({id:'p_magic',kind:'resource',name:'魔力',value:'80',min:'0',max:'100',learnAt:null,rules:[{id:'p_rest',condition:'安全休息',delta:'5',timing:'action'}],thresholds:[{id:'p_glow',operator:'gte',value:'90',reaction:'眼睛发光',mode:'cross'}]});
function harness(adapter = new FakeOfficialAdapter()) {
 const repository=new PerChatRepository({adapter,validateState:validateDirectorState,validateScenario});
 return {adapter,repository,app:new DirectorApplication({adapter,repository}).start()};
}
const save=(app,extra={})=>app.saveScenarioSetup({scenarioId:scenario.id,playerDraft:fields(),playerEntries:[entry()],expectedRevision:null,...extra});
const bind=app=>app.bindScenarioToCurrentChat({scenarioId:scenario.id,campaignKey:app.getScenarioContextKey()});

test('script settings persist independently without a chat, survive fresh applications and bind to multiple chats', async()=>{
 const h=harness();await save(h.app);assert.equal(h.adapter.currentChatIdentity(),null);assert.equal(h.adapter.rawPrompts.length,0);
 const restored=new FakeOfficialAdapter();restored.settings=structuredClone(h.adapter.settings);const fresh=harness(restored);
 assert.deepEqual(fresh.app.getScenarioSetup(scenario.id).playerEntries,[entry()]);
 await restored.switchSingle('guide.png','a');await bind(fresh.app);const a=structuredClone(fresh.repository.load());
 assert.equal(a.player.name,'林雨');assert.equal(a.player.progression.entries[0].value,80);assert.equal(a.phase,'ready');
 await restored.switchSingle('guide.png','b');await bind(fresh.app);const b=fresh.repository.load();assert.equal(b.phase,'ready');
 const view=fresh.app.getViewModel();await fresh.app.updatePlayerProgression({name:'新名字',entries:b.player.progression.entries,expectedRevision:view.revision,campaignKey:view.campaignKey});
 await restored.switchSingle('guide.png','a');assert.deepEqual(fresh.repository.load(),a);
 assert.equal(fresh.app.getScenarioSetup(scenario.id).playerDraft.playerName,'林雨');
 assert.equal(restored.generationRequests.length,0);assert.equal(restored.rawPrompts.length,0);
});

test('binding twice preserves progress and saved settings updates affect only future bindings',async()=>{
 const h=harness();await save(h.app);h.adapter.selectSingle();await bind(h.app);const initial=structuredClone(h.repository.load());
 assert.equal((await bind(h.app)).alreadyBound,true);assert.deepEqual(h.repository.load(),initial);
 await save(h.app,{expectedRevision:1,playerDraft:{...fields(),playerName:'下一位'}});assert.deepEqual(h.repository.load(),initial);
 await h.adapter.switchSingle('guide.png','new');await bind(h.app);assert.equal(h.repository.load().player.name,'下一位');
 await h.app.endCampaign();assert.equal(h.app.getScenarioSetup(scenario.id).revision,2);
});

test('settings save failures preserve previous configuration and incomplete settings save but cannot bind',async()=>{
 const h=harness();await save(h.app);const before=structuredClone(h.adapter.settings);
 h.adapter.persistApiSettings=async()=>{throw new Error('disk unavailable');};await assert.rejects(save(h.app,{expectedRevision:1}),/disk unavailable/);assert.deepEqual(h.adapter.settings,before);
 delete h.adapter.persistApiSettings;
 await assert.rejects(save(h.app),/设置已经更新/);
 await save(h.app,{expectedRevision:1,playerDraft:{...fields(),playerName:''}});h.adapter.selectSingle();await assert.rejects(bind(h.app),/称呼/);assert.equal(h.repository.load(),null);
});

test('wrong-chat bindings and failed chat persistence cannot consume the independently saved script settings',async()=>{
 const h=harness();await save(h.app);h.adapter.selectSingle();const old=h.app.getScenarioContextKey();await h.adapter.switchSingle('guide.png','b');
 await assert.rejects(h.app.bindScenarioToCurrentChat({scenarioId:scenario.id,campaignKey:old}),/聊天已经切换/);assert.equal(h.repository.load(),null);
 h.adapter.beforeNextSave=()=>{throw new Error('chat save failed');};await assert.rejects(bind(h.app),/chat save failed/);assert.equal(h.repository.load(),null);assert.equal(h.app.getScenarioSetup(scenario.id).revision,1);
});

test('library setup UI loads saved fields without a chat and does not force binding or export',async()=>{
 const h=harness();await save(h.app);const ui=new DirectorUi(h.app);ui.openScenarioSetup(scenario.id);assert.deepEqual(ui.playerDraft,fields());assert.deepEqual(ui.playerEntries,editablePlayerEntries([entry()]));
 const html=renderPanel({viewModel:h.app.getViewModel(),screen:ui.screen,scenarioSetup:ui.scenarioSetup,playerDraft:ui.playerDraft,playerEntries:ui.playerEntries});
 assert.match(html,/保存剧本设置/);assert.match(html,/同一剧本可绑定多个聊天/);assert.match(html,/data-action="submit-create"[^>]* disabled/);assert.doesNotMatch(html,/当前没有单角色聊天/);
});
