/** Immutable scene relationships derived from actual references and named anchors. */
export const KNOWLEDGE_FIELDS = Object.freeze({ people: 'knownPeopleIds', clues: 'knownClueIds', items: 'itemIds', crises: 'crisisIds' });
const unique = values => [...new Set(values)];
const mentions = (text, entry) => [entry.id, entry.name, ...(entry.anchors ?? [])].filter(Boolean).some(word => text.includes(word));
const cache = new Map();
export function buildScenarioContextIndex(scenario, saved = null) {
    if (saved && (saved.version !== 1 || saved.scenarioHash !== scenario.hash)) throw new Error('剧本关联索引版本或内容不一致。');
    if (!saved && cache.has(scenario.hash)) return cache.get(scenario.hash);
    const scenes = {};
    for (const scene of scenario.scenes) {
        const narrative = [scene.title, scene.description, scene.location, scene.objective, ...scene.anchors, ...scene.moves.flatMap(m => [m.description, ...m.mustHappen])].join('\n');
        scenes[scene.id] = Object.fromEntries(Object.entries(KNOWLEDGE_FIELDS).map(([kind, field]) => [kind, unique([
            ...(saved?.scenes?.[scene.id]?.[kind] ?? []).filter(id => scenario.knowledge[kind].some(e => e.id === id)),
            ...scenario.knowledge[kind].filter(entry => mentions(narrative, entry)).map(entry => entry.id),
        ])]));
    }
    const index = Object.freeze({ version: 1, scenarioHash: scenario.hash, scenes });
    if (cache.size >= 128) cache.delete(cache.keys().next().value);
    cache.set(scenario.hash, index); return index;
}
export function selectPublicKnowledge(scenario, publicState, { sceneId = publicState.scene.id, playerAction = '', newlyPublic = {} } = {}) {
    const index = buildScenarioContextIndex(scenario), refs = index.scenes[sceneId];
    if (!refs) throw new Error('当前场景没有有效的资料关联。');
    const result = {}, evidence = [];
    for (const [kind, field] of Object.entries(KNOWLEDGE_FIELDS)) {
        const known = new Set([...(publicState[field] ?? []), ...(newlyPublic[field] ?? [])]);
        result[kind] = scenario.knowledge[kind].filter(entry => {
            if (!known.has(entry.id)) return false;
            const reason = (newlyPublic[field] ?? []).includes(entry.id) ? '本轮新公开' : mentions(playerAction, entry) ? '本次行动提及' : refs[kind].includes(entry.id) ? '当前场景相关' : kind === 'crises' ? '持续中的危机' : null;
            if (reason) evidence.push({ title: entry.name, reason });
            return Boolean(reason);
        });
    }
    return { ...result, evidence, sceneId };
}

/** Existing submitted arrivals are the sole evidence used to restore entry facts. */
export function restoreArrivalFacts(state, scenario) {
    const next = structuredClone(state);
    const visited = new Set(next.hidden.visitedSceneIds);
    const proven = new Set([scenario.startSceneId]);
    for (const entry of next.history) {
        if (visited.has(entry.sceneId)) proven.add(entry.sceneId);
        const move = scenario.scenes.flatMap(s => s.moves).find(m => m.id === entry.moveId);
        if (move?.nextSceneId && visited.has(move.nextSceneId)) proven.add(move.nextSceneId);
    }
    const facts = scenario.scenes.filter(s => proven.has(s.id)).flatMap(s => s.entryFacts);
    next.hidden.occurredFacts = unique([...next.hidden.occurredFacts, ...facts]);
    return next;
}
