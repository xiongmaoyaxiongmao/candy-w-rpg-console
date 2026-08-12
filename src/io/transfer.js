import {
    analyzeScenarioGraph,
    assertScenario,
    stateMatchesScenario,
    validateDirectorState,
} from '../domain/index.js';

export const SCENARIO_PACKAGE_FORMAT = 'candy-w-rpg-director/scenario-package/v2';
export const SAVE_PACKAGE_FORMAT = 'candy-w-rpg-director/save/v2';

const MAX_TRANSFER_CHARS = 2_000_000;
const MAX_JSON_DEPTH = 96;

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const isRecord = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));

function fail(message) {
    throw new Error(message);
}

function assertExactKeys(value, keys, label) {
    if (!isRecord(value)) fail(`${label}必须是对象。`);
    const actual = Reflect.ownKeys(value);
    if (actual.some(key => typeof key !== 'string')
        || actual.length !== keys.length
        || keys.some(key => !own(value, key))) {
        fail(`${label}字段必须完全匹配 v2 格式，且不能包含未知字段。`);
    }
}

function assertExportedAt(value) {
    if (typeof value !== 'string'
        || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)
        || Number.isNaN(Date.parse(value))
        || new Date(value).toISOString() !== value) {
        fail('导出时间必须是有效的 UTC ISO 时间。');
    }
    return value;
}

function malformedJson() {
    fail('导入内容必须是单一、严格的 JSON 对象。');
}

function skipWhitespace(source, start) {
    let index = start;
    while (index < source.length && /[\u0009\u000A\u000D\u0020]/u.test(source[index])) index += 1;
    return index;
}

function scanString(source, start) {
    if (source[start] !== '"') malformedJson();
    let index = start + 1;
    while (index < source.length) {
        const character = source[index];
        if (character === '"') {
            const end = index + 1;
            let decoded;
            try { decoded = JSON.parse(source.slice(start, end)); }
            catch { malformedJson(); }
            return { end, decoded };
        }
        if (character === '\\') {
            index += 1;
            const escaped = source[index];
            if (escaped === 'u') {
                if (!/^[0-9A-Fa-f]{4}$/u.test(source.slice(index + 1, index + 5))) malformedJson();
                index += 5;
                continue;
            }
            if (!'"\\/bfnrt'.includes(escaped ?? '')) malformedJson();
            index += 1;
            continue;
        }
        if (character.charCodeAt(0) < 0x20) malformedJson();
        index += 1;
    }
    malformedJson();
}

function scanNumber(source, start) {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(source.slice(start));
    if (!match) malformedJson();
    return start + match[0].length;
}

function scanValue(source, start, depth) {
    if (depth > MAX_JSON_DEPTH) fail('导入 JSON 嵌套过深。');
    const index = skipWhitespace(source, start);
    const first = source[index];
    if (first === '"') return scanString(source, index).end;
    if (first === '{') return scanObject(source, index, depth + 1);
    if (first === '[') return scanArray(source, index, depth + 1);
    if (source.startsWith('true', index)) return index + 4;
    if (source.startsWith('false', index)) return index + 5;
    if (source.startsWith('null', index)) return index + 4;
    return scanNumber(source, index);
}

function scanObject(source, start, depth) {
    let index = skipWhitespace(source, start + 1);
    const keys = new Set();
    if (source[index] === '}') return index + 1;
    while (index < source.length) {
        const key = scanString(source, index);
        if (keys.has(key.decoded)) fail(`导入 JSON 含重复字段 ${key.decoded}。`);
        keys.add(key.decoded);
        index = skipWhitespace(source, key.end);
        if (source[index] !== ':') malformedJson();
        index = skipWhitespace(source, scanValue(source, index + 1, depth));
        if (source[index] === '}') return index + 1;
        if (source[index] !== ',') malformedJson();
        index = skipWhitespace(source, index + 1);
    }
    malformedJson();
}

function scanArray(source, start, depth) {
    let index = skipWhitespace(source, start + 1);
    if (source[index] === ']') return index + 1;
    while (index < source.length) {
        index = skipWhitespace(source, scanValue(source, index, depth));
        if (source[index] === ']') return index + 1;
        if (source[index] !== ',') malformedJson();
        index = skipWhitespace(source, index + 1);
    }
    malformedJson();
}

function parseTransfer(input) {
    if (isRecord(input)) return structuredClone(input);
    if (typeof input !== 'string') fail('导入内容必须是 JSON 文本或对象。');
    if (input.length > MAX_TRANSFER_CHARS) fail(`导入内容超过 ${MAX_TRANSFER_CHARS} 字符。`);
    const source = input.trim();
    if (!source.startsWith('{') || !source.endsWith('}')) malformedJson();
    const end = skipWhitespace(source, scanValue(source, 0, 0));
    if (end !== source.length) malformedJson();
    let parsed;
    try { parsed = JSON.parse(source); }
    catch { malformedJson(); }
    if (!isRecord(parsed)) malformedJson();
    return parsed;
}

function checkedScenario(value) {
    if (!isRecord(value)) fail('剧本必须是对象。');
    const scenario = structuredClone(value);
    const result = assertScenario(scenario);
    if (result === false) fail('剧本没有通过严格 v2 校验。');
    const checked = isRecord(result) ? result : scenario;
    const graph = analyzeScenarioGraph(checked);
    if (!graph.isComplete) {
        fail('剧本图不完整：存在不可达场景、不可达结局或无出口场景。');
    }
    return checked;
}

function checkedState(value) {
    if (!isRecord(value)) fail('导演存档必须是对象。');
    const state = structuredClone(value);
    if (!validateDirectorState(state)) fail('导演存档没有通过严格 v2 校验。');
    return state;
}

function scenarioIdentity(scenario) {
    if (typeof scenario.id !== 'string' || scenario.id.length === 0
        || !Number.isSafeInteger(scenario.version) || scenario.version < 1
        || typeof scenario.hash !== 'string' || scenario.hash.length === 0) {
        fail('剧本缺少可校验的 id、version 或 hash。');
    }
    return { id: scenario.id, version: scenario.version, hash: scenario.hash };
}

function assertMatchingScenario(scenario, state) {
    const expected = scenarioIdentity(scenario);
    assertExactKeys(state.scenario, ['id', 'version', 'hash'], '存档的剧本标识');
    if (state.scenario.id !== expected.id
        || state.scenario.version !== expected.version
        || state.scenario.hash !== expected.hash) {
        fail('存档状态与随附剧本的 id、version 或 hash 不一致。');
    }
    if (!stateMatchesScenario(state, scenario)) fail('存档状态含有剧本中不存在的场景、人物、判定、秘密或事务引用。');
}

function assertPortableState(state) {
    if (state.phase === 'generating' || state.pendingTransaction !== null) {
        fail('生成中或含 pending 事务的状态不能导出或导入。请先完成或恢复本轮生成。');
    }
}

function normalizedTimestamp(exportedAt) {
    const value = exportedAt ?? new Date().toISOString();
    return assertExportedAt(value);
}

export function createScenarioPackage(scenario, { exportedAt } = {}) {
    return {
        format: SCENARIO_PACKAGE_FORMAT,
        exportedAt: normalizedTimestamp(exportedAt),
        scenario: checkedScenario(scenario),
    };
}

export function importScenarioPackage(input) {
    const envelope = parseTransfer(input);
    assertExactKeys(envelope, ['format', 'exportedAt', 'scenario'], '剧本包');
    if (envelope.format !== SCENARIO_PACKAGE_FORMAT) fail('只接受 Candy W 导演 v2 剧本包；旧版或未知格式已拒绝。');
    assertExportedAt(envelope.exportedAt);
    return checkedScenario(envelope.scenario);
}

export function exportScenarioPackage(scenario, options = {}) {
    const { space = 2, ...createOptions } = options;
    if (!Number.isSafeInteger(space) || space < 0 || space > 8) fail('JSON 缩进必须是 0 到 8 的整数。');
    return JSON.stringify(createScenarioPackage(scenario, createOptions), null, space);
}

export function createSavePackage(scenario, state, { exportedAt } = {}) {
    const checkedScenarioValue = checkedScenario(scenario);
    const checkedStateValue = checkedState(state);
    assertMatchingScenario(checkedScenarioValue, checkedStateValue);
    assertPortableState(checkedStateValue);
    return {
        format: SAVE_PACKAGE_FORMAT,
        exportedAt: normalizedTimestamp(exportedAt),
        scenario: checkedScenarioValue,
        state: checkedStateValue,
    };
}

export function importSavePackage(input) {
    const envelope = parseTransfer(input);
    assertExactKeys(envelope, ['format', 'exportedAt', 'scenario', 'state'], '存档包');
    if (envelope.format !== SAVE_PACKAGE_FORMAT) fail('只接受 Candy W 导演 v2 存档；旧版或未知格式已拒绝。');
    assertExportedAt(envelope.exportedAt);
    const scenario = checkedScenario(envelope.scenario);
    const state = checkedState(envelope.state);
    assertMatchingScenario(scenario, state);
    assertPortableState(state);
    return { scenario, state };
}

export function exportSavePackage(scenario, state, options = {}) {
    const { space = 2, ...createOptions } = options;
    if (!Number.isSafeInteger(space) || space < 0 || space > 8) fail('JSON 缩进必须是 0 到 8 的整数。');
    return JSON.stringify(createSavePackage(scenario, state, createOptions), null, space);
}
