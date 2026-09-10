/** Shared JSON Schema subset used both in provider requests and local validation. */
export const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export const text = (maxLength = 2000, minLength = 1) => ({ type: 'string', minLength, maxLength });
export const integer = (minimum = 0, maximum = 10000) => ({ type: 'integer', minimum, maximum });
export const list = (items, maxItems = 64, minItems = 0) => ({ type: 'array', items, minItems, maxItems });
export const identifier = { ...text(80), pattern: '^[a-z][a-z0-9_-]{0,79}$' };
export const nullable = schema => ({ anyOf: [schema, { type: 'null' }] });
export const ids = (max = 64) => ({ ...list(identifier, max), uniqueItems: true });
export const texts = (max = 64, chars = 240) => list(text(chars), max);

export function contractIssues(value, schema, path = '$', limit = 16) {
    const issues = [];
    function visit(value, schema, path) {
        if (issues.length >= limit) return;
        const bad = message => { if (issues.length < limit) issues.push(`${path}：${message}`); };
        if (schema.anyOf) {
            if (!schema.anyOf.some(s => contractIssues(value, s, path, 1).length === 0)) bad('值不符合允许的类型或范围');
            return;
        }
        if ('const' in schema && value !== schema.const) { bad(`必须为 ${JSON.stringify(schema.const)}`); return; }
        if (schema.enum && !schema.enum.includes(value)) { bad('不在允许值中'); return; }
        switch (schema.type) {
            case 'null': if (value !== null) bad('必须为空值'); return;
            case 'boolean': if (typeof value !== 'boolean') bad('必须为布尔值'); return;
            case 'integer':
                if (!Number.isSafeInteger(value) || value < (schema.minimum ?? -Number.MAX_SAFE_INTEGER) || value > (schema.maximum ?? Number.MAX_SAFE_INTEGER)) bad('整数超出允许范围');
                return;
            case 'string':
                if (typeof value !== 'string') { bad('必须为文字'); return; }
                if (value.length < (schema.minLength ?? 0) || value.length > (schema.maxLength ?? Infinity)) bad('文字长度超出范围');
                if (value !== value.trim()) bad('文字不能含首尾空白');
                if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) bad('文字格式不符');
                return;
            case 'array':
                if (!Array.isArray(value)) { bad('必须为数组'); return; }
                if (value.length < (schema.minItems ?? 0) || value.length > (schema.maxItems ?? Infinity)) bad('条目数量超出范围');
                if (schema.uniqueItems && new Set(value.map(v => JSON.stringify(v))).size !== value.length) bad('含重复条目');
                for (let i = 0; i < value.length && issues.length < limit; i++) visit(value[i], schema.items, `${path}[${i}]`);
                return;
            case 'object':
                if (!value || typeof value !== 'object' || Array.isArray(value)) { bad('必须为对象'); return; }
                if (schema.maxProperties && Object.keys(value).length > schema.maxProperties) bad('字段过多');
                for (const key of schema.required ?? []) if (!Object.hasOwn(value, key)) bad(`缺少字段 ${key}`);
                for (const [key, item] of Object.entries(value)) {
                    if (issues.length >= limit) return;
                    if (schema.propertyNames && contractIssues(key, schema.propertyNames, '$', 1).length) bad('字段名格式不符');
                    const sub = schema.properties && Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
                    if (!sub && schema.additionalProperties === false) { bad(`含未知字段 ${key}`); continue; }
                    visit(item, sub ?? schema.additionalProperties ?? {}, `${path}.${key}`);
                }
        }
    }
    visit(value, schema, path);
    return issues;
}
export function contractIssue(value, schema, path = '$') { return contractIssues(value, schema, path, 1)[0] ?? null; }
export function assertContract(value, schema, label = '生成结果') {
    const issues = contractIssues(value, schema);
    if (issues.length) { const error = new Error(`${label}字段不合格：${issues.join('；')}`); error.code = 'INVALID_FIELDS'; error.issues = issues; throw error; }
    return value;
}
