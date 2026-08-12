import { assertScenario } from './scenario-schema.js';

function outcomeTransitions(scenario, moveById, check) {
    return [check.successMoveId, check.failureMoveId]
        .map(id => moveById.get(id))
        .filter(Boolean)
        .map(move => ({ sceneId: move.nextSceneId, endingId: move.endingId }));
}

export function analyzeScenarioGraph(input) {
    const scenario = assertScenario(input);
    const sceneById = new Map(scenario.scenes.map(scene => [scene.id, scene]));
    const moveById = new Map(scenario.scenes.flatMap(scene => scene.moves).map(move => [move.id, move]));
    const checkById = new Map(scenario.checks.map(check => [check.id, check]));
    const outcomeMoveIds = new Set(scenario.checks.flatMap(check => [check.successMoveId, check.failureMoveId]));
    const reachableScenes = new Set([scenario.startSceneId]);
    const reachableEndings = new Set();
    const queue = [scenario.startSceneId];

    while (queue.length) {
        const sceneId = queue.shift();
        const scene = sceneById.get(sceneId);
        for (const move of scene.moves) {
            if (outcomeMoveIds.has(move.id)) continue;
            const transitions = move.checkId
                ? outcomeTransitions(scenario, moveById, checkById.get(move.checkId))
                : [{ sceneId: move.nextSceneId, endingId: move.endingId }];
            for (const transition of transitions) {
                if (transition.endingId) reachableEndings.add(transition.endingId);
                if (transition.sceneId && !reachableScenes.has(transition.sceneId)) {
                    reachableScenes.add(transition.sceneId);
                    queue.push(transition.sceneId);
                }
            }
        }
    }

    const deadEndSceneIds = [...reachableScenes].filter(sceneId => {
        const scene = sceneById.get(sceneId);
        return !scene.moves.some(move => !outcomeMoveIds.has(move.id));
    });
    const allSceneIds = scenario.scenes.map(scene => scene.id);
    const allEndingIds = scenario.endings.map(ending => ending.id);
    const unreachableSceneIds = allSceneIds.filter(id => !reachableScenes.has(id));
    const unreachableEndingIds = allEndingIds.filter(id => !reachableEndings.has(id));

    return Object.freeze({
        reachableSceneIds: Object.freeze([...reachableScenes]),
        reachableEndingIds: Object.freeze([...reachableEndings]),
        unreachableSceneIds: Object.freeze(unreachableSceneIds),
        unreachableEndingIds: Object.freeze(unreachableEndingIds),
        deadEndSceneIds: Object.freeze(deadEndSceneIds),
        allEndingsReachable: unreachableEndingIds.length === 0,
        isComplete: unreachableSceneIds.length === 0 && unreachableEndingIds.length === 0 && deadEndSceneIds.length === 0,
    });
}
