import { extension_settings, getContext } from '../../../../../extensions.js';
import {
    eventSource,
    event_types,
    extension_prompt_roles,
    extension_prompt_types,
    isGenerating,
    saveSettingsDebounced,
    setExtensionPrompt,
} from '../../../../../../script.js';

export const EXTENSION_NAME = 'candy-w-rpg-console';
export const DIRECTOR_INTERCEPTOR = 'candyWDirectorGenerationInterceptorV2';
export const DIRECTIVE_SLOT = 'candy-w-rpg-director.v2.performance';
export const WORLD_SCAN_SLOT = 'candy-w-rpg-director.v2.world-scan';

export const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    importedScenarios: [],
});

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

export function sameChatIdentity(left, right) {
    return Boolean(left && right
        && left.characterId === right.characterId
        && left.chatId === right.chatId);
}

export class SillyTavernAdapter {
    currentContext() {
        return getContext();
    }

    chatKind() {
        const context = this.currentContext();
        if (context?.groupId) return 'group';
        if (context?.characterId === undefined || context?.characterId === null || !context?.chatId) return 'none';
        return 'single';
    }

    currentChatIdentity() {
        if (this.chatKind() !== 'single') return null;
        const context = this.currentContext();
        const character = context.characters?.[context.characterId];
        const stableCharacterId = character?.avatar ?? character?.data?.avatar ?? context.characterId;
        return {
            characterId: String(stableCharacterId),
            chatId: String(context.chatId),
            characterIndex: String(context.characterId),
        };
    }

    currentChatMetadata() {
        return this.chatKind() === 'single' ? this.currentContext()?.chatMetadata ?? null : null;
    }

    currentMessages() {
        return this.chatKind() === 'single' ? this.currentContext()?.chat ?? [] : [];
    }

    messageAt(messageId) {
        const message = this.currentMessages()?.[Number(messageId)];
        return message && typeof message === 'object' ? message : null;
    }

    latestUserAction() {
        const chat = this.currentMessages();
        for (let messageId = chat.length - 1; messageId >= 0; messageId -= 1) {
            const message = chat[messageId];
            if (message?.is_user && !message?.is_system && typeof message.mes === 'string' && message.mes.trim()) {
                return { messageId, text: message.mes.trim() };
            }
        }
        return null;
    }

    nextAssistantMessageId() {
        return this.currentMessages().length;
    }

    generationTypeIsAutomatic() {
        return Boolean(this.currentContext()?.generationType === 'automatic');
    }

    isIntermediateToolMessage(message) {
        const extra = message?.extra;
        return Boolean(Array.isArray(extra?.tool_invocations) && extra.tool_invocations.length
            || Array.isArray(extra?.tool_calls) && extra.tool_calls.length);
    }

    generationStatus() {
        const processor = this.currentContext()?.streamingProcessor;
        return {
            active: Boolean(isGenerating()),
            streaming: Boolean(processor),
            streamingStopped: Boolean(processor?.isStopped),
            streamingFinished: Boolean(processor?.isFinished),
        };
    }

    isConnected() {
        return this.currentContext()?.onlineStatus !== 'no_connection';
    }

    canPerformMainToolCalls() {
        const canPerformToolCalls = this.currentContext()?.canPerformToolCalls;
        return typeof canPerformToolCalls === 'function' && Boolean(canPerformToolCalls('normal'));
    }

    getSettings() {
        const stored = extension_settings[EXTENSION_NAME];
        return { ...DEFAULT_SETTINGS, ...(stored && typeof stored === 'object' ? clone(stored) : {}) };
    }

    saveSettings(settings) {
        extension_settings[EXTENSION_NAME] = {
            ...DEFAULT_SETTINGS,
            ...clone(settings),
            importedScenarios: Array.isArray(settings?.importedScenarios) ? clone(settings.importedScenarios) : [],
        };
        saveSettingsDebounced();
    }

    setDirectorPrompts({ directive = '', scanSeed = '' } = {}, expectedIdentity = this.currentChatIdentity()) {
        if (!sameChatIdentity(this.currentChatIdentity(), expectedIdentity)) {
            this.clearDirectorPrompts();
            throw new Error('当前聊天已切换，导演指令没有注入其他聊天。');
        }
        setExtensionPrompt(DIRECTIVE_SLOT, String(directive), extension_prompt_types.IN_PROMPT, 0, false, extension_prompt_roles.SYSTEM);
        setExtensionPrompt(WORLD_SCAN_SLOT, String(scanSeed), extension_prompt_types.NONE, 0, true, extension_prompt_roles.SYSTEM);
    }

    clearDirectorPrompts() {
        setExtensionPrompt(DIRECTIVE_SLOT, '', extension_prompt_types.IN_PROMPT, 0, false, extension_prompt_roles.SYSTEM);
        setExtensionPrompt(WORLD_SCAN_SLOT, '', extension_prompt_types.NONE, 0, true, extension_prompt_roles.SYSTEM);
    }

    async saveCurrentChat(expectedIdentity) {
        const before = this.currentChatIdentity();
        const context = this.currentContext();
        if (!sameChatIdentity(before, expectedIdentity) || !context?.chatMetadata) {
            throw new Error('当前聊天已切换，导演状态没有写入其他聊天。');
        }
        if (typeof context.saveMetadata !== 'function') {
            throw new Error('SillyTavern 未提供正式的即时聊天 metadata 保存接口。');
        }
        await context.saveMetadata();
        if (!sameChatIdentity(this.currentChatIdentity(), expectedIdentity)) {
            throw new Error('保存期间聊天已切换，导演状态没有提交到新聊天。');
        }
        return true;
    }

    stageCurrentMetadata() {
        if (this.chatKind() !== 'single') throw new Error('当前不是单角色聊天。');
        return true;
    }

    async generateRawText(prompt, expectedIdentity, { responseLength = 700 } = {}) {
        if (!sameChatIdentity(this.currentChatIdentity(), expectedIdentity)) throw new Error('行动理解前聊天已切换。');
        if (!this.isConnected()) throw new Error('当前 SillyTavern 尚未连接模型。');
        const generateRaw = this.currentContext()?.generateRaw;
        if (typeof generateRaw !== 'function') throw new Error('SillyTavern 未提供正式的 generateRaw 接口。');
        if (!Number.isSafeInteger(responseLength) || responseLength < 1 || responseLength > 12_000) {
            throw new Error('原始文本请求长度必须是 1 到 12000 的整数。');
        }
        const result = await generateRaw({ prompt, responseLength, trimNames: false });
        if (!sameChatIdentity(this.currentChatIdentity(), expectedIdentity)) throw new Error('行动理解期间聊天已切换。');
        return String(result ?? '');
    }

    async requestAutomaticGeneration(expectedIdentity) {
        if (!sameChatIdentity(this.currentChatIdentity(), expectedIdentity)) throw new Error('生成前聊天已切换。');
        if (!this.isConnected()) throw new Error('当前 SillyTavern 尚未连接模型。');
        if (this.canPerformMainToolCalls()) throw new Error('当前普通生成启用了工具调用；SillyTavern 1.18.0 会在最终回复事件之后才判断工具递归，导演无法可靠提交。请关闭工具调用后重试本轮。');
        if (isGenerating()) throw new Error('SillyTavern 已有生成正在进行。');
        const generate = this.currentContext()?.generate;
        if (typeof generate !== 'function') throw new Error('SillyTavern 未提供正式的普通生成接口。');
        return await generate('normal', { automatic_trigger: true });
    }

    stopOwnedGeneration() {
        const stopGeneration = this.currentContext()?.stopGeneration;
        return typeof stopGeneration === 'function' ? Boolean(stopGeneration()) : false;
    }

    on(event, handler, { last = false } = {}) {
        if (last && typeof eventSource.makeLast === 'function') eventSource.makeLast(event, handler);
        else eventSource.on(event, handler);
        return () => eventSource.removeListener(event, handler);
    }

    onChatChanged(handler) {
        const removers = [
            this.on(event_types.CHAT_CHANGED, handler),
            this.on(event_types.CHAT_DELETED, handler),
        ];
        return () => removers.forEach(remove => remove());
    }

    onMessageReceived(handler) {
        return this.on(event_types.MESSAGE_RECEIVED, handler, { last: true });
    }

    onGenerationStopped(handler) {
        return this.on(event_types.GENERATION_STOPPED, handler, { last: true });
    }

    onGenerationEnded(handler) {
        return this.on(event_types.GENERATION_ENDED, handler, { last: true });
    }

    onStreamToken(handler) {
        return this.on(event_types.STREAM_TOKEN_RECEIVED, handler, { last: true });
    }

    onMessageChanged(handler) {
        const removers = [
            this.on(event_types.MESSAGE_EDITED, handler),
            this.on(event_types.MESSAGE_DELETED, handler),
            this.on(event_types.MESSAGE_SWIPED, handler),
        ];
        return () => removers.forEach(remove => remove());
    }

    installGenerationInterceptor(handler) {
        globalThis[DIRECTOR_INTERCEPTOR] = handler;
        return () => {
            if (globalThis[DIRECTOR_INTERCEPTOR] === handler) delete globalThis[DIRECTOR_INTERCEPTOR];
        };
    }

    notifyError(message) {
        globalThis.toastr?.error?.(String(message));
    }
}
