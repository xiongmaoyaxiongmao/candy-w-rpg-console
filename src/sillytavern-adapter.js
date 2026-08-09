import { extension_settings, getContext } from '../../../../extensions.js';
import { eventSource, event_types, extension_prompt_roles, extension_prompt_types, isGenerating, saveSettingsDebounced, setExtensionPrompt, setSendButtonState } from '../../../../../script.js';
import { CONTEXT_SLOT, EXTENSION_NAME } from './domain.js';
import { runGenerationTransaction } from './generation-transaction.js';

export const DEFAULT_SETTINGS = Object.freeze({ enabled: true, showButton: true });
export const SINGLE_CHAT_ONLY_MESSAGE = '跑团控制台仅支持单个角色聊天，请打开一个单个角色聊天。';

export function sameChatIdentity(left, right) {
    return Boolean(left && right && left.characterId === right.characterId && left.chatId === right.chatId);
}

export class SillyTavernAdapter {
    constructor() { this.busy = false; }
    currentContext() { return getContext(); }
    chatKind() {
        const context = this.currentContext();
        if (context?.groupId) return 'group';
        if (!context?.chatId || context.characterId === undefined || context.characterId === null) return 'none';
        return 'single';
    }
    currentChatIdentity() {
        if (this.chatKind() !== 'single') return null;
        const context = this.currentContext();
        return { characterId: String(context.characterId), chatId: String(context.chatId) };
    }
    currentChatId() { return this.currentChatIdentity()?.chatId ?? null; }
    currentChatMetadata() { return this.chatKind() === 'single' ? this.currentContext()?.chatMetadata ?? null : null; }
    getSettings() { return { ...DEFAULT_SETTINGS, ...(extension_settings[EXTENSION_NAME] ?? {}) }; }
    saveSettings(settings) { extension_settings[EXTENSION_NAME] = { ...DEFAULT_SETTINGS, ...settings }; saveSettingsDebounced(); }
    setContext(value) { setExtensionPrompt(CONTEXT_SLOT, this.chatKind() === 'single' ? value : '', extension_prompt_types.IN_PROMPT, 0, false, extension_prompt_roles.SYSTEM); }
    on(event, handler) { eventSource.on(event, handler); return () => eventSource.removeListener(event, handler); }
    onChatChanged(handler) { const offChanged = this.on(event_types.CHAT_CHANGED, handler); const offDeleted = this.on(event_types.CHAT_DELETED, handler); return () => { offChanged(); offDeleted(); }; }

    async saveCurrentChatMetadata(expectedIdentity) {
        const context = this.currentContext();
        if (!sameChatIdentity(this.currentChatIdentity(), expectedIdentity) || !context?.chatMetadata) throw new Error('当前聊天已切换，未写入跑团状态。');
        if (typeof context.saveMetadata !== 'function') throw new Error('当前 SillyTavern 未提供即时保存聊天 metadata 的接口。');
        await context.saveMetadata();
        return sameChatIdentity(this.currentChatIdentity(), expectedIdentity);
    }

    async requestStandardGeneration(expectedIdentity) {
        const context = this.currentContext();
        if (this.chatKind() === 'group') throw new Error(SINGLE_CHAT_ONLY_MESSAGE);
        if (!sameChatIdentity(this.currentChatIdentity(), expectedIdentity)) throw new Error('当前聊天已切换，无法请求主持人。');
        if (this.busy || isGenerating()) throw new Error('酒馆已有生成正在进行，请等待结束后再请求主持人。');
        if (context.onlineStatus === 'no_connection') throw new Error('当前酒馆尚未连接模型，无法请求主持人。');
        if (typeof context.generate !== 'function' || typeof context.deactivateSendButtons !== 'function' || typeof context.activateSendButtons !== 'function') throw new Error('当前 SillyTavern 未提供完整的标准生成接口。');
        this.busy = true;
        setSendButtonState(true);
        context.deactivateSendButtons();
        try {
            const result = await runGenerationTransaction({
                eventSource,
                stoppedEvent: event_types.GENERATION_STOPPED,
                generate: () => context.generate('normal', { automatic_trigger: true, depth: 1 }),
            });
            if (!sameChatIdentity(this.currentChatIdentity(), expectedIdentity)) throw new Error('生成期间聊天已切换；本次团务结果未写入其他聊天。');
            return result;
        } finally {
            this.busy = false;
            context.activateSendButtons();
        }
    }
}
