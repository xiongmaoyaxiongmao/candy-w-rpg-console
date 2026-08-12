import { assertExactKeys, assertKeyShape, assertSafeInteger, cleanText, safeIdentifier } from '../protocol/validation.js';

export const DEFAULT_CONTEXT_MAX_CHARS = 6000;

export class ContextBudgetError extends Error {
    constructor(message, details) {
        super(message);
        this.name = 'ContextBudgetError';
        this.code = 'CONTEXT_BUDGET_EXCEEDED';
        this.details = Object.freeze({ ...details });
    }
}

function readSections(values, label) {
    if (!Array.isArray(values) || values.length > 128) throw new TypeError(`${label}必须是最多 128 项的数组。`);
    return values.map((value, index) => {
        assertExactKeys(value, ['id', 'text'], `${label}[${index}]`);
        return Object.freeze({
            id: safeIdentifier(value.id, `${label}[${index}].id`),
            text: cleanText(value.text, { label: `${label}[${index}].text`, minChars: 1, maxChars: 20000, multiline: true }),
        });
    });
}

function render(head, optional, tail, marker = null) {
    return [...head, ...optional, ...(marker ? [marker] : []), ...tail].map(section => section.text).join('\n');
}

/**
 * Compile ordered context without ever clipping a section mid-string.
 *
 * `head` and `tail` are mandatory and never truncated. `optional` is ordered
 * from highest to lowest priority. When the full text is too long, a suffix of
 * optional sections is replaced by one explicit omission marker. If even the
 * mandatory sections plus that marker do not fit, a ContextBudgetError is
 * thrown instead of silently producing incomplete instructions.
 */
export function compileContextBudget(input, options = {}) {
    assertExactKeys(input, ['head', 'optional', 'tail'], '上下文预算输入');
    assertKeyShape(options, { required: [], optional: ['maxChars', 'omissionLabel'] }, '上下文预算选项');
    const maxChars = Object.prototype.hasOwnProperty.call(options, 'maxChars')
        ? assertSafeInteger(options.maxChars, 'maxChars', { min: 1, max: 100000 })
        : DEFAULT_CONTEXT_MAX_CHARS;
    const omissionLabel = Object.prototype.hasOwnProperty.call(options, 'omissionLabel')
        ? cleanText(options.omissionLabel, { label: 'omissionLabel', minChars: 1, maxChars: 240 })
        : '[已按上下文预算省略 {count} 项较低优先级公开事实]';
    if ((omissionLabel.match(/\{count\}/gu) ?? []).length !== 1) throw new TypeError('omissionLabel 必须且只能包含一个 {count} 占位符。');

    const head = readSections(input.head, 'head');
    const optional = readSections(input.optional, 'optional');
    const tail = readSections(input.tail, 'tail');
    const allIds = [...head, ...optional, ...tail].map(section => section.id);
    if (new Set(allIds).size !== allIds.length) throw new TypeError('上下文 section id 必须唯一。');

    const complete = render(head, optional, tail);
    if (complete.length <= maxChars) {
        return Object.freeze({
            text: complete,
            includedOptionalIds: Object.freeze(optional.map(section => section.id)),
            omittedOptionalIds: Object.freeze([]),
            truncated: false,
            maxChars,
        });
    }

    const included = [];
    for (let index = 0; index < optional.length; index += 1) {
        const candidate = [...included, optional[index]];
        const omittedCount = optional.length - candidate.length;
        const marker = omittedCount > 0
            ? { id: '__budget_omission__', text: omissionLabel.replace('{count}', String(omittedCount)) }
            : null;
        if (render(head, candidate, tail, marker).length > maxChars) break;
        included.push(optional[index]);
    }

    const omitted = optional.slice(included.length);
    const marker = { id: '__budget_omission__', text: omissionLabel.replace('{count}', String(omitted.length)) };
    const text = render(head, included, tail, marker);
    if (text.length > maxChars) {
        const mandatoryLength = render(head, [], tail).length;
        throw new ContextBudgetError(
            `强制上下文与省略说明共 ${text.length} 字符，超过 ${maxChars} 字符预算；强制段落不会被静默裁剪。`,
            { maxChars, mandatoryLength, requiredWithMarkerLength: text.length, omittedCount: optional.length },
        );
    }

    return Object.freeze({
        text,
        includedOptionalIds: Object.freeze(included.map(section => section.id)),
        omittedOptionalIds: Object.freeze(omitted.map(section => section.id)),
        truncated: true,
        maxChars,
    });
}
