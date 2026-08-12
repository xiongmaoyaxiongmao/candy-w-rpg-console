export class ProtocolValidationError extends Error {
    constructor(message, code = 'PROTOCOL_VALIDATION_ERROR') {
        super(message);
        this.name = 'ProtocolValidationError';
        this.code = code;
    }
}

export function fail(message, code) {
    throw new ProtocolValidationError(message, code);
}

export function isPlainRecord(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}

export function assertKeyShape(value, { required, optional = [] }, label, code) {
    if (!isPlainRecord(value)) fail(`${label}必须是普通对象。`, code);
    const requiredSet = new Set(required);
    const allowed = new Set([...required, ...optional]);
    const keys = Reflect.ownKeys(value);
    if (keys.some(key => typeof key !== 'string') || keys.some(key => !allowed.has(key))) {
        fail(`${label}包含未知字段。`, code);
    }
    for (const key of requiredSet) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) fail(`${label}缺少字段 ${key}。`, code);
    }
}

export function assertExactKeys(value, keys, label, code) {
    assertKeyShape(value, { required: keys }, label, code);
    if (Reflect.ownKeys(value).length !== keys.length) fail(`${label}字段必须完全匹配协议。`, code);
}

export function cleanText(value, {
    label = '文本',
    minChars = 0,
    maxChars,
    multiline = false,
    code,
} = {}) {
    if (typeof value !== 'string') fail(`${label}必须是字符串。`, code);
    const normalized = value.normalize('NFKC').trim();
    const forbiddenControl = multiline ? /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u : /[\u0000-\u001F\u007F]/u;
    if (forbiddenControl.test(normalized)) fail(`${label}包含控制字符。`, code);
    if (normalized.length < minChars) fail(`${label}不能为空。`, code);
    if (Number.isSafeInteger(maxChars) && normalized.length > maxChars) fail(`${label}超过 ${maxChars} 字符。`, code);
    return normalized;
}

export function safeIdentifier(value, label, code) {
    const identifier = cleanText(value, { label, minChars: 1, maxChars: 96, code });
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(identifier)) fail(`${label}不是合法标识符。`, code);
    return identifier;
}

export function assertSafeInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER, code } = {}) {
    if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}必须是 ${min} 到 ${max} 之间的安全整数。`, code);
    return value;
}

export function promptJson(value) {
    return JSON.stringify(value, null, 2)
        .replace(/</gu, '\\u003c')
        .replace(/>/gu, '\\u003e')
        .replace(/&/gu, '\\u0026')
        .replace(/\u2028/gu, '\\u2028')
        .replace(/\u2029/gu, '\\u2029');
}

export function stableUnique(values) {
    const seen = new Set();
    const result = [];
    for (const value of values) {
        const key = value.normalize('NFKC').toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(value);
    }
    return result;
}
