import test from 'node:test';
import assert from 'node:assert/strict';
import {
    METADATA_KEY,
    PerChatRepository,
    createRuntimeState,
} from '../src/persistence/per-chat-repository.js';

const identityKey = identity => identity ? `${identity.characterId}\u0000${identity.chatId}` : '';

class FakeAdapter {
    constructor() {
        this.identity = null;
        this.metadataByChat = new Map();
        this.persistedByChat = new Map();
        this.failSave = false;
        this.switchDuringSave = null;
    }

    select(characterId, chatId) {
        this.identity = { characterId, chatId, characterIndex: '0' };
        const key = identityKey(this.identity);
        if (!this.metadataByChat.has(key)) this.metadataByChat.set(key, {});
    }

    currentChatIdentity() { return this.identity ? { ...this.identity } : null; }
    currentChatMetadata() { return this.identity ? this.metadataByChat.get(identityKey(this.identity)) : null; }
    stageCurrentMetadata() { return true; }

    async saveCurrentChat(expectedIdentity) {
        if (this.failSave) throw new Error('disk unavailable');
        this.persistedByChat.set(identityKey(expectedIdentity), structuredClone(this.metadataByChat.get(identityKey(expectedIdentity))));
        if (this.switchDuringSave) {
            const next = this.switchDuringSave;
            this.switchDuringSave = null;
            this.select(next.characterId, next.chatId);
        }
        return true;
    }
}

const makeState = revision => ({ valid: true, revision });
const makeScenario = id => ({ valid: true, id });

test('repository pins a scenario snapshot and isolates character plus chat identity', async () => {
    const adapter = new FakeAdapter();
    const repository = new PerChatRepository({
        adapter,
        validateState: value => value?.valid === true && Number.isSafeInteger(value.revision),
        validateScenario: value => value?.valid === true && typeof value.id === 'string',
    });
    adapter.select('character-a.png', 'same-chat-name');
    const identity = repository.currentIdentity();
    const runtime = createRuntimeState();
    await repository.save(makeState(0), { expectedIdentity: identity, scenario: makeScenario('fog-harbor'), runtime });

    assert.deepEqual(repository.load(), makeState(0));
    assert.deepEqual(repository.loadScenario(), makeScenario('fog-harbor'));
    assert.deepEqual(repository.loadRuntime(), runtime);
    assert.deepEqual(adapter.persistedByChat.get(identityKey(identity))[METADATA_KEY].identity, {
        characterId: 'character-a.png',
        chatId: 'same-chat-name',
    });

    adapter.select('character-b.png', 'same-chat-name');
    assert.equal(repository.load(), null, 'same chat file name under another character has no shared state');
    adapter.select('character-a.png', 'other-chat');
    assert.equal(repository.load(), null, 'another chat under the same character has no shared state');
});

test('repository adopts a native main_chat clone as an independently persisted branch timeline', async () => {
    const adapter = new FakeAdapter();
    const repository = new PerChatRepository({
        adapter,
        validateState: value => value?.valid === true && Number.isSafeInteger(value.revision),
        validateScenario: value => value?.valid === true && typeof value.id === 'string',
    });
    adapter.select('character-a.png', 'chat-a');
    const sourceIdentity = repository.currentIdentity();
    const sourceState = makeState(3);
    const sourceScenario = makeScenario('fog-harbor');
    const sourceRuntime = createRuntimeState(7);
    await repository.save(sourceState, {
        expectedIdentity: sourceIdentity,
        scenario: sourceScenario,
        runtime: sourceRuntime,
    });
    const sourceEnvelope = structuredClone(adapter.currentChatMetadata()[METADATA_KEY]);

    adapter.select('character-a.png', 'chat-b');
    const branchIdentity = repository.currentIdentity();
    adapter.currentChatMetadata()[METADATA_KEY] = structuredClone(sourceEnvelope);
    adapter.currentChatMetadata().main_chat = sourceIdentity.chatId;

    await repository.adoptNativeBranchClone();
    assert.deepEqual(repository.load(), sourceState);
    assert.deepEqual(repository.loadScenario(), sourceScenario);
    assert.deepEqual(repository.loadRuntime(), createRuntimeState(), 'a branch gets its own local message cursor and no inherited operation');
    assert.equal(adapter.currentChatMetadata().main_chat, sourceIdentity.chatId);
    assert.deepEqual(adapter.currentChatMetadata()[METADATA_KEY].identity, {
        characterId: branchIdentity.characterId,
        chatId: branchIdentity.chatId,
    });
    assert.deepEqual(adapter.persistedByChat.get(identityKey(branchIdentity))[METADATA_KEY].identity, {
        characterId: branchIdentity.characterId,
        chatId: branchIdentity.chatId,
    }, 'the rebinding survives a refresh of the branch chat');

    adapter.select(sourceIdentity.characterId, sourceIdentity.chatId);
    assert.deepEqual(adapter.currentChatMetadata()[METADATA_KEY], sourceEnvelope, 'adoption never mutates the source envelope');
    assert.deepEqual(repository.load(), sourceState);
});

test('repository never adopts a native clone that captured an unfinished source operation', async () => {
    const adapter = new FakeAdapter();
    const repository = new PerChatRepository({
        adapter,
        validateState: value => value?.valid === true && Number.isSafeInteger(value.revision),
        validateScenario: value => value?.valid === true && typeof value.id === 'string',
    });
    adapter.select('character-a.png', 'chat-a');
    const sourceIdentity = repository.currentIdentity();
    const busyRuntime = {
        ...createRuntimeState(4),
        operation: {
            id: 'tx_opening_1',
            kind: 'opening',
            stage: 'performing',
            baseRevision: 3,
            sourceMessageId: -1,
            sourceText: '',
            expectedAssistantMessageId: 5,
            error: null,
        },
    };
    await repository.save(makeState(3), {
        expectedIdentity: sourceIdentity,
        scenario: makeScenario('fog-harbor'),
        runtime: busyRuntime,
    });
    const sourceEnvelope = structuredClone(adapter.currentChatMetadata()[METADATA_KEY]);

    adapter.select('character-a.png', 'chat-b');
    adapter.currentChatMetadata()[METADATA_KEY] = structuredClone(sourceEnvelope);
    adapter.currentChatMetadata().main_chat = sourceIdentity.chatId;

    await assert.rejects(repository.adoptNativeBranchClone(), /尚未完成的导演事务/u);
    assert.deepEqual(adapter.currentChatMetadata()[METADATA_KEY], sourceEnvelope, 'the target remains unbound rather than inheriting an in-flight request');
    assert.equal(adapter.persistedByChat.has(identityKey(repository.currentIdentity())), false);
});

test('repository still rejects an unmarked identity-mismatched metadata clone', async () => {
    const adapter = new FakeAdapter();
    const repository = new PerChatRepository({
        adapter,
        validateState: value => value?.valid === true && Number.isSafeInteger(value.revision),
        validateScenario: value => value?.valid === true && typeof value.id === 'string',
    });
    adapter.select('character-a.png', 'chat-a');
    const sourceIdentity = repository.currentIdentity();
    await repository.save(makeState(3), {
        expectedIdentity: sourceIdentity,
        scenario: makeScenario('fog-harbor'),
        runtime: createRuntimeState(7),
    });
    const unmarkedClone = structuredClone(adapter.currentChatMetadata()[METADATA_KEY]);

    adapter.select('character-a.png', 'chat-b');
    const branchIdentity = repository.currentIdentity();
    adapter.currentChatMetadata()[METADATA_KEY] = unmarkedClone;

    assert.throws(() => repository.load(), /身份不匹配/u);
    assert.deepEqual(adapter.currentChatMetadata()[METADATA_KEY], unmarkedClone, 'rejection does not silently bind arbitrary copied metadata');
    assert.equal(adapter.persistedByChat.has(identityKey(branchIdentity)), false);
});

test('repository enforces revision CAS and rolls staged metadata back on save failure', async () => {
    const adapter = new FakeAdapter();
    const repository = new PerChatRepository({
        adapter,
        validateState: value => value?.valid === true && Number.isSafeInteger(value.revision),
        validateScenario: value => value?.valid === true,
    });
    adapter.select('character-a.png', 'chat-a');
    const identity = repository.currentIdentity();
    await repository.save(makeState(3), { expectedIdentity: identity, scenario: makeScenario('scenario') });
    await assert.rejects(repository.save(makeState(4), { expectedIdentity: identity, expectedRevision: 2 }), /版本冲突/);

    adapter.failSave = true;
    await assert.rejects(repository.save(makeState(4), { expectedIdentity: identity, expectedRevision: 3 }), /disk unavailable/);
    assert.deepEqual(repository.load(), makeState(3), 'failed persistence restores the prior in-memory envelope');
});

test('repository refuses to finish a save in whichever chat becomes current next', async () => {
    const adapter = new FakeAdapter();
    const repository = new PerChatRepository({
        adapter,
        validateState: value => value?.valid === true,
        validateScenario: value => value?.valid === true,
    });
    adapter.select('character-a.png', 'chat-a');
    const identity = repository.currentIdentity();
    await repository.save(makeState(0), { expectedIdentity: identity, scenario: makeScenario('scenario') });
    adapter.switchDuringSave = { characterId: 'character-b.png', chatId: 'chat-b' };
    await assert.rejects(repository.save(makeState(1), { expectedIdentity: identity }), /聊天已切换/);
    assert.equal(adapter.currentChatMetadata()[METADATA_KEY], undefined, 'the newly selected chat is never mutated');
});

test('runtime schema rejects unknown fields and invalid operation stages', async () => {
    const adapter = new FakeAdapter();
    const repository = new PerChatRepository({
        adapter,
        validateState: value => value?.valid === true,
        validateScenario: value => value?.valid === true,
    });
    adapter.select('character-a.png', 'chat-a');
    const badRuntime = { ...createRuntimeState(), extra: true };
    await assert.rejects(repository.save(makeState(0), { scenario: makeScenario('scenario'), runtime: badRuntime }), /生成事务/);
});
