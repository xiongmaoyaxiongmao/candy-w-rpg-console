import test from 'node:test';
import assert from 'node:assert/strict';
import { DirectorApplication } from '../src/application/index.js';
import { validateDirectorState, validateScenario } from '../src/domain/index.js';
import { METADATA_KEY, PerChatRepository } from '../src/persistence/per-chat-repository.js';
import { FOG_HARBOR_SCENARIO } from '../src/scenarios/index.js';
import { FakeOfficialAdapter } from './support/fake-official-adapter.mjs';

const PLAYER = Object.freeze({
    name: '岑雨',
    concept: '熟悉旧港设备的临时检修员',
    relationship: '与当前角色曾一起处理过一次险情',
    attributes: { body: 0, insight: 2, rapport: 1 },
});

const OPENING = '暴雨压住海关门外的灯，小牧抱紧邮袋。远处潮门警灯转红：零点前必须查清故障，决定下一步由你。';
const PERFORMANCE = '雨水沿铁门往下淌。你的行动立刻改变了眼前局势，小牧跟上脚步；新的地点与目标已经清楚，接下来仍由你决定。';

function deterministicDeps({ random = [0.5] } = {}) {
    let sequence = 0;
    let randomIndex = 0;
    return {
        id: () => `tx_${++sequence}`,
        now: () => '2026-08-12T12:00:00.000Z',
        random: () => random[Math.min(randomIndex++, random.length - 1)],
    };
}

function makeHarness({ messages = [], kind = 'single', deps = deterministicDeps() } = {}) {
    const adapter = new FakeOfficialAdapter();
    if (kind === 'single') {
        adapter.selectSingle('guide.png', 'chat-a');
        adapter.seedMessages(messages);
    } else if (kind === 'group') {
        adapter.selectGroup();
    }
    const repository = new PerChatRepository({ adapter, validateState: validateDirectorState, validateScenario });
    const app = new DirectorApplication({ adapter, repository, deps }).start();
    return { adapter, repository, app, deps };
}

async function createAndOpen(harness) {
    await harness.app.createCampaign({ scenarioId: FOG_HARBOR_SCENARIO.id, player: PLAYER });
    assert.equal(harness.repository.load().phase, 'ready');
    await harness.app.enterWorld();
    assert.equal(harness.repository.load().phase, 'generating');
    assert.equal(harness.adapter.generationRequests.length, 1);
    assert.match(harness.adapter.prompts.directive, /雨中的海关门/u);
    assert.match(harness.adapter.prompts.scanSeed, /雾港海关门/u);
    await harness.adapter.completeGeneration(OPENING);
    assert.equal(harness.repository.load().phase, 'playing');
    return harness;
}

async function takeAction(harness, { text, actionId, attribute = null, reply = PERFORMANCE }) {
    harness.adapter.appendUser(text);
    harness.adapter.enqueueDecision(actionId, attribute);
    const generated = await harness.adapter.completeGeneration(reply);
    assert.equal(generated.aborted, false, `generation was aborted in phase ${harness.repository.load()?.phase}; runtime=${JSON.stringify(harness.repository.loadRuntime())}`);
    return harness.repository.load();
}

test('blank single chat creates a campaign, enters the world, and commits the opening atomically with the visible reply', async () => {
    const harness = makeHarness();
    await createAndOpen(harness);

    const state = harness.repository.load();
    const runtime = harness.repository.loadRuntime();
    assert.equal(state.revision, 1);
    assert.equal(state.history.length, 1);
    assert.equal(state.history[0].kind, 'opening');
    assert.equal(state.history[0].performance, OPENING);
    assert.equal(runtime.operation, null);
    assert.equal(harness.adapter.stageCount, 1, 'MESSAGE_RECEIVED stages director metadata for the host final chat save');
    assert.equal(harness.adapter.prompts, null);
    await harness.app.destroy();
});

test('a successful streaming reply commits without re-locking the host after its awaited final event', async () => {
    const harness = makeHarness();
    await harness.app.createCampaign({ scenarioId: FOG_HARBOR_SCENARIO.id, player: PLAYER });
    await harness.app.enterWorld();
    const result = await harness.adapter.completeGeneration(OPENING, { streaming: true });
    assert.equal(result.aborted, false);
    assert.equal(harness.repository.load().phase, 'playing');
    assert.equal(harness.repository.loadRuntime().operation, null);
    assert.equal('lockGenerationUi' in harness.adapter, false, 'adapter exposes no one-way UI lock that can outlive MESSAGE_RECEIVED');
    await harness.app.destroy();
});

test('an existing chat is continued in place and old user history is never reclassified as a fresh action', async () => {
    const oldMessages = [
        { is_user: true, is_system: false, mes: '我们先前在旧港见过。', extra: {} },
        { is_user: false, is_system: false, mes: '我记得那场雨。', extra: {} },
        { is_user: true, is_system: false, mes: '这段话属于建团前历史。', extra: {} },
    ];
    const harness = makeHarness({ messages: oldMessages });
    await createAndOpen(harness);

    assert.equal(harness.repository.loadRuntime().lastHandledUserMessageId, 2);
    const intercepted = await harness.adapter.invokeInterceptor('normal');
    assert.equal(intercepted.aborted, false);
    assert.equal(harness.adapter.rawPrompts.length, 0, 'no historical message was sent to the hidden classifier');
    assert.deepEqual(harness.adapter.currentMessages().slice(0, 3), oldMessages, 'native chat history was not rewritten');
    await harness.app.destroy();
});

test('a normal free-text send is understood through raw generation, receives native performance prompts, and commits once', async () => {
    const harness = await createAndOpen(makeHarness());
    const state = await takeAction(harness, {
        text: '我先去泵房看被雷击坏的线路。',
        actionId: 'gate_to_pump',
    });

    assert.equal(harness.adapter.rawPrompts.length, 1);
    assert.match(harness.adapter.rawPrompts[0], /动作分类器/u);
    assert.doesNotMatch(harness.adapter.rawPrompts[0], /魏朔破坏了潮门自动系统/u, 'hidden fixed facts never enter action understanding');
    assert.equal(state.revision, 2);
    assert.equal(state.public.scene.id, 'old_pump');
    assert.equal(state.history.at(-1).moveId, 'gate_to_pump');
    assert.equal(harness.repository.loadRuntime().lastHandledUserMessageId, 1);
    assert.equal(harness.adapter.prompts, null);
    await harness.app.destroy();
});

test('world clocks and NPC agendas advance even when the player waits through scheduled events', async () => {
    const harness = await createAndOpen(makeHarness());
    await takeAction(harness, { text: '先去泵房。', actionId: 'gate_to_pump' });
    const state = await takeAction(harness, { text: '我留下抢救泵体，不管其他线索。', actionId: 'pump_wait_explosion' });

    assert.ok(state.hidden.clock.firedThresholdIds.includes('t_2200'));
    assert.ok(state.hidden.clock.firedThresholdIds.includes('t_2230'));
    assert.ok(state.hidden.clock.firedThresholdIds.includes('t_2310'), 'the fixed 23:10 explosion is a committed timeline fact');
    assert.ok(state.hidden.occurredFacts.includes('time_2310'));
    assert.ok(state.hidden.npcAgenda.some(item => item.factId === 'agenda_wei_burn'));
    assert.equal(state.hidden.currentSceneId, 'control_room');
    await harness.app.destroy();
});

test('a public d20 result is immutable and its success branch is performed and committed automatically', async () => {
    const harness = await createAndOpen(makeHarness({ deps: deterministicDeps({ random: [0.99] }) }));
    await takeAction(harness, { text: '去办公室核对调令。', actionId: 'gate_to_office' });
    let state = await takeAction(harness, { text: '我比对印章和签发簿。', actionId: 'office_search_check', attribute: 'insight' });
    assert.equal(state.phase, 'awaiting_check');
    assert.equal(state.public.pendingCheck.status, 'required');
    assert.equal(state.public.pendingCheck.roll, null);

    await harness.app.rollPendingCheck();
    state = harness.repository.load();
    assert.equal(state.phase, 'generating');
    assert.deepEqual(state.public.lastCheck.roll, { dice: [20], modifier: 2, total: 22, outcome: 'success' });
    assert.match(harness.adapter.prompts.directive, /d20 骰面 20/u);
    assert.equal(harness.app.getViewModel().error, null);

    await harness.adapter.completeGeneration('骰子停在 20，算上洞察修正总点 22，成功。你在封箱前留下完整证据，通向旧泵房的路已经打开。');
    state = harness.repository.load();
    assert.equal(state.phase, 'playing');
    assert.equal(state.hidden.currentSceneId, 'old_pump');
    assert.equal(state.public.lastCheck.roll.total, 22);
    assert.ok(state.hidden.occurredFacts.includes('archives_secured'));
    await harness.app.destroy();
});

test('invalid hidden action decision becomes recoverable without advancing state or emitting a performance reply', async () => {
    const harness = await createAndOpen(makeHarness());
    const before = harness.repository.load();
    harness.adapter.appendUser('我去查调令。');
    harness.adapter.enqueueRaw('{"transactionId":"wrong","baseRevision":1,"actionId":"gate_to_office","attribute":null,"summary":"查调令"}');
    const result = await harness.adapter.completeGeneration('不应出现的回复');

    assert.equal(result.aborted, true);
    const after = harness.repository.load();
    assert.equal(after.revision, before.revision);
    assert.equal(after.phase, 'playing');
    assert.equal(harness.repository.loadRuntime().operation.stage, 'recoverable');
    assert.equal(harness.adapter.currentMessages().at(-1).is_user, true);
    assert.equal(harness.app.getViewModel().phase, 'recoverable_error');
    await harness.app.destroy();
});

test('invalid visible performance and an explicit stop both preserve the same pending transaction for recovery', async () => {
    const invalid = await createAndOpen(makeHarness());
    invalid.adapter.appendUser('我去泵房。');
    invalid.adapter.enqueueDecision('gate_to_pump');
    await invalid.adapter.completeGeneration('导演状态：魏朔的幕后秘密是他剪断线路。');
    const invalidPending = invalid.repository.load().pendingTransaction;
    assert.equal(invalid.repository.loadRuntime().operation.stage, 'recoverable');
    assert.equal(invalid.repository.load().revision, 1);
    assert.equal(invalid.repository.load().pendingTransaction.id, invalidPending.id);
    await invalid.app.destroy();

    const stopped = await createAndOpen(makeHarness());
    stopped.adapter.appendUser('我去泵房。');
    stopped.adapter.enqueueDecision('gate_to_pump');
    const intercepted = await stopped.adapter.invokeInterceptor();
    assert.equal(intercepted.aborted, false);
    const pendingId = stopped.repository.load().pendingTransaction.id;
    await stopped.adapter.stopGeneration();
    assert.equal(stopped.repository.load().pendingTransaction.id, pendingId);
    assert.equal(stopped.repository.loadRuntime().operation.stage, 'recoverable');
    assert.equal(stopped.repository.load().revision, 1);
    await stopped.app.destroy();
});

test('a refreshed application recognizes an orphaned performing transaction and retries the exact pending turn', async () => {
    const harness = await createAndOpen(makeHarness());
    harness.adapter.appendUser('我去泵房。');
    harness.adapter.enqueueDecision('gate_to_pump');
    await harness.adapter.invokeInterceptor();
    const pendingId = harness.repository.load().pendingTransaction.id;
    const requestsBefore = harness.adapter.generationRequests.length;
    await harness.app.destroy();

    const repository = new PerChatRepository({ adapter: harness.adapter, validateState: validateDirectorState, validateScenario });
    const refreshed = new DirectorApplication({ adapter: harness.adapter, repository, deps: harness.deps }).start();
    assert.equal(refreshed.getViewModel().phase, 'recoverable_error');
    await refreshed.retryPending();
    assert.equal(repository.load().pendingTransaction.id, pendingId);
    assert.equal(repository.loadRuntime().operation.stage, 'performing');
    assert.equal(harness.adapter.generationRequests.length, requestsBefore + 1);
    await harness.adapter.completeGeneration(PERFORMANCE);
    assert.equal(repository.load().history.at(-1).transactionId, pendingId);
    await refreshed.destroy();
});

test('character plus chat identity isolates state and switching chats clears all injected prompts', async () => {
    const harness = await createAndOpen(makeHarness());
    const stateA = harness.repository.load();
    await harness.adapter.switchSingle('guide.png', 'chat-b');
    assert.equal(harness.repository.load(), null);
    assert.equal(harness.adapter.prompts, null);
    await harness.app.createCampaign({ scenarioId: FOG_HARBOR_SCENARIO.id, player: { ...PLAYER, name: '另一名玩家' } });
    assert.equal(harness.repository.load().player.name, '另一名玩家');

    await harness.adapter.switchSingle('other.png', 'chat-a');
    assert.equal(harness.repository.load(), null, 'same chat id under another character does not share state');
    await harness.adapter.switchSingle('guide.png', 'chat-a');
    assert.deepEqual(harness.repository.load(), stateA);
    await harness.app.destroy();
});

test('a native branch metadata clone becomes a separately advancing timeline at its new chat identity', async () => {
    const harness = await createAndOpen(makeHarness());
    await takeAction(harness, { text: '我先去泵房检查线路。', actionId: 'gate_to_pump' });
    await takeAction(harness, { text: '带着线头去巡防线找唐岑。', actionId: 'pump_to_patrol' });

    const sourceIdentity = harness.repository.currentIdentity();
    const sourceState = structuredClone(harness.repository.load());
    const sourceScenario = structuredClone(harness.repository.loadScenario());
    const sourceRuntime = structuredClone(harness.repository.loadRuntime());
    const sourceMessages = structuredClone(harness.adapter.currentMessages());
    const sourceEnvelope = structuredClone(harness.adapter.currentChatMetadata()[METADATA_KEY]);

    // Native branches may display a snapshot selected earlier in the chat,
    // while their metadata is copied from the source's current state. B is a
    // current-state timeline clone, so its cursor must be based on this
    // shorter local snapshot, not A's later message ids.
    const branchIdentity = harness.adapter.createNativeBranch('chat-b', { messageCount: 2 });
    await harness.adapter.switchSingle('guide.png', 'chat-b');

    assert.equal(harness.app.getViewModel().phase, 'playing', 'opening a native branch keeps the inherited journey playable');
    assert.deepEqual(harness.repository.currentIdentity(), branchIdentity, 'the active repository identity is the new chat, not its source');
    assert.equal(harness.adapter.currentChatMetadata().main_chat, sourceIdentity.chatId);
    assert.deepEqual(harness.adapter.currentChatMetadata()[METADATA_KEY].identity, {
        characterId: 'guide.png',
        chatId: 'chat-b',
    }, 'the inherited envelope is rebound to the branch before it can continue');
    assert.deepEqual(harness.repository.load(), sourceState);
    assert.deepEqual(harness.repository.loadScenario(), sourceScenario);
    assert.equal(harness.repository.loadRuntime().lastHandledUserMessageId, 1, 'the new timeline uses the last player message in its own snapshot');
    assert.equal(harness.repository.loadRuntime().operation, null);
    assert.deepEqual(harness.adapter.currentMessages(), sourceMessages.slice(0, 2), 'the branch starts from the native message snapshot');

    const branchState = await takeAction(harness, {
        text: '我拿出线头，请唐岑立刻核验并疏散。',
        actionId: 'patrol_persuade_check',
        attribute: 'rapport',
    });
    assert.equal(branchState.revision, sourceState.revision + 1);
    assert.equal(branchState.public.scene.id, 'patrol_line');
    assert.equal(branchState.phase, 'awaiting_check');

    await harness.adapter.switchSingle('guide.png', 'chat-a');
    assert.deepEqual(harness.repository.currentIdentity(), sourceIdentity);
    assert.deepEqual(harness.repository.load(), sourceState, 'a branch action never changes the source timeline');
    assert.deepEqual(harness.repository.loadScenario(), sourceScenario);
    assert.deepEqual(harness.repository.loadRuntime(), sourceRuntime);
    assert.deepEqual(harness.adapter.currentMessages(), sourceMessages);
    assert.deepEqual(harness.adapter.currentChatMetadata()[METADATA_KEY], sourceEnvelope);

    await harness.adapter.switchSingle('guide.png', 'chat-b');
    assert.deepEqual(harness.repository.load(), branchState, 'returning to the branch restores only its later state');
    await harness.app.destroy();
});

test('switching chats during hidden action understanding aborts the host generation before any new-chat write', async () => {
    const harness = await createAndOpen(makeHarness());
    harness.adapter.appendUser('我去核对封港调令。');
    harness.adapter.enqueueRaw(async prompt => {
        const transactionId = /"transactionId"\s*:\s*"([^"]+)"/u.exec(prompt)?.[1];
        const baseRevision = Number(/"baseRevision"\s*:\s*(\d+)/u.exec(prompt)?.[1]);
        await harness.adapter.switchSingle('guide.png', 'chat-b');
        return JSON.stringify({ transactionId, baseRevision, actionId: 'gate_to_office', attribute: null, summary: '玩家前往办公室核对调令。' });
    });
    const intercepted = await harness.adapter.invokeInterceptor('normal');
    assert.equal(intercepted.aborted, true, 'identity loss must synchronously abort the original normal generation');
    assert.equal(harness.adapter.currentMessages().length, 0, 'the newly selected chat receives no director reply');
    assert.equal(harness.repository.load(), null, 'the newly selected chat receives no director metadata');
    assert.ok(harness.adapter.stopOwnedCount >= 1);

    await harness.adapter.switchSingle('guide.png', 'chat-a');
    assert.equal(harness.repository.load().phase, 'playing');
    assert.equal(harness.repository.loadRuntime().operation.stage, 'understanding');
    assert.equal(harness.app.getViewModel().phase, 'recoverable_error');
    await harness.app.cancelPending();
    assert.equal(harness.repository.loadRuntime().operation, null);
    await harness.app.destroy();
});

test('switching chats after a prepared performance stops the owned request and preserves the old recovery point', async () => {
    const harness = await createAndOpen(makeHarness());
    harness.adapter.appendUser('我去泵房。');
    harness.adapter.enqueueDecision('gate_to_pump');
    assert.equal((await harness.adapter.invokeInterceptor('normal')).aborted, false);
    const pendingId = harness.repository.load().pendingTransaction.id;

    await harness.adapter.switchSingle('guide.png', 'chat-b');
    const late = await harness.adapter.deliverOwnedResponse(PERFORMANCE);
    assert.equal(late.cancelled, true);
    assert.equal(harness.adapter.currentMessages().length, 0);
    assert.equal(harness.repository.load(), null);

    await harness.adapter.switchSingle('guide.png', 'chat-a');
    assert.equal(harness.repository.load().pendingTransaction.id, pendingId);
    assert.equal(harness.app.getViewModel().phase, 'recoverable_error');
    await harness.app.destroy();
});

test('a pre-CHAT_CHANGED stream token with a mismatched identity requests immediate owned cancellation', async () => {
    const harness = await createAndOpen(makeHarness());
    harness.adapter.appendUser('我去泵房。');
    harness.adapter.enqueueDecision('gate_to_pump');
    assert.equal((await harness.adapter.invokeInterceptor('normal')).aborted, false);

    harness.adapter.selectSingle('guide.png', 'chat-b');
    await harness.adapter.emit('streamToken', '旧聊天的第一个迟到 token');
    assert.equal(harness.adapter.ownedGenerationCancelled, true);
    assert.equal((await harness.adapter.deliverOwnedResponse(PERFORMANCE)).cancelled, true);
    assert.equal(harness.adapter.currentMessages().length, 0);
    await harness.adapter.emit('chatChanged');
    await harness.app.destroy();
});

test('disable and destroy remove prompts, interceptor, and every event side effect', async () => {
    const harness = await createAndOpen(makeHarness());
    await harness.app.setEnabled(false);
    assert.equal(harness.adapter.prompts, null);
    assert.equal(harness.adapter.interceptor, null, 'disabled application must not retain a generation interceptor');
    assert.equal(harness.adapter.listenerCount(), 0, 'disabled application must not retain host event listeners');
    await harness.app.destroy();
    assert.equal(harness.adapter.interceptor, null);
    assert.equal(harness.adapter.listenerCount(), 0);
});

test('disable and destroy stop an owned in-flight performance before detaching hooks', async () => {
    const disabled = makeHarness();
    await disabled.app.createCampaign({ scenarioId: FOG_HARBOR_SCENARIO.id, player: PLAYER });
    await disabled.app.enterWorld();
    await new Promise(resolve => setImmediate(resolve));
    await disabled.app.setEnabled(false);
    assert.ok(disabled.adapter.stopOwnedCount >= 1);
    assert.equal(disabled.adapter.interceptor, null);
    assert.equal(disabled.adapter.listenerCount(), 0);
    assert.equal((await disabled.adapter.deliverOwnedResponse(OPENING)).cancelled, true);
    await disabled.app.setEnabled(true);
    assert.equal(disabled.app.getViewModel().phase, 'recoverable_error');
    await disabled.app.destroy();

    const destroyed = makeHarness();
    await destroyed.app.createCampaign({ scenarioId: FOG_HARBOR_SCENARIO.id, player: PLAYER });
    await destroyed.app.enterWorld();
    await new Promise(resolve => setImmediate(resolve));
    await destroyed.app.destroy();
    assert.ok(destroyed.adapter.stopOwnedCount >= 1);
    assert.equal((await destroyed.adapter.deliverOwnedResponse(OPENING)).cancelled, true);
});

test('disabling during hidden understanding cancels raw work and never starts a visible performance', async () => {
    const harness = await createAndOpen(makeHarness());
    harness.adapter.appendUser('我去核对调令。');
    let releaseRaw;
    harness.adapter.enqueueRaw(() => new Promise(resolve => { releaseRaw = resolve; }));
    const interception = harness.adapter.invokeInterceptor('normal');
    while (!releaseRaw) await new Promise(resolve => setImmediate(resolve));

    await harness.app.setEnabled(false);
    releaseRaw('{"transactionId":"ignored","baseRevision":1,"actionId":"gate_to_office","attribute":null,"summary":"不会被采用"}');
    const result = await interception;
    assert.equal(result.aborted, true);
    assert.ok(harness.adapter.stopOwnedCount >= 1);
    assert.equal(harness.adapter.generationRequests.length, 1, 'only the already completed opening requested a visible generation');
    assert.equal(harness.repository.load().phase, 'playing');
    assert.equal(harness.repository.loadRuntime().operation.stage, 'recoverable');
    await harness.app.destroy();
});

test('disable during pending persistence cannot start raw understanding after the save returns', async () => {
    const harness = await createAndOpen(makeHarness());
    harness.adapter.appendUser('我去核对调令。');
    harness.adapter.enqueueDecision('gate_to_office');
    let releaseSave;
    harness.adapter.beforeNextSave = () => new Promise(resolve => { releaseSave = resolve; });
    const interception = harness.adapter.invokeInterceptor('normal');
    while (!releaseSave) await new Promise(resolve => setImmediate(resolve));

    await harness.app.setEnabled(false);
    releaseSave();
    const result = await interception;
    assert.equal(result.aborted, true);
    assert.equal(harness.adapter.rawPrompts.length, 0);
    assert.equal(harness.repository.load().phase, 'playing');
    assert.equal(harness.repository.loadRuntime().operation.stage, 'recoverable');
    await harness.app.destroy();
});

test('disable or destroy during prepared-turn persistence never injects prompts or requests a reply afterward', async () => {
    for (const lifecycle of ['disable', 'destroy']) {
        const harness = makeHarness();
        await harness.app.createCampaign({ scenarioId: FOG_HARBOR_SCENARIO.id, player: PLAYER });
        let releaseSave;
        harness.adapter.beforeNextSave = () => new Promise(resolve => { releaseSave = resolve; });
        const entering = harness.app.enterWorld();
        while (!releaseSave) await new Promise(resolve => setImmediate(resolve));

        if (lifecycle === 'disable') await harness.app.setEnabled(false);
        else await harness.app.destroy();
        releaseSave();
        await assert.rejects(entering, /禁用或卸载/u);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(harness.adapter.prompts, null, `${lifecycle} must not inject after pending save`);
        assert.equal(harness.adapter.generationRequests.length, 0, `${lifecycle} must not request a reply after pending save`);
        assert.equal(harness.repository.load().phase, 'generating');
        assert.equal(harness.repository.load().pendingTransaction.kind, 'opening');
        if (lifecycle === 'disable') await harness.app.destroy();
    }
});

test('Candy W commands reject group chat while the global interceptor leaves native group generation alone', async () => {
    const harness = makeHarness({ kind: 'group' });
    await assert.rejects(
        harness.app.createCampaign({ scenarioId: FOG_HARBOR_SCENARIO.id, player: PLAYER }),
        /只支持当前单个角色聊天/u,
    );
    const intercepted = await harness.adapter.invokeInterceptor('normal');
    assert.equal(intercepted.aborted, false);
    assert.equal(harness.adapter.saveCount, 0);
    assert.equal(harness.adapter.rawPrompts.length, 0);
    assert.equal(harness.adapter.generationRequests.length, 0);
    await harness.app.destroy();
});

test('an unrelated global stop never invents a recoverable Candy W transaction', async () => {
    const harness = await createAndOpen(makeHarness());
    assert.equal(harness.repository.loadRuntime().operation, null);
    await harness.adapter.emit('generationStopped');
    assert.equal(harness.repository.load().phase, 'playing');
    assert.equal(harness.repository.loadRuntime().operation, null);
    assert.equal(harness.app.getViewModel().phase, 'playing');
    await harness.app.destroy();
});

test('stopping the owned raw understanding request is recovered by its rejection, not by a global stop guess', async () => {
    const harness = await createAndOpen(makeHarness());
    harness.adapter.appendUser('我去核对调令。');
    harness.adapter.enqueueRaw(async () => {
        await harness.adapter.emit('generationStopped');
        throw new Error('raw request cancelled');
    });
    const result = await harness.adapter.completeGeneration('不应出现的主演出');
    assert.equal(result.aborted, true);
    assert.equal(harness.repository.load().phase, 'playing');
    assert.equal(harness.repository.loadRuntime().operation.stage, 'recoverable');
    assert.match(harness.repository.loadRuntime().operation.error, /raw request cancelled/u);
    await harness.app.destroy();
});

test('tool-calling-enabled main generation fails closed before action understanding or performance', async () => {
    const harness = await createAndOpen(makeHarness());
    harness.adapter.appendUser('我去泵房检查线路。');
    harness.adapter.toolCallsEnabled = true;
    const intercepted = await harness.adapter.invokeInterceptor('normal');
    assert.equal(intercepted.aborted, true);
    assert.equal(harness.adapter.rawPrompts.length, 0);
    assert.equal(harness.repository.load().phase, 'playing');
    assert.equal(harness.repository.loadRuntime().operation.stage, 'recoverable');
    assert.match(harness.repository.loadRuntime().operation.error, /工具调用/u);
    assert.equal(harness.app.getViewModel().phase, 'recoverable_error');
    await harness.app.destroy();
});

test('tool-calling-enabled automatic opening keeps its prepared transaction recoverable without starting a reply', async () => {
    const harness = makeHarness();
    harness.adapter.toolCallsEnabled = true;
    await harness.app.createCampaign({ scenarioId: FOG_HARBOR_SCENARIO.id, player: PLAYER });
    await harness.app.enterWorld();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(harness.adapter.generationRequests.length, 0);
    assert.equal(harness.repository.load().phase, 'generating');
    assert.equal(harness.repository.load().pendingTransaction.kind, 'opening');
    assert.equal(harness.repository.loadRuntime().operation.stage, 'recoverable');
    assert.match(harness.repository.loadRuntime().operation.error, /tool calls|工具调用/u);
    await harness.app.destroy();
});

test('a second user send is refused while one transaction is performing, and tool messages cannot commit it', async () => {
    const harness = await createAndOpen(makeHarness());
    harness.adapter.appendUser('我先去泵房。');
    harness.adapter.enqueueDecision('gate_to_pump');
    assert.equal((await harness.adapter.invokeInterceptor()).aborted, false);
    const pendingId = harness.repository.load().pendingTransaction.id;

    const toolId = harness.adapter.appendAssistant('正在调用工具', { tool_calls: [{ id: 'tool-1' }] });
    await harness.adapter.emit('messageReceived', toolId, 'tool');
    assert.equal(harness.repository.load().pendingTransaction.id, pendingId);
    assert.equal(harness.repository.load().revision, 1);

    harness.adapter.appendUser('这是一条并发的新行动。');
    const concurrent = await harness.adapter.invokeInterceptor();
    assert.equal(concurrent.aborted, true, 'new input cannot be mistaken for the reply belonging to the prior transaction');
    assert.equal(harness.repository.load().pendingTransaction.id, pendingId);
    assert.equal(harness.repository.load().revision, 1);
    await harness.app.destroy();
});

test('a custom creative brief becomes a saved strict scenario without touching chat history', async () => {
    const harness = makeHarness();
    const draft = structuredClone(FOG_HARBOR_SCENARIO);
    delete draft.hash;
    draft.id = 'moon-train-missing';
    draft.contentVersion = '1.0.0';
    draft.public.title = '月背列车失踪案';
    draft.public.tagline = '返程记录消失在月亮背面。';
    draft.public.summary = '一列月背列车停在无名站，失踪者留下了返航线索。';
    draft.public.tone = '温柔惊悚';
    draft.public.duration = '约 2 小时';
    draft.public.symbol = '◐';
    draft.public.tags = ['月背', '列车'];
    harness.adapter.enqueueRaw(JSON.stringify(draft));

    const scenario = await harness.app.writeCustomScenario({
        title: '月背列车失踪案',
        premise: '一列月背列车在无名站停下，玩家需要找到失踪者。',
        tone: '温柔惊悚',
        setting: '月背列车与无名站。',
        opening: '列车在没有站名的站台停靠。',
        coreTruth: '返航协议被人为篡改，风暴不会等待。',
        npcGoals: '乘务长想带所有乘客返航，工程师留下了线索。',
        timePressure: '氧气和风暴会持续推进。',
        endings: '修复返航、带部分人离开或留在月背。',
    });

    assert.equal(scenario.id, 'moon-train-missing');
    assert.equal(harness.adapter.rawRequestOptions[0].responseLength, 8_000);
    assert.match(harness.adapter.rawPrompts[0], /Candy W 跑团的剧本作者/u);
    assert.equal(harness.adapter.currentMessages().length, 0, 'writing a scenario must not alter the current chat');
    assert.equal(harness.adapter.getSettings().importedScenarios[0].id, 'moon-train-missing');
    assert.ok(harness.app.listScenarios().some(item => item.id === 'moon-train-missing'));
    await harness.app.destroy();
});

test('an invalid custom writing result is rejected without adding a scenario', async () => {
    const harness = makeHarness();
    harness.adapter.enqueueRaw('这不是严格 JSON。');
    await assert.rejects(
        harness.app.writeCustomScenario({
            title: '月背列车失踪案', premise: '失踪案从终点站开始。', tone: '', setting: '月背列车。', opening: '列车停下。',
            coreTruth: '返航协议被篡改。', npcGoals: '乘务长要返航。', timePressure: '风暴逼近。', endings: '返航或留下。',
        }),
        /单一、严格的 JSON/u,
    );
    assert.deepEqual(harness.adapter.getSettings().importedScenarios, []);
    await harness.app.destroy();
});

test('an activated native World Info result plus the requested outcome becomes a saved scenario', async () => {
    const harness = makeHarness();
    harness.adapter.nativeWorldInfo = '雾港海关门坐落在旧港与仓区之间。潮门决定洪水的去向。';
    const draft = structuredClone(FOG_HARBOR_SCENARIO);
    delete draft.hash;
    draft.id = 'fog-harbor-last-gate';
    draft.contentVersion = '1.0.0';
    draft.public.title = '雾港最后一道潮门';
    harness.adapter.enqueueRaw(JSON.stringify(draft));

    const scenario = await harness.app.writeScenarioFromWorldInfo({
        title: '雾港最后一道潮门',
        outcome: '让玩家在零点前发现潮门真相，并决定洪水最终流向。',
        anchors: '雾港, 潮门, 旧港',
    });

    assert.equal(scenario.id, 'fog-harbor-last-gate');
    assert.equal(harness.adapter.nativeWorldInfoRequests.length, 1);
    assert.match(harness.adapter.nativeWorldInfoRequests[0].scanSeed, /潮门/u);
    assert.match(harness.adapter.rawPrompts[0], /雾港海关门/u);
    assert.match(harness.adapter.rawPrompts[0], /洪水最终流向/u);
    assert.equal(harness.adapter.currentMessages().length, 0);
    assert.equal(harness.adapter.getSettings().importedScenarios[0].id, 'fog-harbor-last-gate');
    await harness.app.destroy();
});

test('empty native World Info results fail before any script-writing generation begins', async () => {
    const harness = makeHarness();
    harness.adapter.nativeWorldInfo = '';
    await assert.rejects(
        harness.app.writeScenarioFromWorldInfo({ title: '', outcome: '让城市在黎明前做出选择。', anchors: '港口' }),
        /世界书/u,
    );
    assert.equal(harness.adapter.rawPrompts.length, 0);
    assert.deepEqual(harness.adapter.getSettings().importedScenarios, []);
    await harness.app.destroy();
});
