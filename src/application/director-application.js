import {
    analyzeScenarioGraph,
    buildPublicPerformanceFacts,
    commitTurn,
    createCheckResult,
    createDirectorState,
    listAvailableMoves,
    prepareActionTurn,
    prepareCheckConsequence,
    prepareOpeningTurn,
    projectPublicState,
    recoverPendingState,
    stateMatchesScenario,
    validateDirectorState,
    validateScenario,
} from '../domain/index.js';
import {
    exportSavePackage,
    importSavePackage,
    importScenarioPackage,
} from '../io/index.js';
import { compileWorldInfoScanSeed } from '../compilation/index.js';
import {
    buildCustomScenarioPrompt,
    buildWorldInfoScenarioPrompt,
    buildActionDecisionPrompt,
    buildPerformanceDirective,
    parseAndFinalizeCustomScenario,
    parseAndValidateActionDecision,
    assertWorldInfoScenarioRequest,
    validatePerformanceMessage,
} from '../protocol/index.js';
import { createRuntimeState } from '../persistence/per-chat-repository.js';
import { BUILT_IN_SCENARIOS } from '../scenarios/index.js';

const ATTRIBUTES = Object.freeze([
    { id: 'body', label: '身手' },
    { id: 'insight', label: '洞察' },
    { id: 'rapport', label: '交涉' },
]);
const GENERIC_FORBIDDEN = Object.freeze([
    '任何未列入本轮公开事实的幕后秘密',
    '未来剧情节点、未触发结局或尚未发生的事件',
    'NPC 尚未揭露的真实目的与幕后行动',
    '导演状态、隐藏变量、事务协议或剧本内部字段',
]);

function clone(value) {
    return value === undefined ? undefined : structuredClone(value);
}

function messageOf(error) {
    return error instanceof Error ? error.message : String(error ?? '未知错误');
}

function publicScenario(scenario) {
    return {
        id: scenario.id,
        version: scenario.contentVersion,
        title: scenario.public.title,
        tagline: scenario.public.tagline,
        summary: scenario.public.summary,
        tone: scenario.public.tone,
        duration: scenario.public.duration,
        symbol: scenario.public.symbol,
        tags: [...scenario.public.tags],
    };
}

function operation({ id, kind, stage, baseRevision, sourceMessageId = -1, sourceText = '', expectedAssistantMessageId = null, error = null }) {
    return { id, kind, stage, baseRevision, sourceMessageId, sourceText, expectedAssistantMessageId, error };
}

function sameIdentity(left, right) {
    return Boolean(left && right && left.characterId === right.characterId && left.chatId === right.chatId);
}

function publicContext(state, scenario) {
    const view = projectPublicState(state, scenario);
    return [
        `场景：${view.scene.title}（${view.scene.location}）`,
        ...view.objectives.map(item => `目标：${item.name}`),
        ...view.characters.map(item => `认识的人：${item.name}；关系：${item.relation}`),
        ...view.clues.map(item => `已知线索：${item.name}`),
    ].join('\n');
}

function forbiddenPhrases(scenario, turn) {
    const forbidden = new Set(turn.decision.forbiddenReveal);
    return scenario.secrets.filter(secret => forbidden.has(secret.id)).flatMap(secret => secret.leakPhrases);
}

export class DirectorApplication {
    constructor({ adapter, repository, scenarios = BUILT_IN_SCENARIOS, deps = {} }) {
        if (!adapter || !repository) throw new Error('DirectorApplication 需要 official adapter 与 per-chat repository。');
        this.adapter = adapter;
        this.repository = repository;
        this.deps = deps;
        this.listeners = new Set();
        this.removers = [];
        this.started = false;
        this.disposed = false;
        this.localIdentity = null;
        this.activeTransactionId = null;
        this.activeUnderstanding = null;
        this.branchAdoption = null;
        this.localError = null;
        this.scenarios = new Map();
        for (const scenario of scenarios) this.#registerScenario(scenario);
        for (const scenario of adapter.getSettings?.().importedScenarios ?? []) {
            if (validateScenario(scenario)) this.#registerScenario(scenario);
        }
    }

    #registerScenario(scenario) {
        if (!validateScenario(scenario)) throw new Error('拒绝注册无效的 Candy W v2 剧本。');
        if (!analyzeScenarioGraph(scenario).isComplete) throw new Error('拒绝注册剧情图不完整的 Candy W v2 剧本。');
        this.scenarios.set(`${scenario.id}@${scenario.hash}`, clone(scenario));
    }

    #enabled() {
        return this.adapter.getSettings?.().enabled !== false;
    }

    #assertMayContinue(identity, stage) {
        if (this.disposed || !this.#enabled()) throw new Error(`${stage}期间 Candy W 已禁用或卸载；已保存的事务会停在恢复点，不会继续请求模型。`);
        if (!sameIdentity(this.adapter.currentChatIdentity(), identity)) throw new Error(`${stage}期间聊天已切换；旧聊天保留恢复点，新聊天不会接收导演生成。`);
    }

    #requireSingle() {
        const kind = this.adapter.chatKind();
        if (kind === 'group') throw new Error('Candy W 只支持当前单个角色聊天，群聊不会建立状态或触发生成。');
        if (kind !== 'single') throw new Error('请先打开一个单角色聊天，再进入故事世界。');
        const identity = this.adapter.currentChatIdentity();
        if (!identity) throw new Error('当前聊天缺少稳定的 characterId + chatId 身份。');
        return identity;
    }

    #loadPair() {
        const state = this.repository.load();
        const scenario = state ? this.repository.loadScenario() : null;
        if (state && (!scenario || !stateMatchesScenario(state, scenario))) throw new Error('当前聊天的导演状态与固定剧本快照不一致。');
        return { state, scenario };
    }

    async #adoptNativeBranchClone(identity = this.adapter.currentChatIdentity()) {
        if (!identity || !sameIdentity(this.adapter.currentChatIdentity(), identity)) return false;
        const key = `${identity.characterId}\u0000${identity.chatId}`;
        if (this.branchAdoption?.key === key) return await this.branchAdoption.promise;
        const promise = (async () => {
            const latest = this.adapter.latestUserAction();
            const adopted = await this.repository.adoptNativeBranchClone({
                expectedIdentity: identity,
                // Message ids are local to each native chat file. Mark the
                // branch snapshot as historical so its next player action,
                // rather than an action from the source chat, is classified.
                lastHandledUserMessageId: latest?.messageId ?? -1,
            });
            if (!adopted) return false;
            this.#registerScenario(adopted.scenario);
            this.localIdentity = clone(identity);
            this.localError = null;
            return true;
        })();
        this.branchAdoption = { key, promise };
        try {
            return await promise;
        } finally {
            if (this.branchAdoption?.promise === promise) this.branchAdoption = null;
        }
    }

    #scenarioById(scenarioId) {
        const matches = [...this.scenarios.values()].filter(scenario => scenario.id === scenarioId);
        if (matches.length === 0) throw new Error('所选剧本不存在或未通过严格校验。');
        return clone(matches.at(-1));
    }

    subscribe(listener) {
        if (typeof listener !== 'function') throw new Error('订阅者必须是函数。');
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    #emit(type = 'changed') {
        const event = Object.freeze({ type });
        for (const listener of this.listeners) listener(event);
    }

    start() {
        if (this.started || this.disposed) return this;
        this.started = true;
        if (this.#enabled()) this.#attachHooks();
        this.localIdentity = clone(this.adapter.currentChatIdentity());
        void this.#adoptNativeBranchClone(this.localIdentity)
            .then(adopted => {
                if (adopted) this.#emit('branch-adopted');
            })
            .catch(error => {
                this.localError = messageOf(error);
                this.#emit('branch-adoption-failed');
            });
        this.#emit('started');
        return this;
    }

    #attachHooks() {
        if (this.removers.length || this.disposed) return;
        this.removers = [
            this.adapter.installGenerationInterceptor((chat, contextSize, abort, type) => this.handleGenerationInterceptor(chat, contextSize, abort, type)),
            this.adapter.onMessageReceived((messageId, type) => this.handleMessageReceived(messageId, type)),
            this.adapter.onGenerationStopped(() => this.handleGenerationStopped()),
            this.adapter.onGenerationEnded(() => this.handleGenerationEnded()),
            this.adapter.onStreamToken(() => this.handleStreamToken()),
            this.adapter.onChatChanged(() => this.handleChatChanged()),
            this.adapter.onMessageChanged(() => this.handleMessageMutation()),
        ];
    }

    #detachHooks() {
        for (const remove of this.removers.splice(0)) remove?.();
    }

    async destroy() {
        if (this.disposed) return;
        this.disposed = true;
        const ownedGeneration = Boolean(this.activeTransactionId || this.activeUnderstanding);
        this.activeTransactionId = null;
        this.activeUnderstanding = null;
        if (ownedGeneration) this.adapter.stopOwnedGeneration();
        this.adapter.clearDirectorPrompts();
        this.#detachHooks();
        this.listeners.clear();
    }

    listScenarios() {
        return [...this.scenarios.values()].map(publicScenario);
    }

    getViewModel() {
        const enabled = this.#enabled();
        const host = { kind: this.adapter.chatKind() };
        if (!enabled || host.kind !== 'single') return { enabled, host, phase: 'empty' };
        try {
            const { state, scenario } = this.#loadPair();
            if (!state) return { enabled, host, phase: 'empty' };
            const publicState = projectPublicState(state, scenario);
            const runtime = this.repository.loadRuntime();
            const orphanedUnderstanding = runtime.operation?.stage === 'understanding'
                && this.activeUnderstanding?.id !== runtime.operation.id;
            const recoverable = runtime.operation?.stage === 'recoverable'
                || orphanedUnderstanding
                || (state.phase === 'generating' && this.activeTransactionId !== state.pendingTransaction?.id);
            const phase = recoverable
                ? 'recoverable_error'
                : state.phase === 'generating'
                    ? state.pendingTransaction?.kind === 'check_consequence' ? 'resolving_check' : 'opening'
                    : state.phase;
            return {
                enabled,
                host,
                phase,
                scenario: publicScenario(scenario),
                player: clone(state.player),
                chapter: clone(publicState.chapter),
                scene: clone(publicState.scene),
                world: {
                    objectives: clone(publicState.objectives),
                    characters: clone(publicState.characters),
                    clues: clone(publicState.clues),
                    items: clone(publicState.items),
                    crises: clone(publicState.crises),
                    pendingCheck: clone(publicState.pendingCheck),
                    lastCheck: clone(publicState.lastCheck),
                },
                pendingCheck: clone(publicState.pendingCheck),
                lastCheck: clone(publicState.lastCheck),
                ending: clone(publicState.ending),
                transaction: state.pendingTransaction ? { kind: state.pendingTransaction.kind, id: state.pendingTransaction.id } : null,
                error: recoverable ? {
                    title: '这一幕没有完成',
                    message: runtime.operation?.error || this.localError || '导演事务已经安全停在已保存的位置。',
                    canRetry: true,
                    canCancel: state.pendingTransaction?.kind !== 'check_consequence',
                } : null,
            };
        } catch (error) {
            return { enabled, host, phase: 'recoverable_error', error: { title: '当前旅程无法载入', message: messageOf(error), canRetry: false, canCancel: false } };
        }
    }

    async setEnabled(enabled) {
        const settings = this.adapter.getSettings();
        this.adapter.saveSettings({ ...settings, enabled: Boolean(enabled) });
        if (!enabled) {
            const ownedGeneration = Boolean(this.activeTransactionId || this.activeUnderstanding);
            this.activeTransactionId = null;
            this.activeUnderstanding = null;
            if (ownedGeneration) this.adapter.stopOwnedGeneration();
            this.adapter.clearDirectorPrompts();
            this.#detachHooks();
        } else if (this.started && !this.disposed) {
            this.localIdentity = clone(this.adapter.currentChatIdentity());
            this.#attachHooks();
            void this.#adoptNativeBranchClone(this.localIdentity)
                .then(adopted => {
                    if (adopted) this.#emit('branch-adopted');
                })
                .catch(error => {
                    this.localError = messageOf(error);
                    this.#emit('branch-adoption-failed');
                });
        }
        this.#emit('enabled-changed');
    }

    async createCampaign({ scenarioId, player }) {
        const identity = this.#requireSingle();
        await this.#adoptNativeBranchClone(identity);
        if (!this.#enabled()) throw new Error('请先启用 Candy W。');
        const current = this.repository.load();
        if (current && current.phase !== 'ended') throw new Error('当前聊天已有进行中的旅程；请先结束或明确导入替换。');
        const scenario = this.#scenarioById(String(scenarioId));
        const state = createDirectorState(scenario, player, this.deps);
        const latest = this.adapter.latestUserAction();
        const runtime = createRuntimeState(latest?.messageId ?? -1);
        await this.repository.save(state, { expectedIdentity: identity, scenario, runtime });
        this.localError = null;
        this.#emit('campaign-created');
    }

    #compileTurn(state, scenario, turn) {
        const directive = buildPerformanceDirective({
            publicFacts: buildPublicPerformanceFacts(state, scenario),
            mustHappen: turn.decision.mustHappen,
            forbiddenTopics: GENERIC_FORBIDDEN,
            check: turn.decision.check,
        });
        const scanSeed = compileWorldInfoScanSeed(turn.decision.scanSeeds);
        return { directive, scanSeed };
    }

    async #persistPerforming(state, scenario, turn, identity, runtimeInput) {
        const expectedAssistantMessageId = this.adapter.nextAssistantMessageId();
        const runtime = {
            ...runtimeInput,
            operation: operation({
                ...runtimeInput.operation,
                id: turn.id,
                kind: turn.kind,
                stage: 'performing',
                baseRevision: turn.baseRevision,
                expectedAssistantMessageId,
                error: null,
            }),
        };
        await this.repository.save(state, {
            expectedIdentity: identity,
            expectedRevision: turn.baseRevision,
            scenario,
            runtime,
        });
        this.#assertMayContinue(identity, '导演事务保存');
        const prompts = this.#compileTurn(state, scenario, turn);
        this.adapter.setDirectorPrompts(prompts, identity);
        this.activeTransactionId = turn.id;
        this.localIdentity = clone(identity);
        this.#emit('performing');
        return runtime;
    }

    #requestAutomaticGeneration(identity) {
        // The host's normal generation promise does not resolve until the reply
        // has finished. Do not await it here: doing so would keep the panel
        // command busy for the entire model response and blur event ownership.
        void Promise.resolve()
            .then(() => this.adapter.requestAutomaticGeneration(identity))
            .catch(error => {
                if (!sameIdentity(this.adapter.currentChatIdentity(), identity)) {
                    this.activeTransactionId = null;
                    this.adapter.clearDirectorPrompts();
                    this.#emit('generation-left-chat');
                    return;
                }
                return this.#markRecoverable(messageOf(error));
            });
    }

    async enterWorld() {
        const identity = this.#requireSingle();
        await this.#adoptNativeBranchClone(identity);
        const { state, scenario } = this.#loadPair();
        if (!state || state.phase !== 'ready') throw new Error('当前旅程不在可开场阶段。');
        const prepared = prepareOpeningTurn(state, scenario, this.deps);
        const currentRuntime = this.repository.loadRuntime();
        const runtime = {
            ...currentRuntime,
            operation: operation({ id: prepared.turn.id, kind: 'opening', stage: 'performing', baseRevision: state.revision, sourceMessageId: currentRuntime.lastHandledUserMessageId }),
        };
        await this.#persistPerforming(prepared.state, scenario, prepared.turn, identity, runtime);
        this.#requestAutomaticGeneration(identity);
    }

    async handleGenerationInterceptor(_chat, _contextSize, abort, type) {
        if (!this.#enabled()) return;
        if (this.adapter.chatKind() !== 'single') {
            this.adapter.clearDirectorPrompts();
            return;
        }
        const identity = this.adapter.currentChatIdentity();
        try {
            await this.#adoptNativeBranchClone(identity);
        } catch (error) {
            this.localError = messageOf(error);
            this.adapter.clearDirectorPrompts();
            abort(true);
            this.#emit('branch-adoption-failed');
            return;
        }
        const { state, scenario } = this.#loadPair();
        if (!state) return;
        if (type !== 'normal') {
            this.adapter.clearDirectorPrompts();
            if (['continue', 'regenerate', 'swipe', 'impersonate'].includes(type)) {
                this.localError = '进行中的旅程不接受续写、重生成、滑动或冒充生成；这些操作会破坏已提交事实。';
                abort(true);
                this.#emit('generation-refused');
            }
            return;
        }
        const runtime = this.repository.loadRuntime();
        if (state.phase === 'generating' && runtime.operation?.stage === 'performing') {
            const turn = state.pendingTransaction;
            if (!turn || !sameIdentity(identity, this.localIdentity) || this.activeTransactionId !== turn.id) {
                await this.#markRecoverable('发现刷新后未完成的演出事务，请在面板中重试。');
                abort(true);
                return;
            }
            if (this.adapter.canPerformMainToolCalls()) {
                await this.#markRecoverable('当前普通生成启用了工具调用；宿主会在最终回复事件之后才判断工具递归，导演不能把它当作可原子提交的演出。请关闭工具调用后重试本轮。');
                abort(true);
                return;
            }
            if (this.adapter.nextAssistantMessageId() !== runtime.operation.expectedAssistantMessageId) {
                await this.#markRecoverable('等待演出时聊天出现了另一条消息；为防止并发或工具递归串入，本轮事务已冻结。');
                abort(true);
                return;
            }
            const prompts = this.#compileTurn(state, scenario, turn);
            this.adapter.setDirectorPrompts(prompts, identity);
            return;
        }
        if (state.phase !== 'playing') {
            if (state.phase !== 'ready') abort(true);
            return;
        }
        const action = this.adapter.latestUserAction();
        if (!action || action.messageId <= runtime.lastHandledUserMessageId) {
            this.adapter.clearDirectorPrompts();
            return;
        }
        if (runtime.operation && runtime.operation.stage !== 'dismissed') {
            abort(true);
            await this.#markRecoverable('上一轮导演事务尚未处理完，新的玩家行动没有被并发推进。');
            return;
        }
        const allowedMoves = listAvailableMoves(state, scenario);
        if (!allowedMoves.length) {
            abort(true);
            await this.#markRecoverable('当前场景没有可用的剧情动作；剧本图可能损坏。');
            return;
        }
        const txId = typeof this.deps.id === 'function' ? this.deps.id() : `tx_action_${Date.now().toString(36)}`;
        const understandingRuntime = {
            ...runtime,
            operation: operation({
                id: txId,
                kind: 'action',
                stage: 'understanding',
                baseRevision: state.revision,
                sourceMessageId: action.messageId,
                sourceText: action.text,
            }),
        };
        try {
            await this.repository.save(state, { expectedIdentity: identity, expectedRevision: state.revision, scenario, runtime: understandingRuntime });
            this.#assertMayContinue(identity, '行动理解准备');
            this.activeUnderstanding = { id: txId, identity: clone(identity) };
            if (this.adapter.canPerformMainToolCalls()) {
                throw new Error('当前普通生成启用了工具调用；宿主会在最终回复事件之后才判断工具递归，导演无法可靠提交。请关闭工具调用，点击重试并按提示原样重发行动。');
            }
            const prompt = buildActionDecisionPrompt({
                transactionId: txId,
                baseRevision: state.revision,
                playerAction: action.text,
                publicContext: publicContext(state, scenario),
                allowedMoves: allowedMoves.map(move => ({ id: move.id, label: move.label, description: move.description })),
                allowedAttributes: ATTRIBUTES,
            });
            const raw = await this.adapter.generateRawText(prompt, identity);
            const decision = parseAndValidateActionDecision(raw, {
                transactionId: txId,
                baseRevision: state.revision,
                allowedMoveIds: allowedMoves.map(move => move.id),
                allowedAttributeIds: ATTRIBUTES.map(item => item.id),
            });
            if (this.adapter.canPerformMainToolCalls()) {
                throw new Error('行动理解完成后检测到普通生成已启用工具调用；为防止未受导演约束的工具递归，本轮已冻结。请关闭工具调用后重试。');
            }
            const prepared = prepareActionTurn(state, scenario, decision, this.deps);
            await this.#persistPerforming(prepared.state, scenario, prepared.turn, identity, understandingRuntime);
        } catch (error) {
            abort(true);
            this.adapter.clearDirectorPrompts();
            if (!sameIdentity(this.adapter.currentChatIdentity(), identity)) {
                this.activeTransactionId = null;
                this.localError = '行动理解期间聊天已切换；原聊天保留恢复点，新聊天没有收到导演演出。';
                this.#emit('generation-left-chat');
                return;
            }
            await this.#markRecoverable(messageOf(error), { identity, state, scenario, runtime: understandingRuntime });
        } finally {
            if (this.activeUnderstanding?.id === txId) this.activeUnderstanding = null;
        }
    }

    async rollPendingCheck() {
        const identity = this.#requireSingle();
        await this.#adoptNativeBranchClone(identity);
        const { state, scenario } = this.#loadPair();
        if (!state?.public.pendingCheck) throw new Error('当前没有等待玩家公开投骰的判定。');
        const result = createCheckResult(state, scenario, { checkId: state.public.pendingCheck.id }, this.deps);
        const prepared = prepareCheckConsequence(state, scenario, result, this.deps);
        const runtime = {
            ...this.repository.loadRuntime(),
            operation: operation({ id: prepared.turn.id, kind: 'check_consequence', stage: 'performing', baseRevision: state.revision }),
        };
        await this.#persistPerforming(prepared.state, scenario, prepared.turn, identity, runtime);
        this.#requestAutomaticGeneration(identity);
    }

    async handleMessageReceived(messageId, type) {
        if (!this.#enabled() || this.adapter.chatKind() !== 'single') return;
        const identity = this.adapter.currentChatIdentity();
        const { state, scenario } = this.#loadPair();
        if (!state || state.phase !== 'generating' || !state.pendingTransaction) return;
        const runtime = this.repository.loadRuntime();
        const op = runtime.operation;
        if (!op || op.stage !== 'performing' || op.id !== state.pendingTransaction.id) return;
        if (!sameIdentity(identity, this.localIdentity) || this.activeTransactionId !== op.id) return;
        if (Number(messageId) !== op.expectedAssistantMessageId || type === 'tool') return;
        const message = this.adapter.messageAt(messageId);
        if (!message || message.is_user || message.is_system || this.adapter.isIntermediateToolMessage(message)) return;
        const status = this.adapter.generationStatus();
        if (status.streamingStopped) {
            await this.#markRecoverable('流式生成已经停止，未提交本轮剧情。');
            return;
        }
        try {
            const performance = validatePerformanceMessage(message.mes, { forbiddenPhrases: forbiddenPhrases(scenario, state.pendingTransaction) });
            const committed = commitTurn(state, scenario, state.pendingTransaction, { performance, deps: this.deps });
            const nextRuntime = {
                ...runtime,
                lastHandledUserMessageId: Math.max(runtime.lastHandledUserMessageId, op.sourceMessageId),
                operation: null,
            };
            await this.repository.save(committed, {
                expectedIdentity: identity,
                expectedRevision: state.revision,
                scenario,
                runtime: nextRuntime,
                persist: false,
            });
            this.activeTransactionId = null;
            this.localError = null;
            this.adapter.clearDirectorPrompts();
            this.#emit('turn-committed');
        } catch (error) {
            await this.#markRecoverable(`回复未通过提交校验：${messageOf(error)}`);
        }
    }

    async handleGenerationStopped() {
        if (!this.#enabled() || this.adapter.chatKind() !== 'single' || !this.activeTransactionId) return;
        const identity = this.adapter.currentChatIdentity();
        if (!sameIdentity(identity, this.localIdentity)) return;
        const { state } = this.#loadPair();
        const runtime = this.repository.loadRuntime();
        if (state?.phase !== 'generating'
            || state.pendingTransaction?.id !== this.activeTransactionId
            || runtime.operation?.stage !== 'performing'
            || runtime.operation.id !== this.activeTransactionId) return;
        await this.#markRecoverable('本次生成已停止；剧情与世界时间尚未重复提交。');
    }

    handleGenerationEnded() {
        const endedTransactionId = this.activeTransactionId;
        if (!endedTransactionId) return;
        setTimeout(async () => {
            if (this.activeTransactionId !== endedTransactionId) return;
            const { state } = this.#loadPair();
            if (state?.phase === 'generating' && state.pendingTransaction?.id === endedTransactionId) {
                await this.#markRecoverable('本次生成结束但没有得到可提交的完整角色回复。');
            }
        }, 0);
    }

    handleStreamToken() {
        if (!this.activeTransactionId || !sameIdentity(this.adapter.currentChatIdentity(), this.localIdentity)) {
            if (this.activeTransactionId) this.adapter.stopOwnedGeneration();
            return;
        }
        const runtime = this.repository.loadRuntime();
        const expected = runtime.operation?.expectedAssistantMessageId;
        const placeholder = expected === null || expected === undefined ? null : this.adapter.messageAt(expected);
        if (runtime.operation?.id !== this.activeTransactionId || !placeholder || placeholder.is_user || placeholder.is_system) {
            this.adapter.stopOwnedGeneration();
        }
    }

    async handleChatChanged() {
        const ownedGeneration = Boolean(this.activeTransactionId || this.activeUnderstanding);
        this.activeTransactionId = null;
        this.activeUnderstanding = null;
        if (ownedGeneration) this.adapter.stopOwnedGeneration();
        this.localIdentity = clone(this.adapter.currentChatIdentity());
        this.localError = null;
        this.adapter.clearDirectorPrompts();
        try {
            const adopted = await this.#adoptNativeBranchClone(this.localIdentity);
            this.#emit(adopted ? 'branch-adopted' : 'chat-changed');
        } catch (error) {
            this.localError = messageOf(error);
            this.#emit('branch-adoption-failed');
        }
    }

    async handleMessageMutation() {
        if (!this.#enabled()) return;
        this.adapter.clearDirectorPrompts();
        const { state } = this.#loadPair();
        if (state?.phase === 'generating') await this.#markRecoverable('生成期间聊天消息被编辑、删除或滑动；事务已冻结，等待恢复。');
    }

    async #markRecoverable(error, supplied = {}) {
        this.adapter.clearDirectorPrompts();
        this.activeTransactionId = null;
        this.localError = error;
        if (this.adapter.chatKind() !== 'single') {
            this.#emit('recoverable');
            return;
        }
        const identity = supplied.identity ?? this.adapter.currentChatIdentity();
        let state = supplied.state;
        let scenario = supplied.scenario;
        if (!state || !scenario) ({ state, scenario } = this.#loadPair());
        if (!state || !scenario) return;
        const currentRuntime = supplied.runtime ?? this.repository.loadRuntime();
        const pending = state.pendingTransaction;
        const previous = currentRuntime.operation;
        const nextRuntime = {
            ...currentRuntime,
            operation: operation({
                id: pending?.id ?? previous?.id ?? `tx_error_${Date.now().toString(36)}`,
                kind: pending?.kind ?? previous?.kind ?? 'action',
                stage: 'recoverable',
                baseRevision: pending?.baseRevision ?? previous?.baseRevision ?? state.revision,
                sourceMessageId: previous?.sourceMessageId ?? -1,
                sourceText: previous?.sourceText ?? '',
                expectedAssistantMessageId: previous?.expectedAssistantMessageId ?? null,
                error: String(error).slice(0, 600),
            }),
        };
        try {
            await this.repository.save(state, { expectedIdentity: identity, expectedRevision: state.revision, scenario, runtime: nextRuntime });
        } finally {
            this.#emit('recoverable');
        }
    }

    async retryPending() {
        const identity = this.#requireSingle();
        await this.#adoptNativeBranchClone(identity);
        const { state, scenario } = this.#loadPair();
        const runtime = this.repository.loadRuntime();
        const orphanedPerforming = state.phase === 'generating'
            && runtime.operation?.stage === 'performing'
            && state.pendingTransaction?.id === runtime.operation.id
            && this.activeTransactionId !== runtime.operation.id;
        const orphanedUnderstanding = state.phase === 'playing'
            && runtime.operation?.stage === 'understanding'
            && this.activeUnderstanding?.id !== runtime.operation.id;
        if (runtime.operation?.stage !== 'recoverable' && !orphanedPerforming && !orphanedUnderstanding) throw new Error('当前没有可重试的导演事务。');
        if (state.phase === 'generating' && state.pendingTransaction) {
            const nextRuntime = { ...runtime, operation: { ...runtime.operation, stage: 'performing', error: null, expectedAssistantMessageId: this.adapter.nextAssistantMessageId() } };
            await this.repository.save(state, { expectedIdentity: identity, expectedRevision: state.revision, scenario, runtime: nextRuntime });
            this.adapter.setDirectorPrompts(this.#compileTurn(state, scenario, state.pendingTransaction), identity);
            this.activeTransactionId = state.pendingTransaction.id;
            this.localIdentity = clone(identity);
            this.#emit('retrying');
            this.#requestAutomaticGeneration(identity);
            return;
        }
        if (runtime.operation.kind === 'action' && runtime.operation.sourceText) {
            const cleared = { ...runtime, operation: null, lastHandledUserMessageId: Math.min(runtime.lastHandledUserMessageId, runtime.operation.sourceMessageId - 1) };
            await this.repository.save(state, { expectedIdentity: identity, expectedRevision: state.revision, scenario, runtime: cleared });
            this.localError = null;
            this.#emit('retry-ready');
            throw new Error('行动理解失败发生在主演出之前。请原样再次发送该行动；系统不会推进两次。');
        }
        throw new Error('这个恢复点缺少可重试的已准备事务。');
    }

    async cancelPending() {
        const identity = this.#requireSingle();
        await this.#adoptNativeBranchClone(identity);
        const { state, scenario } = this.#loadPair();
        const runtime = this.repository.loadRuntime();
        const orphanedPerforming = state.phase === 'generating'
            && runtime.operation?.stage === 'performing'
            && state.pendingTransaction?.id === runtime.operation.id
            && this.activeTransactionId !== runtime.operation.id;
        const orphanedUnderstanding = state.phase === 'playing'
            && runtime.operation?.stage === 'understanding'
            && this.activeUnderstanding?.id !== runtime.operation.id;
        if (runtime.operation?.stage !== 'recoverable' && !orphanedPerforming && !orphanedUnderstanding) throw new Error('当前没有可放弃的事务。');
        if (state.pendingTransaction?.kind === 'check_consequence') throw new Error('骰果已经公开，不能放弃或重投；只能重试演出后果。');
        const recovered = state.phase === 'generating' ? recoverPendingState(state) : state;
        const nextRuntime = {
            ...runtime,
            lastHandledUserMessageId: Math.max(runtime.lastHandledUserMessageId, runtime.operation.sourceMessageId),
            operation: null,
        };
        await this.repository.save(recovered, { expectedIdentity: identity, expectedRevision: state.revision, scenario, runtime: nextRuntime });
        this.localError = null;
        this.#emit('pending-cancelled');
    }

    async endCampaign() {
        const identity = this.#requireSingle();
        await this.#adoptNativeBranchClone(identity);
        const { state } = this.#loadPair();
        if (!state) throw new Error('当前聊天没有旅程。');
        if (state.phase === 'generating') throw new Error('请先恢复或放弃当前生成事务，再结束旅程。');
        await this.repository.clear({ expectedIdentity: identity });
        this.adapter.clearDirectorPrompts();
        this.#emit('campaign-ended');
    }

    async importScenario(payload) {
        const scenario = importScenarioPackage(payload);
        this.#registerScenario(scenario);
        const settings = this.adapter.getSettings();
        const imported = (settings.importedScenarios ?? []).filter(item => item.id !== scenario.id);
        this.adapter.saveSettings({ ...settings, importedScenarios: [...imported, clone(scenario)] });
        this.#emit('scenario-imported');
        return publicScenario(scenario);
    }

    async writeCustomScenario(brief) {
        const identity = this.#requireSingle();
        const { state } = this.#loadPair();
        if (state?.phase === 'generating' || this.activeTransactionId || this.activeUnderstanding) {
            throw new Error('当前旅程仍在生成中；请等待这一轮结束后再编写新剧本。');
        }
        if (this.adapter.generationStatus?.().active) {
            throw new Error('当前连接正在生成；请等待这一轮结束后再编写新剧本。');
        }
        const raw = await this.adapter.generateRawText(buildCustomScenarioPrompt(brief), identity, { responseLength: 8_000 });
        this.#assertMayContinue(identity, '剧本编写');
        const scenario = parseAndFinalizeCustomScenario(raw);
        this.#registerScenario(scenario);
        const settings = this.adapter.getSettings();
        const imported = (settings.importedScenarios ?? []).filter(item => item.id !== scenario.id);
        this.adapter.saveSettings({ ...settings, importedScenarios: [...imported, clone(scenario)] });
        this.#emit('scenario-written');
        return publicScenario(scenario);
    }

    async writeScenarioFromWorldInfo(input) {
        const identity = this.#requireSingle();
        const { state } = this.#loadPair();
        if (state?.phase === 'generating' || this.activeTransactionId || this.activeUnderstanding || this.adapter.generationStatus?.().active) {
            throw new Error('当前连接仍在生成中；请等待这一轮结束后再编写新剧本。');
        }
        const request = assertWorldInfoScenarioRequest(input);
        const scanSeed = compileWorldInfoScanSeed([request.title, request.outcome, request.anchors].filter(Boolean));
        const nativeWorldInfo = await this.adapter.collectNativeWorldInfo(scanSeed, identity);
        this.#assertMayContinue(identity, '世界书扫描');
        const raw = await this.adapter.generateRawText(buildWorldInfoScenarioPrompt(request, nativeWorldInfo), identity, { responseLength: 8_000 });
        this.#assertMayContinue(identity, '剧本编写');
        const scenario = parseAndFinalizeCustomScenario(raw);
        this.#registerScenario(scenario);
        const settings = this.adapter.getSettings();
        const imported = (settings.importedScenarios ?? []).filter(item => item.id !== scenario.id);
        this.adapter.saveSettings({ ...settings, importedScenarios: [...imported, clone(scenario)] });
        this.#emit('world-info-scenario-written');
        return publicScenario(scenario);
    }

    async importSave(payload) {
        const identity = this.#requireSingle();
        await this.#adoptNativeBranchClone(identity);
        const current = this.repository.load();
        if (current?.phase === 'generating') throw new Error('当前聊天有未完成的生成事务；先恢复或放弃，再导入存档。');
        const { scenario, state } = importSavePackage(payload);
        if (!stateMatchesScenario(state, scenario)) throw new Error('存档与剧本快照不一致。');
        const latest = this.adapter.latestUserAction();
        await this.repository.save(state, { expectedIdentity: identity, scenario, runtime: createRuntimeState(latest?.messageId ?? -1) });
        this.#registerScenario(scenario);
        this.adapter.clearDirectorPrompts();
        this.#emit('save-imported');
    }

    async exportSave() {
        const identity = this.#requireSingle();
        await this.#adoptNativeBranchClone(identity);
        const { state, scenario } = this.#loadPair();
        if (!state) throw new Error('当前聊天没有可导出的旅程。');
        return exportSavePackage(scenario, state);
    }
}
