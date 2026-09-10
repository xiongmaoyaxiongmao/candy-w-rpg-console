import { validateScenario } from '../domain/scenario-schema.js';
import { validateDirectorState, stateMatchesScenario } from '../domain/director-state.js';
import { buildScenarioContextIndex, restoreArrivalFacts } from '../domain/scenario-context.js';
import { normalizeWorldEntries } from '../domain/authoring-context.js';

export function migrateDirectorSettings(input) {
    const next = structuredClone(input);
    if ((next.directorDataVersion ?? 0) > 3) throw new Error('导演设置来自更新版本，不能降级转换。');
    next.contextIndexes ??= {};
    for (const scenario of next.importedScenarios ?? []) {
        if (!validateScenario(scenario)) throw new Error('已有剧本未通过校验，升级没有修改它。');
        next.contextIndexes[scenario.hash] = buildScenarioContextIndex(scenario, next.contextIndexes[scenario.hash] ?? null);
    }
    for (const job of next.authoringJobs ?? []) job.source.worldFacts = normalizeWorldEntries(job.source.worldFacts);
    if (next.auxiliaryApis) for (const key of ['mainOutputMode', 'mainMaxOutputTokens', 'mainThinkingMode']) delete next.auxiliaryApis[key];
    next.directorDataVersion = 3;
    return next;
}
export function migrateChatEnvelope(envelope) {
    if (!validateScenario(envelope.scenario) || !validateDirectorState(envelope.state) || !stateMatchesScenario(envelope.state, envelope.scenario)) throw new Error('聊天固定剧本或状态不合格，升级保留原记录。');
    if (envelope.state.pendingTransaction || envelope.runtime.operation) throw new Error('聊天有未完成事务，需先完成或取消再迁移。');
    const next = structuredClone(envelope);
    next.state = restoreArrivalFacts(next.state, next.scenario);
    if (!validateDirectorState(next.state)) throw new Error('聊天迁移结果未通过校验。');
    return next;
}
