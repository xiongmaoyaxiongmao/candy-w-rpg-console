import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectorApplication } from '../src/application/index.js';
import { validateDirectorState, validateScenario } from '../src/domain/index.js';
import { METADATA_KEY, PerChatRepository } from '../src/persistence/per-chat-repository.js';
import { FOG_HARBOR_SCENARIO as scenario } from '../src/scenarios/index.js';
import { FakeOfficialAdapter } from './support/fake-official-adapter.mjs';
const entry = () => ({ id: 'p_stamina', kind: 'resource', name: '体力', value: 25, min: 0, max: 100, learnAt: null, rules: [{ id: 'p_run', condition: '跑去泵房', delta: -10, timing: 'action' }], thresholds: [{ id: 'p_tired', operator: 'lte', value: 20, reaction: '显出疲惫，同伴放慢脚步。', mode: 'once' }] });
const player = { name: '测试者', concept: '', relationship: '', attributes: { body: 0, insight: 2, rapport: 1 } };
const performance = '暴雨中，你来到泵房门前，雨水沿铁门淌下。身上的疲惫让你放慢脚步，同伴也停下来等待。';
async function harness(old = false) {
    const adapter = new FakeOfficialAdapter(); adapter.selectSingle();
    const repository = new PerChatRepository({ adapter, validateState: validateDirectorState, validateScenario });
    let seq = 0;
    const app = new DirectorApplication({ adapter, repository, deps: { id: () => `tx_${++seq}` } }).start();
    await app.createCampaign({ scenarioId: scenario.id, player, ...(old ? {} : { playerEntries: [entry()] }) });
    await app.enterWorld(); await adapter.completeGeneration('暴雨中的海关门前，同伴说明了眼前的事情。接下来去哪里，由你决定。');
    return { adapter, repository, app };
}
function decision(adapter) {
    adapter.appendUser('跑去泵房');
    adapter.enqueueRaw(prompt => {
        const req = JSON.parse(prompt.split('<action_request>\n')[1].split('\n</action_request>')[0]);
        return JSON.stringify({ transactionId: req.transactionId, baseRevision: req.baseRevision, nameChange: null, actionId: 'gate_to_pump', attribute: null, summary: '跑去泵房', ruleIds: ['p_run'] });
    });
}
const update = (app, entries) => { const view = app.getViewModel(); return app.updatePlayerProgression({ entries, expectedRevision: view.revision, campaignKey: view.campaignKey }); };

test('stopped performance resumes exact player settlement without another classification or charge', async () => {
    const h = await harness(); decision(h.adapter);
    assert.equal((await h.adapter.invokeInterceptor()).aborted, false);
    assert.equal(h.repository.load().player.progression.entries[0].value, 25);
    assert.match(h.adapter.prompts.directive, /25 → 15/);
    assert.match(h.adapter.prompts.directive, /显出疲惫/);
    const pending = h.repository.load().pendingTransaction;
    await h.adapter.stopGeneration();
    await assert.rejects(update(h.app, [entry()]), /当前推进|生成/);
    await h.app.retryPending();
    assert.deepEqual(h.repository.load().pendingTransaction, pending);
    assert.equal(h.adapter.rawPrompts.length, 1);
    await h.adapter.completeGeneration(performance);
    assert.equal(h.repository.load().player.progression.entries[0].value, 15);
    assert.deepEqual(h.repository.load().player.progression.fired, ['p_tired']);
    const snapshot = h.repository.load();
    await h.adapter.emit('messageReceived', h.adapter.currentMessages().length - 1, 'normal');
    assert.deepEqual(h.repository.load(), snapshot);
    await h.app.destroy();
});

test('cancelling a stopped action leaves all values and thresholds untouched', async () => {
    const h = await harness(); decision(h.adapter); await h.adapter.invokeInterceptor(); await h.adapter.stopGeneration();
    await h.app.cancelPending();
    assert.equal(h.repository.load().player.progression.entries[0].value, 25);
    assert.deepEqual(h.repository.load().player.progression.fired, []);
    await h.app.destroy();
});

test('old campaigns can adopt player rules; failed saves roll back; stale editors cannot overwrite progress or another chat', async () => {
    const h = await harness(true);
    await update(h.app, [entry()]);
    const before = h.repository.load();
    const draft = [entry()]; draft[0].value = 40;
    h.adapter.beforeNextSave = () => { throw new Error('disk unavailable'); };
    await assert.rejects(update(h.app, draft), /disk unavailable/);
    assert.deepEqual(h.repository.load(), before);
    const view = h.app.getViewModel(); await update(h.app, draft);
    await assert.rejects(h.app.updatePlayerProgression({ entries: [entry()], expectedRevision: view.revision, campaignKey: view.campaignKey }), /已经推进/);
    h.adapter.selectSingle('guide.png', 'chat-b'); await h.adapter.emit('chatChanged');
    await h.app.createCampaign({ scenarioId: scenario.id, player });
    await assert.rejects(h.app.updatePlayerProgression({ entries: [entry()], expectedRevision: 0, campaignKey: view.campaignKey }), /聊天已经切换/);
    assert.equal(h.repository.load().player.progression, undefined);
    await h.app.destroy();
});

test('native branch copies stats independently with once ledger and exported save preserves manual changes', async () => {
    const h = await harness(); const e = entry(); e.value = 15; await update(h.app, [e]);
    const source = structuredClone(h.adapter.currentChatMetadata());
    h.adapter.selectSingle('guide.png', 'branch-b');
    Object.assign(h.adapter.currentChatMetadata(), source, { main_chat: 'chat-a' });
    await h.adapter.emit('chatChanged');
    assert.equal(h.repository.load().player.progression.entries[0].value, 15);
    assert.deepEqual(h.repository.load().player.progression.fired, ['p_tired']);
    const b = entry(); b.value = 90; await update(h.app, [b]);
    const save = await h.app.exportSave();
    h.adapter.selectSingle('guide.png', 'chat-a'); await h.adapter.emit('chatChanged');
    assert.equal(h.repository.load().player.progression.entries[0].value, 15);
    h.adapter.selectSingle('guide.png', 'imported'); await h.adapter.emit('chatChanged'); await h.app.importSave(save);
    assert.equal(h.repository.load().player.progression.entries[0].value, 90);
    assert.equal(h.adapter.currentChatMetadata()[METADATA_KEY].identity.chatId, 'imported');
    await h.app.destroy();
});

test('public dice settle success skill growth only after the consequence performance commits', async () => {
    const h = await harness();
    const skill = { id:'p_skill',kind:'skill',name:'解读符文',value:15,min:0,max:100,learnAt:20,rules:[{id:'p_success',condition:'比对档案并解读符文',delta:5,timing:'success'},{id:'p_failure',condition:'比对档案并解读符文',delta:1,timing:'failure'}],thresholds:[] };
    await update(h.app,[entry(),skill]);
    const action = async(actionId,attribute,ruleIds) => {
        h.adapter.appendUser('比对档案并解读符文');
        h.adapter.enqueueRaw(prompt => { const req=JSON.parse(prompt.split('<action_request>\n')[1].split('\n</action_request>')[0]); return JSON.stringify({transactionId:req.transactionId,baseRevision:req.baseRevision,nameChange:null,actionId,attribute,summary:'比对档案并解读符文',ruleIds}); });
        await h.adapter.completeGeneration('你来到档案室，准备核对旧印和时间，相关线索已经放在眼前。接下来由你决定。');
    };
    await action('gate_to_office',null,[]); await action('office_search_check','insight',['p_success','p_failure']);
    assert.equal(h.repository.load().phase,'awaiting_check');
    assert.equal(h.repository.load().player.progression.entries[1].value,15);
    h.app.deps.random=()=>0.99;
    await h.app.rollPendingCheck();
    assert.equal(h.repository.load().player.progression.entries[1].value,15);
    assert.match(h.adapter.prompts.directive,/学会技能/);
    await h.adapter.completeGeneration('你已核对出档案的差异，符文的结构终于清晰。你掌握了解读方法，同伴将完整的证据放在你的面前。');
    assert.equal(h.repository.load().player.progression.entries[1].value,20);
    assert.deepEqual(h.repository.load().player.progression.deferred,[]);
    await h.app.destroy();
});
