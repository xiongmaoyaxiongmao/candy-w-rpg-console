export const METADATA_KEY = 'candy_w_rpg_director_v2';
export const STORAGE_FORMAT = 'candy-w-rpg-director/chat-state/v2';
export const RUNTIME_VERSION = 1;

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const exactKeys = (value, keys) => isRecord(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => own(value, key));
const sameChatIdentity = (left, right) => Boolean(left && right
    && left.characterId === right.characterId
    && left.chatId === right.chatId);

function storedIdentity(identity) {
    return { characterId: identity.characterId, chatId: identity.chatId };
}

export function createRuntimeState(lastHandledUserMessageId = -1) {
    return { version: RUNTIME_VERSION, lastHandledUserMessageId, operation: null };
}

function validOperation(value) {
    if (value === null) return true;
    if (!exactKeys(value, ['id', 'kind', 'stage', 'baseRevision', 'sourceMessageId', 'sourceText', 'expectedAssistantMessageId', 'error'])) return false;
    return typeof value.id === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/u.test(value.id)
        && ['opening', 'action', 'check_consequence'].includes(value.kind)
        && ['understanding', 'performing', 'recoverable', 'dismissed'].includes(value.stage)
        && Number.isSafeInteger(value.baseRevision) && value.baseRevision >= 0
        && Number.isSafeInteger(value.sourceMessageId) && value.sourceMessageId >= -1
        && typeof value.sourceText === 'string' && value.sourceText.length <= 12_000
        && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value.sourceText)
        && (value.expectedAssistantMessageId === null || Number.isSafeInteger(value.expectedAssistantMessageId) && value.expectedAssistantMessageId >= 0)
        && (value.error === null || typeof value.error === 'string' && value.error.length <= 600 && !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value.error));
}

export function validateRuntimeState(value) {
    return exactKeys(value, ['version', 'lastHandledUserMessageId', 'operation'])
        && value.version === RUNTIME_VERSION
        && Number.isSafeInteger(value.lastHandledUserMessageId)
        && value.lastHandledUserMessageId >= -1
        && validOperation(value.operation);
}

function assertStorageEnvelopeShape(value) {
    if (!exactKeys(value, ['format', 'identity', 'scenario', 'state', 'runtime']) || value.format !== STORAGE_FORMAT) {
        throw new Error('当前聊天中的 Candy W 导演状态不是完整的 v2 存储格式。');
    }
    if (!exactKeys(value.identity, ['characterId', 'chatId'])
        || typeof value.identity.characterId !== 'string'
        || !value.identity.characterId
        || typeof value.identity.chatId !== 'string'
        || !value.identity.chatId) {
        throw new Error('当前聊天中的 Candy W 导演状态身份格式无效。');
    }
    if (!validateRuntimeState(value.runtime)) throw new Error('当前聊天中的 Candy W 生成事务格式无效。');
}

function assertStorageEnvelope(value, identity) {
    assertStorageEnvelopeShape(value);
    if (!sameChatIdentity(value.identity, identity)) {
        throw new Error('当前聊天中的 Candy W 导演状态与角色或聊天身份不匹配。');
    }
}

export class PerChatRepository {
    constructor({ adapter, validateState, validateScenario }) {
        this.adapter = adapter;
        this.validateState = validateState;
        this.validateScenario = validateScenario;
    }

    currentIdentity() {
        return this.adapter.currentChatIdentity();
    }

    load() {
        const identity = this.currentIdentity();
        const metadata = this.adapter.currentChatMetadata();
        if (!identity || !metadata || !own(metadata, METADATA_KEY)) return null;
        const envelope = metadata[METADATA_KEY];
        assertStorageEnvelope(envelope, identity);
        const state = structuredClone(envelope.state);
        if (!this.validateState(state)) throw new Error('当前聊天中的 Candy W 导演状态未通过严格 v2 校验。');
        if (!this.validateScenario(envelope.scenario)) throw new Error('当前聊天中的 Candy W 剧本快照未通过严格校验。');
        return state;
    }

    loadScenario() {
        const identity = this.currentIdentity();
        const metadata = this.adapter.currentChatMetadata();
        if (!identity || !metadata || !own(metadata, METADATA_KEY)) return null;
        const envelope = metadata[METADATA_KEY];
        assertStorageEnvelope(envelope, identity);
        const scenario = structuredClone(envelope.scenario);
        if (!this.validateScenario(scenario)) throw new Error('当前聊天中的 Candy W 剧本快照未通过严格校验。');
        return scenario;
    }

    loadRuntime() {
        const identity = this.currentIdentity();
        const metadata = this.adapter.currentChatMetadata();
        if (!identity || !metadata || !own(metadata, METADATA_KEY)) return createRuntimeState();
        const envelope = metadata[METADATA_KEY];
        assertStorageEnvelope(envelope, identity);
        return structuredClone(envelope.runtime);
    }

    /**
     * The host's native checkpoint/branch save copies the source chat's
     * current metadata into the new chat and adds top-level `main_chat`.
     * Rebind only that precise, same-character shape. This is deliberately an
     * explicit write: ordinary reads must never silently take over arbitrary
     * copied metadata.
     *
     * A branch is a new timeline from the source's already committed current
     * state, not a replay of whichever old message the host displayed. Its
     * runtime cursor therefore belongs to the new chat's message sequence.
     */
    async adoptNativeBranchClone({
        expectedIdentity = this.currentIdentity(),
        lastHandledUserMessageId = -1,
        persist = true,
    } = {}) {
        if (!Number.isSafeInteger(lastHandledUserMessageId) || lastHandledUserMessageId < -1) {
            throw new Error('原生分支接管需要有效的新聊天玩家消息游标。');
        }
        const identity = this.currentIdentity();
        const metadata = this.adapter.currentChatMetadata();
        if (!expectedIdentity || !identity || !metadata || !sameChatIdentity(identity, expectedIdentity)) {
            throw new Error('当前聊天已切换，原生分支没有接管到其他聊天。');
        }
        if (!own(metadata, METADATA_KEY)) return null;

        const envelope = metadata[METADATA_KEY];
        assertStorageEnvelopeShape(envelope);
        if (sameChatIdentity(envelope.identity, identity)) return null;

        const mainChat = metadata.main_chat;
        if (typeof mainChat !== 'string' || !mainChat || mainChat !== envelope.identity.chatId
            || envelope.identity.characterId !== identity.characterId) {
            // Keep the normal strict error for all metadata that merely looks
            // copied. A `main_chat` marker is necessary but not sufficient.
            assertStorageEnvelope(envelope, identity);
        }

        const state = structuredClone(envelope.state);
        const scenario = structuredClone(envelope.scenario);
        if (!this.validateState(state)) throw new Error('原生分支中的 Candy W 导演状态未通过严格 v2 校验。');
        if (!this.validateScenario(scenario)) throw new Error('原生分支中的 Candy W 剧本快照未通过严格校验。');
        if (state.phase === 'generating' || state.pendingTransaction != null || envelope.runtime.operation !== null) {
            throw new Error('原生分支复制了尚未完成的导演事务；请先在来源聊天完成或恢复本轮，再创建分支。');
        }

        const previous = structuredClone(envelope);
        const runtime = createRuntimeState(lastHandledUserMessageId);
        metadata[METADATA_KEY] = {
            format: STORAGE_FORMAT,
            identity: storedIdentity(identity),
            scenario: structuredClone(scenario),
            state: structuredClone(state),
            runtime,
        };
        try {
            if (persist) await this.adapter.saveCurrentChat(expectedIdentity);
            else this.adapter.stageCurrentMetadata();
            if (!sameChatIdentity(this.currentIdentity(), expectedIdentity)) {
                throw new Error('原生分支接管提交时聊天已切换。');
            }
            return {
                state: structuredClone(state),
                scenario: structuredClone(scenario),
                runtime: structuredClone(runtime),
                sourceIdentity: structuredClone(previous.identity),
            };
        } catch (error) {
            metadata[METADATA_KEY] = previous;
            throw error;
        }
    }

    #assertWritable(state, expectedIdentity, expectedRevision) {
        const identity = this.currentIdentity();
        const metadata = this.adapter.currentChatMetadata();
        if (!expectedIdentity || !identity || !metadata || !sameChatIdentity(identity, expectedIdentity)) {
            throw new Error('当前聊天已切换，导演状态没有写入其他聊天。');
        }
        if (!this.validateState(state)) throw new Error('拒绝保存无效的 Candy W v2 导演状态。');
        if (expectedRevision !== undefined) {
            const current = this.load();
            const currentRevision = current?.revision ?? null;
            if (currentRevision !== expectedRevision) {
                throw new Error(`导演状态版本冲突：期望 ${expectedRevision ?? '空'}，当前 ${currentRevision ?? '空'}。`);
            }
        }
        return { identity, metadata };
    }

    async save(state, { expectedIdentity = this.currentIdentity(), expectedRevision, persist = true, runtime = undefined, scenario = undefined } = {}) {
        const { identity, metadata } = this.#assertWritable(state, expectedIdentity, expectedRevision);
        const hadPrevious = own(metadata, METADATA_KEY);
        const previous = hadPrevious ? structuredClone(metadata[METADATA_KEY]) : undefined;
        const currentRuntime = hadPrevious ? previous.runtime : createRuntimeState();
        const nextRuntime = runtime === undefined ? currentRuntime : structuredClone(runtime);
        if (!validateRuntimeState(nextRuntime)) throw new Error('拒绝保存无效的 Candy W v2 生成事务。');
        const nextScenario = scenario === undefined ? previous?.scenario : structuredClone(scenario);
        if (!this.validateScenario(nextScenario)) throw new Error('拒绝保存无效的 Candy W v2 剧本快照。');
        metadata[METADATA_KEY] = {
            format: STORAGE_FORMAT,
            identity: storedIdentity(identity),
            scenario: nextScenario,
            state: structuredClone(state),
            runtime: nextRuntime,
        };
        try {
            if (persist) await this.adapter.saveCurrentChat(expectedIdentity);
            else this.adapter.stageCurrentMetadata();
            if (!sameChatIdentity(this.currentIdentity(), expectedIdentity)) throw new Error('导演状态提交时聊天已切换。');
            return structuredClone(state);
        } catch (error) {
            if (hadPrevious) metadata[METADATA_KEY] = previous;
            else delete metadata[METADATA_KEY];
            throw error;
        }
    }

    async clear({ expectedIdentity = this.currentIdentity(), persist = true } = {}) {
        const identity = this.currentIdentity();
        const metadata = this.adapter.currentChatMetadata();
        if (!identity || !metadata || !sameChatIdentity(identity, expectedIdentity)) return false;
        if (!own(metadata, METADATA_KEY)) return true;
        const previous = structuredClone(metadata[METADATA_KEY]);
        delete metadata[METADATA_KEY];
        try {
            if (persist) await this.adapter.saveCurrentChat(expectedIdentity);
            else this.adapter.stageCurrentMetadata();
            return true;
        } catch (error) {
            metadata[METADATA_KEY] = previous;
            throw error;
        }
    }
}
