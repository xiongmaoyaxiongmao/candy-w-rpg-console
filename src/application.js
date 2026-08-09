import { ACTIONS, PHASES, addCondition, addRecord, beginGeneration, endCampaign, finishGeneration, makeId, prepareCampaign, recoverGeneration, removeCondition, removeRecord, resolveCheck, setCampaignDetails, setPlayer, setScene } from './domain.js';
import { compileContext } from './context-compiler.js';
import { sameIdentity } from './repository.js';
import { parseCampaignImport } from './schema.js';

const SINGLE_CHAT_ONLY_MESSAGE = '跑团控制台仅支持单个角色聊天，请打开一个单个角色聊天。';

export class RpgApplication {
    constructor({ repository, adapter, random = Math.random }) {
        this.repository = repository;
        this.adapter = adapter;
        this.random = random;
        this.enabled = true;
        this.listeners = new Set();
        this.activeTransactions = new Map();
    }
    subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
    emit(event = {}) { for (const listener of this.listeners) listener({ state: this.currentState(), enabled: this.enabled, ...event }); }
    currentState() { return this.enabled ? this.repository.load() : null; }
    chatKind() { return this.adapter.chatKind(); }
    hasChat() { return this.chatKind() === 'single'; }
    currentIdentity() { return this.repository.currentIdentity(); }
    transactionKey(identity = this.currentIdentity()) { return identity ? identity.characterId + '\u0000' + identity.chatId : null; }

    async sync(eventType = 'sync') {
        const identity = this.currentIdentity();
        if (!this.enabled || !identity) {
            this.adapter.setContext('');
            this.emit({ type: eventType, identity: null, chatKind: this.chatKind() });
            return null;
        }
        let state = this.repository.load();
        if (state?.lifecycle.phase === PHASES.GENERATING && this.activeTransactions.get(this.transactionKey(identity)) !== state.lifecycle.transaction.id) {
            state = recoverGeneration(state);
            await this.repository.save(state, identity);
        }
        this.adapter.setContext(state ? compileContext(state) : '');
        this.emit({ type: eventType, identity, chatKind: 'single' });
        return state;
    }

    setEnabled(enabled) {
        const state = this.repository.load();
        if (!enabled && state?.lifecycle.phase === PHASES.GENERATING) throw new Error('主持人正在生成；请等本次请求结束或停止后再关闭插件。');
        this.enabled = Boolean(enabled);
        this.adapter.setContext(this.enabled && state ? compileContext(state) : '');
        this.emit({ type: 'enabled' });
    }

    async commit(state, expectedIdentity) {
        await this.repository.save(state, expectedIdentity);
        if (this.enabled && sameIdentity(this.currentIdentity(), expectedIdentity)) this.adapter.setContext(compileContext(state));
        this.emit({ type: 'saved' });
        return state;
    }

    requireState() {
        const state = this.currentState();
        if (!state) throw new Error('请先开新团。');
        if (state.lifecycle.phase === PHASES.ENDED) throw new Error('这一团已经结束；请开新团。');
        return state;
    }
    requireInteractiveState() {
        const state = this.requireState();
        if (state.lifecycle.phase === PHASES.GENERATING) throw new Error('主持人正在生成；请等待本次请求结束。');
        return state;
    }

    async createCampaign(input) {
        if (this.chatKind() === 'group') throw new Error(SINGLE_CHAT_ONLY_MESSAGE);
        const identity = this.currentIdentity();
        if (!identity) throw new Error('请先打开一个单个角色聊天，再开新团。');
        const existing = this.repository.load();
        if (existing && existing.lifecycle.phase !== PHASES.ENDED) throw new Error('当前聊天已有进行中的团；请继续或先结束本团。');
        return this.commit(prepareCampaign(input), identity);
    }
    async updateCampaign(input) { const identity = this.currentIdentity(); return this.commit(setCampaignDetails(this.requireInteractiveState(), input), identity); }
    async updateScene(input) { const identity = this.currentIdentity(); return this.commit(setScene(this.requireInteractiveState(), input), identity); }
    async updatePlayer(input) { const identity = this.currentIdentity(); return this.commit(setPlayer(this.requireInteractiveState(), input), identity); }
    async addCondition(value) { const identity = this.currentIdentity(); return this.commit(addCondition(this.requireInteractiveState(), value), identity); }
    async removeCondition(value) { const identity = this.currentIdentity(); return this.commit(removeCondition(this.requireInteractiveState(), value), identity); }
    async addRecord(type, input) { const identity = this.currentIdentity(); return this.commit(addRecord(this.requireInteractiveState(), type, input), identity); }
    async removeRecord(type, id) { const identity = this.currentIdentity(); return this.commit(removeRecord(this.requireInteractiveState(), type, id), identity); }
    async rollCheck(input) { const identity = this.currentIdentity(); return this.commit(resolveCheck(this.requireInteractiveState(), input, this.random), identity); }

    async requestAi(action) {
        if (!this.enabled) throw new Error('请先在扩展设置中启用跑团控制台。');
        if (this.chatKind() === 'group') throw new Error(SINGLE_CHAT_ONLY_MESSAGE);
        const identity = this.currentIdentity();
        if (!identity) throw new Error('请先打开一个单个角色聊天。');
        const before = this.requireInteractiveState();
        const transactionId = makeId('generation');
        const pending = beginGeneration(before, action, transactionId);
        try {
            await this.commit(pending, identity);
            this.activeTransactions.set(this.transactionKey(identity), transactionId);
            await this.adapter.requestStandardGeneration(identity);
            if (!sameIdentity(this.currentIdentity(), identity)) throw new Error('生成期间聊天已切换；本次团务结果未写入其他聊天。');
            const current = this.repository.load();
            if (!current || current.revision !== pending.revision || current.lifecycle.transaction?.id !== transactionId) throw new Error('主持事务状态已改变；本次结果不会覆盖当前团务。');
            return await this.commit(finishGeneration(current, transactionId), identity);
        } catch (error) {
            if (sameIdentity(this.currentIdentity(), identity)) {
                const current = this.repository.load();
                if (current?.lifecycle.transaction?.id === transactionId) await this.commit(recoverGeneration(current, transactionId), identity);
            }
            this.emit({ type: 'generation-error', error: error instanceof Error ? error.message : String(error), identity });
            throw error;
        } finally {
            this.activeTransactions.delete(this.transactionKey(identity));
        }
    }
    startOrContinue() { const state = this.requireInteractiveState(); return this.requestAi(state.lifecycle.phase === PHASES.READY ? ACTIONS.OPENING : ACTIONS.CONTINUE); }
    continueAfterCheck() { return this.requestAi(ACTIONS.CHECK_RESULT); }
    async endCampaign() { const identity = this.currentIdentity(); return this.commit(endCampaign(this.requireInteractiveState()), identity); }
    async importCampaign(payload) {
        const current = this.repository.load();
        if (current?.lifecycle.phase === PHASES.GENERATING) throw new Error('主持人正在生成，不能导入覆盖当前团务。');
        const identity = this.currentIdentity();
        if (!identity) throw new Error('请先打开一个单个角色聊天，再导入。');
        return this.commit(parseCampaignImport(payload), identity);
    }
    async onChatChanged() {
        try { await this.sync('chat-changed'); }
        catch (error) { this.emit({ type: 'sync-error', error: error instanceof Error ? error.message : String(error), identity: this.currentIdentity() }); }
    }
    deactivate() {
        if (this.repository.load()?.lifecycle.phase === PHASES.GENERATING) throw new Error('主持人正在生成，暂时不能关闭插件。');
        this.enabled = false;
        this.adapter.setContext('');
        this.emit({ type: 'deactivated' });
    }
}
