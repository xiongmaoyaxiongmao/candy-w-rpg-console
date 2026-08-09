import { METADATA_KEY, normalizeState } from './domain.js';

export function sameIdentity(left, right) {
    return Boolean(left && right && left.characterId === right.characterId && left.chatId === right.chatId);
}

export class PerChatRepository {
    constructor(adapter) { this.adapter = adapter; }
    currentIdentity() { return this.adapter.currentChatIdentity(); }
    currentChatId() { return this.currentIdentity()?.chatId ?? null; }
    load() {
        const metadata = this.adapter.currentChatMetadata();
        return metadata ? normalizeState(metadata[METADATA_KEY]) : null;
    }
    async save(state, expectedIdentity = this.currentIdentity()) {
        const metadata = this.adapter.currentChatMetadata();
        if (!expectedIdentity || !metadata || !sameIdentity(this.currentIdentity(), expectedIdentity)) throw new Error('当前聊天已切换，未写入跑团状态。');
        const hadPrevious = Object.hasOwn(metadata, METADATA_KEY);
        const previous = hadPrevious ? structuredClone(metadata[METADATA_KEY]) : undefined;
        metadata[METADATA_KEY] = state;
        try {
            const persisted = await this.adapter.saveCurrentChatMetadata(expectedIdentity);
            if (!persisted || !sameIdentity(this.currentIdentity(), expectedIdentity)) throw new Error('当前聊天在保存时已切换；本次状态未提交到其他聊天。');
            return state;
        } catch (error) {
            if (hadPrevious) metadata[METADATA_KEY] = previous;
            else delete metadata[METADATA_KEY];
            throw error;
        }
    }
    async clear(expectedIdentity = this.currentIdentity()) {
        const metadata = this.adapter.currentChatMetadata();
        if (!expectedIdentity || !metadata || !sameIdentity(this.currentIdentity(), expectedIdentity)) return false;
        if (!Object.hasOwn(metadata, METADATA_KEY)) return true;
        const previous = structuredClone(metadata[METADATA_KEY]);
        delete metadata[METADATA_KEY];
        try {
            const persisted = await this.adapter.saveCurrentChatMetadata(expectedIdentity);
            if (!persisted || !sameIdentity(this.currentIdentity(), expectedIdentity)) throw new Error('当前聊天在保存时已切换；未清除跑团状态。');
            return true;
        } catch (error) {
            metadata[METADATA_KEY] = previous;
            throw error;
        }
    }
}
