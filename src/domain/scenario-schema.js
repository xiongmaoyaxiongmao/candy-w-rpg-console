import { declaredFactIds } from './scenario-facts.js';
import { SCENARIO_DRAFT_CONTRACT } from './scenario-contract.js';
import { contractIssue } from './json-contract.js';
export const SCENARIO_SCHEMA = 'candy-w-rpg-director/scenario/v2';
export const SCENARIO_VERSION = 2;

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const exact = (value, keys) => record(value)
    && Object.keys(value).length === keys.length
    && keys.every(key => own(value, key));
const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,79}$/u.test(value);
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

function semanticShape(value) {
    const collections = ['coreFacts', 'secrets', 'npcs', 'clocks', 'acts', 'scenes', 'checks', 'endings'];
    if (!collections.every(key => uniqueIds(value[key]))) return false;
    if (!Object.values(value.knowledge).every(uniqueIds)) return false;
    const clock = value.clocks[0];
    if (clock.endMinute <= clock.startMinute || !uniqueIds(clock.thresholds)) return false;
    if (!clock.thresholds.every((t, i) => t.minute > clock.startMinute && t.minute <= clock.endMinute && (i === 0 || t.minute > clock.thresholds[i - 1].minute))) return false;
    if (!value.scenes.every(scene => uniqueIds(scene.moves) && scene.moves.every(move => !(move.nextSceneId && move.endingId) && (move.checkId === null ? move.attribute === null : move.attribute !== null)))) return false;
    return value.checks.every(check => check.successMoveId !== check.failureMoveId);
}

function everyReferenceExists(scenario) {
    const sceneIds = new Set(scenario.scenes.map(item => item.id));
    const actIds = new Set(scenario.acts.map(item => item.id));
    const checkIds = new Set(scenario.checks.map(item => item.id));
    const endingIds = new Set(scenario.endings.map(item => item.id));
    const secretIds = new Set(scenario.secrets.map(item => item.id));
    const thresholdIds = new Set(scenario.clocks.flatMap(clock => clock.thresholds.map(item => item.id)));
    const factIds = declaredFactIds(scenario);
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
        const { hash, ...draft } = value;
        if (contractIssue(draft, SCENARIO_DRAFT_CONTRACT) || !semanticShape(value)) return false;
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
