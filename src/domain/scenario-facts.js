/** Variables and occurred facts are separate namespaces in the director engine. */
export function declaredFactIds(scenario) {
    return new Set([
        ...scenario.coreFacts.map(item => item.id),
        ...scenario.clocks.flatMap(clock => clock.thresholds.map(item => item.factId)),
        ...scenario.npcs.flatMap(npc => npc.agenda.map(item => item.factId)),
        ...(scenario.scenes ?? []).flatMap(scene => scene.entryFacts),
        ...(scenario.scenes ?? []).flatMap(scene => scene.moves.flatMap(move => move.hiddenPatch.occurredFactIds)),
    ]);
}

export function factReferenceIssues(scene, facts, path = '$') {
    return scene.moves.flatMap((move, index) => Object.entries(move.conditions).flatMap(([field, ids]) =>
        ids.filter(id => !facts.has(id)).map(id => `${path}.moves[${index}].conditions.${field}：事实 ${id} 没有声明；setVariables 的变量名不等于发生事实`)));
}

export function assertFactReferences(scenario) {
    const facts = declaredFactIds(scenario);
    const issues = scenario.scenes.flatMap((scene, index) => factReferenceIssues(scene, facts, `$.scenes[${index}]`)).slice(0, 16);
    if (issues.length) {
        const error = new Error(`剧本事实引用错误：${issues.join('；')}`);
        error.code = 'INVALID_REFERENCES'; error.issues = issues; throw error;
    }
}
