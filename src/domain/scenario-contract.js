import { object, text, integer, list, identifier as id, nullable, ids, texts } from './json-contract.js';
const scalar = { anyOf: [{ type: 'null' }, { type: 'boolean' }, text(240, 0), integer(-1000000, 1000000)] };
const variables = { type: 'object', properties: {}, required: [], additionalProperties: scalar, propertyNames: id, maxProperties: 48 };
const attribute = { type: 'string', enum: ['body', 'insight', 'rapport'] };
export const MOVE_CONTRACT = object({
    id, label: text(120), description: text(400), clockAdvance: integer(0, 240), attribute: nullable(attribute), checkId: nullable(id),
    conditions: object({ allFacts: ids(), anyFacts: ids(), notFacts: ids() }), mustHappen: { ...texts(24, 600), minItems: 1 }, revealSecretIds: ids(),
    publicPatch: object({ objective: nullable(text(500)), knownPeopleIds: ids(), knownClueIds: ids(), itemIds: ids(), crisisIds: ids() }),
    hiddenPatch: object({ occurredFactIds: ids(), setVariables: variables }), nextSceneId: nullable(id), endingId: nullable(id),
});
export const SCENE_CONTRACT = object({ id, actId: id, title: text(120), description: text(800), location: text(160), timeLabel: text(120), objective: text(500), anchors: texts(32, 100), entryFacts: ids(), moves: list(MOVE_CONTRACT, 24, 1) });
const knowledge = kind => object({ id, name: text(100), ...(kind === 'person' ? { relation: text(240) } : {}), detail: text(600), ...(kind === 'person' ? { status: text(240) } : kind === 'crisis' ? { urgency: text(120) } : {}), anchors: texts(12, 100) });
export const SCENARIO_DRAFT_CONTRACT = object({
    schema: { const: 'candy-w-rpg-director/scenario/v2' }, version: { const: 2 }, id, contentVersion: { ...text(40), pattern: '^\\d+\\.\\d+\\.\\d+$' },
    public: object({ title: text(120), tagline: text(240), summary: text(1200), tone: text(120), duration: text(120), symbol: text(16), tags: texts(12, 40) }),
    coreFacts: list(object({ id, text: text(600) }), Number.MAX_SAFE_INTEGER, 1),
    secrets: list(object({ id, title: text(120), fact: text(800), revealText: text(600), leakPhrases: texts(12, 120) }), Number.MAX_SAFE_INTEGER),
    npcs: list(object({ id, name: text(80), role: text(120), publicRelation: text(200), publicDescription: text(500), hiddenGoal: text(600), agenda: list(object({ thresholdId: id, action: text(500), factId: id }), 24) }), Number.MAX_SAFE_INTEGER),
    clocks: list(object({ id, label: text(120), startMinute: integer(), endMinute: integer(), thresholds: list(object({ id, minute: integer(), publicWarning: text(400), hiddenEvent: text(600), factId: id, setVariables: variables }), 32, 1) }), 1, 1),
    knowledge: object({ people: list(knowledge('person'), Number.MAX_SAFE_INTEGER), clues: list(knowledge('clue'), Number.MAX_SAFE_INTEGER), items: list(knowledge('item'), Number.MAX_SAFE_INTEGER), crises: list(knowledge('crisis'), Number.MAX_SAFE_INTEGER) }),
    acts: list(object({ id, number: integer(1, Number.MAX_SAFE_INTEGER), title: text(120), summary: text(600), sceneIds: { ...ids(32), minItems: 1 } }), Number.MAX_SAFE_INTEGER, 1),
    scenes: list(SCENE_CONTRACT, Number.MAX_SAFE_INTEGER, 1),
    checks: list(object({ id, reason: text(360), attribute, formula: { type: 'string', enum: ['d6', 'd8', 'd10', 'd12', 'd20'] }, difficulty: integer(2, 40), successStakes: text(500), failureStakes: text(500), successMoveId: id, failureMoveId: id }), Number.MAX_SAFE_INTEGER),
    endings: list(object({ id, title: text(160), summary: text(900), epilogue: text(900) }), Number.MAX_SAFE_INTEGER, 1), startSceneId: id,
});
export const PLAN_MOVE_CONTRACT = { anyOf: [
    object({ id, attribute, checkId: id, nextSceneId: { type: 'null' }, endingId: { type: 'null' } }),
    object({ id, attribute: { type: 'null' }, checkId: { type: 'null' }, nextSceneId: nullable(id), endingId: { type: 'null' } }),
    object({ id, attribute: { type: 'null' }, checkId: { type: 'null' }, nextSceneId: { type: 'null' }, endingId: id }),
] };
export const CHECK_FLOW_RULE = '等待投骰的动作不得转场或进入结局，nextSceneId/endingId 都为空。成功和失败是独立的后果动作，由后果动作指定下一场景或结局；不能拿目标场景的全部普通动作当作判定后果，否则该场景没有可供玩家行动的入口。每个场景至少保留一个不属于任何判定后果的普通动作。';
export const SCENE_CONTEXT_CONTRACT = object(Object.fromEntries(['people', 'clues', 'items', 'crises', 'npcIds', 'secretIds', 'coreFactIds', 'worldEntryIds'].map(key => [key, ids()])));
// Only an authoring job is bounded; existing saved scenarios retain their original collection limits.
const props = { ...SCENARIO_DRAFT_CONTRACT.properties }; delete props.scenes;
export const AUTHORING_PLAN_CONTRACT = object({ ...props, scenePlans: list(object({ id, actId: id, title: text(120), purpose: text(800), context: SCENE_CONTEXT_CONTRACT, moves: list(PLAN_MOVE_CONTRACT, 24, 1) }), 32, 1) });
