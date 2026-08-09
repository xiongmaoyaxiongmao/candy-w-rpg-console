import assert from 'node:assert/strict';
import { RpgApplication } from '../src/application.js';
import { PerChatRepository } from '../src/repository.js';
import { CONTEXT_SLOT, METADATA_KEY, PHASES } from '../src/domain.js';
import { exportCampaign } from '../src/schema.js';

const keyOf = identity => identity ? identity.characterId + ':' + identity.chatId : '';
class FakeAdapter {
    constructor() {
        this.identity = null; this.group = false; this.chats = new Map(); this.persisted = new Map();
        this.contexts = []; this.generationContexts = []; this.calls = 0; this.fail = null; this.pending = null;
        this.saveCalls = []; this.switchAfterSave = false; this.saveError = null; this.existingGeneration = false;
    }
    select(characterId, chatId) { this.group = false; this.identity = { characterId: String(characterId), chatId: String(chatId) }; this.chats.set(keyOf(this.identity), this.chats.get(keyOf(this.identity)) ?? {}); }
    selectGroup() { this.group = true; this.identity = null; }
    chatKind() { return this.group ? 'group' : this.identity ? 'single' : 'none'; }
    currentChatIdentity() { return this.chatKind() === 'single' ? { ...this.identity } : null; }
    currentChatMetadata() { return this.identity ? this.chats.get(keyOf(this.identity)) : null; }
    async saveCurrentChatMetadata(expectedIdentity) {
        this.saveCalls.push(structuredClone(expectedIdentity));
        if (this.saveError) throw this.saveError;
        this.persisted.set(keyOf(expectedIdentity), structuredClone(this.chats.get(keyOf(expectedIdentity))));
        if (this.switchAfterSave) { this.switchAfterSave = false; this.select('char-B', 'B'); }
        return keyOf(this.currentChatIdentity()) === keyOf(expectedIdentity);
    }
    setContext(value) { this.contexts.push({ identity: this.currentChatIdentity(), slot: CONTEXT_SLOT, value }); }
    async requestStandardGeneration(identity) {
        if (this.group) throw new Error('跑团控制台仅支持单个角色聊天');
        if (this.existingGeneration) throw new Error('酒馆已有生成正在进行');
        this.calls += 1; this.generationContexts.push(this.contexts.at(-1).value);
        if (this.fail) throw this.fail;
        if (this.pending) await this.pending;
        if (keyOf(this.currentChatIdentity()) !== keyOf(identity)) throw new Error('生成期间聊天已切换；本次团务结果未写入其他聊天。');
        return new String('正式回复');
    }
}

const adapter = new FakeAdapter();
const app = new RpgApplication({ repository: new PerChatRepository(adapter), adapter, random: () => 0.6 });
await app.sync();
assert.equal(adapter.contexts.at(-1).value, '', 'startup without a chat is safe');
adapter.select('char-A', 'same-name');
await app.onChatChanged();
assert.equal(app.currentState(), null, 'opening a chat without state is safe');
await app.createCampaign({ campaign: { name: '空白团', genre: 'modern_mystery' }, player: { name: '顾言' } });
assert.equal(adapter.currentChatMetadata()[METADATA_KEY].lifecycle.phase, PHASES.READY);
assert.equal(adapter.saveCalls.at(-1).characterId, 'char-A', 'persistence is bound to character plus chat identity');
await assert.rejects(app.createCampaign({ campaign: { name: '重复团' }, player: { name: '顾言' } }), /已有进行中的团/);

adapter.switchAfterSave = true;
await assert.rejects(app.updateCampaign({ name: '快速保存', objective: '' }), /聊天在保存时已切换/);
assert.equal(adapter.persisted.get('char-A:same-name')[METADATA_KEY].campaign.name, '快速保存', 'the immediate A save starts before a quick switch');
assert.equal(adapter.chats.get('char-B:B')[METADATA_KEY], undefined, 'quick save never writes the following chat');
adapter.select('char-A', 'same-name');
await app.onChatChanged();

adapter.saveError = new Error('save failed');
await assert.rejects(app.startOrContinue(), /save failed/);
assert.equal(adapter.currentChatMetadata()[METADATA_KEY].lifecycle.phase, PHASES.READY, 'a failed pending save rolls metadata back from generating');
adapter.saveError = null;
adapter.existingGeneration = true;
await assert.rejects(app.startOrContinue(), /已有生成/);
assert.equal(adapter.currentChatMetadata()[METADATA_KEY].lifecycle.phase, PHASES.READY, 'existing Tavern generation rejection restores ready');
adapter.existingGeneration = false;

await app.startOrContinue();
assert.equal(adapter.calls, 1);
assert.equal(adapter.currentChatMetadata()[METADATA_KEY].lifecycle.phase, PHASES.IN_PROGRESS);
assert.match(adapter.generationContexts.at(-1), /现在主持一段开场或续场/);
await app.rollCheck({ attribute: 'body', formula: 'd20', difficulty: '', label: '破门' });
assert.equal(adapter.currentChatMetadata()[METADATA_KEY].checks.at(-1).difficulty, null, 'empty difficulty stays unset');
await app.continueAfterCheck();
assert.equal(adapter.calls, 2);

adapter.fail = new Error('network down');
await assert.rejects(app.startOrContinue(), /network down/);
assert.equal(adapter.currentChatMetadata()[METADATA_KEY].lifecycle.phase, PHASES.IN_PROGRESS, 'failure restores a stable state');
adapter.fail = null;

let releaseGeneration;
adapter.pending = new Promise(resolve => { releaseGeneration = resolve; });
const start = app.startOrContinue();
await new Promise(resolve => setImmediate(resolve));
assert.equal(adapter.currentChatMetadata()[METADATA_KEY].lifecycle.phase, PHASES.GENERATING);
await assert.rejects(app.importCampaign(exportCampaign(adapter.currentChatMetadata()[METADATA_KEY])), /正在生成/);
adapter.select('char-B', 'B');
await app.onChatChanged();
assert.equal(app.currentState(), null, 'switching during generation does not expose A in B');
releaseGeneration();
await assert.rejects(start, /聊天已切换/);
assert.equal(adapter.chats.get('char-B:B')[METADATA_KEY], undefined, 'async result never writes A into B');
adapter.pending = null;
adapter.select('char-A', 'same-name');
await app.onChatChanged();
assert.equal(app.currentState().lifecycle.phase, PHASES.IN_PROGRESS, 'returning to A recovers its interrupted transaction');

adapter.select('char-other', 'same-name');
await app.onChatChanged();
assert.equal(app.currentState(), null, 'same chat file name under another character is a different identity');
await app.createCampaign({ campaign: { name: '另一角色团' }, player: { name: '伊芙' } });
assert.equal(adapter.chats.get('char-A:same-name')[METADATA_KEY].campaign.name, '空白团', 'other character state remains isolated');
const callsBeforeGroup = adapter.calls;
adapter.selectGroup();
await app.onChatChanged();
assert.equal(adapter.contexts.at(-1).value, '', 'group chats receive no context injection');
await assert.rejects(app.createCampaign({ campaign: { name: '群聊' }, player: { name: '玩家' } }), /仅支持单个角色聊天/);
assert.equal(adapter.calls, callsBeforeGroup, 'group chat never calls Generate');

adapter.select('char-A', 'same-name');
await app.onChatChanged();
const crashed = adapter.currentChatMetadata()[METADATA_KEY];
crashed.lifecycle = { phase: PHASES.GENERATING, pendingAction: 'continue', transaction: { id: 'crashed', previousPhase: PHASES.IN_PROGRESS, baseRevision: crashed.revision, startedAt: new Date().toISOString() } };
await app.onChatChanged();
assert.equal(app.currentState().lifecycle.phase, PHASES.IN_PROGRESS, 'refresh/crash recovery removes orphaned generating state');
await app.endCampaign();
assert.equal(adapter.currentChatMetadata()[METADATA_KEY].lifecycle.phase, PHASES.ENDED);
assert.equal(adapter.contexts.at(-1).value, '');
app.setEnabled(false);
assert.equal(adapter.contexts.at(-1).value, '');
console.log('application integration tests passed');
