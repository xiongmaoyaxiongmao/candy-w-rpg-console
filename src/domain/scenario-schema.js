export const SCENARIO_SCHEMA = 'candy-w-rpg-director/scenario/v2';
export const SCENARIO_VERSION = 2;

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const exact = (value, keys) => record(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => own(value, key));
const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,79}$/u.test(value);
const text = (value, max = 2000, allowEmpty = false) => typeof value === 'string'
    && value.length <= max
    && (allowEmpty || value.trim().length > 0)
    && value === value.trim();
const stringList = (value, maxItems = 64, maxChars = 240) => Array.isArray(value)
    && value.length <= maxItems
    && value.every(item => text(item, maxChars));
const idList = (value, maxItems = 64) => Array.isArray(value)
    && value.length <= maxItems
    && value.every(identifier)
    && new Set(value).size === value.length;
const scalar = value => value === null || typeof value === 'boolean'
    || typeof value === 'string' && value.length <= 240
    || Number.isSafeInteger(value) && Math.abs(value) <= 1_000_000;
const scalarMap = value => record(value)
    && Object.keys(value).length <= 48
    && Object.entries(value).every(([key, item]) => identifier(key) && scalar(item));

function canonical(value) {
    if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
    if (record(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
    return JSON.stringify(value);
}

export function computeScenarioHash(value) {
    if (!record(value)) throw new TypeError('剧本必须是对象。');
    const clone = structuredClone(value);
    clone.hash = '';
    const source = canonical(clone);
    let hash = 0xcbf29ce484222325n;
    for (let index = 0; index < source.length; index += 1) {
        hash ^= BigInt(source.charCodeAt(index));
        hash = BigInt.asUintN(64, hash * 0x100000001b3n);
    }
    return `fnv1a64:${hash.toString(16).padStart(16, '0')}`;
}

function uniqueIds(values) {
    return Array.isArray(values)
        && values.every(value => identifier(value?.id))
        && new Set(values.map(value => value.id)).size === values.length;
}

function validPublic(value) {
    return exact(value, ['title', 'tagline', 'summary', 'tone', 'duration', 'symbol', 'tags'])
        && text(value.title, 120)
        && text(value.tagline, 240)
        && text(value.summary, 1200)
        && text(value.tone, 120)
        && text(value.duration, 120)
        && text(value.symbol, 16)
        && stringList(value.tags, 12, 40);
}

function validCoreFact(value) {
    return exact(value, ['id', 'text']) && identifier(value.id) && text(value.text, 600);
}

function validSecret(value) {
    return exact(value, ['id', 'title', 'fact', 'revealText', 'leakPhrases'])
        && identifier(value.id)
        && text(value.title, 120)
        && text(value.fact, 800)
        && text(value.revealText, 600)
        && stringList(value.leakPhrases, 12, 120);
}

function validAgenda(value) {
    return exact(value, ['thresholdId', 'action', 'factId'])
        && identifier(value.thresholdId)
        && text(value.action, 500)
        && identifier(value.factId);
}

function validNpc(value) {
    return exact(value, ['id', 'name', 'role', 'publicRelation', 'publicDescription', 'hiddenGoal', 'agenda'])
        && identifier(value.id)
        && text(value.name, 80)
        && text(value.role, 120)
        && text(value.publicRelation, 200)
        && text(value.publicDescription, 500)
        && text(value.hiddenGoal, 600)
        && Array.isArray(value.agenda)
        && value.agenda.length <= 24
        && value.agenda.every(validAgenda);
}

function validThreshold(value) {
    return exact(value, ['id', 'minute', 'publicWarning', 'hiddenEvent', 'factId', 'setVariables'])
        && identifier(value.id)
        && Number.isSafeInteger(value.minute)
        && value.minute >= 0
        && value.minute <= 10_000
        && text(value.publicWarning, 400)
        && text(value.hiddenEvent, 600)
        && identifier(value.factId)
        && scalarMap(value.setVariables);
}

function validClock(value) {
    return exact(value, ['id', 'label', 'startMinute', 'endMinute', 'thresholds'])
        && identifier(value.id)
        && text(value.label, 120)
        && Number.isSafeInteger(value.startMinute)
        && Number.isSafeInteger(value.endMinute)
        && value.startMinute >= 0
        && value.endMinute > value.startMinute
        && value.endMinute <= 10_000
        && Array.isArray(value.thresholds)
        && value.thresholds.length > 0
        && value.thresholds.length <= 32
        && uniqueIds(value.thresholds)
        && value.thresholds.every(validThreshold)
        && value.thresholds.every(item => item.minute > value.startMinute && item.minute <= value.endMinute)
        && value.thresholds.every((item, index) => index === 0 || item.minute > value.thresholds[index - 1].minute);
}

function validKnowledgeEntry(value, kind) {
    const keys = kind === 'person'
        ? ['id', 'name', 'relation', 'detail', 'status', 'anchors']
        : kind === 'crisis'
            ? ['id', 'name', 'detail', 'urgency', 'anchors']
            : ['id', 'name', 'detail', 'anchors'];
    return exact(value, keys)
        && identifier(value.id)
        && text(value.name, 100)
        && text(value.detail, 600)
        && (kind !== 'person' || text(value.relation, 240) && text(value.status, 240))
        && (kind !== 'crisis' || text(value.urgency, 120))
        && stringList(value.anchors, 12, 100);
}

function validKnowledge(value) {
    return exact(value, ['people', 'clues', 'items', 'crises'])
        && ['people', 'clues', 'items', 'crises'].every(key => Array.isArray(value[key]) && uniqueIds(value[key]))
        && value.people.every(item => validKnowledgeEntry(item, 'person'))
        && value.clues.every(item => validKnowledgeEntry(item, 'clue'))
        && value.items.every(item => validKnowledgeEntry(item, 'item'))
        && value.crises.every(item => validKnowledgeEntry(item, 'crisis'));
}

function validAct(value) {
    return exact(value, ['id', 'number', 'title', 'summary', 'sceneIds'])
        && identifier(value.id)
        && Number.isSafeInteger(value.number)
        && value.number > 0
        && text(value.title, 120)
        && text(value.summary, 600)
        && idList(value.sceneIds, 32)
        && value.sceneIds.length > 0;
}

function validConditions(value) {
    return exact(value, ['allFacts', 'anyFacts', 'notFacts'])
        && idList(value.allFacts)
        && idList(value.anyFacts)
        && idList(value.notFacts);
}

function validPublicPatch(value) {
    return exact(value, ['objective', 'knownPeopleIds', 'knownClueIds', 'itemIds', 'crisisIds'])
        && (value.objective === null || text(value.objective, 500))
        && idList(value.knownPeopleIds)
        && idList(value.knownClueIds)
        && idList(value.itemIds)
        && idList(value.crisisIds);
}

function validHiddenPatch(value) {
    return exact(value, ['occurredFactIds', 'setVariables'])
        && idList(value.occurredFactIds)
        && scalarMap(value.setVariables);
}

function validMove(value) {
    return exact(value, [
        'id', 'label', 'description', 'clockAdvance', 'attribute', 'checkId', 'conditions',
        'mustHappen', 'revealSecretIds', 'publicPatch', 'hiddenPatch', 'nextSceneId', 'endingId',
    ])
        && identifier(value.id)
        && text(value.label, 120)
        && text(value.description, 400)
        && Number.isSafeInteger(value.clockAdvance)
        && value.clockAdvance >= 0
        && value.clockAdvance <= 240
        && (value.attribute === null || ['body', 'insight', 'rapport'].includes(value.attribute))
        && (value.checkId === null || identifier(value.checkId))
        && validConditions(value.conditions)
        && stringList(value.mustHappen, 24, 600)
        && value.mustHappen.length > 0
        && idList(value.revealSecretIds)
        && validPublicPatch(value.publicPatch)
        && validHiddenPatch(value.hiddenPatch)
        && (value.nextSceneId === null || identifier(value.nextSceneId))
        && (value.endingId === null || identifier(value.endingId))
        && !(value.nextSceneId && value.endingId)
        && (value.checkId === null ? value.attribute === null : value.attribute !== null);
}

function validScene(value) {
    return exact(value, ['id', 'actId', 'title', 'description', 'location', 'timeLabel', 'objective', 'anchors', 'entryFacts', 'moves'])
        && identifier(value.id)
        && identifier(value.actId)
        && text(value.title, 120)
        && text(value.description, 800)
        && text(value.location, 160)
        && text(value.timeLabel, 120)
        && text(value.objective, 500)
        && stringList(value.anchors, 32, 100)
        && idList(value.entryFacts)
        && Array.isArray(value.moves)
        && value.moves.length > 0
        && value.moves.length <= 24
        && uniqueIds(value.moves)
        && value.moves.every(validMove);
}

function validCheck(value) {
    return exact(value, ['id', 'reason', 'attribute', 'formula', 'difficulty', 'successStakes', 'failureStakes', 'successMoveId', 'failureMoveId'])
        && identifier(value.id)
        && text(value.reason, 360)
        && ['body', 'insight', 'rapport'].includes(value.attribute)
        && /^d(?:6|8|10|12|20)$/u.test(value.formula)
        && Number.isSafeInteger(value.difficulty)
        && value.difficulty >= 2
        && value.difficulty <= 40
        && text(value.successStakes, 500)
        && text(value.failureStakes, 500)
        && identifier(value.successMoveId)
        && identifier(value.failureMoveId)
        && value.successMoveId !== value.failureMoveId;
}

function validEnding(value) {
    return exact(value, ['id', 'title', 'summary', 'epilogue'])
        && identifier(value.id)
        && text(value.title, 160)
        && text(value.summary, 900)
        && text(value.epilogue, 900);
}

function everyReferenceExists(scenario) {
    const sceneIds = new Set(scenario.scenes.map(item => item.id));
    const actIds = new Set(scenario.acts.map(item => item.id));
    const checkIds = new Set(scenario.checks.map(item => item.id));
    const endingIds = new Set(scenario.endings.map(item => item.id));
    const secretIds = new Set(scenario.secrets.map(item => item.id));
    const thresholdIds = new Set(scenario.clocks.flatMap(clock => clock.thresholds.map(item => item.id)));
    const declaredFacts = [
        ...scenario.coreFacts.map(item => item.id),
        ...scenario.clocks.flatMap(clock => clock.thresholds.map(item => item.factId)),
        ...scenario.npcs.flatMap(npc => npc.agenda.map(item => item.factId)),
        ...scenario.scenes.flatMap(scene => scene.entryFacts),
        ...scenario.scenes.flatMap(scene => scene.moves.flatMap(move => move.hiddenPatch.occurredFactIds)),
    ];
    const factIds = new Set(declaredFacts);
    const knowledge = Object.fromEntries(Object.entries(scenario.knowledge).map(([key, values]) => [key, new Set(values.map(item => item.id))]));
    const moves = scenario.scenes.flatMap(scene => scene.moves);
    const moveIds = new Set(moves.map(item => item.id));
    if (moveIds.size !== moves.length) return false;
    if (!sceneIds.has(scenario.startSceneId)) return false;
    if (!scenario.acts.every(act => act.sceneIds.every(id => sceneIds.has(id)))) return false;
    if (!scenario.scenes.every(scene => actIds.has(scene.actId))) return false;
    if (!scenario.scenes.every(scene => scenario.acts.find(act => act.id === scene.actId)?.sceneIds.includes(scene.id))) return false;
    if (!scenario.npcs.every(npc => npc.agenda.every(item => thresholdIds.has(item.thresholdId) && factIds.has(item.factId)))) return false;
    if (!moves.every(move => (move.checkId === null || checkIds.has(move.checkId))
        && (move.nextSceneId === null || sceneIds.has(move.nextSceneId))
        && (move.endingId === null || endingIds.has(move.endingId))
        && move.revealSecretIds.every(id => secretIds.has(id))
        && [...move.conditions.allFacts, ...move.conditions.anyFacts, ...move.conditions.notFacts].every(id => factIds.has(id))
        && move.publicPatch.knownPeopleIds.every(id => knowledge.people.has(id))
        && move.publicPatch.knownClueIds.every(id => knowledge.clues.has(id))
        && move.publicPatch.itemIds.every(id => knowledge.items.has(id))
        && move.publicPatch.crisisIds.every(id => knowledge.crises.has(id)))) return false;
    if (!scenario.checks.every(check => moveIds.has(check.successMoveId) && moveIds.has(check.failureMoveId))) return false;
    if (!scenario.checks.every(check => {
        const success = moves.find(move => move.id === check.successMoveId);
        const failure = moves.find(move => move.id === check.failureMoveId);
        return success?.checkId === null && success?.attribute === null
            && failure?.checkId === null && failure?.attribute === null;
    })) return false;
    if (!moves.every(move => move.checkId === null || scenario.checks.some(check => check.id === move.checkId && check.attribute === move.attribute))) return false;
    if (!scenario.clocks.every(clock => clock.thresholds.every(item => factIds.has(item.factId)))) return false;
    return true;
}

export function validateScenario(value) {
    try {
        if (!exact(value, [
            'schema', 'version', 'id', 'contentVersion', 'hash', 'public', 'coreFacts', 'secrets',
            'npcs', 'clocks', 'knowledge', 'acts', 'scenes', 'checks', 'endings', 'startSceneId',
        ])) return false;
        if (value.schema !== SCENARIO_SCHEMA || value.version !== SCENARIO_VERSION) return false;
        if (!identifier(value.id) || !/^\d+\.\d+\.\d+$/u.test(value.contentVersion)) return false;
        if (!/^fnv1a64:[0-9a-f]{16}$/u.test(value.hash) || value.hash !== computeScenarioHash(value)) return false;
        if (!validPublic(value.public)) return false;
        if (!Array.isArray(value.coreFacts) || value.coreFacts.length === 0 || !uniqueIds(value.coreFacts) || !value.coreFacts.every(validCoreFact)) return false;
        if (!Array.isArray(value.secrets) || !uniqueIds(value.secrets) || !value.secrets.every(validSecret)) return false;
        if (!Array.isArray(value.npcs) || !uniqueIds(value.npcs) || !value.npcs.every(validNpc)) return false;
        if (!Array.isArray(value.clocks) || value.clocks.length !== 1 || !uniqueIds(value.clocks) || !value.clocks.every(validClock)) return false;
        if (!validKnowledge(value.knowledge)) return false;
        if (!Array.isArray(value.acts) || value.acts.length === 0 || !uniqueIds(value.acts) || !value.acts.every(validAct)) return false;
        if (!Array.isArray(value.scenes) || value.scenes.length === 0 || !uniqueIds(value.scenes) || !value.scenes.every(validScene)) return false;
        if (!Array.isArray(value.checks) || !uniqueIds(value.checks) || !value.checks.every(validCheck)) return false;
        if (!Array.isArray(value.endings) || value.endings.length === 0 || !uniqueIds(value.endings) || !value.endings.every(validEnding)) return false;
        return identifier(value.startSceneId) && everyReferenceExists(value);
    } catch {
        return false;
    }
}

function freezeDeep(value) {
    if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.values(value).forEach(freezeDeep);
    return Object.freeze(value);
}

export function assertScenario(value) {
    if (!validateScenario(value)) throw new Error('剧本未通过 Candy W v2 严格 schema、哈希或引用校验。');
    return freezeDeep(structuredClone(value));
}

export function finalizeScenario(draft) {
    if (!record(draft)) throw new TypeError('剧本草案必须是对象。');
    const value = structuredClone(draft);
    value.hash = '';
    value.hash = computeScenarioHash(value);
    return assertScenario(value);
}
