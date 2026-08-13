import { fail, isPlainRecord } from './validation.js';

const CODE = 'INVALID_ACTION_DECISION';
const MAX_JSON_CHARS = 120_000;
const MAX_DEPTH = 16;

function malformed() {
    fail('行动分类必须是单一、严格的 JSON 对象。', CODE);
}

function skipWhitespace(source, start) {
    let index = start;
    while (index < source.length && /[\u0009\u000A\u000D\u0020]/u.test(source[index])) index += 1;
    return index;
}

function scanString(source, start) {
    if (source[start] !== '"') malformed();
    let index = start + 1;
    while (index < source.length) {
        const character = source[index];
        if (character === '"') {
            const end = index + 1;
            let decoded;
            try { decoded = JSON.parse(source.slice(start, end)); }
            catch { malformed(); }
            return { end, decoded };
        }
        if (character === '\\') {
            index += 1;
            const escaped = source[index];
            if (escaped === 'u') {
                if (!/^[0-9A-Fa-f]{4}$/u.test(source.slice(index + 1, index + 5))) malformed();
                index += 5;
                continue;
            }
            if (!'"\\/bfnrt'.includes(escaped ?? '')) malformed();
            index += 1;
            continue;
        }
        if (character.charCodeAt(0) < 0x20) malformed();
        index += 1;
    }
    malformed();
}

function scanNumber(source, start) {
    const match = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/u.exec(source.slice(start));
    if (!match) malformed();
    return start + match[0].length;
}

function scanValue(source, start, depth) {
    if (depth > MAX_DEPTH) fail('行动分类 JSON 嵌套过深。', CODE);
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
        if (keys.has(key.decoded)) fail(`行动分类 JSON 含重复字段 ${key.decoded}。`, CODE);
        keys.add(key.decoded);
        index = skipWhitespace(source, key.end);
        if (source[index] !== ':') malformed();
        index = skipWhitespace(source, scanValue(source, index + 1, depth));
        if (source[index] === '}') return index + 1;
        if (source[index] !== ',') malformed();
        index = skipWhitespace(source, index + 1);
    }
    malformed();
}

function scanArray(source, start, depth) {
    let index = skipWhitespace(source, start + 1);
    if (source[index] === ']') return index + 1;
    while (index < source.length) {
        index = skipWhitespace(source, scanValue(source, index, depth));
        if (source[index] === ']') return index + 1;
        if (source[index] !== ',') malformed();
        index = skipWhitespace(source, index + 1);
    }
    malformed();
}

export function parseStrictJsonObject(raw) {
    if (typeof raw !== 'string') fail('行动分类响应必须是文本。', CODE);
    if (raw.length > MAX_JSON_CHARS) fail(`行动分类响应超过 ${MAX_JSON_CHARS} 字符。`, CODE);
    const source = raw.trim();
    if (!source.startsWith('{') || !source.endsWith('}')) malformed();
    const end = skipWhitespace(source, scanValue(source, 0, 0));
    if (end !== source.length) malformed();
    let parsed;
    try { parsed = JSON.parse(source); }
    catch { malformed(); }
    if (!isPlainRecord(parsed)) malformed();
    return parsed;
}
