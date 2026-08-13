const identityKey = identity => identity ? `${identity.characterId}\u0000${identity.chatId}` : '';

const clone = value => value === undefined ? undefined : structuredClone(value);

function sameIdentity(left, right) {
    return Boolean(left && right
        && left.characterId === right.characterId
        && left.chatId === right.chatId);
}

function eventSet() {
    return new Set();
}

export class FakeOfficialAdapter {
    constructor({ enabled = true } = {}) {
        this.settings = { enabled, importedScenarios: [] };
        this.kind = 'none';
        this.identity = null;
        this.chats = new Map();
        this.persisted = new Map();
        this.prompts = null;
        this.promptsByChat = new Map();
        this.rawDecisions = [];
        this.rawPrompts = [];
        this.rawRequestOptions = [];
        this.generationRequests = [];
        this.saveCount = 0;
        this.stageCount = 0;
        this.clearCount = 0;
        this.stopOwnedCount = 0;
        this.ownedGenerationCancelled = false;
        this.beforeNextSave = null;
        this.connected = true;
        this.toolCallsEnabled = false;
        this.status = { active: false, streaming: false, streamingStopped: false, streamingFinished: false };
        this.interceptor = null;
        this.events = {
            messageReceived: eventSet(),
            generationStopped: eventSet(),
            generationEnded: eventSet(),
            streamToken: eventSet(),
            chatChanged: eventSet(),
            messageChanged: eventSet(),
        };
    }

    selectSingle(characterId = 'guide.png', chatId = 'chat-a') {
        this.kind = 'single';
        this.identity = { characterId, chatId, characterIndex: '0' };
        const key = identityKey(this.identity);
        if (!this.chats.has(key)) this.chats.set(key, { metadata: {}, messages: [] });
        return clone(this.identity);
    }

    selectGroup(groupId = 'group-a') {
        this.kind = 'group';
        this.identity = { groupId };
    }

    selectNone() {
        this.kind = 'none';
        this.identity = null;
    }

    async switchSingle(characterId, chatId) {
        this.selectSingle(characterId, chatId);
        await this.emit('chatChanged');
    }

    /**
     * Models SillyTavern's native branch/checkpoint persistence shape: the
     * target receives a truncated message snapshot but the source chat's
     * current metadata, augmented with main_chat, is copied into its header.
     * It intentionally does not emit CHAT_CHANGED; callers decide when to
     * open the newly-created chat.
     */
    createNativeBranch(chatId, { messageCount = this.currentMessages().length } = {}) {
        if (this.kind !== 'single') throw new Error('fake cannot branch outside a single chat');
        if (!Number.isSafeInteger(messageCount) || messageCount < 0 || messageCount > this.currentMessages().length) {
            throw new Error('fake branch message count is invalid');
        }
        const sourceIdentity = this.currentChatIdentity();
        const source = this.chats.get(identityKey(sourceIdentity));
        const targetIdentity = { ...sourceIdentity, chatId: String(chatId) };
        const targetKey = identityKey(targetIdentity);
        if (this.chats.has(targetKey)) throw new Error('fake branch chat already exists');
        this.chats.set(targetKey, {
            metadata: { ...clone(source.metadata), main_chat: sourceIdentity.chatId },
            messages: clone(source.messages.slice(0, messageCount)),
        });
        return clone(targetIdentity);
    }

    chatKind() { return this.kind; }
    currentChatIdentity() { return this.kind === 'single' ? clone(this.identity) : null; }

    currentChatMetadata() {
        if (this.kind !== 'single') return null;
        return this.chats.get(identityKey(this.identity)).metadata;
    }

    currentMessages() {
        if (this.kind !== 'single') return [];
        return this.chats.get(identityKey(this.identity)).messages;
    }

    messageAt(messageId) { return this.currentMessages()[Number(messageId)] ?? null; }

    latestUserAction() {
        const messages = this.currentMessages();
        for (let messageId = messages.length - 1; messageId >= 0; messageId -= 1) {
            const message = messages[messageId];
            if (message?.is_user && !message?.is_system && typeof message.mes === 'string' && message.mes.trim()) {
                return { messageId, text: message.mes.trim() };
            }
        }
        return null;
    }

    nextAssistantMessageId() { return this.currentMessages().length; }
    generationTypeIsAutomatic() { return false; }

    isIntermediateToolMessage(message) {
        return Boolean(message?.extra?.tool_invocations?.length || message?.extra?.tool_calls?.length);
    }

    generationStatus() { return clone(this.status); }
    isConnected() { return this.connected; }
    canPerformMainToolCalls() { return this.toolCallsEnabled; }
    getSettings() { return clone(this.settings); }
    saveSettings(settings) { this.settings = clone(settings); }

    setDirectorPrompts(prompts, expectedIdentity = this.currentChatIdentity()) {
        if (!sameIdentity(this.currentChatIdentity(), expectedIdentity)) throw new Error('fake identity changed before prompt injection');
        this.prompts = clone(prompts);
        this.promptsByChat.set(identityKey(expectedIdentity), clone(prompts));
    }

    clearDirectorPrompts() {
        this.prompts = null;
        this.clearCount += 1;
    }

    async saveCurrentChat(expectedIdentity) {
        if (!sameIdentity(this.currentChatIdentity(), expectedIdentity)) throw new Error('fake identity changed before save');
        const beforeSave = this.beforeNextSave;
        this.beforeNextSave = null;
        if (typeof beforeSave === 'function') await beforeSave();
        if (!sameIdentity(this.currentChatIdentity(), expectedIdentity)) throw new Error('fake identity changed while save was pending');
        this.saveCount += 1;
        this.persisted.set(identityKey(expectedIdentity), clone(this.currentChatMetadata()));
        return true;
    }

    stageCurrentMetadata() {
        if (this.kind !== 'single') throw new Error('fake has no current single chat');
        this.stageCount += 1;
        return true;
    }

    enqueueDecision(actionId, attribute = null, summary = `玩家尝试 ${actionId}`) {
        this.rawDecisions.push({ actionId, attribute, summary });
    }

    enqueueRaw(value) { this.rawDecisions.push(value); }

    async generateRawText(prompt, expectedIdentity, options = {}) {
        if (!sameIdentity(this.currentChatIdentity(), expectedIdentity)) throw new Error('fake identity changed during raw generation');
        this.ownedGenerationCancelled = false;
        this.rawPrompts.push(String(prompt));
        this.rawRequestOptions.push(clone(options));
        if (!this.connected) throw new Error('fake disconnected');
        if (this.rawDecisions.length === 0) throw new Error('fake raw decision queue is empty');
        const queued = this.rawDecisions.shift();
        if (queued instanceof Error) throw queued;
        let result;
        if (typeof queued === 'function') result = String(await queued(prompt));
        else if (typeof queued === 'string') result = queued;
        else {
            const tx = /"transactionId"\s*:\s*"([^"]+)"/u.exec(prompt)?.[1];
            const revision = Number(/"baseRevision"\s*:\s*(\d+)/u.exec(prompt)?.[1]);
            result = JSON.stringify({
                transactionId: tx,
                baseRevision: revision,
                actionId: queued.actionId,
                attribute: queued.attribute,
                summary: queued.summary,
            });
        }
        if (this.ownedGenerationCancelled) throw new Error('fake raw generation cancelled');
        if (!sameIdentity(this.currentChatIdentity(), expectedIdentity)) throw new Error('fake identity changed after raw generation');
        return result;
    }

    async requestAutomaticGeneration(expectedIdentity) {
        if (!sameIdentity(this.currentChatIdentity(), expectedIdentity)) throw new Error('fake identity changed before automatic generation');
        if (this.canPerformMainToolCalls()) throw new Error('fake tool calls enabled');
        this.generationRequests.push(clone(expectedIdentity));
        this.ownedGenerationCancelled = false;
        return undefined;
    }

    stopOwnedGeneration() {
        this.stopOwnedCount += 1;
        this.ownedGenerationCancelled = true;
        this.status = { active: false, streaming: false, streamingStopped: true, streamingFinished: false };
        return true;
    }

    #listen(name, handler) {
        this.events[name].add(handler);
        return () => this.events[name].delete(handler);
    }

    onMessageReceived(handler) { return this.#listen('messageReceived', handler); }
    onGenerationStopped(handler) { return this.#listen('generationStopped', handler); }
    onGenerationEnded(handler) { return this.#listen('generationEnded', handler); }
    onStreamToken(handler) { return this.#listen('streamToken', handler); }
    onChatChanged(handler) { return this.#listen('chatChanged', handler); }
    onMessageChanged(handler) { return this.#listen('messageChanged', handler); }

    installGenerationInterceptor(handler) {
        this.interceptor = handler;
        return () => {
            if (this.interceptor === handler) this.interceptor = null;
        };
    }

    listenerCount() {
        return Object.values(this.events).reduce((count, handlers) => count + handlers.size, 0);
    }

    appendUser(text, extra = {}) {
        if (this.kind !== 'single') throw new Error('fake cannot append a user message outside a single chat');
        const messages = this.currentMessages();
        messages.push({ is_user: true, is_system: false, mes: String(text), extra: clone(extra) });
        return messages.length - 1;
    }

    appendAssistant(text, extra = {}) {
        if (this.kind !== 'single') throw new Error('fake cannot append an assistant message outside a single chat');
        const messages = this.currentMessages();
        messages.push({ is_user: false, is_system: false, mes: String(text), extra: clone(extra) });
        return messages.length - 1;
    }

    seedMessages(messages) {
        this.chats.get(identityKey(this.identity)).messages = clone(messages);
    }

    async emit(name, ...args) {
        for (const handler of [...this.events[name]]) await handler(...args);
    }

    async invokeInterceptor(type = 'normal') {
        if (!this.interceptor) throw new Error('fake interceptor is not installed');
        let aborted = false;
        await this.interceptor(this.currentMessages(), 4096, value => { aborted = Boolean(value); }, type);
        return { aborted };
    }

    async completeGeneration(text, { type = 'normal', messageType = 'normal', extra = {}, streaming = false } = {}) {
        this.ownedGenerationCancelled = false;
        this.status = { active: true, streaming, streamingStopped: false, streamingFinished: false };
        const intercepted = await this.invokeInterceptor(type);
        if (intercepted.aborted) {
            this.status = { active: false, streaming: false, streamingStopped: false, streamingFinished: false };
            return { ...intercepted, messageId: null };
        }
        const messageId = this.appendAssistant(text, extra);
        await this.emit('messageReceived', messageId, messageType);
        this.status = { active: false, streaming: false, streamingStopped: false, streamingFinished: true };
        await this.emit('generationEnded');
        await Promise.resolve();
        await new Promise(resolve => setTimeout(resolve, 0));
        return { aborted: false, messageId };
    }

    async deliverOwnedResponse(text, { streaming = false } = {}) {
        if (this.ownedGenerationCancelled) return { cancelled: true, messageId: null };
        this.status = { active: true, streaming, streamingStopped: false, streamingFinished: false };
        if (streaming) await this.emit('streamToken', String(text));
        if (this.ownedGenerationCancelled) return { cancelled: true, messageId: null };
        const messageId = this.appendAssistant(text);
        await this.emit('messageReceived', messageId, 'normal');
        this.status = { active: false, streaming: false, streamingStopped: false, streamingFinished: true };
        await this.emit('generationEnded');
        return { cancelled: false, messageId };
    }

    async stopGeneration() {
        this.status = { active: false, streaming: true, streamingStopped: true, streamingFinished: false };
        await this.emit('generationStopped');
    }
}
