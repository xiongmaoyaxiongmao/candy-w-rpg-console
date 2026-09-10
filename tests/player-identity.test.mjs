import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectorApplication } from '../src/application/index.js';
import { validateDirectorState, validateScenario } from '../src/domain/index.js';
import { PerChatRepository } from '../src/persistence/per-chat-repository.js';
import { FOG_HARBOR_SCENARIO as scenario } from '../src/scenarios/index.js';
import { FakeOfficialAdapter } from './support/fake-official-adapter.mjs';
import { actionDecisionContract, buildActionDecisionPrompt, parseAndValidateActionDecision } from '../src/protocol/action-decision.js';
import { assertNameChangeEvidence, renamePlayer, validateNameHistory } from '../src/domain/player-identity.js';
const player={name:'林雨',concept:'旅行者',relationship:'旧友',attributes:{body:0,insight:2,rapport:1}};
const action='从现在起，我采用化名“莲灯”，然后去泵房。';
const change={name:'莲灯',source:'action',evidence:'我采用化名“莲灯”'};
async function harness(story='雨中的海关门前，同伴介绍了眼前的局势，把行动权交还给你。') {
    const adapter=new FakeOfficialAdapter();adapter.selectSingle();
    const repository=new PerChatRepository({adapter,validateState:validateDirectorState,validateScenario});let seq=0;
    const app=new DirectorApplication({adapter,repository,deps:{id:()=>`tx_name_${++seq}`}}).start();
    await app.createCampaign({scenarioId:scenario.id,player});await app.enterWorld();await adapter.completeGeneration(story);
    return {adapter,repository,app};
}
function queue(h,nameChange=change,text=action) {
    h.adapter.appendUser(text);
    h.adapter.enqueueRaw(prompt=>{const req=JSON.parse(prompt.split('<action_request>\n')[1].split('\n</action_request>')[0]);return JSON.stringify({transactionId:req.transactionId,baseRevision:req.baseRevision,actionId:'gate_to_pump',attribute:null,summary:'采用化名并去泵房',nameChange,...(req.playerState?{ruleIds:[]}:{} )});});
}
async function manual(h,name) {const view=h.app.getViewModel();await h.app.updatePlayerProgression({entries:view.player.progression?.entries??[],name,expectedRevision:view.revision,campaignKey:view.campaignKey});}

test('automatic rename is staged with the story, retry commits once, and identity survives save transfer',async()=>{
    const h=await harness();queue(h);await h.adapter.invokeInterceptor();
    assert.equal(h.repository.load().player.name,'林雨');
    assert.match(h.adapter.prompts.directive,/玩家角色：莲灯/);
    assert.match(h.adapter.prompts.directive,/同一人/);
    await h.adapter.stopGeneration();await h.app.retryPending();
    assert.equal(h.adapter.rawPrompts.length,1);
    await h.adapter.completeGeneration('“莲灯。”同伴记下你的新称呼，和你走进泵房，接下来的调查由你决定。');
    const after=h.repository.load();assert.equal(after.player.name,'莲灯');assert.equal(after.player.nameHistory.length,1);assert.equal(after.player.concept,player.concept);
    await h.adapter.emit('messageReceived',h.adapter.currentMessages().length-1,'normal');assert.deepEqual(h.repository.load(),after);
    const save=await h.app.exportSave();h.adapter.selectSingle('guide.png','renamed-import');await h.adapter.emit('chatChanged');await h.app.importSave(save);
    assert.deepEqual(h.repository.load().player,after.player);await h.app.destroy();
});

test('cancelled or invalid rename cannot change the stored player',async()=>{
    const h=await harness();queue(h);await h.adapter.invokeInterceptor();await h.adapter.stopGeneration();await h.app.cancelPending();
    assert.equal(h.repository.load().player.name,'林雨');assert.equal(h.repository.load().player.nameHistory,undefined);await h.app.destroy();
    const bad=await harness();queue(bad,{name:'莲灯',source:'action',evidence:'我现在叫莲灯。'});
    const result=await bad.adapter.invokeInterceptor();assert.equal(result.aborted,true);assert.equal(bad.repository.load().player.name,'林雨');assert.equal(bad.repository.load().pendingTransaction,null);await bad.app.destroy();
});

test('adopted names in the last completed story can update the next action',async()=>{
    const h=await harness('你明确接受了“莲灯”这个化名，并让同伴以后以此称呼你。海关门外的雨还在下。');
    queue(h,{name:'莲灯',source:'story',evidence:'你明确接受了“莲灯”这个化名'},'我去泵房。');
    await h.adapter.completeGeneration('同伴以莲灯称呼你，一起走入泵房，等待你决定如何调查。');
    assert.equal(h.repository.load().player.name,'莲灯');assert.equal(h.repository.load().player.nameHistory[0].source,'story');await h.app.destroy();
});

test('manual correction is persisted and a previous narrative cannot automatically undo it',async()=>{
    const h=await harness('你明确接受了“莲灯”这个化名，并让同伴以后以此称呼你。');
    await manual(h,'阿雨');assert.equal(h.repository.load().player.name,'阿雨');
    queue(h,null,'我去泵房。');await h.adapter.invokeInterceptor();
    const req=JSON.parse(h.adapter.rawPrompts.at(-1).split('<action_request>\n')[1].split('\n</action_request>')[0]);
    assert.equal(req.playerIdentity.currentName,'阿雨');assert.equal(req.playerIdentity.recentStory,'');
    assert.match(h.adapter.prompts.directive,/林雨/);assert.match(h.adapter.prompts.directive,/同一个玩家角色/);
    await h.adapter.completeGeneration('阿雨，你面前的泵房电路已经露出来，同伴等你作决定。');assert.equal(h.repository.load().player.name,'阿雨');
    const before=h.repository.load();h.adapter.beforeNextSave=()=>{throw new Error('save failed');};await assert.rejects(manual(h,'小雨'),/save failed/);assert.deepEqual(h.repository.load(),before);await h.app.destroy();
});

test('strict evidence contract rejects invented quotes, other names, controls and stale no-op updates',()=>{
    const context={currentName:'林雨',playerAction:action,recentStory:''};
    assert.deepEqual(assertNameChangeEvidence(change,context),change);
    for(const c of [{...change,name:'外人'},{...change,evidence:'没有发生的故事'},{...change,source:'story'},{...change,name:'莲\n灯'}])assert.throws(()=>assertNameChangeEvidence(c,context));
    assert.throws(()=>assertNameChangeEvidence({name:'林雨',source:'action',evidence:'林雨'},{...context,playerAction:'林雨'}));
    const expected={transactionId:'tx_test',baseRevision:1,allowedMoveIds:['walk'],allowedAttributeIds:['body'],identityContext:context};
    const value={transactionId:'tx_test',baseRevision:1,actionId:'walk',attribute:null,summary:'采用化名',nameChange:change};
    assert.equal(parseAndValidateActionDecision(JSON.stringify(value),expected).nameChange.name,'莲灯');
    assert.throws(()=>parseAndValidateActionDecision(JSON.stringify({...value,otherName:'某人'}),expected));
    assert.ok(actionDecisionContract(expected).properties.nameChange);
    const prompt=buildActionDecisionPrompt({transactionId:'tx_test',baseRevision:1,playerAction:action,allowedMoves:[{id:'walk',label:'前进'}],allowedAttributes:[{id:'body',label:'身手'}],playerIdentity:{currentName:player.name,recentStory:''}});
    assert.match(prompt,/偶尔的昵称/);assert.match(prompt,/nameChange/);
});

test('name history is bounded, current name must match, and blank/control names cannot be saved',()=>{
    let next=player;for(let i=1;i<=40;i++)next=renamePlayer(next,`化名${i}`,i,'manual');
    assert.equal(next.nameHistory.length,32);assert.equal(validateNameHistory(next.nameHistory,next.name),true);assert.equal(validateNameHistory(next.nameHistory,'别的人'),false);
    for(const name of ['',' ','名字\n','a'.repeat(121)])assert.throws(()=>renamePlayer(player,name,1,'manual'));
    assert.deepEqual(renamePlayer(player,player.name,1,'manual'),player);
});
