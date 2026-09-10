/** Compile map fields into typed entry arrays for providers requiring closed objects.
 * This is a declared wire encoding, never a repair of malformed model output.
 */
export function providerSchema(schema) {
    if (schema.type === 'object' && schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        return { type: 'array', maxItems: schema.maxProperties ?? 48, items: { type: 'object', additionalProperties: false, required: ['key', 'value'], properties: { key: providerSchema(schema.propertyNames), value: providerSchema(schema.additionalProperties) } } };
    }
    const result = { ...schema };
    if ('const' in result && !result.type) result.type = result.const === null ? 'null' : Number.isInteger(result.const) ? 'integer' : typeof result.const;
    if (schema.properties) result.properties = Object.fromEntries(Object.entries(schema.properties).map(([key, sub]) => [key, providerSchema(sub)]));
    if (schema.items) result.items = providerSchema(schema.items);
    if (schema.anyOf) result.anyOf = schema.anyOf.map(providerSchema);
    return result;
}
export function decodeProviderValue(value, schema) {
    if (schema.type === 'object' && schema.additionalProperties && typeof schema.additionalProperties === 'object') {
        if (new Set(value.map(entry => entry.key)).size !== value.length) throw new Error('结构化字段含重复变量名。');
        return Object.fromEntries(value.map(entry => [entry.key, decodeProviderValue(entry.value, schema.additionalProperties)]));
    }
    if (schema.type === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, decodeProviderValue(item, schema.properties[key])]));
    if (schema.type === 'array') return value.map(item => decodeProviderValue(item, schema.items));
    return value;
}
