import { buildScenarioContextIndex, KNOWLEDGE_FIELDS } from './scenario-context.js';

const unique = values => [...new Set(values)];
export function normalizeWorldEntries(input) {
    if (!input) return [];
    if (Array.isArray(input)) {
        if (input.some(e => !e || typeof e.content !== 'string' || !e.content.trim())) throw new Error('世界书条目缺少正文。');
        return input.map((e, i) => ({ id: e.id ?? `world_${i}`, title: e.title || e.comment || `世界资料 ${i + 1}`, keys: Array.isArray(e.keys) ? e.keys : [], content: e.content, origin: e.origin ?? null }));
    }
    if (typeof input !== 'string') throw new Error('世界书素材格式无效。');
    // Legacy jobs stored a flat native result. Preserve every nonempty paragraph,
    // explicitly marking that original book/uid provenance was not saved.
    if (!input.trim()) return [];
    return (input.match(/[\s\S]+?(?:\n(?:[ \t\r]*\n)+|$)/gu) ?? []).map((content, i) => ({ id: `world_${i}`, title: `旧任务资料段 ${i + 1}`, keys: [], content, origin: { legacy: true } }));
}
export const emptySceneContext = () => ({ people: [], clues: [], items: [], crises: [], npcIds: [], secretIds: [], coreFactIds: [], worldEntryIds: [] });
export function validateSceneContext(context, plan, source) {
    const catalogs = { ...plan.knowledge, npcIds: plan.npcs, secretIds: plan.secrets, coreFactIds: plan.coreFacts, worldEntryIds: normalizeWorldEntries(source.worldFacts) };
    if (!context || Object.keys(context).sort().join(',') !== Object.keys(catalogs).sort().join(',')) throw new Error('场景资料关联不完整。');
    for (const [key, values] of Object.entries(catalogs)) {
        const allowed = new Set(values.map(v => v.id));
        if (!Array.isArray(context[key]) || new Set(context[key]).size !== context[key].length || !context[key].every(id => allowed.has(id))) {
            const error = new Error(`场景资料关联引用了不存在的 ${key}。`); error.code = 'INVALID_REFERENCES'; throw error;
        }
    }
    return context;
}
export function authoringSceneContext(source, plan, index) {
    const scene = plan.scenePlans[index], refs = validateSceneContext(scene.context, plan, source);
    const checks = plan.checks.filter(c => scene.moves.some(m => m.checkId === c.id || c.successMoveId === m.id || c.failureMoveId === m.id));
    const neighbors = new Set([...scene.moves.map(m => m.nextSceneId), ...plan.scenePlans.filter(s => s.moves.some(m => m.nextSceneId === scene.id)).map(s => s.id)]);
    const { original, ...brief } = source.brief;
    return {
        brief, story: { id: plan.id, title: plan.public.title, tone: plan.public.tone, startSceneId: plan.startSceneId },
        act: plan.acts.find(a => a.id === scene.actId), scene: { ...scene, context: undefined },
        connections: plan.scenePlans.filter(s => neighbors.has(s.id)).map(s => ({ id: s.id, title: s.title, purpose: s.purpose, moves: s.moves })),
        knowledge: Object.fromEntries(Object.keys(KNOWLEDGE_FIELDS).map(kind => [kind, plan.knowledge[kind].filter(e => refs[kind].includes(e.id))])),
        npcs: plan.npcs.filter(e => refs.npcIds.includes(e.id)), secrets: plan.secrets.filter(e => refs.secretIds.includes(e.id)),
        coreFacts: plan.coreFacts.filter(e => refs.coreFactIds.includes(e.id)),
        clocks: plan.clocks, checks,
        endings: plan.endings.filter(e => scene.moves.some(m => m.endingId === e.id) || checks.some(c => [c.successMoveId,c.failureMoveId].some(id => plan.scenePlans.some(s => s.moves.some(m => m.id === id && m.endingId === e.id))))),
        worldEntries: normalizeWorldEntries(source.worldFacts).filter(e => refs.worldEntryIds.includes(e.id)),
        ...(original ? { originalScene: original.scenes.find(s => s.id === scene.id) ?? null } : {}),
    };
}

/** Author editing closure: selected section plus direct dependencies, never original wholesale. */
export function revisionContext(original, section, completed) {
    const paths = section.fields.map(f => f.path), sceneNumbers = unique(paths.filter(p => p[0] === 'scenes').map(p => p[1]));
    const index = buildScenarioContextIndex(original);
    const scenes = original.scenes.filter((s, i) => sceneNumbers.includes(i));
    const references = new Set();
    const collect = value => { if (typeof value === 'string') references.add(value); else if (Array.isArray(value)) value.forEach(collect); else if (value && typeof value === 'object') Object.values(value).forEach(collect); };
    scenes.forEach(collect);
    const selectedEntries = paths.map(path => { const root = path[0]; return root === 'knowledge' ? original.knowledge[path[1]][path[2]] : Array.isArray(original[root]) ? original[root][path[1]] : null; }).filter(Boolean);
    selectedEntries.forEach(collect);
    const selectedIds = new Set(selectedEntries.map(e => e.id));
    const relatedScenes = original.scenes.filter(s => {
        if (scenes.includes(s)) return true;
        const tokens = new Set(); const visit = v => { if (typeof v === 'string') tokens.add(v); else if (Array.isArray(v)) v.forEach(visit); else if (v && typeof v === 'object') Object.values(v).forEach(visit); }; visit(s);
        return [...selectedIds].some(id => tokens.has(id)) || selectedEntries.some(entry => entry.name && [s.title, s.description, ...s.moves.flatMap(m => [m.description, ...m.mustHappen])].some(text => text.includes(entry.name)));
    });
    const closureKeys = new Set(section.fields.map(f => f.key));
    const dependencies = {
        story: { title: original.public.title, tone: original.public.tone },
        scenes: relatedScenes.map(s => ({ id: s.id, title: s.title, objective: s.objective, connections: s.moves.map(m => ({ id: m.id, checkId: m.checkId, nextSceneId: m.nextSceneId, endingId: m.endingId })) })),
        knowledge: Object.fromEntries(Object.keys(KNOWLEDGE_FIELDS).map(kind => [kind, original.knowledge[kind].filter(e => references.has(e.id) || scenes.some(s => index.scenes[s.id][kind].includes(e.id)))])),
        npcs: original.npcs.filter(e => references.has(e.id) || scenes.some(s => [s.title, s.description, ...s.moves.flatMap(m => [m.description, ...m.mustHappen])].some(text => text.includes(e.name)))),
        checks: original.checks.filter(e => references.has(e.id)), secrets: original.secrets.filter(e => references.has(e.id)),
        endings: original.endings.filter(e => references.has(e.id)), coreFacts: original.coreFacts.filter(e => references.has(e.id)),
    };
    // Revisions of directly referenced entities may affect this section's wording.
    for (const key of Object.keys(completed)) {
        const path = key.split('.'); let entry;
        if (path[0] === 'knowledge') entry = original.knowledge[path[1]]?.[Number(path[2])];
        else if (Array.isArray(original[path[0]])) entry = original[path[0]][Number(path[1])];
        if (entry && references.has(entry.id)) closureKeys.add(key);
    }
    return { dependencies, completed: Object.fromEntries(Object.entries(completed).filter(([key]) => closureKeys.has(key))) };
}
