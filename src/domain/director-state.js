import { assertScenario } from './scenario-schema.js';

export const DIRECTOR_STATE_SCHEMA = 'candy-w-rpg-director/state/v2';
export const DIRECTOR_STATE_VERSION = 2;
export const DIRECTOR_PHASES = Object.freeze(['ready', 'generating', 'playing', 'awaiting_check', 'ended']);

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const exact = (value, keys) => record(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => own(value, key));
const id = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,119}$/u.test(value);
const text = (value, max = 2000, allowEmpty = true) => typeof value === 'string'
    && value.length <= max
    && (allowEmpty || value.trim().length > 0);
const idList = (value, max = 512) => Array.isArray(value)
    && value.length <= max
    && value.every(id)
    && new Set(value).size === value.length;
const textList = (value, maxItems = 128, maxChars = 800) => Array.isArray(value)
    && value.length <= maxItems
    && value.every(item => text(item, maxChars, false));
const scalar = value => value === null || typeof value === 'boolean'
    || typeof value === 'string' && value.length <= 240
    || Number.isSafeInteger(value) && Math.abs(value) <= 1_000_000;
const scalarMap = value => record(value)
    && Object.keys(value).length <= 128
    && Object.entries(value).every(([key, item]) => id(key) && scalar(item));

function unique(values) {
    return [...new Set(values)];
}

function clone(value) {
    return structuredClone(value);
}

function dependency(deps, key, fallback) {
    return typeof deps?.[key] === 'function' ? deps[key] : fallback;
}

function now(deps) {
    const value = dependency(deps, 'now', () => new Date().toISOString())();
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) throw new Error('导演时钟返回了无效时间。');
    return value;
}

let idSequence = 0;
function transactionId(deps) {
    const value = dependency(deps, 'id', () => `tx_${Date.now().toString(36)}_${(idSequence += 1).toString(36)}`)();
    if (!id(value)) throw new Error('事务 id 不符合 v2 标识格式。');
    return value;
}

function sceneById(scenario, sceneId) {
    const scene = scenario.scenes.find(item => item.id === sceneId);
    if (!scene) throw new Error(`剧本缺少场景 ${sceneId}。`);
    return scene;
}

function actForScene(scenario, scene) {
    return scenario.acts.find(act => act.id === scene.actId);
}

function moveById(scenario, moveId) {
    const move = scenario.scenes.flatMap(scene => scene.moves).find(item => item.id === moveId);
    if (!move) throw new Error(`剧本缺少动作 ${moveId}。`);
    return move;
}

function checkById(scenario, checkId) {
    const check = scenario.checks.find(item => item.id === checkId);
    if (!check) throw new Error(`剧本缺少判定 ${checkId}。`);
    return check;
}

function endingById(scenario, endingId) {
    const ending = scenario.endings.find(item => item.id === endingId);
    if (!ending) throw new Error(`剧本缺少结局 ${endingId}。`);
    return ending;
}

function validPlayer(value) {
    return exact(value, ['name', 'concept', 'relationship', 'attributes'])
        && text(value.name, 120, false)
        && text(value.concept, 600)
        && text(value.relationship, 400)
        && exact(value.attributes, ['body', 'insight', 'rapport'])
        && Object.values(value.attributes).every(item => Number.isSafeInteger(item) && item >= 0 && item <= 2)
        && [...Object.values(value.attributes)].sort((a, b) => a - b).join(',') === '0,1,2';
}

function validPublicCheck(value) {
    if (value === null) return true;
    if (!exact(value, ['id', 'status', 'reason', 'attribute', 'formula', 'difficulty', 'successStakes', 'failureStakes', 'roll'])) return false;
    if (!id(value.id) || !['required', 'resolved'].includes(value.status) || !text(value.reason, 360, false)) return false;
    if (!['body', 'insight', 'rapport'].includes(value.attribute) || !text(value.formula, 40, false)) return false;
    if (!Number.isSafeInteger(value.difficulty) || value.difficulty < 2 || value.difficulty > 40) return false;
    if (!text(value.successStakes, 500, false) || !text(value.failureStakes, 500, false)) return false;
    if (value.status === 'required') return value.roll === null;
    const sides = Number(value.formula.slice(1));
    return exact(value.roll, ['dice', 'modifier', 'total', 'outcome'])
        && Array.isArray(value.roll.dice)
        && value.roll.dice.length === 1
        && Number.isSafeInteger(value.roll.dice[0])
        && value.roll.dice[0] >= 1
        && value.roll.dice[0] <= sides
        && Number.isSafeInteger(value.roll.modifier)
        && Number.isSafeInteger(value.roll.total)
        && value.roll.total === value.roll.dice[0] + value.roll.modifier
        && ['success', 'failure'].includes(value.roll.outcome)
        && value.roll.outcome === (value.roll.total >= value.difficulty ? 'success' : 'failure');
}

function validPublic(value) {
    return exact(value, ['scene', 'act', 'objective', 'knownPeopleIds', 'knownClueIds', 'itemIds', 'crisisIds', 'perceptibleClock', 'pendingCheck', 'lastCheck'])
        && exact(value.scene, ['id', 'title', 'description', 'location', 'timeLabel'])
        && id(value.scene.id)
        && ['title', 'description', 'location', 'timeLabel'].every(key => text(value.scene[key], 1000))
        && exact(value.act, ['id', 'number', 'title', 'summary'])
        && id(value.act.id)
        && Number.isSafeInteger(value.act.number)
        && text(value.act.title, 120)
        && text(value.act.summary, 600)
        && text(value.objective, 600)
        && idList(value.knownPeopleIds)
        && idList(value.knownClueIds)
        && idList(value.itemIds)
        && idList(value.crisisIds)
        && exact(value.perceptibleClock, ['label', 'minute', 'endMinute', 'firedWarnings'])
        && text(value.perceptibleClock.label, 120)
        && Number.isSafeInteger(value.perceptibleClock.minute)
        && Number.isSafeInteger(value.perceptibleClock.endMinute)
        && textList(value.perceptibleClock.firedWarnings, 32, 400)
        && validPublicCheck(value.pendingCheck)
        && validPublicCheck(value.lastCheck);
}

function validHidden(value) {
    return exact(value, ['currentSceneId', 'occurredFacts', 'revealedSecretIds', 'variables', 'npcAgenda', 'clock', 'visitedSceneIds', 'endingId'])
        && id(value.currentSceneId)
        && idList(value.occurredFacts)
        && idList(value.revealedSecretIds)
        && scalarMap(value.variables)
        && Array.isArray(value.npcAgenda)
        && value.npcAgenda.length <= 128
        && value.npcAgenda.every(item => exact(item, ['npcId', 'thresholdId', 'action', 'factId']) && id(item.npcId) && id(item.thresholdId) && text(item.action, 500, false) && id(item.factId))
        && new Set(value.npcAgenda.map(item => `${item.npcId}\u0000${item.thresholdId}`)).size === value.npcAgenda.length
        && exact(value.clock, ['minute', 'firedThresholdIds'])
        && Number.isSafeInteger(value.clock.minute)
        && idList(value.clock.firedThresholdIds)
        && idList(value.visitedSceneIds)
        && (value.endingId === null || id(value.endingId));
}

function validTurnPublicPatch(value) {
    return exact(value, ['objective', 'knownPeopleIds', 'knownClueIds', 'itemIds', 'crisisIds'])
        && (value.objective === null || text(value.objective, 600, false))
        && idList(value.knownPeopleIds)
        && idList(value.knownClueIds)
        && idList(value.itemIds)
        && idList(value.crisisIds);
}

function validTurnHiddenPatch(value) {
    return exact(value, ['occurredFactIds', 'revealedSecretIds', 'setVariables'])
        && idList(value.occurredFactIds)
        && idList(value.revealedSecretIds)
        && scalarMap(value.setVariables);
}

function validTurn(value) {
    return exact(value, ['protocol', 'version', 'id', 'kind', 'baseRevision', 'sceneId', 'moveId', 'clockAdvance', 'decision', 'createdAt'])
        && value.protocol === 'candy-w-rpg-director/prepared-turn/v2'
        && value.version === 2
        && id(value.id)
        && ['opening', 'action', 'check_consequence'].includes(value.kind)
        && Number.isSafeInteger(value.baseRevision)
        && value.baseRevision >= 0
        && id(value.sceneId)
        && (value.moveId === null || id(value.moveId))
        && Number.isSafeInteger(value.clockAdvance)
        && value.clockAdvance >= 0
        && exact(value.decision, ['mustHappen', 'forbiddenReveal', 'scanSeeds', 'publicPatch', 'hiddenPatch', 'nextSceneId', 'check', 'endingId'])
        && textList(value.decision.mustHappen, 32, 600)
        && value.decision.mustHappen.length > 0
        && idList(value.decision.forbiddenReveal)
        && textList(value.decision.scanSeeds, 48, 120)
        && validTurnPublicPatch(value.decision.publicPatch)
        && validTurnHiddenPatch(value.decision.hiddenPatch)
        && (value.decision.nextSceneId === null || id(value.decision.nextSceneId))
        && validPublicCheck(value.decision.check)
        && (value.decision.endingId === null || id(value.decision.endingId))
        && typeof value.createdAt === 'string'
        && !Number.isNaN(Date.parse(value.createdAt));
}

function validHistory(value) {
    return Array.isArray(value)
        && value.length <= 512
        && value.every(entry => exact(entry, ['revision', 'transactionId', 'kind', 'sceneId', 'moveId', 'clockMinute', 'performance', 'createdAt'])
            && Number.isSafeInteger(entry.revision)
            && id(entry.transactionId)
            && ['opening', 'action', 'check_consequence'].includes(entry.kind)
            && id(entry.sceneId)
            && (entry.moveId === null || id(entry.moveId))
            && Number.isSafeInteger(entry.clockMinute)
            && text(entry.performance, 20_000, false)
            && typeof entry.createdAt === 'string'
            && !Number.isNaN(Date.parse(entry.createdAt)));
}

function knownIdSets(scenario) {
    return {
        people: new Set(scenario.knowledge.people.map(item => item.id)),
        clues: new Set(scenario.knowledge.clues.map(item => item.id)),
        items: new Set(scenario.knowledge.items.map(item => item.id)),
        crises: new Set(scenario.knowledge.crises.map(item => item.id)),
    };
}

export function stateMatchesScenario(value, inputScenario) {
    if (!validateDirectorState(value)) return false;
    try {
        const scenario = assertScenario(inputScenario);
        if (value.scenario.id !== scenario.id || value.scenario.version !== scenario.version || value.scenario.hash !== scenario.hash) return false;
        if (!scenario.scenes.some(scene => scene.id === value.hidden.currentSceneId)) return false;
        if (!scenario.scenes.some(scene => scene.id === value.public.scene.id)) return false;
        if (value.hidden.endingId !== null && !scenario.endings.some(ending => ending.id === value.hidden.endingId)) return false;
        const sets = knownIdSets(scenario);
        const sceneIds = new Set(scenario.scenes.map(scene => scene.id));
        const actIds = new Set(scenario.acts.map(act => act.id));
        const secretIds = new Set(scenario.secrets.map(secret => secret.id));
        const thresholdIds = new Set(scenario.clocks[0].thresholds.map(threshold => threshold.id));
        const npcIds = new Set(scenario.npcs.map(npc => npc.id));
        if (!sceneIds.has(value.public.scene.id) || !actIds.has(value.public.act.id)) return false;
        if (!value.hidden.visitedSceneIds.every(sceneId => sceneIds.has(sceneId))) return false;
        if (!value.hidden.revealedSecretIds.every(secretId => secretIds.has(secretId))) return false;
        if (!value.hidden.clock.firedThresholdIds.every(thresholdId => thresholdIds.has(thresholdId))) return false;
        if (!value.hidden.npcAgenda.every(item => npcIds.has(item.npcId) && thresholdIds.has(item.thresholdId))) return false;
        if (!value.public.knownPeopleIds.every(item => sets.people.has(item))) return false;
        if (!value.public.knownClueIds.every(item => sets.clues.has(item))) return false;
        if (!value.public.itemIds.every(item => sets.items.has(item))) return false;
        if (!value.public.crisisIds.every(item => sets.crises.has(item))) return false;
        if (value.public.pendingCheck && !scenario.checks.some(check => check.id === value.public.pendingCheck.id)) return false;
        if (value.public.lastCheck && !scenario.checks.some(check => check.id === value.public.lastCheck.id)) return false;
        if (value.pendingTransaction) {
            const moveIds = new Set(scenario.scenes.flatMap(scene => scene.moves.map(move => move.id)));
            if (value.pendingTransaction.moveId !== null && !moveIds.has(value.pendingTransaction.moveId)) return false;
            if (value.pendingTransaction.decision.nextSceneId !== null && !scenario.scenes.some(scene => scene.id === value.pendingTransaction.decision.nextSceneId)) return false;
            if (value.pendingTransaction.decision.endingId !== null && !scenario.endings.some(ending => ending.id === value.pendingTransaction.decision.endingId)) return false;
            if (!value.pendingTransaction.decision.forbiddenReveal.every(secretId => secretIds.has(secretId))) return false;
            if (!value.pendingTransaction.decision.hiddenPatch.revealedSecretIds.every(secretId => secretIds.has(secretId))) return false;
            if (value.pendingTransaction.decision.check && !scenario.checks.some(check => check.id === value.pendingTransaction.decision.check.id)) return false;
        }
        return true;
    } catch {
        return false;
    }
}

export function validateDirectorState(value) {
    try {
        if (!exact(value, ['schema', 'version', 'revision', 'scenario', 'phase', 'pendingTransaction', 'player', 'public', 'hidden', 'history'])) return false;
        if (value.schema !== DIRECTOR_STATE_SCHEMA || value.version !== DIRECTOR_STATE_VERSION) return false;
        if (!Number.isSafeInteger(value.revision) || value.revision < 0) return false;
        if (!exact(value.scenario, ['id', 'version', 'hash']) || !id(value.scenario.id) || value.scenario.version !== 2 || !/^fnv1a64:[0-9a-f]{16}$/u.test(value.scenario.hash)) return false;
        if (!DIRECTOR_PHASES.includes(value.phase)) return false;
        if (!(value.pendingTransaction === null || validTurn(value.pendingTransaction))) return false;
        if ((value.phase === 'generating') !== (value.pendingTransaction !== null)) return false;
        if (!validPlayer(value.player) || !validPublic(value.public) || !validHidden(value.hidden) || !validHistory(value.history)) return false;
        if (value.phase === 'awaiting_check' && value.public.pendingCheck?.status !== 'required') return false;
        if (value.phase !== 'awaiting_check' && value.public.pendingCheck !== null) return false;
        if ((value.phase === 'ended') !== (value.hidden.endingId !== null)) return false;
        return true;
    } catch {
        return false;
    }
}

function assertState(value) {
    if (!validateDirectorState(value)) throw new Error('导演状态未通过 Candy W v2 严格校验。');
    return value;
}

function sceneProjection(scenario, scene) {
    return { id: scene.id, title: scene.title, description: scene.description, location: scene.location, timeLabel: scene.timeLabel };
}

function actProjection(scenario, scene) {
    const act = actForScene(scenario, scene);
    return { id: act.id, number: act.number, title: act.title, summary: act.summary };
}

function publicClock(scenario, minute, firedThresholdIds = []) {
    const clock = scenario.clocks[0];
    const fired = new Set(firedThresholdIds);
    return {
        label: clock.label,
        minute,
        endMinute: clock.endMinute,
        firedWarnings: clock.thresholds.filter(item => fired.has(item.id)).map(item => item.publicWarning),
    };
}

export function createDirectorState(inputScenario, player, deps = {}) {
    const scenario = assertScenario(inputScenario);
    if (!validPlayer(player)) throw new Error('玩家设定必须包含称呼、设定、关系与唯一分配的 +2/+1/+0 属性。');
    const scene = sceneById(scenario, scenario.startSceneId);
    const clock = scenario.clocks[0];
    const state = {
        schema: DIRECTOR_STATE_SCHEMA,
        version: DIRECTOR_STATE_VERSION,
        revision: 0,
        scenario: { id: scenario.id, version: scenario.version, hash: scenario.hash },
        phase: 'ready',
        pendingTransaction: null,
        player: clone(player),
        public: {
            scene: sceneProjection(scenario, scene),
            act: actProjection(scenario, scene),
            objective: scene.objective,
            knownPeopleIds: [],
            knownClueIds: [],
            itemIds: [],
            crisisIds: ['crisis_tide'],
            perceptibleClock: publicClock(scenario, clock.startMinute),
            pendingCheck: null,
            lastCheck: null,
        },
        hidden: {
            currentSceneId: scene.id,
            occurredFacts: [...scene.entryFacts],
            revealedSecretIds: [],
            variables: {},
            npcAgenda: [],
            clock: { minute: clock.startMinute, firedThresholdIds: [] },
            visitedSceneIds: [scene.id],
            endingId: null,
        },
        history: [],
    };
    void deps;
    return assertState(state);
}

function conditionsMet(state, conditions) {
    const facts = new Set(state.hidden.occurredFacts);
    return conditions.allFacts.every(item => facts.has(item))
        && (conditions.anyFacts.length === 0 || conditions.anyFacts.some(item => facts.has(item)))
        && conditions.notFacts.every(item => !facts.has(item));
}

export function listAvailableMoves(inputState, inputScenario) {
    const state = assertState(clone(inputState));
    const scenario = assertScenario(inputScenario);
    if (!['playing'].includes(state.phase)) return [];
    const scene = sceneById(scenario, state.hidden.currentSceneId);
    const outcomeMoveIds = new Set(scenario.checks.flatMap(check => [check.successMoveId, check.failureMoveId]));
    return scene.moves
        .filter(move => !outcomeMoveIds.has(move.id) && conditionsMet(state, move.conditions))
        .map(move => Object.freeze({
            id: move.id,
            label: move.label,
            description: move.description,
            allowedAttribute: move.attribute,
            requiresCheck: move.checkId !== null,
        }));
}

function publicPatchFromMove(move) {
    return {
        objective: move.publicPatch.objective,
        knownPeopleIds: [...move.publicPatch.knownPeopleIds],
        knownClueIds: [...move.publicPatch.knownClueIds],
        itemIds: [...move.publicPatch.itemIds],
        crisisIds: [...move.publicPatch.crisisIds],
    };
}

function hiddenPatchFromMove(move) {
    return {
        occurredFactIds: [...move.hiddenPatch.occurredFactIds],
        revealedSecretIds: [...move.revealSecretIds],
        setVariables: clone(move.hiddenPatch.setVariables),
    };
}

function checkProjection(check, status = 'required', roll = null) {
    return {
        id: check.id,
        status,
        reason: check.reason,
        attribute: check.attribute,
        formula: check.formula,
        difficulty: check.difficulty,
        successStakes: check.successStakes,
        failureStakes: check.failureStakes,
        roll,
    };
}

function scanSeedsFor(scenario, state, move, nextSceneId) {
    const current = sceneById(scenario, state.hidden.currentSceneId);
    const next = nextSceneId ? sceneById(scenario, nextSceneId) : null;
    const people = scenario.knowledge.people.filter(item => move.publicPatch.knownPeopleIds.includes(item.id)).flatMap(item => item.anchors);
    const clues = scenario.knowledge.clues.filter(item => move.publicPatch.knownClueIds.includes(item.id)).flatMap(item => item.anchors);
    const items = scenario.knowledge.items.filter(item => move.publicPatch.itemIds.includes(item.id)).flatMap(item => item.anchors);
    const crises = scenario.knowledge.crises.filter(item => move.publicPatch.crisisIds.includes(item.id)).flatMap(item => item.anchors);
    return unique([...(next ?? current).anchors, ...people, ...clues, ...items, ...crises]);
}

function pendingClockWarnings(scenario, state, advance, reachesEnding) {
    const clock = scenario.clocks[0];
    const destination = reachesEnding
        ? clock.endMinute
        : Math.min(clock.endMinute, state.hidden.clock.minute + advance);
    const alreadyFired = new Set(state.hidden.clock.firedThresholdIds);
    return clock.thresholds
        .filter(threshold => threshold.minute <= destination && !alreadyFired.has(threshold.id))
        .map(threshold => `世界时钟事件必须在本轮发生并可被玩家感知：${threshold.publicWarning}`);
}

function prepare(state, scenario, { kind, move = null, mustHappen, check = null, preparedId = null, deps = {} }) {
    assertState(state);
    if (state.phase === 'generating' || state.phase === 'awaiting_check' || state.phase === 'ended') throw new Error('当前导演阶段不能准备新的演出。');
    const nextSceneId = move?.nextSceneId ?? null;
    const clockWarnings = pendingClockWarnings(scenario, state, move?.clockAdvance ?? 0, Boolean(move?.endingId));
    const requiredEvents = [...mustHappen, ...clockWarnings];
    if (requiredEvents.length > 32) throw new Error('本轮强制剧情事件超过协议上限，剧本必须缩短单轮跨越。');
    const turn = {
        protocol: 'candy-w-rpg-director/prepared-turn/v2',
        version: 2,
        id: preparedId ?? transactionId(deps),
        kind,
        baseRevision: state.revision,
        sceneId: state.hidden.currentSceneId,
        moveId: move?.id ?? null,
        clockAdvance: move?.clockAdvance ?? 0,
        decision: {
            mustHappen: requiredEvents,
            forbiddenReveal: scenario.secrets.filter(secret => !state.hidden.revealedSecretIds.includes(secret.id) && !(move?.revealSecretIds ?? []).includes(secret.id)).map(secret => secret.id),
            scanSeeds: move ? scanSeedsFor(scenario, state, move, nextSceneId) : [...sceneById(scenario, state.hidden.currentSceneId).anchors],
            publicPatch: move ? publicPatchFromMove(move) : { objective: null, knownPeopleIds: [], knownClueIds: [], itemIds: [], crisisIds: [] },
            hiddenPatch: move ? hiddenPatchFromMove(move) : { occurredFactIds: [], revealedSecretIds: [], setVariables: {} },
            nextSceneId,
            check,
            endingId: move?.endingId ?? null,
        },
        createdAt: now(deps),
    };
    const generating = clone(state);
    generating.phase = 'generating';
    generating.pendingTransaction = clone(turn);
    return { state: assertState(generating), turn: clone(turn) };
}

export function prepareOpeningTurn(inputState, inputScenario, deps = {}) {
    const state = assertState(clone(inputState));
    const scenario = assertScenario(inputScenario);
    if (state.phase !== 'ready') throw new Error('只有尚未开场的旅程可以进入世界。');
    const scene = sceneById(scenario, state.hidden.currentSceneId);
    return prepare(state, scenario, {
        kind: 'opening',
        mustHappen: [
            `从${scene.timeLabel}的${scene.location}开始：${scene.description}`,
            `让玩家自然得知当前目标：${scene.objective}`,
            '场景结尾把行动权明确交还玩家；不要列出动作菜单。',
        ],
        deps,
    });
}

export function prepareActionTurn(inputState, inputScenario, classification, deps = {}) {
    const state = assertState(clone(inputState));
    const scenario = assertScenario(inputScenario);
    if (state.phase !== 'playing') throw new Error('当前旅程不能接受新的玩家行动。');
    if (!exact(classification, ['transactionId', 'baseRevision', 'actionId', 'attribute', 'summary'])) throw new Error('行动分类格式无效。');
    if (!id(classification.transactionId) || !id(classification.actionId) || !text(classification.summary, 280, false)) throw new Error('行动分类的事务、动作或摘要无效。');
    if (classification.attribute !== null && !['body', 'insight', 'rapport'].includes(classification.attribute)) throw new Error('行动分类属性无效。');
    if (classification.baseRevision !== state.revision) throw new Error('行动分类绑定了过期 revision。');
    const available = listAvailableMoves(state, scenario);
    const allowed = available.find(move => move.id === classification.actionId);
    if (!allowed) throw new Error('行动分类引用了当前不可用动作。');
    const move = moveById(scenario, classification.actionId);
    if (classification.attribute !== move.attribute) throw new Error('行动分类属性与剧本判定不一致。');
    const check = move.checkId ? checkProjection(checkById(scenario, move.checkId)) : null;
    return prepare(state, scenario, {
        kind: 'action',
        move,
        check,
        preparedId: classification.transactionId,
        mustHappen: [
            `玩家尝试：${classification.summary}`,
            ...move.mustHappen,
            ...(check ? ['只公开说明判定并停在结果发生前，不替玩家投骰。'] : []),
        ],
        deps,
    });
}

function rollDie(random, sides) {
    const value = Number(random());
    if (!Number.isFinite(value) || value < 0 || value >= 1) throw new Error('随机源必须返回 [0, 1) 的有限数。');
    return Math.floor(value * sides) + 1;
}

export function createCheckResult(inputState, inputScenario, input = {}, deps = {}) {
    const state = assertState(clone(inputState));
    const scenario = assertScenario(inputScenario);
    if (state.phase !== 'awaiting_check' || !state.public.pendingCheck) throw new Error('当前没有等待公开投骰的判定。');
    if (!exact(input, ['checkId'])) throw new Error('投骰输入只能包含 checkId。');
    const check = checkById(scenario, input.checkId);
    if (check.id !== state.public.pendingCheck.id) throw new Error('投骰不属于当前等待的判定。');
    const sides = Number(check.formula.slice(1));
    const die = rollDie(dependency(deps, 'random', Math.random), sides);
    const modifier = state.player.attributes[check.attribute];
    const total = die + modifier;
    const outcome = total >= check.difficulty ? 'success' : 'failure';
    return Object.freeze({
        checkId: check.id,
        dice: Object.freeze([die]),
        modifier,
        total,
        outcome,
        consequenceMoveId: outcome === 'success' ? check.successMoveId : check.failureMoveId,
    });
}

export function prepareCheckConsequence(inputState, inputScenario, result, deps = {}) {
    const state = assertState(clone(inputState));
    const scenario = assertScenario(inputScenario);
    if (state.phase !== 'awaiting_check' || !state.public.pendingCheck) throw new Error('当前没有可结算的公开判定。');
    if (!exact(result, ['checkId', 'dice', 'modifier', 'total', 'outcome', 'consequenceMoveId'])) throw new Error('判定结果格式无效。');
    if (result.checkId !== state.public.pendingCheck.id) throw new Error('判定结果不属于当前等待的公开判定。');
    const formulaSides = Number(state.public.pendingCheck.formula.slice(1));
    if (!Array.isArray(result.dice) || result.dice.length !== 1 || !Number.isSafeInteger(result.dice[0]) || result.dice[0] < 1 || result.dice[0] > formulaSides) throw new Error(`公开 ${state.public.pendingCheck.formula} 骰面超出公式范围。`);
    if (!Number.isSafeInteger(result.modifier) || !Number.isSafeInteger(result.total) || !['success', 'failure'].includes(result.outcome)) throw new Error('判定修正、总点或成败格式无效。');
    const check = checkById(scenario, result.checkId);
    const expectedMove = result.outcome === 'success' ? check.successMoveId : check.failureMoveId;
    if (result.consequenceMoveId !== expectedMove || result.total !== result.dice[0] + result.modifier || result.modifier !== state.player.attributes[check.attribute]) throw new Error('判定结果与当前属性或剧本分支不一致。');
    const expectedOutcome = result.total >= check.difficulty ? 'success' : 'failure';
    if (result.outcome !== expectedOutcome) throw new Error('判定成败与总点和难度不一致。');
    const move = moveById(scenario, result.consequenceMoveId);
    const resolved = checkProjection(check, 'resolved', { dice: [...result.dice], modifier: result.modifier, total: result.total, outcome: result.outcome });
    const mustHappen = [
        `公开骰果不可改写：${check.formula} 骰面 ${result.dice[0]}，${check.attribute} 修正 ${result.modifier >= 0 ? '+' : ''}${result.modifier}，总点 ${result.total}，难度 ${check.difficulty}，结果为${result.outcome === 'success' ? '成功' : '失败'}。`,
        ...move.mustHappen,
        ...pendingClockWarnings(scenario, state, move.clockAdvance, Boolean(move.endingId)),
    ];
    if (mustHappen.length > 32) throw new Error('本轮强制剧情事件超过协议上限，剧本必须缩短单轮跨越。');
    const turn = {
        protocol: 'candy-w-rpg-director/prepared-turn/v2',
        version: 2,
        id: transactionId(deps),
        kind: 'check_consequence',
        baseRevision: state.revision,
        sceneId: state.hidden.currentSceneId,
        moveId: move.id,
        clockAdvance: move.clockAdvance,
        decision: {
            mustHappen,
            forbiddenReveal: scenario.secrets.filter(secret => !state.hidden.revealedSecretIds.includes(secret.id) && !move.revealSecretIds.includes(secret.id)).map(secret => secret.id),
            scanSeeds: scanSeedsFor(scenario, state, move, move.nextSceneId),
            publicPatch: publicPatchFromMove(move),
            hiddenPatch: hiddenPatchFromMove(move),
            nextSceneId: move.nextSceneId,
            check: resolved,
            endingId: move.endingId,
        },
        createdAt: now(deps),
    };
    const generating = clone(state);
    generating.phase = 'generating';
    generating.public.pendingCheck = null;
    generating.public.lastCheck = resolved;
    generating.pendingTransaction = clone(turn);
    return { state: assertState(generating), turn: clone(turn) };
}

function applyClock(state, scenario, advance) {
    const clock = scenario.clocks[0];
    const nextMinute = Math.min(clock.endMinute, state.hidden.clock.minute + advance);
    const previousFired = new Set(state.hidden.clock.firedThresholdIds);
    const newlyFired = clock.thresholds.filter(threshold => threshold.minute <= nextMinute && !previousFired.has(threshold.id));
    state.hidden.clock.minute = nextMinute;
    state.hidden.clock.firedThresholdIds = unique([...state.hidden.clock.firedThresholdIds, ...newlyFired.map(item => item.id)]);
    state.hidden.occurredFacts = unique([...state.hidden.occurredFacts, ...newlyFired.map(item => item.factId)]);
    for (const threshold of newlyFired) Object.assign(state.hidden.variables, threshold.setVariables);
    for (const npc of scenario.npcs) {
        for (const agenda of npc.agenda.filter(item => newlyFired.some(threshold => threshold.id === item.thresholdId))) {
            state.hidden.npcAgenda.push({ npcId: npc.id, thresholdId: agenda.thresholdId, action: agenda.action, factId: agenda.factId });
            state.hidden.occurredFacts = unique([...state.hidden.occurredFacts, agenda.factId]);
        }
    }
    state.public.perceptibleClock = publicClock(scenario, nextMinute, state.hidden.clock.firedThresholdIds);
}

function mergePublic(state, patch) {
    if (patch.objective !== null) state.public.objective = patch.objective;
    state.public.knownPeopleIds = unique([...state.public.knownPeopleIds, ...patch.knownPeopleIds]);
    state.public.knownClueIds = unique([...state.public.knownClueIds, ...patch.knownClueIds]);
    state.public.itemIds = unique([...state.public.itemIds, ...patch.itemIds]);
    state.public.crisisIds = unique(patch.crisisIds);
}

export function commitPreparedTurn(inputState, inputTurn, { performance, deps = {} } = {}) {
    const state = assertState(clone(inputState));
    const turn = clone(inputTurn);
    if (state.phase !== 'generating' || !state.pendingTransaction || state.pendingTransaction.id !== turn.id) throw new Error('待提交事务与当前 pending 不匹配。');
    if (JSON.stringify(state.pendingTransaction) !== JSON.stringify(turn)) throw new Error('待提交事务内容与已保存 pending 不一致。');
    if (!validTurn(turn) || turn.baseRevision !== state.revision) throw new Error('待提交事务无效或绑定了过期 revision。');
    if (!text(performance, 20_000, false)) throw new Error('完整演出正文不能为空。');
    const next = clone(state);
    next.hidden.clock.minute += turn.clockAdvance;
    next.public.perceptibleClock.minute += turn.clockAdvance;
    mergePublic(next, turn.decision.publicPatch);
    next.hidden.occurredFacts = unique([...next.hidden.occurredFacts, ...turn.decision.hiddenPatch.occurredFactIds]);
    next.hidden.revealedSecretIds = unique([...next.hidden.revealedSecretIds, ...turn.decision.hiddenPatch.revealedSecretIds]);
    Object.assign(next.hidden.variables, turn.decision.hiddenPatch.setVariables);
    if (turn.decision.nextSceneId) {
        next.hidden.currentSceneId = turn.decision.nextSceneId;
        next.hidden.visitedSceneIds = unique([...next.hidden.visitedSceneIds, turn.decision.nextSceneId]);
    }
    if (turn.decision.check?.status === 'required') {
        next.public.pendingCheck = clone(turn.decision.check);
        next.phase = 'awaiting_check';
    } else if (turn.decision.endingId) {
        next.hidden.endingId = turn.decision.endingId;
        next.phase = 'ended';
    } else {
        next.phase = 'playing';
    }
    if (turn.decision.check?.status === 'resolved') next.public.lastCheck = clone(turn.decision.check);
    next.pendingTransaction = null;
    next.revision += 1;
    next.history.push({
        revision: next.revision,
        transactionId: turn.id,
        kind: turn.kind,
        sceneId: turn.sceneId,
        moveId: turn.moveId,
        clockMinute: next.hidden.clock.minute,
        performance: performance.trim(),
        createdAt: now(deps),
    });
    next.history = next.history.slice(-512);
    return assertState(next);
}

export function applyCommittedProjection(inputState, inputScenario) {
    const state = assertState(clone(inputState));
    const scenario = assertScenario(inputScenario);
    const scene = sceneById(scenario, state.hidden.currentSceneId);
    state.public.scene = sceneProjection(scenario, scene);
    state.public.act = actProjection(scenario, scene);
    if (!state.public.objective) state.public.objective = scene.objective;
    applyClock(state, scenario, 0);
    return assertState(state);
}

export function commitTurn(inputState, inputScenario, inputTurn, options) {
    const scenario = assertScenario(inputScenario);
    const before = inputState.hidden.clock.minute;
    const committed = commitPreparedTurn(inputState, inputTurn, options);
    const next = applyCommittedProjection(committed, scenario);
    const intended = inputTurn.decision.endingId
        ? scenario.clocks[0].endMinute
        : Math.min(scenario.clocks[0].endMinute, before + inputTurn.clockAdvance);
    next.hidden.clock.minute = before;
    next.public.perceptibleClock.minute = before;
    applyClock(next, scenario, intended - before);
    return assertState(next);
}

export function recoverPendingState(inputState) {
    const state = assertState(clone(inputState));
    if (state.phase !== 'generating') return state;
    if (state.pendingTransaction.kind === 'check_consequence') {
        // The public die is already a committed fact. There is no rollback to
        // awaiting_check and no second roll; recovery must retry this exact
        // prepared consequence transaction.
        return state;
    }
    const recovered = clone(state);
    const pending = recovered.pendingTransaction;
    recovered.pendingTransaction = null;
    recovered.phase = pending.kind === 'opening' ? 'ready' : 'playing';
    return assertState(recovered);
}

function knowledgeProjection(ids, values) {
    const wanted = new Set(ids);
    return values.filter(item => wanted.has(item.id)).map(clone);
}

export function projectPublicState(inputState, inputScenario) {
    const state = assertState(clone(inputState));
    const scenario = assertScenario(inputScenario);
    const scene = sceneById(scenario, state.hidden.currentSceneId);
    const act = actForScene(scenario, scene);
    const clock = scenario.clocks[0];
    const ending = state.hidden.endingId ? clone(endingById(scenario, state.hidden.endingId)) : null;
    return Object.freeze({
        phase: state.phase,
        revision: state.revision,
        player: clone(state.player),
        scene: clone(state.public.scene),
        chapter: { id: act.id, number: act.number, title: act.title, summary: act.summary },
        objectives: state.public.objective ? [{ id: 'current_objective', name: state.public.objective, detail: '' }] : [],
        characters: knowledgeProjection(state.public.knownPeopleIds, scenario.knowledge.people),
        clues: knowledgeProjection(state.public.knownClueIds, scenario.knowledge.clues),
        items: knowledgeProjection(state.public.itemIds, scenario.knowledge.items),
        crises: knowledgeProjection(state.public.crisisIds, scenario.knowledge.crises).map(item => ({ ...item, urgency: `${item.urgency} · ${clock.endMinute - state.hidden.clock.minute} 分钟内` })),
        pendingCheck: clone(state.public.pendingCheck),
        lastCheck: clone(state.public.lastCheck),
        ending,
    });
}

export function buildPublicPerformanceFacts(inputState, inputScenario) {
    const projected = projectPublicState(inputState, inputScenario);
    return [
        `当前场景：${projected.scene.title}；地点：${projected.scene.location}；时间：${projected.scene.timeLabel}。`,
        `玩家角色：${projected.player.name}；设定：${projected.player.concept || '未补充'}；与当前角色关系：${projected.player.relationship || '沿聊天历史发展'}。`,
        ...projected.objectives.map(item => `已知目标：${item.name}`),
        ...projected.characters.map(item => `已认识人物：${item.name}（${item.relation}）—${item.detail}`),
        ...projected.clues.map(item => `已知线索：${item.name}—${item.detail}`),
        ...projected.items.map(item => `已有物品：${item.name}—${item.detail}`),
        ...projected.crises.map(item => `可感知危机：${item.name}—${item.detail}（${item.urgency}）`),
    ];
}
